package security

import (
	"context"
	"net/http"
	"time"
)

type timestampKey struct{}
type thresholdKey struct{}

// WithRequestTimestamp captures arrival time once for model input and telemetry.
// It preserves the real year and never changes headers, target, or body.
func WithRequestTimestamp(r *http.Request, timestamp time.Time) *http.Request {
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}
	return r.WithContext(context.WithValue(r.Context(), timestampKey{}, timestamp))
}

func RequestTimestamp(r *http.Request) time.Time {
	if stamp, ok := r.Context().Value(timestampKey{}).(time.Time); ok && !stamp.IsZero() {
		return stamp
	}
	return time.Now().UTC()
}

// WithRequestThreshold annotates telemetry; it is not serialized into model input.
func WithRequestThreshold(r *http.Request, threshold float64) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), thresholdKey{}, threshold))
}

func RequestThreshold(r *http.Request) (float64, bool) {
	v, ok := r.Context().Value(thresholdKey{}).(float64)
	return v, ok
}
