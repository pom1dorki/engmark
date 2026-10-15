package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type fakeSeeder struct {
	revision int64
	seeded   int
}

func (f *fakeSeeder) AdminDeck(context.Context) (catalog_domain.Deck, error) {
	return catalog_domain.Deck{ID: 1, Revision: f.revision}, nil
}

func (f *fakeSeeder) SeedIfEmpty(_ context.Context, cards []catalog_domain.Card) (bool, error) {
	if f.revision != 0 {
		return false, nil
	}
	f.seeded = len(cards)
	return true, nil
}

func TestSeedCatalog(t *testing.T) {
	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	good := filepath.Join(dir, "cards.json")
	if err := os.WriteFile(good, []byte(`[{"word":"alpha","translation":"альфа","ipa":"","pronunciation":"","stressNote":"","pos":"noun","grammar":"","usage":"","example":"","exampleHighlight":"","exampleTranslation":""}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(dir, "broken.json")
	if err := os.WriteFile(broken, []byte(`{not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "missing.json")

	tests := []struct {
		name       string
		revision   int64
		path       string
		wantErr    bool
		wantSeeded int
	}{
		{name: "empty deck is seeded", revision: 0, path: good, wantSeeded: 1},
		{name: "file is ignored once the deck has revisions", revision: 3, path: good},
		{name: "missing file and empty deck is fine", revision: 0, path: missing},
		{name: "missing file and live deck is fine", revision: 3, path: missing},
		{name: "broken file on an empty deck fails", revision: 0, path: broken, wantErr: true},
		{name: "broken file on a live deck is ignored", revision: 3, path: broken},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeSeeder{revision: tt.revision}
			err := seedCatalog(context.Background(), log, f, tt.path)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if f.seeded != tt.wantSeeded {
				t.Fatalf("seeded = %d, want %d", f.seeded, tt.wantSeeded)
			}
		})
	}
}
