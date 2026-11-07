// Package security defines the request classification contract for the ML model.
package security

import (
	"context"
	"errors"
	"net/http"
)

// ErrClassifierUnavailable indicates that no model is configured or available.
var ErrClassifierUnavailable = errors.New("request classifier is unavailable")

// Classifier estimates the probability that an incoming request is malicious.
// Classify must return a finite value between zero and one, or an error if no
// reliable prediction is available. Implementations must support concurrent
// calls, honor cancellation, and preserve the request (including its body) so
// allowed requests can subsequently be forwarded intact.
type Classifier interface {
	Classify(context.Context, *http.Request) (float64, error)
}

// ClassifierFunc adapts a classification function to the Classifier interface.
type ClassifierFunc func(context.Context, *http.Request) (float64, error)

// Classify returns the probability or error produced by f.
func (f ClassifierFunc) Classify(ctx context.Context, r *http.Request) (float64, error) {
	return f(ctx, r)
}
