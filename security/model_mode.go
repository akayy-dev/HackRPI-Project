package security

import (
	"fmt"
	"strings"
	"time"
)

// ModelMode selects the head and its timestamp input convention. It does not
// change request metadata, forwarding, logging, or the blocking threshold.
type ModelMode string

const (
	ModelOriginal     ModelMode = "original"
	ModelTrained      ModelMode = "trained"
	ModelOriginal2020 ModelMode = "original_2020"
)

func (mode ModelMode) Validate() error {
	switch mode {
	case ModelOriginal, ModelTrained, ModelOriginal2020:
		return nil
	default:
		return fmt.Errorf("unknown classifier mode %q: use trained, original_2020, or original", mode)
	}
}

// ModelInputForMode changes only the first serialized timestamp's calendar year
// for the original_2020 baseline. Payload dates, addresses, and the actual request
// timestamp are preserved. Leap day remains valid because 2020 is a leap year.
func ModelInputForMode(text string, mode ModelMode) (string, error) {
	if err := mode.Validate(); err != nil {
		return "", err
	}
	if mode != ModelOriginal2020 {
		return text, nil
	}
	first, rest, multiline := strings.Cut(text, "\n")
	const prefix = "timestamp: "
	if !strings.HasPrefix(first, prefix) {
		return "", fmt.Errorf("original_2020 requires the serialized request timestamp first")
	}
	const layout = "02/Jan/2006:15:04:05 -0700"
	stamp, err := time.Parse(layout, strings.TrimPrefix(first, prefix))
	if err != nil {
		return "", fmt.Errorf("invalid model timestamp: %w", err)
	}
	stamp = time.Date(2020, stamp.Month(), stamp.Day(), stamp.Hour(), stamp.Minute(), stamp.Second(), 0, stamp.Location())
	result := prefix + stamp.Format(layout)
	if multiline {
		result += "\n" + rest
	}
	return result, nil
}
