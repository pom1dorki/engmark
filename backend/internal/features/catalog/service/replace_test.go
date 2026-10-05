package catalog_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	"github.com/pom1dorki/engmark/internal/testkit"
)

var testPool *pgxpool.Pool

func importCards(ctx context.Context, pool *pgxpool.Pool, cards []catalog_domain.Card) error {
	return New(catalog_postgres_repository.New(pool)).ReplaceAdminCards(ctx, cards)
}

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

func TestImportReplacesAdminDeckOnly(t *testing.T) {
	ctx := context.Background()

	var learnerID int64
	if err := testPool.QueryRow(ctx, `
		INSERT INTO decks (slug, title, kind)
		VALUES ('learner', 'Learner', 'user')
		RETURNING id
	`).Scan(&learnerID); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO cards (deck_id, word, translation, pos)
		VALUES ($1, 'mine', 'моё', 'noun')
	`, learnerID); err != nil {
		t.Fatal(err)
	}
	var learnerPersistID int64
	if err := testPool.QueryRow(ctx, `
		INSERT INTO cards (deck_id, word, translation, pos)
		VALUES ($1, 'persist', 'упорствовать', 'verb')
		RETURNING id
	`, learnerID).Scan(&learnerPersistID); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO cards (deck_id, word, translation, pos)
		SELECT id, 'extra', 'лишнее', 'noun' FROM decks WHERE kind = 'admin'
	`); err != nil {
		t.Fatal(err)
	}

	replacement := []catalog_domain.Card{
		{Word: "persist", Translation: "упорствовать", Pos: catalog_domain.PosVerb},
		{
			Word: "glance", Translation: "взгляд", Pos: catalog_domain.PosVerb,
			Example: "She glanced up.", ExampleHighlight: "glanced",
		},
	}
	if err := importCards(ctx, testPool, replacement); err != nil {
		t.Fatal(err)
	}
	if got := adminWords(t, ctx); len(got) != 2 || got[0] != "glance" || got[1] != "persist" {
		t.Fatalf("admin words = %v", got)
	}
	if got := learnerCards(t, ctx); got != 1 {
		t.Fatalf("learner cards = %d", got)
	}
	persistBefore := adminCard(t, ctx, "persist")
	glanceBefore := adminCard(t, ctx, "glance")
	if persistBefore.id == learnerPersistID {
		t.Fatal("admin persist reused the learner card id")
	}
	if persistBefore.version != 1 || glanceBefore.version != 1 {
		t.Fatalf("versions persist=%d glance=%d", persistBefore.version, glanceBefore.version)
	}

	kept := []catalog_domain.Card{
		replacement[0],
		{
			Word: "Glance", Translation: "взгляд", Pos: catalog_domain.PosVerb,
			Example: "He glanced back.", ExampleHighlight: "glanced",
		},
	}
	if err := importCards(ctx, testPool, kept); err != nil {
		t.Fatal(err)
	}
	persistAfter := adminCard(t, ctx, "persist")
	glanceAfter := adminCard(t, ctx, "glance")
	if persistAfter.id != persistBefore.id || persistAfter.version != persistBefore.version || !persistAfter.createdAt.Equal(persistBefore.createdAt) {
		t.Fatalf("persist identity changed: before %+v after %+v", persistBefore, persistAfter)
	}
	if glanceAfter.id != glanceBefore.id || glanceAfter.version != glanceBefore.version+1 || !glanceAfter.createdAt.Equal(glanceBefore.createdAt) {
		t.Fatalf("glance identity changed: before %+v after %+v", glanceBefore, glanceAfter)
	}
	if !persistAfter.updatedAt.Equal(persistBefore.updatedAt) {
		t.Fatalf("persist updated_at changed: before %s after %s", persistBefore.updatedAt, persistAfter.updatedAt)
	}
	if glanceAfter.updatedAt.Equal(glanceBefore.updatedAt) {
		t.Fatal("glance updated_at did not change")
	}
	if glanceAfter.word != "Glance" || glanceAfter.example != "He glanced back." {
		t.Fatalf("glance content = %+v", glanceAfter)
	}
	var learnerStill int64
	if err := testPool.QueryRow(ctx, `SELECT id FROM cards WHERE id = $1`, learnerPersistID).Scan(&learnerStill); err != nil {
		t.Fatal(err)
	}

	if err := importCards(ctx, testPool, kept[1:]); err != nil {
		t.Fatal(err)
	}
	if got := adminWords(t, ctx); len(got) != 1 || got[0] != "Glance" {
		t.Fatalf("admin words after drop = %v", got)
	}
	if got := adminCard(t, ctx, "glance"); got.id != glanceBefore.id {
		t.Fatalf("glance id after drop = %d, want %d", got.id, glanceBefore.id)
	}

	fileCards, err := catalog_cardsfile.Read(exampleCardsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := importCards(ctx, testPool, fileCards); err != nil {
		t.Fatal(err)
	}
	got := adminWords(t, ctx)
	want := make([]string, len(fileCards))
	for i, card := range fileCards {
		want[i] = card.Word
	}
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("admin words = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("admin words mismatch at %d: got %q want %q", i, got[i], want[i])
		}
	}
	if got := learnerCards(t, ctx); got != 1 {
		t.Fatalf("learner cards = %d", got)
	}

	duplicate := []catalog_domain.Card{
		replacement[0],
		{Word: "PERSIST", Translation: replacement[0].Translation, Pos: replacement[0].Pos},
	}
	err = importCards(ctx, testPool, duplicate)
	if !errors.Is(err, core_errors.ErrConflict) {
		t.Fatalf("duplicate import err = %v", err)
	}
	got = adminWords(t, ctx)
	if len(got) != len(want) {
		t.Fatalf("rolled back admin words = %v", got)
	}
	if got := learnerCards(t, ctx); got != 1 {
		t.Fatalf("learner cards = %d", got)
	}

	if _, err := testPool.Exec(ctx, `UPDATE decks SET kind = 'user' WHERE slug = 'default'`); err != nil {
		t.Fatal(err)
	}
	err = importCards(ctx, testPool, replacement)
	if !errors.Is(err, core_errors.ErrNotFound) {
		t.Fatalf("user deck import err = %v", err)
	}
	if got := wordsInDeck(t, ctx, "default"); len(got) != len(want) {
		t.Fatalf("default deck changed: %v", got)
	}

	if _, err := testPool.Exec(ctx, `UPDATE decks SET kind = 'admin' WHERE slug = 'default'`); err != nil {
		t.Fatal(err)
	}
	_, err = testPool.Exec(ctx, `
		INSERT INTO decks (slug, title, kind) VALUES ('second', 'Second', 'admin')
	`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("second admin deck err = %v", err)
	}
	if got := wordsInDeck(t, ctx, "default"); len(got) != len(want) {
		t.Fatalf("default deck changed: %v", got)
	}
	if got := learnerCards(t, ctx); got != 1 {
		t.Fatalf("learner cards = %d", got)
	}
}

