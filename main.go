package main

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"hackrpi-project/proxy"
	"hackrpi-project/security"
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
	classifier := security.ClassifierFunc(func(context.Context, *http.Request) (float64, error) {
		// TODO: Replace this random riskiness with the probability returned by our classifier model.
		return rand.Float64(), nil
	})
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
	slog.Info("Starting reverse proxy", "address", server.Addr, "target", backendURL)
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()
	select {
	case err := <-serverErrors:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return fmt.Errorf("shut down proxy: %w", err)
		}
		return nil
	}
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
