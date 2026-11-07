package embeddings

import (
	"context"
	"net/http"
	"time"
)

// TrainingYear is the calendar year expected by the model's timestamp feature.
const TrainingYear = 2020

type requestTimestampKey struct{}

// WithRequestTimestamp attaches the original request time without changing its
// headers or body. A missing timestamp defaults to the current UTC time.
func WithRequestTimestamp(r *http.Request, timestamp time.Time) *http.Request {
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}
	return r.WithContext(context.WithValue(r.Context(), requestTimestampKey{}, timestamp))
}

// RequestTimestamp returns the original timestamp for telemetry. Requests that
// have not passed through an endpoint default to the current UTC time.
func RequestTimestamp(r *http.Request) time.Time {
	if timestamp, ok := r.Context().Value(requestTimestampKey{}).(time.Time); ok && !timestamp.IsZero() {
		return timestamp
	}
	return time.Now().UTC()
}

// NormalizeTimestamp changes only the calendar year for model input, retaining
// month, day, clock time, nanoseconds, and UTC offset. 2020 is a leap year, so
// every valid input date, including February 29, can be represented unchanged.
func NormalizeTimestamp(timestamp time.Time) time.Time {
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}
	name, offset := timestamp.Zone()
	return time.Date(TrainingYear, timestamp.Month(), timestamp.Day(),
		timestamp.Hour(), timestamp.Minute(), timestamp.Second(), timestamp.Nanosecond(),
		time.FixedZone(name, offset))
}
