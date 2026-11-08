// Package comparison hosts a local workbench using the production serializer,
// blocking handler, and reverse proxy against a fixed demo backend.
package comparison

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"hackrpi-project/proxy"
	"hackrpi-project/security"
)

//go:embed web/* fixtures.json
var assets embed.FS

const maxBody = 262144

type Case struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Expected []string          `json:"expected"`
	Fields   map[string]string `json:"fields"`
}

type Input struct {
	Case Case `json:"case"`
}

type Lane struct {
	Prediction *security.Prediction `json:"prediction,omitempty"`
	Error      string               `json:"error,omitempty"`
	Decision   string               `json:"decision"`
	HTTPStatus int                  `json:"http_status,omitempty"`
	LatencyMS  int64                `json:"latency_ms"`
	Correct    *bool                `json:"correct,omitempty"`
}

type Result struct {
	Case          Case      `json:"case"`
	TestedAt      time.Time `json:"tested_at"`
	Threshold     float64   `json:"threshold"`
	OriginalText  string    `json:"original_text"`
	ProxyText     string    `json:"proxy_text"`
	Original      Lane      `json:"original"`
	ProxyOriginal Lane      `json:"proxy_original"`
	ProxyTrained  Lane      `json:"proxy_trained"`
}

type Server struct {
	classifier    *security.RemoteClassifier
	classifierURL string
	backend       http.Handler
	threshold     float64
	client        *http.Client
	gate          chan struct{}
}

// New creates an isolated comparison server. It never writes production telemetry.
func New(classifierURL, backendURL string, threshold float64) (*Server, error) {
	if math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 || threshold > 1 {
		return nil, fmt.Errorf("threshold must be in [0,1]")
	}
	classifier, err := security.NewRemoteClassifier(classifierURL, 90*time.Second, maxBody)
	if err != nil {
		return nil, err
	}
	backend, err := proxy.NewReverseProxy(backendURL)
	if err != nil {
		return nil, err
	}
	backend.Transport = &http.Transport{ResponseHeaderTimeout: 10 * time.Second}
	return &Server{classifier: classifier, classifierURL: strings.TrimRight(classifierURL, "/"), backend: backend,
		threshold: threshold, gate: make(chan struct{}, 1),
		client: &http.Client{Timeout: 300 * time.Second, Transport: &http.Transport{DisableCompression: true},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// Handler starts a private loopback replay listener. Each comparison crosses a
// real HTTP connection; both proxy lanes then share that incoming request's text.
func (s *Server) Handler(ctx context.Context) (http.Handler, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	// The private receiver is not published outside this process/container.
	var pending sync.Map
	replay := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		item, ok := pending.LoadAndDelete(r.Header.Get("X-Comparison-Token"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		input := item.(Case)
		r.Header.Del("X-Comparison-Token")
		text, err := security.SerializeRequest(r, maxBody, time.Now().UTC())
		if err != nil {
			send(w, 400, map[string]string{"error": err.Error()})
			return
		}
		result := s.compare(r, input, text)
		send(w, 200, result)
	})}
	go replay.Serve(listener)
	go func() { <-ctx.Done(); replay.Close() }()

	mux := http.NewServeMux()
	web, _ := fs.Sub(assets, "web")
	mux.Handle("GET /", http.FileServer(http.FS(web)))
	mux.HandleFunc("GET /api/cases", func(w http.ResponseWriter, r *http.Request) {
		body, _ := assets.ReadFile("fixtures.json")
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		status, err := s.modelRequest(r.Context(), "GET", "/health")
		if err != nil {
			send(w, 200, map[string]any{"ready": false, "error": err.Error(), "threshold": s.threshold})
			return
		}
		send(w, 200, map[string]any{"ready": true, "classifier": status, "threshold": s.threshold})
	})
	mux.HandleFunc("POST /api/reload-trained", func(w http.ResponseWriter, r *http.Request) {
		select {
		case s.gate <- struct{}{}:
			defer func() { <-s.gate }()
		default:
			send(w, 409, map[string]string{"error": "Wait for the current comparison to finish"})
			return
		}
		result, err := s.modelRequest(r.Context(), "POST", "/reload-trained")
		if err != nil {
			send(w, 409, map[string]string{"error": err.Error()})
			return
		}
		send(w, 200, result)
	})
	mux.HandleFunc("POST /api/compare", func(w http.ResponseWriter, r *http.Request) {
		select {
		case s.gate <- struct{}{}:
			defer func() { <-s.gate }()
		default:
			send(w, 409, map[string]string{"error": "A comparison is already running"})
			return
		}
		var input Input
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		if err := decoder.Decode(&input); err != nil {
			send(w, 400, map[string]string{"error": "Expected a JSON case (maximum 1 MiB)"})
			return
		}
		if err := validate(input.Case); err != nil {
			send(w, 400, map[string]string{"error": err.Error()})
			return
		}
		f := input.Case.Fields
		req, err := http.NewRequestWithContext(r.Context(), f["request_http_method"], "http://"+listener.Addr().String()+f["request_http_request"], strings.NewReader(f["request_body"]))
		if err != nil {
			send(w, 400, map[string]string{"error": err.Error()})
			return
		}
		req.Host = f["request_host"]
		for field, name := range headerFields {
			if value := f[field]; value != "" {
				req.Header.Set(name, value)
			}
		}
		// Empty User-Agent suppresses Go's default, as the field editor promises.
		if f["request_user_agent"] == "" {
			req.Header["User-Agent"] = []string{""}
		}
		token := fmt.Sprintf("%d", time.Now().UnixNano())
		pending.Store(token, input.Case)
		defer pending.Delete(token)
		req.Header.Set("X-Comparison-Token", token)
		resp, err := s.client.Do(req)
		if err != nil {
			send(w, 502, map[string]string{"error": err.Error()})
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, io.LimitReader(resp.Body, 4<<20))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
		// Only same-origin browser writes; request payloads may contain hostile strings.
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Host != r.Host {
				send(w, 403, map[string]string{"error": "Cross-origin requests are disabled"})
				return
			}
		}
		mux.ServeHTTP(w, r)
	}), nil
}

func (s *Server) compare(r *http.Request, c Case, live string) Result {
	result := Result{Case: c, TestedAt: time.Now().UTC(), Threshold: s.threshold, OriginalText: serializeFields(c.Fields), ProxyText: live}
	result.Original = s.score(r.Context(), result.OriginalText, false, c.Expected)
	if result.Original.Prediction != nil {
		if result.Original.Prediction.Risk >= s.threshold {
			result.Original.Decision = "would block"
		} else {
			result.Original.Decision = "would allow"
		}
	}
	result.ProxyOriginal = s.proxyLane(r, live, false, c.Expected)
	result.ProxyTrained = s.proxyLane(r, live, true, c.Expected)
	return result
}

func (s *Server) score(ctx context.Context, text string, trained bool, expected []string) Lane {
	start := time.Now()
	pred, err := s.classifier.ScoreText(ctx, text, trained)
	result := Lane{LatencyMS: time.Since(start).Milliseconds(), Decision: "unavailable"}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Prediction = &pred
	if len(expected) > 0 {
		correct := false
		for _, label := range expected {
			if pred.TopLabel == label {
				correct = true
			}
		}
		result.Correct = &correct
	}
	return result
}

func (s *Server) proxyLane(r *http.Request, text string, trained bool, expected []string) Lane {
	var result Lane
	classify := security.ClassifierFunc(func(ctx context.Context, _ *http.Request) (*security.Prediction, error) {
		result = s.score(ctx, text, trained, expected)
		if result.Prediction == nil {
			return nil, fmt.Errorf("%s", result.Error)
		}
		return result.Prediction, nil
	})
	handler, _ := proxy.NewHandler(s.backend, classify, noTelemetry{}, s.threshold)
	// Clone the captured incoming request and restore an independent body for each
	// lane. Neither lane can consume the other lane's body or change its headers.
	copy := r.Clone(r.Context())
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	copy.Body = io.NopCloser(bytes.NewReader(body))
	out := &captureWriter{header: make(http.Header)}
	handler.ServeHTTP(out, copy)
	result.HTTPStatus = out.status
	if result.Prediction != nil {
		if result.Prediction.Risk >= s.threshold {
			result.Decision = "blocked"
		} else {
			result.Decision = "forwarded"
		}
	}
	return result
}

type noTelemetry struct{}

func (noTelemetry) LogRequest(context.Context, *http.Request, *security.Prediction, error) error {
	return nil
}

type captureWriter struct {
	header http.Header
	status int
}

func (w *captureWriter) Header() http.Header { return w.header }
func (w *captureWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *captureWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return len(body), nil
}

func (s *Server) modelRequest(ctx context.Context, method, path string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, method, s.classifierURL+path, nil)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%v", result["error"])
	}
	return result, nil
}

