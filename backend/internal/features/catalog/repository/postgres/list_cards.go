package catalog_postgres_repository

import (
	"context"
	"fmt"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) ListAllCards(ctx context.Context, deckID int64) ([]catalog_domain.Card, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT `+cardColumns+`
		FROM cards
		WHERE deck_id = $1
		ORDER BY id ASC
	`, deckID)
	if err != nil {
		return nil, fmt.Errorf("list cards: %w", err)
	}
	defer rows.Close()

	cards := make([]catalog_domain.Card, 0)
	for rows.Next() {
		card, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, card)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list cards rows: %w", err)
	}
	return cards, nil
}

type cardScanner interface {
	Scan(dest ...any) error
}

func scanCard(row cardScanner) (catalog_domain.Card, error) {
	var c catalog_domain.Card
	err := row.Scan(
		&c.ID,
		&c.DeckID,
		&c.Version,
		&c.Word,
		&c.Translation,
		&c.IPA,
		&c.Pronunciation,
		&c.StressNote,
		&c.Pos,
		&c.Grammar,
		&c.Usage,
		&c.Example,
		&c.ExampleHighlight,
		&c.ExampleTranslation,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err != nil {
		return catalog_domain.Card{}, fmt.Errorf("scan card: %w", err)
	}
	return c, nil
}
