package health_service

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type Service struct {
	db       Pinger
	catalog  func() bool
	draining atomic.Bool
}

func NewService(db Pinger) *Service {
	return &Service{db: db}
}

func (s *Service) SetCatalogReady(ready func() bool) {
	s.catalog = ready
}

func (s *Service) Drain() {
	s.draining.Store(true)
}

func (s *Service) Ready(ctx context.Context) error {
	if s.draining.Load() {
		return fmt.Errorf("draining: %w", core_errors.ErrNotReady)
	}
	if s.catalog != nil && !s.catalog() {
		return fmt.Errorf("catalog: %w", core_errors.ErrNotReady)
	}

	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := s.db.Ping(ctx); err != nil {
		return fmt.Errorf("ping postgres: %w", core_errors.ErrNotReady)
	}
	return nil
}
