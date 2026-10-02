package catalog_service

import (
	"context"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (s *Service) ReplaceAdminCards(ctx context.Context, cards []catalog_domain.Card) error {
	if len(cards) == 0 {
		return fmt.Errorf("no cards: %w", core_errors.ErrInvalidArgument)
	}

	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return err
	}

	prepared := make([]catalog_domain.Card, len(cards))
	for i, card := range cards {
		card.ID = 0
		card.DeckID = deck.ID
		card.Version = 0
		if err := card.Validate(); err != nil {
			return fmt.Errorf("card %d: %w", i+1, err)
		}
		prepared[i] = card
	}
	return s.repo.ReplaceDeckCards(ctx, deck.ID, prepared)
}
