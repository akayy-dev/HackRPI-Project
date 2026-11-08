package classifier

import (
	"fmt"
	"math"

	"gonum.org/v1/gonum/mat"
)

// SigmoidClassifier applies the trained linear weights and sigmoid activation.
// Weights and Biases must not be mutated while predictions are running.
type SigmoidClassifier struct {
	Weights *mat.Dense
	Biases  []float64
}

// NewSigmoidClassifier validates a head with one row for each of the 14 labels.
func NewSigmoidClassifier(weights *mat.Dense, biases []float64) (*SigmoidClassifier, error) {
	if weights == nil {
		return nil, fmt.Errorf("weights matrix cannot be nil")
	}
	if biases == nil {
		return nil, fmt.Errorf("biases slice cannot be nil")
	}
	rows, cols := weights.Dims()
	if rows != 14 || cols == 0 || len(biases) != rows {
		return nil, fmt.Errorf("expected 14 weight rows and matching biases, got %dx%d weights and %d biases", rows, cols, len(biases))
	}
	for i, bias := range biases {
		if math.IsNaN(bias) || math.IsInf(bias, 0) {
			return nil, fmt.Errorf("bias %d is not finite", i)
		}
		for j := 0; j < cols; j++ {
			if value := weights.At(i, j); math.IsNaN(value) || math.IsInf(value, 0) {
				return nil, fmt.Errorf("weight at (%d, %d) is not finite", i, j)
			}
		}
	}

	return &SigmoidClassifier{
		Weights: weights,
		Biases:  biases,
	}, nil
}

// ClassifyAttack returns independent sigmoid probabilities in training-label order.
func (c *SigmoidClassifier) ClassifyAttack(embedding []float32) (AttackProbabilities, error) {

	rows, cols := c.Weights.Dims()

	if len(embedding) != cols {
		return AttackProbabilities{}, fmt.Errorf("mismatch error: embedding size (%d) does not match weights columns (%d)", len(embedding), cols)
	}

	// Convert the embedding matrix to float64
	x := make([]float64, len(embedding))
	for i, v := range embedding {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return AttackProbabilities{}, fmt.Errorf("embedding value %d is not finite", i)
		}
		x[i] = float64(v)
	}

	// make a new vector from the embedding
	input := mat.NewVecDense(cols, x)

	// prediction score
	score := mat.NewVecDense(rows, nil)
	// multiply the weights by the input vector to get the score
	// score w^Tx
	score.MulVec(c.Weights, input)

	probabilities := make([]float64, rows)

	for i := 0; i < rows; i++ {
		// add the bias to the score
		// the +b in w^Tx + b
		z := score.AtVec(i) + c.Biases[i]

		// apply the sigmoid function to get the probability
		probabilities[i] = 1 / (1 + math.Exp(-z))
	}

	prediction := AttackProbabilities{
		Normal:                   probabilities[0],
		ProtocolManipulation:     probabilities[1],
		CodeInjection:            probabilities[2],
		OSCommandInjection:       probabilities[3],
		PathTraversal:            probabilities[4],
		SQLInjection:             probabilities[5],
		DictionaryPasswordAttack: probabilities[6],
		VulnerabilityScanning:    probabilities[7],
		InputDataManipulation:    probabilities[8],
		CommandInjection:         probabilities[9],
		HTTPVerbTampering:        probabilities[10],
		SourceSpoofing:           probabilities[11],
		HTTPResponseSplitting:    probabilities[12],
		HTTPRequestSmuggling:     probabilities[13],
	}

	return prediction, nil
}
