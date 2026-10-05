package catalog_transport_http

import (
	"context"
	"net/http"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_snapshot "github.com/pom1dorki/engmark/internal/features/catalog/snapshot"
)

type CatalogReader interface {
	ListCards(ctx context.Context, limit, offset *int) (catalog_snapshot.Page, error)
	ListCardsByDeck(ctx context.Context, deckID int64, limit, offset *int) (catalog_snapshot.Page, error)
	GetCard(ctx context.Context, id int64) (catalog_domain.Card, error)
	ListDecks(ctx context.Context) ([]catalog_domain.Deck, error)
}

type Handler struct {
	catalog CatalogReader
}

func New(catalog CatalogReader) *Handler {
	return &Handler{catalog: catalog}
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request) *core_http_response.HTTPResponseHandler {
	log := core_logger.FromContext(r.Context())
	return core_http_response.NewHTTPResponseHandler(log, w, r.Header.Get("X-Request-ID"))
}
