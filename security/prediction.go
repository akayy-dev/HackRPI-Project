package security

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

// Validate requires the original highest-attack-score risk policy and complete
// probabilities, so telemetry and enforcement cannot silently disagree.
func (p *Prediction) Validate() error {
	if p == nil {
		return fmt.Errorf("classification result is missing")
	}
	risk, top, err := riskFromLabels(p.Labels)
	if err != nil {
		return err
	}
	if !validProbability(p.Risk) || p.Risk != risk {
		return fmt.Errorf("risk must equal the highest attack-class score")
	}
	if p.TopLabel != "" && p.TopLabel != top {
		return fmt.Errorf("top label does not match class scores")
	}
	return nil
}

// NamedScores preserves the partner dashboard's stable MongoDB schema.
func (p *Prediction) NamedScores() map[string]float64 {
	names := []string{"normal", "protocol_manipulation", "code_injection", "os_command_injection", "path_traversal", "sql_injection", "dictionary_password_attack", "vulnerability_scanning", "input_data_manipulation", "command_injection", "http_verb_tampering", "source_spoofing", "http_response_splitting", "http_request_smuggling"}
	result := make(map[string]float64, len(names))
	for i, name := range names {
		result[name] = p.Labels[classLabels[i]]
	}
	return result
}
