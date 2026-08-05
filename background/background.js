/**
 * Background Service Worker - Manifest V3.
 * Handles session retrieval via chrome.cookies, keyboard commands, and tab management.
 */

// Listen for keyboard commands defined in manifest.json
chrome.commands.onCommand.addListener(async (command, tab) => {
  let targetTab = tab;
  if (!targetTab || !targetTab.id) {
    try {
      [targetTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch { /* ignore */ }
  }
  if (!targetTab || !targetTab.id) return;
  // Toggle so the shortcut closes the panel it opened, matching the in-page
  // handler used when Chrome hasn't bound the command.
  _deliverCommand(targetTab.id, command, { toggle: true });
});

// Sends a command to the top frame, healing tabs whose content script never
// loaded (installed/updated after the tab was opened) instead of failing mute.
async function _deliverCommand(tabId, command, extra = {}) {
  const message = { action: command, ...extra };
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    return true;
  } catch { /* content script not reachable yet */ }

  const injected = await _injectContentScript(tabId);
  if (!injected) return false;

  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    return true;
  } catch (err) {
    console.debug('[SFDT] Command delivery failed:', command, err && err.message);
    return false;
  }
}

async function _injectContentScript(tabId) {
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => !!window._sfdtInitialized
    });
    if (probe && probe.result) {
      // Globals are present but the message listener is gone: this tab holds an
      // orphaned content script from a previous extension version. Re-injecting
      // would only throw on redeclared globals — the page must be reloaded.
      console.debug('[SFDT] Orphaned content script in tab', tabId, '— reload the page.');
      return false;
    }
  } catch (err) {
    console.debug('[SFDT] Content script probe failed:', err && err.message);
    return false;
  }

  try {
    const manifest = chrome.runtime.getManifest();
    const main = (manifest.content_scripts || []).find(
      cs => Array.isArray(cs.js) && cs.js.some(f => f.includes('salesforceContentScript'))
    );
    if (!main) return false;
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: main.js
    });
    return true;
  } catch (err) {
    console.debug('[SFDT] Content script injection failed:', err && err.message);
    return false;
  }
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'get-session':
      _getSessionForUrl(message.url).then(sendResponse);
      return true; // async

    case 'get-tab-info':
      _getActiveTabInfo().then(sendResponse);
      return true;

    case 'is-salesforce':
      sendResponse({ isSalesforce: _isSalesforceUrl(message.url || '') });
      return false;

    case 'open-setup-url':
      if (message.url && sender.tab) {
        chrome.tabs.update(sender.tab.id, { url: message.url });
      }
      return false;

    case 'open-new-tab':
      if (message.url) {
        const newTabOpts = { url: message.url, active: true };
        if (sender.tab) newTabOpts.index = sender.tab.index + 1;
        chrome.tabs.create(newTabOpts);
      }
      return false;

    case 'relay-shortcut':
      // A Salesforce sub-frame had focus, so the top frame never saw the key.
      if (sender.tab && sender.tab.id && message.command) {
        _deliverCommand(sender.tab.id, message.command, { toggle: true });
      }
      return false;

    case 'update-context-menu':
      try {
        chrome.contextMenus.update('sfdt-inspect-record', {
          visible: !!message.hasRecord
        }).catch(() => _setupContextMenus());
      } catch { /* menus not created yet */ }
      return false;

    case 'get-extension-info':
      sendResponse({
        version: chrome.runtime.getManifest().version,
        name: chrome.runtime.getManifest().name
      });
      return false;

    case 'invalidate-cache':
      _broadcastToSalesforceTabs({ action: 'cache-invalidated' });
      return false;

    case 'proxy-fetch':
      _proxyFetch(message).then(sendResponse);
      return true; // async
  }
});

// When a Salesforce tab is activated, notify content scripts
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (_isSalesforceTab(tab)) {
      chrome.tabs.sendMessage(tab.id, { action: 'tab-activated' }).catch(() => {});
    }
  } catch { /* Tab closed */ }
});

// Context menus - created on install
const SF_MENU_PATTERNS = [
  'https://*.salesforce.com/*',
  'https://*.force.com/*',
  'https://*.lightning.force.com/*',
  'https://*.my.salesforce.com/*',
  'https://*.visual.force.com/*',
  'https://*.visualforce.com/*',
  'https://*.salesforce-setup.com/*'
];

const SF_MENU_ITEMS = [
  { id: 'sfdt-search', title: 'Search Salesforce for "%s"', contexts: ['selection'] },
  { id: 'sfdt-inspect-record', title: 'Inspect this Record', contexts: ['page'] },
  { id: 'sfdt-soql', title: 'Open SOQL Query Tool', contexts: ['page'] }
];

// onInstalled/onStartup can fire more than once (install → update → reload), and
// removeAll() is async. Serialising the setup and swallowing runtime.lastError
// prevents "Cannot create item with duplicate id" errors piling up.
let _menuSetupChain = Promise.resolve();

function _setupContextMenus() {
  _menuSetupChain = _menuSetupChain
    .then(() => new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        let remaining = SF_MENU_ITEMS.length;
        const done = () => { if (--remaining === 0) resolve(); };
        for (const item of SF_MENU_ITEMS) {
          try {
            chrome.contextMenus.create(
              { ...item, documentUrlPatterns: SF_MENU_PATTERNS },
              () => { void chrome.runtime.lastError; done(); }
            );
          } catch {
            done();
          }
        }
      });
    }))
    .catch(() => {});
  return _menuSetupChain;
}

