package catalog_service

import (
	"context"
	"errors"
	"testing"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type fakeRepo struct {
	Repository

	deck     catalog_domain.Deck
	cards    map[int64]catalog_domain.Card
	existing map[catalog_domain.Key]struct{}
	changes  catalog_domain.Changes

	applied     []catalog_domain.Changeset
	appliedMeta []string
	seeded      []catalog_domain.Card
}

func (f *fakeRepo) GetAdminDeck(context.Context) (catalog_domain.Deck, error) { return f.deck, nil }

func (f *fakeRepo) GetCards(_ context.Context, _ int64, ids []int64) (map[int64]catalog_domain.Card, error) {
	out := map[int64]catalog_domain.Card{}
	for _, id := range ids {
		if c, ok := f.cards[id]; ok {
			out[id] = c
		}
	}
	return out, nil
}

func (f *fakeRepo) ApplyChangeset(_ context.Context, _ int64, cs catalog_domain.Changeset, author, source string) (catalog_domain.ChangesetResult, error) {
	f.applied = append(f.applied, cs)
	f.appliedMeta = append(f.appliedMeta, author+"/"+source)
	f.deck.Revision++
	return catalog_domain.ChangesetResult{Revision: f.deck.Revision}, nil
}

func (f *fakeRepo) ExistingKeys(context.Context, int64, []catalog_domain.Key) (map[catalog_domain.Key]struct{}, error) {
	return f.existing, nil
}

func (f *fakeRepo) ListChangesSince(context.Context, int64, int64) (catalog_domain.Changes, error) {
	return f.changes, nil
}

func (f *fakeRepo) SeedIfEmpty(_ context.Context, _ int64, cards []catalog_domain.Card) (bool, error) {
	f.seeded = cards
	return true, nil
}

func (f *fakeRepo) GetDeckSummary(context.Context) (catalog_domain.DeckSummary, error) {
	return catalog_domain.DeckSummary{Deck: f.deck}, nil
}

func newFake() *fakeRepo {
	return &fakeRepo{
		deck:  catalog_domain.Deck{ID: 1, Slug: "default", Kind: catalog_domain.DeckKindAdmin, Revision: 5},
		cards: map[int64]catalog_domain.Card{},
	}
}

func word(w string) catalog_domain.Card {
	return catalog_domain.Card{Word: w, Translation: "перевод " + w, Pos: catalog_domain.PosNoun}
}

func stored(id int64, version int, c catalog_domain.Card) catalog_domain.Card {
	c.ID, c.DeckID, c.Version = id, 1, version
	return c
}

func validationCodes(t *testing.T, err error) []string {
	t.Helper()
	var ve *catalog_domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want ValidationError", err)
	}
	codes := make([]string, len(ve.Errors))
	for i, e := range ve.Errors {
		codes[i] = e.Code
	}
	return codes
}

