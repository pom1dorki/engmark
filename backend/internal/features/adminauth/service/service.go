package adminauth_service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const (
	tokenBytes      = 32
	touchInterval   = time.Minute
	perIPAttempts   = 5
	globalAttempts  = 30
	attemptWindow   = time.Minute
	minLoginLatency = 300 * time.Millisecond
)

type Repository interface {
	Create(ctx context.Context, tokenHash []byte, expiresAt time.Time, userAgent string) error
	Get(ctx context.Context, tokenHash []byte) (adminauth_domain.Session, error)
	Touch(ctx context.Context, tokenHash []byte, expiresAt time.Time) error
	Delete(ctx context.Context, tokenHash []byte) error
	DeleteExpired(ctx context.Context) (int64, error)
}

type Service struct {
	repo        Repository
	hash        []byte
	ttl         time.Duration
	now         func() time.Time
	sleep       func(time.Duration)
	minLatency  time.Duration
	perIP       *limiter
	globalLimit *limiter
}

type Option func(*Service)

func WithMinLoginLatency(d time.Duration) Option {
	return func(s *Service) { s.minLatency = d }
}

func WithLoginLimits(perIP, global int) Option {
	return func(s *Service) {
		if perIP > 0 {
			s.perIP = newLimiter(perIP, attemptWindow)
		}
		if global > 0 {
			s.globalLimit = newLimiter(global, attemptWindow)
		}
	}
}

func New(repo Repository, cfg adminauth_domain.Config, opts ...Option) *Service {
	s := &Service{
		repo:        repo,
		hash:        []byte(cfg.PasswordHash),
		ttl:         cfg.SessionTTL,
		now:         time.Now,
		sleep:       time.Sleep,
		minLatency:  minLoginLatency,
		perIP:       newLimiter(perIPAttempts, attemptWindow),
		globalLimit: newLimiter(globalAttempts, attemptWindow),
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func (s *Service) Login(ctx context.Context, ip, userAgent, password string) (string, time.Time, error) {
	started := s.now()
	if !s.globalLimit.allow("", started) || !s.perIP.allow(ip, started) {
		return "", time.Time{}, fmt.Errorf("login: %w", core_errors.ErrTooManyRequests)
	}
	defer func() {
		if left := s.minLatency - s.now().Sub(started); left > 0 {
			s.sleep(left)
		}
	}()

	if len(password) == 0 || len(password) > 256 ||
		bcrypt.CompareHashAndPassword(s.hash, []byte(password)) != nil {
		return "", time.Time{}, fmt.Errorf("login: %w", core_errors.ErrUnauthenticated)
	}

	raw := make([]byte, tokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", time.Time{}, fmt.Errorf("generate session token: %w", err)
	}
	expires := s.now().Add(s.ttl)
	if err := s.repo.Create(ctx, hashToken(raw), expires, userAgent); err != nil {
		return "", time.Time{}, err
	}
	return base64.RawURLEncoding.EncodeToString(raw), expires, nil
}

type Authenticated struct {
	ExpiresAt time.Time
	Renewed   bool
}

func (s *Service) Authenticate(ctx context.Context, token string) (Authenticated, error) {
	hash, err := decodeToken(token)
	if err != nil {
		return Authenticated{}, err
	}
	session, err := s.repo.Get(ctx, hash)
	if err != nil {
		return Authenticated{}, err
	}
	now := s.now()
	if now.Sub(session.LastSeenAt) < touchInterval {
		return Authenticated{ExpiresAt: session.ExpiresAt}, nil
	}
	expires := now.Add(s.ttl)
	if err := s.repo.Touch(ctx, hash, expires); err != nil {
		return Authenticated{ExpiresAt: session.ExpiresAt}, nil
	}
	return Authenticated{ExpiresAt: expires, Renewed: true}, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	hash, err := decodeToken(token)
	if err != nil {
		return nil
	}
	return s.repo.Delete(ctx, hash)
}

func (s *Service) TTL() time.Duration { return s.ttl }

func (s *Service) RunCleanup(ctx context.Context, interval time.Duration, log *core_logger.Logger) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := s.repo.DeleteExpired(ctx)
			switch {
			case err != nil && !errors.Is(err, context.Canceled):
				log.Warn("delete expired admin sessions", zap.Error(err))
			case n > 0:
				log.Debug("deleted expired admin sessions", zap.Int64("count", n))
			}
		}
	}
}

func hashToken(raw []byte) []byte {
	sum := sha256.Sum256(raw)
	return sum[:]
}

func decodeToken(token string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != tokenBytes {
		return nil, fmt.Errorf("admin session: %w", core_errors.ErrUnauthenticated)
	}
	return hashToken(raw), nil
}
