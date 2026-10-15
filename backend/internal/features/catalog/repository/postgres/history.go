package catalog_postgres_repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func decodeData(raw []byte) (catalog_domain.CardData, error) {
	var d catalog_domain.CardData
	if err := json.Unmarshal(raw, &d); err != nil {
		return catalog_domain.CardData{}, fmt.Errorf("decode card data: %w", err)
	}
	return d, nil
}

const versionColumns = `v.card_id, v.version, v.revision, v.data, v.archived, v.created_at`

func scanVersion(row cardScanner) (catalog_domain.CardVersion, error) {
	var v catalog_domain.CardVersion
	var raw []byte
	if err := row.Scan(&v.CardID, &v.Version, &v.Revision, &raw, &v.Archived, &v.CreatedAt); err != nil {
		return catalog_domain.CardVersion{}, fmt.Errorf("scan card version: %w", err)
	}
	data, err := decodeData(raw)
	if err != nil {
		return catalog_domain.CardVersion{}, err
	}
	v.Data = data
	return v, nil
}

func (r *Repository) ListCardVersions(ctx context.Context, deckID, cardID int64) ([]catalog_domain.CardVersion, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT `+versionColumns+`
		FROM card_versions v
		WHERE v.card_id = $1 AND v.deck_id = $2
		ORDER BY v.version DESC
	`, cardID, deckID)
	if err != nil {
		return nil, fmt.Errorf("list card versions: %w", err)
	}
	defer rows.Close()

	out := make([]catalog_domain.CardVersion, 0)
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list card versions rows: %w", err)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("card %d: %w", cardID, core_errors.ErrNotFound)
	}
	return out, nil
}

func (r *Repository) GetCardVersion(ctx context.Context, deckID, cardID int64, version int) (catalog_domain.CardVersion, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	v, err := scanVersion(r.db.QueryRow(ctx, `
		SELECT `+versionColumns+`
		FROM card_versions v
		WHERE v.card_id = $1 AND v.deck_id = $2 AND v.version = $3
	`, cardID, deckID, version))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return catalog_domain.CardVersion{}, fmt.Errorf("card %d v%d: %w", cardID, version, core_errors.ErrNotFound)
		}
		return catalog_domain.CardVersion{}, err
	}
	return v, nil
}

func (r *Repository) ListChangesSince(ctx context.Context, deckID, since int64) (catalog_domain.Changes, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	changes := catalog_domain.Changes{Since: since, Items: []catalog_domain.CardChange{}}
	err := r.readTx(ctx, func(ctx context.Context, db core_postgres.DB) error {
		if err := db.QueryRow(ctx, `SELECT revision FROM decks WHERE id = $1`, deckID).Scan(&changes.Revision); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return fmt.Errorf("deck revision: %w", err)
		}
		rows, err := db.Query(ctx, `
			SELECT `+cardColumnsAs("c")+`,
			       b.version, b.revision, b.data, b.archived, b.created_at
			FROM cards c
			LEFT JOIN LATERAL (
				SELECT cv.version, cv.revision, cv.data, cv.archived, cv.created_at
				FROM card_versions cv
				WHERE cv.card_id = c.id AND cv.revision <= $2
				ORDER BY cv.version DESC
				LIMIT 1
			) b ON true
			WHERE c.deck_id = $1 AND c.updated_revision > $2
			ORDER BY c.id
		`, deckID, since)
		if err != nil {
			return fmt.Errorf("list changes: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var (
				c        catalog_domain.Card
				version  *int
				revision *int64
				raw      []byte
				archived *bool
				created  *time.Time
			)
			if err := rows.Scan(
				&c.ID, &c.DeckID, &c.Version,
				&c.Word, &c.Translation, &c.IPA, &c.Pronunciation, &c.StressNote,
				&c.Pos, &c.Grammar, &c.Usage, &c.Example, &c.ExampleHighlight, &c.ExampleTranslation,
				&c.ArchivedAt, &c.CreatedRevision, &c.UpdatedRevision, &c.CreatedAt, &c.UpdatedAt,
				&version, &revision, &raw, &archived, &created,
			); err != nil {
				return fmt.Errorf("scan change: %w", err)
			}
			item := catalog_domain.CardChange{Current: c}
			if version != nil && revision != nil && archived != nil && created != nil {
				data, err := decodeData(raw)
				if err != nil {
					return err
				}
				item.Base = &catalog_domain.CardVersion{
					CardID: c.ID, Version: *version, Revision: *revision,
					Data: data, Archived: *archived, CreatedAt: *created,
				}
			}
			changes.Items = append(changes.Items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return catalog_domain.Changes{}, err
	}
	return changes, nil
}

const revisionColumns = `deck_id, revision, base_revision, author, message, source,
	created_n, updated_n, archived_n, restored_n, imported_files, created_at`

func scanRevision(row cardScanner) (catalog_domain.Revision, error) {
	var rev catalog_domain.Revision
	var files []byte
	if err := row.Scan(
		&rev.DeckID, &rev.Revision, &rev.BaseRevision, &rev.Author, &rev.Message, &rev.Source,
		&rev.CreatedN, &rev.UpdatedN, &rev.ArchivedN, &rev.RestoredN, &files, &rev.CreatedAt,
	); err != nil {
		return catalog_domain.Revision{}, fmt.Errorf("scan revision: %w", err)
	}
	rev.ImportedFiles = []catalog_domain.ImportedFile{}
	if len(files) > 0 {
		if err := json.Unmarshal(files, &rev.ImportedFiles); err != nil {
			return catalog_domain.Revision{}, fmt.Errorf("decode imported files: %w", err)
		}
	}
	return rev, nil
}

func (r *Repository) ListRevisions(ctx context.Context, deckID int64, limit int, before int64) ([]catalog_domain.Revision, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT `+revisionColumns+`
		FROM deck_revisions
		WHERE deck_id = $1 AND ($2::bigint = 0 OR revision < $2::bigint)
		ORDER BY revision DESC
		LIMIT $3
	`, deckID, before, limit)
	if err != nil {
		return nil, fmt.Errorf("list revisions: %w", err)
	}
	defer rows.Close()

	out := make([]catalog_domain.Revision, 0)
	for rows.Next() {
		rev, err := scanRevision(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list revisions rows: %w", err)
	}
	return out, nil
}

