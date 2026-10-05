package catalog_service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type cardKey struct {
	word        string
	pos         string
	translation string
}

func (s *Service) ReplaceAdminCards(ctx context.Context, cards []catalog_domain.Card) error {
	if len(cards) == 0 {
		return fmt.Errorf("no cards: %w", core_errors.ErrInvalidArgument)
	}

	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return err
	}

	prepared := make([]catalog_domain.Card, len(cards))
	seen := make(map[cardKey]int, len(cards))
	for i, card := range cards {
		card.ID = 0
		card.DeckID = deck.ID
		card.Version = 0
		card.Normalize()
		if err := card.Validate(); err != nil {
			return fmt.Errorf("card %d: %w", i+1, err)
		}
		key := cardKey{
			word:        strings.ToLower(card.Word),
			pos:         card.Pos,
			translation: card.Translation,
		}
		if prev, ok := seen[key]; ok {
			return fmt.Errorf("card %d duplicates card %d: %w", i+1, prev, core_errors.ErrConflict)
		}
		seen[key] = i + 1
		prepared[i] = card
	}
	return s.repo.ReplaceDeckCards(ctx, deck.ID, prepared, sourceHash(prepared))
}

type hashCard struct {
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

func sourceHash(cards []catalog_domain.Card) string {
	rows := make([]hashCard, len(cards))
	for i, card := range cards {
		rows[i] = hashCard{
			Word:               card.Word,
			Translation:        card.Translation,
			IPA:                card.IPA,
			Pronunciation:      card.Pronunciation,
			StressNote:         card.StressNote,
			Pos:                card.Pos,
			Grammar:            card.Grammar,
			Usage:              card.Usage,
			Example:            card.Example,
			ExampleHighlight:   card.ExampleHighlight,
			ExampleTranslation: card.ExampleTranslation,
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		left, right := strings.ToLower(rows[i].Word), strings.ToLower(rows[j].Word)
		if left != right {
			return left < right
		}
		if rows[i].Pos != rows[j].Pos {
			return rows[i].Pos < rows[j].Pos
		}
		return rows[i].Translation < rows[j].Translation
	})
	raw, err := json.Marshal(rows)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
