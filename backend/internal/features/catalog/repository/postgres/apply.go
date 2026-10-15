package catalog_postgres_repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const insertCardSQL = `
	INSERT INTO cards (
		deck_id, word, translation, ipa, pronunciation, stress_note,
		pos, grammar, usage, example, example_highlight, example_translation,
		created_revision, updated_revision
	)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`

const importCardSQL = insertCardSQL + `
	ON CONFLICT (deck_id, lower(word), pos, translation) WHERE archived_at IS NULL DO NOTHING
	RETURNING id`

const createCardSQL = insertCardSQL + ` RETURNING id`

const updateFieldsSQL = `
	UPDATE cards SET
		word = $3, translation = $4, ipa = $5, pronunciation = $6, stress_note = $7, pos = $8,
		grammar = $9, usage = $10, example = $11, example_highlight = $12, example_translation = $13,
		version = version + 1, updated_revision = $14, updated_at = now()`

var (
	updateCardSQL = updateFieldsSQL + `
		WHERE id = $1 AND deck_id = $2 AND version = $15 AND archived_at IS NULL
		RETURNING ` + cardColumns
	restoreWithDataSQL = updateFieldsSQL + `, archived_at = NULL
		WHERE id = $1 AND deck_id = $2 AND version = $15 AND archived_at IS NOT NULL
		RETURNING ` + cardColumns
	archiveCardSQL = `
		UPDATE cards SET archived_at = now(), version = version + 1, updated_revision = $3, updated_at = now()
		WHERE id = $1 AND deck_id = $2 AND version = $4 AND archived_at IS NULL
		RETURNING ` + cardColumns
	restoreCardSQL = `
		UPDATE cards SET archived_at = NULL, version = version + 1, updated_revision = $3, updated_at = now()
		WHERE id = $1 AND deck_id = $2 AND version = $4 AND archived_at IS NOT NULL
		RETURNING ` + cardColumns
)

const seedMessage = "Начальная загрузка из data/cards.json"

func (r *Repository) ApplyChangeset(ctx context.Context, deckID int64, cs catalog_domain.Changeset, author, source string) (catalog_domain.ChangesetResult, error) {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()

	var result catalog_domain.ChangesetResult
	err := core_postgres.WithinTx(ctx, r.pool, func(ctx context.Context, tx core_postgres.DB) error {
		var err error
		result, err = applyChangeset(ctx, tx, deckID, cs, author, source)
		return err
	})
	if err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	return result, nil
}

func (r *Repository) SeedIfEmpty(ctx context.Context, deckID int64, cards []catalog_domain.Card) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()

	seeded := false
	err := core_postgres.WithinTx(ctx, r.pool, func(ctx context.Context, tx core_postgres.DB) error {
		var revision int64
		err := tx.QueryRow(ctx, `SELECT revision FROM decks WHERE id = $1 AND kind = $2 FOR UPDATE`, deckID, catalog_domain.DeckKindAdmin).Scan(&revision)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
			}
			return fmt.Errorf("lock deck: %w", err)
		}
		if revision != 0 {
			return nil
		}
		cs := catalog_domain.Changeset{BaseRevision: 0, Message: seedMessage, Create: cards}
		if _, err := applyChangeset(ctx, tx, deckID, cs, catalog_domain.AuthorSystem, catalog_domain.SourceSeed); err != nil {
			return err
		}
		seeded = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return seeded, nil
}

type versionRow struct {
	cardID   int64
	version  int
	data     catalog_domain.CardData
	archived bool
}

type applier struct {
	db       core_postgres.DB
	deckID   int64
	revision int64
	versions []versionRow
	result   catalog_domain.ChangesetResult
	created  int
}

func applyChangeset(ctx context.Context, db core_postgres.DB, deckID int64, cs catalog_domain.Changeset, author, source string) (catalog_domain.ChangesetResult, error) {
	revision, err := bumpRevision(ctx, db, deckID, cs.BaseRevision)
	if err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO deck_revisions (deck_id, revision, base_revision, author, message, source)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, deckID, revision, cs.BaseRevision, author, cs.Message, source); err != nil {
		return catalog_domain.ChangesetResult{}, fmt.Errorf("insert revision: %w", err)
	}

	a := &applier{db: db, deckID: deckID, revision: revision}
	a.result = catalog_domain.ChangesetResult{
		Revision: revision,
		Created:  []catalog_domain.CreatedRef{},
		Updated:  []catalog_domain.UpdatedRef{},
		Imports:  []catalog_domain.ImportResult{},
	}

	if err := a.archive(ctx, cs.Archive); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if err := a.update(ctx, cs.Update, cs.Restore); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if err := a.restore(ctx, cs.Restore, cs.Update); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if err := a.create(ctx, cs.Create); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	files, err := a.imports(ctx, cs.Imports)
	if err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if err := a.writeVersions(ctx); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}

	if files == nil {
		files = []catalog_domain.ImportedFile{}
	}
	rawFiles, err := json.Marshal(files)
	if err != nil {
		return catalog_domain.ChangesetResult{}, fmt.Errorf("encode imported files: %w", err)
	}
	if _, err := db.Exec(ctx, `
		UPDATE deck_revisions
		SET created_n = $3, updated_n = $4, archived_n = $5, restored_n = $6, imported_files = $7
		WHERE deck_id = $1 AND revision = $2
	`, deckID, revision, a.created, len(cs.Update), len(cs.Archive), len(cs.Restore), rawFiles); err != nil {
		return catalog_domain.ChangesetResult{}, fmt.Errorf("update revision counters: %w", err)
	}
	return a.result, nil
}

