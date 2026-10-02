package catalog_service

import (
	"context"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (s *Service) CreateCard(ctx context.Context, deckID *int64, card catalog_domain.Card) (catalog_domain.Card, error) {
	var (
		deck catalog_domain.Deck
		err  error
	)
	if deckID == nil {
		deck, err = s.repo.GetDeckBySlug(ctx, defaultDeckSlug)
	} else {
		deck, err = s.repo.GetDeck(ctx, *deckID)
	}
	if err != nil {
		return catalog_domain.Card{}, err
	}

	card.ID = 0
	card.DeckID = deck.ID
	card.Version = 0
	if err := card.Validate(); err != nil {
		return catalog_domain.Card{}, err
	}

	return s.repo.CreateCard(ctx, card)
}

func (s *Service) PatchCard(ctx context.Context, id int64, patch catalog_domain.CardPatch) (catalog_domain.Card, error) {
	current, err := s.repo.GetCard(ctx, id)
	if err != nil {
		return catalog_domain.Card{}, err
	}

	next, err := catalog_domain.Apply(current, patch)
	if err != nil {
		return catalog_domain.Card{}, err
	}

	return s.repo.UpdateCard(ctx, next)
}

func (s *Service) DeleteCard(ctx context.Context, id int64) error {
	return s.repo.DeleteCard(ctx, id)
}
