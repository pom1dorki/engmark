package catalog_admin

import (
	"fmt"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Token string `envconfig:"ADMIN_TOKEN" required:"true"`
}

func NewConfig() (Config, error) {
	var config Config
	if err := envconfig.Process("", &config); err != nil {
		return Config{}, fmt.Errorf("process admin config: %w", err)
	}
	if config.Token == "" {
		return Config{}, fmt.Errorf("ADMIN_TOKEN is empty")
	}
	return config, nil
}

func NewConfigMust() Config {
	config, err := NewConfig()
	if err != nil {
		panic(fmt.Errorf("get admin config: %w", err))
	}
	return config
}
