package simulation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"hackrpi-project/security"
)

// decodeRequest accepts the panel's telemetry schema or an unchanged JSON example
// from the training archive. Training values are never decoded/re-encoded as form
// data or query parameters, preserving percent escapes, plus signs, and targets
// such as test.php that intentionally have no leading slash.
func decodeRequest(data []byte) (*Request, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, fmt.Errorf("request telemetry must be a JSON object")
	}
	training := false
	for key := range fields {
		if strings.HasPrefix(key, "request_") || key == "src_ip" || key == "dst_ip" {
			training = true
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if !training {
		var request Request
		if err := decoder.Decode(&request); err != nil {
			return nil, err
		}
		return &request, nil
	}
	var input struct {
		requestFields
		IntendedClassification string             `json:"intended_classification,omitempty"`
		GenerationMode         string             `json:"generation_mode,omitempty"`
		ModelMode              security.ModelMode `json:"model_mode,omitempty"`
	}
	if err := decoder.Decode(&input); err != nil {
		return nil, err
	}
	var timestamp time.Time
	var err error
	if input.Timestamp != "" {
		timestamp, err = time.Parse("02/Jan/2006:15:04:05 -0700", input.Timestamp)
		if err != nil {
			return nil, fmt.Errorf("training timestamp must use DD/Mon/YYYY:HH:MM:SS ±HHMM: %w", err)
		}
	}
	headers := make(http.Header)
	for name, value := range map[string]string{
		"User-Agent": input.UserAgent, "Referer": input.Referer, "Origin": input.Origin,
		"Cookie": input.Cookie, "Content-Type": input.ContentType, "Accept": input.Accept,
		"Accept-Language": input.AcceptLanguage, "Accept-Encoding": input.AcceptEncoding,
		"DNT": input.DoNotTrack, "Connection": input.Connection,
	} {
		if value != "" {
			headers.Set(name, value)
		}
	}
	request := &Request{Timestamp: timestamp, Method: input.Method, URL: input.Target,
		Host: input.Host, RemoteAddr: input.SourceIP, Protocol: input.Protocol,
		Headers: headers, Body: input.Body, IntendedClassification: input.IntendedClassification, GenerationMode: input.GenerationMode, ModelMode: input.ModelMode}
	if input.SourcePort != "" {
		request.RemoteAddr = net.JoinHostPort(input.SourceIP, input.SourcePort)
	}
	if input.DestinationIP != "" && input.DestinationPort != "" {
		request.DestinationAddr = net.JoinHostPort(input.DestinationIP, input.DestinationPort)
	}
	return request, nil
}
