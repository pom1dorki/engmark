package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) UpdateCard(ctx context.Context, card catalog_domain.Card) (catalog_domain.Card, error) {
	current, err := r.GetCard(ctx, card.ID)
	if err != nil {
		return catalog_domain.Card{}, err
	}
	if current.Version != card.Version {
		return catalog_domain.Card{}, fmt.Errorf(
			"card %d version %d != %d: %w",
			card.ID, card.Version, current.Version, core_errors.ErrConflict,
		)
	}

	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	query := `
		UPDATE cards SET
			version = version + 1,
			updated_at = now(),
			word = $3,
			translation = $4,
			ipa = $5,
			pronunciation = $6,
			stress_note = $7,
			pos = $8,
			grammar = $9,
			usage = $10,
			example = $11,
			example_highlight = $12,
			example_translation = $13
		WHERE id = $1 AND version = $2
		RETURNING ` + cardColumns

	updated, err := scanCard(r.pool.QueryRow(ctx, query,
		card.ID,
		card.Version,
		card.Word,
		card.Translation,
		card.IPA,
		card.Pronunciation,
		card.StressNote,
		card.Pos,
		card.Grammar,
		card.Usage,
		card.Example,
		card.ExampleHighlight,
		card.ExampleTranslation,
	))
	if err != nil {
		if errors.Is(err, core_postgres_pool.ErrNoRows) {
			return catalog_domain.Card{}, fmt.Errorf("card %d: %w", card.ID, core_errors.ErrConflict)
		}
		if errors.Is(err, core_postgres_pool.ErrUniqueViolation) {
			return catalog_domain.Card{}, fmt.Errorf("update card: %w", core_errors.ErrConflict)
		}
		return catalog_domain.Card{}, err
	}
	return updated, nil
}
