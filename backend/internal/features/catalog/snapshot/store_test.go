package catalog_snapshot

import (
	"context"
	"errors"
	"testing"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type countingLoader struct {
	calls int
}

func (c *countingLoader) ListDecks(ctx context.Context) ([]catalog_domain.Deck, error) {
	c.calls++
	return []catalog_domain.Deck{{ID: 1, Slug: "default", Title: "Default", Kind: "admin"}}, nil
}

func (c *countingLoader) ListAllCards(ctx context.Context, deckID int64) ([]catalog_domain.Card, error) {
	c.calls++
	return []catalog_domain.Card{{ID: 7, DeckID: deckID, Word: "alpha", Translation: "альфа", Pos: catalog_domain.PosNoun}}, nil
}

func TestListDoesNotTouchLoader(t *testing.T) {
	loader := &countingLoader{}
	store := New()
	if err := store.Reload(context.Background(), loader, func(items []catalog_domain.Card, total, limit, offset int) ([]byte, error) {
		return []byte(`{"items":[],"total":0,"limit":1000,"offset":0}`), nil
	}); err != nil {
		t.Fatal(err)
	}
	calls := loader.calls
	limit := 1000
	if _, err := store.ListCards(context.Background(), &limit, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetCard(context.Background(), 7); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ListDecks(context.Background()); err != nil {
		t.Fatal(err)
	}
	if loader.calls != calls {
		t.Fatalf("loader calls = %d, after reload %d", loader.calls, calls)
	}
}

func TestMissingSnapshotIsNotReady(t *testing.T) {
	_, err := New().ListDecks(context.Background())
	if !errors.Is(err, core_errors.ErrNotReady) {
		t.Fatal(err)
	}
}
