package security

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestModelModesPreserveRequestAndChangeOnlyModelYear(t *testing.T) {
	stamp := time.Date(2024, time.February, 29, 12, 34, 56, 0, time.FixedZone("offset", -5*3600))
	for _, mode := range []ModelMode{ModelTrained, ModelOriginal2020} {
		t.Run(string(mode), func(t *testing.T) {
			var route, text string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				route = r.URL.Path
				var payload struct{ Text string }
				_ = json.NewDecoder(r.Body).Decode(&payload)
				text = payload.Text
				labels := map[string]float64{}
				for _, label := range classLabels {
					labels[label] = 0.01
				}
				labels[normalLabel] = 0.9
				_ = json.NewEncoder(w).Encode(map[string]any{"labels": labels})
			}))
			defer server.Close()
			model, err := NewRemoteClassifierForMode(server.URL, time.Second, 4096, mode)
			if err != nil {
				t.Fatal(err)
			}
			const body = "date=2026-11-08\ntimestamp: 01/Jan/2035:00:00:00 +0000"
			r := httptest.NewRequest(http.MethodPost, "http://example.test/report?year=2026", strings.NewReader(body))
			r.RequestURI = "/report?year=2026"
			r.RemoteAddr = "192.0.2.9:54321"
			r = WithRequestTimestamp(r, stamp)
			if _, err := model.Classify(context.Background(), r); err != nil {
				t.Fatal(err)
			}
			wantYear, wantRoute := "2024", "/classify-trained"
			if mode == ModelOriginal2020 {
				wantYear, wantRoute = "2020", "/classify"
			}
			if route != wantRoute || !strings.HasPrefix(text, "timestamp: 29/Feb/"+wantYear+":12:34:56 -0500\n") {
				t.Fatalf("wrong mode: route=%s text=%s", route, text)
			}
			if !strings.Contains(text, "src-ip: 192.0.2.9\nsrc-port: 54321") || !strings.Contains(text, "path: /report?year=2026") || !strings.Contains(text, "body: "+body) {
				t.Fatalf("mode changed fields beyond timestamp year: %s", text)
			}
			gotBody, _ := io.ReadAll(r.Body)
			if string(gotBody) != body || !RequestTimestamp(r).Equal(stamp) {
				t.Fatal("forwarded body or actual telemetry timestamp changed")
			}
		})
	}
}

func TestTrainedModeReadinessRequiresTrainedExport(t *testing.T) {
	for _, available := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "model": "published", "backbone": "embeddinggemma",
				"trained": map[string]any{"ready": available, "model": "/models/head", "sha256": "saved-weight-fingerprint"}})
		}))
		model, _ := NewRemoteClassifierForMode(server.URL, time.Second, 4096, ModelTrained)
		ready, err := model.CheckReady(context.Background())
		if (err == nil) != available {
			t.Fatalf("trained available=%v, readiness error=%v", available, err)
		}
		if available && (ready.Model != "/models/head" || ready.Mode != ModelTrained || ready.SHA256 == "") {
			t.Fatalf("readiness reported the wrong head: %+v", ready)
		}
		baseline, _ := NewRemoteClassifierForMode(server.URL, time.Second, 4096, ModelOriginal2020)
		if _, err := baseline.CheckReady(context.Background()); err != nil {
			t.Fatalf("original mode requires an unnecessary trained export: %v", err)
		}
		server.Close()
	}
}

func TestInvalidModeAndTimestampFailInsteadOfSilentlySelectingHead(t *testing.T) {
	if _, err := NewRemoteClassifierForMode("http://example.test", time.Second, 4096, "typo"); err == nil {
		t.Fatal("invalid mode accepted")
	}
	for _, text := range []string{"method: GET\nbody: timestamp: 01/Jan/2026:00:00:00 +0000", "timestamp: invalid\nmethod: GET"} {
		if _, err := ModelInputForMode(text, ModelOriginal2020); err == nil {
			t.Fatal("invalid baseline timestamp accepted")
		}
	}
}
