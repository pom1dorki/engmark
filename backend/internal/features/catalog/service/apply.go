package catalog_service

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func normalized(cs catalog_domain.Changeset) catalog_domain.Changeset {
	cs.Message = strings.TrimSpace(cs.Message)
	cs.Create = append([]catalog_domain.Card(nil), cs.Create...)
	for i := range cs.Create {
		cs.Create[i].Normalize()
	}
	cs.Update = append([]catalog_domain.CardUpdate(nil), cs.Update...)
	for i := range cs.Update {
		cs.Update[i].Card.Normalize()
	}
	files := make([]catalog_domain.ImportFile, len(cs.Imports))
	for i, f := range cs.Imports {
		f.FileName = strings.TrimSpace(f.FileName)
		f.Cards = append([]catalog_domain.Card(nil), f.Cards...)
		for j := range f.Cards {
			f.Cards[j].Normalize()
		}
		files[i] = f
	}
	cs.Imports = files
	return cs
}

func (s *Service) check(cs *catalog_domain.Changeset) error {
	errs := cs.Validate()
	if utf8.RuneCountInString(cs.Message) > maxMessageLen {
		errs = append(errs, catalog_domain.ChangesetError{
			Section: catalog_domain.SectionChangeset, Field: "message", Code: catalog_domain.FieldTooLong, Message: "message too long",
		})
	}
	if len(errs) > 0 {
		return &catalog_domain.ValidationError{Errors: errs}
	}
	return nil
}

func (s *Service) ApplyChangeset(ctx context.Context, cs catalog_domain.Changeset) (catalog_domain.ChangesetResult, error) {
	cs = normalized(cs)
	if err := s.check(&cs); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	deck, err := s.repo.GetAdminDeck(ctx)
	if err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if err := s.rejectNoChanges(ctx, deck.ID, cs); err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	if cs.Message == "" {
		cs.Message = defaultMessage(cs)
	}

	result, err := s.repo.ApplyChangeset(ctx, deck.ID, cs, catalog_domain.AuthorAdmin, sourceOf(cs))
	if err != nil {
		return catalog_domain.ChangesetResult{}, err
	}
	s.notify(ctx, result.Revision)
	return result, nil
}

func (s *Service) rejectNoChanges(ctx context.Context, deckID int64, cs catalog_domain.Changeset) error {
	if len(cs.Update) == 0 {
		return nil
	}
	restored := make(map[int64]struct{}, len(cs.Restore))
	for _, ref := range cs.Restore {
		restored[ref.ID] = struct{}{}
	}
	ids := make([]int64, 0, len(cs.Update))
	for _, up := range cs.Update {
		ids = append(ids, up.ID)
	}
	current, err := s.repo.GetCards(ctx, deckID, ids)
	if err != nil {
		return err
	}

	var errs []catalog_domain.ChangesetError
	for i, up := range cs.Update {
		if _, paired := restored[up.ID]; paired {
			continue
		}
		cur, ok := current[up.ID]
		if !ok || cur.Version != up.BaseVersion || cur.Archived() {
			continue
		}
		if up.Card.SameContent(cur) {
			errs = append(errs, catalog_domain.ChangesetError{
				Section: catalog_domain.SectionUpdate, Index: i, ID: up.ID,
				Code: catalog_domain.CodeNoChanges, Message: fmt.Sprintf("card %d is unchanged", up.ID),
			})
		}
	}
	if len(errs) > 0 {
		return &catalog_domain.ValidationError{Errors: errs}
	}
	return nil
}

func sourceOf(cs catalog_domain.Changeset) string {
	if len(cs.Create)+len(cs.Update)+len(cs.Archive)+len(cs.Restore) == 0 && cs.ImportRows() > 0 {
		return catalog_domain.SourceImport
	}
	return catalog_domain.SourceEditor
}

func defaultMessage(cs catalog_domain.Changeset) string {
	var names []string
	for _, f := range cs.Imports {
		if len(f.Cards) > 0 {
			names = append(names, f.FileName)
		}
	}
	switch {
	case len(names) > 0 && sourceOf(cs) == catalog_domain.SourceImport:
		return "Импорт: " + strings.Join(names, ", ")
	case len(names) > 0:
		return "Импорт: " + strings.Join(names, ", ") + " и правки"
	default:
		return "Правки карточек"
	}
}
