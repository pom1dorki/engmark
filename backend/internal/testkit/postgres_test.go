package testkit

import (
	"context"
	"fmt"
	"os"
	"testing"

	core_pgx_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool/pgx"
)

var testPool *core_pgx_pool.Pool

func TestMain(m *testing.M) {
	pool, cleanup, err := Start(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres: %v\n", err)
		os.Exit(1)
	}
	testPool = pool
	code := m.Run()
	cleanup()
	os.Exit(code)
}

func TestSeed(t *testing.T) {
	var cards, decks int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM cards`).Scan(&cards); err != nil {
		t.Fatal(err)
	}
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM decks WHERE slug = 'default'`).Scan(&decks); err != nil {
		t.Fatal(err)
	}
	if cards != 5 || decks != 1 {
		t.Fatalf("seed cards=%d decks=%d, want 5 and 1", cards, decks)
	}
}
