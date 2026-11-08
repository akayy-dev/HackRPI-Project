package comparison

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestComparisonUsesPairedLiveInputsAndRealProxyDecisions(t *testing.T) {
	var mu sync.Mutex
	var inputs []struct{ route, text string }
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Text string `json:"text"`
		}
		json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		inputs = append(inputs, struct{ route, text string }{r.URL.Path, payload.Text})
		mu.Unlock()
		labels := map[string]float64{}
		// Supply all labels required by the classifier response contract.
		for _, name := range []string{"000 - Normal", "272 - Protocol Manipulation", "242 - Code Injection", "88 - OS Command Injection", "126 - Path Traversal", "66 - SQL Injection", "16 - Dictionary-based Password Attack", "310 - Scanning for Vulnerable Software", "153 - Input Data Manipulation", "248 - Command Injection", "274 - HTTP Verb Tampering", "194 - Fake the Source of Data", "34 - HTTP Response Splitting", "33 - HTTP Request Smuggling"} {
			labels[name] = 0.01
		}
		labels["000 - Normal"] = 0.9
		if r.URL.Path == "/classify-trained" {
			labels["66 - SQL Injection"] = 0.95
		}
		// Deliberately false reductions must be recomputed from label scores.
		json.NewEncoder(w).Encode(map[string]any{"labels": labels, "risk": 0.99, "top_label": "wrong", "model": "test"})
	}))
	defer model.Close()
	var forwarded int
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded++
		if r.RequestURI != "/search?q=%27%2f..%2F" {
			t.Errorf("encoded target changed: %s", r.RequestURI)
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != "x=%60sleep+15%60" {
			t.Errorf("body changed: %s", body)
		}
		if r.Header.Get("X-Forwarded-Host") != "test-site.com" {
			t.Errorf("original host was not forwarded: %s", r.Header.Get("X-Forwarded-Host"))
		}
		w.WriteHeader(201)
	}))
	defer backend.Close()
	lab, err := New(model.URL, backend.URL, 0.5)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler, err := lab.Handler(ctx)
	if err != nil {
		t.Fatal(err)
	}
	test := Case{Name: "Encoded POST", Expected: []string{"66 - SQL Injection"}, Fields: map[string]string{
		"timestamp": "17/Jul/2020:12:23:34 +0100", "src_ip": "172.26.0.1", "src_port": "55894", "dst_ip": "172.26.0.4", "dst_port": "80",
		"request_http_method": "POST", "request_http_request": "/search?q=%27%2f..%2F", "request_http_protocol": "HTTP/1.1", "request_host": "test-site.com", "request_accept": "*/*", "request_body": "x=%60sleep+15%60",
	}}
	body, _ := json.Marshal(Input{Case: test})
	request := httptest.NewRequest("POST", "http://localhost/api/compare", bytes.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("HTTP %d: %s", response.Code, response.Body)
	}
	var result Result
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Original.Prediction == nil || result.ProxyOriginal.Prediction == nil || result.ProxyTrained.Prediction == nil {
		t.Fatalf("missing prediction: %+v", result)
	}
	if result.ProxyOriginal.HTTPStatus != 201 || result.ProxyOriginal.Decision != "forwarded" || result.ProxyOriginal.Prediction.Risk != 0.01 {
		t.Errorf("original lane: %+v", result.ProxyOriginal)
	}
	if result.ProxyTrained.HTTPStatus != 403 || result.ProxyTrained.Decision != "blocked" {
		t.Errorf("trained lane: %+v", result.ProxyTrained)
	}
	if forwarded != 1 {
		t.Errorf("backend received %d requests, want one", forwarded)
	}
	if result.Original.Correct == nil || *result.Original.Correct || result.ProxyTrained.Correct == nil || !*result.ProxyTrained.Correct {
		t.Error("expected label comparison incorrect")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(inputs) != 3 {
		t.Fatalf("got %d model calls", len(inputs))
	}
	if inputs[0].text != result.OriginalText {
		t.Error("original fixture text changed")
	}
	if inputs[1].text != inputs[2].text || inputs[1].text != result.ProxyText {
		t.Error("proxy lanes received different inputs")
	}
	if !strings.Contains(inputs[0].text, "timestamp: 17/Jul/2020") || strings.Contains(inputs[1].text, "timestamp: 17/Jul/2020") {
		t.Error("proxy did not use live timestamp")
	}
	if !strings.Contains(inputs[1].text, time.Now().UTC().Format("02/Jan/2006")) {
		t.Error("missing current date")
	}
	if inputs[0].route != "/classify" || inputs[1].route != "/classify" || inputs[2].route != "/classify-trained" {
		t.Error("incorrect head routing")
	}
}

func TestInvalidRequestsCannotChooseBackendOrInjectHeaders(t *testing.T) {
	base := func() Case {
		return Case{Fields: map[string]string{"request_http_method": "GET", "request_http_request": "/", "request_host": "test-site.com"}}
	}
	for _, change := range []func(map[string]string){
		func(f map[string]string) { f["request_http_request"] = "http://external.test/" },
		func(f map[string]string) { f["request_http_request"] = "//external.test/" },
		func(f map[string]string) { f["request_user_agent"] = "hi\r\nX-Injected: yes" },
		func(f map[string]string) { f["request_body"] = strings.Repeat("a", maxBody+1) },
	} {
		c := base()
		change(c.Fields)
		if validate(c) == nil {
			t.Error("invalid case accepted")
		}
	}
}

func TestUnavailableHeadIsNeverReportedAsAllowed(t *testing.T) {
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "not loaded", 503) }))
	defer model.Close()
	lab, _ := New(model.URL, "http://127.0.0.1:1", 0.5)
	req := httptest.NewRequest("GET", "http://test-site.com/", nil)
	result := lab.proxyLane(req, "method: GET\npath: /", true, nil)
	if result.Prediction != nil || result.Decision != "unavailable" || result.HTTPStatus != 503 || result.Error == "" {
		t.Errorf("unavailable prediction: %+v", result)
	}
}
