package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	"github.com/pom1dorki/engmark/internal/testkit"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	pool, cleanup, err := testkit.Start(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres: %v\n", err)
		os.Exit(1)
	}
	testPool = pool
	code := m.Run()
	cleanup()
	os.Exit(code)
}

func mkCard(word string) catalog_domain.Card {
	return catalog_domain.Card{Word: word, Translation: "перевод " + word, Pos: catalog_domain.PosNoun, Example: "A " + word + ".", ExampleHighlight: word}
}

func fresh(t *testing.T) (*Repository, int64) {
	t.Helper()
	ctx := context.Background()
	for _, q := range []string{
		`DELETE FROM card_versions`,
		`DELETE FROM cards`,
		`DELETE FROM deck_revisions`,
		`UPDATE decks SET revision = 0 WHERE kind = 'admin'`,
	} {
		if _, err := testPool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	repo := New(testPool)
	deck, err := repo.GetAdminDeck(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return repo, deck.ID
}

func count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func mustApply(t *testing.T, repo *Repository, deckID int64, cs catalog_domain.Changeset) catalog_domain.ChangesetResult {
	t.Helper()
	res, err := repo.ApplyChangeset(context.Background(), deckID, cs, catalog_domain.AuthorAdmin, catalog_domain.SourceEditor)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	return res
}

func TestConcurrentChangesetsOnOneBase(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	const workers = 8
	errs := make([]error, workers)
	var wg sync.WaitGroup
	for i := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cs := catalog_domain.Changeset{BaseRevision: 0, Create: []catalog_domain.Card{mkCard(fmt.Sprintf("word%c", 'a'+i))}}
			_, errs[i] = repo.ApplyChangeset(ctx, deckID, cs, catalog_domain.AuthorAdmin, catalog_domain.SourceEditor)
		}()
	}
	wg.Wait()

	ok := 0
	for _, err := range errs {
		var mismatch *catalog_domain.RevisionMismatchError
		switch {
		case err == nil:
			ok++
		case errors.As(err, &mismatch):
			if mismatch.Base != 0 || mismatch.Current != 1 {
				t.Fatalf("mismatch = %+v", mismatch)
			}
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if ok != 1 {
		t.Fatalf("successful writers = %d, want exactly 1", ok)
	}
	if n := count(t, `SELECT count(*) FROM cards`); n != 1 {
		t.Fatalf("cards = %d, want 1", n)
	}
	if n := count(t, `SELECT count(*) FROM deck_revisions`); n != 1 {
		t.Fatalf("revisions = %d, want 1", n)
	}
	if n := count(t, `SELECT count(*) FROM card_versions`); n != 1 {
		t.Fatalf("card versions = %d, want 1", n)
	}
}

func TestStaleVersionChangesNothing(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	res := mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}})
	id := res.Created[0].ID
	edited := mkCard("alpha")
	edited.Usage = "v2"
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Update: []catalog_domain.CardUpdate{{ID: id, BaseVersion: 1, Card: edited}}})

	stale := mkCard("alpha")
	stale.Usage = "from a stale tab"
	_, err := repo.ApplyChangeset(ctx, deckID, catalog_domain.Changeset{
		BaseRevision: 2,
		Create:       []catalog_domain.Card{mkCard("beta")},
		Update:       []catalog_domain.CardUpdate{{ID: id, BaseVersion: 1, Card: stale}},
	}, catalog_domain.AuthorAdmin, catalog_domain.SourceEditor)
	var mismatch *catalog_domain.VersionMismatchError
	if !errors.As(err, &mismatch) || mismatch.ID != id || mismatch.Expected != 1 || mismatch.Actual != 2 {
		t.Fatalf("err = %v", err)
	}
	if !errors.Is(err, core_errors.ErrConflict) {
		t.Fatal("version mismatch must wrap ErrConflict")
	}

	deck, _ := repo.GetAdminDeck(ctx)
	if deck.Revision != 2 {
		t.Fatalf("revision = %d, want 2 (rolled back)", deck.Revision)
	}
	if n := count(t, `SELECT count(*) FROM card_versions`); n != 2 {
		t.Fatalf("card_versions = %d, want 2", n)
	}
	if n := count(t, `SELECT count(*) FROM cards WHERE word = 'beta'`); n != 0 {
		t.Fatal("create from the failed changeset leaked")
	}
}