type storedCard struct {
	id        int64
	version   int
	word      string
	example   string
	createdAt time.Time
	updatedAt time.Time
}

func adminCard(t *testing.T, ctx context.Context, word string) storedCard {
	t.Helper()
	var card storedCard
	err := testPool.QueryRow(ctx, `
		SELECT c.id, c.version, c.word, c.example, c.created_at, c.updated_at
		FROM cards c
		JOIN decks d ON d.id = c.deck_id
		WHERE d.kind = 'admin' AND lower(c.word) = lower($1)
	`, word).Scan(&card.id, &card.version, &card.word, &card.example, &card.createdAt, &card.updatedAt)
	if err != nil {
		t.Fatalf("admin card %q: %v", word, err)
	}
	return card
}

func adminWords(t *testing.T, ctx context.Context) []string {
	t.Helper()
	return wordsQuery(t, ctx, `
		SELECT c.word
		FROM cards c
		JOIN decks d ON d.id = c.deck_id
		WHERE d.kind = 'admin'
		ORDER BY c.word
	`)
}

func wordsInDeck(t *testing.T, ctx context.Context, slug string) []string {
	t.Helper()
	return wordsQuery(t, ctx, `
		SELECT c.word
		FROM cards c
		JOIN decks d ON d.id = c.deck_id
		WHERE d.slug = $1
		ORDER BY c.word
	`, slug)
}

func wordsQuery(t *testing.T, ctx context.Context, query string, args ...any) []string {
	t.Helper()
	rows, err := testPool.Query(ctx, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var words []string
	for rows.Next() {
		var word string
		if err := rows.Scan(&word); err != nil {
			t.Fatal(err)
		}
		words = append(words, word)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return words
}

func exampleCardsPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		candidate := filepath.Join(dir, "data", "cards.json")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("data/cards.json not found")
		}
		dir = parent
	}
}

