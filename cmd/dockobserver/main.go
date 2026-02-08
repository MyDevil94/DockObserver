package main

import (
	"log"
	"os"
	"strconv"

	"dockobserver/internal/app"
)

func main() {
	settingsPath := "/config/settings.yml"
	if v := os.Getenv("SETTINGS_PATH"); v != "" {
		settingsPath = v
	}
	settings, err := app.LoadSettings(settingsPath)
	if err != nil {
		log.Fatalf("failed to load settings: %v", err)
	}
	settings.NodeEnv = getenvDefault("NODE_ENV", "production")
	settings.ServerPort = parseInt(getenvDefault("SERVER_PORT", "3001"), 3001)
	settings.WebPort = parseInt(getenvDefault("WEB_PORT", "3000"), 3000)

	server := app.NewServer(settings)
	server.StartAutoUpdater()

	addr := ":" + strconv.Itoa(settings.WebPort)
	log.Printf("starting dockobserver on %s", addr)
	if err := server.Run(addr); err != nil {
		log.Fatalf("server stopped: %v", err)
	}
}

func getenvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseInt(raw string, fallback int) int {
	if v, err := strconv.Atoi(raw); err == nil {
		return v
	}
	return fallback
}
