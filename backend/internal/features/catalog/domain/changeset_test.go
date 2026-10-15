package catalog_domain

import (
	"errors"
	"strings"
	"testing"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

func newCard(word string) Card {
	return Card{Word: word, Translation: "перевод " + word, Pos: PosNoun}
}

func errorCodes(errs []ChangesetError) string {
	parts := make([]string, len(errs))
	for i, e := range errs {
		parts[i] = e.Section + "/" + e.Code
		if e.Field != "" {
			parts[i] += "/" + e.Field
		}
	}
	return strings.Join(parts, ",")
}

func TestChangesetValidate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		cs   Changeset
		want string
	}{
		{name: "empty", cs: Changeset{BaseRevision: 1}, want: "changeset/empty_changeset"},
		{name: "empty import file only", cs: Changeset{Imports: []ImportFile{{FileName: "a.json"}}}, want: "changeset/empty_changeset"},
		{name: "valid mix", cs: Changeset{
			Create:  []Card{newCard("alpha")},
			Update:  []CardUpdate{{ID: 1, BaseVersion: 1, Card: newCard("beta")}},
			Archive: []CardRef{{ID: 2, BaseVersion: 1}},
			Restore: []CardRef{{ID: 3, BaseVersion: 2}},
			Imports: []ImportFile{{FileName: "travel.json", Cards: []Card{newCard("gamma")}}},
		}},
		{name: "same id in update and archive", cs: Changeset{
			Update:  []CardUpdate{{ID: 1, BaseVersion: 1, Card: newCard("beta")}},
			Archive: []CardRef{{ID: 1, BaseVersion: 1}},
		}, want: "archive/duplicate_id"},
		{name: "same id twice in archive", cs: Changeset{
			Archive: []CardRef{{ID: 1, BaseVersion: 1}, {ID: 1, BaseVersion: 1}},
		}, want: "archive/duplicate_id"},
		{name: "archive and restore of one card", cs: Changeset{
			Archive: []CardRef{{ID: 1, BaseVersion: 1}},
			Restore: []CardRef{{ID: 1, BaseVersion: 1}},
		}, want: "restore/duplicate_id"},
		{name: "update plus restore with same base is allowed", cs: Changeset{
			Update:  []CardUpdate{{ID: 1, BaseVersion: 3, Card: newCard("beta")}},
			Restore: []CardRef{{ID: 1, BaseVersion: 3}},
		}},
		{name: "update plus restore with different base", cs: Changeset{
			Update:  []CardUpdate{{ID: 1, BaseVersion: 3, Card: newCard("beta")}},
			Restore: []CardRef{{ID: 1, BaseVersion: 2}},
		}, want: "restore/duplicate_id"},
		{name: "bad ids", cs: Changeset{Archive: []CardRef{{ID: 0, BaseVersion: 1}, {ID: 5, BaseVersion: 0}}}, want: "archive/invalid_id,archive/invalid_id"},
		{name: "cyrillic word in create", cs: Changeset{Create: []Card{{Word: "слово", Translation: "x", Pos: PosNoun}}}, want: "create/invalid_chars/word"},
		{name: "unknown pos in update", cs: Changeset{Update: []CardUpdate{{ID: 1, BaseVersion: 1, Card: Card{Word: "a", Translation: "b", Pos: "thing"}}}}, want: "update/unsupported_pos/pos"},
		{name: "highlight outside example", cs: Changeset{Create: []Card{{Word: "a", Translation: "b", Pos: PosNoun, Example: "A cat.", ExampleHighlight: "dog"}}}, want: "create/highlight_not_found/exampleHighlight"},
		{name: "duplicates inside create", cs: Changeset{Create: []Card{{Word: "alpha", Translation: "x", Pos: PosNoun}, {Word: "ALPHA", Translation: "x", Pos: PosNoun}}}, want: "create/duplicate_card/word"},
		{name: "import without name", cs: Changeset{Imports: []ImportFile{{Cards: []Card{newCard("a")}}}}, want: "imports/invalid_file_name"},
		{name: "import name too long", cs: Changeset{Imports: []ImportFile{{FileName: strings.Repeat("x", MaxFileNameLen+1), Cards: []Card{newCard("a")}}}}, want: "imports/invalid_file_name"},
		{name: "import row error carries file and row", cs: Changeset{Imports: []ImportFile{{FileName: "a.json", Cards: []Card{newCard("a"), {Word: "", Translation: "x", Pos: PosNoun}}}}}, want: "imports/required/word"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := errorCodes(tt.cs.Validate())
			if got != tt.want {
				t.Fatalf("Validate() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestChangesetValidateLimits(t *testing.T) {
	t.Parallel()

	many := make([]Card, MaxCreateAndUpdate+1)
	for i := range many {
		many[i] = newCard("w")
	}
	if got := errorCodes((&Changeset{Create: many}).Validate()); !strings.HasPrefix(got, "changeset/too_many_items") {
		t.Fatalf("create limit: %q", got)
	}

	rows := make([]Card, MaxImportRows/2+1)
	for i := range rows {
		rows[i] = newCard("w")
	}
	cs := Changeset{Imports: []ImportFile{{FileName: "a", Cards: rows}, {FileName: "b", Cards: rows}}}
	if got := errorCodes(cs.Validate()); !strings.HasPrefix(got, "changeset/too_many_items") {
		t.Fatalf("import limit: %q", got)
	}
}

func TestChangesetErrorIndexes(t *testing.T) {
	t.Parallel()
	cs := Changeset{Imports: []ImportFile{{FileName: "a.json", Cards: []Card{newCard("a"), {Word: "", Translation: "x", Pos: PosNoun}}}}}
	errs := cs.Validate()
	if len(errs) != 1 || errs[0].Index != 1 || errs[0].File != "a.json" {
		t.Fatalf("errs = %+v", errs)
	}
}

func TestTypedErrors(t *testing.T) {
	t.Parallel()

	var err error = &RevisionMismatchError{Base: 42, Current: 43}
	var rev *RevisionMismatchError
	if !errors.Is(err, core_errors.ErrPreconditionFailed) || !errors.As(err, &rev) || rev.Current != 43 {
		t.Fatalf("revision mismatch: %v", err)
	}

	err = &VersionMismatchError{ID: 7, Expected: 2, Actual: 3}
	var ver *VersionMismatchError
	if !errors.Is(err, core_errors.ErrConflict) || !errors.As(err, &ver) || ver.Actual != 3 {
		t.Fatalf("version mismatch: %v", err)
	}

	err = &DuplicateCardError{Section: SectionCreate, Index: 4}
	var dup *DuplicateCardError
	if !errors.Is(err, core_errors.ErrConflict) || !errors.As(err, &dup) || dup.Index != 4 {
		t.Fatalf("duplicate: %v", err)
	}

	vErr := &ValidationError{Errors: []ChangesetError{{Section: SectionChangeset, Code: CodeEmptyChangeset, Message: "changeset is empty"}}}
	var val *ValidationError
	if !errors.Is(vErr, core_errors.ErrInvalidArgument) || !errors.As(error(vErr), &val) || vErr.ErrorCode() != CodeEmptyChangeset {
		t.Fatalf("validation: %v", vErr)
	}
	mixed := &ValidationError{Errors: []ChangesetError{{Code: CodeNoChanges}, {Code: "required"}}}
	if mixed.ErrorCode() != "" {
		t.Fatalf("mixed errors must stay invalid_argument, got %q", mixed.ErrorCode())
	}
	noChanges := &ValidationError{Errors: []ChangesetError{{Code: CodeNoChanges, ID: 1}, {Code: CodeNoChanges, ID: 2}}}
	if noChanges.ErrorCode() != CodeNoChanges {
		t.Fatalf("no_changes code = %q", noChanges.ErrorCode())
	}
}
