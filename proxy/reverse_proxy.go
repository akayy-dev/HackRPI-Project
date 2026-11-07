package proxy

import (
	"fmt"
	"log/slog"
	"net/http/httputil"
	"net/url"
)

// NewReverseProxy creates a reverse proxy for an absolute HTTP or HTTPS backend URL.
func NewReverseProxy(backendURL string) (*httputil.ReverseProxy, error) {
	targetURL, err := url.Parse(backendURL)
	if err != nil {
		return nil, fmt.Errorf("parse backend URL: %w", err)
	}
	if targetURL.Host == "" || (targetURL.Scheme != "http" && targetURL.Scheme != "https") {
		return nil, fmt.Errorf("backend URL must be an absolute HTTP or HTTPS URL")
	}

	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)

			slog.Debug("Created reverse proxy request", "method", r.In.Method, "url", r.In.URL.String(), "host", r.In.Host)
			r.SetXForwarded()
		},
	}, nil
}
