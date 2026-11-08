package security

// normalLabel is the benign CAPEC class. The other labels are attack classes.
// Riskiness is the highest attack-class score, because the head emits
// independent sigmoids rather than one mutually exclusive probability.
const normalLabel = "000 - Normal"

// classLabels is the label order stored in valendra/threat-classifier-13082026
// meta.json. The classifier service refuses to start when the checkpoint
// order differs, and the proxy requires every label below in each response.
var classLabels = []string{
	"000 - Normal",
	"272 - Protocol Manipulation",
	"242 - Code Injection",
	"88 - OS Command Injection",
	"126 - Path Traversal",
	"66 - SQL Injection",
	"16 - Dictionary-based Password Attack",
	"310 - Scanning for Vulnerable Software",
	"153 - Input Data Manipulation",
	"248 - Command Injection",
	"274 - HTTP Verb Tampering",
	"194 - Fake the Source of Data",
	"34 - HTTP Response Splitting",
	"33 - HTTP Request Smuggling",
}