func TestImportSkipsDuplicates(t *testing.T) {
	repo, deckID := fresh(t)

	mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}})
	file := catalog_domain.ImportFile{FileName: "travel.json", Cards: []catalog_domain.Card{
		mkCard("alpha"),
		mkCard("beta"),
		mkCard("BETA"),
		mkCard("gamma"),
	}}
	file.Cards[2].Translation = file.Cards[1].Translation
	res := mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Imports: []catalog_domain.ImportFile{file}})

	if len(res.Imports) != 1 || res.Imports[0].Added != 2 || len(res.Imports[0].Skipped) != 2 {
		t.Fatalf("imports = %+v", res.Imports)
	}
	if s := res.Imports[0].Skipped; s[0].Index != 0 || s[1].Index != 2 || s[0].Reason != catalog_domain.SkipDuplicate {
		t.Fatalf("skipped = %+v", s)
	}
	if n := count(t, `SELECT count(*) FROM cards`); n != 3 {
		t.Fatalf("cards = %d, want 3", n)
	}
	detail, err := repo.GetRevision(context.Background(), deckID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Revision.CreatedN != 2 || len(detail.Revision.ImportedFiles) != 1 ||
		detail.Revision.ImportedFiles[0] != (catalog_domain.ImportedFile{Name: "travel.json", Added: 2, Skipped: 2}) {
		t.Fatalf("revision = %+v", detail.Revision)
	}
}

func TestDuplicateCreateIsRejected(t *testing.T) {
	repo, deckID := fresh(t)
	mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}})

	upper := mkCard("alpha")
	upper.Word = "ALPHA"
	_, err := repo.ApplyChangeset(context.Background(), deckID, catalog_domain.Changeset{
		BaseRevision: 1,
		Create:       []catalog_domain.Card{mkCard("beta"), upper},
	}, catalog_domain.AuthorAdmin, catalog_domain.SourceEditor)
	var dup *catalog_domain.DuplicateCardError
	if !errors.As(err, &dup) || dup.Section != catalog_domain.SectionCreate || dup.Index != 1 {
		t.Fatalf("err = %v", err)
	}
	if n := count(t, `SELECT count(*) FROM cards`); n != 1 {
		t.Fatalf("cards = %d, want 1", n)
	}
}

func TestArchiveRestoreCycle(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	id := mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}}).Created[0].ID
	res := mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Archive: []catalog_domain.CardRef{{ID: id, BaseVersion: 1}}})
	if res.Updated[0].Version != 2 {
		t.Fatalf("archive version = %d", res.Updated[0].Version)
	}
	if cards, _ := repo.ListAllCards(ctx, deckID); len(cards) != 0 {
		t.Fatalf("archived card is visible to learners: %+v", cards)
	}

	_, err := repo.ApplyChangeset(ctx, deckID, catalog_domain.Changeset{BaseRevision: 2, Archive: []catalog_domain.CardRef{{ID: id, BaseVersion: 2}}}, "admin", "editor")
	var invalid *catalog_domain.ValidationError
	if !errors.As(err, &invalid) || invalid.Errors[0].Code != catalog_domain.CodeInvalidState {
		t.Fatalf("archive twice err = %v", err)
	}

	res = mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 2, Restore: []catalog_domain.CardRef{{ID: id, BaseVersion: 2}}})
	if res.Updated[0].Version != 3 {
		t.Fatalf("restore version = %d", res.Updated[0].Version)
	}
	if cards, _ := repo.ListAllCards(ctx, deckID); len(cards) != 1 || cards[0].Version != 3 {
		t.Fatalf("restored card missing: %+v", cards)
	}
	if n := count(t, `SELECT count(*) FROM card_versions WHERE card_id = $1`, id); n != 3 {
		t.Fatalf("card_versions = %d, want 3", n)
	}

	_, err = repo.ApplyChangeset(ctx, deckID, catalog_domain.Changeset{BaseRevision: 3, Restore: []catalog_domain.CardRef{{ID: id, BaseVersion: 3}}}, "admin", "editor")
	if !errors.As(err, &invalid) {
		t.Fatalf("restore active err = %v", err)
	}

	detail, err := repo.GetRevision(ctx, deckID, 2)
	if err != nil || len(detail.Changes) != 1 || detail.Changes[0].Kind != catalog_domain.ChangeArchived {
		t.Fatalf("r2 = %+v, %v", detail, err)
	}
	detail, err = repo.GetRevision(ctx, deckID, 3)
	if err != nil || detail.Changes[0].Kind != catalog_domain.ChangeRestored {
		t.Fatalf("r3 = %+v, %v", detail, err)
	}
}

