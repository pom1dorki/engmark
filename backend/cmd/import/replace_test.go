package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_pgx_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool/pgx"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	"github.com/pom1dorki/engmark/internal/testkit"
)

var testPool *core_pgx_pool.Pool

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

	fileCards, err := catalog_cardsfile.Read(exampleCardsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := importCards(ctx, testPool, fileCards); err != nil {
		t.Fatal(err)
	}
	got := adminWords(t, ctx)
	want := []string{"glance", "persist", "resilient", "thoroughly", "threshold"}
	if len(got) != len(want) {
		t.Fatalf("admin words = %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("admin words = %v", got)
		}
	}
	if got := learnerCards(t, ctx); got != 1 {
		t.Fatalf("learner cards = %d", got)
	}

	duplicate := []catalog_domain.Card{replacement[0], replacement[0]}
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
	if _, err := testPool.Exec(ctx, `
		INSERT INTO decks (slug, title, kind) VALUES ('second', 'Second', 'admin')
	`); err != nil {
		t.Fatal(err)
	}
	err = importCards(ctx, testPool, replacement)
	if !errors.Is(err, core_errors.ErrConflict) {
		t.Fatalf("two admin decks err = %v", err)
	}
	if got := wordsInDeck(t, ctx, "default"); len(got) != len(want) {
		t.Fatalf("default deck changed: %v", got)
	}
	if got := learnerCards(t, ctx); got != 1 {
		t.Fatalf("learner cards = %d", got)
	}
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