func bumpRevision(ctx context.Context, db core_postgres.DB, deckID, base int64) (int64, error) {
	var revision int64
	err := db.QueryRow(ctx, `
		UPDATE decks SET revision = revision + 1, updated_at = now()
		WHERE id = $1 AND revision = $2
		RETURNING revision
	`, deckID, base).Scan(&revision)
	if err == nil {
		return revision, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("bump revision: %w", err)
	}
	var current int64
	if err := db.QueryRow(ctx, `SELECT revision FROM decks WHERE id = $1`, deckID).Scan(&current); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
		}
		return 0, fmt.Errorf("read revision: %w", err)
	}
	return 0, &catalog_domain.RevisionMismatchError{Base: base, Current: current}
}

func (a *applier) track(card catalog_domain.Card, updated bool) {
	a.versions = append(a.versions, versionRow{cardID: card.ID, version: card.Version, data: card.Data(), archived: card.Archived()})
	if updated {
		a.result.Updated = append(a.result.Updated, catalog_domain.UpdatedRef{ID: card.ID, Version: card.Version})
	}
}

func fieldArgs(id, deckID int64, c catalog_domain.Card, revision int64, baseVersion int) []any {
	return []any{
		id, deckID,
		c.Word, c.Translation, c.IPA, c.Pronunciation, c.StressNote, c.Pos,
		c.Grammar, c.Usage, c.Example, c.ExampleHighlight, c.ExampleTranslation,
		revision, baseVersion,
	}
}

func (a *applier) archive(ctx context.Context, refs []catalog_domain.CardRef) error {
	for i, ref := range refs {
		card, err := scanCard(a.db.QueryRow(ctx, archiveCardSQL, ref.ID, a.deckID, a.revision, ref.BaseVersion))
		if err != nil {
			return a.explain(ctx, err, catalog_domain.SectionArchive, i, ref.ID, ref.BaseVersion, false)
		}
		a.track(card, true)
	}
	return nil
}

func (a *applier) update(ctx context.Context, updates []catalog_domain.CardUpdate, restores []catalog_domain.CardRef) error {
	paired := make(map[int64]struct{}, len(restores))
	for _, ref := range restores {
		paired[ref.ID] = struct{}{}
	}
	for i, up := range updates {
		if _, ok := paired[up.ID]; ok {
			continue
		}
		card, err := scanCard(a.db.QueryRow(ctx, updateCardSQL, fieldArgs(up.ID, a.deckID, up.Card, a.revision, up.BaseVersion)...))
		if err != nil {
			return a.explain(ctx, err, catalog_domain.SectionUpdate, i, up.ID, up.BaseVersion, false)
		}
		a.track(card, true)
	}
	return nil
}

func (a *applier) restore(ctx context.Context, refs []catalog_domain.CardRef, updates []catalog_domain.CardUpdate) error {
	withData := make(map[int64]catalog_domain.CardUpdate, len(updates))
	for _, up := range updates {
		withData[up.ID] = up
	}
	for i, ref := range refs {
		var row pgx.Row
		if up, ok := withData[ref.ID]; ok {
			row = a.db.QueryRow(ctx, restoreWithDataSQL, fieldArgs(up.ID, a.deckID, up.Card, a.revision, ref.BaseVersion)...)
		} else {
			row = a.db.QueryRow(ctx, restoreCardSQL, ref.ID, a.deckID, a.revision, ref.BaseVersion)
		}
		card, err := scanCard(row)
		if err != nil {
			return a.explain(ctx, err, catalog_domain.SectionRestore, i, ref.ID, ref.BaseVersion, true)
		}
		a.track(card, true)
	}
	return nil
}

