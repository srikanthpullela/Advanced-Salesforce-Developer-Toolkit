/**
 * Shortcut Relay - runs in Salesforce sub-frames only.
 *
 * The main content script (and all of the toolkit UI) is injected into the top
 * frame only. Salesforce embeds a lot of content in iframes — Classic Setup
 * inside Lightning, Visualforce pages on record pages, list view frames — so
 * whenever focus sits inside one of those frames the toolkit shortcuts never
 * reach the top document and appear dead. This tiny script forwards them.
 */
(function () {
  'use strict';

  // Top frame already has the real handler.
  if (window.top === window) return;
  if (window._sfdtRelayInstalled) return;
  window._sfdtRelayInstalled = true;

  const SHORTCUTS = [
    { code: 'KeyP', key: 'P', command: 'open-search-palette' },
    { code: 'KeyX', key: 'X', command: 'open-inspector' },
    { code: 'KeyL', key: 'L', command: 'open-soql' },
    { code: 'KeyY', key: 'Y', command: 'open-navigator' },
    { code: 'KeyK', key: 'K', command: 'open-debuglog' },
    { code: 'KeyE', key: 'E', command: 'open-execanon' }
  ];

  function _match(e) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return null;
    const key = e.key ? e.key.toUpperCase() : '';
    return SHORTCUTS.find(s => e.code === s.code || key === s.key) || null;
  }

  window.addEventListener('keydown', (e) => {
    if (!e.key && !e.code) return;
    const shortcut = _match(e);
    if (!shortcut) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      chrome.runtime.sendMessage({
        action: 'relay-shortcut',
        command: shortcut.command
      });
    } catch { /* Extension context invalidated — page reload required */ }
  }, true);
})();
