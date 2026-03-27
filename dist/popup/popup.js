/**
 * Popup Script - Handles the extension popup UI interactions.
 */
(function () {
  'use strict';

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const mod = isMac ? 'Cmd' : 'Ctrl';

  // Update shortcut labels for platform
  document.querySelectorAll('.btn-shortcut').forEach(el => {
    el.textContent = el.textContent.replace('Ctrl', mod);
  });

  // Check if current tab is Salesforce
  async function checkTab() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get-tab-info' });

      if (!response || !response.isSalesforce) {
        document.getElementById('popup-content').style.display = 'none';
        document.getElementById('popup-not-sf').style.display = 'block';
        return;
      }

      const dot = document.getElementById('popup-dot');
      const statusText = document.getElementById('popup-status-text');
      dot.classList.add('connected');
      statusText.textContent = 'Connected to Salesforce';

      // Show instance info
      if (response.url) {
        try {
          const url = new URL(response.url);
          document.getElementById('popup-instance').textContent = url.hostname;
        } catch { /* ignore */ }
      }
    } catch {
      document.getElementById('popup-status-text').textContent = 'Unable to connect';
    }
  }

  // Send command to content script
  async function sendCommand(action) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action });
        window.close();
      } catch (err) {
        console.debug('[SFDT] Could not reach content script:', err.message);
        // Content script not loaded — try injecting it first
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'utils/cacheManager.js',
              'utils/salesforceApi.js',
              'utils/icons.js',
              'utils/shadowDomHelper.js',
              'services/metadataService.js',
              'services/searchService.js',
              'services/queryService.js',
              'components/searchPalette.js',
              'components/inspectorPanel.js',
              'components/navigatorPanel.js',
              'components/soqlPanel.js',
              'content/salesforceContentScript.js'
            ]
          });
          // Retry after injection
          setTimeout(async () => {
            await chrome.tabs.sendMessage(tab.id, { action });
            window.close();
          }, 500);
        } catch (injectErr) {
          console.debug('[SFDT] Script injection failed:', injectErr);
        }
      }
    }
  }

  // Button handlers
  document.getElementById('btn-search').addEventListener('click', () => {
    sendCommand('open-search-palette');
  });

  document.getElementById('btn-inspector').addEventListener('click', () => {
    sendCommand('open-inspector');
  });

  document.getElementById('btn-soql').addEventListener('click', () => {
    sendCommand('open-soql');
  });

  document.getElementById('btn-navigator').addEventListener('click', () => {
    sendCommand('open-navigator');
  });

  document.getElementById('btn-refresh-cache').addEventListener('click', () => {
    sendCommand('cache-invalidated');
    const btn = document.getElementById('btn-refresh-cache');
    btn.querySelector('.btn-label').textContent = 'Refreshing...';
    setTimeout(() => {
      btn.querySelector('.btn-label').textContent = 'Refresh Metadata Cache';
    }, 2000);
  });

  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'cache-invalidated' });
    }
    const btn = document.getElementById('btn-clear-cache');
    btn.querySelector('.btn-label').textContent = 'Cache cleared!';
    setTimeout(() => {
      btn.querySelector('.btn-label').textContent = 'Clear All Cache';
    }, 2000);
  });

  // Version
  const manifest = chrome.runtime.getManifest();
  document.getElementById('popup-version').textContent = `v${manifest.version}`;

  // Custom Search Objects — load saved list
  const customObjInput = document.getElementById('custom-objects-input');
  const saveBtn = document.getElementById('btn-save-objects');
  const saveStatus = document.getElementById('save-status');

  chrome.storage.sync.get('sfdt_custom_search_objects', (data) => {
    if (data.sfdt_custom_search_objects) {
      customObjInput.value = data.sfdt_custom_search_objects;
    }
  });

  saveBtn.addEventListener('click', () => {
    const value = customObjInput.value.trim();
    chrome.storage.sync.set({ sfdt_custom_search_objects: value }, () => {
      saveStatus.style.opacity = '1';
      setTimeout(() => { saveStatus.style.opacity = '0'; }, 2000);
    });
  });

  // Initialize
  checkTab();
})();
