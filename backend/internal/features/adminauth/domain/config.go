package adminauth_domain

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kelseyhightower/envconfig"
	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	PasswordHash   string        `envconfig:"PASSWORD_HASH"`
	SessionTTL     time.Duration `envconfig:"SESSION_TTL" default:"12h"`
	CookieSecure   bool          `envconfig:"COOKIE_SECURE" default:"true"`
	AllowedOrigins []string      `envconfig:"ALLOWED_ORIGINS"`
	TrustedProxies []string      `envconfig:"TRUSTED_PROXIES"`
}

func NewConfig() (Config, error) {
	restore := ignoreBlankEnv("ADMIN_SESSION_TTL", "ADMIN_COOKIE_SECURE")
	defer restore()

	var config Config
	if err := envconfig.Process("ADMIN", &config); err != nil {
		return Config{}, fmt.Errorf("process envconfig: %w", err)
	}
	if config.SessionTTL <= 0 {
		return Config{}, fmt.Errorf("ADMIN_SESSION_TTL must be positive")
	}
	if config.PasswordHash != "" {
		hash, err := DecodeHash(config.PasswordHash)
		if err != nil {
			return Config{}, fmt.Errorf("ADMIN_PASSWORD_HASH is not a bcrypt hash (generate it with: engmark hash-password)")
		}
		config.PasswordHash = hash
	}
	return config, nil
}

func ignoreBlankEnv(keys ...string) func() {
	type saved struct{ key, value string }
	var blanks []saved
	for _, key := range keys {
		value, ok := os.LookupEnv(key)
		if !ok || strings.TrimSpace(value) != "" {
			continue
		}
		if err := os.Unsetenv(key); err != nil {
			continue
		}
		blanks = append(blanks, saved{key, value})
	}
	return func() {
		for _, item := range blanks {
			_ = os.Setenv(item.key, item.value)
		}
	}
}

func EncodeHash(bcryptHash string) string {
	return base64.StdEncoding.EncodeToString([]byte(bcryptHash))
}

func DecodeHash(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "$2") {
		raw, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return "", fmt.Errorf("neither bcrypt nor base64")
		}
		value = string(raw)
	}
	if _, err := bcrypt.Cost([]byte(value)); err != nil {
		return "", fmt.Errorf("not a bcrypt hash")
	}
	return value, nil
}

func (c Config) Enabled() bool { return c.PasswordHash != "" }

type Session struct {
	ExpiresAt  time.Time
	LastSeenAt time.Time
}
