/**
 * SearchPalette - VSCode-style command palette for Global Salesforce Search.
 * Uses Shadow DOM for CSS isolation from Salesforce.
 */
const SearchPalette = (() => {
  const SEARCH = () => window.SFDTSearchService;
  const META = () => window.SFDTMetadataService;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _input = null;
  let _resultsList = null;
  let _statusBar = null;
  let _searchingBanner = null;
  let _visible = false;
  let _selectedIndex = 0;
  let _currentResults = [];
  let _debounceTimer = null;
  let _codeSearchTimer = null;
  let _codeSearchAbortId = 0;
  let _deepCodeSearchAbortId = 0;
  let _deepCodeSearchRunning = false;
  let _recordSearchTimer = null;
  let _recordSearchAbortId = 0;
  let _fieldSearchTimer = null;
  let _fieldSearchAbortId = 0;
  let _dynamicSearchAbortId = 0;
  let _dynamicSearchRunning = false;
  let _activeFilter = null;
  let _pendingSearches = new Set();
  let _searchHistory = [];
  let _deepSearchEnabled = false;
  let _lastSearchQuery = null;
  let _autoSearchEnabled = false;
  let _autoSearchTimer = null;

  const HISTORY_KEY = 'sfdt_search_history';
  const AUTO_SEARCH_KEY = 'sfdt_auto_search';
  const AUTO_SEARCH_DEBOUNCE = 500;
  const MAX_HISTORY = 30;

  const TYPE_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'Record', label: 'Records' },
    { key: 'ApexClass', label: 'Apex' },
    { key: 'ApexTrigger', label: 'Triggers' },
    { key: 'LWC', label: 'LWC' },
    { key: 'AuraComponent', label: 'Aura' },
    { key: 'Flow', label: 'Flows' },
    { key: 'ValidationRule', label: 'Rules' },
    { key: 'CustomObject', label: 'Objects' },
    { key: 'Field', label: 'Fields' },
    { key: 'VisualforcePage', label: 'VF Pages' },
    { key: 'Report', label: 'Reports' },
    { key: 'Tab', label: 'Tabs' },
    { key: 'CustomSetting', label: 'Settings' },
    { key: 'StaticResource', label: 'Resources' },
    { key: 'Attribute', label: 'Attributes' },
    { key: 'SetupPage', label: 'Setup' }
  ];

  function _create() {
    if (_container) return;

    const { container } = SHADOW().getOrCreate('search');
    _container = container;

    _container.innerHTML = `
      <div class="sfdt-palette" id="sfdt-search-palette">
        <div class="sfdt-backdrop"></div>
        <div class="sfdt-dialog">
          <div class="sfdt-header">
            <span class="sfdt-header-icon">${ICONS().search}</span>
            <input type="text" class="sfdt-input" placeholder="Search records, metadata, code, fields..." autocomplete="off" spellcheck="false" />
            <button class="sfdt-search-btn" id="sfdt-search-btn" title="Search">${ICONS().sparkle || ICONS().search}<span class="sfdt-btn-label">Search</span></button>
            <button class="sfdt-search-btn sfdt-deep-search-btn" id="sfdt-deep-search-btn" title="Deep Search — code, fields & all objects">${ICONS().search}<span class="sfdt-btn-label">Deep</span></button>
            <label class="sfdt-auto-toggle" title="Auto Search — automatically search as you type">
              <input type="checkbox" id="sfdt-auto-search-toggle" />
              <span class="sfdt-toggle-slider"></span>
              <span class="sfdt-toggle-label">Auto</span>
            </label>
            <span class="sfdt-shortcut">ESC</span>
          </div>
          <div class="sfdt-filters"></div>
          <div class="sfdt-searching-banner" id="sfdt-searching-banner" style="display:none">
            <span class="sfdt-spinner"></span>
            <span class="sfdt-searching-text">Searching...</span>
          </div>
          <div class="sfdt-results"></div>
          <div class="sfdt-deep-search-slot" id="sfdt-deep-search-slot"></div>
          <div class="sfdt-status-bar">
            <span class="sfdt-status-text">Type and press Enter to search</span>
            <span class="sfdt-status-hint">Enter to search · Shift+Enter for new tab</span>
            <span class="sfdt-status-meta"></span>
            <button class="sfdt-btn sfdt-btn-sm" id="sfdt-rebuild-index" style="margin-left:auto">${ICONS().refresh} Rebuild Index</button>
          </div>
        </div>
      </div>
    `;

    const palette = _container.querySelector('#sfdt-search-palette');
    _input = _container.querySelector('.sfdt-input');
    _resultsList = _container.querySelector('.sfdt-results');
    _statusBar = _container.querySelector('.sfdt-status-text');
    const metaStatus = _container.querySelector('.sfdt-status-meta');
    _searchingBanner = _container.querySelector('#sfdt-searching-banner');

    // Build filter chips
    const filtersContainer = _container.querySelector('.sfdt-filters');
    TYPE_FILTERS.forEach(f => {
      const chip = document.createElement('button');
      chip.className = 'sfdt-chip' + (f.key === 'all' ? ' active' : '');
      chip.dataset.filter = f.key;
      chip.textContent = f.label;
      chip.addEventListener('click', () => _setFilter(f.key));
      filtersContainer.appendChild(chip);
    });

    _container.querySelector('.sfdt-backdrop').addEventListener('click', hide);
    _input.addEventListener('input', _onInput);
    _input.addEventListener('keydown', _onKeyDown);

    _container.querySelector('#sfdt-search-btn').addEventListener('click', () => {
      const btn = _container.querySelector('#sfdt-search-btn');
      if (btn && btn.disabled) return;
      if (_input.value.trim()) _performSearch(_input.value);
    });

    _container.querySelector('#sfdt-deep-search-btn').addEventListener('click', () => {
      const btn = _container.querySelector('#sfdt-deep-search-btn');
      if (btn && btn.disabled) return;
      const query = _input.value.trim();
      if (query && query.length >= 2) {
        _performSearch(query);
        _triggerDeepSearch(query);
      }
    });

    _container.querySelector('#sfdt-rebuild-index').addEventListener('click', _rebuildIndex);

    // Auto Search toggle
    const autoToggle = _container.querySelector('#sfdt-auto-search-toggle');
    try { _autoSearchEnabled = localStorage.getItem(AUTO_SEARCH_KEY) === '1'; } catch { /* ignore */ }
    if (autoToggle) {
      autoToggle.checked = _autoSearchEnabled;
      _updateAutoSearchUI();
      autoToggle.addEventListener('change', () => {
        _autoSearchEnabled = autoToggle.checked;
        try { localStorage.setItem(AUTO_SEARCH_KEY, _autoSearchEnabled ? '1' : '0'); } catch { /* ignore */ }
        _updateAutoSearchUI();
        if (_autoSearchEnabled && _input.value.trim().length >= 2) {
          _performSearch(_input.value);
          _triggerDeepSearch(_input.value.trim());
        }
      });
    }

    _loadHistory();

    if (!META().isReady()) {
      metaStatus.textContent = 'Indexing...';
      META().onIndexReady(() => {
        const idx = META().getIndex();
        const count = Object.values(idx).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
        metaStatus.textContent = `${count} items indexed`;
        setTimeout(() => { metaStatus.textContent = `${count} items`; }, 3000);
      });
    } else {
      const idx = META().getIndex();
      const count = Object.values(idx).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      metaStatus.textContent = count > 0 ? `${count} items` : 'Indexing...';
    }
  }

  async function _rebuildIndex() {
    const API = window.SalesforceAPI;
    const metaStatus = _container.querySelector('.sfdt-status-meta');
    metaStatus.textContent = 'Rebuilding...';
    _statusBar.textContent = 'Clearing cache and reconnecting...';

    // Re-establish session first
    META().invalidateCache();
    try {
      const connected = await API.connect();
      if (!connected) {
        _statusBar.textContent = 'Session failed — please refresh the Salesforce page and try again.';
        metaStatus.textContent = 'No session';
        return;
      }
      _statusBar.textContent = 'Connected. Building index...';
      await META().buildIndex();
      const idx = META().getIndex();
      const count = Object.values(idx).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      metaStatus.textContent = `${count} items`;
      _statusBar.textContent = `Index rebuilt: ${count} items across ${Object.keys(idx).length} categories`;
      if (_input.value.trim()) _performSearch(_input.value);
    } catch (err) {
      _statusBar.textContent = `Index rebuild failed: ${err.message}`;
      metaStatus.textContent = 'Error';
    }
  }

  function _setSearchBtnEnabled(enabled) {
    const btn = _container ? _container.querySelector('#sfdt-search-btn') : null;
    if (btn) {
      btn.disabled = !enabled;
      btn.classList.toggle('disabled', !enabled);
    }
    const deepBtn = _container ? _container.querySelector('#sfdt-deep-search-btn') : null;
    if (deepBtn) {
      deepBtn.disabled = !enabled;
      deepBtn.classList.toggle('disabled', !enabled);
    }
  }

  function _updateAutoSearchUI() {
    if (!_container) return;
    const searchBtn = _container.querySelector('#sfdt-search-btn');
    const deepBtn = _container.querySelector('#sfdt-deep-search-btn');
    if (searchBtn) searchBtn.classList.toggle('sfdt-auto-hidden', _autoSearchEnabled);
    if (deepBtn) deepBtn.classList.toggle('sfdt-auto-hidden', _autoSearchEnabled);
  }

  function _setFilter(key) {
    _activeFilter = key === 'all' ? null : key;
    _container.querySelectorAll('.sfdt-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.filter === key)
    );
    // Re-run search with new filter if we already searched
    if (_lastSearchQuery) {
      _performSearch(_lastSearchQuery);
    }
  }

  function _onInput() {
    // Cancel all pending server-side searches
    clearTimeout(_debounceTimer);
    clearTimeout(_codeSearchTimer);
    clearTimeout(_recordSearchTimer);
    clearTimeout(_fieldSearchTimer);
    clearTimeout(_autoSearchTimer);
    _dynamicSearchAbortId++;
    _dynamicSearchRunning = false;
    _deepCodeSearchAbortId++;
    _deepCodeSearchRunning = false;
    _deepSearchEnabled = false;
    _lastSearchQuery = null;
    _pendingSearches.clear();
    _updateSearchingBanner();
    _removeBottomLoader();
    _removeDeepSearchBar();

    const query = _input.value.trim();
    if (!query) {
      clearTimeout(_autoSearchTimer);
      _currentResults = [];
      _showSearchHistory();
      _statusBar.textContent = _searchHistory.length > 0
        ? `${_searchHistory.length} recent searches`
        : _autoSearchEnabled ? 'Type to auto search' : 'Type and press Enter to search';
      _setSearchBtnEnabled(false);
      return;
    }

    // ─── Auto Search mode ───
    if (_autoSearchEnabled) {
      clearTimeout(_autoSearchTimer);
      if (query.length >= 2) {
        _statusBar.textContent = 'Searching...';
        _autoSearchTimer = setTimeout(() => {
          _performSearch(query);
          _triggerDeepSearch(query);
        }, AUTO_SEARCH_DEBOUNCE);
      } else {
        _statusBar.textContent = 'Type at least 2 characters...';
      }
      return;
    }

    // ─── Manual Search mode ───
    // Show typing hint — no API calls while typing
    _currentResults = [];
    _setSearchBtnEnabled(true);
    _resultsList.innerHTML = `
      <div class="sfdt-enter-prompt">
        <div class="sfdt-enter-prompt-text">
          <span class="sfdt-enter-prompt-icon">${ICONS().search}</span>
          Press <kbd>Enter</kbd> to search
        </div>
        <button class="sfdt-enter-prompt-btn" id="sfdt-enter-search-btn">
          ${ICONS().search} Search
        </button>
      </div>
    `;
    // Attach click handler to the search button
    const searchBtn = _resultsList.querySelector('#sfdt-enter-search-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        if (_input.value.trim()) _performSearch(_input.value);
      });
    }
    _statusBar.textContent = 'Press Enter to search';
  }

  function _performSearch(query) {
    if (!query || query.trim().length === 0) {
      _currentResults = [];
      _pendingSearches.clear();
      _updateSearchingBanner();
      _showSearchHistory();
      _statusBar.textContent = _searchHistory.length > 0
        ? `${_searchHistory.length} recent searches`
        : 'Type and press Enter to search';
      return;
    }

    _lastSearchQuery = query;
    _setSearchBtnEnabled(false);

    // Check if index is ready
    if (!META().isReady()) {
      _currentResults = [];
      _resultsList.innerHTML = '<div class="sfdt-empty" style="color:#f9e2af">Metadata index is still loading...<br><span style="font-size:11px;color:#a6adc8">Please wait a few seconds and try again, or click Rebuild Index.</span></div>';
      _statusBar.textContent = 'Indexing metadata...';
      META().onIndexReady(() => {
        if (_visible && _input && _input.value.trim().length > 0) {
          _performSearch(_input.value);
        }
      });
      return;
    }

    // Check if index is ready but empty
    const idx = META().getIndex();
    const itemCount = Object.values(idx).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
    if (itemCount === 0) {
      _currentResults = [];
      _resultsList.innerHTML = '<div class="sfdt-empty" style="color:#f9e2af">Metadata index is empty.<br><span style="font-size:11px;color:#a6adc8">This usually means the Salesforce session expired or API access is restricted.<br>Try clicking <strong>Rebuild Index</strong> below, or refresh the Salesforce page.</span></div>';
      _statusBar.textContent = 'Index empty — click Rebuild Index';
      return;
    }

    const start = performance.now();
    const options = { maxResults: 50 };
    if (_activeFilter && _activeFilter !== 'Record' && _activeFilter !== 'Field') options.typeFilter = _activeFilter;

    // If filtering to Records only, skip metadata and just do record search
    if (_activeFilter === 'Record') {
      _currentResults = [];
      _selectedIndex = 0;
      _pendingSearches.clear();
      _pendingSearches.add('record');
      _renderResults([]);
      _updateSearchingBanner();
      _statusBar.textContent = 'Searching records...';

      clearTimeout(_recordSearchTimer);
      _recordSearchAbortId++;
      const currentRecordAbortId = _recordSearchAbortId;
      _recordSearchTimer = setTimeout(() => _performRecordSearch(query.trim(), currentRecordAbortId), 50);
      return;
    }

    // If filtering to Fields only, skip metadata and just do field search
    if (_activeFilter === 'Field') {
      _currentResults = [];
      _selectedIndex = 0;
      _pendingSearches.clear();
      _pendingSearches.add('field');
      _renderResults([]);
      _updateSearchingBanner();
      _statusBar.textContent = 'Searching fields...';

      clearTimeout(_fieldSearchTimer);
      _fieldSearchAbortId++;
      const currentFieldAbortId = _fieldSearchAbortId;
      _fieldSearchTimer = setTimeout(() => _performFieldSearch(query.trim(), currentFieldAbortId), 50);
      return;
    }

    // ─── Regular Search (Enter key) ───
    // 1. Instant local index search (0 API calls)
    const results = SEARCH().searchAll(query, options);
    const elapsed = Math.round(performance.now() - start);

    _currentResults = results;
    _selectedIndex = 0;
    _deepSearchEnabled = false;
    _removeDeepSearchBar();

    // 2. SOSL record search (~2-5 API calls) — the only server call in regular search
    _pendingSearches.clear();
    if (query.trim().length >= 2) {
      _pendingSearches.add('record');
    }

    _renderResults(results);
    _updateSearchingBanner();

    const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
    _statusBar.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} (${elapsed}ms)${filterNote}`;

    // Fire only SOSL record search — no code, field, or dynamic searches
    if (query.trim().length >= 2) {
      clearTimeout(_recordSearchTimer);
      _recordSearchAbortId++;
      const currentRecordAbortId = _recordSearchAbortId;
      _recordSearchTimer = setTimeout(() => _performRecordSearch(query.trim(), currentRecordAbortId), 50);
      if (results.length === 0) {
        _statusBar.textContent = `Searching records...${filterNote}`;
      } else {
        _statusBar.textContent += ' · searching records...';
      }
    } else {
      // No async search needed — re-enable search button immediately
      _setSearchBtnEnabled(true);
    }

    // Show deep search bar in the fixed slot
    _appendDeepSearchBar(query.trim());
  }

  async function _performCodeSearch(query, abortId) {
    try {
      const options = {};
      if (_activeFilter) options.typeFilter = _activeFilter;

      const codeResults = await SEARCH().searchCode(query, options);

      // Abort if user has typed something new
      if (abortId !== _codeSearchAbortId || !_visible) return;
      if (!_input || _input.value.trim() !== query) return;

      _pendingSearches.delete('code');
      _updateSearchingBanner();

      if (codeResults.length === 0) {
        // No code results — update status and check if all async searches are done
        const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
        _statusBar.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${filterNote}`;
        if (_currentResults.length === 0 && _pendingSearches.size === 0) _renderResults([]);
      } else {
        // Merge code results with existing name results (deduplicate by id)
        const existingIds = new Set(_currentResults.map(r => r.id));
        const newCodeResults = codeResults.filter(r => !existingIds.has(r.id));

        if (newCodeResults.length > 0) {
          // Add code label to distinguish
          for (const r of newCodeResults) {
            r.codeMatches = [{ line: 0, text: `Contains "${query}"` }];
          }
          _currentResults = [..._currentResults, ...newCodeResults];
          _currentResults.sort((a, b) => b.score - a.score);
          _renderResults(_currentResults);
        }

        const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
        const codeNote = newCodeResults.length > 0 ? ` + ${newCodeResults.length} code` : '';
        _statusBar.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${codeNote}${filterNote}`;
      }

      // Fire deep code body search only if deep search is enabled
      if (query.length >= 4 && SEARCH().searchCodeDeep && _deepSearchEnabled) {
        _performDeepCodeSearch(query);
      }
    } catch (e) {
      console.debug('[SFDT] Code search error:', e.message);
      _pendingSearches.delete('code');
      _updateSearchingBanner();
      if (_currentResults.length === 0 && _pendingSearches.size === 0) _renderResults([]);
    }
  }

  function _performDeepCodeSearch(query) {
    _deepCodeSearchAbortId++;
    const myAbortId = _deepCodeSearchAbortId;
    _deepCodeSearchRunning = true;
    _appendBottomLoader();

    SEARCH().searchCodeDeep(
      query,
      // onBatchResults callback — append new results as they arrive
      (newResults) => {
        if (myAbortId !== _deepCodeSearchAbortId || !_visible) return;
        if (!_input || _input.value.trim() !== query) return;

        const existingIds = new Set(_currentResults.map(r => r.id));
        const fresh = newResults.filter(r => !existingIds.has(r.id));
        if (fresh.length > 0) {
          for (const r of fresh) {
            r.codeMatches = [{ line: 0, text: `Body contains "${query}"` }];
          }
          _currentResults = [..._currentResults, ...fresh];
          _currentResults.sort((a, b) => b.score - a.score);
          _renderResults(_currentResults);
          if (_deepCodeSearchRunning) _appendBottomLoader();

          const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
          _statusBar.textContent = `${_currentResults.length} results${filterNote}`;
        }
      },
      // shouldAbort callback
      () => myAbortId !== _deepCodeSearchAbortId || !_visible
    ).then(() => {
      if (myAbortId !== _deepCodeSearchAbortId) return;
      _deepCodeSearchRunning = false;
      _removeBottomLoader();
      _updateSearchingBanner();
      const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
      _statusBar.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${filterNote}`;
    }).catch(() => {
      _deepCodeSearchRunning = false;
      _removeBottomLoader();
      _updateSearchingBanner();
    });
  }

  async function _performRecordSearch(query, abortId) {
    try {
      const recordResults = await SEARCH().searchRecords(query);

      // Abort if user has typed something new
      if (abortId !== _recordSearchAbortId || !_visible) return;
      if (!_input || _input.value.trim() !== query) return;

      _pendingSearches.delete('record');
      _updateSearchingBanner();

      if (recordResults.length === 0) {
        const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
        if (!_statusBar.textContent.includes('code')) {
          _statusBar.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${filterNote}`;
        }
        if (_currentResults.length === 0 && _pendingSearches.size === 0) _renderResults([]);
      } else {
        // Merge record results (deduplicate by id)
        const existingIds = new Set(_currentResults.map(r => r.id));
        const newRecordResults = recordResults.filter(r => !existingIds.has(r.id));

        if (newRecordResults.length > 0) {
          _currentResults = [..._currentResults, ...newRecordResults];
          _currentResults.sort((a, b) => b.score - a.score);
          _renderResults(_currentResults);
        }

        const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
        const recordNote = newRecordResults.length > 0 ? ` + ${newRecordResults.length} records` : '';
        const total = _currentResults.length;
        _statusBar.textContent = `${total} result${total !== 1 ? 's' : ''}${recordNote}${filterNote}`;
      }

      // Fire background dynamic SOQL search only if deep search is enabled
      if (query.length >= 3 && SEARCH().searchRecordsDynamic && _deepSearchEnabled) {
        _performDynamicSearch(query);
      }

      // Re-enable search button after regular search completes
      if (!_deepSearchEnabled) _setSearchBtnEnabled(true);
    } catch (e) {
      console.debug('[SFDT] Record search error:', e.message);
      _pendingSearches.delete('record');
      _updateSearchingBanner();
      _setSearchBtnEnabled(true);
      if (_currentResults.length === 0 && _pendingSearches.size === 0) _renderResults([]);
    }
  }

  function _performDynamicSearch(query) {
    _dynamicSearchAbortId++;
    const myAbortId = _dynamicSearchAbortId;
    _dynamicSearchRunning = true;
    _appendBottomLoader();

    SEARCH().searchRecordsDynamic(
      query,
      // onBatchResults callback — append new results as they arrive
      (newResults) => {
        if (myAbortId !== _dynamicSearchAbortId || !_visible) return;
        if (!_input || _input.value.trim() !== query) return;

        const existingIds = new Set(_currentResults.map(r => r.id));
        const fresh = newResults.filter(r => !existingIds.has(r.id));
        if (fresh.length > 0) {
          _currentResults = [..._currentResults, ...fresh];
          _currentResults.sort((a, b) => b.score - a.score);
          _renderResults(_currentResults);
          if (_dynamicSearchRunning) _appendBottomLoader();

          const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
          _statusBar.textContent = `${_currentResults.length} results${filterNote}`;
        }
      },
      // shouldAbort callback
      () => myAbortId !== _dynamicSearchAbortId || !_visible
    ).then(() => {
      if (myAbortId !== _dynamicSearchAbortId) return;
      _dynamicSearchRunning = false;
      _removeBottomLoader();
      _updateSearchingBanner();
      const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
      _statusBar.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${filterNote}`;
    }).catch(() => {
      _dynamicSearchRunning = false;
      _removeBottomLoader();
      _updateSearchingBanner();
    });
  }

  function _appendBottomLoader() {
    if (_deepSearchEnabled) return;
    _removeBottomLoader();
    if (!_resultsList) return;
    const loader = document.createElement('div');
    loader.className = 'sfdt-dynamic-loader';
    loader.innerHTML = '<span class="sfdt-spinner"></span> Searching more objects...';
    _resultsList.appendChild(loader);
  }

  function _removeBottomLoader() {
    if (!_resultsList) return;
    const existing = _resultsList.querySelector('.sfdt-dynamic-loader');
    if (existing) existing.remove();
  }

  // ─── Deep Search Bar ──────────────────────────────────
  // Shows a clickable bar below results to trigger expensive code/field/dynamic searches

  function _appendDeepSearchBar(query) {
    _removeDeepSearchBar();
    const slot = _container ? _container.querySelector('#sfdt-deep-search-slot') : null;
    if (!slot || !query || query.length < 2) return;

    const bar = document.createElement('div');
    bar.className = 'sfdt-deep-search-bar';
    bar.innerHTML = `
      <span class="sfdt-deep-search-icon">${ICONS().sparkle || ICONS().search}</span>
      <span class="sfdt-deep-search-text">Deep Search</span>
      <span class="sfdt-deep-search-hint">Search inside Apex classes, VF pages, fields, and all objects</span>
      <span class="sfdt-deep-search-arrow">→</span>
    `;
    bar.addEventListener('click', () => {
      console.log('[SFDT] Deep search bar clicked, query:', query);
      _triggerDeepSearch(query);
    });
    slot.appendChild(bar);
    console.log('[SFDT] Deep search bar appended to slot');
  }

  function _removeDeepSearchBar() {
    const slot = _container ? _container.querySelector('#sfdt-deep-search-slot') : null;
    if (!slot) return;
    slot.innerHTML = '';
  }

  function _triggerDeepSearch(query) {
    if (!query || query.length < 2) return;
    console.log('[SFDT] Deep search triggered for:', query);
    _deepSearchEnabled = true;
    _setSearchBtnEnabled(false);
    _removeDeepSearchBar();

    const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';

    // Show deep search in-progress indicator in the fixed slot
    const slot = _container ? _container.querySelector('#sfdt-deep-search-slot') : null;
    if (slot) {
      const bar = document.createElement('div');
      bar.className = 'sfdt-deep-search-bar sfdt-deep-search-active';
      bar.innerHTML = `<span class="sfdt-spinner"></span> <span class="sfdt-deep-search-text">Deep searching code, fields & objects...</span>`;
      slot.appendChild(bar);
    }

    // Track deep search pending items
    if (query.length >= 4) _pendingSearches.add('code');
    if (query.length >= 3) _pendingSearches.add('field');
    _updateSearchingBanner();

    // Fire code SOSL search (Tooling API)
    if (query.length >= 4) {
      console.log('[SFDT] Deep: firing code search for:', query);
      clearTimeout(_codeSearchTimer);
      _codeSearchAbortId++;
      const currentAbortId = _codeSearchAbortId;
      _codeSearchTimer = setTimeout(() => _performCodeSearch(query, currentAbortId), 50);
    }

    // Fire field search (EntityParticle)
    if (query.length >= 3) {
      console.log('[SFDT] Deep: firing field search for:', query);
      clearTimeout(_fieldSearchTimer);
      _fieldSearchAbortId++;
      const currentFieldAbortId = _fieldSearchAbortId;
      _fieldSearchTimer = setTimeout(() => _performFieldSearch(query, currentFieldAbortId), 50);
    }

    // Fire dynamic record search across all custom objects
    if (query.length >= 3 && SEARCH().searchRecordsDynamic) {
      console.log('[SFDT] Deep: firing dynamic search for:', query);
      _dynamicSearchAbortId++;
      _performDynamicSearch(query);
    }

    _statusBar.textContent = `${_currentResults.length} results · deep searching...${filterNote}`;
  }

  function _updateSearchingBanner() {
    if (!_searchingBanner) return;
    const pending = [];
    if (_pendingSearches.has('code') || _deepCodeSearchRunning) pending.push('code');
    if (_pendingSearches.has('record') || _dynamicSearchRunning) pending.push('records');
    if (_pendingSearches.has('field')) pending.push('fields');

    if (pending.length === 0) {
      _searchingBanner.style.display = 'none';
      // If deep search was running and all searches are done, clean up
      if (_deepSearchEnabled) {
        _removeDeepSearchBar(); // Remove the "Deep searching..." active bar
        _setSearchBtnEnabled(true);
        const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';
        _statusBar.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${filterNote} · deep search complete`;
      }
      return;
    }

    // When deep search is active, hide the banner — the deep search slot shows status
    if (_deepSearchEnabled) {
      _searchingBanner.style.display = 'none';
      return;
    }

    const text = 'Searching ' + pending.join(', ') + '...';
    _searchingBanner.querySelector('.sfdt-searching-text').textContent = text;
    _searchingBanner.style.display = '';
  }

  async function _performFieldSearch(query, abortId) {
    try {
      const fieldResults = await SEARCH().searchFields(query);

      // Abort if user has typed something new
      if (abortId !== _fieldSearchAbortId || !_visible) return;
      if (!_input || _input.value.trim() !== query) return;

      const filterNote = _activeFilter ? ` (filtered: ${_activeFilter})` : '';

      _pendingSearches.delete('field');
      _updateSearchingBanner();

      if (fieldResults.length === 0) {
        if (_activeFilter === 'Field') {
          _statusBar.textContent = `No fields found${filterNote}`;
        }
        if (_currentResults.length === 0 && _pendingSearches.size === 0) _renderResults([]);
        return;
      }

      // Merge field results (deduplicate by id)
      const existingIds = new Set(_currentResults.map(r => r.id));
      const newFieldResults = fieldResults.filter(r => !existingIds.has(r.id));

      if (newFieldResults.length > 0) {
        _currentResults = [..._currentResults, ...newFieldResults];
        _currentResults.sort((a, b) => b.score - a.score);
        _renderResults(_currentResults);
      }

      const fieldNote = newFieldResults.length > 0 ? ` + ${newFieldResults.length} fields` : '';
      const total = _currentResults.length;
      _statusBar.textContent = `${total} result${total !== 1 ? 's' : ''}${fieldNote}${filterNote}`;
    } catch (e) {
      console.debug('[SFDT] Field search error:', e.message);
      _pendingSearches.delete('field');
      _updateSearchingBanner();
      if (_currentResults.length === 0 && _pendingSearches.size === 0) _renderResults([]);
    }
  }

  function _buildInlineDeepSearchHTML(query) {
    if (!query || query.length < 2) return '';
    return `
      <div class="sfdt-deep-search-inline" id="sfdt-inline-deep-search">
        <span class="sfdt-deep-search-icon">${ICONS().sparkle || ICONS().search}</span>
        <div style="flex:1">
          <div class="sfdt-deep-search-text" style="margin-bottom:2px">Deep Search</div>
          <div class="sfdt-deep-search-hint" style="margin-left:0">Search inside Apex code, VF pages, fields & all objects</div>
        </div>
        <span class="sfdt-deep-search-arrow">→</span>
      </div>
    `;
  }

  function _attachInlineDeepSearchHandler() {
    if (!_resultsList) return;
    const el = _resultsList.querySelector('#sfdt-inline-deep-search');
    if (el) {
      el.addEventListener('click', () => {
        const q = _input ? _input.value.trim() : '';
        if (q) _triggerDeepSearch(q);
      });
    }
  }

  function _renderResults(results) {
    if (results.length === 0) {
      if (_pendingSearches.size > 0) {
        if (_deepSearchEnabled) {
          _resultsList.innerHTML = '';
        } else {
          _resultsList.innerHTML = '<div class="sfdt-searching"><span class="sfdt-spinner"></span> Searching...</div>';
        }
      } else {
        _resultsList.innerHTML = _input.value
          ? '<div class="sfdt-empty">No results found</div>'
          : '';
      }
      return;
    }

    _resultsList.innerHTML = results.map((r, i) => {
      // For records, show the sObject type as the badge; for fields, show entity + data type; for metadata, show .type
      const typeBadge = r.matchType === 'record'
        ? `<span class="sfdt-result-type sfdt-result-type-record">${_escapeHTML(r.sobjectType)}</span>`
        : r.matchType === 'field'
        ? `<span class="sfdt-result-type sfdt-result-type-field">${_escapeHTML(r.fieldDataType)}</span>`
        : `<span class="sfdt-result-type">${_escapeHTML(r.type)}</span>`;

      const matchInfo = r.matchType === 'code' && r.codeMatches && r.codeMatches.length > 0
        ? `<div>${r.codeMatches.map(m =>
            `<span class="sfdt-code-line">${m.line > 0 ? `Line ${m.line}: ` : ''}${_escapeHTML(m.text.substring(0, 80))}</span>`
          ).join('')}</div>` : '';
      const symbolInfo = r.matchType === 'symbol' && r.symbol
        ? `<div class="sfdt-result-symbol">${_escapeHTML(r.symbol.kind)}: ${_escapeHTML(r.symbol.name)} (line ${r.symbol.line})</div>` : '';

      // For records, show detail (sObject type + extra field)
      const recordInfo = r.matchType === 'record' && r.recordDetail
        ? `<div class="sfdt-result-sub">${_escapeHTML(r.recordDetail)}</div>` : '';

      // For fields, show object name + API name
      const fieldInfo = r.matchType === 'field'
        ? `<div class="sfdt-result-sub">${_escapeHTML(r.entityLabel)} · ${_escapeHTML(r.fieldApiName)}</div>` : '';

      // Show namespace prefix to distinguish managed package classes
      const nsInfo = r.namespace
        ? `<span class="sfdt-result-ns">${_escapeHTML(r.namespace)}</span>`
        : '';

      // Determine display name: prefer readable label, show API name as subtitle
      const hasReadableLabel = r.label && r.label !== r.name && !r.namespace;
      const displayName = hasReadableLabel ? r.label : r.name;
      const apiNameSub = hasReadableLabel
        ? `<div class="sfdt-result-sub">${_escapeHTML(r.name)}</div>` : '';

      const icon = r.matchType === 'field' ? ICONS().settings
        : r.matchType === 'record' ? _getRecordIcon(r.sobjectType) : _getTypeIcon(r.type);

      return `<div class="sfdt-result ${i === _selectedIndex ? 'selected' : ''}" data-index="${i}">
        <span class="sfdt-result-icon">${icon}</span>
        <div class="sfdt-result-content">
          <div class="sfdt-result-name">${_highlightMatch(_escapeHTML(displayName), _input.value)}${nsInfo}</div>
          ${matchInfo}${symbolInfo}${recordInfo}${fieldInfo}${apiNameSub}
        </div>
        ${typeBadge}
        <button class="sfdt-result-newtab" data-index="${i}" title="Open in new tab (Shift+Enter)">${ICONS().externalLink}</button>
      </div>`;
    }).join('');

    _resultsList.querySelectorAll('.sfdt-result').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.sfdt-result-newtab')) return;
        _selectResult(parseInt(el.dataset.index, 10));
      });
      el.addEventListener('mouseenter', () => {
        _selectedIndex = parseInt(el.dataset.index, 10);
        _updateSelection();
      });
    });

    _resultsList.querySelectorAll('.sfdt-result-newtab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _selectResult(parseInt(btn.dataset.index, 10), true);
      });
    });
  }

  function _getTypeIcon(type) {
    const I = ICONS();
    const map = {
      'ApexClass': I.code, 'ApexTrigger': I.bolt, 'VisualforcePage': I.file,
      'LWC': I.layout, 'AuraComponent': I.bolt, 'Flow': I.git,
      'ValidationRule': I.check, 'CustomObject': I.folder, 'Profile': I.user,
      'PermissionSet': I.lock, 'Report': I.chart, 'Dashboard': I.chart,
      'CustomLabel': I.tag, 'StaticResource': I.box, 'EmailTemplate': I.mail,
      'NamedCredential': I.lock, 'ConnectedApp': I.link, 'RemoteSiteSetting': I.globe,
      'CustomMetadata': I.file, 'CustomSetting': I.settings,
      'Tab': I.layout,
      'Attribute': I.tag
    };
    return map[type] || I.file;
  }

  function _getRecordIcon(sobjectType) {
    const I = ICONS();
    const map = {
      'Account': I.folder, 'Contact': I.user, 'Lead': I.user,
      'Opportunity': I.star, 'Case': I.wrench, 'Campaign': I.rocket,
      'Product2': I.box, 'Order': I.list, 'Contract': I.file,
      'Report': I.chart, 'Dashboard': I.chart, 'Solution': I.check,
      'Task': I.check, 'Event': I.clock,
      'ContentDocument': I.file, 'Document': I.file,
      'EmailMessage': I.mail, 'Pricebook2': I.tag
    };
    return map[sobjectType] || I.database;
  }

  function _highlightMatch(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="sfdt-highlight">$1</mark>');
  }

  function _escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function _onKeyDown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        _selectedIndex = Math.min(_selectedIndex + 1, _currentResults.length - 1);
        _updateSelection();
        break;
      case 'ArrowUp':
        e.preventDefault();
        _selectedIndex = Math.max(_selectedIndex - 1, 0);
        _updateSelection();
        break;
      case 'Enter':
        e.preventDefault();
        if (_currentResults.length > 0 && _selectedIndex >= 0) {
          _selectResult(_selectedIndex, e.shiftKey);
        } else if (_input.value.trim().length > 0) {
          _performSearch(_input.value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        hide();
        break;
      case 'Tab':
        e.preventDefault();
        const filters = TYPE_FILTERS.map(f => f.key);
        const currentIdx = filters.indexOf(_activeFilter || 'all');
        _setFilter(filters[(currentIdx + 1) % filters.length]);
        break;
    }
  }

  function _updateSelection() {
    const items = _resultsList.querySelectorAll('.sfdt-result');
    items.forEach((el, i) => el.classList.toggle('selected', i === _selectedIndex));
    const selected = items[_selectedIndex];
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function _openUrl(url, newTab) {
    if (newTab) {
      chrome.runtime.sendMessage({ action: 'open-new-tab', url: url });
    } else {
      window.location.href = url;
    }
  }

  function _selectResult(index, newTab) {
    const result = _currentResults[index];
    if (!result) return;

    // Save search to history
    if (_input.value.trim()) {
      _addToHistory(_input.value.trim(), result);
    }

    // For records, navigate to the record page directly
    if (result.matchType === 'record' && result.id) {
      const base = window.SalesforceAPI.getInstanceUrl();
      const isLightning = base.includes('lightning.force.com')
        || document.querySelector('one-app-nav-bar')
        || window.location.pathname.startsWith('/lightning');
      const url = isLightning
        ? `${base}/lightning/r/${result.sobjectType}/${result.id}/view`
        : `${base}/${result.id}`;
      _openUrl(url, newTab);
      if (!newTab) hide();
      return;
    }

    // For fields, navigate based on Classic vs Lightning mode
    if (result.matchType === 'field' && result.entityName) {
      const base = window.SalesforceAPI.getInstanceUrl();
      const isLightning = base.includes('lightning.force.com')
        || document.querySelector('one-app-nav-bar')
        || window.location.pathname.startsWith('/lightning');

      let url;
      if (isLightning) {
        // Lightning: Object Manager > Fields & Relationships > specific field
        url = `${base}/lightning/setup/ObjectManager/${encodeURIComponent(result.entityName)}/FieldsAndRelationships/${encodeURIComponent(result.fieldApiName)}/view`;
      } else {
        // Classic: Go to the object field list page
        url = `${base}/p/setup/layout/LayoutFieldList?type=${encodeURIComponent(result.entityName)}&setupid=CustomObjects`;
      }
      _openUrl(url, newTab);
      if (!newTab) hide();
      return;
    }

    const url = META().getSetupUrl(result);
    if (url) {
      _openUrl(url, newTab);
    }
    if (!newTab) hide();
  }

  function _addToHistory(query, result) {
    _searchHistory = _searchHistory.filter(h => h.query !== query);
    _searchHistory.unshift({
      query,
      resultName: result.name,
      resultType: result.type,
      timestamp: Date.now()
    });
    if (_searchHistory.length > MAX_HISTORY) _searchHistory.length = MAX_HISTORY;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(_searchHistory)); } catch { /* ignore */ }
  }

  function _loadHistory() {
    try { _searchHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { _searchHistory = []; }
  }

  function _showSearchHistory() {
    if (_searchHistory.length === 0) {
      _resultsList.innerHTML = '';
      return;
    }
    const I = ICONS();
    _resultsList.innerHTML = `
      <div style="padding:6px 16px;font-size:11px;color:#7f849c;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center">
        <span>Recent Searches</span>
        <button class="sfdt-btn sfdt-btn-sm" id="sfdt-clear-history" style="font-size:10px">${I.x} Clear</button>
      </div>
      ${_searchHistory.slice(0, 10).map((h, i) => `
        <div class="sfdt-result sfdt-history-item" data-query="${_escapeHTML(h.query)}" data-index="${i}">
          <span class="sfdt-result-icon">${I.clock}</span>
          <div class="sfdt-result-content">
            <div class="sfdt-result-name">${_escapeHTML(h.query)}</div>
            <div class="sfdt-result-sub">${_escapeHTML(h.resultName || '')} · ${_escapeHTML(h.resultType || '')}</div>
          </div>
          <span class="sfdt-result-arrow">${I.arrowRight}</span>
        </div>
      `).join('')}
    `;

    _resultsList.querySelector('#sfdt-clear-history')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _searchHistory = [];
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
      _resultsList.innerHTML = '';
      _statusBar.textContent = 'Type to search records, metadata, and code';
    });

    _resultsList.querySelectorAll('.sfdt-history-item').forEach(el => {
      el.addEventListener('click', () => {
        _input.value = el.dataset.query;
        _performSearch(el.dataset.query);
      });
    });
  }

  function show() {
    _create();
    _container.querySelector('#sfdt-search-palette').classList.add('visible');
    _visible = true;
    _input.value = '';
    _currentResults = [];
    _selectedIndex = 0;
    _pendingSearches.clear();
    _renderResults([]);
    _removeDeepSearchBar();
    _deepSearchEnabled = false;
    _lastSearchQuery = null;
    if (_searchingBanner) _searchingBanner.style.display = 'none';
    _statusBar.textContent = 'Type and press Enter to search';
    _setSearchBtnEnabled(false);
    requestAnimationFrame(() => _input.focus());
    _showOnboardingIfNeeded();
  }

  function _showOnboardingIfNeeded() {
    const ONBOARD_KEY = 'sfdt_search_onboarded_v2';
    try { if (localStorage.getItem(ONBOARD_KEY)) return; } catch { return; }

    const overlay = document.createElement('div');
    overlay.className = 'sfdt-onboarding-overlay';
    overlay.innerHTML = `
      <div class="sfdt-onboarding-card">
        <div class="sfdt-onboarding-title">Welcome to Search Palette</div>
        <div class="sfdt-onboarding-row">
          <div class="sfdt-onboarding-item">
            <span class="sfdt-onboarding-icon sfdt-onboarding-search">${ICONS().sparkle || ICONS().search}</span>
            <div class="sfdt-onboarding-label">Search</div>
            <div class="sfdt-onboarding-desc">Quick search by name across metadata, records &amp; objects. Press <kbd>Enter</kbd> or click.</div>
          </div>
          <div class="sfdt-onboarding-divider"></div>
          <div class="sfdt-onboarding-item">
            <span class="sfdt-onboarding-icon sfdt-onboarding-deep">${ICONS().search}</span>
            <div class="sfdt-onboarding-label">Deep Search</div>
            <div class="sfdt-onboarding-desc">Searches inside Apex code bodies, VF pages, field labels &amp; all custom objects.</div>
          </div>
          <div class="sfdt-onboarding-divider"></div>
          <div class="sfdt-onboarding-item">
            <span class="sfdt-onboarding-icon sfdt-onboarding-auto">⚡</span>
            <div class="sfdt-onboarding-label">Auto</div>
            <div class="sfdt-onboarding-desc">Toggle Auto to search automatically as you type — fires both normal &amp; deep search.</div>
          </div>
        </div>
        <button class="sfdt-onboarding-dismiss">Got it!</button>
      </div>
    `;

    const dialog = _container.querySelector('.sfdt-palette');
    dialog.appendChild(overlay);

    const dismiss = () => {
      overlay.remove();
      try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ }
      _input.focus();
    };
    overlay.querySelector('.sfdt-onboarding-dismiss').addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  }

  function hide() {
    if (_container) {
      _container.querySelector('#sfdt-search-palette').classList.remove('visible');
    }
    _visible = false;

    // Cancel all pending searches immediately
    clearTimeout(_debounceTimer);
    clearTimeout(_codeSearchTimer);
    clearTimeout(_recordSearchTimer);
    clearTimeout(_fieldSearchTimer);
    _codeSearchAbortId++;
    _deepCodeSearchAbortId++;
    _recordSearchAbortId++;
    _fieldSearchAbortId++;
    _dynamicSearchAbortId++;
    _deepCodeSearchRunning = false;
    _dynamicSearchRunning = false;
    _pendingSearches.clear();
    if (_searchingBanner) _searchingBanner.style.display = 'none';
    _removeBottomLoader();
    _removeDeepSearchBar();
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }

  return { show, hide, toggle, isVisible };
})();

if (typeof window !== 'undefined') window.SFDTSearchPalette = SearchPalette;
