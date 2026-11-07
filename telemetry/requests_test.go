package telemetry

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type fakeCollection struct {
	record   RequestTelemetry
	err      error
	deadline time.Time
}

func (f *fakeCollection) InsertOne(ctx context.Context, doc any, _ ...options.Lister[options.InsertOneOptions]) (*mongo.InsertOneResult, error) {
	f.record = doc.(RequestTelemetry)
	f.deadline, _ = ctx.Deadline()
	return &mongo.InsertOneResult{}, f.err
}

func TestLogRequestStoresRiskinessAndPreservesRequest(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "database failure"}[fail], func(t *testing.T) {
			collection := &fakeCollection{}
			if fail {
				collection.err = errors.New("database unavailable")
			}
			logger := &Logger{collection: collection}
			r := httptest.NewRequest(http.MethodPost, "http://example.test/upload?mode=test", strings.NewReader("original body"))
			r.Header.Set("Authorization", "Bearer secret")
			r.Header.Set("Cookie", "session=secret")
			r.Header.Set("Proxy-Authorization", "secret")
			r.Header.Set("X-Api-Key", "secret")
			r.Header.Add("X-Example", "one")
			r.Header.Add("X-Example", "two")
			err := logger.LogRequest(r.Context(), r, 0.75)
			if !errors.Is(err, collection.err) {
				t.Fatalf("unexpected logging error: %v", err)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil || string(body) != "original body" {
				t.Fatalf("request body changed: %q, %v", body, err)
			}
			if r.Header.Get("Authorization") != "Bearer secret" {
				t.Fatal("incoming credentials changed")
			}
			record := collection.record
			if record.Riskiness != 0.75 {
				t.Fatalf("riskiness was not stored: %v", record.Riskiness)
			}
			if record.Method != r.Method || record.URL != r.URL.String() || record.Host != r.Host || record.RemoteAddr != r.RemoteAddr || record.Protocol != r.Proto || record.Timestamp.IsZero() {
				t.Fatalf("incorrect request metadata: %+v", record)
			}
			for _, name := range []string{"Authorization", "Cookie", "Proxy-Authorization", "X-Api-Key"} {
				if record.Headers.Get(name) != "[REDACTED]" {
					t.Errorf("%s was not redacted", name)
				}
			}
			if record.Headers.Get("Host") != r.Host || len(record.Headers.Values("X-Example")) != 2 {
				t.Fatal("missing headers")
			}
			remaining := time.Until(collection.deadline)
			if remaining <= 0 || remaining > 2*time.Second {
				t.Fatalf("invalid write timeout: %v", remaining)
			}
		})
	}
}
