package proxy

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net/http"

	"hackrpi-project/classifier"
)

// THRESHOLD is the riskiness at or above which requests are blocked. It is a
// temporary fixed policy until threshold configuration is exposed in the frontend.
const THRESHOLD = 0.5

// RequestLogger persists an incoming request and its predicted probability of
// being malicious. Implementations must support concurrent calls and preserve
// the request for forwarding.
type RequestLogger interface {
	LogRequest(context.Context, *http.Request, *classifier.Result, error) error
}

// Handler coordinates classification, telemetry, and forwarding in that order.
// A score at or above the threshold is blocked after being logged. Logging
// failures do not alter the classification decision. Classifier failures and
// invalid scores are recorded as classification failures and return 503 without
// forwarding. Failure records omit prediction scores.
type Handler struct {
	next       http.Handler
	classifier classifier.Classifier
	logger     RequestLogger
	threshold  float64
}

// NewHandler creates a handler with a blocking threshold in [0, 1]. All
// dependencies must be non-nil. The next handler is normally a reverse proxy.
func NewHandler(next http.Handler, classifier classifier.Classifier, logger RequestLogger, threshold float64) (*Handler, error) {
	if next == nil || classifier == nil || logger == nil {
		return nil, fmt.Errorf("proxy, classifier, and request logger are required")
	}
	if !validRiskiness(threshold) {
		return nil, fmt.Errorf("risk threshold must be a finite probability between 0 and 1")
	}
	return &Handler{next: next, classifier: classifier, logger: logger, threshold: threshold}, nil
}

// ServeHTTP classifies the original incoming request, records its riskiness,
// then either returns 403 or forwards it. A failed prediction returns 503.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	result, classificationErr := h.classifier.Classify(r.Context(), r)
	if classificationErr == nil {
		classificationErr = result.Validate()
	}
	if classificationErr != nil {
		result = nil
	}
	// A client disconnect must not cancel telemetry after classification finishes.
	// The logger applies its own bounded write timeout.
	if err := h.logger.LogRequest(context.WithoutCancel(r.Context()), r, result, classificationErr); err != nil {
		slog.Error("Failed to log request telemetry", "error", err)
	}
	if classificationErr != nil {
		slog.Error("Request classification failed", "error", classificationErr)
		http.Error(w, "Request classification unavailable", http.StatusServiceUnavailable)
		return
	}
	if result.Riskiness >= h.threshold {
		http.Error(w, "Request blocked", http.StatusForbidden)
		return
	}
	h.next.ServeHTTP(w, r)
}

func validRiskiness(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}
