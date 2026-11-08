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

	"hackrpi-project/proxy"
	"hackrpi-project/security"
	"hackrpi-project/telemetry"
)

//go:embed web/index.html web/style.css web/app.js web/generator.js web/training-examples.js web/holdout.json
var assets embed.FS

// Logger persists simulated request metadata, predictions, and classification failures.
type Logger interface {
	LogSimulation(context.Context, *http.Request, *security.Prediction, error, telemetry.SimulationMetadata) error
}

// Request contains the client-supplied request fields of RequestTelemetry. Body
// is inspected by the classifier but is not stored. IntendedClassification is
// a test annotation, never an input to the classifier. Scores and decisions are
// exclusively computed by the server and cannot be supplied by the caller.
type Request struct {
	Timestamp              time.Time          `json:"timestamp"`
	Method                 string             `json:"method"`
	URL                    string             `json:"url"`
	Host                   string             `json:"host"`
	RemoteAddr             string             `json:"remote_addr"`
	DestinationAddr        string             `json:"destination_addr,omitempty"`
	Protocol               string             `json:"protocol"`
	Headers                http.Header        `json:"headers"`
	Body                   string             `json:"body,omitempty"`
	IntendedClassification string             `json:"intended_classification,omitempty"`
	GenerationMode         string             `json:"generation_mode,omitempty"`
	ModelMode              security.ModelMode `json:"model_mode,omitempty"`
}

// NewHandler serves the control panel at / and POST /submit. Submitted telemetry
// becomes an in-memory HTTP request, passes through the real classifier, and is
// saved to MongoDB; it is never sent to the backend or its simulated source IP.
// Successful evaluations return 201, classification failures 503 (also saved),
// invalid inputs 400, oversized bodies 413, and busy classifiers 429.
func NewHandler(model security.Classifier, logger Logger) (http.Handler, error) {
	return NewHandlerWithConfig(model, logger, Config{Threshold: proxy.THRESHOLD})
}

func NewHandlerWithConfig(model security.Classifier, logger Logger, config Config) (http.Handler, error) {
	if model == nil || logger == nil {
		return nil, errors.New("classifier and simulation logger are required")
	}
	if err := config.validate(); err != nil {
		return nil, err
	}
	web, err := fs.Sub(assets, "web")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServer(http.FS(web)))
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, _ *http.Request) {
		modes := []security.ModelMode{config.DefaultMode}
		if len(config.Models) > 0 {
			modes = []security.ModelMode{security.ModelTrained, security.ModelOriginal2020}
		}
		writeJSON(w, 200, map[string]any{"default_model_mode": config.DefaultMode, "model_modes": modes, "threshold": config.Threshold, "persistence": config.Persistence})
	})
	active := make(chan struct{}, 8)
	mux.HandleFunc("POST /submit", func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeError(w, 415, "Content-Type must be application/json")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
		decoder := json.NewDecoder(r.Body)
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			decodeError(w, err)
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
		input, err := decodeRequest(raw)
		if err != nil {
			decodeError(w, err)
			return
		}
		mode := input.ModelMode
		if mode == "" {
			mode = config.DefaultMode
		}
		selected := model
		if mode != config.DefaultMode || len(config.Models) > 0 {
			selected = config.Models[mode]
		}
		if selected == nil {
			writeError(w, 400, "selected model mode is unavailable")
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
		result, classificationErr := selected.Classify(request.Context(), request)
		if classificationErr == nil {
			classificationErr = result.Validate()
		}
		if classificationErr != nil {
			result = nil
		}
		metadata := telemetry.SimulationMetadata{Threshold: config.Threshold, Timestamp: security.RequestTimestamp(request), IntendedClassification: input.IntendedClassification, GenerationMode: input.GenerationMode}
		if err := logger.LogSimulation(context.WithoutCancel(r.Context()), request, result, classificationErr, metadata); err != nil {
			slog.Error("Failed to persist simulated request", "error", err)
			writeError(w, 503, "simulation could not be saved")
			return
		}
		if classificationErr != nil {
			slog.Error("Simulation classification failed", "error", classificationErr)
			message := "classification failed; request saved without scores"
			if config.Persistence == "session" {
				message = "classification failed; no database write"
			}
			writeJSON(w, 503, map[string]any{"error": message, "saved": config.Persistence == "mongodb", "classification_error": classificationErr.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"riskiness": result.Risk, "attack_probabilities": result.NamedScores(),
			"remote_addr": request.RemoteAddr, "intended_classification": input.IntendedClassification,
			"threshold": config.Threshold, "blocked": result.Risk >= config.Threshold,
			"accepted": result.Risk < config.Threshold, "simulated": true,
			"model_mode": mode, "model": result.Model, "top_label": result.TopLabel,
			"head_sha256": result.SHA256, "saved": config.Persistence == "mongodb",
		})
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
	if input.GenerationMode != "" && input.GenerationMode != "generated" && input.GenerationMode != "examples" {
		return nil, errors.New("generation_mode must be generated or examples")
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
	// A synthetic request's destination is not the control panel's listening port.
	var destination *net.TCPAddr
	if input.DestinationAddr != "" {
		host, portText, err := net.SplitHostPort(input.DestinationAddr)
		port, portErr := strconv.Atoi(portText)
		ip := net.ParseIP(host)
		if err != nil || portErr != nil || ip == nil || port < 1 || port > 65535 {
			return nil, errors.New("destination_addr must contain an IP and a valid port")
		}
		destination = &net.TCPAddr{IP: ip, Port: port}
	}
	request = request.WithContext(context.WithValue(request.Context(), http.LocalAddrContextKey, destination))
	if input.Protocol != "" {
		major, minor, ok := http.ParseHTTPVersion(input.Protocol)
		if !ok {
			return nil, errors.New("protocol must have the form HTTP/1.1")
		}
		request.Proto, request.ProtoMajor, request.ProtoMinor = input.Protocol, major, minor
	}
	return security.WithRequestTimestamp(request, input.Timestamp), nil
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
