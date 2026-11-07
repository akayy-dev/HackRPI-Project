package classifier

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"hackrpi-project/classifier/embeddings"
)

// Classifier predicts the probability that a request is malicious. Implementations
// must support concurrent calls, honor cancellation, and preserve the request body.
type Classifier interface {
	Classify(context.Context, *http.Request) (*Result, error)
}

// Result contains the complete prediction for a successfully classified request.
// Riskiness is 1 - AttackProbabilities.Normal.
type Result struct {
	Riskiness           float64             `bson:"risk" json:"riskiness"`
	AttackProbabilities AttackProbabilities `bson:"attack_probabilities" json:"attack_probabilities"`
}

// ClassifierFunc adapts a function to the request classification interface.
type ClassifierFunc func(context.Context, *http.Request) (*Result, error)

// Classify invokes f with the request and its cancellation context.
func (f ClassifierFunc) Classify(ctx context.Context, r *http.Request) (*Result, error) {
	return f(ctx, r)
}

// RequestClassifier formats requests, embeds them, and runs the trained head.
// Riskiness is 1 - Normal, the complement of the model's Normal-class score;
// the independent attack scores are not summed or treated as a softmax.
type RequestClassifier struct {
	head     *SigmoidClassifier
	embedder embeddings.EmbeddingModel
}

// NewRequestClassifier connects a validated sigmoid head to its embedding service.
func NewRequestClassifier(head *SigmoidClassifier, embedder embeddings.EmbeddingModel) (*RequestClassifier, error) {
	if head == nil || embedder == nil {
		return nil, fmt.Errorf("sigmoid head and embedder are required")
	}
	return &RequestClassifier{head: head, embedder: embedder}, nil
}

// Classify preserves the body, embeds the request with a 30-second deadline, and
// returns its riskiness and all attack probabilities. Formatting, embedding, and
// inference failures return a nil result and an error.
func (c *RequestClassifier) Classify(ctx context.Context, r *http.Request) (*Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	text, err := embeddings.ConvertRequestToEmbedFormat(r)
	if err != nil {
		return nil, fmt.Errorf("format request: %w", err)
	}
	response, err := c.embedder.Embed(ctx, text)
	if err != nil {
		return nil, fmt.Errorf("embed request: %w", err)
	}
	if response == nil || len(response.Embeddings) != 1 {
		return nil, fmt.Errorf("expected one request embedding")
	}
	probabilities, err := c.head.ClassifyAttack(response.Embeddings[0])
	if err != nil {
		return nil, fmt.Errorf("classify request: %w", err)
	}

	return &Result{Riskiness: 1 - probabilities.Normal, AttackProbabilities: probabilities}, nil
}
