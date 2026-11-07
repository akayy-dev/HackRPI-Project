// Package simulation serves a request generator and evaluates synthetic HTTP metadata.
package simulation

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"hackrpi-project/classifier"
	"hackrpi-project/proxy"
	"hackrpi-project/telemetry"
)

//go:embed web/index.html web/style.css web/app.js web/generator.js
var assets embed.FS

// Logger persists simulated request metadata, predictions, and classification failures.
type Logger interface {
	LogSimulation(context.Context, *http.Request, *classifier.Result, error, telemetry.SimulationMetadata) error
}

// Request contains the client-supplied request fields of RequestTelemetry. Body
// is inspected by the classifier but is not stored. IntendedClassification is
// a test annotation, never an input to the classifier. Scores and decisions are
// exclusively computed by the server and cannot be supplied by the caller.
type Request struct {
	Timestamp              time.Time   `json:"timestamp"`
	Method                 string      `json:"method"`
	URL                    string      `json:"url"`
	Host                   string      `json:"host"`
	RemoteAddr             string      `json:"remote_addr"`
	Protocol               string      `json:"protocol"`
	Headers                http.Header `json:"headers"`
	Body                   string      `json:"body,omitempty"`
	IntendedClassification string      `json:"intended_classification,omitempty"`
}

// NewHandler serves the control panel at / and POST /submit. Submitted telemetry
// becomes an in-memory HTTP request, passes through the real classifier, and is
// saved to MongoDB; it is never sent to the backend or its simulated source IP.
// Successful evaluations return 201, classification failures 503 (also saved),
// invalid inputs 400, oversized bodies 413, and busy classifiers 429.
func NewHandler(model classifier.Classifier, logger Logger) (http.Handler, error) {
	if model == nil || logger == nil {
		return nil, errors.New("classifier and simulation logger are required")
	}
	web, err := fs.Sub(assets, "web")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServer(http.FS(web)))
	active := make(chan struct{}, 8)
	mux.HandleFunc("POST /submit", func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeError(w, 415, "Content-Type must be application/json")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input *Request
		if err := decoder.Decode(&input); err != nil {
			decodeError(w, err)
			return
		}
		if input == nil {
			writeError(w, 400, "request telemetry must be a JSON object")
			return
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			if err == nil {
				err = errors.New("expected exactly one JSON object")
			}
			decodeError(w, err)
			return
		}
		request, err := input.HTTPRequest(r.Context())
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		defer request.Body.Close()
		select {
		case active <- struct{}{}:
			defer func() { <-active }()
		default:
			w.Header().Set("Retry-After", "1")
			writeError(w, 429, "all simulation classifier slots are busy")
			return
		}
		result, classificationErr := model.Classify(request.Context(), request)
		if classificationErr == nil {
			classificationErr = result.Validate()
		}
		if classificationErr != nil {
			result = nil
		}
		metadata := telemetry.SimulationMetadata{Threshold: proxy.THRESHOLD, Timestamp: input.Timestamp, IntendedClassification: input.IntendedClassification}
		if err := logger.LogSimulation(context.WithoutCancel(r.Context()), request, result, classificationErr, metadata); err != nil {
			slog.Error("Failed to persist simulated request", "error", err)
			writeError(w, 503, "simulation could not be saved")
			return
		}
		if classificationErr != nil {
			slog.Error("Simulation classification failed", "error", classificationErr)
			writeJSON(w, 503, map[string]any{"error": "classification failed; request saved without scores", "saved": true, "classification_error": classificationErr.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, struct {
			*classifier.Result
			RemoteAddr             string  `json:"remote_addr"`
			IntendedClassification string  `json:"intended_classification"`
			Threshold              float64 `json:"threshold"`
			Blocked                bool    `json:"blocked"`
			Accepted               bool    `json:"accepted"`
			Simulated              bool    `json:"simulated"`
		}{result, request.RemoteAddr, input.IntendedClassification, proxy.THRESHOLD, result.Riskiness >= proxy.THRESHOLD, result.Riskiness < proxy.THRESHOLD, true})
	})
	return mux, nil
}

// HTTPRequest reconstructs metadata for classification without a network
// connection. Source IPs (IPv4 or IPv6, optionally with ports) are normalized.
func (input *Request) HTTPRequest(ctx context.Context) (*http.Request, error) {
	if input.Method == "" || input.URL == "" || input.RemoteAddr == "" {
		return nil, errors.New("method, url, and remote_addr are required")
	}
	if len(input.IntendedClassification) > 80 {
		return nil, errors.New("intended_classification must be at most 80 characters")
	}
	ip := net.ParseIP(input.RemoteAddr)
	port := "54321"
	if ip == nil {
		host, sourcePort, err := net.SplitHostPort(input.RemoteAddr)
		if err != nil {
			return nil, errors.New("remote_addr must be an IPv4 or IPv6 address, optionally with a port")
		}
		ip = net.ParseIP(host)
		p, err := strconv.Atoi(sourcePort)
		if ip == nil || err != nil || p < 1 || p > 65535 {
			return nil, errors.New("remote_addr contains an invalid IP or port")
		}
		port = sourcePort
	}
	request, err := http.NewRequestWithContext(ctx, input.Method, input.URL, strings.NewReader(input.Body))
	if err != nil {
		return nil, fmt.Errorf("invalid simulated request: %w", err)
	}
	if request.URL.Scheme != "" && request.URL.Scheme != "http" && request.URL.Scheme != "https" {
		return nil, errors.New("url must be an HTTP URL or request path")
	}
	if request.URL.Host == "" && !strings.HasPrefix(input.URL, "/") {
		return nil, errors.New("url must be an absolute HTTP URL or start with /")
	}
	request.Host = input.Host
	if request.Host == "" {
		request.Host = request.URL.Host
	}
	if request.Host == "" {
		request.Host = "app.example.test"
	}
	if strings.ContainsAny(request.Host, "\r\n\x00") {
		return nil, errors.New("invalid host")
	}
	request.Header = make(http.Header)
	for name, values := range input.Headers {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	request.RemoteAddr = net.JoinHostPort(ip.String(), port)
	if input.Protocol != "" {
		major, minor, ok := http.ParseHTTPVersion(input.Protocol)
		if !ok {
			return nil, errors.New("protocol must have the form HTTP/1.1")
		}
		request.Proto, request.ProtoMajor, request.ProtoMinor = input.Protocol, major, minor
	}
	return request, nil
}

func decodeError(w http.ResponseWriter, err error) {
	var sizeErr *http.MaxBytesError
	if errors.As(err, &sizeErr) {
		writeError(w, 413, "request telemetry must be at most 128 KiB")
		return
	}
	writeError(w, 400, "invalid request telemetry: "+err.Error())
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("Failed to write simulation response", "error", err)
	}
}
