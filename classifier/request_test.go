package classifier

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gonum.org/v1/gonum/mat"
	"hackrpi-project/classifier/embeddings"
)

type embedFunc func(context.Context, string) (*embeddings.EmbeddingResponse, error)

func (f embedFunc) Embed(ctx context.Context, text string) (*embeddings.EmbeddingResponse, error) {
	return f(ctx, text)
}

func TestLoadedHeadClassifiesRequestAndPreservesBody(t *testing.T) {
	head, err := LoadSigmoidClassifier("weights.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, cols := head.Weights.Dims()
	if rows != 14 || cols != 768 {
		t.Fatalf("unexpected matrix: %dx%d", rows, cols)
	}
	embedder := embedFunc(func(ctx context.Context, text string) (*embeddings.EmbeddingResponse, error) {
		if !strings.Contains(text, "body: payload") {
			t.Fatalf("missing request body: %s", text)
		}
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("embedding deadline missing")
		}
		return &embeddings.EmbeddingResponse{Embeddings: [][]float32{make([]float32, 768)}}, nil
	})
	c, err := NewRequestClassifier(head, embedder)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "http://example.test/", strings.NewReader("payload"))
	result, err := c.Classify(r.Context(), r)
	if err != nil {
		t.Fatal(err)
	}
	want := 1 - 1/(1+math.Exp(-head.Biases[0]))
	if math.Abs(result.Riskiness-want) > 1e-12 {
		t.Fatalf("risk=%v, want %v", result.Riskiness, want)
	}
	if result.AttackProbabilities.SQLInjection != 1/(1+math.Exp(-head.Biases[5])) {
		t.Fatal("attack probabilities were not returned")
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || string(body) != "payload" {
		t.Fatalf("body changed: %q, %v", body, err)
	}
}

func TestRequestClassifierRejectsEmbeddingFailures(t *testing.T) {
	head, err := NewSigmoidClassifier(mat.NewDense(14, 768, nil), make([]float64, 14))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		response *embeddings.EmbeddingResponse
		err      error
	}{
		{name: "service unavailable", err: errors.New("unavailable")},
		{name: "nil response"},
		{name: "empty response", response: &embeddings.EmbeddingResponse{}},
		{name: "wrong dimensions", response: &embeddings.EmbeddingResponse{Embeddings: [][]float32{{0}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, err := NewRequestClassifier(head, embedFunc(func(context.Context, string) (*embeddings.EmbeddingResponse, error) { return tc.response, tc.err }))
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest("GET", "/", nil)
			if _, err := c.Classify(r.Context(), r); err == nil {
				t.Fatal("expected embedding failure")
			}
		})
	}
}

func TestLoadSigmoidClassifierRejectsMalformedWeights(t *testing.T) {
	for _, data := range []string{"{", `{}`, `{"metadata":{"embedding_dim":768,"labels":["000 - Normal"]},"weights":{"head.head.weight":[[1]],"head.head.bias":[0]}}`} {
		path := filepath.Join(t.TempDir(), "weights.json")
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadSigmoidClassifier(path); err == nil {
			t.Fatal("accepted malformed weights")
		}
	}
	if _, err := NewSigmoidClassifier(mat.NewDense(14, 768, nil), []float64{0}); err == nil {
		t.Fatal("accepted mismatched biases")
	}
}