chrome.runtime.onInstalled.addListener(_setupContextMenus);
chrome.runtime.onStartup.addListener(_setupContextMenus);

// Context menu click handler — must be at top level (not inside onInstalled)
// so it survives service worker restarts.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  switch (info.menuItemId) {
    case 'sfdt-search':
      chrome.tabs.sendMessage(tab.id, { action: 'open-search-palette', prefill: info.selectionText }).catch(() => {});
      break;
    case 'sfdt-inspect-record':
      chrome.tabs.sendMessage(tab.id, { action: 'open-inspector' }).catch(() => {});
      break;
    case 'sfdt-soql':
      chrome.tabs.sendMessage(tab.id, { action: 'open-soql' }).catch(() => {});
      break;
  }
});

// ─── Session Retrieval via chrome.cookies ────────────

async function _getSessionForUrl(url) {
  if (!url) return { sessionId: null };

  try {
    // Extract the domain for cookie lookup
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    // Build a list of URLs to check for the sid cookie.
    // When on a VF domain, the REST-API-compatible session lives on the main instance.
    const candidateUrls = [`https://${domain}`];

    // Derive the main Salesforce domain from VF/Visualforce hostnames
    const vfMatch = domain.match(/^(.+?)\.(.*?)\.(vf\.force\.com|visual\.force\.com|visualforce\.com)$/);
    if (vfMatch) {
      const orgPart = vfMatch[1].split('--')[0];
      const mainHost = `${orgPart}.${vfMatch[2]}.my.salesforce.com`;
      candidateUrls.unshift(`https://${mainHost}`); // prefer main domain
    } else {
      const vfSimple = domain.match(/^(.+?)\.(vf\.force\.com|visual\.force\.com|visualforce\.com)$/);
      if (vfSimple) {
        const orgPart = vfSimple[1].split('--')[0];
        candidateUrls.unshift(`https://${orgPart}.my.salesforce.com`);
      }
    }

    // If instanceUrl is already *.my.salesforce.com, also try the Lightning domain
    const mysfMatch = domain.match(/^(.+?)\.my\.salesforce\.com$/);
    if (mysfMatch) {
      candidateUrls.push(`https://${mysfMatch[1]}.lightning.force.com`);
    }

    // Also try parent domain as fallback
    const parentDomain = domain.replace(/^[^.]+\./, '');
    if (parentDomain && !parentDomain.startsWith('.')) {
      candidateUrls.push(`https://${parentDomain}`);
    }

    for (const candidateUrl of candidateUrls) {
      try {
        const cookie = await chrome.cookies.get({ url: candidateUrl, name: 'sid' });
        if (cookie && cookie.value) {
          let orgId = null;
          try {
            const oidCookie = await chrome.cookies.get({ url: candidateUrl, name: 'oid' });
            if (oidCookie) orgId = oidCookie.value;
          } catch { /* ignore */ }
          return { sessionId: cookie.value, orgId };
        }
      } catch { /* ignore */ }
    }

    return { sessionId: null };
  } catch (err) {
    // No `window` in an MV3 service worker — logging via window here would throw.
    console.debug('[SFDT] Cookie retrieval error:', err);
    return { sessionId: null };
  }
}

// ─── Fetch Proxy (for cross-origin requests from VF pages) ─────

async function _proxyFetch(message) {
  try {
    const { url, method, headers, body, responseType } = message;
    const opts = { method: method || 'GET', headers: headers || {} };
    if (body) opts.body = body;

    const resp = await fetch(url, opts);

    if (responseType === 'text') {
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, body: text, isText: true };
    }

    // For 204 No Content or empty body
    if (resp.status === 204 || resp.headers.get('content-length') === '0') {
      return { ok: resp.ok, status: resp.status, body: { success: true } };
    }

    const text = await resp.text();
    try {
      return { ok: resp.ok, status: resp.status, body: JSON.parse(text) };
    } catch {
      return { ok: resp.ok, status: resp.status, body: text, isText: true };
    }
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

// ─── Helpers ─────────────────────────────────────────

function _isSalesforceUrl(url) {
  return /https:\/\/[^/]*(salesforce\.com|force\.com|salesforce-setup\.com|visualforce\.com|visual\.force\.com)/.test(url);
}

function _isSalesforceTab(tab) {
  return tab.url && _isSalesforceUrl(tab.url);
}

async function _getActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { isSalesforce: false };
  return {
    isSalesforce: _isSalesforceUrl(tab.url || ''),
    tabId: tab.id,
    url: tab.url,
    title: tab.title
  };
}

async function _broadcastToSalesforceTabs(message) {
  const sfPatterns = [
    'https://*.salesforce.com/*',
    'https://*.force.com/*',
    'https://*.lightning.force.com/*',
    'https://*.my.salesforce.com/*',
    'https://*.salesforce-setup.com/*',
    'https://*.visual.force.com/*',
    'https://*.visualforce.com/*'
  ];
  const tabs = await chrome.tabs.query({ url: sfPatterns });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}