func TestReplaceKeepsCatalogBytes(t *testing.T) {
	ctx := context.Background()
	cards := []catalog_domain.Card{
		{Word: "alpha", Translation: "альфа", Pos: catalog_domain.PosNoun, Example: "Alpha.", ExampleHighlight: "Alpha"},
		{Word: "beta", Translation: "бета", Pos: catalog_domain.PosNoun},
	}
	if err := importCards(ctx, testPool, cards); err != nil {
		t.Fatal(err)
	}
	beforeAlpha := adminCard(t, ctx, "alpha")
	beforeBeta := adminCard(t, ctx, "beta")
	beforeBody := catalogJSON(t, ctx)

	if err := importCards(ctx, testPool, cards); err != nil {
		t.Fatal(err)
	}
	if again := catalogJSON(t, ctx); again != beforeBody {
		t.Fatalf("unchanged catalog JSON differs")
	}
	if got := adminCard(t, ctx, "alpha"); !sameStored(got, beforeAlpha) {
		t.Fatalf("alpha drifted: before %+v after %+v", beforeAlpha, got)
	}
	if got := adminCard(t, ctx, "beta"); !sameStored(got, beforeBeta) {
		t.Fatalf("beta drifted: before %+v after %+v", beforeBeta, got)
	}

	changed := []catalog_domain.Card{
		cards[0],
		{Word: "beta", Translation: "бета", Pos: catalog_domain.PosNoun, Usage: "edited"},
	}
	if err := importCards(ctx, testPool, changed); err != nil {
		t.Fatal(err)
	}
	if catalogJSON(t, ctx) == beforeBody {
		t.Fatal("edited catalog kept the previous JSON")
	}
	if got := adminCard(t, ctx, "alpha"); !sameStored(got, beforeAlpha) {
		t.Fatalf("alpha changed: before %+v after %+v", beforeAlpha, got)
	}
	editedBeta := adminCard(t, ctx, "beta")
	if editedBeta.id != beforeBeta.id || editedBeta.version != beforeBeta.version+1 || editedBeta.updatedAt.Equal(beforeBeta.updatedAt) {
		t.Fatalf("beta edit: before %+v after %+v", beforeBeta, editedBeta)
	}
}

func sameStored(a, b storedCard) bool {
	return a.id == b.id && a.version == b.version && a.word == b.word && a.example == b.example &&
		a.createdAt.Equal(b.createdAt) && a.updatedAt.Equal(b.updatedAt)
}

func catalogJSON(t *testing.T, ctx context.Context) string {
	t.Helper()
	limit, offset := 1000, 0
	list, err := New(catalog_postgres_repository.New(testPool)).ListCards(ctx, &limit, &offset)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func letterWord(i int) string {
	n := i + 1
	buf := make([]byte, 0, 8)
	for n > 0 {
		n--
		buf = append(buf, byte('a'+n%26))
		n /= 26
	}
	for l, r := 0, len(buf)-1; l < r; l, r = l+1, r-1 {
		buf[l], buf[r] = buf[r], buf[l]
	}
	return "word" + string(buf)
}

func TestReplaceThousandCards(t *testing.T) {
	ctx := context.Background()
	cards := make([]catalog_domain.Card, 1000)
	for i := range cards {
		cards[i] = catalog_domain.Card{
			Word:        letterWord(i),
			Translation: fmt.Sprintf("перевод%d", i),
			Pos:         catalog_domain.PosNoun,
		}
	}
	started := time.Now()
	if err := importCards(ctx, testPool, cards); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("sync took %s", elapsed)
	}
	kept := adminCard(t, ctx, letterWord(10))
	if err := importCards(ctx, testPool, cards); err != nil {
		t.Fatal(err)
	}
	again := adminCard(t, ctx, letterWord(10))
	if again.id != kept.id || again.version != kept.version || !again.updatedAt.Equal(kept.updatedAt) {
		t.Fatalf("id changed: before %+v after %+v", kept, again)
	}
}

func learnerCards(t *testing.T, ctx context.Context) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*)
		FROM cards c
		JOIN decks d ON d.id = c.deck_id
		WHERE d.slug = 'learner' AND c.word = 'mine'
	`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
