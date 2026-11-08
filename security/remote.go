package security

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ReadyStatus is the identity reported by a loaded classifier service.
type ReadyStatus struct {
	Model    string
	Backbone string
}

// RemoteClassifier scores requests by asking the threat-classifier service
// for CAPEC probabilities and reducing them to one risk score in [0, 1].
type RemoteClassifier struct {
	baseURL string
	client  *http.Client
	maxBody int64
}

// NewRemoteClassifier creates a client for a classifier service base URL such
// as http://classifier:8000. The service must expose /health and /classify.
func NewRemoteClassifier(baseURL string, timeout time.Duration, maxBody int64) (*RemoteClassifier, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("classifier URL must be an absolute HTTP or HTTPS URL")
	}
	if timeout <= 0 {
		return nil, fmt.Errorf("classifier timeout must be positive")
	}
	if maxBody <= 0 || maxBody > 1<<20 {
		return nil, fmt.Errorf("classifier body limit must be from 1 byte through 1 MiB")
	}
	return &RemoteClassifier{
		baseURL: baseURL,
		maxBody: maxBody,
		client:  &http.Client{Timeout: timeout},
	}, nil
}

// CheckReady confirms that the model is loaded and reports which checkpoint it is serving.
func (c *RemoteClassifier) CheckReady(ctx context.Context) (ReadyStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return ReadyStatus{}, fmt.Errorf("create classifier health request: %w", err)
	}
	var health struct {
		Status   string `json:"status"`
		Model    string `json:"model"`
		Backbone string `json:"backbone"`
	}
	if err := c.do(req, &health); err != nil {
		return ReadyStatus{}, fmt.Errorf("classifier health check: %w", err)
	}
	if health.Status != "ok" || health.Model == "" || health.Backbone == "" {
		return ReadyStatus{}, fmt.Errorf("classifier health response was incomplete")
	}
	return ReadyStatus{Model: health.Model, Backbone: health.Backbone}, nil
}

// Classify serializes the request, scores it, and returns the highest
// attack-class probability. The request body is left intact for forwarding.
func (c *RemoteClassifier) Classify(ctx context.Context, r *http.Request) (float64, error) {
	text, err := SerializeRequest(r, c.maxBody, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("%w: %s", ErrClassifierUnavailable, err.Error())
	}
	payload := map[string]string{"text": text}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(payload); err != nil {
		return 0, fmt.Errorf("%w: encode classifier request: %s", ErrClassifierUnavailable, err.Error())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/classify", &buf)
	if err != nil {
		return 0, fmt.Errorf("%w: create classifier request: %s", ErrClassifierUnavailable, err.Error())
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	var response struct {
		Labels map[string]float64 `json:"labels"`
	}
	if err := c.do(req, &response); err != nil {
		return 0, fmt.Errorf("%w: %s", ErrClassifierUnavailable, err.Error())
	}
	risk, topLabel, err := riskFromLabels(response.Labels)
	if err != nil {
		return 0, fmt.Errorf("%w: %s", ErrClassifierUnavailable, err.Error())
	}
	slog.Debug("Classified request", "risk", risk, "top_label", topLabel, "method", r.Method, "url", r.URL.String())
	return risk, nil
}

func (c *RemoteClassifier) do(req *http.Request, dest any) error {
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read classifier response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		message := strings.TrimSpace(string(body))
		if len(message) > 200 {
			message = message[:200]
		}
		return fmt.Errorf("classifier returned HTTP %d: %s", resp.StatusCode, message)
	}
	if err := json.Unmarshal(body, dest); err != nil {
		return fmt.Errorf("decode classifier response: %w", err)
	}
	return nil
}

func riskFromLabels(labels map[string]float64) (float64, string, error) {
	if len(labels) == 0 {
		return 0, "", fmt.Errorf("classifier returned no labels")
	}
	var (
		risk     float64
		haveRisk bool
		topName  string
		topScore float64
		haveTop  bool
	)
	for _, label := range classLabels {
		score, ok := labels[label]
		if !ok || !validProbability(score) {
			return 0, "", fmt.Errorf("classifier omitted or invalid label %q", label)
		}
		if !haveTop || score > topScore {
			topName = label
			topScore = score
			haveTop = true
		}
		if label == normalLabel {
			continue
		}
		if !haveRisk || score > risk {
			risk = score
			haveRisk = true
		}
	}
	if !haveRisk || !validProbability(risk) {
		return 0, "", fmt.Errorf("classifier returned no attack-class score")
	}
	return risk, topName, nil
}

func validProbability(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}
