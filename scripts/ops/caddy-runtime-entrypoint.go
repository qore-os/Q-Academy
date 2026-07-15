package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

const (
	runtimeUID    = 10001
	runtimeGID    = 10001
	sentinelName  = ".q-academy-caddy-volume-v1"
	sentinelValue = "q-academy-caddy-volume-v1\n"
)

func fail(message string) {
	fmt.Fprintf(os.Stderr, "Caddy runtime preflight failed: %s\n", message)
	os.Exit(1)
}

func runtimeOwnership(info os.FileInfo) (uint32, uint32, bool) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, false
	}
	return stat.Uid, stat.Gid, true
}

func verifySentinel(directory string) error {
	sentinelPath := filepath.Join(directory, sentinelName)
	sentinelInfo, err := os.Lstat(sentinelPath)
	if err != nil || sentinelInfo.Mode()&os.ModeSymlink != 0 || !sentinelInfo.Mode().IsRegular() {
		return fmt.Errorf("required storage sentinel is missing or unsafe")
	}
	sentinelUID, sentinelGID, ok := runtimeOwnership(sentinelInfo)
	if !ok || sentinelUID != runtimeUID || sentinelGID != runtimeGID || sentinelInfo.Mode().Perm() != 0o444 {
		return fmt.Errorf("required storage sentinel metadata is unsafe")
	}
	sentinel, err := os.ReadFile(sentinelPath)
	if err != nil || string(sentinel) != sentinelValue {
		return fmt.Errorf("required storage sentinel content is invalid")
	}
	return nil
}

func initializeRuntimeDirectory(directory string) error {
	info, err := os.Lstat(directory)
	if err != nil {
		return fmt.Errorf("required storage directory is unavailable")
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("required storage path is not a physical directory")
	}
	uid, gid, ok := runtimeOwnership(info)
	if !ok {
		return fmt.Errorf("required storage ownership is unavailable")
	}
	if uid == runtimeUID && gid == runtimeGID && info.Mode().Perm() == 0o700 {
		return verifySentinel(directory)
	}
	if uid != 0 || gid != 0 || (info.Mode().Perm() != 0o755 && info.Mode().Perm() != 0o700) {
		return fmt.Errorf("uninitialized storage directory has unexpected metadata")
	}

	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 1 || entries[0].Name() != sentinelName {
		return fmt.Errorf("uninitialized storage directory contains unexpected data")
	}
	if err := verifySentinel(directory); err != nil {
		return err
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("storage directory permissions could not be initialized")
	}
	directoryHandle, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("initialized storage directory could not be opened")
	}
	defer directoryHandle.Close()
	if err := os.Chown(directory, runtimeUID, runtimeGID); err != nil {
		return fmt.Errorf("storage directory ownership could not be initialized")
	}
	if err := directoryHandle.Sync(); err != nil {
		return fmt.Errorf("initialized storage directory could not be synchronized")
	}
	return nil
}

func verifyRuntimeDirectory(directory string) error {
	info, err := os.Lstat(directory)
	if err != nil {
		return fmt.Errorf("required storage directory is unavailable")
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("required storage path is not a physical directory")
	}
	uid, gid, ok := runtimeOwnership(info)
	if !ok || uid != runtimeUID || gid != runtimeGID {
		return fmt.Errorf("required storage directory has unsafe ownership")
	}
	if info.Mode().Perm() != 0o700 {
		return fmt.Errorf("required storage directory has unsafe permissions")
	}

	if err := verifySentinel(directory); err != nil {
		return err
	}

	probePath := filepath.Join(directory, fmt.Sprintf(".q-academy-write-probe-%d", os.Getpid()))
	probe, err := os.OpenFile(probePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("required storage directory is not writable")
	}
	probeCreated := true
	defer func() {
		if probeCreated {
			_ = os.Remove(probePath)
		}
	}()
	if err := probe.Sync(); err != nil {
		_ = probe.Close()
		return fmt.Errorf("required storage write probe could not be synchronized")
	}
	if err := probe.Close(); err != nil {
		return fmt.Errorf("required storage write probe could not be closed")
	}
	if err := os.Remove(probePath); err != nil {
		return fmt.Errorf("required storage write probe could not be removed")
	}
	probeCreated = false
	return nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "initialize-volumes" {
		if os.Getuid() != 0 || os.Getgid() != 0 {
			fail("volume initialization requires the isolated root initializer")
		}
		for _, directory := range []string{"/data", "/config"} {
			if err := initializeRuntimeDirectory(directory); err != nil {
				fail(err.Error())
			}
		}
		return
	}

	if os.Getuid() != runtimeUID || os.Getgid() != runtimeGID {
		fail("the process does not use the dedicated runtime identity")
	}
	for _, directory := range []string{"/data", "/config"} {
		if err := verifyRuntimeDirectory(directory); err != nil {
			fail(err.Error())
		}
	}

	if len(os.Args) != 6 ||
		os.Args[1] != "run" ||
		os.Args[2] != "--config" ||
		os.Args[3] != "/etc/caddy/Caddyfile" ||
		os.Args[4] != "--adapter" ||
		os.Args[5] != "caddyfile" {
		fail("the Caddy runtime command is not permitted")
	}
	arguments := []string{
		"/usr/bin/caddy",
		"run",
		"--config",
		"/etc/caddy/Caddyfile",
		"--adapter",
		"caddyfile",
	}
	if err := syscall.Exec("/usr/bin/caddy", arguments, os.Environ()); err != nil {
		fail("the Caddy process could not be started")
	}
}
