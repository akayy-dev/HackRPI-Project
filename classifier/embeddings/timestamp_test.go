package embeddings

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeTimestampPreservesCalendarFields(t *testing.T) {
	for _, input := range []string{
		"2026-03-15T12:34:56.123456789Z",
		"2024-02-29T23:59:59.123456789-05:00",
		"2026-03-01T00:00:00+14:00",
		"2025-12-31T23:59:59-08:00",
		"2020-02-29T01:02:03Z",
	} {
		t.Run(input, func(t *testing.T) {
			original, err := time.Parse(time.RFC3339Nano, input)
			if err != nil {
				t.Fatal(err)
			}
			got := NormalizeTimestamp(original)
			_, originalOffset := original.Zone()
			_, gotOffset := got.Zone()
			if got.Year() != 2020 || got.Month() != original.Month() || got.Day() != original.Day() || got.Hour() != original.Hour() || got.Minute() != original.Minute() || got.Second() != original.Second() || got.Nanosecond() != original.Nanosecond() || gotOffset != originalOffset {
				t.Fatalf("normalization changed more than the year: %s -> %s", original.Format(time.RFC3339Nano), got.Format(time.RFC3339Nano))
			}
		})
	}
}

func TestEmbeddingUsesNormalizedTimestampAndKeepsOriginal(t *testing.T) {
	original := time.Date(2026, time.March, 15, 12, 34, 56, 123456789, time.UTC)
	r := httptest.NewRequest("POST", "/", strings.NewReader("unchanged"))
	r.Header.Set("Date", "Sun, 15 Mar 2026 12:34:56 GMT")
	r = WithRequestTimestamp(r, original)
	text, err := ConvertRequestToEmbedFormat(r)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(text, "timestamp: 15/Mar/2020:12:34:56 +0000\n") {
		t.Fatalf("model received incorrect timestamp: %s", text)
	}
	if !RequestTimestamp(r).Equal(original) || r.Header.Get("Date") != "Sun, 15 Mar 2026 12:34:56 GMT" {
		t.Fatal("original request time or Date header was modified")
	}
}

func TestMissingTimestampUsesCurrentTimeInTrainingYear(t *testing.T) {
	before := time.Now().UTC()
	r := WithRequestTimestamp(httptest.NewRequest("GET", "/", nil), time.Time{})
	original := RequestTimestamp(r)
	if original.Before(before) || original.After(time.Now().UTC()) {
		t.Fatal("missing timestamp did not use the current time")
	}
	if NormalizeTimestamp(original).Year() != 2020 {
		t.Fatal("default timestamp is outside the training year")
	}
}
