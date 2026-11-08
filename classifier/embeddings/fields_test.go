package embeddings

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSerializationMatchesSuppliedPythonExamples(t *testing.T) {
	paths, err := filepath.Glob("testdata/training_examples/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 6 {
		t.Fatalf("expected six supplied JSON fixtures, got %d", len(paths))
	}
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var fields RequestFields
			if err := json.Unmarshal(data, &fields); err != nil {
				t.Fatal(err)
			}
			expected, err := os.ReadFile(strings.TrimSuffix(path, ".json") + ".txt")
			if err != nil {
				t.Fatal(err)
			}
			if got := SerializeRequest(fields); got != string(expected) {
				t.Fatalf("Go serialization differs from supplied Python output\ngot:\n%s\nwant:\n%s", got, expected)
			}
		})
	}
}

func TestFormatterExcludesFieldsAbsentFromTraining(t *testing.T) {
	r := httptest.NewRequest("GET", "http://test-site.com/", nil)
	r.Header.Set("Authorization", "secret")
	r.Header.Set("X-Forwarded-For", "127.0.0.1")
	r.Header.Set("Transfer-Encoding", "chunked")
	r.Header.Set("Content-Length", "4")
	text, err := ConvertRequestToEmbedFormat(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"authorization:", "x-forwarded-for:", "transfer-encoding:", "content-length:"} {
		if strings.Contains(text, field) {
			t.Errorf("non-training field was embedded: %s", field)
		}
	}
}

func TestSerializerPreservesWhitespaceAndEncodedValues(t *testing.T) {
	fields := RequestFields{Method: "GET", Target: "search.php?q=abc%27%2f%2a%2a%2foR%2f%2a%2a%2f%271%27%3d%271", Body: " "}
	want := "method: GET\npath: " + fields.Target + "\nbody:  "
	if got := SerializeRequest(fields); got != want {
		t.Fatalf("request values were changed: %q", got)
	}
}
