package catalog_service

import (
	"context"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (s *Service) AdminDeck(ctx context.Context) (catalog_domain.Deck, error) {
	return s.repo.GetAdminDeck(ctx)
}

func (s *Service) SeedIfEmpty(ctx context.Context, cards []catalog_domain.Card) (bool, error) {
	if len(cards) == 0 {
		return false, fmt.Errorf("no cards: %w", core_errors.ErrInvalidArgument)
	}
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return false, err
	}
	if deck.Revision != 0 {
		return false, nil
	}

	prepared := make([]catalog_domain.Card, len(cards))
	seen := make(map[catalog_domain.Key]int, len(cards))
	for i, card := range cards {
		card.ID, card.DeckID, card.Version = 0, deck.ID, 0
		card.Normalize()
		if err := card.Validate(); err != nil {
			return false, fmt.Errorf("card %d: %w", i+1, err)
		}
		key := catalog_domain.CardKey(card)
		if prev, ok := seen[key]; ok {
			return false, fmt.Errorf("card %d duplicates card %d: %w", i+1, prev, core_errors.ErrConflict)
		}
		seen[key] = i + 1
		prepared[i] = card
	}
	return s.repo.SeedIfEmpty(ctx, deck.ID, prepared)
}
