/**
 * SalesforceAPI - Handles all communication with Salesforce REST, Tooling, and Metadata APIs.
 * Session token is retrieved via chrome.cookies API (relayed through background script)
 * since the sid cookie is HttpOnly and not accessible via document.cookie in Lightning.
 */
const SalesforceAPI = (() => {
  const API_VERSION = 'v59.0';
  let _sessionId = null;
  let _instanceUrl = null;
  let _orgId = null;
  let _connectPromise = null;

  function getInstanceUrl() {
    if (!_instanceUrl) {
      const url = new URL(window.location.href);
      let hostname = url.hostname;

      // Lightning domains redirect API calls to *.my.salesforce.com — derive it directly.
      // Pattern: {org}.lightning.force.com  →  {org}.my.salesforce.com
      const lightningMatch = hostname.match(/^(.+?)\.lightning\.force\.com$/);
      if (lightningMatch) {
        hostname = `${lightningMatch[1]}.my.salesforce.com`;
      }

      // Visualforce domains don't support REST API — derive the main Salesforce instance URL.
      // VF patterns: {org}--{ns}.{pod}.vf.force.com  or  {org}--{ns}.{pod}.visual.force.com
      //              {org}--{ns}.vf.force.com          (enhanced domains, no pod)
      const vfMatch = hostname.match(/^(.+?)\.(.*?)\.(vf\.force\.com|visual\.force\.com|visualforce\.com)$/);
      if (vfMatch) {
        const orgPart = vfMatch[1].split('--')[0]; // strip namespace
        const middle = vfMatch[2]; // pod segment(s)
        hostname = `${orgPart}.${middle}.my.salesforce.com`;
      } else if (!lightningMatch) {
        // Enhanced domain with no pod: {org}--{ns}.vf.force.com
        const vfSimple = hostname.match(/^(.+?)\.(vf\.force\.com|visual\.force\.com|visualforce\.com)$/);
        if (vfSimple) {
          const orgPart = vfSimple[1].split('--')[0];
          hostname = `${orgPart}.my.salesforce.com`;
        }
      }

      // Salesforce-setup domains (enhanced domains setup)
      // Pattern: {org}.my.salesforce-setup.com → {org}.my.salesforce.com
      const setupMatch = hostname.match(/^(.+?)\.my\.salesforce-setup\.com$/);
      if (setupMatch) {
        hostname = `${setupMatch[1]}.my.salesforce.com`;
      }

      _instanceUrl = `${url.protocol}//${hostname}`;
    }
    return _instanceUrl;
  }

  function getSessionId() { return _sessionId; }
  function getOrgId() { return _orgId; }
  function isConnected() { return !!_sessionId; }

  /**
   * Connect to Salesforce by retrieving the session token.
   * Uses chrome.cookies API via background script (reliable for HttpOnly cookies).
   * Falls back to document.cookie and page-level token extraction.
   */
  async function connect() {
    if (_sessionId) return true;
    if (_connectPromise) return _connectPromise;

    _connectPromise = new Promise((resolve) => {
      const instanceUrl = getInstanceUrl();

      // Try org id from page meta
      try {
        const orgMeta = document.querySelector('meta[name="org-id"]');
        if (orgMeta) _orgId = orgMeta.getAttribute('content');
      } catch { /* ignore */ }

      // Ask background script for the sid cookie via chrome.cookies API
      try {
        chrome.runtime.sendMessage(
          { action: 'get-session', url: instanceUrl },
          (response) => {
            if (chrome.runtime.lastError) {
              _tryFallbackSession();
              resolve(!!_sessionId);
              return;
            }
            if (response && response.sessionId) {
              _sessionId = response.sessionId;
              if (response.orgId) _orgId = response.orgId;
              console.log('[SFDT] Session obtained via chrome.cookies');
            } else {
              _tryFallbackSession();
            }
            resolve(!!_sessionId);
          }
        );
      } catch {
        _tryFallbackSession();
        resolve(!!_sessionId);
      }
    });

    const result = await _connectPromise;
    _connectPromise = null;
    return result;
  }

  /**
   * Fallback session extraction for Classic mode or when background is unavailable.
   */
  function _tryFallbackSession() {
    // 1. Try document.cookie (works in Classic where sid is not HttpOnly)
    const cookies = document.cookie.split(';').map(c => c.trim());
    const sidCookie = cookies.find(c => c.startsWith('sid='));
    if (sidCookie) {
      _sessionId = sidCookie.split('=')[1];
      console.log('[SFDT] Session obtained via document.cookie');
      return;
    }

    // 2. Try aura framework config
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        const tokenMatch = text.match(/"token"\s*:\s*"([^"]+)"/);
        if (tokenMatch && tokenMatch[1].length > 20) {
          _sessionId = tokenMatch[1];
          console.log('[SFDT] Session obtained via Aura config');
          return;
        }
      }
    } catch { /* ignore */ }

    console.debug('[SFDT] Could not obtain session token');
  }

  let _reconnectPromise = null;

  /**
   * Detect if the API target is cross-origin (e.g. VF page calling .my.salesforce.com).
   * In MV3, content scripts can't make cross-origin fetches, so we proxy through
   * the background service worker.
   */
  function _isCrossOrigin() {
    try {
      const pageHost = new URL(window.location.href).hostname;
      const apiHost = new URL(getInstanceUrl()).hostname;
      return pageHost !== apiHost;
    } catch { return false; }
  }

  async function _bgFetch(url, options = {}, responseType = 'json') {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'proxy-fetch',
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null,
        responseType
      }, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) return reject(new Error('No response from background proxy'));
        if (response.error) return reject(new Error(response.error));
        resolve(response);
      });
    });
  }

  async function _fetch(path, options = {}, _retried = false) {
    if (!_sessionId) {
      const reconnected = await connect();
      if (!reconnected) throw new Error('No Salesforce session. Please log in.');
    }

    const base = getInstanceUrl();
    const url = path.startsWith('http') ? path : `${base}${path}`;

    const headers = {
      'Authorization': `Bearer ${_sessionId}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    };

    let status, ok, result;

    if (_isCrossOrigin()) {
      // Proxy through background service worker (no CORS restrictions)
      const proxyResp = await _bgFetch(url, { ...options, headers });
      status = proxyResp.status;
      ok = proxyResp.ok;
      result = proxyResp;
    } else {
      const resp = await fetch(url, { ...options, headers, credentials: 'include' });
      status = resp.status;
      ok = resp.ok;
      if (ok) {
        if (status === 204 || resp.headers.get('content-length') === '0') {
          return { success: true };
        }
        return resp.json();
      }
      // Build a proxy-like result for error handling below
      const errText = await resp.text();
      result = { ok: false, status, body: errText, isText: true };
    }

    if (status === 401 && !_retried) {
      if (!_reconnectPromise) {
        _reconnectPromise = (async () => {
          _sessionId = null;
          const r = await connect();
          _reconnectPromise = null;
          return r;
        })();
      }
      const reconnected = await _reconnectPromise;
      if (reconnected) return _fetch(path, options, true);
      throw new Error('Session expired. Please refresh the Salesforce page.');
    }

    if (!ok) {
      const errBody = result.isText ? result.body : JSON.stringify(result.body);
      throw new Error(`Salesforce API ${status}: ${errBody}`);
    }

    // Success from proxy
    return result.body;
  }

  async function restQuery(soql) {
    return _fetch(`/services/data/${API_VERSION}/query/?q=${encodeURIComponent(soql)}`);
  }

  async function restGet(path) {
    return _fetch(`/services/data/${API_VERSION}${path}`);
  }

  async function restPatch(sobjectType, recordId, data) {
    return _fetch(`/services/data/${API_VERSION}/sobjects/${encodeURIComponent(sobjectType)}/${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async function restPost(sobjectType, data) {
    return _fetch(`/services/data/${API_VERSION}/sobjects/${encodeURIComponent(sobjectType)}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async function restDelete(sobjectType, recordId) {
    return _fetch(`/services/data/${API_VERSION}/sobjects/${encodeURIComponent(sobjectType)}/${encodeURIComponent(recordId)}`, {
      method: 'DELETE'
    });
  }

  async function toolingQuery(soql) {
    return _fetch(`/services/data/${API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`);
  }

  /**
   * Tooling query with automatic pagination — fetches ALL records.
   */
  async function toolingQueryAll(soql) {
    let result = await _fetch(`/services/data/${API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`);
    let allRecords = result.records || [];

    while (!result.done && result.nextRecordsUrl) {
      // nextRecordsUrl is an absolute path like /services/data/v59.0/tooling/query/01g...
      result = await _fetch(result.nextRecordsUrl);
      if (result.records) allRecords = allRecords.concat(result.records);
    }

    return { totalSize: allRecords.length, records: allRecords, done: true };
  }

  async function toolingGet(path) {
    return _fetch(`/services/data/${API_VERSION}/tooling${path}`);
  }

  async function toolingSearch(sosl) {
    return _fetch(`/services/data/${API_VERSION}/tooling/search/?q=${encodeURIComponent(sosl)}`);
  }

  /**
   * Global SOSL search across all searchable objects (records, not just metadata).
   * Uses the REST search endpoint (not Tooling) to find Products, Accounts, etc.
   */
  async function globalSearch(query) {
    return _fetch(`/services/data/${API_VERSION}/search/?q=${encodeURIComponent(query)}`);
  }

  /**
   * Parameterized search — lets Salesforce decide which objects to search.
   * Returns results grouped by sObject type.
   */
  async function parameterizedSearch(query) {
    return _fetch(`/services/data/${API_VERSION}/parameterizedSearch/?q=${encodeURIComponent(query)}`);
  }

  async function describeGlobal() {
    return _fetch(`/services/data/${API_VERSION}/sobjects/`);
  }

  async function describeSObject(name) {
    return _fetch(`/services/data/${API_VERSION}/sobjects/${encodeURIComponent(name)}/describe/`);
  }

  async function composite(requests) {
    return _fetch(`/services/data/${API_VERSION}/composite`, {
      method: 'POST',
      body: JSON.stringify({ allOrNone: false, compositeRequest: requests })
    });
  }

  async function getRecord(sobjectType, recordId, fields) {
    const fieldsParam = fields ? `?fields=${fields.join(',')}` : '';
    return _fetch(`/services/data/${API_VERSION}/sobjects/${encodeURIComponent(sobjectType)}/${recordId}${fieldsParam}`);
  }

  async function getDebugLogs(limit = 20) {
    return toolingQuery(
      `SELECT Id, LogUserId, LogLength, LastModifiedDate, Request, Operation, Application, Status, DurationMilliseconds FROM ApexLog ORDER BY LastModifiedDate DESC LIMIT ${parseInt(limit, 10)}`
    );
  }

  async function getDebugLogBody(logId) {
    const base = getInstanceUrl();
    const url = `${base}/services/data/${API_VERSION}/tooling/sobjects/ApexLog/${encodeURIComponent(logId)}/Body`;
    const headers = { 'Authorization': `Bearer ${_sessionId}`, 'Accept': 'text/plain' };

    if (_isCrossOrigin()) {
      const proxyResp = await _bgFetch(url, { method: 'GET', headers }, 'text');
      if (!proxyResp.ok) throw new Error(`Failed to fetch log body: ${proxyResp.status}`);
      return proxyResp.body;
    }

    const resp = await fetch(url, { headers, credentials: 'include' });
    return resp.text();
  }

  async function executeAnonymous(code) {
    return _fetch(`/services/data/${API_VERSION}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(code)}`);
  }

  async function getCurrentUser() {
    return _fetch(`/services/data/${API_VERSION}/chatter/users/me`);
  }

  async function getLimits() {
    return _fetch(`/services/data/${API_VERSION}/limits/`);
  }

  return {
    connect, getSessionId, getInstanceUrl, getOrgId, isConnected,
    restQuery, restGet, restPatch, restPost, restDelete,
    toolingQuery, toolingQueryAll, toolingGet, toolingSearch,
    globalSearch, parameterizedSearch,
    describeGlobal, describeSObject, composite, getRecord,
    getDebugLogs, getDebugLogBody, executeAnonymous, getCurrentUser, getLimits,
    API_VERSION
  };
})();

if (typeof window !== 'undefined') window.SalesforceAPI = SalesforceAPI;
