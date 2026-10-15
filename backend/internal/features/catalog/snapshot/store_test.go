package catalog_snapshot

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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

func emptyList(items []catalog_domain.Card, total, limit, offset int) ([]byte, error) {
	return []byte(`{"items":[],"total":0,"limit":1000,"offset":0}`), nil
}

type revisionLoader struct {
	revision atomic.Int64
	builds   atomic.Int32
	entered  chan struct{}
	gate     chan struct{}
}

func (l *revisionLoader) ListDecks(ctx context.Context) ([]catalog_domain.Deck, error) {
	rev := l.revision.Load()
	if l.builds.Add(1) == 1 && l.gate != nil {
		close(l.entered)
		<-l.gate
	}
	return []catalog_domain.Deck{{ID: 1, Slug: "default", Kind: "admin", Revision: rev}}, nil
}

func (l *revisionLoader) ListAllCards(ctx context.Context, deckID int64) ([]catalog_domain.Card, error) {
	return []catalog_domain.Card{{ID: 7, DeckID: deckID, Word: "alpha", Translation: "альфа", Pos: catalog_domain.PosNoun}}, nil
}

func TestSnapshotCarriesRevision(t *testing.T) {
	loader := &revisionLoader{}
	loader.revision.Store(42)
	store := New()
	if store.Revision() != 0 {
		t.Fatal("empty store must report revision 0")
	}
	if err := store.Reload(context.Background(), loader, emptyList); err != nil {
		t.Fatal(err)
	}
	if store.Revision() != 42 || store.Load().Revision() != 42 {
		t.Fatalf("revision = %d", store.Revision())
	}
	limit := 1000
	page, err := store.ListCards(context.Background(), &limit, nil)
	if err != nil || page.Revision != 42 {
		t.Fatalf("page = %+v, %v", page, err)
	}
}

func TestStaleReloadDoesNotOverwriteNewerSnapshot(t *testing.T) {
	loader := &revisionLoader{}
	store := New()
	loader.revision.Store(5)
	if err := store.Reload(context.Background(), loader, emptyList); err != nil {
		t.Fatal(err)
	}
	loader.revision.Store(3)
	if err := store.Reload(context.Background(), loader, emptyList); err != nil {
		t.Fatal(err)
	}
	if store.Revision() != 5 {
		t.Fatalf("revision = %d, want 5", store.Revision())
	}
	loader.revision.Store(6)
	if err := store.Reload(context.Background(), loader, emptyList); err != nil || store.Revision() != 6 {
		t.Fatalf("revision = %d, %v", store.Revision(), err)
	}
}

func TestConcurrentReloadsAreCoalesced(t *testing.T) {
	loader := &revisionLoader{entered: make(chan struct{}), gate: make(chan struct{})}
	loader.revision.Store(1)
	store := New()

	var wg sync.WaitGroup
	errs := make(chan error, 11)
	wg.Add(1)
	go func() {
		defer wg.Done()
		errs <- store.Reload(context.Background(), loader, emptyList)
	}()
	<-loader.entered

	loader.revision.Store(2)
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- store.Reload(context.Background(), loader, emptyList)
		}()
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		store.mu.Lock()
		queued := store.queued != nil && store.queued.waiters == 10
		store.mu.Unlock()
		if queued {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("followers never queued")
		}
		time.Sleep(time.Millisecond)
	}
	close(loader.gate)
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	deadline = time.Now().Add(5 * time.Second)
	for loader.builds.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	if got := loader.builds.Load(); got != 2 {
		t.Fatalf("builds = %d, want 2", got)
	}
	if store.Revision() != 2 {
		t.Fatalf("revision = %d, want 2", store.Revision())
	}
}

func TestReloadWaiterHonorsContext(t *testing.T) {
	loader := &revisionLoader{entered: make(chan struct{}), gate: make(chan struct{})}
	store := New()
	go func() { _ = store.Reload(context.Background(), loader, emptyList) }()
	<-loader.entered

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := store.Reload(ctx, loader, emptyList); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v", err)
	}
	close(loader.gate)
}
