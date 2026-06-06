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

  const STORAGE_KEY_PREFIX = 'sfdt_telemetry_sent_';
  const OPT_OUT_KEY = 'sfdt_telemetry_opt_out';

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

  return {
    recordInstall,
    optOut,
    optIn,
    isOptedOut
  };
})();

// Expose on window for content script access
if (typeof window !== 'undefined') {
  window.SFDTTelemetryService = SFDTTelemetryService;
}
