package telemetry

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"strings"
	"time"

	"hackrpi-project/classifier"
	"hackrpi-project/classifier/embeddings"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// RequestTelemetry describes an incoming request before the proxy rewrites it.
type RequestTelemetry struct {
	Timestamp              time.Time                       `bson:"timestamp"`
	Riskiness              *float64                        `bson:"risk,omitempty"` // Absent when classification fails.
	AttackProbabilities    *classifier.AttackProbabilities `bson:"attack_probabilities,omitempty"`
	ClassificationError    string                          `bson:"classification_error,omitempty"`
	Simulated              bool                            `bson:"simulated"`
	Threshold              *float64                        `bson:"threshold,omitempty"`
	Blocked                *bool                           `bson:"blocked,omitempty"`
	IntendedClassification string                          `bson:"intended_classification,omitempty"`
	GenerationMode         string                          `bson:"generation_mode,omitempty"`
	Method                 string                          `bson:"method"`
	URL                    string                          `bson:"url"`
	Host                   string                          `bson:"host"`
	RemoteAddr             string                          `bson:"remote_addr"`
	DestinationAddr        string                          `bson:"destination_addr,omitempty"`
	Protocol               string                          `bson:"protocol"`
	Headers                http.Header                     `bson:"headers"`
}

type requestCollection interface {
	InsertOne(context.Context, any, ...options.Lister[options.InsertOneOptions]) (*mongo.InsertOneResult, error)
}

// Logger reuses one MongoDB client across concurrent requests.
type Logger struct {
	client     *mongo.Client
	collection requestCollection
}

// SimulationMetadata annotates synthetic traffic independently of model inputs.
type SimulationMetadata struct {
	Threshold              float64
	Timestamp              time.Time
	IntendedClassification string
	GenerationMode         string
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

// LogSimulation stores reconstructed request metadata and model-computed scores
// in the same collection as real requests, marked simulated=true. Failures omit
// scores and decisions. A nil error confirms the MongoDB write completed. The
// intended class is an annotation; the request body is not persisted.
func (l *Logger) LogSimulation(ctx context.Context, r *http.Request, result *classifier.Result, classificationErr error, metadata SimulationMetadata) error {
	if math.IsNaN(metadata.Threshold) || metadata.Threshold < 0 || metadata.Threshold > 1 {
		return fmt.Errorf("simulation threshold must be between 0 and 1")
	}
	return l.logRequest(ctx, r, result, classificationErr, &metadata)
}

func (l *Logger) logRequest(ctx context.Context, r *http.Request, result *classifier.Result, classificationErr error, simulation *SimulationMetadata) error {
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
		Timestamp: embeddings.RequestTimestamp(r).UTC(), Method: r.Method, URL: r.URL.String(),
		Host: r.Host, RemoteAddr: r.RemoteAddr, Protocol: r.Proto, Headers: headers,
	}
	if destination, ok := r.Context().Value(http.LocalAddrContextKey).(*net.TCPAddr); ok && destination != nil {
		record.DestinationAddr = destination.String()
	}
	if classificationErr != nil {
		record.ClassificationError = classificationErr.Error()
	} else {
		record.Riskiness = &result.Riskiness
		record.AttackProbabilities = &result.AttackProbabilities
	}
	if simulation != nil {
		record.Simulated = true
		record.Threshold = &simulation.Threshold
		record.IntendedClassification = simulation.IntendedClassification
		record.GenerationMode = simulation.GenerationMode
		if !simulation.Timestamp.IsZero() {
			record.Timestamp = simulation.Timestamp.UTC()
		}
		if classificationErr == nil && result != nil {
			blocked := result.Riskiness >= simulation.Threshold
			record.Blocked = &blocked
		}
	}
	writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if _, err := l.collection.InsertOne(writeCtx, record); err != nil {
		return fmt.Errorf("insert request telemetry: %w", err)
	}
	return nil
}
