package catalog_domain

import (
	"errors"
	"testing"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

func persistCard() Card {
	return Card{
		ID:               1,
		Version:          1,
		Word:             "persist",
		Translation:      "упорствовать, продолжать (несмотря на трудности)",
		Pos:              PosVerb,
		Example:          "If you persist with daily practice, the words will stick.",
		ExampleHighlight: "persist",
	}
}

func TestPosLabel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		pos  string
		want string
	}{
		{pos: PosVerb, want: "глагол"},
		{pos: PosNoun, want: "существительное"},
		{pos: PosAdj, want: "прилагательное"},
		{pos: PosAdv, want: "наречие"},
		{pos: "adjective", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.pos, func(t *testing.T) {
			t.Parallel()
			if got := PosLabel(tt.pos); got != tt.want {
				t.Fatalf("PosLabel(%q) = %q, want %q", tt.pos, got, tt.want)
			}
		})
	}
}

func TestCardValidate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		card    Card
		wantErr error
	}{
		{name: "valid card", card: persistCard()},
		{name: "empty word", card: func() Card { c := persistCard(); c.Word = ""; return c }(), wantErr: core_errors.ErrInvalidArgument},
		{name: "whitespace word", card: func() Card { c := persistCard(); c.Word = "   "; return c }(), wantErr: core_errors.ErrInvalidArgument},
		{name: "pos adjective", card: func() Card { c := persistCard(); c.Pos = "adjective"; return c }(), wantErr: core_errors.ErrInvalidArgument},
		{name: "highlight missing", card: func() Card { c := persistCard(); c.ExampleHighlight = "missing"; return c }(), wantErr: core_errors.ErrInvalidArgument},
		{name: "highlight case", card: func() Card { c := persistCard(); c.ExampleHighlight = "PERSIST"; return c }()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := tt.card.Validate()
			if tt.wantErr == nil {
				if err != nil {
					t.Fatalf("Validate() = %v", err)
				}
				return
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Validate() = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestApply(t *testing.T) {
	t.Parallel()

	t.Run("version mismatch", func(t *testing.T) {
		t.Parallel()
		_, err := Apply(persistCard(), CardPatch{Version: 0})
		if !errors.Is(err, core_errors.ErrConflict) {
			t.Fatalf("Apply() = %v, want ErrConflict", err)
		}
	})

	t.Run("empty word", func(t *testing.T) {
		t.Parallel()
		empty := ""
		_, err := Apply(persistCard(), CardPatch{
			Version: 1,
			Word:    Nullable[string]{Value: &empty, Set: true},
		})
		if !errors.Is(err, core_errors.ErrInvalidArgument) {
			t.Fatalf("Apply() = %v, want ErrInvalidArgument", err)
		}
	})
}
