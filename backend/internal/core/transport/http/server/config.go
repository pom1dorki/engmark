package core_http_server

import (
	"fmt"
	"time"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Addr            string        `envconfig:"ADDR" required:"true"`
	ShutDownTimeout time.Duration `envconfig:"SHUTDOWN_TIMEOUT" default:"30s"`
	AllowedOrigins  []string      `envconfig:"ALLOWED_ORIGINS" required:"true"`
}

func NewConfig() (Config, error) {
	var config Config
	if err := envconfig.Process("HTTP", &config); err != nil {
		return Config{}, fmt.Errorf("process envconfig: %w", err)
	}
	return config, nil
}

func NewConfigMust() Config {
	config, err := NewConfig()
	if err != nil {
		panic(fmt.Errorf("get HTTP server config: %w", err))
	}
	return config
}
