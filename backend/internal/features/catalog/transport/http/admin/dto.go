package catalog_admin_transport_http

import (
	"time"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type CardDTO struct {
	ID int64 `json:"id"`
	catalog_domain.CardData
	Version         int        `json:"version"`
	Archived        bool       `json:"archived"`
	ArchivedAt      *time.Time `json:"archivedAt"`
	CreatedRevision int64      `json:"createdRevision"`
	UpdatedRevision int64      `json:"updatedRevision"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func cardDTO(c catalog_domain.Card) CardDTO {
	return CardDTO{
		ID: c.ID, CardData: c.Data(), Version: c.Version,
		Archived: c.Archived(), ArchivedAt: c.ArchivedAt,
		CreatedRevision: c.CreatedRevision, UpdatedRevision: c.UpdatedRevision, UpdatedAt: c.UpdatedAt,
	}
}

type DeckDTO struct {
	ID            int64  `json:"id"`
	Slug          string `json:"slug"`
	Title         string `json:"title"`
	Revision      int64  `json:"revision"`
	ActiveCards   int    `json:"activeCards"`
	ArchivedCards int    `json:"archivedCards"`
}

type CardListDTO struct {
	Revision int64     `json:"revision"`
	Items    []CardDTO `json:"items"`
	Total    int       `json:"total"`
	Limit    int       `json:"limit"`
	Offset   int       `json:"offset"`
}

type VersionDTO struct {
	CardID    int64                   `json:"cardId"`
	Version   int                     `json:"version"`
	Revision  int64                   `json:"revision"`
	Archived  bool                    `json:"archived"`
	CreatedAt time.Time               `json:"createdAt"`
	Card      catalog_domain.CardData `json:"card"`
}

func versionDTO(v catalog_domain.CardVersion) VersionDTO {
	return VersionDTO{CardID: v.CardID, Version: v.Version, Revision: v.Revision, Archived: v.Archived, CreatedAt: v.CreatedAt, Card: v.Data}
}

type ChangeDTO struct {
	Current CardDTO     `json:"current"`
	Base    *VersionDTO `json:"base"`
}

type ChangesDTO struct {
	Revision int64       `json:"revision"`
	Since    int64       `json:"since"`
	Items    []ChangeDTO `json:"items"`
}

type RevisionDTO struct {
	Revision      int64                         `json:"revision"`
	BaseRevision  int64                         `json:"baseRevision"`
	Author        string                        `json:"author"`
	Message       string                        `json:"message"`
	Source        string                        `json:"source"`
	Created       int                           `json:"created"`
	Updated       int                           `json:"updated"`
	Archived      int                           `json:"archived"`
	Restored      int                           `json:"restored"`
	ImportedFiles []catalog_domain.ImportedFile `json:"importedFiles"`
	CreatedAt     time.Time                     `json:"createdAt"`
}

func revisionDTO(r catalog_domain.Revision) RevisionDTO {
	return RevisionDTO{
		Revision: r.Revision, BaseRevision: r.BaseRevision, Author: r.Author, Message: r.Message, Source: r.Source,
		Created: r.CreatedN, Updated: r.UpdatedN, Archived: r.ArchivedN, Restored: r.RestoredN,
		ImportedFiles: r.ImportedFiles, CreatedAt: r.CreatedAt,
	}
}

type RevisionChangeDTO struct {
	CardID      int64  `json:"cardId"`
	Version     int    `json:"version"`
	Kind        string `json:"kind"`
	Word        string `json:"word"`
	Translation string `json:"translation"`
}

type RevisionDetailDTO struct {
	RevisionDTO
	Changes []RevisionChangeDTO `json:"changes"`
}

type UpdateDTO struct {
	ID          int64                   `json:"id"`
	BaseVersion int                     `json:"baseVersion"`
	Card        catalog_domain.CardData `json:"card"`
}

type RefDTO struct {
	ID          int64 `json:"id"`
	BaseVersion int   `json:"baseVersion"`
}

type ImportDTO struct {
	FileName string                    `json:"fileName"`
	Cards    []catalog_domain.CardData `json:"cards"`
}

type ChangesetDTO struct {
	BaseRevision int64                     `json:"baseRevision"`
	Message      string                    `json:"message"`
	Create       []catalog_domain.CardData `json:"create"`
	Update       []UpdateDTO               `json:"update"`
	Archive      []RefDTO                  `json:"archive"`
	Restore      []RefDTO                  `json:"restore"`
	Imports      []ImportDTO               `json:"imports"`
}

func (d ChangesetDTO) toDomain() catalog_domain.Changeset {
	cs := catalog_domain.Changeset{BaseRevision: d.BaseRevision, Message: d.Message}
	for _, c := range d.Create {
		cs.Create = append(cs.Create, c.Card())
	}
	for _, u := range d.Update {
		cs.Update = append(cs.Update, catalog_domain.CardUpdate{ID: u.ID, BaseVersion: u.BaseVersion, Card: u.Card.Card()})
	}
	for _, r := range d.Archive {
		cs.Archive = append(cs.Archive, catalog_domain.CardRef{ID: r.ID, BaseVersion: r.BaseVersion})
	}
	for _, r := range d.Restore {
		cs.Restore = append(cs.Restore, catalog_domain.CardRef{ID: r.ID, BaseVersion: r.BaseVersion})
	}
	for _, f := range d.Imports {
		file := catalog_domain.ImportFile{FileName: f.FileName}
		for _, c := range f.Cards {
			file.Cards = append(file.Cards, c.Card())
		}
		cs.Imports = append(cs.Imports, file)
	}
	return cs
}

func changesetDTO(cs catalog_domain.Changeset) ChangesetDTO {
	d := ChangesetDTO{
		BaseRevision: cs.BaseRevision, Message: cs.Message,
		Create:  []catalog_domain.CardData{},
		Update:  []UpdateDTO{},
		Archive: []RefDTO{},
		Restore: []RefDTO{},
		Imports: []ImportDTO{},
	}
	for _, c := range cs.Create {
		d.Create = append(d.Create, c.Data())
	}
	for _, u := range cs.Update {
		d.Update = append(d.Update, UpdateDTO{ID: u.ID, BaseVersion: u.BaseVersion, Card: u.Card.Data()})
	}
	for _, r := range cs.Archive {
		d.Archive = append(d.Archive, RefDTO{ID: r.ID, BaseVersion: r.BaseVersion})
	}
	for _, r := range cs.Restore {
		d.Restore = append(d.Restore, RefDTO{ID: r.ID, BaseVersion: r.BaseVersion})
	}
	return d
}
