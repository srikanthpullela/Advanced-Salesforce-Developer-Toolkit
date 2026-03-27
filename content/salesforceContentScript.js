/**
 * Salesforce Content Script - Main orchestrator.
 * Initializes all components, handles keyboard shortcuts,
 * and manages communication with the background service worker.
 * Uses async connect() for session retrieval via chrome.cookies.
 */
(function () {
  'use strict';

  // Prevent double initialization
  if (window._sfdtInitialized) return;
  window._sfdtInitialized = true;

  const API = window.SalesforceAPI;
  const META = window.SFDTMetadataService;
  const SHADOW = window.SFDTShadowHelper;
  const ICONS = window.SFDTIcons;
  const PALETTE = window.SFDTSearchPalette;
  const INSPECTOR = window.SFDTInspectorPanel;
  const NAVIGATOR = window.SFDTNavigatorPanel;
  const SOQL = window.SFDTSOQLPanel;
  const DEBUGLOG = window.SFDTDebugLogPanel;
  const EXECANON = window.SFDTExecuteAnonymousPanel;

  // ─── Register listeners IMMEDIATELY (before session connect) ─────
  chrome.runtime.onMessage.addListener(_handleMessage);
  document.addEventListener('keydown', _handleKeyboard, true);
  document.addEventListener('contextmenu', _updateContextMenu, true);
  document.addEventListener('mousedown', _handleOutsideClick, true);
  console.log('[SFDT] Listeners registered.');

  // ─── Page Detection ───────────────────────────────────

  function _isOrgPage() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    // Exclude known non-org pages
    if (host === 'login.salesforce.com' || host === 'test.salesforce.com') return false;
    if (host.includes('trailhead.') || host.includes('trailblazer.')) return false;
    if (host.includes('help.salesforce.com') || host.includes('developer.salesforce.com')) return false;
    if (host.includes('status.salesforce.com')) return false;
    if (path === '/login' || path.startsWith('/login/') || path.startsWith('/secur/')) return false;

    // Include: Lightning, Classic, Setup, VF pages, REST-capable org domains
    if (host.includes('.my.salesforce.com')) return true;
    if (host.includes('.lightning.force.com')) return true;
    if (host.includes('.salesforce-setup.com')) return true;
    if (host.includes('.vf.force.com') || host.includes('.visual.force.com') || host.includes('.visualforce.com')) return true;
    // Classic org pages on force.com (non-VF) typically have /apex/, /setup/, or standard tabs
    if (host.includes('.force.com') && (path.startsWith('/apex/') || path.startsWith('/setup/') || path.startsWith('/lightning/') || path.startsWith('/one/') || document.querySelector('meta[name="org-id"]')))  return true;
    // Scratch org or sandbox on salesforce.com
    if (host.includes('.scratch.') || host.includes('.sandbox.')) return true;

    return false;
  }

  // ─── Initialization (async) ───────────────────────────

  let _initRetries = 0;
  const MAX_INIT_RETRIES = 3;

  async function init() {
    // Only run on actual Salesforce org pages (Lightning, Classic, Setup, VF)
    // Skip login pages, help, Trailhead, static assets, etc.
    if (!_isOrgPage()) {
      console.log('[SFDT] Skipping non-org page:', window.location.hostname);
      return;
    }

    console.log('[SFDT] Connecting to Salesforce...');

    const connected = await API.connect();

    if (!connected) {
      _initRetries++;
      if (_initRetries <= MAX_INIT_RETRIES) {
        console.debug(`[SFDT] Could not obtain session. Retry ${_initRetries}/${MAX_INIT_RETRIES} in 5s...`);
        setTimeout(init, 5000);
      } else {
        console.debug('[SFDT] Could not obtain session after retries. Extension inactive on this page.');
      }
      return;
    }

    console.log('[SFDT] Connected to Salesforce.');
    console.log('[SFDT] Instance:', API.getInstanceUrl());

    // Start background indexing
    console.log('[SFDT] Starting metadata index build...');
    META.buildIndex().then(() => {
      const idx = META.getIndex();
      const count = Object.values(idx).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      console.log('[SFDT] Metadata index built. Total items:', count, 'Categories:', Object.keys(idx).join(', '));
    }).catch(err => {
      console.debug('[SFDT] Index build error:', err);
    });

    // Add floating toolbar
    _createToolbar();
  }

  // ─── Keyboard Shortcut Handler ────────────────────────

  function _handleKeyboard(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
      e.preventDefault(); e.stopPropagation();
      PALETTE.toggle();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'X') {
      e.preventDefault(); e.stopPropagation();
      INSPECTOR.toggle();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Q') {
      e.preventDefault(); e.stopPropagation();
      SOQL.toggle();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G') {
      e.preventDefault(); e.stopPropagation();
      NAVIGATOR.toggle();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault(); e.stopPropagation();
      DEBUGLOG.toggle();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault(); e.stopPropagation();
      EXECANON.toggle();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      let closed = false;
      if (PALETTE.isVisible()) { PALETTE.hide(); closed = true; }
      if (NAVIGATOR.isVisible()) { NAVIGATOR.hide(); closed = true; }
      if (SOQL.isVisible()) { SOQL.hide(); closed = true; }
      if (INSPECTOR.isVisible()) { INSPECTOR.hide(); closed = true; }
      if (DEBUGLOG.isVisible()) { DEBUGLOG.hide(); closed = true; }
      if (EXECANON.isVisible()) { EXECANON.hide(); closed = true; }
      // Also collapse the toolbar
      const toolbarContainer = SHADOW.getOrCreate('toolbar').container;
      const toolbar = toolbarContainer.querySelector('#sfdt-toolbar');
      if (toolbar && toolbar.classList.contains('expanded')) {
        toolbar.classList.remove('expanded');
        closed = true;
      }
      if (closed) return;
    }
  }

  // ─── Context Menu Record Detection ────────────────────

  function _hasRecordOnPage() {
    const url = window.location.href;
    // Lightning record page: /lightning/r/ObjectName/001xxxxxxxxxxxx/view
    if (/\/lightning\/r\/\w+\/[a-zA-Z0-9]{15,18}(?:\/|$|#|\?)/.test(url)) return true;
    // Classic record page: /001xxxxxxxxxxxx
    if (/\/[a-zA-Z0-9]{15,18}(?:\?|$|#)/.test(url)) {
      const match = url.match(/\/([a-zA-Z0-9]{15,18})(?:\?|$|#)/);
      if (match) {
        const id = match[1];
        // Salesforce IDs start with a 3-char key prefix; filter out setup paths
        if (/^[a-zA-Z0-9]{3}[0-9A-Za-z]{12,15}$/.test(id)) return true;
      }
    }
    return false;
  }

  function _updateContextMenu() {
    try {
      chrome.runtime.sendMessage({ action: 'update-context-menu', hasRecord: _hasRecordOnPage() });
    } catch { /* Extension context may be invalidated */ }
  }

  // ─── Click Outside to Close Panels ────────────────────

  function _handleOutsideClick(e) {
    // If the click is inside any SFDT shadow host, ignore it
    const target = e.target;
    if (target && target.id && target.id.startsWith('sfdt-host-')) return;
    if (target && target.closest && target.closest('[id^="sfdt-host-"]')) return;

    // Close any visible side panels (not modals — they have their own backdrops)
    if (INSPECTOR.isVisible()) INSPECTOR.hide();
    if (SOQL.isVisible()) SOQL.hide();
    if (DEBUGLOG.isVisible()) DEBUGLOG.hide();
    if (EXECANON.isVisible()) EXECANON.hide();
  }

  // ─── Message Handler (from background/popup) ─────────

  function _handleMessage(message) {
    console.log('[SFDT] Received message:', message.action);
    switch (message.action) {
      case 'open-search-palette': PALETTE.show(); break;
      case 'open-inspector': INSPECTOR.show(); break;
      case 'open-soql': SOQL.show(); break;
      case 'open-navigator': NAVIGATOR.show(); break;
      case 'open-debuglog': DEBUGLOG.show(); break;
      case 'open-execanon': EXECANON.show(); break;
      case 'cache-invalidated':
        META.invalidateCache();
        META.buildIndex();
        break;
      case 'tab-activated':
        if (!API.isConnected()) init();
        break;
    }
  }

  // ─── Floating Toolbar ─────────────────────────────────

  function _createToolbar() {
    const { container } = SHADOW.getOrCreate('toolbar');

    // Prevent re-creating
    if (container.querySelector('.sfdt-toolbar')) return;

    container.innerHTML = `
      <div class="sfdt-toolbar" id="sfdt-toolbar">
        <div class="sfdt-toolbar-toggle" title="SF Dev Toolkit">
          ${ICONS.bolt}
        </div>
        <div class="sfdt-toolbar-buttons">
          <button class="sfdt-toolbar-btn" data-action="search" title="Global Search (Ctrl+Shift+P)">
            ${ICONS.search}
            <span class="sfdt-toolbar-label">Search</span>
          </button>
          <button class="sfdt-toolbar-btn" data-action="inspector" title="Record Inspector (Ctrl+Shift+X)">
            ${ICONS.eye}
            <span class="sfdt-toolbar-label">Inspect</span>
          </button>
          <button class="sfdt-toolbar-btn" data-action="soql" title="SOQL Query (Ctrl+Shift+Q)">
            ${ICONS.database}
            <span class="sfdt-toolbar-label">SOQL</span>
          </button>
          <button class="sfdt-toolbar-btn" data-action="navigator" title="Navigator (Ctrl+Shift+G)">
            ${ICONS.compass}
            <span class="sfdt-toolbar-label">Navigate</span>
          </button>
          <button class="sfdt-toolbar-btn" data-action="debuglog" title="Debug Logs (Ctrl+Shift+D)">
            ${ICONS.terminal}
            <span class="sfdt-toolbar-label">Logs</span>
          </button>
          <button class="sfdt-toolbar-btn" data-action="execanon" title="Execute Anonymous (Ctrl+Shift+E)">
            ${ICONS.code}
            <span class="sfdt-toolbar-label">Execute</span>
          </button>
          <button class="sfdt-toolbar-btn sfdt-toolbar-btn-secondary" data-action="refresh-cache" title="Refresh Cache">
            ${ICONS.refresh}
          </button>
        </div>
      </div>
    `;

    const toolbar = container.querySelector('#sfdt-toolbar');
    toolbar.querySelector('.sfdt-toolbar-toggle').addEventListener('click', () => {
      toolbar.classList.toggle('expanded');
    });

    // Click outside toolbar to collapse it
    document.addEventListener('click', (e) => {
      if (!toolbar.classList.contains('expanded')) return;
      // Check if click is inside the toolbar shadow host
      const host = container.getRootNode().host;
      if (host && host.contains(e.target)) return;
      toolbar.classList.remove('expanded');
    }, true);

    toolbar.querySelectorAll('.sfdt-toolbar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toolbar.classList.remove('expanded');
        switch (btn.dataset.action) {
          case 'search': PALETTE.toggle(); break;
          case 'inspector': INSPECTOR.toggle(); break;
          case 'soql': SOQL.toggle(); break;
          case 'navigator': NAVIGATOR.toggle(); break;
          case 'debuglog': DEBUGLOG.toggle(); break;
          case 'execanon': EXECANON.toggle(); break;
          case 'refresh-cache':
            META.invalidateCache();
            META.buildIndex();
            break;
        }
      });
    });
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
