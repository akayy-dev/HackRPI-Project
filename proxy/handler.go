package proxy

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net/http"

	"hackrpi-project/security"
)

// RequestLogger persists an incoming request and its predicted probability of
// being malicious. Implementations must support concurrent calls and preserve
// the request for forwarding.
type RequestLogger interface {
	LogRequest(context.Context, *http.Request, float64) error
}

// Handler coordinates classification, telemetry, and forwarding in that order.
// A score at or above the threshold is blocked after being logged. Logging
// failures do not alter the classification decision. Classifier failures and
// invalid scores return 503 without forwarding or recording a successful score;
// these failures are reported through slog instead.
type Handler struct {
	next       http.Handler
	classifier security.Classifier
	logger     RequestLogger
	threshold  float64
}

// NewHandler creates a handler with a blocking threshold in [0, 1]. All
// dependencies must be non-nil. The next handler is normally a reverse proxy.
func NewHandler(next http.Handler, classifier security.Classifier, logger RequestLogger, threshold float64) (*Handler, error) {
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
	riskiness, err := h.classifier.Classify(r.Context(), r)
	if err != nil || !validRiskiness(riskiness) {
		slog.Error("Request classification failed", "error", err, "riskiness", riskiness)
		http.Error(w, "Request classification unavailable", http.StatusServiceUnavailable)
		return
	}
	if err := h.logger.LogRequest(r.Context(), r, riskiness); err != nil {
		slog.Error("Failed to log request telemetry", "error", err)
	}
	if riskiness >= h.threshold {
		http.Error(w, "Request blocked", http.StatusForbidden)
		return
	}
	h.next.ServeHTTP(w, r)
}

func validRiskiness(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}
