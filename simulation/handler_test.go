package simulation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hackrpi-project/proxy"
	"hackrpi-project/security"
	"hackrpi-project/telemetry"
)

type fakeLogger struct {
	result            *security.Prediction
	request           *http.Request
	metadata          telemetry.SimulationMetadata
	classificationErr error
	err               error
	calls             int
}

func (l *fakeLogger) LogSimulation(_ context.Context, request *http.Request, result *security.Prediction, classificationErr error, metadata telemetry.SimulationMetadata) error {
	l.request, l.result, l.classificationErr, l.metadata = request, result, classificationErr, metadata
	l.calls++
	return l.err
}

const validInput = `{"timestamp":"2026-11-07T12:00:00Z","method":"POST","url":"/login","host":"app.example.test","remote_addr":"45.79.23.14:51000","protocol":"HTTP/1.1","headers":{"Content-Type":["application/x-www-form-urlencoded"]},"body":"username=admin&password=guess","intended_classification":"dictionary_password_attack","generation_mode":"generated"}`

func TestSubmitClassifiesTelemetryAndPersists(t *testing.T) {
	for _, risk := range []float64{0.1, 0.5, 0.9} {
		logger := &fakeLogger{}
		model := security.ClassifierFunc(func(_ context.Context, r *http.Request) (*security.Prediction, error) {
			if r.URL.String() != "/login" || r.Method != "POST" || r.RemoteAddr != "45.79.23.14:51000" || r.Host != "app.example.test" {
				t.Fatalf("classifier received submission envelope instead of simulated request: %+v", r)
			}
			text, err := security.SerializeRequest(r, 262144, security.RequestTimestamp(r))
			if err != nil || !strings.HasPrefix(text, "timestamp: 07/Nov/2026:12:00:00 +0000\n") {
				t.Fatalf("actual simulation timestamp changed before model selection: %s, %v", text, err)
			}
			if strings.Contains(text, "dictionary_password_attack") || strings.Contains(text, "generated") {
				t.Fatal("test labels or generation mode leaked into model input")
			}
			body, err := io.ReadAll(r.Body)
			if err != nil || string(body) != "username=admin&password=guess" {
				t.Fatalf("incorrect model body: %q, %v", body, err)
			}
			if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Fatal("simulated headers were lost")
			}
			return prediction(risk), nil
		})
		h, err := NewHandler(model, logger)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader(validInput))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 201 || logger.calls != 1 {
			t.Fatalf("status=%d logs=%d body=%s", w.Code, logger.calls, w.Body)
		}
		var response struct {
			Riskiness float64
			Blocked   bool
			Accepted  bool
			Simulated bool
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Riskiness != risk || response.Blocked != (risk >= proxy.THRESHOLD) || response.Accepted == response.Blocked || !response.Simulated {
			t.Fatalf("incorrect evaluation: %+v", response)
		}
		if logger.result.Risk != risk || logger.metadata.Threshold != proxy.THRESHOLD || logger.metadata.IntendedClassification != "dictionary_password_attack" || logger.metadata.Timestamp.Year() != 2026 || logger.metadata.GenerationMode != "generated" {
			t.Fatal("classification or submitted metadata was not saved")
		}
	}
}

func TestSubmitRejectsInvalidInputsWithoutClassification(t *testing.T) {
	for _, tc := range []struct {
		name, method, body, contentType string
		status                          int
	}{
		{"method", "GET", validInput, "application/json", 404},
		{"content type", "POST", validInput, "text/plain", 415},
		{"invalid JSON", "POST", `{`, "application/json", 400},
		{"null", "POST", `null`, "application/json", 400},
		{"probabilities", "POST", `{"normal":0.5}`, "application/json", 400},
		{"caller score", "POST", `{"risk":0.9}`, "application/json", 400},
		{"missing fields", "POST", `{"method":"GET"}`, "application/json", 400},
		{"invalid IP", "POST", strings.Replace(validInput, "45.79.23.14:51000", "not-an-ip", 1), "application/json", 400},
		{"invalid port", "POST", strings.Replace(validInput, "45.79.23.14:51000", "45.79.23.14:99999", 1), "application/json", 400},
		{"invalid URL", "POST", strings.Replace(validInput, "/login", "file:///etc/passwd", 1), "application/json", 400},
		{"invalid generation mode", "POST", strings.Replace(validInput, `"generation_mode":"generated"`, `"generation_mode":"unknown"`, 1), "application/json", 400},
		{"multiple objects", "POST", validInput + ` {}`, "application/json", 400},
		{"oversized", "POST", validInput + strings.Repeat(" ", 129<<10), "application/json", 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger := &fakeLogger{}
			model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) {
				t.Fatal("invalid input reached classifier")
				return nil, nil
			})
			h, err := NewHandler(model, logger)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(tc.method, "/submit", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.contentType)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status || logger.calls != 0 {
				t.Fatalf("status=%d logs=%d body=%s", w.Code, logger.calls, w.Body)
			}
		})
	}
}

func TestClassificationFailureIsSavedWithoutDecision(t *testing.T) {
	logger := &fakeLogger{}
	model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) {
		return nil, errors.New("model unavailable")
	})
	h, err := NewHandler(model, logger)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/submit", strings.NewReader(validInput))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 || logger.calls != 1 || logger.result != nil || logger.classificationErr == nil {
		t.Fatalf("failure not persisted: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), `"blocked"`) {
		t.Fatal("failed classification was presented as a decision")
	}
}

func TestDatabaseFailureDoesNotReportSuccessfulEvaluation(t *testing.T) {
	logger := &fakeLogger{err: errors.New("database unavailable")}
	model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) {
		return prediction(0.1), nil
	})
	h, err := NewHandler(model, logger)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/submit", strings.NewReader(validInput))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestControlPanelAssets(t *testing.T) {
	model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) { return nil, nil })
	h, err := NewHandler(model, &fakeLogger{})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/app.js", "/generator.js", "/style.css", "/training-examples.js", "/holdout.json"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || w.Body.Len() == 0 {
			t.Fatalf("asset %s unavailable: %d", path, w.Code)
		}
	}
}

func TestReconstructsIPv6AndCaseInsensitiveHeaders(t *testing.T) {
	input := Request{Method: "GET", URL: "/", RemoteAddr: "2001:4860:4860::8888", Headers: http.Header{"user-agent": {"Test Agent"}}}
	r, err := input.HTTPRequest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if r.RemoteAddr != "[2001:4860:4860::8888]:54321" || r.UserAgent() != "Test Agent" {
		t.Fatalf("incorrect reconstructed request: %+v", r)
	}
}

func prediction(risk float64) *security.Prediction {
	labels := map[string]float64{}
	for _, label := range security.Labels() {
		labels[label] = 0
	}
	labels["000 - Normal"] = 1 - risk
	labels["66 - SQL Injection"] = risk
	return &security.Prediction{Risk: risk, Labels: labels}
}
