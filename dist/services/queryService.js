/**
 * QueryService - SOQL query editor backend.
 * Handles query execution, autocomplete, history, favorites, optimization hints.
 */
const QueryService = (() => {
  const API = () => window.SalesforceAPI;
  const CACHE = () => window.SFDTCacheManager;
  const META = () => window.SFDTMetadataService;

  const HISTORY_KEY = 'sfdt_query_history';
  const FAVORITES_KEY = 'sfdt_query_favorites';
  const MAX_HISTORY = 100;

  // ─── Query Execution ──────────────────────────────────

  async function executeQuery(soql) {
    const startTime = performance.now();
    try {
      const result = await API().restQuery(soql);
      const elapsed = Math.round(performance.now() - startTime);

      _addToHistory(soql, true, elapsed, result.totalSize);

      return {
        success: true,
        records: result.records || [],
        totalSize: result.totalSize || 0,
        done: result.done,
        nextRecordsUrl: result.nextRecordsUrl,
        executionTime: elapsed,
        query: soql
      };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startTime);
      _addToHistory(soql, false, elapsed, 0);

      return {
        success: false,
        error: err.message,
        executionTime: elapsed,
        query: soql
      };
    }
  }

  async function executeToolingQuery(soql) {
    const startTime = performance.now();
    try {
      const result = await API().toolingQuery(soql);
      const elapsed = Math.round(performance.now() - startTime);
      return {
        success: true,
        records: result.records || [],
        totalSize: result.totalSize || 0,
        done: result.done,
        executionTime: elapsed,
        query: soql
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        executionTime: Math.round(performance.now() - startTime),
        query: soql
      };
    }
  }

  async function fetchNextPage(nextRecordsUrl) {
    return API().restGet(nextRecordsUrl);
  }

  // ─── Autocomplete ─────────────────────────────────────

  async function getObjectSuggestions(partial) {
    const index = META().getIndex();
    const objects = index.objects || [];
    const q = (partial || '').toLowerCase();
    return objects
      .filter(o => o.name.toLowerCase().includes(q) || (o.label && o.label.toLowerCase().includes(q)))
      .slice(0, 20)
      .map(o => ({ name: o.name, label: o.label, custom: o.custom }));
  }

  async function getFieldSuggestions(objectName) {
    try {
      const fields = await META().fetchCustomFields(objectName);
      return fields.map(f => ({
        name: f.name,
        label: f.label,
        type: f.type,
        relationship: f.relationshipName,
        referenceTo: f.referenceTo
      }));
    } catch {
      return [];
    }
  }

  function getKeywordSuggestions() {
    return [
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE',
      'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
      'NULLS FIRST', 'NULLS LAST', 'COUNT()', 'SUM()', 'AVG()', 'MIN()', 'MAX()',
      'COUNT_DISTINCT()', 'CALENDAR_MONTH()', 'CALENDAR_YEAR()', 'DAY_IN_MONTH()',
      'INCLUDES', 'EXCLUDES', 'TYPEOF', 'END', 'WHEN', 'THEN', 'ELSE',
      'WITH SECURITY_ENFORCED', 'WITH USER_MODE', 'WITH SYSTEM_MODE',
      'FOR VIEW', 'FOR REFERENCE', 'FOR UPDATE', 'ALL ROWS',
      'TODAY', 'YESTERDAY', 'TOMORROW', 'LAST_WEEK', 'THIS_WEEK', 'NEXT_WEEK',
      'LAST_MONTH', 'THIS_MONTH', 'NEXT_MONTH', 'LAST_YEAR', 'THIS_YEAR',
      'LAST_N_DAYS', 'NEXT_N_DAYS', 'LAST_90_DAYS', 'NEXT_90_DAYS'
    ];
  }

  // ─── Query Analysis ───────────────────────────────────

  function analyzeQuery(soql) {
    const hints = [];
    const upper = soql.toUpperCase().trim();

    // No LIMIT
    if (!upper.includes('LIMIT')) {
      hints.push({
        severity: 'warning',
        message: 'No LIMIT clause. Consider adding LIMIT to avoid fetching too many records.',
        suggestion: 'Add LIMIT 200 (or appropriate number) to the query.'
      });
    }

    // SELECT *
    if (upper.includes('SELECT *')) {
      hints.push({
        severity: 'error',
        message: 'SOQL does not support SELECT *. Specify field names explicitly.',
        suggestion: 'Replace * with specific field names: SELECT Id, Name, ...'
      });
    }

    // LIKE with leading wildcard
    if (/LIKE\s+'%/.test(upper)) {
      hints.push({
        severity: 'warning',
        message: 'Leading wildcard in LIKE clause prevents index usage and may be slow.',
        suggestion: 'Use trailing wildcard instead: LIKE \'value%\''
      });
    }

    // Negative filter (!=, NOT)
    if (upper.includes('!=') || /\bNOT\b/.test(upper)) {
      hints.push({
        severity: 'info',
        message: 'Negative filters (!=, NOT) cannot use indexes and may cause full table scans.',
        suggestion: 'Consider restructuring the query to use positive filters when possible.'
      });
    }

    // No WHERE clause
    if (!upper.includes('WHERE') && !upper.includes('LIMIT')) {
      hints.push({
        severity: 'warning',
        message: 'No WHERE clause and no LIMIT. This will return all records.',
        suggestion: 'Add a WHERE clause or LIMIT to restrict results.'
      });
    }

    // ORDER BY without index
    if (upper.includes('ORDER BY') && !upper.includes('WHERE')) {
      hints.push({
        severity: 'info',
        message: 'ORDER BY without WHERE clause may be slow on large objects.',
        suggestion: 'Add a WHERE clause with an indexed field for better performance.'
      });
    }

    // Subquery detection
    const subqueryCount = (upper.match(/SELECT/g) || []).length;
    if (subqueryCount > 2) {
      hints.push({
        severity: 'warning',
        message: 'Multiple nested subqueries detected. This may impact performance.',
        suggestion: 'Consider breaking into separate queries if possible.'
      });
    }

    return hints;
  }

  function getQueryPlan(soql) {
    // Extract the main object
    const fromMatch = soql.match(/FROM\s+(\w+)/i);
    const whereMatch = soql.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/is);

    return {
      object: fromMatch ? fromMatch[1] : 'Unknown',
      hasWhereClause: !!whereMatch,
      whereClause: whereMatch ? whereMatch[1].trim() : null,
      hasLimit: /LIMIT\s+\d+/i.test(soql),
      hasOrderBy: /ORDER\s+BY/i.test(soql),
      hasGroupBy: /GROUP\s+BY/i.test(soql),
      subqueryCount: (soql.match(/SELECT/gi) || []).length,
      hints: analyzeQuery(soql)
    };
  }

  // ─── History (chrome.storage.local — shared across all tabs) ────

  let _historyCache = null;
  let _favoritesCache = null;
  let _historyLoaded = false;
  let _favoritesLoaded = false;

  // Load history from chrome.storage.local into memory cache
  async function _ensureHistoryLoaded() {
    if (_historyLoaded) return;
    try {
      const data = await chrome.storage.local.get(HISTORY_KEY);
      _historyCache = data[HISTORY_KEY] || [];
    } catch {
      // Fallback to localStorage for compatibility
      try { _historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { _historyCache = []; }
    }
    _historyLoaded = true;
  }

  async function _ensureFavoritesLoaded() {
    if (_favoritesLoaded) return;
    try {
      const data = await chrome.storage.local.get(FAVORITES_KEY);
      _favoritesCache = data[FAVORITES_KEY] || [];
    } catch {
      try { _favoritesCache = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { _favoritesCache = []; }
    }
    _favoritesLoaded = true;
  }

  // Listen for storage changes from other tabs
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[HISTORY_KEY]) {
        _historyCache = changes[HISTORY_KEY].newValue || [];
      }
      if (changes[FAVORITES_KEY]) {
        _favoritesCache = changes[FAVORITES_KEY].newValue || [];
      }
    });
  } catch { /* content script may not have access */ }

  function _addToHistory(soql, success, executionTime, resultCount) {
    // Fire-and-forget async
    _addToHistoryAsync(soql, success, executionTime, resultCount);
  }

  async function _addToHistoryAsync(soql, success, executionTime, resultCount) {
    await _ensureHistoryLoaded();

    // Deduplicate: if same query exists, remove the old entry and update with latest result
    const normalized = soql.trim();
    const existingIdx = _historyCache.findIndex(h => h.query.trim() === normalized);
    if (existingIdx !== -1) _historyCache.splice(existingIdx, 1);

    _historyCache.unshift({
      query: soql,
      success,
      executionTime,
      resultCount,
      timestamp: Date.now()
    });
    if (_historyCache.length > MAX_HISTORY) _historyCache.length = MAX_HISTORY;
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: _historyCache });
    } catch {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(_historyCache)); } catch { /* ignore */ }
    }
  }

  function getHistory() {
    // Return cache synchronously (loaded on first query or panel open)
    if (_historyCache !== null) return _historyCache;
    // Fallback for first call before async load
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }

  async function getHistoryAsync() {
    await _ensureHistoryLoaded();
    return _historyCache;
  }

  async function clearHistory() {
    _historyCache = [];
    try {
      await chrome.storage.local.remove(HISTORY_KEY);
    } catch { /* ignore */ }
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  }

  async function removeHistoryItem(index) {
    await _ensureHistoryLoaded();
    _historyCache.splice(index, 1);
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: _historyCache });
    } catch {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(_historyCache)); } catch { /* ignore */ }
    }
  }

  // ─── Favorites (chrome.storage.local — shared across all tabs) ──

  async function saveFavorite(name, soql) {
    await _ensureFavoritesLoaded();
    _favoritesCache.push({ name, query: soql, timestamp: Date.now() });
    try {
      await chrome.storage.local.set({ [FAVORITES_KEY]: _favoritesCache });
    } catch {
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(_favoritesCache)); } catch { /* ignore */ }
    }
  }

  async function removeFavorite(index) {
    await _ensureFavoritesLoaded();
    _favoritesCache.splice(index, 1);
    try {
      await chrome.storage.local.set({ [FAVORITES_KEY]: _favoritesCache });
    } catch {
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(_favoritesCache)); } catch { /* ignore */ }
    }
  }

  function getFavorites() {
    if (_favoritesCache !== null) return _favoritesCache;
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
  }

  async function getFavoritesAsync() {
    await _ensureFavoritesLoaded();
    return _favoritesCache;
  }

  // Preload caches on init
  _ensureHistoryLoaded();
  _ensureFavoritesLoaded();

  // ─── Export ───────────────────────────────────────────

  function recordsToCSV(records) {
    if (!records || records.length === 0) return '';
    const keys = Object.keys(records[0]).filter(k => k !== 'attributes');
    const header = keys.join(',');
    const rows = records.map(r =>
      keys.map(k => {
        const val = r[k];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape CSV values
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    );
    return [header, ...rows].join('\n');
  }

  function recordsToJSON(records) {
    if (!records) return '[]';
    const cleaned = records.map(r => {
      const copy = { ...r };
      delete copy.attributes;
      return copy;
    });
    return JSON.stringify(cleaned, null, 2);
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    executeQuery,
    executeToolingQuery,
    fetchNextPage,
    getObjectSuggestions,
    getFieldSuggestions,
    getKeywordSuggestions,
    analyzeQuery,
    getQueryPlan,
    getHistory,
    getHistoryAsync,
    clearHistory,
    removeHistoryItem,
    saveFavorite,
    removeFavorite,
    getFavorites,
    getFavoritesAsync,
    recordsToCSV,
    recordsToJSON,
    downloadFile
  };
})();

if (typeof window !== 'undefined') {
  window.SFDTQueryService = QueryService;
}
