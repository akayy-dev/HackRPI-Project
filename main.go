package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"hackrpi-project/proxy"
	"hackrpi-project/security"
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

	threshold, err := strconv.ParseFloat(envOrDefault("RISK_THRESHOLD", "0.5"), 64)
	if err != nil {
		return fmt.Errorf("parse RISK_THRESHOLD: %w", err)
	}
	classifierURL := envOrDefault("CLASSIFIER_URL", "http://classifier:8000")
	timeout, err := time.ParseDuration(envOrDefault("CLASSIFIER_TIMEOUT", "15s"))
	if err != nil {
		return fmt.Errorf("parse CLASSIFIER_TIMEOUT: %w", err)
	}
	maxBody, err := strconv.ParseInt(envOrDefault("CLASSIFIER_MAX_BODY", "262144"), 10, 64)
	if err != nil {
		return fmt.Errorf("parse CLASSIFIER_MAX_BODY: %w", err)
	}
	mode := security.ModelMode(envOrDefault("CLASSIFIER_MODE", "trained"))
	classifier, err := security.NewRemoteClassifierForMode(classifierURL, timeout, maxBody, mode)
	if err != nil {
		return fmt.Errorf("create threat classifier: %w", err)
	}
	ready, err := classifier.CheckReady(ctx)
	if err != nil {
		return fmt.Errorf("connect threat classifier: %w", err)
	}
	slog.Info("Threat classifier ready", "url", classifierURL, "model", ready.Model, "backbone", ready.Backbone, "mode", ready.Mode, "head_sha256", ready.SHA256)
	handler, err := proxy.NewHandler(reverseProxy, classifier, requestLogger, threshold)
	if err != nil {
		return fmt.Errorf("create request handler: %w", err)
	}
	server := &http.Server{
		Addr:              ":8080",
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	slog.Info("Starting reverse proxy", "address", server.Addr, "target", backendURL, "classifier", classifierURL)
	models := map[security.ModelMode]security.Classifier{mode: classifier}
	for _, choice := range []security.ModelMode{security.ModelTrained, security.ModelOriginal2020} {
		if models[choice] == nil {
			model, err := security.NewRemoteClassifierForMode(classifierURL, timeout, maxBody, choice)
			if err != nil {
				return fmt.Errorf("create simulation classifier: %w", err)
			}
			models[choice] = model
		}
	}
	simulationHandler, err := simulation.NewHandlerWithConfig(classifier, requestLogger, simulation.Config{
		Threshold: threshold, DefaultMode: mode, Models: models,
	})
	if err != nil {
		return fmt.Errorf("create simulation handler: %w", err)
	}
	simulationServer := &http.Server{
		Addr: ":8081", Handler: simulationHandler, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second,
	}
	return serveServers(ctx, server, simulationServer)
}

// serveServers restores the partner's coordinated listener shutdown. A failed
// listener stops its peer before the deferred MongoDB client disconnect runs.
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
