package catalog_domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

const (
	PosVerb = "verb"
	PosNoun = "noun"
	PosAdj  = "adj"
	PosAdv  = "adv"

	maxWord        = 80
	maxTranslation = 300
	maxExample     = 400
	maxNote        = 500
)

type Card struct {
	ID               int64
	DeckID           int64
	Version          int
	Word             string
	Translation      string
	IPA              string
	RusTrans         string
	Stress           string
	Pos              string
	PosRu            string
	ExtraLabel       string
	Extra            string
	Style            string
	Example          string
	ExampleHighlight string
	ExampleRu        string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (c *Card) Validate() error {
	c.Word = strings.TrimSpace(c.Word)
	c.Translation = strings.TrimSpace(c.Translation)
	c.Pos = strings.TrimSpace(c.Pos)
	c.PosRu = strings.TrimSpace(c.PosRu)
	c.IPA = strings.TrimSpace(c.IPA)
	c.RusTrans = strings.TrimSpace(c.RusTrans)
	c.Stress = strings.TrimSpace(c.Stress)
	c.ExtraLabel = strings.TrimSpace(c.ExtraLabel)
	c.Extra = strings.TrimSpace(c.Extra)
	c.Style = strings.TrimSpace(c.Style)
	c.Example = strings.TrimSpace(c.Example)
	c.ExampleHighlight = strings.TrimSpace(c.ExampleHighlight)
	c.ExampleRu = strings.TrimSpace(c.ExampleRu)

	if c.Word == "" || c.Translation == "" || c.Pos == "" || c.PosRu == "" {
		return fmt.Errorf("word, translation, pos and posRu are required: %w", core_errors.ErrInvalidArgument)
	}

	switch c.Pos {
	case PosVerb, PosNoun, PosAdj, PosAdv:
	default:
		return fmt.Errorf("unsupported pos %q: %w", c.Pos, core_errors.ErrInvalidArgument)
	}

	if utf8.RuneCountInString(c.Word) > maxWord {
		return fmt.Errorf("word too long: %w", core_errors.ErrInvalidArgument)
	}
	if utf8.RuneCountInString(c.Translation) > maxTranslation {
		return fmt.Errorf("translation too long: %w", core_errors.ErrInvalidArgument)
	}
	if utf8.RuneCountInString(c.Example) > maxExample {
		return fmt.Errorf("example too long: %w", core_errors.ErrInvalidArgument)
	}

	for _, note := range []string{c.IPA, c.RusTrans, c.Stress, c.ExtraLabel, c.Extra, c.Style, c.ExampleHighlight, c.ExampleRu} {
		if utf8.RuneCountInString(note) > maxNote {
			return fmt.Errorf("note too long: %w", core_errors.ErrInvalidArgument)
		}
	}

	if c.ExampleHighlight != "" {
		if !strings.Contains(strings.ToLower(c.Example), strings.ToLower(c.ExampleHighlight)) {
			return fmt.Errorf("exampleHighlight is not in example: %w", core_errors.ErrInvalidArgument)
		}
	}

	return nil
}
