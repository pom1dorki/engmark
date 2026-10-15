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

const (
	FieldRequired          = "required"
	FieldInvalidChars      = "invalid_chars"
	FieldTooLong           = "too_long"
	FieldUnsupportedPos    = "unsupported_pos"
	FieldHighlightNotFound = "highlight_not_found"
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
	ArchivedAt         *time.Time
	CreatedRevision    int64
	UpdatedRevision    int64
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
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

func (c *Card) Archived() bool { return c.ArchivedAt != nil }

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

func (c *Card) ValidateFields() []FieldError {
	var errs []FieldError
	add := func(field, code, message string) {
		errs = append(errs, FieldError{Field: field, Code: code, Message: message})
	}

	if c.Word == "" {
		add("word", FieldRequired, "word is required")
	} else if !englishWord(c.Word) {
		add("word", FieldInvalidChars, "word must be English letters")
	} else if utf8.RuneCountInString(c.Word) > maxWord {
		add("word", FieldTooLong, "word too long")
	}
	if c.Translation == "" {
		add("translation", FieldRequired, "translation is required")
	} else if utf8.RuneCountInString(c.Translation) > maxTranslation {
		add("translation", FieldTooLong, "translation too long")
	}

	switch c.Pos {
	case "":
		add("pos", FieldRequired, "pos is required")
	case PosVerb, PosNoun, PosAdj, PosAdv:
	default:
		add("pos", FieldUnsupportedPos, fmt.Sprintf("unsupported pos %q", c.Pos))
	}

	if utf8.RuneCountInString(c.Example) > maxExample {
		add("example", FieldTooLong, "example too long")
	}
	notes := []struct{ field, value string }{
		{"ipa", c.IPA},
		{"pronunciation", c.Pronunciation},
		{"stressNote", c.StressNote},
		{"grammar", c.Grammar},
		{"usage", c.Usage},
		{"exampleHighlight", c.ExampleHighlight},
		{"exampleTranslation", c.ExampleTranslation},
	}
	for _, note := range notes {
		if utf8.RuneCountInString(note.value) > maxNote {
			add(note.field, FieldTooLong, "note too long")
		}
	}

	if c.ExampleHighlight != "" && !strings.Contains(strings.ToLower(c.Example), strings.ToLower(c.ExampleHighlight)) {
		add("exampleHighlight", FieldHighlightNotFound, "exampleHighlight is not in example")
	}
	return errs
}

func (c *Card) Validate() error {
	errs := c.ValidateFields()
	if len(errs) == 0 {
		return nil
	}
	return fmt.Errorf("%s: %w", errs[0].Message, core_errors.ErrInvalidArgument)
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
