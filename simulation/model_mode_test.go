package simulation

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"hackrpi-project/security"
)

func TestTrafficLabSelectsBothHeadsAndPreservesTelemetryContract(t *testing.T) {
	var route, text string
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		route = r.URL.Path
		var payload struct{ Text string }
		_ = json.NewDecoder(r.Body).Decode(&payload)
		text = payload.Text
		risk := 0.1
		if route == "/classify-trained" {
			risk = 0.8
		}
		_ = json.NewEncoder(w).Encode(prediction(risk))
	}))
	defer modelServer.Close()
	models := map[security.ModelMode]security.Classifier{}
	for _, mode := range []security.ModelMode{security.ModelTrained, security.ModelOriginal2020} {
		models[mode], _ = security.NewRemoteClassifierForMode(modelServer.URL, time.Second, 262144, mode)
	}
	logger := &fakeLogger{}
	handler, err := NewHandlerWithConfig(models[security.ModelTrained], logger, Config{
		Threshold: 0.75, DefaultMode: security.ModelTrained, Models: models,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []security.ModelMode{security.ModelTrained, security.ModelOriginal2020} {
		var input map[string]any
		_ = json.Unmarshal([]byte(validInput), &input)
		input["model_mode"] = mode
		body, _ := json.Marshal(input)
		request := httptest.NewRequest("POST", "/submit", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 201 {
			t.Fatalf("%s failed: %d %s", mode, response.Code, response.Body.String())
		}
		var result struct {
			Riskiness float64            `json:"riskiness"`
			Scores    map[string]float64 `json:"attack_probabilities"`
			Mode      security.ModelMode `json:"model_mode"`
			Threshold float64            `json:"threshold"`
			Blocked   bool               `json:"blocked"`
			Simulated bool               `json:"simulated"`
			Saved     bool               `json:"saved"`
		}
		_ = json.Unmarshal(response.Body.Bytes(), &result)
		wantYear, wantRoute := "2026", "/classify-trained"
		if mode == security.ModelOriginal2020 {
			wantYear, wantRoute = "2020", "/classify"
		}
		if route != wantRoute || !strings.HasPrefix(text, "timestamp: 07/Nov/"+wantYear+":12:00:00 +0000\n") {
			t.Fatalf("wrong model or timestamp: %s %s", route, text)
		}
		if strings.Contains(text, "dictionary_password_attack") || strings.Contains(text, "model_mode") {
			t.Fatal("test annotations leaked into model input")
		}
		if result.Mode != mode || result.Threshold != 0.75 || result.Blocked != (mode == security.ModelTrained) || !result.Simulated || !result.Saved || len(result.Scores) != 14 {
			t.Fatalf("simulation API contract changed: %s", response.Body.String())
		}
		if result.Scores["sql_injection"] != result.Riskiness || logger.result.Risk != result.Riskiness || logger.metadata.Timestamp.Year() != 2026 || logger.metadata.Threshold != 0.75 {
			t.Fatal("logged scores, actual timestamp, or threshold differ from the returned decision")
		}
	}
	request := httptest.NewRequest("POST", "/submit", strings.NewReader(strings.Replace(validInput, `"method":"POST"`, `"model_mode":"invalid","method":"POST"`, 1)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 400 || logger.calls != 2 {
		t.Fatal("invalid model selection was logged or classified")
	}
}

func TestPreviewAdvertisesSessionOnlyResults(t *testing.T) {
	model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) {
		return prediction(0.1), nil
	})
	handler, err := NewHandlerWithConfig(model, &fakeLogger{}, Config{Threshold: 0.5, Persistence: "session"})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/config", nil))
	var config map[string]any
	_ = json.Unmarshal(response.Body.Bytes(), &config)
	if response.Code != 200 || config["persistence"] != "session" || config["default_model_mode"] != "trained" {
		t.Fatalf("incorrect preview settings: %s", response.Body.String())
	}
	request := httptest.NewRequest("POST", "/submit", strings.NewReader(validInput))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var result map[string]any
	_ = json.Unmarshal(response.Body.Bytes(), &result)
	if response.Code != 201 || result["saved"] != false {
		t.Fatalf("preview claimed a database write: %s", response.Body.String())
	}
}
