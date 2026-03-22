/**
 * CacheManager - Local storage caching with TTL support for Salesforce metadata.
 * Reduces API calls by caching metadata, search indexes, and query results.
 */
const CacheManager = (() => {
  const CACHE_PREFIX = 'sfdt_';
  const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
  const METADATA_TTL_MS = 60 * 60 * 1000; // 1 hour for metadata
  const INDEX_TTL_MS = 30 * 60 * 1000; // 30 minutes for search indexes

  const TTL_MAP = {
    metadata: METADATA_TTL_MS,
    index: INDEX_TTL_MS,
    query: DEFAULT_TTL_MS,
    default: DEFAULT_TTL_MS
  };

  function _key(namespace, key) {
    return `${CACHE_PREFIX}${namespace}_${key}`;
  }

  function set(namespace, key, data, ttlMs) {
    const ttl = ttlMs || TTL_MAP[namespace] || DEFAULT_TTL_MS;
    const entry = {
      data,
      ts: Date.now(),
      exp: Date.now() + ttl
    };
    try {
      localStorage.setItem(_key(namespace, key), JSON.stringify(entry));
    } catch (e) {
      // Storage full — evict oldest entries
      _evictOldest(5);
      try {
        localStorage.setItem(_key(namespace, key), JSON.stringify(entry));
      } catch (_) {
        // Silent fail
      }
    }
  }

  function get(namespace, key) {
    try {
      const raw = localStorage.getItem(_key(namespace, key));
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() > entry.exp) {
        localStorage.removeItem(_key(namespace, key));
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  function remove(namespace, key) {
    localStorage.removeItem(_key(namespace, key));
  }

  function clearNamespace(namespace) {
    const prefix = `${CACHE_PREFIX}${namespace}_`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }

  function clearAll() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }

  function _evictOldest(count) {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        try {
          const entry = JSON.parse(localStorage.getItem(k));
          entries.push({ key: k, ts: entry.ts || 0 });
        } catch {
          entries.push({ key: k, ts: 0 });
        }
      }
    }
    entries.sort((a, b) => a.ts - b.ts);
    entries.slice(0, count).forEach(e => localStorage.removeItem(e.key));
  }

  function getStats() {
    let totalEntries = 0;
    let totalSize = 0;
    let expired = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        totalEntries++;
        const raw = localStorage.getItem(k);
        totalSize += (raw || '').length;
        try {
          const entry = JSON.parse(raw);
          if (Date.now() > entry.exp) expired++;
        } catch { /* ignore */ }
      }
    }
    return { totalEntries, totalSize, expired };
  }

  return { set, get, remove, clearNamespace, clearAll, getStats };
})();

// Make available globally for content scripts
if (typeof window !== 'undefined') {
  window.SFDTCacheManager = CacheManager;
}
