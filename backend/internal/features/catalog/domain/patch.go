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
	Version          int
	Word             Nullable[string]
	Translation      Nullable[string]
	IPA              Nullable[string]
	RusTrans         Nullable[string]
	Stress           Nullable[string]
	Pos              Nullable[string]
	PosRu            Nullable[string]
	ExtraLabel       Nullable[string]
	Extra            Nullable[string]
	Style            Nullable[string]
	Example          Nullable[string]
	ExampleHighlight Nullable[string]
	ExampleRu        Nullable[string]
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
	applyString(&card.RusTrans, patch.RusTrans)
	applyString(&card.Stress, patch.Stress)
	applyString(&card.Pos, patch.Pos)
	applyString(&card.PosRu, patch.PosRu)
	applyString(&card.ExtraLabel, patch.ExtraLabel)
	applyString(&card.Extra, patch.Extra)
	applyString(&card.Style, patch.Style)
	applyString(&card.Example, patch.Example)
	applyString(&card.ExampleHighlight, patch.ExampleHighlight)
	applyString(&card.ExampleRu, patch.ExampleRu)

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