func (a *applier) explain(ctx context.Context, err error, section string, index int, id int64, baseVersion int, wantArchived bool) error {
	if isActiveKeyViolation(err) {
		return &catalog_domain.DuplicateCardError{Section: section, Index: index, ID: id}
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%s card %d: %w", section, id, err)
	}
	var version int
	var archived bool
	probe := a.db.QueryRow(ctx, `SELECT version, archived_at IS NOT NULL FROM cards WHERE id = $1 AND deck_id = $2`, id, a.deckID)
	if perr := probe.Scan(&version, &archived); perr != nil {
		if errors.Is(perr, pgx.ErrNoRows) {
			return fmt.Errorf("card %d: %w", id, core_errors.ErrNotFound)
		}
		return fmt.Errorf("%s card %d: %w", section, id, perr)
	}
	if version != baseVersion {
		return &catalog_domain.VersionMismatchError{ID: id, Expected: baseVersion, Actual: version}
	}
	message := "card is archived"
	if wantArchived {
		message = "card is not archived"
	} else if section == catalog_domain.SectionArchive {
		message = "card is already archived"
	}
	return &catalog_domain.ValidationError{Errors: []catalog_domain.ChangesetError{{
		Section: section, Index: index, ID: id, Code: catalog_domain.CodeInvalidState, Message: message,
	}}}
}

func (a *applier) create(ctx context.Context, cards []catalog_domain.Card) error {
	if len(cards) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, c := range cards {
		batch.Queue(createCardSQL, insertArgs(a.deckID, c, a.revision)...)
	}
	br := a.db.SendBatch(ctx, batch)
	ids := make([]int64, len(cards))
	for i := range cards {
		if err := br.QueryRow().Scan(&ids[i]); err != nil {
			_ = br.Close()
			if isActiveKeyViolation(err) {
				return &catalog_domain.DuplicateCardError{Section: catalog_domain.SectionCreate, Index: i}
			}
			return fmt.Errorf("create card %d: %w", i, err)
		}
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("create cards: %w", err)
	}
	for i, c := range cards {
		c.ID, c.Version = ids[i], 1
		a.track(c, false)
		a.result.Created = append(a.result.Created, catalog_domain.CreatedRef{TempIndex: i, ID: ids[i]})
	}
	a.created += len(cards)
	return nil
}

func insertArgs(deckID int64, c catalog_domain.Card, revision int64) []any {
	return []any{
		deckID, c.Word, c.Translation, c.IPA, c.Pronunciation, c.StressNote,
		c.Pos, c.Grammar, c.Usage, c.Example, c.ExampleHighlight, c.ExampleTranslation,
		revision,
	}
}

func (a *applier) imports(ctx context.Context, files []catalog_domain.ImportFile) ([]catalog_domain.ImportedFile, error) {
	var summary []catalog_domain.ImportedFile
	for _, file := range files {
		if len(file.Cards) == 0 {
			continue
		}
		batch := &pgx.Batch{}
		for _, c := range file.Cards {
			batch.Queue(importCardSQL, insertArgs(a.deckID, c, a.revision)...)
		}
		br := a.db.SendBatch(ctx, batch)
		res := catalog_domain.ImportResult{FileName: file.FileName, Skipped: []catalog_domain.SkippedRow{}}
		for i, c := range file.Cards {
			var id int64
			err := br.QueryRow().Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				res.Skipped = append(res.Skipped, catalog_domain.SkippedRow{Index: i, Reason: catalog_domain.SkipDuplicate})
				continue
			}
			if err != nil {
				_ = br.Close()
				return nil, fmt.Errorf("import %s row %d: %w", file.FileName, i, err)
			}
			c.ID, c.Version = id, 1
			a.track(c, false)
			res.Added++
		}
		if err := br.Close(); err != nil {
			return nil, fmt.Errorf("import %s: %w", file.FileName, err)
		}
		a.created += res.Added
		a.result.Imports = append(a.result.Imports, res)
		summary = append(summary, catalog_domain.ImportedFile{Name: file.FileName, Added: res.Added, Skipped: len(res.Skipped)})
	}
	return summary, nil
}

func (a *applier) writeVersions(ctx context.Context) error {
	if len(a.versions) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, v := range a.versions {
		raw, err := json.Marshal(v.data)
		if err != nil {
			return fmt.Errorf("encode card %d: %w", v.cardID, err)
		}
		batch.Queue(`
			INSERT INTO card_versions (card_id, version, deck_id, revision, data, archived)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, v.cardID, v.version, a.deckID, a.revision, raw, v.archived)
	}
	br := a.db.SendBatch(ctx, batch)
	for range a.versions {
		if _, err := br.Exec(); err != nil {
			_ = br.Close()
			return fmt.Errorf("write card version: %w", err)
		}
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("write card versions: %w", err)
	}
	return nil
}
