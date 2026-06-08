/**
 * TelemetryService - Lightweight anonymous usage telemetry.
 * Sends org-level info (org ID, company name, org type) to a Google Sheet
 * on first activation per org. No PII is collected.
 *
 * ── SETUP ──────────────────────────────────────────────────────────────
 * 1. Create a Google Sheet
 * 2. Extensions → Apps Script → paste the Apps Script code (see README or below)
 * 3. Deploy as Web App (Execute as: Me, Access: Anyone)
 * 4. Copy the Web App URL and set it as TELEMETRY_ENDPOINT below
 * ────────────────────────────────────────────────────────────────────────
 */
const SFDTTelemetryService = (() => {
  'use strict';

  const API = window.SalesforceAPI;

  // ── Configuration ──────────────────────────────────────
  // Replace with your Google Apps Script Web App URL after deployment
  const TELEMETRY_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzR0h1wEDvTAHSXDUA6GYk2qRltZCAOLyVh39INW-gKVhnng9Nl67iRcJvtuVI_t6sYfA/exec';

  // Separate endpoint for feature usage analytics (set after deploying usage-tracking Apps Script)
  const USAGE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzR0h1wEDvTAHSXDUA6GYk2qRltZCAOLyVh39INW-gKVhnng9Nl67iRcJvtuVI_t6sYfA/exec';

  const STORAGE_KEY_PREFIX = 'sfdt_telemetry_sent_';
  const OPT_OUT_KEY = 'sfdt_telemetry_opt_out';
  const USAGE_KEY = 'sfdt_feature_usage';
  const USAGE_SENT_KEY = 'sfdt_usage_last_sent';
  const USAGE_SEND_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Record that this org is using the extension.
   * Only fires once per unique org. Silently no-ops on any failure.
   */
  async function recordInstall() {
    try {
      if (!TELEMETRY_ENDPOINT) return; // Not configured yet

      // Check opt-out
      const optOut = await _getStorage(OPT_OUT_KEY);
      if (optOut) return;

      // Get org ID
      const orgId = API.getOrgId();
      if (!orgId) return;

      // Check if already sent for this org
      const sentKey = `${STORAGE_KEY_PREFIX}${orgId}`;
      const alreadySent = await _getStorage(sentKey);
      if (alreadySent) return;

      // Query Organization object for company details
      const orgInfo = await _fetchOrgInfo();
      if (!orgInfo) return;

      // Get extension version
      let extVersion = '';
      try {
        const manifest = chrome.runtime.getManifest();
        extVersion = manifest.version || '';
      } catch { /* ignore */ }

      // Detect installed managed packages (namespaces) to identify vendor orgs
      const packages = await _detectInstalledPackages();

      const payload = {
        orgId: orgId,
        companyName: orgInfo.Name || '',
        orgType: orgInfo.OrganizationType || '',
        isSandbox: orgInfo.IsSandbox || false,
        instanceUrl: API.getInstanceUrl() || '',
        city: orgInfo.City || '',
        country: orgInfo.Country || '',
        installedPackages: packages.join(', '),
        extensionVersion: extVersion,
        timestamp: new Date().toISOString()
      };

      // Send to Google Sheet (fire-and-forget)
      const resp = await fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors', // Google Apps Script doesn't support CORS preflight
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });

      // Mark as sent for this org (even if no-cors gives opaque response)
      await _setStorage(sentKey, {
        sentAt: new Date().toISOString(),
        orgName: orgInfo.Name
      });

      window._sfdtLogger.log('[SFDT] Telemetry recorded for org:', orgInfo.Name);
    } catch (err) {
      // Telemetry should never break the extension
      window._sfdtLogger.debug('[SFDT] Telemetry error (non-critical):', err.message);
    }
  }

  /**
   * Query the Organization sObject for company info.
   */
  async function _fetchOrgInfo() {
    try {
      const result = await API.restQuery(
        'SELECT Id, Name, OrganizationType, IsSandbox, City, Country FROM Organization LIMIT 1'
      );
      if (result && result.records && result.records.length > 0) {
        return result.records[0];
      }
    } catch (err) {
      window._sfdtLogger.debug('[SFDT] Could not fetch org info:', err.message);
    }
    return null;
  }

  /**
   * Detect installed managed packages by querying installed subscribers.
   * This tells us which vendor's product is in the org
   * (e.g., "Apttus_Config2" = Conga CPQ, "SBQQ" = Salesforce CPQ).
   */
  async function _detectInstalledPackages() {
    try {
      // Query InstalledSubscriberPackage via Tooling API for accurate package info
      const result = await API.toolingQuery(
        'SELECT SubscriberPackage.NamespacePrefix, SubscriberPackage.Name FROM InstalledSubscriberPackage'
      );
      if (result && result.records && result.records.length > 0) {
        return result.records.map(r => {
          const ns = r.SubscriberPackage.NamespacePrefix || '';
          const name = r.SubscriberPackage.Name || '';
          return ns ? `${ns} (${name})` : name;
        }).filter(Boolean);
      }
    } catch {
      // Tooling API might not be accessible — fall back to namespace detection via sobjects
      try {
        const desc = await API.restGet('/sobjects/');
        if (desc && desc.sobjects) {
          const namespaces = new Set();
          for (const obj of desc.sobjects) {
            if (obj.custom && obj.name && obj.name.includes('__')) {
              const ns = obj.name.split('__')[0];
              if (ns && ns !== obj.name) namespaces.add(ns);
            }
          }
          return Array.from(namespaces);
        }
      } catch { /* ignore */ }
    }
    return [];
  }

  /**
   * Allow users to opt out of telemetry.
   */
  async function optOut() {
    await _setStorage(OPT_OUT_KEY, true);
    window._sfdtLogger.log('[SFDT] Telemetry opted out.');
  }

  /**
   * Allow users to opt back in.
   */
  async function optIn() {
    await _removeStorage(OPT_OUT_KEY);
    // Also clear sent markers so it re-sends on next load
    try {
      chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items || {}).filter(k => k.startsWith(STORAGE_KEY_PREFIX));
        if (keys.length) chrome.storage.local.remove(keys);
      });
    } catch { /* ignore */ }
    window._sfdtLogger.log('[SFDT] Telemetry opted in.');
  }

  /**
   * Check if telemetry is opted out.
   */
  async function isOptedOut() {
    return !!(await _getStorage(OPT_OUT_KEY));
  }

  // ── Storage helpers ────────────────────────────────────

  function _getStorage(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (result) => {
          resolve(result ? result[key] : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function _setStorage(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, resolve);
      } catch {
        resolve();
      }
    });
  }

  function _removeStorage(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(key, resolve);
      } catch {
        resolve();
      }
    });
  }

  // ── Feature Usage Tracking ──────────────────────────────

  /**
   * Track a feature usage event. Increments local counter.
   * Events are batched and sent to Google Sheet every 24h.
   *
   * @param {string} feature - Feature name (e.g., 'search', 'inspector', 'soql')
   * @param {string} [action] - Specific action (e.g., 'open', 'query', 'edit')
   */
  async function trackEvent(feature, action) {
    try {
      const optOut = await _getStorage(OPT_OUT_KEY);
      if (optOut) return;

      const orgId = API.getOrgId();
      if (!orgId) return;

      const usage = (await _getStorage(USAGE_KEY)) || {};
      if (!usage[orgId]) usage[orgId] = {};

      const key = action ? `${feature}.${action}` : feature;
      usage[orgId][key] = (usage[orgId][key] || 0) + 1;

      // Track daily active date
      const today = new Date().toISOString().split('T')[0];
      usage[orgId]._lastActive = today;
      if (!usage[orgId]._firstSeen) usage[orgId]._firstSeen = today;

      // Track session count (one per page load)
      if (!usage[orgId]._sessionCounted) {
        usage[orgId].sessions = (usage[orgId].sessions || 0) + 1;
        usage[orgId]._sessionCounted = true;
      }

      await _setStorage(USAGE_KEY, usage);
    } catch {
      // Never break the extension
    }
  }

  /**
   * Flush accumulated usage data to Google Sheet.
   * Called on extension load, only sends if 24h since last send.
   */
  async function flushUsage() {
    try {
      if (!USAGE_ENDPOINT) return;

      const optOut = await _getStorage(OPT_OUT_KEY);
      if (optOut) return;

      // Check if enough time has passed since last send
      const lastSent = await _getStorage(USAGE_SENT_KEY);
      if (lastSent && (Date.now() - lastSent) < USAGE_SEND_INTERVAL) return;

      const usage = (await _getStorage(USAGE_KEY)) || {};
      if (Object.keys(usage).length === 0) return;

      const orgId = API.getOrgId();
      if (!orgId || !usage[orgId]) return;

      const orgUsage = usage[orgId];

      // Get extension version
      let extVersion = '';
      try { extVersion = chrome.runtime.getManifest().version || ''; } catch { /* ignore */ }

      const payload = {
        type: 'usage',
        orgId: orgId,
        extensionVersion: extVersion,
        timestamp: new Date().toISOString(),
        lastActive: orgUsage._lastActive || '',
        firstSeen: orgUsage._firstSeen || '',
        sessions: orgUsage.sessions || 0,
        // Feature open counts
        search_open: orgUsage['search.open'] || 0,
        inspector_open: orgUsage['inspector.open'] || 0,
        soql_open: orgUsage['soql.open'] || 0,
        navigator_open: orgUsage['navigator.open'] || 0,
        debuglog_open: orgUsage['debuglog.open'] || 0,
        execanon_open: orgUsage['execanon.open'] || 0,
        // Feature-specific actions
        search_navigate: orgUsage['search.navigate'] || 0,
        soql_run: orgUsage['soql.run'] || 0,
        soql_export: orgUsage['soql.export'] || 0,
        inspector_edit: orgUsage['inspector.edit'] || 0,
        inspector_impact: orgUsage['inspector.impact'] || 0,
        inspector_graph: orgUsage['inspector.graph'] || 0,
        inspector_compare: orgUsage['inspector.compare'] || 0,
        inspector_json: orgUsage['inspector.json'] || 0,
        execanon_run: orgUsage['execanon.run'] || 0,
        debuglog_view: orgUsage['debuglog.view'] || 0,
        debuglog_analyze: orgUsage['debuglog.analyze'] || 0
      };

      // Send to Google Sheet
      await fetch(USAGE_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });

      // Reset counters for this org after sending
      delete usage[orgId];
      await _setStorage(USAGE_KEY, usage);
      await _setStorage(USAGE_SENT_KEY, Date.now());

      window._sfdtLogger.log('[SFDT] Usage data flushed.');
    } catch (err) {
      window._sfdtLogger.debug('[SFDT] Usage flush error:', err.message);
    }
  }

  return {
    recordInstall,
    trackEvent,
    flushUsage,
    optOut,
    optIn,
    isOptedOut
  };
})();

// Expose on window for content script access
if (typeof window !== 'undefined') {
  window.SFDTTelemetryService = SFDTTelemetryService;
}
