// Package simulation exposes a JSON API for testing probability-based decisions.
package simulation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"hackrpi-project/classifier"
	"hackrpi-project/proxy"
)

// Logger persists a simulation and the threshold used to evaluate it.
type Logger interface {
	LogSimulation(context.Context, *http.Request, *classifier.Result, float64) error
}

// NewHandler serves POST /submit independently of proxy traffic and Ollama.
// The body has the AttackProbabilities JSON shape. Normal is required; omitted
// attack scores default to zero. Successful persistence returns 201 with the
// decision, even when the simulated request would be blocked. Invalid input
// returns 400, oversized input 413, and persistence failures 503.
func NewHandler(logger Logger) (http.Handler, error) {
	if logger == nil {
		return nil, errors.New("simulation logger is required")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /submit", func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
		decoder := json.NewDecoder(r.Body)
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			status := http.StatusBadRequest
			var sizeErr *http.MaxBytesError
			if errors.As(err, &sizeErr) {
				status = http.StatusRequestEntityTooLarge
			}
			writeJSON(w, status, map[string]string{"error": "expected one JSON object of probabilities, up to 16 KiB"})
			return
		}
		var extra json.RawMessage
		if err := decoder.Decode(&extra); err != io.EOF {
			status := http.StatusBadRequest
			var sizeErr *http.MaxBytesError
			if errors.As(err, &sizeErr) {
				status = http.StatusRequestEntityTooLarge
			}
			writeJSON(w, status, map[string]string{"error": "expected exactly one JSON object"})
			return
		}
		var probabilities classifier.AttackProbabilities
		strict := json.NewDecoder(bytes.NewReader(raw))
		strict.DisallowUnknownFields()
		if err := strict.Decode(&probabilities); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body must match AttackProbabilities with numeric values"})
			return
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil || fields["normal"] == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "normal probability is required"})
			return
		}
		for _, value := range fields {
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "probabilities must be numbers, not null"})
				return
			}
		}
		result := &classifier.Result{Riskiness: 1 - probabilities.Normal, AttackProbabilities: probabilities}
		if err := result.Validate(); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := logger.LogSimulation(context.WithoutCancel(r.Context()), r, result, proxy.THRESHOLD); err != nil {
			slog.Error("Failed to persist simulation", "error", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "simulation could not be saved"})
			return
		}
		writeJSON(w, http.StatusCreated, struct {
			*classifier.Result
			Threshold float64 `json:"threshold"`
			Blocked   bool    `json:"blocked"`
			Simulated bool    `json:"simulated"`
		}{result, proxy.THRESHOLD, result.Riskiness >= proxy.THRESHOLD, true})
	})
	return mux, nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("Failed to write simulation response", "error", err)
	}
}
