package catalog_service

import (
	"context"
	"fmt"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (s *Service) ValidateChangeset(ctx context.Context, cs catalog_domain.Changeset) (catalog_domain.ValidationReport, error) {
	cs = normalized(cs)
	if err := s.check(&cs); err != nil {
		return catalog_domain.ValidationReport{}, err
	}
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.ValidationReport{}, err
	}

	keys := make([]catalog_domain.Key, 0, len(cs.Create)+cs.ImportRows())
	for _, c := range cs.Create {
		keys = append(keys, catalog_domain.CardKey(c))
	}
	for _, f := range cs.Imports {
		for _, c := range f.Cards {
			keys = append(keys, catalog_domain.CardKey(c))
		}
	}
	existing, err := s.repo.ExistingKeys(ctx, deck.ID, keys)
	if err != nil {
		return catalog_domain.ValidationReport{}, err
	}

	taken := make(map[catalog_domain.Key]struct{}, len(keys))
	var dups []catalog_domain.ChangesetError
	for i, c := range cs.Create {
		key := catalog_domain.CardKey(c)
		if _, ok := existing[key]; ok {
			dups = append(dups, catalog_domain.ChangesetError{
				Section: catalog_domain.SectionCreate, Index: i, Field: "word", Code: catalog_domain.CodeDuplicateCard,
				Message: fmt.Sprintf("card %q already exists", c.Word),
			})
		}
		taken[key] = struct{}{}
	}
	if len(dups) > 0 {
		return catalog_domain.ValidationReport{}, &catalog_domain.ValidationError{Errors: dups}
	}

	report := catalog_domain.ValidationReport{Revision: deck.Revision, Imports: []catalog_domain.ImportResult{}}
	for _, f := range cs.Imports {
		if len(f.Cards) == 0 {
			continue
		}
		res := catalog_domain.ImportResult{FileName: f.FileName, Skipped: []catalog_domain.SkippedRow{}}
		for i, c := range f.Cards {
			key := catalog_domain.CardKey(c)
			_, inDB := existing[key]
			_, inBatch := taken[key]
			if inDB || inBatch {
				res.Skipped = append(res.Skipped, catalog_domain.SkippedRow{Index: i, Reason: catalog_domain.SkipDuplicate})
				continue
			}
			taken[key] = struct{}{}
			res.Added++
		}
		report.Imports = append(report.Imports, res)
	}
	return report, nil
}
