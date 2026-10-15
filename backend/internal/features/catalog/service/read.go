package catalog_service

import (
	"context"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (s *Service) DeckSummary(ctx context.Context) (catalog_domain.DeckSummary, error) {
	summary, err := s.repo.GetDeckSummary(ctx)
	if err != nil {
		return catalog_domain.DeckSummary{}, err
	}
	s.refreshIfLagging(ctx, summary.Revision)
	return summary, nil
}

func (s *Service) ListCards(ctx context.Context, f catalog_domain.CardFilter) (catalog_domain.CardPage, error) {
	switch f.State {
	case "":
		f.State = catalog_domain.StateActive
	case catalog_domain.StateActive, catalog_domain.StateArchived, catalog_domain.StateIncomplete:
	default:
		return catalog_domain.CardPage{}, fmt.Errorf("state %q: %w", f.State, core_errors.ErrInvalidArgument)
	}
	switch f.Pos {
	case "", catalog_domain.PosVerb, catalog_domain.PosNoun, catalog_domain.PosAdj, catalog_domain.PosAdv:
	default:
		return catalog_domain.CardPage{}, fmt.Errorf("pos %q: %w", f.Pos, core_errors.ErrInvalidArgument)
	}
	if f.Limit == 0 {
		f.Limit = defaultAdminLimit
	}
	if f.Limit < 1 || f.Limit > maxAdminLimit {
		return catalog_domain.CardPage{}, fmt.Errorf("limit %d must be from 1 to %d: %w", f.Limit, maxAdminLimit, core_errors.ErrInvalidArgument)
	}
	if f.Offset < 0 {
		return catalog_domain.CardPage{}, fmt.Errorf("offset %d is negative: %w", f.Offset, core_errors.ErrInvalidArgument)
	}
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.CardPage{}, err
	}
	return s.repo.ListAdminCards(ctx, deck.ID, f)
}

func (s *Service) GetCard(ctx context.Context, id int64) (catalog_domain.Card, error) {
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.Card{}, err
	}
	return s.repo.GetCard(ctx, deck.ID, id)
}

func (s *Service) ListCardVersions(ctx context.Context, id int64) ([]catalog_domain.CardVersion, error) {
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return nil, err
	}
	return s.repo.ListCardVersions(ctx, deck.ID, id)
}

func (s *Service) GetCardVersion(ctx context.Context, id int64, version int) (catalog_domain.CardVersion, error) {
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.CardVersion{}, err
	}
	return s.repo.GetCardVersion(ctx, deck.ID, id, version)
}

func (s *Service) ListChangesSince(ctx context.Context, since int64) (catalog_domain.Changes, error) {
	if since < 0 {
		return catalog_domain.Changes{}, fmt.Errorf("since %d is negative: %w", since, core_errors.ErrInvalidArgument)
	}
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.Changes{}, err
	}
	return s.repo.ListChangesSince(ctx, deck.ID, since)
}

func (s *Service) ListRevisions(ctx context.Context, limit int, before int64) ([]catalog_domain.Revision, error) {
	if limit == 0 {
		limit = defaultRevisionLimit
	}
	if limit < 1 || limit > maxRevisionLimit {
		return nil, fmt.Errorf("limit %d must be from 1 to %d: %w", limit, maxRevisionLimit, core_errors.ErrInvalidArgument)
	}
	if before < 0 {
		return nil, fmt.Errorf("before %d is negative: %w", before, core_errors.ErrInvalidArgument)
	}
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return nil, err
	}
	return s.repo.ListRevisions(ctx, deck.ID, limit, before)
}

func (s *Service) GetRevision(ctx context.Context, rev int64) (catalog_domain.RevisionDetail, error) {
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.RevisionDetail{}, err
	}
	return s.repo.GetRevision(ctx, deck.ID, rev)
}

func (s *Service) Export(ctx context.Context, rev *int64) (catalog_domain.DeckState, error) {
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.DeckState{}, err
	}
	if rev == nil {
		return s.repo.CurrentState(ctx, deck.ID)
	}
	return s.repo.SnapshotAt(ctx, deck.ID, *rev)
}