func TestRestoreRespectsActiveKey(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	id := mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}}).Created[0].ID
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Archive: []catalog_domain.CardRef{{ID: id, BaseVersion: 1}}})
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 2, Create: []catalog_domain.Card{mkCard("alpha")}})

	_, err := repo.ApplyChangeset(ctx, deckID, catalog_domain.Changeset{BaseRevision: 3, Restore: []catalog_domain.CardRef{{ID: id, BaseVersion: 2}}}, "admin", "editor")
	var dup *catalog_domain.DuplicateCardError
	if !errors.As(err, &dup) || dup.Section != catalog_domain.SectionRestore {
		t.Fatalf("err = %v", err)
	}
}

func TestUpdateWithRestoreIsOneVersion(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	id := mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}}).Created[0].ID
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Archive: []catalog_domain.CardRef{{ID: id, BaseVersion: 1}}})

	edited := mkCard("alpha")
	edited.Usage = "восстановлено с правкой"
	res := mustApply(t, repo, deckID, catalog_domain.Changeset{
		BaseRevision: 2,
		Update:       []catalog_domain.CardUpdate{{ID: id, BaseVersion: 2, Card: edited}},
		Restore:      []catalog_domain.CardRef{{ID: id, BaseVersion: 2}},
	})
	if len(res.Updated) != 1 || res.Updated[0].Version != 3 {
		t.Fatalf("updated = %+v", res.Updated)
	}
	card, err := repo.GetCard(ctx, deckID, id)
	if err != nil || card.Archived() || card.Usage != edited.Usage {
		t.Fatalf("card = %+v, %v", card, err)
	}
}

func TestSnapshotAtAndChangesSince(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	r1 := mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha"), mkCard("beta")}})
	alpha, beta := r1.Created[0].ID, r1.Created[1].ID

	edited := mkCard("alpha")
	edited.Usage = "после r2"
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Update: []catalog_domain.CardUpdate{{ID: alpha, BaseVersion: 1, Card: edited}}})
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 2, Archive: []catalog_domain.CardRef{{ID: beta, BaseVersion: 1}}, Create: []catalog_domain.Card{mkCard("gamma")}})

	at1, err := repo.SnapshotAt(ctx, deckID, 1)
	if err != nil || len(at1.Cards) != 2 || at1.Cards[0].ID != alpha || at1.Cards[0].Data.Usage != "" {
		t.Fatalf("r1 = %+v, %v", at1, err)
	}
	at2, _ := repo.SnapshotAt(ctx, deckID, 2)
	if len(at2.Cards) != 2 || at2.Cards[0].Data.Usage != "после r2" {
		t.Fatalf("r2 = %+v", at2)
	}
	at3, _ := repo.SnapshotAt(ctx, deckID, 3)
	if len(at3.Cards) != 2 || at3.Cards[1].Data.Word != "gamma" {
		t.Fatalf("r3 = %+v", at3)
	}
	if _, err := repo.SnapshotAt(ctx, deckID, 99); !errors.Is(err, core_errors.ErrNotFound) {
		t.Fatalf("future revision err = %v", err)
	}

	changes, err := repo.ListChangesSince(ctx, deckID, 1)
	if err != nil || changes.Revision != 3 || len(changes.Items) != 3 {
		t.Fatalf("changes = %+v, %v", changes, err)
	}
	byID := map[string]catalog_domain.CardChange{}
	for _, it := range changes.Items {
		byID[it.Current.Word] = it
	}
	if a := byID["alpha"]; a.Base == nil || a.Base.Version != 1 || a.Base.Data.Usage != "" || a.Current.Usage != "после r2" {
		t.Fatalf("alpha change = %+v", a)
	}
	if b := byID["beta"]; b.Base == nil || b.Base.Archived || !b.Current.Archived() {
		t.Fatalf("beta change = %+v", b)
	}
	if g := byID["gamma"]; g.Base != nil {
		t.Fatalf("gamma was created after r1, base must be nil: %+v", g)
	}
}

func TestSeedIfEmptyRunsOnce(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	seeded, err := repo.SeedIfEmpty(ctx, deckID, []catalog_domain.Card{mkCard("alpha"), mkCard("beta")})
	if err != nil || !seeded {
		t.Fatalf("first seed = %v, %v", seeded, err)
	}
	seeded, err = repo.SeedIfEmpty(ctx, deckID, []catalog_domain.Card{mkCard("gamma")})
	if err != nil || seeded {
		t.Fatalf("second seed = %v, %v", seeded, err)
	}
	deck, _ := repo.GetAdminDeck(ctx)
	if deck.Revision != 1 {
		t.Fatalf("revision = %d, want 1", deck.Revision)
	}
	revs, err := repo.ListRevisions(ctx, deckID, 10, 0)
	if err != nil || len(revs) != 1 || revs[0].Source != catalog_domain.SourceSeed || revs[0].Author != catalog_domain.AuthorSystem || revs[0].CreatedN != 2 {
		t.Fatalf("revisions = %+v, %v", revs, err)
	}
}

