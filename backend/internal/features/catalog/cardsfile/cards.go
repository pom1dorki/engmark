package cardsfile

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type cardEntry struct {
	Word               string `json:"word"`
	Translation        string `json:"translation"`
	IPA                string `json:"ipa"`
	Pronunciation      string `json:"pronunciation"`
	StressNote         string `json:"stressNote"`
	Pos                string `json:"pos"`
	Grammar            string `json:"grammar"`
	Usage              string `json:"usage"`
	Example            string `json:"example"`
	ExampleHighlight   string `json:"exampleHighlight"`
	ExampleTranslation string `json:"exampleTranslation"`
}

func Read(path string) ([]catalog_domain.Card, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var entries []cardEntry
	if err := dec.Decode(&entries); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	if dec.More() {
		return nil, fmt.Errorf("decode %s: extra data after the card list", path)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("%s has no cards", path)
	}

	cards := make([]catalog_domain.Card, len(entries))
	for i, entry := range entries {
		card := catalog_domain.Card{
			Word:               entry.Word,
			Translation:        entry.Translation,
			IPA:                entry.IPA,
			Pronunciation:      entry.Pronunciation,
			StressNote:         entry.StressNote,
			Pos:                entry.Pos,
			Grammar:            entry.Grammar,
			Usage:              entry.Usage,
			Example:            entry.Example,
			ExampleHighlight:   entry.ExampleHighlight,
			ExampleTranslation: entry.ExampleTranslation,
		}
		if err := card.Validate(); err != nil {
			return nil, fmt.Errorf("card %d: %w", i+1, err)
		}
		cards[i] = card
	}
	return cards, nil
}
