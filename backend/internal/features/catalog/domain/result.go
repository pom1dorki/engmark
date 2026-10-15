package catalog_domain

import "time"

type CreatedRef struct {
	TempIndex int   `json:"tempIndex"`
	ID        int64 `json:"id"`
}

type UpdatedRef struct {
	ID      int64 `json:"id"`
	Version int   `json:"version"`
}

type SkippedRow struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

type ImportResult struct {
	FileName string       `json:"fileName"`
	Added    int          `json:"added"`
	Skipped  []SkippedRow `json:"skipped"`
}

type ChangesetResult struct {
	Revision int64          `json:"revision"`
	Created  []CreatedRef   `json:"created"`
	Updated  []UpdatedRef   `json:"updated"`
	Imports  []ImportResult `json:"imports"`
}

type ValidationReport struct {
	Revision int64          `json:"revision"`
	Imports  []ImportResult `json:"imports"`
}

const (
	StateActive     = "active"
	StateArchived   = "archived"
	StateIncomplete = "incomplete"

	SkipDuplicate = "duplicate"
)

type CardFilter struct {
	Query  string
	Pos    string
	State  string
	Limit  int
	Offset int
}

type CardPage struct {
	Revision int64
	Total    int
	Items    []Card
}

type CardVersion struct {
	CardID    int64
	Version   int
	Revision  int64
	Data      CardData
	Archived  bool
	CreatedAt time.Time
}

type CardChange struct {
	Current Card
	Base    *CardVersion
}

type Changes struct {
	Revision int64
	Since    int64
	Items    []CardChange
}

type ImportedFile struct {
	Name    string `json:"name"`
	Added   int    `json:"added"`
	Skipped int    `json:"skipped"`
}

const (
	SourceSeed   = "seed"
	SourceEditor = "editor"
	SourceImport = "import"
	SourceRevert = "revert"

	AuthorAdmin  = "admin"
	AuthorSystem = "system"
)

type Revision struct {
	DeckID        int64
	Revision      int64
	BaseRevision  int64
	Author        string
	Message       string
	Source        string
	CreatedN      int
	UpdatedN      int
	ArchivedN     int
	RestoredN     int
	ImportedFiles []ImportedFile
	CreatedAt     time.Time
}

const (
	ChangeCreated  = "created"
	ChangeUpdated  = "updated"
	ChangeArchived = "archived"
	ChangeRestored = "restored"
)

type RevisionChange struct {
	CardID      int64
	Version     int
	Kind        string
	Word        string
	Translation string
}

type RevisionDetail struct {
	Revision Revision
	Changes  []RevisionChange
}

type DeckState struct {
	Revision int64
	Cards    []StateCard
}

type StateCard struct {
	ID      int64
	Version int
	Data    CardData
}
