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
			rus_trans = $6,
			stress = $7,
			pos = $8,
			pos_ru = $9,
			extra_label = $10,
			extra = $11,
			style = $12,
			example = $13,
			example_highlight = $14,
			example_ru = $15
		WHERE id = $1 AND version = $2
		RETURNING ` + cardColumns

	updated, err := scanCard(r.pool.QueryRow(ctx, query,
		card.ID,
		card.Version,
		card.Word,
		card.Translation,
		card.IPA,
		card.RusTrans,
		card.Stress,
		card.Pos,
		card.PosRu,
		card.ExtraLabel,
		card.Extra,
		card.Style,
		card.Example,
		card.ExampleHighlight,
		card.ExampleRu,
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
