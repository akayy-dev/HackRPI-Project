package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"hackrpi-project/comparison"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	threshold, err := strconv.ParseFloat(env("RISK_THRESHOLD", "0.5"), 64)
	if err != nil {
		log.Fatal(err)
	}
	lab, err := comparison.New(env("CLASSIFIER_URL", "http://classifier-comparison:8000"), env("REVERSE_PROXY_URL", "http://target-web-app:80"), threshold)
	if err != nil {
		log.Fatal(err)
	}
	handler, err := lab.Handler(ctx)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: env("LAB_ADDR", ":8090"), Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { <-ctx.Done(); server.Close() }()
	log.Printf("Comparison UI listening at http://localhost%s", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
