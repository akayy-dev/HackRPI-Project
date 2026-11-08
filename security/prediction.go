package security

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
)

// Prediction retains every validated CAPEC score for the comparison workbench.
type Prediction struct {
	Risk             float64            `json:"risk"`
	TopLabel         string             `json:"top_label"`
	Labels           map[string]float64 `json:"labels"`
	Model            string             `json:"model"`
	SHA256           string             `json:"sha256,omitempty"`
	HeadRevision     string             `json:"head_revision,omitempty"`
	Backbone         string             `json:"backbone"`
	BackboneRevision string             `json:"backbone_revision,omitempty"`
}

// ScoreText scores a serialized input using the original or replacement head.
func (c *RemoteClassifier) ScoreText(ctx context.Context, text string, trained bool) (Prediction, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(map[string]string{"text": text}); err != nil {
		return Prediction{}, err
	}
	route := "/classify"
	if trained {
		route = "/classify-trained"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+route, &buf)
	if err != nil {
		return Prediction{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	var result Prediction
	if err := c.do(req, &result); err != nil {
		return Prediction{}, err
	}
	risk, top, err := riskFromLabels(result.Labels)
	if err != nil {
		return Prediction{}, err
	}
	result.Risk, result.TopLabel = risk, top
	return result, nil
}
