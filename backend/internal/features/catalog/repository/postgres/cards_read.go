package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type cardScanner interface {
	Scan(dest ...any) error
}

func scanCard(row cardScanner) (catalog_domain.Card, error) {
	var c catalog_domain.Card
	err := row.Scan(
		&c.ID, &c.DeckID, &c.Version,
		&c.Word, &c.Translation, &c.IPA, &c.Pronunciation, &c.StressNote,
		&c.Pos, &c.Grammar, &c.Usage, &c.Example, &c.ExampleHighlight, &c.ExampleTranslation,
		&c.ArchivedAt, &c.CreatedRevision, &c.UpdatedRevision, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return catalog_domain.Card{}, fmt.Errorf("scan card: %w", err)
	}
	return c, nil
}

func collectCards(rows pgx.Rows) ([]catalog_domain.Card, error) {
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
		return nil, fmt.Errorf("cards rows: %w", err)
	}
	return cards, nil
}

func (r *Repository) ListAllCards(ctx context.Context, deckID int64) ([]catalog_domain.Card, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()
	return listActive(ctx, r.db, deckID)
}

func listActive(ctx context.Context, db core_postgres.DB, deckID int64) ([]catalog_domain.Card, error) {
	rows, err := db.Query(ctx, `
		SELECT `+cardColumns+`
		FROM cards
		WHERE deck_id = $1 AND archived_at IS NULL
		ORDER BY id ASC
	`, deckID)
	if err != nil {
		return nil, fmt.Errorf("list cards: %w", err)
	}
	return collectCards(rows)
}

func (r *Repository) GetCard(ctx context.Context, deckID, id int64) (catalog_domain.Card, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	card, err := scanCard(r.db.QueryRow(ctx, `SELECT `+cardColumns+` FROM cards WHERE id = $1 AND deck_id = $2`, id, deckID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return catalog_domain.Card{}, fmt.Errorf("card %d: %w", id, core_errors.ErrNotFound)
		}
		return catalog_domain.Card{}, err
	}
	return card, nil
}

func (r *Repository) GetCards(ctx context.Context, deckID int64, ids []int64) (map[int64]catalog_domain.Card, error) {
	out := make(map[int64]catalog_domain.Card, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT `+cardColumns+` FROM cards WHERE deck_id = $1 AND id = ANY($2)`, deckID, ids)
	if err != nil {
		return nil, fmt.Errorf("get cards: %w", err)
	}
	cards, err := collectCards(rows)
	if err != nil {
		return nil, err
	}
	for _, c := range cards {
		out[c.ID] = c
	}
	return out, nil
}

func (r *Repository) ListAdminCards(ctx context.Context, deckID int64, f catalog_domain.CardFilter) (catalog_domain.CardPage, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	where, args := adminFilter(deckID, f)
	var page catalog_domain.CardPage
	err := r.readTx(ctx, func(ctx context.Context, db core_postgres.DB) error {
		if err := db.QueryRow(ctx, `SELECT revision FROM decks WHERE id = $1`, deckID).Scan(&page.Revision); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return fmt.Errorf("deck revision: %w", err)
		}
		if err := db.QueryRow(ctx, `SELECT count(*) FROM cards WHERE `+where, args...).Scan(&page.Total); err != nil {
			return fmt.Errorf("count cards: %w", err)
		}
		limitArgs := append(append([]any{}, args...), f.Limit, f.Offset)
		n := len(args)
		rows, err := db.Query(ctx, `
			SELECT `+cardColumns+`
			FROM cards
			WHERE `+where+`
			ORDER BY lower(word), id
			LIMIT $`+strconv.Itoa(n+1)+` OFFSET $`+strconv.Itoa(n+2), limitArgs...)
		if err != nil {
			return fmt.Errorf("list admin cards: %w", err)
		}
		page.Items, err = collectCards(rows)
		return err
	})
	if err != nil {
		return catalog_domain.CardPage{}, err
	}
	return page, nil
}

func adminFilter(deckID int64, f catalog_domain.CardFilter) (string, []any) {
	args := []any{deckID}
	conds := []string{"deck_id = $1"}
	next := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	if f.State == catalog_domain.StateArchived {
		conds = append(conds, "archived_at IS NOT NULL")
	} else {
		conds = append(conds, "archived_at IS NULL")
	}
	if f.State == catalog_domain.StateIncomplete {
		conds = append(conds, `(ipa = '' OR pronunciation = '' OR stress_note = '' OR grammar = '' OR usage = ''
			OR example = '' OR example_highlight = '' OR example_translation = '')`)
	}
	if f.Pos != "" {
		conds = append(conds, "pos = "+next(f.Pos))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		p := next("%" + escapeLike(q) + "%")
		conds = append(conds, "(word ILIKE "+p+" OR translation ILIKE "+p+")")
	}
	return strings.Join(conds, " AND "), args
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (r *Repository) ExistingKeys(ctx context.Context, deckID int64, keys []catalog_domain.Key) (map[catalog_domain.Key]struct{}, error) {
	found := make(map[catalog_domain.Key]struct{})
	if len(keys) == 0 {
		return found, nil
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	words := make([]string, len(keys))
	poss := make([]string, len(keys))
	translations := make([]string, len(keys))
	for i, k := range keys {
		words[i], poss[i], translations[i] = k.Word, k.Pos, k.Translation
	}
	rows, err := r.db.Query(ctx, `
		SELECT lower(c.word), c.pos, c.translation
		FROM cards c
		JOIN unnest($2::text[], $3::text[], $4::text[]) AS k(word, pos, translation)
		  ON lower(c.word) = k.word AND c.pos = k.pos AND c.translation = k.translation
		WHERE c.deck_id = $1 AND c.archived_at IS NULL
	`, deckID, words, poss, translations)
	if err != nil {
		return nil, fmt.Errorf("existing keys: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k catalog_domain.Key
		if err := rows.Scan(&k.Word, &k.Pos, &k.Translation); err != nil {
			return nil, fmt.Errorf("scan key: %w", err)
		}
		found[k] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("existing keys rows: %w", err)
	}
	return found, nil
}

func (r *Repository) CurrentState(ctx context.Context, deckID int64) (catalog_domain.DeckState, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	var state catalog_domain.DeckState
	err := r.readTx(ctx, func(ctx context.Context, db core_postgres.DB) error {
		if err := db.QueryRow(ctx, `SELECT revision FROM decks WHERE id = $1`, deckID).Scan(&state.Revision); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return fmt.Errorf("deck revision: %w", err)
		}
		cards, err := listActive(ctx, db, deckID)
		if err != nil {
			return err
		}
		state.Cards = make([]catalog_domain.StateCard, len(cards))
		for i, c := range cards {
			state.Cards[i] = catalog_domain.StateCard{ID: c.ID, Version: c.Version, Data: c.Data()}
		}
		return nil
	})
	if err != nil {
		return catalog_domain.DeckState{}, err
	}
	return state, nil
}
