package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type RegctlClient struct {
	cache    *TTLCache
	settings Settings
	mu       sync.Mutex
	store    registryStore
	storePath string
	rateLimitUntil time.Time
}

func NewRegctlClient(settings Settings, cache *TTLCache) *RegctlClient {
	client := &RegctlClient{
		settings:  settings,
		cache:     cache,
		storePath: filepath.Join("/data", "registry_cache.json"),
	}
	client.loadStore()
	return client
}

type RegctlInspect struct {
	Created time.Time `json:"created"`
	Config  struct {
		Labels map[string]string `json:"labels"`
	} `json:"config"`
}

func (c *RegctlClient) GetImageRemoteDigest(repoTag string, noCache bool) (string, error) {
	if strings.Contains(repoTag, "@sha256:") {
		return "", nil
	}
	if c.isRateLimited() {
		return "", ErrRateLimited
	}
	cacheKey := "digest:" + repoTag
	if !noCache {
		if cached, ok := c.cache.Get(cacheKey); ok {
			if value, ok := cached.(string); ok {
				return value, nil
			}
		}
	}
	out, err := runCommand("regctl", "image", "digest", repoTag)
	if err != nil {
		if logRateLimit(repoTag, err, c) {
			return "", ErrRateLimited
		}
		return "", err
	}
	digest := strings.TrimSpace(string(out))
	if digest == "" {
		return "", nil
	}
	imageName := repoTag
	if strings.Contains(repoTag, "@") {
		imageName = strings.SplitN(repoTag, "@", 2)[0]
	}
	if strings.Contains(repoTag, ":") {
		imageName = strings.SplitN(repoTag, ":", 2)[0]
	}
	res := fmt.Sprintf("%s@%s", imageName, digest)
	if !noCache {
		ttl := time.Duration(c.settings.Server.CacheControlMaxAgeSeconds) * time.Second
		if strings.Contains(repoTag, "sha256:") {
			ttl = 365 * 24 * time.Hour
		}
		c.cache.Set(cacheKey, res, ttl)
	}
	return res, nil
}

func (c *RegctlClient) GetImageInspect(repoTag string, noCache bool) (*RegctlInspect, error) {
	if c.isRateLimited() {
		return nil, ErrRateLimited
	}
	cacheKey := "inspect:" + repoTag
	if !noCache {
		if cached, ok := c.cache.Get(cacheKey); ok {
			if value, ok := cached.(*RegctlInspect); ok {
				return value, nil
			}
		}
	}
	out, err := runCommand("regctl", "image", "inspect", repoTag)
	if err != nil {
		if logRateLimit(repoTag, err, c) {
			return nil, ErrRateLimited
		}
		return nil, err
	}
	var inspect RegctlInspect
	if err := json.Unmarshal(out, &inspect); err != nil {
		return nil, err
	}
	if !noCache {
		ttl := time.Duration(c.settings.Server.CacheControlMaxAgeSeconds) * time.Second
		if strings.Contains(repoTag, "sha256:") {
			ttl = 365 * 24 * time.Hour
		}
		c.cache.Set(cacheKey, &inspect, ttl)
	}
	return &inspect, nil
}

var ErrRateLimited = errors.New("registry rate limit")

func logRateLimit(repoTag string, err error, c *RegctlClient) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "toomanyrequests") || strings.Contains(msg, "rate limit") || strings.Contains(msg, "429") {
		log.Printf("rate limit reached while querying registry for %s: %v", repoTag, err)
		if c != nil {
			c.setRateLimited(1 * time.Hour)
		}
		return true
	}
	return false
}

type registryStore struct {
	LastCheck time.Time                 `json:"lastCheck"`
	Entries   map[string]registryEntry  `json:"entries"`
}

type registryEntry struct {
	CheckedAt    time.Time `json:"checkedAt"`
	LatestUpdate time.Time `json:"latestUpdate"`
	LatestVersion string   `json:"latestVersion"`
}

func (c *RegctlClient) loadStore() {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := os.ReadFile(c.storePath)
	if err != nil {
		c.store = registryStore{Entries: map[string]registryEntry{}}
		return
	}
	var store registryStore
	if err := json.Unmarshal(data, &store); err != nil {
		c.store = registryStore{Entries: map[string]registryEntry{}}
		return
	}
	if store.Entries == nil {
		store.Entries = map[string]registryEntry{}
	}
	c.store = store
}

func (c *RegctlClient) saveStore() {
	data, err := json.MarshalIndent(c.store, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(c.storePath, data, 0644)
}

func (c *RegctlClient) UpdateCache(repoTag string, latestUpdate time.Time, latestVersion string) {
	if repoTag == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.store.Entries == nil {
		c.store.Entries = map[string]registryEntry{}
	}
	c.store.Entries[repoTag] = registryEntry{
		CheckedAt:    time.Now(),
		LatestUpdate: latestUpdate,
		LatestVersion: latestVersion,
	}
	c.store.LastCheck = time.Now()
	c.saveStore()
}

func (c *RegctlClient) GetCached(repoTag string) (registryEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.store.Entries[repoTag]; ok {
		return entry, true
	}
	return registryEntry{}, false
}

func (c *RegctlClient) LastCheck() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.store.LastCheck
}

func (c *RegctlClient) RateLimitUntil() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rateLimitUntil
}

func (c *RegctlClient) setRateLimited(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	until := time.Now().Add(duration)
	if until.After(c.rateLimitUntil) {
		c.rateLimitUntil = until
	}
}

func (c *RegctlClient) isRateLimited() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return time.Now().Before(c.rateLimitUntil)
}
