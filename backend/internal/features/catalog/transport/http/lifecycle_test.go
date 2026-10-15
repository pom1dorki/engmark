package catalog_transport_http

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
)

func getWithETag(t *testing.T, etag string) (*http.Response, cardList) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/cards?limit=1000", nil)
	if err != nil {
		t.Fatal(err)
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	var list cardList
	if resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(raw, &list); err != nil {
			t.Fatalf("decode: %v\n%s", err, raw)
		}
	}
	return resp, list
}

func TestArchiveReachesPublicCatalog(t *testing.T) {
	ctx := context.Background()
	repo := catalog_postgres_repository.New(pool)
	reload := func() {
		if err := store.Reload(ctx, repo, MarshalCardList); err != nil {
			t.Fatalf("reload: %v", err)
		}
	}
	reset := func() {
		for _, q := range []string{
			`DELETE FROM card_versions`, `DELETE FROM cards`, `DELETE FROM deck_revisions`,
			`UPDATE decks SET revision = 0`,
		} {
			if _, err := pool.Exec(ctx, q); err != nil {
				t.Fatal(err)
			}
		}
		reload()
	}
	reset()
	t.Cleanup(reset)

	svc := catalog_service.New(repo).WithHooks(catalog_service.Hooks{
		OnCommitted:      func(ctx context.Context, _ int64) { reload() },
		SnapshotRevision: store.Revision,
	})
	card := func(word, tr string) catalog_domain.Card {
		return catalog_domain.Card{Word: word, Translation: tr, Pos: catalog_domain.PosNoun}
	}

	first, err := svc.ApplyChangeset(ctx, catalog_domain.Changeset{
		BaseRevision: 0,
		Create:       []catalog_domain.Card{card("alpha", "альфа"), card("beta", "бета")},
	})
	if err != nil {
		t.Fatal(err)
	}
	resp1, list1 := getWithETag(t, "")
	etag1 := resp1.Header.Get("ETag")
	if list1.Total != 2 || etag1 == "" || resp1.Header.Get("X-Deck-Revision") != "1" {
		t.Fatalf("after r1: total=%d etag=%q rev=%q", list1.Total, etag1, resp1.Header.Get("X-Deck-Revision"))
	}

	second, err := svc.ApplyChangeset(ctx, catalog_domain.Changeset{
		BaseRevision: first.Revision,
		Archive:      []catalog_domain.CardRef{{ID: first.Created[0].ID, BaseVersion: 1}},
		Create:       []catalog_domain.Card{card("gamma", "гамма")},
	})
	if err != nil {
		t.Fatal(err)
	}
	resp2, list2 := getWithETag(t, etag1)
	etag2 := resp2.Header.Get("ETag")
	if resp2.StatusCode != http.StatusOK || etag2 == etag1 || resp2.Header.Get("X-Deck-Revision") != "2" {
		t.Fatalf("old ETag after r2: status=%d etag=%q rev=%q", resp2.StatusCode, etag2, resp2.Header.Get("X-Deck-Revision"))
	}
	ids := map[int64]bool{}
	for _, it := range list2.Items {
		ids[it.ID] = true
	}
	if list2.Total != 2 || ids[first.Created[0].ID] || !ids[first.Created[1].ID] || !ids[second.Created[0].ID] {
		t.Fatalf("after r2: %+v", list2)
	}

	if resp3, _ := getWithETag(t, etag2); resp3.StatusCode != http.StatusNotModified {
		t.Fatalf("current ETag status = %d, want 304", resp3.StatusCode)
	}
}
