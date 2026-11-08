package security

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRemoteClassifierUsesHighestAttackScore(t *testing.T) {
	var gotText string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"status":   "ok",
				"model":    "valendra/threat-classifier-13082026",
				"backbone": "google/embeddinggemma-300m",
			})
		case "/classify":
			var payload struct {
				Text string `json:"text"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode request: %v", err)
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			gotText = payload.Text
			labels := make(map[string]float64, len(classLabels))
			for _, label := range classLabels {
				labels[label] = 0
			}
			labels["000 - Normal"] = 0.25
			labels["66 - SQL Injection"] = 0.75
			labels["extra"] = 1
			_ = json.NewEncoder(w).Encode(map[string]any{"labels": labels})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	classifier, err := NewRemoteClassifier(server.URL, time.Second, 256)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := classifier.CheckReady(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ready.Model != "valendra/threat-classifier-13082026" || ready.Backbone != "google/embeddinggemma-300m" {
		t.Fatalf("unexpected ready status: %+v", ready)
	}

	r := httptest.NewRequest(http.MethodGet, "http://example.test/search?q=<script>", nil)
	r.RequestURI = "/search?q=<script>"
	risk, err := classifier.Classify(r.Context(), r)
	if err != nil {
		t.Fatal(err)
	}
	if risk == nil || risk.Risk != 0.75 {
		t.Fatalf("risk = %v", risk)
	}
	if !strings.Contains(gotText, "path: /search?q=<script>") {
		t.Fatalf("classifier received escaped or incomplete text: %s", gotText)
	}
}

func TestRemoteClassifierPreservesBodyWhenScoringFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "model offline", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	classifier, err := NewRemoteClassifier(server.URL, time.Second, 256)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "http://example.test/login", strings.NewReader("password=secret"))
	_, err = classifier.Classify(r.Context(), r)
	if err == nil {
		t.Fatal("expected classifier error")
	}
	body, readErr := io.ReadAll(r.Body)
	if readErr != nil || string(body) != "password=secret" {
		t.Fatalf("body = %q, %v", body, readErr)
	}
}

func TestRiskFromLabelsRejectsIncompleteScores(t *testing.T) {
	labels := map[string]float64{}
	for _, label := range classLabels {
		labels[label] = 0
	}
	delete(labels, "66 - SQL Injection")
	if _, _, err := riskFromLabels(labels); err == nil {
		t.Fatal("accepted a response missing a class")
	}
	labels["66 - SQL Injection"] = 1.2
	if _, _, err := riskFromLabels(labels); err == nil {
		t.Fatal("accepted a score above 1")
	}
}

func TestNewRemoteClassifierRejectsBadConfiguration(t *testing.T) {
	if _, err := NewRemoteClassifier("classifier:8000", time.Second, 256); err == nil {
		t.Fatal("accepted a relative URL")
	}
	if _, err := NewRemoteClassifier("http://classifier:8000", 0, 256); err == nil {
		t.Fatal("accepted a non-positive timeout")
	}
	if _, err := NewRemoteClassifier("http://classifier:8000", time.Second, 0); err == nil {
		t.Fatal("accepted a non-positive body limit")
	}
}

func TestClassifyHonorsCanceledContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	classifier, err := NewRemoteClassifier(server.URL, time.Second, 32)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := httptest.NewRequest(http.MethodGet, "http://example.test/", nil).WithContext(ctx)
	if _, err := classifier.Classify(r.Context(), r); err == nil {
		t.Fatal("accepted a canceled context")
	}
}
