package classifier

import (
	"fmt"
	"math"
)

// AttackProbabilities contains the independent sigmoid scores for all 14 labels.
type AttackProbabilities struct {
	Normal                   float64 `bson:"normal" json:"normal"`
	ProtocolManipulation     float64 `bson:"protocol_manipulation" json:"protocol_manipulation"`
	CodeInjection            float64 `bson:"code_injection" json:"code_injection"`
	OSCommandInjection       float64 `bson:"os_command_injection" json:"os_command_injection"`
	PathTraversal            float64 `bson:"path_traversal" json:"path_traversal"`
	SQLInjection             float64 `bson:"sql_injection" json:"sql_injection"`
	DictionaryPasswordAttack float64 `bson:"dictionary_password_attack" json:"dictionary_password_attack"`
	VulnerabilityScanning    float64 `bson:"vulnerability_scanning" json:"vulnerability_scanning"`
	InputDataManipulation    float64 `bson:"input_data_manipulation" json:"input_data_manipulation"`
	CommandInjection         float64 `bson:"command_injection" json:"command_injection"`
	HTTPVerbTampering        float64 `bson:"http_verb_tampering" json:"http_verb_tampering"`
	SourceSpoofing           float64 `bson:"source_spoofing" json:"source_spoofing"`
	HTTPResponseSplitting    float64 `bson:"http_response_splitting" json:"http_response_splitting"`
	HTTPRequestSmuggling     float64 `bson:"http_request_smuggling" json:"http_request_smuggling"`
}

// Validate rejects non-finite values and scores outside the probability range.
func (r *Result) Validate() error {
	if r == nil {
		return fmt.Errorf("classification result is missing")
	}
	p := r.AttackProbabilities
	for _, value := range []float64{
		r.Riskiness, p.Normal, p.ProtocolManipulation, p.CodeInjection,
		p.OSCommandInjection, p.PathTraversal, p.SQLInjection,
		p.DictionaryPasswordAttack, p.VulnerabilityScanning, p.InputDataManipulation,
		p.CommandInjection, p.HTTPVerbTampering, p.SourceSpoofing,
		p.HTTPResponseSplitting, p.HTTPRequestSmuggling,
	} {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
			return fmt.Errorf("classification probabilities must be finite and between 0 and 1")
		}
	}
	return nil
}
