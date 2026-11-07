package classifier

import (
	"encoding/json"
	"fmt"
	"os"

	"hackrpi-project/classifier/embeddings"

	"gonum.org/v1/gonum/mat"
)

// LoadSigmoidClassifier reads the exported JSON head, validates its dimensions,
// and converts its row-major weight arrays into a Gonum dense matrix.
func LoadSigmoidClassifier(path string) (*SigmoidClassifier, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read weights: %w", err)
	}
	var export struct {
		Metadata struct {
			EmbeddingDim int      `json:"embedding_dim"`
			Labels       []string `json:"labels"`
			Hidden       any      `json:"hidden"`
			CacheMeta    struct {
				SerializationFingerprint string `json:"serialize_fp"`
				Prompt                   string `json:"prompt"`
			} `json:"cache_meta"`
		} `json:"metadata"`
		Weights struct {
			Weight [][]float64 `json:"head.head.weight"`
			Bias   []float64   `json:"head.head.bias"`
		} `json:"weights"`
	}
	if err := json.Unmarshal(data, &export); err != nil {
		return nil, fmt.Errorf("decode weights: %w", err)
	}
	if fingerprint := export.Metadata.CacheMeta.SerializationFingerprint; fingerprint != "" && fingerprint != embeddings.SerializationFingerprint {
		return nil, fmt.Errorf("weights serializer fingerprint %q does not match %q", fingerprint, embeddings.SerializationFingerprint)
	}
	if prompt := export.Metadata.CacheMeta.Prompt; prompt != "" && prompt != embeddings.ClassificationPrompt {
		return nil, fmt.Errorf("weights were trained with an incompatible embedding prompt")
	}
	rows, cols := len(export.Weights.Weight), export.Metadata.EmbeddingDim
	if rows != 14 || cols != 768 || len(export.Metadata.Labels) != rows || export.Metadata.Labels[0] != "000 - Normal" || export.Metadata.Hidden != nil {
		return nil, fmt.Errorf("expected a linear 14-label, 768-dimensional head with Normal as the first label")
	}
	flat := make([]float64, 0, rows*cols)
	for i, row := range export.Weights.Weight {
		if len(row) != cols {
			return nil, fmt.Errorf("weight row %d has %d columns, expected %d", i, len(row), cols)
		}
		flat = append(flat, row...)
	}
	return NewSigmoidClassifier(mat.NewDense(rows, cols, flat), export.Weights.Bias)
}
