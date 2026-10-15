package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const deckColumns = `id, slug, title, kind, revision, created_at, updated_at`

type deckScanner interface {
	Scan(dest ...any) error
}

func scanDeck(row deckScanner) (catalog_domain.Deck, error) {
	var d catalog_domain.Deck
	if err := row.Scan(&d.ID, &d.Slug, &d.Title, &d.Kind, &d.Revision, &d.CreatedAt, &d.UpdatedAt); err != nil {
		return catalog_domain.Deck{}, fmt.Errorf("scan deck: %w", err)
	}
	return d, nil
}

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

func (r *Repository) GetAdminDeck(ctx context.Context) (catalog_domain.Deck, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	deck, err := scanDeck(r.db.QueryRow(ctx, `SELECT `+deckColumns+` FROM decks WHERE kind = $1`, catalog_domain.DeckKindAdmin))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return catalog_domain.Deck{}, fmt.Errorf("admin deck: %w", core_errors.ErrNotFound)
		}
		return catalog_domain.Deck{}, fmt.Errorf("admin deck: %w", err)
	}
	return deck, nil
}

func (r *Repository) GetDeckSummary(ctx context.Context) (catalog_domain.DeckSummary, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	var s catalog_domain.DeckSummary
	err := r.db.QueryRow(ctx, `
		SELECT d.id, d.slug, d.title, d.kind, d.revision, d.created_at, d.updated_at,
		       (SELECT count(*) FROM cards c WHERE c.deck_id = d.id AND c.archived_at IS NULL),
		       (SELECT count(*) FROM cards c WHERE c.deck_id = d.id AND c.archived_at IS NOT NULL)
		FROM decks d
		WHERE d.kind = $1
	`, catalog_domain.DeckKindAdmin).Scan(
		&s.ID, &s.Slug, &s.Title, &s.Kind, &s.Revision, &s.CreatedAt, &s.UpdatedAt,
		&s.ActiveCards, &s.ArchivedCards,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return catalog_domain.DeckSummary{}, fmt.Errorf("admin deck: %w", core_errors.ErrNotFound)
		}
		return catalog_domain.DeckSummary{}, fmt.Errorf("deck summary: %w", err)
	}
	return s, nil
}
