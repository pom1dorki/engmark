package catalog_postgres_repository

import (
	"context"
	"fmt"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const deckColumns = `id, slug, title, kind, created_at`

func (r *Repository) ListDecks(ctx context.Context) ([]catalog_domain.Deck, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT `+deckColumns+` FROM decks ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list decks: %w", err)
	}
	defer rows.Close()

	decks := make([]catalog_domain.Deck, 0)
	for rows.Next() {
		deck, err := scanDeck(rows)
		if err != nil {
			return nil, err
		}
		decks = append(decks, deck)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list decks rows: %w", err)
	}
	return decks, nil
}

type deckScanner interface {
	Scan(dest ...any) error
}

func scanDeck(row deckScanner) (catalog_domain.Deck, error) {
	var d catalog_domain.Deck
	if err := row.Scan(&d.ID, &d.Slug, &d.Title, &d.Kind, &d.CreatedAt); err != nil {
		return catalog_domain.Deck{}, fmt.Errorf("scan deck: %w", err)
	}
	return d, nil
}
