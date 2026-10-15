package catalog_domain

import (
	"fmt"
	"unicode/utf8"
)

const (
	MaxCreateAndUpdate = 1000
	MaxImportRows      = 5000
	MaxFileNameLen     = 200
)

const (
	SectionChangeset = "changeset"
	SectionCreate    = "create"
	SectionUpdate    = "update"
	SectionArchive   = "archive"
	SectionRestore   = "restore"
	SectionImports   = "imports"

	CodeEmptyChangeset = "empty_changeset"
	CodeNoChanges      = "no_changes"
	CodeTooManyItems   = "too_many_items"
	CodeInvalidID      = "invalid_id"
	CodeDuplicateID    = "duplicate_id"
	CodeDuplicateCard  = "duplicate_card"
	CodeInvalidFile    = "invalid_file_name"
	CodeInvalidState   = "invalid_state"
)

type Changeset struct {
	BaseRevision int64
	Message      string
	Create       []Card
	Update       []CardUpdate
	Archive      []CardRef
	Restore      []CardRef
	Imports      []ImportFile
}

type CardUpdate struct {
	ID          int64
	BaseVersion int
	Card        Card
}

type CardRef struct {
	ID          int64
	BaseVersion int
}

type ImportFile struct {
	FileName string
	Cards    []Card
}

type ChangesetError struct {
	Section string `json:"section"`
	Index   int    `json:"index"`
	ID      int64  `json:"id,omitempty"`
	File    string `json:"file,omitempty"`
	Field   string `json:"field,omitempty"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (cs *Changeset) ImportRows() int {
	n := 0
	for _, f := range cs.Imports {
		n += len(f.Cards)
	}
	return n
}

func (cs *Changeset) Empty() bool {
	return len(cs.Create)+len(cs.Update)+len(cs.Archive)+len(cs.Restore)+cs.ImportRows() == 0
}

func (cs *Changeset) Validate() []ChangesetError {
	if cs.Empty() {
		return []ChangesetError{{Section: SectionChangeset, Code: CodeEmptyChangeset, Message: "changeset is empty"}}
	}

	var errs []ChangesetError
	add := func(e ChangesetError) { errs = append(errs, e) }

	if len(cs.Create)+len(cs.Update) > MaxCreateAndUpdate {
		add(ChangesetError{Section: SectionChangeset, Code: CodeTooManyItems,
			Message: fmt.Sprintf("create and update together are limited to %d", MaxCreateAndUpdate)})
	}
	if cs.ImportRows() > MaxImportRows {
		add(ChangesetError{Section: SectionChangeset, Code: CodeTooManyItems,
			Message: fmt.Sprintf("imports are limited to %d rows in total", MaxImportRows)})
	}

	type used struct {
		update, archive, restore bool
		updateVersion            int
	}
	seen := make(map[int64]*used)
	check := func(section string, index int, id int64, baseVersion int) *used {
		if id <= 0 || baseVersion < 1 {
			add(ChangesetError{Section: section, Index: index, ID: id, Code: CodeInvalidID, Message: "id and baseVersion must be positive"})
			return nil
		}
		u := seen[id]
		if u == nil {
			u = &used{}
			seen[id] = u
		}
		return u
	}
	dup := func(section string, index int, id int64) {
		add(ChangesetError{Section: section, Index: index, ID: id, Code: CodeDuplicateID,
			Message: fmt.Sprintf("card %d is already used in this changeset", id)})
	}

	for i, up := range cs.Update {
		u := check(SectionUpdate, i, up.ID, up.BaseVersion)
		if u == nil {
			continue
		}
		if u.update {
			dup(SectionUpdate, i, up.ID)
			continue
		}
		u.update, u.updateVersion = true, up.BaseVersion
	}
	for i, ref := range cs.Archive {
		u := check(SectionArchive, i, ref.ID, ref.BaseVersion)
		if u == nil {
			continue
		}
		if u.update || u.archive || u.restore {
			dup(SectionArchive, i, ref.ID)
			continue
		}
		u.archive = true
	}
	for i, ref := range cs.Restore {
		u := check(SectionRestore, i, ref.ID, ref.BaseVersion)
		if u == nil {
			continue
		}
		if u.archive || u.restore || (u.update && u.updateVersion != ref.BaseVersion) {
			dup(SectionRestore, i, ref.ID)
			continue
		}
		u.restore = true
	}

	for i, card := range cs.Create {
		for _, fe := range card.ValidateFields() {
			add(ChangesetError{Section: SectionCreate, Index: i, Field: fe.Field, Code: fe.Code, Message: fe.Message})
		}
	}
	for i, up := range cs.Update {
		for _, fe := range up.Card.ValidateFields() {
			add(ChangesetError{Section: SectionUpdate, Index: i, ID: up.ID, Field: fe.Field, Code: fe.Code, Message: fe.Message})
		}
	}

	keys := make(map[Key]int, len(cs.Create))
	for i, card := range cs.Create {
		key := CardKey(card)
		if first, ok := keys[key]; ok {
			add(ChangesetError{Section: SectionCreate, Index: i, Field: "word", Code: CodeDuplicateCard,
				Message: fmt.Sprintf("duplicates create[%d]", first)})
			continue
		}
		keys[key] = i
	}

	for _, file := range cs.Imports {
		if file.FileName == "" || utf8.RuneCountInString(file.FileName) > MaxFileNameLen {
			add(ChangesetError{Section: SectionImports, File: file.FileName, Code: CodeInvalidFile,
				Message: fmt.Sprintf("fileName must be 1 to %d characters", MaxFileNameLen)})
		}
		for i, card := range file.Cards {
			for _, fe := range card.ValidateFields() {
				add(ChangesetError{Section: SectionImports, Index: i, File: file.FileName, Field: fe.Field, Code: fe.Code, Message: fe.Message})
			}
		}
	}
	return errs
}
