package catalog_service

import (
	"context"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (s *Service) RevertDraft(ctx context.Context, rev int64) (catalog_domain.Changeset, error) {
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.Changeset{}, err
	}
	if rev < 1 || rev > deck.Revision {
		return catalog_domain.Changeset{}, fmt.Errorf("revision r%d: %w", rev, core_errors.ErrNotFound)
	}
	changes, err := s.repo.ListChangesSince(ctx, deck.ID, rev)
	if err != nil {
		return catalog_domain.Changeset{}, err
	}

	cs := catalog_domain.Changeset{
		BaseRevision: changes.Revision,
		Message:      fmt.Sprintf("Откат к r%d", rev),
	}
	for _, item := range changes.Items {
		cur, base := item.Current, item.Base
		switch {
		case base == nil || base.Archived:
			if !cur.Archived() {
				cs.Archive = append(cs.Archive, catalog_domain.CardRef{ID: cur.ID, BaseVersion: cur.Version})
			}
		default:
			want := base.Data.Card()
			if cur.Archived() {
				cs.Restore = append(cs.Restore, catalog_domain.CardRef{ID: cur.ID, BaseVersion: cur.Version})
				if !cur.SameContent(want) {
					cs.Update = append(cs.Update, catalog_domain.CardUpdate{ID: cur.ID, BaseVersion: cur.Version, Card: want})
				}
			} else if !cur.SameContent(want) {
				cs.Update = append(cs.Update, catalog_domain.CardUpdate{ID: cur.ID, BaseVersion: cur.Version, Card: want})
			}
		}
	}
	return cs, nil
}