func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

var headerFields = map[string]string{
	"request_user_agent": "User-Agent", "request_referer": "Referer", "request_origin": "Origin", "request_cookie": "Cookie",
	"request_content_type": "Content-Type", "request_accept": "Accept", "request_accept_language": "Accept-Language",
	"request_accept_encoding": "Accept-Encoding", "request_do_not_track": "DNT", "request_connection": "Connection",
}

// Field order is the author's 20-field training contract, matching SerializeRequest.
var fields = [][2]string{
	{"timestamp", "timestamp"}, {"src_ip", "src-ip"}, {"src_port", "src-port"}, {"dst_ip", "dst-ip"}, {"dst_port", "dst-port"},
	{"request_http_method", "method"}, {"request_http_request", "path"}, {"request_http_protocol", "protocol"},
	{"request_user_agent", "user-agent"}, {"request_referer", "referer"}, {"request_host", "host"}, {"request_origin", "origin"},
	{"request_cookie", "cookie"}, {"request_content_type", "content-type"}, {"request_accept", "accept"},
	{"request_accept_language", "accept-language"}, {"request_accept_encoding", "accept-encoding"},
	{"request_do_not_track", "do-not-track"}, {"request_connection", "connection"}, {"request_body", "body"},
}

func serializeFields(f map[string]string) string {
	var lines []string
	for _, pair := range fields {
		if value := f[pair[0]]; value != "" {
			lines = append(lines, pair[1]+": "+value)
		}
	}
	return strings.Join(lines, "\n")
}

func validate(c Case) error {
	f := c.Fields
	method := f["request_http_method"]
	if method == "" || strings.ContainsAny(method, " \t\r\n") {
		return fmt.Errorf("Enter a valid HTTP method")
	}
	path := f["request_http_request"]
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.ContainsAny(path, "\r\n#") {
		return fmt.Errorf("Path must start with / and contain no fragment or newlines")
	}
	if _, err := url.ParseRequestURI(path); err != nil {
		return fmt.Errorf("Invalid request path: %w", err)
	}
	if len(f["request_body"]) > maxBody {
		return fmt.Errorf("Body must be at most 256 KiB for a full-input comparison")
	}
	for field, name := range headerFields {
		if strings.ContainsAny(f[field], "\r\n") {
			return fmt.Errorf("%s cannot contain newlines", name)
		}
	}
	if f["request_host"] == "" || strings.ContainsAny(f["request_host"], " /\t\r\n") {
		return fmt.Errorf("Enter a valid Host header")
	}
	return nil
}
