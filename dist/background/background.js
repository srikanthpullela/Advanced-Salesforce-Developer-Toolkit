/**
 * Background Service Worker - Manifest V3.
 * Handles session retrieval via chrome.cookies, keyboard commands, and tab management.
 */

// Listen for keyboard commands defined in manifest.json
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab || !tab.id || !_isSalesforceTab(tab)) return;
  chrome.tabs.sendMessage(tab.id, { action: command });
});

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
chrome.runtime.onInstalled.addListener(() => {
  const sfPatterns = [
    'https://*.salesforce.com/*',
    'https://*.force.com/*',
    'https://*.lightning.force.com/*',
    'https://*.my.salesforce.com/*'
  ];

  chrome.contextMenus.create({
    id: 'sfdt-search',
    title: 'Search Salesforce for "%s"',
    contexts: ['selection'],
    documentUrlPatterns: sfPatterns
  });

  chrome.contextMenus.create({
    id: 'sfdt-inspect-record',
    title: 'Inspect this Record',
    contexts: ['page'],
    documentUrlPatterns: sfPatterns
  });

  chrome.contextMenus.create({
    id: 'sfdt-soql',
    title: 'Open SOQL Query Tool',
    contexts: ['page'],
    documentUrlPatterns: sfPatterns
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;
    switch (info.menuItemId) {
      case 'sfdt-search':
        chrome.tabs.sendMessage(tab.id, { action: 'open-search-palette', prefill: info.selectionText });
        break;
      case 'sfdt-inspect-record':
        chrome.tabs.sendMessage(tab.id, { action: 'open-inspector' });
        break;
      case 'sfdt-soql':
        chrome.tabs.sendMessage(tab.id, { action: 'open-soql' });
        break;
    }
  });
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
    console.error('[SFDT] Cookie retrieval error:', err);
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
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (_isSalesforceTab(tab)) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }
}
