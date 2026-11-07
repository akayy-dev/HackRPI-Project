package simulation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hackrpi-project/classifier"
	"hackrpi-project/proxy"
)

type fakeLogger struct {
	result    *classifier.Result
	threshold float64
	err       error
	calls     int
}

func (l *fakeLogger) LogSimulation(_ context.Context, _ *http.Request, result *classifier.Result, threshold float64) error {
	l.result, l.threshold = result, threshold
	l.calls++
	return l.err
}

func TestSubmitEvaluatesAndPersists(t *testing.T) {
	for _, tc := range []struct {
		name    string
		normal  float64
		blocked bool
	}{
		{"allowed", 0.9, false}, {"blocked", 0.1, true}, {"boundary", 0.5, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger := &fakeLogger{}
			h, err := NewHandler(logger)
			if err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(classifier.AttackProbabilities{Normal: tc.normal, SQLInjection: 0.75})
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader(string(body)))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusCreated || logger.calls != 1 {
				t.Fatalf("status=%d logs=%d body=%s", w.Code, logger.calls, w.Body)
			}
			var response struct {
				Riskiness float64
				Blocked   bool
				Threshold float64
				Simulated bool
				Attacks   classifier.AttackProbabilities `json:"attack_probabilities"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Riskiness != 1-tc.normal || response.Blocked != tc.blocked || response.Threshold != proxy.THRESHOLD || !response.Simulated {
				t.Fatalf("incorrect evaluation: %+v", response)
			}
			if response.Attacks.SQLInjection != 0.75 || logger.result.AttackProbabilities != response.Attacks || logger.threshold != response.Threshold {
				t.Fatal("persisted evaluation differs from response")
			}
		})
	}
}

func TestSubmitRejectsInvalidInputsWithoutPersistence(t *testing.T) {
	for _, tc := range []struct {
		name, method, body, contentType string
		status                          int
	}{
		{"method", "GET", `{"normal":0.9}`, "application/json", 405},
		{"content type", "POST", `{"normal":0.9}`, "text/plain", 415},
		{"invalid JSON", "POST", `{`, "application/json", 400},
		{"missing normal", "POST", `{"sql_injection":0.5}`, "application/json", 400},
		{"null normal", "POST", `{"normal":null}`, "application/json", 400},
		{"null attack", "POST", `{"normal":0.5,"sql_injection":null}`, "application/json", 400},
		{"negative", "POST", `{"normal":-0.1}`, "application/json", 400},
		{"attack over one", "POST", `{"normal":0.9,"sql_injection":2}`, "application/json", 400},
		{"unknown field", "POST", `{"normal":0.9,"unknown":0.1}`, "application/json", 400},
		{"multiple values", "POST", `{"normal":0.9} {}`, "application/json", 400},
		{"oversized", "POST", `{"normal":0.9}` + strings.Repeat(" ", 17<<10), "application/json", 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger := &fakeLogger{}
			h, err := NewHandler(logger)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(tc.method, "/submit", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.contentType)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status || logger.calls != 0 {
				t.Fatalf("status=%d, logs=%d, body=%s", w.Code, logger.calls, w.Body)
			}
		})
	}
}

func TestSubmitReportsDatabaseFailure(t *testing.T) {
	h, err := NewHandler(&fakeLogger{err: errors.New("database unavailable")})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader(`{"normal":0.9}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want 503", w.Code)
	}
}
