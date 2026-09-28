package core_logger

import (
	"context"
	"fmt"
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type loggerContextKey struct{}

var key = loggerContextKey{}

type Logger struct {
	*zap.Logger
}

func ToContext(ctx context.Context, log *Logger) context.Context {
	return context.WithValue(ctx, key, log)
}

func FromContext(ctx context.Context) *Logger {
	log, ok := ctx.Value(key).(*Logger)
	if !ok {
		panic("no logger in context")
	}
	return log
}

func NewLogger(config Config) (*Logger, error) {
	level := zap.NewAtomicLevel()
	if err := level.UnmarshalText([]byte(config.Level)); err != nil {
		return nil, fmt.Errorf("unmarshal log level: %w", err)
	}

	encoderConfig := zap.NewDevelopmentEncoderConfig()
	encoderConfig.EncodeTime = zapcore.TimeEncoderOfLayout("2006-01-02T15:04:05.000000")
	encoder := zapcore.NewConsoleEncoder(encoderConfig)

	core := zapcore.NewCore(encoder, zapcore.AddSync(os.Stdout), level)
	zapLogger := zap.New(core, zap.AddCaller())

	return &Logger{Logger: zapLogger}, nil
}

func (l *Logger) With(fields ...zap.Field) *Logger {
	return &Logger{Logger: l.Logger.With(fields...)}
}

func (l *Logger) Close() {
	if l == nil || l.Logger == nil {
		return
	}
	if err := l.Logger.Sync(); err != nil {
		fmt.Println("failed to sync application logger:", err)
	}
}
