package main

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"
)

func main() {
	// Setup JSON logging
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout,
		&slog.HandlerOptions{
			AddSource: true,
			Level:     slog.LevelDebug,
		})))

	targetURL, err := url.Parse(os.Getenv("REVERSE_PROXY_URL"))
	if err != nil || targetURL.Host == "" || (targetURL.Scheme != "http" && targetURL.Scheme != "https") {
		slog.Error("REVERSE_PROXY_URL must be an absolute HTTP or HTTPS URL", "error", err)
		os.Exit(1)
	}

	reverseProxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)
			r.SetXForwarded()
		},
	}
	server := &http.Server{
		Addr:              ":8080",
		Handler:           reverseProxy,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	slog.Info("Starting reverse proxy", "address", server.Addr, "target", targetURL.String())
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("Proxy server failed", "error", err)
		os.Exit(1)
	}
}
