package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const deckColumns = `id, slug, title, created_at`

func (r *Repository) ListDecks(ctx context.Context) ([]catalog_domain.Deck, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	rows, err := r.pool.Query(ctx, `SELECT `+deckColumns+` FROM decks ORDER BY id ASC`)
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

func (r *Repository) GetDeck(ctx context.Context, id int64) (catalog_domain.Deck, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	deck, err := scanDeck(r.pool.QueryRow(ctx, `SELECT `+deckColumns+` FROM decks WHERE id = $1`, id))
	if err != nil {
		if errors.Is(err, core_postgres_pool.ErrNoRows) {
			return catalog_domain.Deck{}, fmt.Errorf("deck %d: %w", id, core_errors.ErrNotFound)
		}
		return catalog_domain.Deck{}, err
	}
	return deck, nil
}

func (r *Repository) GetDeckBySlug(ctx context.Context, slug string) (catalog_domain.Deck, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	deck, err := scanDeck(r.pool.QueryRow(ctx, `SELECT `+deckColumns+` FROM decks WHERE slug = $1`, slug))
	if err != nil {
		if errors.Is(err, core_postgres_pool.ErrNoRows) {
			return catalog_domain.Deck{}, fmt.Errorf("deck %s: %w", slug, core_errors.ErrNotFound)
		}
		return catalog_domain.Deck{}, err
	}
	return deck, nil
}

type deckScanner interface {
	Scan(dest ...any) error
}

func scanDeck(row deckScanner) (catalog_domain.Deck, error) {
	var d catalog_domain.Deck
	if err := row.Scan(&d.ID, &d.Slug, &d.Title, &d.CreatedAt); err != nil {
		return catalog_domain.Deck{}, fmt.Errorf("scan deck: %w", err)
	}
	return d, nil
}
