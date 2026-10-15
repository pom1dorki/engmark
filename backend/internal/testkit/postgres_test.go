package testkit

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"

	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	"github.com/pom1dorki/engmark/migrations"
)

var testPool *pgxpool.Pool

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

func TestMigrationLeavesCatalogEmpty(t *testing.T) {
	ctx := context.Background()
	var cards, decks int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM cards`).Scan(&cards); err != nil {
		t.Fatal(err)
	}
	var revision int64
	if err := testPool.QueryRow(ctx, `SELECT count(*), coalesce(max(revision), -1) FROM decks WHERE slug = 'default' AND kind = 'admin'`).Scan(&decks, &revision); err != nil {
		t.Fatal(err)
	}
	if cards != 0 || decks != 1 || revision != 0 {
		t.Fatalf("cards=%d admin decks=%d revision=%d, want 0, 1 and 0", cards, decks, revision)
	}
	for _, table := range []string{"decks", "deck_revisions", "cards", "card_versions", "admin_sessions"} {
		var exists bool
		if err := testPool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if !exists {
			t.Fatalf("table %s is missing", table)
		}
	}
	var meta bool
	if err := testPool.QueryRow(ctx, `SELECT to_regclass('catalog_meta') IS NOT NULL`).Scan(&meta); err != nil {
		t.Fatal(err)
	}
	if meta {
		t.Fatal("catalog_meta must be gone")
	}
}

func TestMigrationDownAndOldSchema(t *testing.T) {
	ctx := context.Background()
	dsn, pool, cleanup, err := StartDSN(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()

	if err := core_postgres.Migrate(dsn); err != nil {
		t.Fatalf("second migrate: %v", err)
	}

	if _, err := pool.Exec(ctx, `DROP TABLE card_versions`); err != nil {
		t.Fatal(err)
	}
	err = core_postgres.Migrate(dsn)
	if err == nil || !strings.Contains(err.Error(), "another build") {
		t.Fatalf("migrate on old schema err = %v, want 'another build'", err)
	}
	pool.Close()

	src, err := iofs.New(migrations.Files, ".")
	if err != nil {
		t.Fatal(err)
	}
	mg, err := migrate.NewWithSourceInstance("iofs", src, strings.Replace(dsn, "postgres://", "pgx5://", 1))
	if err != nil {
		t.Fatal(err)
	}
	defer mg.Close()
	if err := mg.Down(); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := mg.Up(); err != nil {
		t.Fatalf("up after down: %v", err)
	}
	if err := core_postgres.Migrate(dsn); err != nil {
		t.Fatalf("migrate after recreate: %v", err)
	}
}
