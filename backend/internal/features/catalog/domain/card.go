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
	ID                 int64
	DeckID             int64
	Version            int
	Word               string
	Translation        string
	IPA                string
	Pronunciation      string
	StressNote         string
	Pos                string
	Grammar            string
	Usage              string
	Example            string
	ExampleHighlight   string
	ExampleTranslation string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func PosLabel(pos string) string {
	switch pos {
	case PosVerb:
		return "глагол"
	case PosNoun:
		return "существительное"
	case PosAdj:
		return "прилагательное"
	case PosAdv:
		return "наречие"
	default:
		return ""
	}
}

func (c *Card) Normalize() {
	c.Word = strings.TrimSpace(c.Word)
	c.Translation = strings.TrimSpace(c.Translation)
	c.Pos = strings.TrimSpace(c.Pos)
	c.IPA = strings.TrimSpace(c.IPA)
	c.Pronunciation = strings.TrimSpace(c.Pronunciation)
	c.StressNote = strings.TrimSpace(c.StressNote)
	c.Grammar = strings.TrimSpace(c.Grammar)
	c.Usage = strings.TrimSpace(c.Usage)
	c.Example = strings.TrimSpace(c.Example)
	c.ExampleHighlight = strings.TrimSpace(c.ExampleHighlight)
	c.ExampleTranslation = strings.TrimSpace(c.ExampleTranslation)
}

func (c *Card) Validate() error {
	if c.Word == "" || c.Translation == "" || c.Pos == "" {
		return fmt.Errorf("word, translation and pos are required: %w", core_errors.ErrInvalidArgument)
	}
	if !englishWord(c.Word) {
		return fmt.Errorf("word must be English letters: %w", core_errors.ErrInvalidArgument)
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

	for _, note := range []string{c.IPA, c.Pronunciation, c.StressNote, c.Grammar, c.Usage, c.ExampleHighlight, c.ExampleTranslation} {
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

func englishWord(word string) bool {
	letter := false
	prevSpace := true
	for _, r := range word {
		switch {
		case r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z':
			letter = true
			prevSpace = false
		case r == '\'' || r == '-':
			if prevSpace {
				return false
			}
			prevSpace = false
		case r == ' ':
			if prevSpace {
				return false
			}
			prevSpace = true
		default:
			return false
		}
	}
	return letter && !prevSpace
}
