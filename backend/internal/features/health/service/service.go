package health_service

import (
	"context"
	"fmt"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type Service struct {
	db Pinger
}

func NewService(db Pinger) *Service {
	return &Service{db: db}
}

func (s *Service) Ready(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := s.db.Ping(ctx); err != nil {
		return fmt.Errorf("ping postgres: %w", core_errors.ErrNotReady)
	}
	return nil
}
