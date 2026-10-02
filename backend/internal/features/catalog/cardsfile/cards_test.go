package cardsfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExampleCards(t *testing.T) {
	cards, err := Read(exampleCardsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 5 {
		t.Fatalf("len = %d, want 5", len(cards))
	}

	want := []string{"persist", "resilient", "glance", "thoroughly", "threshold"}
	for i, word := range want {
		if cards[i].Word != word {
			t.Fatalf("card %d word = %q, want %q", i, cards[i].Word, word)
		}
	}
	if cards[2].ExampleHighlight != "glanced" {
		t.Fatalf("glance highlight = %q", cards[2].ExampleHighlight)
	}
}

func TestReadRejectsUnknownField(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cards.json")
	raw := `[{"word":"persist","translation":"упорствовать","pos":"verb","deckId":1}]`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Read(path)
	if err == nil || !strings.Contains(err.Error(), "deckId") {
		t.Fatalf("err = %v", err)
	}
}

func exampleCardsPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		candidate := filepath.Join(dir, "data", "cards.json")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("data/cards.json not found")
		}
		dir = parent
	}
}
