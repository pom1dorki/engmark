package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) GetAdminDeck(ctx context.Context) (catalog_domain.Deck, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	rows, err := r.pool.Query(ctx, `SELECT `+deckColumns+` FROM decks WHERE kind = $1 ORDER BY id ASC`, catalog_domain.DeckKindAdmin)
	if err != nil {
		return catalog_domain.Deck{}, fmt.Errorf("admin deck: %w", err)
	}
	defer rows.Close()

	var decks []catalog_domain.Deck
	for rows.Next() {
		deck, err := scanDeck(rows)
		if err != nil {
			return catalog_domain.Deck{}, err
		}
		decks = append(decks, deck)
	}
	if err := rows.Err(); err != nil {
		return catalog_domain.Deck{}, fmt.Errorf("admin deck rows: %w", err)
	}
	if len(decks) == 0 {
		return catalog_domain.Deck{}, fmt.Errorf("admin deck: %w", core_errors.ErrNotFound)
	}
	if len(decks) != 1 {
		return catalog_domain.Deck{}, fmt.Errorf("%d admin decks: %w", len(decks), core_errors.ErrConflict)
	}
	return decks[0], nil
}

func (r *Repository) ReplaceDeckCards(ctx context.Context, deckID int64, cards []catalog_domain.Card) error {
	return r.pool.WithinTx(ctx, func(ctx context.Context, tx core_postgres_pool.Pool) error {
		txRepo := New(tx)

		lockCtx, cancel := context.WithTimeout(ctx, tx.OpTimeout())
		var kind string
		err := txRepo.pool.QueryRow(lockCtx, `SELECT kind FROM decks WHERE id = $1 FOR UPDATE`, deckID).Scan(&kind)
		cancel()
		if err != nil {
			if errors.Is(err, core_postgres_pool.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return err
		}
		if kind != catalog_domain.DeckKindAdmin {
			return fmt.Errorf("deck %d kind %s: %w", deckID, kind, core_errors.ErrConflict)
		}

		deleteCtx, deleteCancel := context.WithTimeout(ctx, tx.OpTimeout())
		_, err = txRepo.pool.Exec(deleteCtx, `DELETE FROM cards WHERE deck_id = $1`, deckID)
		deleteCancel()
		if err != nil {
			return fmt.Errorf("delete deck cards: %w", err)
		}

		for i := range cards {
			cards[i].DeckID = deckID
			if _, err := txRepo.CreateCard(ctx, cards[i]); err != nil {
				return err
			}
		}
		return nil
	})
}
