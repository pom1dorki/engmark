package core_logger

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type loggerContextKey struct{}

var key = loggerContextKey{}

type Logger struct {
	*zap.Logger
}

var (
	nopLogger    = &Logger{Logger: zap.NewNop()}
	fallbackOnce sync.Once
)

func ToContext(ctx context.Context, log *Logger) context.Context {
	return context.WithValue(ctx, key, log)
}

func FromContext(ctx context.Context) *Logger {
	if ctx != nil {
		log, ok := ctx.Value(key).(*Logger)
		if ok && log != nil {
			return log
		}
	}
	fallbackOnce.Do(func() {
		fmt.Fprintln(os.Stderr, "logger missing from context; using a nop logger")
	})
	return nopLogger
}

func NewLogger(config Config) (*Logger, error) {
	level := zap.NewAtomicLevel()
	if err := level.UnmarshalText([]byte(strings.ToLower(config.Level))); err != nil {
		return nil, fmt.Errorf("unmarshal log level: %w", err)
	}

	format := strings.ToLower(strings.TrimSpace(config.Format))
	if format == "" {
		format = "console"
	}
	if format != "console" && format != "json" {
		return nil, fmt.Errorf("logger format %q must be console or json", config.Format)
	}

	encoderConfig := newEncoderConfig()
	newEncoder := func() zapcore.Encoder {
		if format == "json" {
			return zapcore.NewJSONEncoder(encoderConfig)
		}
		return zapcore.NewConsoleEncoder(encoderConfig)
	}
	sink := zapcore.AddSync(os.Stdout)
	var core zapcore.Core
	if format == "json" {
		low := zap.LevelEnablerFunc(func(lvl zapcore.Level) bool {
			return lvl < zapcore.WarnLevel && level.Enabled(lvl)
		})
		high := zap.LevelEnablerFunc(func(lvl zapcore.Level) bool {
			return lvl >= zapcore.WarnLevel && level.Enabled(lvl)
		})
		sampled := zapcore.NewSamplerWithOptions(
			zapcore.NewCore(newEncoder(), sink, low),
			time.Second,
			100,
			100,
		)
		core = zapcore.NewTee(sampled, zapcore.NewCore(newEncoder(), sink, high))
	} else {
		core = zapcore.NewCore(newEncoder(), sink, level)
	}
	return &Logger{Logger: zap.New(core, zap.AddCaller())}, nil
}

func newEncoderConfig() zapcore.EncoderConfig {
	cfg := zap.NewProductionEncoderConfig()
	cfg.EncodeLevel = zapcore.LowercaseLevelEncoder
	cfg.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
		enc.AppendString(t.UTC().Format("2006-01-02T15:04:05.000Z07:00"))
	}
	return cfg
}

func (l *Logger) With(fields ...zap.Field) *Logger {
	return &Logger{Logger: l.Logger.With(fields...)}
}

func (l *Logger) Close() {
	if l == nil || l.Logger == nil {
		return
	}
	if err := l.Logger.Sync(); err != nil && !ignorableSyncErr(err) {
		fmt.Println("failed to sync application logger:", err)
	}
}

func ignorableSyncErr(err error) bool {
	if errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTTY) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "invalid argument") || strings.Contains(msg, "inappropriate ioctl")
}