func TestApplyChangesetNormalizesAndNotifies(t *testing.T) {
	repo := newFake()
	var notified int64
	svc := New(repo).WithHooks(Hooks{OnCommitted: func(_ context.Context, rev int64) { notified = rev }})

	in := catalog_domain.Changeset{
		BaseRevision: 5,
		Create:       []catalog_domain.Card{{Word: "  Luggage ", Translation: " багаж ", Pos: " noun "}},
	}
	res, err := svc.ApplyChangeset(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if notified != res.Revision || res.Revision != 6 {
		t.Fatalf("notified = %d, revision = %d", notified, res.Revision)
	}
	got := repo.applied[0]
	if got.Create[0].Word != "Luggage" || got.Create[0].Translation != "багаж" || got.Create[0].Pos != "noun" {
		t.Fatalf("not normalized: %+v", got.Create[0])
	}
	if in.Create[0].Word != "  Luggage " {
		t.Fatal("caller's changeset was mutated")
	}
	if got.Message == "" || repo.appliedMeta[0] != "admin/editor" {
		t.Fatalf("message = %q, meta = %q", got.Message, repo.appliedMeta[0])
	}
}

func TestApplyChangesetImportSource(t *testing.T) {
	repo := newFake()
	svc := New(repo)
	_, err := svc.ApplyChangeset(context.Background(), catalog_domain.Changeset{
		BaseRevision: 5,
		Imports:      []catalog_domain.ImportFile{{FileName: " travel.json ", Cards: []catalog_domain.Card{word("alpha")}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.appliedMeta[0] != "admin/import" || repo.applied[0].Message != "Импорт: travel.json" {
		t.Fatalf("meta = %q, message = %q", repo.appliedMeta[0], repo.applied[0].Message)
	}
}

func TestApplyChangesetRejectsInvalid(t *testing.T) {
	repo := newFake()
	svc := New(repo)
	for name, cs := range map[string]catalog_domain.Changeset{
		"empty":    {BaseRevision: 5},
		"cyrillic": {BaseRevision: 5, Create: []catalog_domain.Card{{Word: "слово", Translation: "x", Pos: "noun"}}},
	} {
		if _, err := svc.ApplyChangeset(context.Background(), cs); !errors.Is(err, core_errors.ErrInvalidArgument) {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
	if len(repo.applied) != 0 {
		t.Fatal("invalid changeset reached the repository")
	}
}

func TestApplyChangesetNoChanges(t *testing.T) {
	repo := newFake()
	repo.cards[7] = stored(7, 2, word("alpha"))
	svc := New(repo)

	same := word("alpha")
	same.Word = "  alpha  "
	_, err := svc.ApplyChangeset(context.Background(), catalog_domain.Changeset{
		BaseRevision: 5,
		Update:       []catalog_domain.CardUpdate{{ID: 7, BaseVersion: 2, Card: same}},
	})
	if codes := validationCodes(t, err); len(codes) != 1 || codes[0] != catalog_domain.CodeNoChanges {
		t.Fatalf("codes = %v", codes)
	}
	var ve *catalog_domain.ValidationError
	errors.As(err, &ve)
	if ve.Errors[0].ID != 7 || ve.ErrorCode() != catalog_domain.CodeNoChanges {
		t.Fatalf("errors = %+v", ve.Errors)
	}
	if len(repo.applied) != 0 {
		t.Fatal("no-op reached the repository")
	}

	if _, err := svc.ApplyChangeset(context.Background(), catalog_domain.Changeset{
		BaseRevision: 5,
		Update:       []catalog_domain.CardUpdate{{ID: 7, BaseVersion: 1, Card: word("alpha")}},
	}); err != nil {
		t.Fatalf("stale base must be left to the repository: %v", err)
	}
}

func TestSeedIfEmpty(t *testing.T) {
	repo := newFake()
	svc := New(repo)

	repo.deck.Revision = 3
	if seeded, err := svc.SeedIfEmpty(context.Background(), []catalog_domain.Card{word("alpha")}); err != nil || seeded || repo.seeded != nil {
		t.Fatalf("non-empty deck: seeded=%v err=%v", seeded, err)
	}

	repo.deck.Revision = 0
	dup := word("alpha")
	dup.Word = "ALPHA"
	dup.Translation = word("alpha").Translation
	if _, err := svc.SeedIfEmpty(context.Background(), []catalog_domain.Card{word("alpha"), dup}); !errors.Is(err, core_errors.ErrConflict) {
		t.Fatalf("duplicates err = %v", err)
	}
	if _, err := svc.SeedIfEmpty(context.Background(), []catalog_domain.Card{{Word: "слово", Translation: "x", Pos: "noun"}}); !errors.Is(err, core_errors.ErrInvalidArgument) {
		t.Fatalf("invalid card err = %v", err)
	}
	if _, err := svc.SeedIfEmpty(context.Background(), nil); !errors.Is(err, core_errors.ErrInvalidArgument) {
		t.Fatalf("empty list err = %v", err)
	}
	if seeded, err := svc.SeedIfEmpty(context.Background(), []catalog_domain.Card{word("alpha")}); err != nil || !seeded || len(repo.seeded) != 1 {
		t.Fatalf("seed: %v %v", seeded, err)
	}
}

func TestValidateChangesetCountsDuplicates(t *testing.T) {
	repo := newFake()
	repo.existing = map[catalog_domain.Key]struct{}{catalog_domain.CardKey(word("alpha")): {}}
	svc := New(repo)

	report, err := svc.ValidateChangeset(context.Background(), catalog_domain.Changeset{
		Imports: []catalog_domain.ImportFile{
			{FileName: "a.json", Cards: []catalog_domain.Card{word("alpha"), word("beta"), word("beta")}},
			{FileName: "b.json", Cards: []catalog_domain.Card{word("beta"), word("gamma")}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Revision != 5 || len(report.Imports) != 2 {
		t.Fatalf("report = %+v", report)
	}
	if a := report.Imports[0]; a.Added != 1 || len(a.Skipped) != 2 || a.Skipped[0].Index != 0 || a.Skipped[1].Index != 2 {
		t.Fatalf("a.json = %+v", a)
	}
	if b := report.Imports[1]; b.Added != 1 || len(b.Skipped) != 1 {
		t.Fatalf("b.json = %+v", b)
	}
	if len(repo.applied) != 0 {
		t.Fatal("validate must not write")
	}

	_, err = svc.ValidateChangeset(context.Background(), catalog_domain.Changeset{Create: []catalog_domain.Card{word("alpha")}})
	if codes := validationCodes(t, err); codes[0] != catalog_domain.CodeDuplicateCard {
		t.Fatalf("create duplicate codes = %v", codes)
	}
}

func TestRevertDraftScenario(t *testing.T) {
	repo := newFake()
	old, edited := word("one"), word("one")
	edited.Usage = "правка после r2"
	archivedEdited := word("five")
	archivedEdited.Usage = "правка перед архивом"

	snapshot := func(id int64, c catalog_domain.Card, archived bool) *catalog_domain.CardVersion {
		return &catalog_domain.CardVersion{CardID: id, Version: 1, Revision: 2, Data: c.Data(), Archived: archived}
	}
	now := time.Now()
	archivedAt := func(c catalog_domain.Card) catalog_domain.Card { c.ArchivedAt = &now; return c }

	repo.changes = catalog_domain.Changes{Revision: 5, Since: 2, Items: []catalog_domain.CardChange{
		{Current: stored(1, 2, edited), Base: snapshot(1, old, false)},
		{Current: stored(2, 1, word("two")), Base: nil},
		{Current: stored(3, 2, archivedAt(word("three"))), Base: snapshot(3, word("three"), false)},
		{Current: stored(4, 3, word("four")), Base: snapshot(4, word("four"), true)},
		{Current: stored(5, 3, archivedAt(archivedEdited)), Base: snapshot(5, word("five"), false)},
		{Current: stored(6, 2, archivedAt(word("six"))), Base: nil},
	}}
	cs, err := New(repo).RevertDraft(context.Background(), 2)
	if err != nil {
		t.Fatal(err)
	}

	if cs.BaseRevision != 5 || cs.Message != "Откат к r2" {
		t.Fatalf("header = %d %q", cs.BaseRevision, cs.Message)
	}
	if len(cs.Update) != 2 || cs.Update[0].ID != 1 || cs.Update[0].BaseVersion != 2 || cs.Update[0].Card.Usage != "" ||
		cs.Update[1].ID != 5 || cs.Update[1].Card.Usage != "" {
		t.Fatalf("update = %+v", cs.Update)
	}
	if len(cs.Archive) != 2 || cs.Archive[0].ID != 2 || cs.Archive[1].ID != 4 {
		t.Fatalf("archive = %+v", cs.Archive)
	}
	if len(cs.Restore) != 2 || cs.Restore[0].ID != 3 || cs.Restore[1].ID != 5 {
		t.Fatalf("restore = %+v", cs.Restore)
	}
	if errs := cs.Validate(); len(errs) != 0 {
		t.Fatalf("revert draft is not a valid changeset: %+v", errs)
	}

	if _, err := New(repo).RevertDraft(context.Background(), 9); !errors.Is(err, core_errors.ErrNotFound) {
		t.Fatalf("future revision err = %v", err)
	}
}

func TestListCardsRejectsBadFilters(t *testing.T) {
	svc := New(newFake())
	for _, f := range []catalog_domain.CardFilter{
		{State: "deleted"},
		{Pos: "thing"},
		{Limit: maxAdminLimit + 1},
		{Offset: -1},
	} {
		if _, err := svc.ListCards(context.Background(), f); !errors.Is(err, core_errors.ErrInvalidArgument) {
			t.Fatalf("filter %+v err = %v", f, err)
		}
	}
}

func TestDeckSummaryRetriesLaggingSnapshot(t *testing.T) {
	repo := newFake()
	calls := 0
	svc := New(repo).WithHooks(Hooks{
		OnCommitted:      func(context.Context, int64) { calls++ },
		SnapshotRevision: func() int64 { return 4 },
	})
	if _, err := svc.DeckSummary(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("rebuild calls = %d, want 1", calls)
	}

	calls = 0
	svc = New(repo).WithHooks(Hooks{
		OnCommitted:      func(context.Context, int64) { calls++ },
		SnapshotRevision: func() int64 { return 5 },
	})
	_, _ = svc.DeckSummary(context.Background())
	if calls != 0 {
		t.Fatal("up-to-date snapshot must not be rebuilt")
	}
}
