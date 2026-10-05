package catalog_snapshot

import (
	"context"
	"fmt"
	"sync/atomic"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type MarshalList func(items []catalog_domain.Card, total, limit, offset int) ([]byte, error)

type Loader interface {
	ListDecks(ctx context.Context) ([]catalog_domain.Deck, error)
	ListAllCards(ctx context.Context, deckID int64) ([]catalog_domain.Card, error)
}

type Page struct {
	Items  []catalog_domain.Card
	Total  int
	Limit  int
	Offset int
	Body   []byte
	ETag   string
}

type DeckCards struct {
	items    []catalog_domain.Card
	full     []byte
	fullETag string
}

type Snapshot struct {
	decks     []catalog_domain.Deck
	byDeck    map[int64]*DeckCards
	byID      map[int64]catalog_domain.Card
	defaultID int64
}

type Store struct {
	cur atomic.Pointer[Snapshot]
}

func New() *Store {
	return &Store{}
}

func (s *Store) Load() *Snapshot {
	return s.cur.Load()
}

func (s *Store) Reload(ctx context.Context, repo Loader, marshal MarshalList) error {
	if marshal == nil {
		return fmt.Errorf("catalog marshal is nil")
	}
	decks, err := repo.ListDecks(ctx)
	if err != nil {
		return err
	}
	snap := &Snapshot{
		decks:  decks,
		byDeck: make(map[int64]*DeckCards, len(decks)),
		byID:   map[int64]catalog_domain.Card{},
	}
	for _, deck := range decks {
		if deck.Slug == "default" {
			snap.defaultID = deck.ID
		}
		cards, err := repo.ListAllCards(ctx, deck.ID)
		if err != nil {
			return err
		}
		view := &DeckCards{items: cards}
		if len(cards) <= catalog_domain.MaxLimit {
			body, err := marshal(cards, len(cards), catalog_domain.MaxLimit, 0)
			if err != nil {
				return fmt.Errorf("marshal deck %d: %w", deck.ID, err)
			}
			view.full = body
			view.fullETag = core_http_response.WeakETag(body)
		}
		for _, card := range cards {
			snap.byID[card.ID] = card
		}
		snap.byDeck[deck.ID] = view
	}
	if snap.defaultID == 0 {
		return fmt.Errorf("default deck: %w", core_errors.ErrNotFound)
	}
	s.cur.Store(snap)
	return nil
}

func (s *Store) ListCards(ctx context.Context, limit, offset *int) (Page, error) {
	return s.list(ctx, 0, true, limit, offset)
}

func (s *Store) ListCardsByDeck(ctx context.Context, deckID int64, limit, offset *int) (Page, error) {
	return s.list(ctx, deckID, false, limit, offset)
}

func (s *Store) list(ctx context.Context, deckID int64, defaultDeck bool, limit, offset *int) (Page, error) {
	if err := ctx.Err(); err != nil {
		return Page{}, err
	}
	snap := s.cur.Load()
	if snap == nil {
		return Page{}, fmt.Errorf("catalog: %w", core_errors.ErrNotReady)
	}
	if defaultDeck {
		deckID = snap.defaultID
	}
	lim, off, err := normalize(limit, offset)
	if err != nil {
		return Page{}, err
	}
	view, ok := snap.byDeck[deckID]
	if !ok {
		return Page{}, fmt.Errorf("deck %d: %w", deckID, core_errors.ErrNotFound)
	}
	total := len(view.items)
	if off == 0 && lim >= total && lim == catalog_domain.MaxLimit && view.full != nil {
		return Page{
			Items:  view.items,
			Total:  total,
			Limit:  lim,
			Offset: off,
			Body:   view.full,
			ETag:   view.fullETag,
		}, nil
	}
	start := off
	if start > total {
		start = total
	}
	end := start + lim
	if end > total {
		end = total
	}
	items := view.items[start:end]
	if items == nil {
		items = []catalog_domain.Card{}
	}
	return Page{Items: items, Total: total, Limit: lim, Offset: off}, nil
}

func (s *Store) GetCard(ctx context.Context, id int64) (catalog_domain.Card, error) {
	if err := ctx.Err(); err != nil {
		return catalog_domain.Card{}, err
	}
	snap := s.cur.Load()
	if snap == nil {
		return catalog_domain.Card{}, fmt.Errorf("catalog: %w", core_errors.ErrNotReady)
	}
	card, ok := snap.byID[id]
	if !ok {
		return catalog_domain.Card{}, fmt.Errorf("card %d: %w", id, core_errors.ErrNotFound)
	}
	return card, nil
}

func (s *Store) ListDecks(ctx context.Context) ([]catalog_domain.Deck, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	snap := s.cur.Load()
	if snap == nil {
		return nil, fmt.Errorf("catalog: %w", core_errors.ErrNotReady)
	}
	out := make([]catalog_domain.Deck, len(snap.decks))
	copy(out, snap.decks)
	return out, nil
}

func normalize(limit, offset *int) (int, int, error) {
	lim := catalog_domain.DefaultLimit
	if limit != nil {
		if *limit < 1 || *limit > catalog_domain.MaxLimit {
			return 0, 0, fmt.Errorf("limit %d must be from 1 to %d: %w", *limit, catalog_domain.MaxLimit, core_errors.ErrInvalidArgument)
		}
		lim = *limit
	}
	off := 0
	if offset != nil {
		if *offset < 0 {
			return 0, 0, fmt.Errorf("offset %d is negative: %w", *offset, core_errors.ErrInvalidArgument)
		}
		off = *offset
	}
	return lim, off, nil
}
