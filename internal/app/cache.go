package app

import (
	"sync"
	"time"
)

type cacheItem struct {
	value any
	exp   time.Time
}

type TTLCache struct {
	mu    sync.Mutex
	items map[string]cacheItem
}

func NewTTLCache() *TTLCache {
	return &TTLCache{items: make(map[string]cacheItem)}
}

func (c *TTLCache) Get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item, ok := c.items[key]
	if !ok {
		return nil, false
	}
	if !item.exp.IsZero() && time.Now().After(item.exp) {
		delete(c.items, key)
		return nil, false
	}
	return item.value, true
}

func (c *TTLCache) Set(key string, value any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	c.items[key] = cacheItem{value: value, exp: exp}
}

func (c *TTLCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]cacheItem)
}

