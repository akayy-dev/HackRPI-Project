package telemetry

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// RequestTelemetry describes an incoming request before the proxy rewrites it.
type RequestTelemetry struct {
	Timestamp  time.Time   `bson:"timestamp"`
	Riskiness  float64     `bson:"risk"` // Predicted probability that the request is malicious, in [0, 1].
	Method     string      `bson:"method"`
	URL        string      `bson:"url"`
	Host       string      `bson:"host"`
	RemoteAddr string      `bson:"remote_addr"`
	Protocol   string      `bson:"protocol"`
	Headers    http.Header `bson:"headers"`
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

// LogRequest stores request metadata and the classifier's probability of the
// request being malicious. Riskiness must be finite and in [0, 1]. It does not
// read or modify the request body, and database writes time out after two seconds.
func (l *Logger) LogRequest(ctx context.Context, r *http.Request, riskiness float64) error {
	if math.IsNaN(riskiness) || math.IsInf(riskiness, 0) || riskiness < 0 || riskiness > 1 {
		return fmt.Errorf("riskiness must be a finite probability between 0 and 1")
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
		Riskiness: riskiness,
		Timestamp: time.Now().UTC(), Method: r.Method, URL: r.URL.String(),
		Host: r.Host, RemoteAddr: r.RemoteAddr, Protocol: r.Proto, Headers: headers,
	}
	writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if _, err := l.collection.InsertOne(writeCtx, record); err != nil {
		return fmt.Errorf("insert request telemetry: %w", err)
	}
	return nil
}
