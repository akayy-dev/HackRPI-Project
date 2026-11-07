package proxy

import (
	"log/slog"
	"net/url"
)

type ReverseProxy struct {
	// The URLs that sit behind the reverse proxy
	targetURLs []*url.URL
	current    uint64
}

// NewReverseProxy creates a new ReverseProxy instance with the provided backend URLs.
func NewReverseProxy(backendURLs []string) *ReverseProxy {
	urls := make([]*url.URL, len(backendURLs))

	for i, u := range backendURLs {
		parsedURL, err := url.Parse(u)
		if err != nil {
			slog.Error("Error parsing backend URL", "index", i, "error", err)
		}
		urls[i] = parsedURL
	}
	return &ReverseProxy{
		targetURLs: urls,
		current:    0,
	}
}
