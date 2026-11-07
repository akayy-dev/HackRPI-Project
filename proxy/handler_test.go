package proxy

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"hackrpi-project/security"
)

type loggerFunc func(context.Context, *http.Request, float64) error

func (f loggerFunc) LogRequest(ctx context.Context, r *http.Request, riskiness float64) error {
	return f(ctx, r, riskiness)
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
		{name: "classifier unavailable", classificationError: security.ErrClassifierUnavailable, status: 503, order: []string{"classify"}},
		{name: "negative probability", riskiness: -0.1, status: 503, order: []string{"classify"}},
		{name: "probability above one", riskiness: 1.1, status: 503, order: []string{"classify"}},
		{name: "NaN", riskiness: math.NaN(), status: 503, order: []string{"classify"}},
		{name: "infinite probability", riskiness: math.Inf(1), status: 503, order: []string{"classify"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var order []string
			r := httptest.NewRequest(http.MethodGet, "http://example.test/original", nil)
			classifier := security.ClassifierFunc(func(ctx context.Context, req *http.Request) (float64, error) {
				order = append(order, "classify")
				if req != r || ctx != r.Context() {
					t.Fatal("classifier did not receive the incoming request context")
				}
				return tc.riskiness, tc.classificationError
			})
			logger := loggerFunc(func(_ context.Context, req *http.Request, riskiness float64) error {
				order = append(order, "log")
				if req != r || riskiness != tc.riskiness {
					t.Fatal("logger did not receive request and classification score")
				}
				return tc.loggingError
			})
			next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				order = append(order, "forward")
				w.WriteHeader(http.StatusNoContent)
			})
			h, err := NewHandler(next, classifier, logger, 0.5)
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
	classifier := security.ClassifierFunc(func(context.Context, *http.Request) (float64, error) { return 0, nil })
	logger := loggerFunc(func(context.Context, *http.Request, float64) error { return nil })
	for _, threshold := range []float64{-0.1, 1.1, math.NaN(), math.Inf(1)} {
		if _, err := NewHandler(next, classifier, logger, threshold); err == nil {
			t.Errorf("accepted threshold %v", threshold)
		}
	}
	if _, err := NewHandler(nil, classifier, logger, 0.5); err == nil {
		t.Error("accepted nil proxy")
	}
	if _, err := NewHandler(next, nil, logger, 0.5); err == nil {
		t.Error("accepted nil classifier")
	}
	if _, err := NewHandler(next, classifier, nil, 0.5); err == nil {
		t.Error("accepted nil logger")
	}
}
