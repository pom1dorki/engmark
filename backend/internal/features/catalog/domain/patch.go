package catalog_domain

import (
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

type Nullable[T any] struct {
	Value *T
	Set   bool
}

type CardPatch struct {
	Version            int
	Word               Nullable[string]
	Translation        Nullable[string]
	IPA                Nullable[string]
	Pronunciation      Nullable[string]
	StressNote         Nullable[string]
	Pos                Nullable[string]
	Grammar            Nullable[string]
	Usage              Nullable[string]
	Example            Nullable[string]
	ExampleHighlight   Nullable[string]
	ExampleTranslation Nullable[string]
}

func Apply(card Card, patch CardPatch) (Card, error) {
	if patch.Version != card.Version {
		return Card{}, fmt.Errorf(
			"card %d version %d != %d: %w",
			card.ID, patch.Version, card.Version, core_errors.ErrConflict,
		)
	}

	applyString(&card.Word, patch.Word)
	applyString(&card.Translation, patch.Translation)
	applyString(&card.IPA, patch.IPA)
	applyString(&card.Pronunciation, patch.Pronunciation)
	applyString(&card.StressNote, patch.StressNote)
	applyString(&card.Pos, patch.Pos)
	applyString(&card.Grammar, patch.Grammar)
	applyString(&card.Usage, patch.Usage)
	applyString(&card.Example, patch.Example)
	applyString(&card.ExampleHighlight, patch.ExampleHighlight)
	applyString(&card.ExampleTranslation, patch.ExampleTranslation)

	if err := card.Validate(); err != nil {
		return Card{}, err
	}
	return card, nil
}

func applyString(dst *string, n Nullable[string]) {
	if !n.Set || n.Value == nil {
		return
	}
	*dst = *n.Value
}