func (r *Repository) GetRevision(ctx context.Context, deckID, revision int64) (catalog_domain.RevisionDetail, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	detail := catalog_domain.RevisionDetail{Changes: []catalog_domain.RevisionChange{}}
	err := r.readTx(ctx, func(ctx context.Context, db core_postgres.DB) error {
		rev, err := scanRevision(db.QueryRow(ctx, `SELECT `+revisionColumns+` FROM deck_revisions WHERE deck_id = $1 AND revision = $2`, deckID, revision))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("revision r%d: %w", revision, core_errors.ErrNotFound)
			}
			return err
		}
		detail.Revision = rev

		rows, err := db.Query(ctx, `
			SELECT cv.card_id, cv.version, cv.data,
			       CASE WHEN cv.version = 1 THEN 'created'
			            WHEN cv.archived THEN 'archived'
			            WHEN prev.archived THEN 'restored'
			            ELSE 'updated' END
			FROM card_versions cv
			LEFT JOIN card_versions prev ON prev.card_id = cv.card_id AND prev.version = cv.version - 1
			WHERE cv.deck_id = $1 AND cv.revision = $2
			ORDER BY cv.card_id
		`, deckID, revision)
		if err != nil {
			return fmt.Errorf("revision changes: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var ch catalog_domain.RevisionChange
			var raw []byte
			if err := rows.Scan(&ch.CardID, &ch.Version, &raw, &ch.Kind); err != nil {
				return fmt.Errorf("scan revision change: %w", err)
			}
			data, err := decodeData(raw)
			if err != nil {
				return err
			}
			ch.Word, ch.Translation = data.Word, data.Translation
			detail.Changes = append(detail.Changes, ch)
		}
		return rows.Err()
	})
	if err != nil {
		return catalog_domain.RevisionDetail{}, err
	}
	return detail, nil
}

func (r *Repository) SnapshotAt(ctx context.Context, deckID, revision int64) (catalog_domain.DeckState, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	state := catalog_domain.DeckState{Revision: revision, Cards: []catalog_domain.StateCard{}}
	err := r.readTx(ctx, func(ctx context.Context, db core_postgres.DB) error {
		var current int64
		if err := db.QueryRow(ctx, `SELECT revision FROM decks WHERE id = $1`, deckID).Scan(&current); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return fmt.Errorf("deck revision: %w", err)
		}
		if revision < 0 || revision > current {
			return fmt.Errorf("revision r%d: %w", revision, core_errors.ErrNotFound)
		}
		rows, err := db.Query(ctx, `
			SELECT DISTINCT ON (card_id) card_id, version, data, archived
			FROM card_versions
			WHERE deck_id = $1 AND revision <= $2
			ORDER BY card_id, version DESC
		`, deckID, revision)
		if err != nil {
			return fmt.Errorf("snapshot at r%d: %w", revision, err)
		}
		defer rows.Close()
		for rows.Next() {
			var sc catalog_domain.StateCard
			var raw []byte
			var archived bool
			if err := rows.Scan(&sc.ID, &sc.Version, &raw, &archived); err != nil {
				return fmt.Errorf("scan snapshot card: %w", err)
			}
			if archived {
				continue
			}
			data, err := decodeData(raw)
			if err != nil {
				return err
			}
			sc.Data = data
			state.Cards = append(state.Cards, sc)
		}
		return rows.Err()
	})
	if err != nil {
		return catalog_domain.DeckState{}, err
	}
	return state, nil
}
