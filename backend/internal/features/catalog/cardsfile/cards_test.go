package cardsfile

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func TestExampleCards(t *testing.T) {
	cards, err := Read(exampleCardsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) == 0 {
		t.Fatal("no cards")
	}

	seen := make(map[string]struct{}, len(cards))
	for i, card := range cards {
		key := strings.ToLower(card.Word) + "\x00" + card.Pos
		if _, ok := seen[key]; ok {
			t.Fatalf("duplicate card %d: %s %s", i+1, card.Word, card.Pos)
		}
		seen[key] = struct{}{}
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

func TestEncodeMatchesRepositoryFile(t *testing.T) {
	raw, err := os.ReadFile(exampleCardsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var cards []catalog_domain.CardData
	if err := json.Unmarshal(raw, &cards); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := Encode(&out, cards); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Bytes(), raw) {
		t.Fatal("Encode must reproduce data/cards.json byte for byte, otherwise `make export` makes noisy diffs")
	}
}