func TestAdminCardListFilters(t *testing.T) {
	repo, deckID := fresh(t)
	ctx := context.Background()

	full := mkCard("alpha")
	full.IPA, full.Pronunciation, full.StressNote, full.Grammar, full.Usage, full.ExampleTranslation = "i", "p", "s", "g", "u", "t"
	verb := catalog_domain.Card{Word: "beta", Translation: "бета", Pos: catalog_domain.PosVerb}
	res := mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{full, verb, mkCard("gamma_100%")}})
	mustApply(t, repo, deckID, catalog_domain.Changeset{BaseRevision: 1, Archive: []catalog_domain.CardRef{{ID: res.Created[2].ID, BaseVersion: 1}}})

	list := func(f catalog_domain.CardFilter) catalog_domain.CardPage {
		t.Helper()
		f.Limit = 50
		page, err := repo.ListAdminCards(ctx, deckID, f)
		if err != nil {
			t.Fatal(err)
		}
		return page
	}
	if p := list(catalog_domain.CardFilter{}); p.Total != 2 || p.Revision != 2 {
		t.Fatalf("active = %+v", p)
	}
	if p := list(catalog_domain.CardFilter{State: catalog_domain.StateArchived}); p.Total != 1 || p.Items[0].Word != "gamma_100%" {
		t.Fatalf("archived = %+v", p)
	}
	if p := list(catalog_domain.CardFilter{State: catalog_domain.StateIncomplete}); p.Total != 1 || p.Items[0].Word != "beta" {
		t.Fatalf("incomplete = %+v", p)
	}
	if p := list(catalog_domain.CardFilter{Pos: catalog_domain.PosVerb}); p.Total != 1 {
		t.Fatalf("pos = %+v", p)
	}
	if p := list(catalog_domain.CardFilter{Query: "АЛЬФ"}); p.Total != 0 {
		t.Fatalf("query matched without a translation: %+v", p)
	}
	if p := list(catalog_domain.CardFilter{Query: "перевод alpha"}); p.Total != 1 {
		t.Fatalf("query by translation = %+v", p)
	}
	if p := list(catalog_domain.CardFilter{Query: "100%", State: catalog_domain.StateArchived}); p.Total != 1 {
		t.Fatalf("literal percent = %+v", p)
	}
	if p := list(catalog_domain.CardFilter{Query: "%"}); p.Total != 0 {
		t.Fatalf("bare percent matched everything: %+v", p)
	}
	page, err := repo.ListAdminCards(ctx, deckID, catalog_domain.CardFilter{Limit: 1, Offset: 1})
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].Word != "beta" {
		t.Fatalf("page = %+v, %v", page, err)
	}
}

func TestExistingKeys(t *testing.T) {
	repo, deckID := fresh(t)
	mustApply(t, repo, deckID, catalog_domain.Changeset{Create: []catalog_domain.Card{mkCard("alpha")}})

	upper := mkCard("alpha")
	upper.Word = "ALPHA"
	keys := []catalog_domain.Key{
		catalog_domain.CardKey(upper),
		catalog_domain.CardKey(mkCard("beta")),
	}
	found, err := repo.ExistingKeys(context.Background(), deckID, keys)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := found[keys[0]]; !ok || len(found) != 1 {
		t.Fatalf("found = %+v", found)
	}
}

func TestImportFiveThousandRows(t *testing.T) {
	repo, deckID := fresh(t)
	rows := make([]catalog_domain.Card, catalog_domain.MaxImportRows)
	for i := range rows {
		rows[i] = catalog_domain.Card{Word: "w" + letters(i), Translation: fmt.Sprintf("п%d", i), Pos: catalog_domain.PosNoun}
	}
	res := mustApply(t, repo, deckID, catalog_domain.Changeset{Imports: []catalog_domain.ImportFile{{FileName: "big.json", Cards: rows}}})
	if res.Imports[0].Added != catalog_domain.MaxImportRows {
		t.Fatalf("added = %d", res.Imports[0].Added)
	}
	if n := count(t, `SELECT count(*) FROM card_versions`); n != catalog_domain.MaxImportRows {
		t.Fatalf("versions = %d", n)
	}
}

func letters(i int) string {
	n := i + 1
	var buf []byte
	for n > 0 {
		n--
		buf = append([]byte{byte('a' + n%26)}, buf...)
		n /= 26
	}
	return string(buf)
}
