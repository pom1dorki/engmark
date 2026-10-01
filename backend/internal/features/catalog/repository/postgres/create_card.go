package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) CreateCard(ctx context.Context, card catalog_domain.Card) (catalog_domain.Card, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	query := `
		INSERT INTO cards (
			deck_id, word, translation, ipa, rus_trans, stress,
			pos, pos_ru, extra_label, extra, style,
			example, example_highlight, example_ru
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11,
			$12, $13, $14
		)
		RETURNING ` + cardColumns

	created, err := scanCard(r.pool.QueryRow(ctx, query,
		card.DeckID,
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
		if errors.Is(err, core_postgres_pool.ErrUniqueViolation) {
			return catalog_domain.Card{}, fmt.Errorf("create card: %w", core_errors.ErrConflict)
		}
		if errors.Is(err, core_postgres_pool.ErrViolatesForeignKey) {
			return catalog_domain.Card{}, fmt.Errorf("create card: %w", core_errors.ErrNotFound)
		}
		return catalog_domain.Card{}, err
	}
	return created, nil
}
