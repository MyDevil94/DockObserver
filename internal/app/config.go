package app

import (
	"errors"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

type DiscoveryStrategy string

const (
	DiscoveryOptIn  DiscoveryStrategy = "opt-in"
	DiscoveryOptOut DiscoveryStrategy = "opt-out"
)

type AutoUpdaterSettings struct {
	Enabled       bool   `yaml:"enabled" json:"enabled"`
	IntervalRaw   string `yaml:"interval" json:"-"`
	MaxConcurrent int    `yaml:"max_concurrent" json:"maxConcurrent"`

	IntervalSeconds int `yaml:"-" json:"interval"`
}

type ServerSettings struct {
	CacheControlMaxAgeRaw   string            `yaml:"cache_control_max_age" json:"-"`
	DiscoveryStrategy       DiscoveryStrategy `yaml:"discovery_strategy" json:"discoveryStrategy"`
	DryRun                  bool              `yaml:"dryrun" json:"dryrun"`
	DryRunUpdateCount       int               `yaml:"dryrun_update_count" json:"dryrunUpdateCount"`
	MessageHistorySize      int               `yaml:"message_history_size" json:"messageHistorySize"`
	EnabledLabelFieldName   string            `yaml:"enabled_label_field_name" json:"ignoreLabelFieldName"`
	IgnoreStackNameKeywords []string          `yaml:"ignore_compose_stack_name_keywords" json:"ignoreComposeStackNameKeywords"`
	PossibleHomepageLabels  []string          `yaml:"possible_homepage_labels" json:"possibleHomepageLabels"`
	PossibleImageLabels     []string          `yaml:"possible_image_version_labels" json:"possibleImageVersionLabels"`
	IgnoredImagePrefixes    []string          `yaml:"python_on_whales__ignored_image_prefixes" json:"pythonOnWhalesIgnoredImagePrefixes"`
	TimeUntilMatureRaw      string            `yaml:"time_until_update_is_mature" json:"-"`
	StacksPaths             []string          `yaml:"stacks_paths" json:"stacksPaths"`

	CacheControlMaxAgeSeconds int `yaml:"-" json:"cacheControlMaxAge"`
	TimeUntilMatureSeconds    int `yaml:"-" json:"timeUntilUpdateIsMature"`
}

type Settings struct {
	AutoUpdater AutoUpdaterSettings `yaml:"auto_updater" json:"autoUpdater"`
	Server      ServerSettings      `yaml:"server" json:"server"`

	NodeEnv   string `yaml:"-" json:"nodeEnv"`
	ServerPort int   `yaml:"-" json:"serverPort"`
	WebPort   int   `yaml:"-" json:"webPort"`
}

func defaultSettings() Settings {
	return Settings{
		AutoUpdater: AutoUpdaterSettings{
			Enabled:       false,
			IntervalRaw:   "1d",
			MaxConcurrent: 4,
		},
		Server: ServerSettings{
			CacheControlMaxAgeRaw:   "1d",
			DiscoveryStrategy:       DiscoveryOptOut,
			DryRun:                  false,
			DryRunUpdateCount:       3,
			MessageHistorySize:      8,
			EnabledLabelFieldName:   "com.dockobserver.enabled",
			IgnoreStackNameKeywords: []string{"devcontainer"},
			PossibleHomepageLabels:  []string{"org.label-schema.url", "org.opencontainers.image.url", "org.opencontainers.image.source"},
			PossibleImageLabels:     []string{"org.label-schema.version", "org.opencontainers.image.version"},
			IgnoredImagePrefixes:    []string{"docker.io/", "docker.io/library/"},
			TimeUntilMatureRaw:      "1w",
			StacksPaths:             nil,
		},
		NodeEnv:   "production",
		ServerPort: 3001,
		WebPort:   3000,
	}
}

func LoadSettings(path string) (Settings, error) {
	settings := defaultSettings()
	if path == "" {
		return settings, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return settings, nil
		}
		return settings, err
	}
	if err := yaml.Unmarshal(data, &settings); err != nil {
		return settings, err
	}

	applySettingsDefaults(&settings)
	return settings, nil
}

func applySettingsDefaults(s *Settings) {
	if s.Server.EnabledLabelFieldName == "" {
		s.Server.EnabledLabelFieldName = "com.dockobserver.enabled"
	}
	if s.Server.DiscoveryStrategy == "" {
		s.Server.DiscoveryStrategy = DiscoveryOptOut
	}
	if s.Server.CacheControlMaxAgeRaw == "" {
		s.Server.CacheControlMaxAgeRaw = "1d"
	}
	if s.Server.TimeUntilMatureRaw == "" {
		s.Server.TimeUntilMatureRaw = "1w"
	}
	if s.Server.DryRunUpdateCount <= 0 {
		s.Server.DryRunUpdateCount = 3
	}
	if s.Server.MessageHistorySize <= 0 {
		s.Server.MessageHistorySize = 8
	}
	if s.AutoUpdater.IntervalRaw == "" {
		s.AutoUpdater.IntervalRaw = "1d"
	}
	if s.AutoUpdater.MaxConcurrent <= 0 {
		s.AutoUpdater.MaxConcurrent = 1
	}

	s.Server.CacheControlMaxAgeSeconds = int(parseIntervalSeconds(s.Server.CacheControlMaxAgeRaw))
	s.Server.TimeUntilMatureSeconds = int(parseIntervalSeconds(s.Server.TimeUntilMatureRaw))
	s.AutoUpdater.IntervalSeconds = int(parseIntervalSeconds(s.AutoUpdater.IntervalRaw))
}

func parseIntervalSeconds(raw string) int64 {
	d, err := parseInterval(raw)
	if err != nil {
		return 0
	}
	return int64(d.Seconds())
}

func parseInterval(raw string) (time.Duration, error) {
	if raw == "" {
		return 0, nil
	}
	// support suffixes: s, m, h, d, w
	last := raw[len(raw)-1]
	if last >= '0' && last <= '9' {
		// default to seconds
		v, err := time.ParseDuration(raw + "s")
		return v, err
	}
	value := raw[:len(raw)-1]
	suffix := raw[len(raw)-1]
	var mul time.Duration
	switch suffix {
	case 's':
		mul = time.Second
	case 'm':
		mul = time.Minute
	case 'h':
		mul = time.Hour
	case 'd':
		mul = 24 * time.Hour
	case 'w':
		mul = 7 * 24 * time.Hour
	default:
		return 0, errors.New("invalid interval suffix")
	}
	val, err := parseFloat(value)
	if err != nil {
		return 0, err
	}
	return time.Duration(val * float64(mul)), nil
}

func parseFloat(v string) (float64, error) {
	return strconvParseFloat(v)
}

// small indirection to keep parseFloat simple for testing
var strconvParseFloat = func(v string) (float64, error) {
	return strconv.ParseFloat(v, 64)
}
