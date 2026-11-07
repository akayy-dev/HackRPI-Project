package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"hackrpi-project/classifier"
	"hackrpi-project/classifier/embeddings"
	"hackrpi-project/proxy"
	"hackrpi-project/simulation"
	"hackrpi-project/telemetry"
)

func main() {
	// Setup JSON logging
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout,
		&slog.HandlerOptions{
			AddSource: true,
			Level:     slog.LevelDebug,
		})))
	if err := run(); err != nil {
		slog.Error("Proxy stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	backendURL := os.Getenv("REVERSE_PROXY_URL")

	// set the reverse proxy to forward to a backend url
	reverseProxy, err := proxy.NewReverseProxy(backendURL)
	if err != nil {
		return fmt.Errorf("create reverse proxy: %w", err)
	}

	// connect to the MongoDB database and collection for telemetry
	requestLogger, err := telemetry.NewLogger(ctx, os.Getenv("MONGODB_URI"),
		envOrDefault("MONGODB_DATABASE", "telemetry"), envOrDefault("MONGODB_COLLECTION", "requests"))
	if err != nil {
		return err
	}

	// Ensure the MongoDB connection is closed when the program exits
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := requestLogger.Close(closeCtx); err != nil {
			slog.Error("Failed to disconnect MongoDB", "error", err)
		}
	}()

	// Load the trained sigmoid head and use the same embedding model as training.
	head, err := classifier.LoadSigmoidClassifier(envOrDefault("CLASSIFIER_WEIGHTS", "./classifier/weights.json"))
	if err != nil {
		return fmt.Errorf("load classifier weights: %w", err)
	}
	embedder, err := embeddings.NewOllamaEmbedder(envOrDefault("OLLAMA_MODEL", "embeddinggemma:300m"))
	if err != nil {
		return fmt.Errorf("create embedder: %w", err)
	}
	requestClassifier, err := classifier.NewRequestClassifier(head, embedder)
	if err != nil {
		return fmt.Errorf("create classifier: %w", err)
	}
	handler, err := proxy.NewHandler(reverseProxy, requestClassifier, requestLogger, proxy.THRESHOLD)
	if err != nil {
		return fmt.Errorf("create request handler: %w", err)
	}
	server := &http.Server{
		Addr:              ":8080",
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	simulationHandler, err := simulation.NewHandler(requestClassifier, requestLogger)
	if err != nil {
		return fmt.Errorf("create simulation handler: %w", err)
	}
	simulationServer := &http.Server{
		Addr:              ":8081",
		Handler:           simulationHandler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	return serveServers(ctx, server, simulationServer)
}

// serveServers starts both HTTP listeners and shuts them down before MongoDB
// disconnects. A listener failure stops its peers and is returned to the caller.
func serveServers(ctx context.Context, servers ...*http.Server) error {
	serverErrors := make(chan error, len(servers))
	for _, server := range servers {
		slog.Info("Starting HTTP server", "address", server.Addr)
		go func() { serverErrors <- server.ListenAndServe() }()
	}
	var serveErr error
	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			serveErr = err
		}
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, server := range servers {
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			serveErr = errors.Join(serveErr, fmt.Errorf("shut down %s: %w", server.Addr, err))
		}
	}
	return serveErr
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
