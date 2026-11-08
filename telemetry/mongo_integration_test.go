package telemetry_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"hackrpi-project/proxy"
	"hackrpi-project/security"
	"hackrpi-project/telemetry"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// TestMongoRequestPersistence exercises the handler and logger against a real
// MongoDB when MONGODB_TEST_URI is set. It uses and cleans up a unique collection.
func TestMongoRequestPersistence(t *testing.T) {
	uri := os.Getenv("MONGODB_TEST_URI")
	if uri == "" {
		t.Skip("set MONGODB_TEST_URI to run MongoDB integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	collectionName := "request_test_" + bson.NewObjectID().Hex()
	logger, err := telemetry.NewLogger(ctx, uri, "telemetry_integration_test", collectionName)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	collection := reader.Database("telemetry_integration_test").Collection(collectionName)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if err := collection.Drop(cleanupCtx); err != nil {
			t.Error(err)
		}
		_ = reader.Disconnect(cleanupCtx)
		_ = logger.Close(cleanupCtx)
	})
	for _, tc := range []struct {
		name    string
		risk    float64
		failure bool
		status  int
	}{
		{name: "allowed", risk: 0.1, status: 204},
		{name: "blocked", risk: 0.9, status: 403},
		{name: "classification_failed", failure: true, status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			model := security.ClassifierFunc(func(context.Context, *http.Request) (*security.Prediction, error) {
				if tc.failure {
					return nil, errors.New("test embedding failure")
				}
				return prediction(tc.risk), nil
			})
			handler, err := proxy.NewHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }), model, logger, proxy.THRESHOLD)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodGet, "/"+tc.name, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d, want %d", w.Code, tc.status)
			}
			var stored struct {
				Risk    *float64           `bson:"risk"`
				Attacks map[string]float64 `bson:"attack_probabilities"`
				Error   string             `bson:"classification_error"`
			}
			if err := collection.FindOne(ctx, bson.M{"url": "/" + tc.name}).Decode(&stored); err != nil {
				t.Fatal(err)
			}
			if tc.failure {
				if stored.Risk != nil || len(stored.Attacks) != 0 || stored.Error == "" {
					t.Fatal("invalid failure document")
				}
			} else if stored.Risk == nil || *stored.Risk != tc.risk || len(stored.Attacks) != 14 || stored.Attacks["sql_injection"] != tc.risk || stored.Error != "" {
				t.Fatalf("incomplete classification document: %+v", stored)
			}
		})
	}
}

func prediction(risk float64) *security.Prediction {
	labels := map[string]float64{}
	for _, name := range security.Labels() {
		labels[name] = 0
	}
	labels["000 - Normal"] = 0.9
	labels["66 - SQL Injection"] = risk
	return &security.Prediction{Risk: risk, Labels: labels}
}
