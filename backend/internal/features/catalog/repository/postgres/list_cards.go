package catalog_postgres_repository

import (
	"context"
	"fmt"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) ListCards(ctx context.Context, deckID int64, limit, offset int) ([]catalog_domain.Card, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	query := `
		SELECT ` + cardColumns + `
		FROM cards
		WHERE deck_id = $1
		ORDER BY id ASC
		LIMIT $2 OFFSET $3`

	rows, err := r.pool.Query(ctx, query, deckID, limit, offset)
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

func (r *Repository) CountCards(ctx context.Context, deckID int64) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	var total int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM cards WHERE deck_id = $1`, deckID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("count cards: %w", err)
	}
	return total, nil
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
		&c.RusTrans,
		&c.Stress,
		&c.Pos,
		&c.PosRu,
		&c.ExtraLabel,
		&c.Extra,
		&c.Style,
		&c.Example,
		&c.ExampleHighlight,
		&c.ExampleRu,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err != nil {
		return catalog_domain.Card{}, fmt.Errorf("scan card: %w", err)
	}
	return c, nil
}
