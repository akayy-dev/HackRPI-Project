package telemetry

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"hackrpi-project/classifier"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// RequestTelemetry describes an incoming request before the proxy rewrites it.
type RequestTelemetry struct {
	Timestamp           time.Time                       `bson:"timestamp"`
	Riskiness           *float64                        `bson:"risk,omitempty"` // Absent when classification fails.
	AttackProbabilities *classifier.AttackProbabilities `bson:"attack_probabilities,omitempty"`
	ClassificationError string                          `bson:"classification_error,omitempty"`
	Simulated           bool                            `bson:"simulated"`
	Threshold           *float64                        `bson:"threshold,omitempty"`
	Blocked             *bool                           `bson:"blocked,omitempty"`
	Method              string                          `bson:"method"`
	URL                 string                          `bson:"url"`
	Host                string                          `bson:"host"`
	RemoteAddr          string                          `bson:"remote_addr"`
	Protocol            string                          `bson:"protocol"`
	Headers             http.Header                     `bson:"headers"`
}

type requestCollection interface {
	InsertOne(context.Context, any, ...options.Lister[options.InsertOneOptions]) (*mongo.InsertOneResult, error)
}

// Logger reuses one MongoDB client across concurrent requests.
type Logger struct {
	client     *mongo.Client
	collection requestCollection
}

// NewLogger connects to MongoDB and verifies that it is available.
func NewLogger(ctx context.Context, uri, database, collection string) (*Logger, error) {
	if uri == "" || database == "" || collection == "" {
		return nil, fmt.Errorf("MongoDB URI, database, and collection are required")
	}
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, fmt.Errorf("connect to MongoDB: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		_ = client.Disconnect(closeCtx)
		return nil, fmt.Errorf("ping MongoDB: %w", err)
	}
	return &Logger{client: client, collection: client.Database(database).Collection(collection)}, nil
}

// Close releases the MongoDB connection pool.
func (l *Logger) Close(ctx context.Context) error {
	return l.client.Disconnect(ctx)
}

// LogRequest stores metadata and the complete classification result. Failed
// classifications store classification_error and omit probability fields. It
// preserves the request body and applies a two-second database write timeout.
func (l *Logger) LogRequest(ctx context.Context, r *http.Request, result *classifier.Result, classificationErr error) error {
	return l.logRequest(ctx, r, result, classificationErr, nil)
}

// LogSimulation stores the provided probabilities and blocking decision in the
// same collection as real requests, marked simulated=true. A nil error confirms
// the MongoDB write completed. The request body is not persisted.
func (l *Logger) LogSimulation(ctx context.Context, r *http.Request, result *classifier.Result, threshold float64) error {
	if math.IsNaN(threshold) || threshold < 0 || threshold > 1 {
		return fmt.Errorf("simulation threshold must be between 0 and 1")
	}
	return l.logRequest(ctx, r, result, nil, &threshold)
}

func (l *Logger) logRequest(ctx context.Context, r *http.Request, result *classifier.Result, classificationErr error, simulationThreshold *float64) error {
	if classificationErr == nil {
		if err := result.Validate(); err != nil {
			return err
		}
	}
	headers := r.Header.Clone()
	if headers == nil {
		headers = make(http.Header)
	}
	for name := range headers {
		switch strings.ToLower(name) {

		// Hide sensitive authroization headers from the telemetry database.
		// NOTE: These headers are still sent to our classifier, and are included in the
		// request forwarded to the backend. They are only redacted in the telemetry database.
		case "authorization", "proxy-authorization", "cookie", "x-api-key":
			headers[name] = []string{"[REDACTED]"}
		}
	}
	headers.Set("Host", r.Host)
	record := RequestTelemetry{
		Timestamp: time.Now().UTC(), Method: r.Method, URL: r.URL.String(),
		Host: r.Host, RemoteAddr: r.RemoteAddr, Protocol: r.Proto, Headers: headers,
	}
	if classificationErr != nil {
		record.ClassificationError = classificationErr.Error()
	} else {
		record.Riskiness = &result.Riskiness
		record.AttackProbabilities = &result.AttackProbabilities
	}
	if simulationThreshold != nil {
		blocked := result.Riskiness >= *simulationThreshold
		record.Simulated = true
		record.Threshold = simulationThreshold
		record.Blocked = &blocked
	}
	writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if _, err := l.collection.InsertOne(writeCtx, record); err != nil {
		return fmt.Errorf("insert request telemetry: %w", err)
	}
	return nil
}
