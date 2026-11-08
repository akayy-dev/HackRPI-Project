package proxy

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"hackrpi-project/security"
)

type loggerFunc func(context.Context, *http.Request, *security.Prediction, error) error

func (f loggerFunc) LogRequest(ctx context.Context, r *http.Request, result *security.Prediction, classificationErr error) error {
	return f(ctx, r, result, classificationErr)
}

func TestHandlerClassificationLoggingAndDecision(t *testing.T) {
	for _, tc := range []struct {
		name                string
		riskiness           float64
		classificationError error
		loggingError        error
		status              int
		order               []string
	}{
		{name: "allowed", riskiness: 0.1, status: 204, order: []string{"classify", "log", "forward"}},
		{name: "blocked", riskiness: 0.9, status: 403, order: []string{"classify", "log"}},
		{name: "threshold boundary", riskiness: 0.5, status: 403, order: []string{"classify", "log"}},
		{name: "logging fails for allowed request", riskiness: 0.1, loggingError: errors.New("database unavailable"), status: 204, order: []string{"classify", "log", "forward"}},
		{name: "logging fails for blocked request", riskiness: 0.9, loggingError: errors.New("database unavailable"), status: 403, order: []string{"classify", "log"}},
		{name: "classifier unavailable", classificationError: errors.New("classifier unavailable"), status: 503, order: []string{"classify", "log"}},
		{name: "negative probability", riskiness: -0.1, status: 503, order: []string{"classify", "log"}},
		{name: "probability above one", riskiness: 1.1, status: 503, order: []string{"classify", "log"}},
		{name: "NaN", riskiness: math.NaN(), status: 503, order: []string{"classify", "log"}},
		{name: "infinite probability", riskiness: math.Inf(1), status: 503, order: []string{"classify", "log"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var order []string
			r := httptest.NewRequest(http.MethodGet, "http://example.test/original", nil)
			result := testPrediction(tc.riskiness)
			var classifiedRequest *http.Request
			requestClassifier := security.ClassifierFunc(func(ctx context.Context, req *http.Request) (*security.Prediction, error) {
				order = append(order, "classify")
				classifiedRequest = req
				if req.URL != r.URL || ctx != req.Context() {
					t.Fatal("classifier did not receive the incoming request context")
				}
				text, err := security.SerializeRequest(req, 262144, security.RequestTimestamp(req))
				if err != nil || !strings.Contains(strings.Split(text, "\n")[0], "/"+time.Now().UTC().Format("2006")+":") {
					t.Fatalf("real request model timestamp was changed: %s, %v", text, err)
				}
				if security.RequestTimestamp(req).Year() != time.Now().UTC().Year() {
					t.Fatal("original arrival time was not preserved")
				}
				return result, tc.classificationError
			})
			logger := loggerFunc(func(_ context.Context, req *http.Request, got *security.Prediction, classificationErr error) error {
				order = append(order, "log")
				if req != classifiedRequest {
					t.Fatal("logger did not receive request and classification score")
				}
				if tc.status == 503 {
					if got != nil || classificationErr == nil {
						t.Fatal("failed classification was not logged correctly")
					}
				} else if got != result || classificationErr != nil {
					t.Fatal("classification result was not passed intact to telemetry")
				}
				return tc.loggingError
			})
			next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				order = append(order, "forward")
				w.WriteHeader(http.StatusNoContent)
			})
			h, err := NewHandler(next, requestClassifier, logger, THRESHOLD)
			if err != nil {
				t.Fatal(err)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status || !reflect.DeepEqual(order, tc.order) {
				t.Fatalf("status=%d order=%v; want status=%d order=%v", w.Code, order, tc.status, tc.order)
			}
		})
	}
}

func TestNewHandlerRejectsInvalidConfiguration(t *testing.T) {
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	requestClassifier := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) { return nil, nil })
	logger := loggerFunc(func(context.Context, *http.Request, *security.Prediction, error) error { return nil })
	for _, threshold := range []float64{-0.1, 1.1, math.NaN(), math.Inf(1)} {
		if _, err := NewHandler(next, requestClassifier, logger, threshold); err == nil {
			t.Errorf("accepted threshold %v", threshold)
		}
	}
	if _, err := NewHandler(nil, requestClassifier, logger, THRESHOLD); err == nil {
		t.Error("accepted nil proxy")
	}
	if _, err := NewHandler(next, nil, logger, THRESHOLD); err == nil {
		t.Error("accepted nil classifier")
	}
	if _, err := NewHandler(next, requestClassifier, nil, THRESHOLD); err == nil {
		t.Error("accepted nil logger")
	}
}

func testPrediction(risk float64) *security.Prediction {
	labels := map[string]float64{}
	for _, name := range security.Labels() {
		labels[name] = 0
	}
	labels["000 - Normal"] = 0.9
	labels["66 - SQL Injection"] = risk
	return &security.Prediction{Risk: risk, Labels: labels}
}

func TestDisconnectDoesNotCancelTelemetry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := httptest.NewRequest("GET", "/", nil).WithContext(ctx)
	model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) {
		return nil, errors.New("client disconnected")
	})
	logged := false
	logger := loggerFunc(func(ctx context.Context, _ *http.Request, p *security.Prediction, err error) error {
		logged = true
		if ctx.Err() != nil || p != nil || err == nil {
			t.Error("failed classification telemetry was canceled or fabricated")
		}
		return nil
	})
	h, _ := NewHandler(http.NotFoundHandler(), model, logger, 0.5)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !logged || w.Code != 503 {
		t.Fatal("failure was not logged before returning 503")
	}
}
