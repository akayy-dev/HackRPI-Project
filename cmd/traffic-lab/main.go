// traffic-lab runs the restored simulator without a database connection.
// The regular proxy process serves the MongoDB-backed version on port 8081.
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

	"hackrpi-project/security"
	"hackrpi-project/simulation"
	"hackrpi-project/telemetry"
)

type sessionLogger struct{}

func (sessionLogger) LogSimulation(context.Context, *http.Request, *security.Prediction, error, telemetry.SimulationMetadata) error {
	return nil // The browser owns this preview session; no database is opened.
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	mode := security.ModelMode(env("CLASSIFIER_MODE", "trained"))
	threshold, err := strconv.ParseFloat(env("RISK_THRESHOLD", "0.5"), 64)
	if err != nil {
		log.Fatal(err)
	}
	models := map[security.ModelMode]security.Classifier{}
	for _, choice := range []security.ModelMode{security.ModelTrained, security.ModelOriginal2020} {
		model, err := security.NewRemoteClassifierForMode(env("CLASSIFIER_URL", "http://classifier-comparison:8000"), 90*time.Second, 262144, choice)
		if err != nil {
			log.Fatal(err)
		}
		models[choice] = model
	}
	handler, err := simulation.NewHandlerWithConfig(models[mode], sessionLogger{}, simulation.Config{
		Threshold: threshold, DefaultMode: mode, Models: models, Persistence: "session",
	})
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: env("LAB_ADDR", "127.0.0.1:8082"), Handler: handler,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Traffic Lab preview listening on %s; MongoDB is disabled", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
