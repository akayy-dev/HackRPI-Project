package security

import "testing"

func TestRiskPolicyAndLabelValidation(t *testing.T) {
	labels := map[string]float64{}
	for _, name := range classLabels {
		labels[name] = 0
	}
	labels[normalLabel] = 0.9
	labels["66 - SQL Injection"] = 0.7
	p := &Prediction{Risk: 0.7, Labels: labels}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	p.Risk = 0.1
	if p.Validate() == nil {
		t.Fatal("accepted 1-Normal instead of maximum attack score")
	}
	p.Risk = 0.7
	delete(p.Labels, "66 - SQL Injection")
	if p.Validate() == nil {
		t.Fatal("accepted incomplete scores")
	}
	if (*Prediction)(nil).Validate() == nil {
		t.Fatal("accepted nil result")
	}
}
