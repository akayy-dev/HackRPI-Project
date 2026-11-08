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

	"go.mongodb.org/mongo-driver/v2/bson"
	"hackrpi-project/classifier"
	"hackrpi-project/classifier/embeddings"

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
			prediction := &classifier.Result{Riskiness: 0.75, AttackProbabilities: classifier.AttackProbabilities{Normal: 0.25, SQLInjection: 0.85}}
			err := logger.LogRequest(r.Context(), r, prediction, nil)
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
			if record.Riskiness == nil || *record.Riskiness != 0.75 {
				t.Fatalf("riskiness was not stored: %v", record.Riskiness)
			}
			if record.AttackProbabilities == nil || *record.AttackProbabilities != prediction.AttackProbabilities {
				t.Fatal("attack probabilities were not stored")
			}
			encoded, err := bson.Marshal(record)
			if err != nil {
				t.Fatal(err)
			}
			var stored struct {
				Attacks map[string]float64 `bson:"attack_probabilities"`
			}
			if err := bson.Unmarshal(encoded, &stored); err != nil {
				t.Fatal(err)
			}
			attacks := stored.Attacks
			if len(attacks) != 14 || attacks["sql_injection"] != 0.85 {
				t.Fatalf("unexpected stored attack probabilities: %v", attacks)
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

func TestLogRequestStoresClassificationFailureWithoutScores(t *testing.T) {
	collection := &fakeCollection{}
	logger := &Logger{collection: collection}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if err := logger.LogRequest(r.Context(), r, nil, errors.New("embedding service unavailable")); err != nil {
		t.Fatal(err)
	}
	encoded, err := bson.Marshal(collection.record)
	if err != nil {
		t.Fatal(err)
	}
	var stored bson.M
	if err := bson.Unmarshal(encoded, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["classification_error"] != "embedding service unavailable" {
		t.Fatal("classification failure was not saved")
	}
	for _, field := range []string{"risk", "attack_probabilities"} {
		if _, ok := stored[field]; ok {
			t.Errorf("failed classification contains %s", field)
		}
	}
}

func TestTelemetryRetainsOriginalTimestamp(t *testing.T) {
	original := time.Date(2026, time.March, 15, 12, 34, 56, 123000000, time.FixedZone("test", -5*60*60))
	r := embeddings.WithRequestTimestamp(httptest.NewRequest("GET", "/", nil), original)
	collection := &fakeCollection{}
	logger := &Logger{collection: collection}
	if err := logger.LogRequest(r.Context(), r, &classifier.Result{Riskiness: 0.1}, nil); err != nil {
		t.Fatal(err)
	}
	if !collection.record.Timestamp.Equal(original) || collection.record.Timestamp.Year() != 2026 {
		t.Fatalf("telemetry received the model date: %s", collection.record.Timestamp)
	}
}

// A training-era (2020) simulation timestamp must not become the record time,
// or the dashboard's last-24h window hides Traffic Lab traffic.
func TestSimulationLogsArrivalTimeAndKeepsSubmittedTimestamp(t *testing.T) {
	arrival := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	now = func() time.Time { return arrival }
	t.Cleanup(func() { now = time.Now })
	collection := &fakeCollection{}
	logger := &Logger{collection: collection}
	submitted := time.Date(2020, time.July, 18, 5, 26, 36, 0, time.FixedZone("", 2*60*60))
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	metadata := SimulationMetadata{Threshold: 0.5, Timestamp: submitted}
	if err := logger.LogSimulation(r.Context(), r, &classifier.Result{Riskiness: 0.1}, nil, metadata); err != nil {
		t.Fatal(err)
	}
	record := collection.record
	if !record.Timestamp.Equal(arrival) {
		t.Fatalf("record time = %s, want arrival %s", record.Timestamp, arrival)
	}
	if record.RequestTimestamp == nil || !record.RequestTimestamp.Equal(submitted) {
		t.Fatalf("submitted timestamp lost: %v", record.RequestTimestamp)
	}
}

func TestSimulationFailureRetainsMetadataWithoutDecision(t *testing.T) {
	collection := &fakeCollection{}
	logger := &Logger{collection: collection}
	r := httptest.NewRequest(http.MethodGet, "/products", nil)
	r.RemoteAddr = "45.79.23.14:51000"
	metadata := SimulationMetadata{Threshold: 0.5, Timestamp: time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC), IntendedClassification: "sql_injection"}
	if err := logger.LogSimulation(r.Context(), r, &classifier.Result{Riskiness: 0.9}, errors.New("model unavailable"), metadata); err != nil {
		t.Fatal(err)
	}
	record := collection.record
	if !record.Simulated || record.RequestTimestamp == nil || !record.RequestTimestamp.Equal(metadata.Timestamp) || record.IntendedClassification != metadata.IntendedClassification || record.RemoteAddr != r.RemoteAddr {
		t.Fatalf("simulation metadata was lost: %+v", record)
	}
	if record.Riskiness != nil || record.AttackProbabilities != nil || record.Blocked != nil || record.ClassificationError == "" {
		t.Fatal("failed simulation contains a fabricated model decision")
	}
}
