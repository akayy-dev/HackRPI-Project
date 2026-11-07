package embeddings

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/ollama/ollama/api"
)

// Use Ollama to generate embeddings for text.

type EmbeddingResponse struct {
	Embeddings [][]float32 `json:"embeddings"`
}

type EmbeddingModel interface {
	Embed(ctx context.Context, text string) (*EmbeddingResponse, error)
}

type OllamaEmbedder struct {
	Model  string
	Client *api.Client
}

func NewGemma2Embedder() (*OllamaEmbedder, error) {
	client, err := api.ClientFromEnvironment()
	if err != nil {
		slog.Error("failed to create Ollama client", "error", err)
		return nil, nil
	}

	return &OllamaEmbedder{
		Model:  "embedding-gemma2",
		Client: client,
	}, nil
}

// Embed a text string and return the embeddings.
func (o *OllamaEmbedder) Embed(ctx context.Context, text string) (*EmbeddingResponse, error) {
	prompt := "task: classification | query: " + text
	req := &api.EmbedRequest{
		Model: o.Model,
		Input: prompt,
	}
	resp, err := o.Client.Embed(ctx, req)
	if err != nil {
		slog.Error("failed to get embeddings from Ollama", "error", err, "prompt", prompt)
		return nil, err
	}

	// Make sure the embeddings are the expected size (768 dimensions).
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
