package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	"golang.org/x/crypto/bcrypt"
)

const (
	minPasswordLen = 8
	maxPasswordLen = 72
)

func runHashPassword(args []string, stdin *os.File, stdout, stderr io.Writer) int {
	raw := false
	for _, arg := range args {
		if arg != "--raw" {
			fmt.Fprintln(stderr, "usage: engmark hash-password [--raw]")
			return 2
		}
		raw = true
	}

	var password string
	var err error
	if info, statErr := stdin.Stat(); statErr == nil && info.Mode()&os.ModeCharDevice != 0 {
		password, err = readPasswordTerminal(stdin, stderr)
	} else {
		password, err = readPasswordLine(stdin)
	}
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}

	hash, err := hashPassword(password)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if !raw {
		hash = adminauth_domain.EncodeHash(hash)
	}
	fmt.Fprintln(stdout, hash)
	return 0
}

func hashPassword(password string) (string, error) {
	switch {
	case len(password) < minPasswordLen:
		return "", fmt.Errorf("password must be at least %d characters", minPasswordLen)
	case len(password) > maxPasswordLen:
		return "", fmt.Errorf("password must be at most %d bytes (bcrypt limit)", maxPasswordLen)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

func readPasswordLine(in io.Reader) (string, error) {
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("read password: %w", err)
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func readPasswordTerminal(stdin *os.File, stderr io.Writer) (string, error) {
	fmt.Fprint(stderr, "Password: ")
	restore := func() {}
	off := exec.Command("stty", "-echo")
	off.Stdin = stdin
	if err := off.Run(); err == nil {
		restore = func() {
			on := exec.Command("stty", "echo")
			on.Stdin = stdin
			_ = on.Run()
		}
	} else {
		fmt.Fprintln(stderr, "\n(could not turn off echo: the password will be visible)")
	}
	line, err := readPasswordLine(stdin)
	restore()
	fmt.Fprintln(stderr)
	return line, err
}
