package embeddings

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type trackedBody struct {
	io.Reader
	closed bool
}

func (b *trackedBody) Close() error { b.closed = true; return nil }

func TestRequestFormattingRestoresAndClosesBody(t *testing.T) {
	for _, size := range []int{7, int(MaxEmbedBodySize) + 1} {
		body := &trackedBody{Reader: strings.NewReader(strings.Repeat("x", size))}
		r := httptest.NewRequest("POST", "/", nil)
		r.Body = body
		_, err := ConvertRequestToEmbedFormat(r)
		if (err != nil) != (size > int(MaxEmbedBodySize)) {
			t.Fatalf("unexpected formatting error: %v", err)
		}
		restored, err := io.ReadAll(r.Body)
		if err != nil || len(restored) != size {
			t.Fatalf("body not preserved: %d, %v", len(restored), err)
		}
		if err := r.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if !body.closed {
			t.Fatal("original body was not closed")
		}
	}
}

func TestOllamaEmbedderRejectsEmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"embeddings":[]}`)
	}))
	defer server.Close()
	t.Setenv("OLLAMA_HOST", server.URL)
	e, err := NewOllamaEmbedder("embeddinggemma")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Embed(context.Background(), "request"); err == nil {
		t.Fatal("expected empty response error")
	}
}
