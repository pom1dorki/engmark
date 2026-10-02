package catalog_service

import (
	"context"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const (
	defaultDeckSlug = "default"
	defaultLimit    = 50
	maxLimit        = 100
)

type Repository interface {
	ListCards(ctx context.Context, deckID int64, limit, offset int) ([]catalog_domain.Card, error)
	CountCards(ctx context.Context, deckID int64) (int, error)
	GetCard(ctx context.Context, id int64) (catalog_domain.Card, error)
	ListDecks(ctx context.Context) ([]catalog_domain.Deck, error)
	GetDeck(ctx context.Context, id int64) (catalog_domain.Deck, error)
	GetDeckBySlug(ctx context.Context, slug string) (catalog_domain.Deck, error)
	GetAdminDeck(ctx context.Context) (catalog_domain.Deck, error)
	ReplaceDeckCards(ctx context.Context, deckID int64, cards []catalog_domain.Card) error
	CreateCard(ctx context.Context, card catalog_domain.Card) (catalog_domain.Card, error)
	UpdateCard(ctx context.Context, card catalog_domain.Card) (catalog_domain.Card, error)
	DeleteCard(ctx context.Context, id int64) error
}

type CardList struct {
	Items  []catalog_domain.Card
	Total  int
	Limit  int
	Offset int
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListDecks(ctx context.Context) ([]catalog_domain.Deck, error) {
	return s.repo.ListDecks(ctx)
}

func (s *Service) GetDeck(ctx context.Context, id int64) (catalog_domain.Deck, error) {
	return s.repo.GetDeck(ctx, id)
}

func (s *Service) GetCard(ctx context.Context, id int64) (catalog_domain.Card, error) {
	return s.repo.GetCard(ctx, id)
}

func (s *Service) ListCards(ctx context.Context, deckID *int64, limit, offset *int) (CardList, error) {
	lim, off, err := normalizePage(limit, offset)
	if err != nil {
		return CardList{}, err
	}

	var deck catalog_domain.Deck
	if deckID == nil {
		deck, err = s.repo.GetDeckBySlug(ctx, defaultDeckSlug)
	} else {
		deck, err = s.repo.GetDeck(ctx, *deckID)
	}
	if err != nil {
		return CardList{}, err
	}

	return s.listByDeck(ctx, deck.ID, lim, off)
}

func (s *Service) ListCardsByDeck(ctx context.Context, deckID int64, limit, offset *int) (CardList, error) {
	lim, off, err := normalizePage(limit, offset)
	if err != nil {
		return CardList{}, err
	}

	if _, err := s.repo.GetDeck(ctx, deckID); err != nil {
		return CardList{}, err
	}

	return s.listByDeck(ctx, deckID, lim, off)
}

func (s *Service) listByDeck(ctx context.Context, deckID int64, limit, offset int) (CardList, error) {
	items, err := s.repo.ListCards(ctx, deckID, limit, offset)
	if err != nil {
		return CardList{}, err
	}
	total, err := s.repo.CountCards(ctx, deckID)
	if err != nil {
		return CardList{}, err
	}
	return CardList{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

func normalizePage(limit, offset *int) (int, int, error) {
	lim := defaultLimit
	if limit != nil {
		if *limit < 1 || *limit > maxLimit {
			return 0, 0, fmt.Errorf("limit %d must be from 1 to %d: %w", *limit, maxLimit, core_errors.ErrInvalidArgument)
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
