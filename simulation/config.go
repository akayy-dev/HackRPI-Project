package simulation

import (
	"fmt"
	"math"

	"hackrpi-project/security"
)

// Config keeps simulation choices separate from the production proxy setting.
// The logger still owns persistence; session is used by the database-free preview.
type Config struct {
	Threshold   float64
	DefaultMode security.ModelMode
	Models      map[security.ModelMode]security.Classifier
	Persistence string
}

func (c *Config) validate() error {
	if math.IsNaN(c.Threshold) || math.IsInf(c.Threshold, 0) || c.Threshold < 0 || c.Threshold > 1 {
		return fmt.Errorf("simulation threshold must be in [0,1]")
	}
	if c.DefaultMode == "" {
		c.DefaultMode = security.ModelTrained
	}
	if c.DefaultMode != security.ModelTrained && c.DefaultMode != security.ModelOriginal2020 {
		return fmt.Errorf("simulation model mode must be trained or original_2020")
	}
	if c.Persistence == "" {
		c.Persistence = "mongodb"
	}
	if c.Persistence != "mongodb" && c.Persistence != "session" {
		return fmt.Errorf("simulation persistence must be mongodb or session")
	}
	if len(c.Models) > 0 {
		for _, mode := range []security.ModelMode{security.ModelTrained, security.ModelOriginal2020} {
			if c.Models[mode] == nil {
				return fmt.Errorf("simulation classifier for %s is required", mode)
			}
		}
		if c.Models[c.DefaultMode] == nil {
			return fmt.Errorf("default simulation model is unavailable")
		}
	}
	return nil
}
