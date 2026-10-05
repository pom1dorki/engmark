package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

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

func (r *Repository) ReplaceDeckCards(ctx context.Context, deckID int64, cards []catalog_domain.Card, sourceSHA256 string) error {
	ctx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()

	return core_postgres.WithinTx(ctx, r.pool, func(ctx context.Context, tx core_postgres.DB) error {
		txRepo := &Repository{db: tx}

		var kind string
		err := txRepo.db.QueryRow(ctx, `SELECT kind FROM decks WHERE id = $1 FOR UPDATE`, deckID).Scan(&kind)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return err
		}
		if kind != catalog_domain.DeckKindAdmin {
			return fmt.Errorf("deck %d kind %s: %w", deckID, kind, core_errors.ErrConflict)
		}

		var stored string
		err = txRepo.db.QueryRow(ctx, `SELECT source_sha256 FROM catalog_meta WHERE deck_id = $1`, deckID).Scan(&stored)
		if err == nil && stored == sourceSHA256 {
			return nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("catalog meta: %w", err)
		}

		if _, err := txRepo.db.Exec(ctx, `
			CREATE TEMP TABLE import_cards (
				word text,
				translation text,
				ipa text,
				pronunciation text,
				stress_note text,
				pos text,
				grammar text,
				usage text,
				example text,
				example_highlight text,
				example_translation text
			) ON COMMIT DROP
		`); err != nil {
			return fmt.Errorf("import table: %w", err)
		}

		_, err = txRepo.db.CopyFrom(ctx, pgx.Identifier{"import_cards"}, []string{
			"word", "translation", "ipa", "pronunciation", "stress_note",
			"pos", "grammar", "usage", "example", "example_highlight", "example_translation",
		}, pgx.CopyFromSlice(len(cards), func(i int) ([]any, error) {
			card := cards[i]
			return []any{
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
			}, nil
		}))
		if err != nil {
			return fmt.Errorf("copy cards: %w", err)
		}

		if _, err := txRepo.db.Exec(ctx, `
			INSERT INTO cards (
				deck_id, word, translation, ipa, pronunciation, stress_note,
				pos, grammar, usage, example, example_highlight, example_translation
			)
			SELECT $1, word, translation, ipa, pronunciation, stress_note,
			       pos, grammar, usage, example, example_highlight, example_translation
			FROM import_cards
			ON CONFLICT (deck_id, lower(word), pos, translation) DO UPDATE SET
				word = EXCLUDED.word,
				ipa = EXCLUDED.ipa,
				pronunciation = EXCLUDED.pronunciation,
				stress_note = EXCLUDED.stress_note,
				grammar = EXCLUDED.grammar,
				usage = EXCLUDED.usage,
				example = EXCLUDED.example,
				example_highlight = EXCLUDED.example_highlight,
				example_translation = EXCLUDED.example_translation,
				version = cards.version + 1,
				updated_at = now()
			WHERE (
				cards.word, cards.ipa, cards.pronunciation, cards.stress_note, cards.grammar, cards.usage,
				cards.example, cards.example_highlight, cards.example_translation
			) IS DISTINCT FROM (
				EXCLUDED.word, EXCLUDED.ipa, EXCLUDED.pronunciation, EXCLUDED.stress_note, EXCLUDED.grammar,
				EXCLUDED.usage, EXCLUDED.example, EXCLUDED.example_highlight, EXCLUDED.example_translation
			)
		`, deckID); err != nil {
			return fmt.Errorf("upsert cards: %w", err)
		}

		if _, err := txRepo.db.Exec(ctx, `
			DELETE FROM cards AS c
			WHERE c.deck_id = $1
			  AND NOT EXISTS (
				SELECT 1 FROM import_cards AS i
				WHERE lower(i.word) = lower(c.word)
				  AND i.pos = c.pos
				  AND i.translation = c.translation
			  )
		`, deckID); err != nil {
			return fmt.Errorf("delete cards absent from import: %w", err)
		}

		if _, err := txRepo.db.Exec(ctx, `
			INSERT INTO catalog_meta (deck_id, source_sha256)
			VALUES ($1, $2)
			ON CONFLICT (deck_id) DO UPDATE
			SET source_sha256 = EXCLUDED.source_sha256,
			    synced_at = now()
		`, deckID, sourceSHA256); err != nil {
			return fmt.Errorf("catalog meta write: %w", err)
		}
		return nil
	})
}
