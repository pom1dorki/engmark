package catalog_transport_http

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_snapshot "github.com/pom1dorki/engmark/internal/features/catalog/snapshot"
	"go.uber.org/zap"
)

type benchLoader struct {
	decks []catalog_domain.Deck
	cards []catalog_domain.Card
}

func (l benchLoader) ListDecks(context.Context) ([]catalog_domain.Deck, error) {
	return l.decks, nil
}

func (l benchLoader) ListAllCards(context.Context, int64) ([]catalog_domain.Card, error) {
	return l.cards, nil
}

func benchHandler(b *testing.B) http.Handler {
	b.Helper()
	now := time.Unix(1_700_000_000, 0).UTC()
	pos := []string{catalog_domain.PosVerb, catalog_domain.PosNoun, catalog_domain.PosAdj, catalog_domain.PosAdv}
	cards := make([]catalog_domain.Card, 375)
	for i := range cards {
		n := i + 1
		cards[i] = catalog_domain.Card{
			ID:                 int64(n),
			DeckID:             1,
			Version:            1,
			Word:               fmt.Sprintf("word-%d", n),
			Translation:        fmt.Sprintf("перевод-%d", n),
			IPA:                "/w/",
			Pronunciation:      "ворд",
			StressNote:         "ударение",
			Pos:                pos[i%len(pos)],
			Grammar:            "грамматика",
			Usage:              "контекст",
			Example:            "An example sentence.",
			ExampleHighlight:   "example",
			ExampleTranslation: "Пример перевода.",
			CreatedAt:          now,
			UpdatedAt:          now,
		}
	}
	store := catalog_snapshot.New()
	if err := store.Reload(context.Background(), benchLoader{
		decks: []catalog_domain.Deck{{ID: 1, Slug: "default", Title: "Default", Kind: catalog_domain.DeckKindAdmin}},
		cards: cards,
	}, MarshalCardList); err != nil {
		b.Fatal(err)
	}
	h := New(store)
	mux := http.NewServeMux()
	for _, route := range h.Routes() {
		mux.Handle(route.Method+" "+route.Path, route.Handler)
	}
	log := &core_logger.Logger{Logger: zap.NewNop()}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r.WithContext(core_logger.ToContext(r.Context(), log)))
	})
}

func BenchmarkListCardsFull(b *testing.B) {
	handler := benchHandler(b)
	req := httptest.NewRequest(http.MethodGet, "/cards?limit=1000&offset=0", nil)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			b.Fatalf("status %d", rec.Code)
		}
	}
}

func BenchmarkListCardsPage(b *testing.B) {
	handler := benchHandler(b)
	req := httptest.NewRequest(http.MethodGet, "/cards?limit=50&offset=100", nil)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			b.Fatalf("status %d", rec.Code)
		}
	}
}
