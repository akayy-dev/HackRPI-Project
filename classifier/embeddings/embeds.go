package embeddings

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"

	"github.com/ollama/ollama/api"
)

// Use Ollama to generate embeddings for text.

type EmbeddingResponse struct {
	Embeddings [][]float32 `json:"embeddings"`
}

type EmbeddingModel interface {
	Embed(ctx context.Context, text string) (*EmbeddingResponse, error)
}

const MaxEmbedBodySize int64 = 1 << 20 // 1 MiB
/*
Convert an http.Request into the string the model expects to be embedded.
*/
func ConvertRequestToEmbedFormat(r *http.Request) (string, error) {
	if r == nil {
		return "", fmt.Errorf("request is nil")
	}

	// Extract source IP and port.
	srcIP, srcPort, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr may contain only an IP.
		srcIP = r.RemoteAddr
		srcPort = ""
	}

	// Extract destination IP and port, if available.
	var dstIP, dstPort string
	if addr, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
		if tcpAddr, ok := addr.(*net.TCPAddr); ok && tcpAddr != nil {
			dstIP = tcpAddr.IP.String()
			dstPort = strconv.Itoa(tcpAddr.Port)
		}
	}

	fields := RequestFields{
		Timestamp: NormalizeTimestamp(RequestTimestamp(r)).Format(TimestampLayout),
		SourceIP:  srcIP, SourcePort: srcPort, DestinationIP: dstIP, DestinationPort: dstPort,
		Method: r.Method, Protocol: r.Proto, UserAgent: r.UserAgent(),
		Referer: r.Referer(), Host: r.Host, Origin: r.Header.Get("Origin"),
		Cookie: r.Header.Get("Cookie"), ContentType: r.Header.Get("Content-Type"),
		Accept: r.Header.Get("Accept"), AcceptLanguage: r.Header.Get("Accept-Language"),
		AcceptEncoding: r.Header.Get("Accept-Encoding"), DoNotTrack: r.Header.Get("DNT"),
		Connection: r.Header.Get("Connection"),
	}
	if r.URL != nil {
		fields.Target = r.URL.RequestURI()
	}

	// Read and restore the request body.
	if r.Body != nil && r.Body != http.NoBody {
		body, err := io.ReadAll(
			io.LimitReader(r.Body, MaxEmbedBodySize+1),
		)
		// Restore the consumed bytes, including on error.
		originalBody := r.Body
		r.Body = &restoredBody{Reader: io.MultiReader(bytes.NewReader(body), originalBody), Closer: originalBody}
		if err != nil {
			return "", fmt.Errorf("read request body: %w", err)
		}

		if int64(len(body)) > MaxEmbedBodySize {
			return "", fmt.Errorf(
				"request body exceeds %d bytes",
				MaxEmbedBodySize,
			)
		}

		fields.Body = string(body)
	}

	return SerializeRequest(fields), nil
}

type OllamaEmbedder struct {
	Model  string
	Client *api.Client
}

// NewOllamaEmbedder uses OLLAMA_HOST to connect to the requested embedding model.
func NewOllamaEmbedder(model string) (*OllamaEmbedder, error) {
	client, err := api.ClientFromEnvironment()
	if err != nil {
		slog.Error("failed to create Ollama client", "error", err)
		return nil, err
	}

	return &OllamaEmbedder{
		Model:  model,
		Client: client,
	}, nil
}

// Embed a text string and return the embeddings.
func (o *OllamaEmbedder) Embed(ctx context.Context, text string) (*EmbeddingResponse, error) {
	prompt := ClassificationPrompt + text
	req := &api.EmbedRequest{
		Model: o.Model,
		Input: prompt,
	}
	resp, err := o.Client.Embed(ctx, req)
	if err != nil {
		slog.Error("failed to get embeddings from Ollama", "error", err)
		return nil, err
	}

	// Make sure the embeddings are the expected size (768 dimensions).
	if resp == nil || len(resp.Embeddings) != 1 {
		return nil, fmt.Errorf("expected one embedding from Ollama")
	}
	if len(resp.Embeddings[0]) != 768 {
		return nil, fmt.Errorf(
			"expected 768 dimensions, got %d",
			len(resp.Embeddings[0]),
		)
	}

	return &EmbeddingResponse{
		Embeddings: resp.Embeddings,
	}, nil
}

// restoredBody replays inspected bytes and still closes the original request body.
type restoredBody struct {
	io.Reader
	io.Closer
}
