/**
 * NavigatorPanel - Smart Salesforce Navigator with Shadow DOM isolation.
 */
const NavigatorPanel = (() => {
  const META = () => window.SFDTMetadataService;
  const SEARCH = () => window.SFDTSearchService;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _visible = false;
  let _input = null;
  let _resultsList = null;
  let _selectedIndex = 0;
  let _currentResults = [];
  let _debounceTimer = null;
  let _codeSearchTimer = null;
  let _codeSearchAbortId = 0;
  let _recentItems = [];

  const RECENT_KEY = 'sfdt_nav_recent';
  const MAX_RECENT = 20;

  const SETUP_SHORTCUTS = [
    { name: 'Object Manager', icon: 'folder', path: '/lightning/setup/ObjectManager/home' },
    { name: 'Apex Classes', icon: 'code', path: '/lightning/setup/ApexClasses/home' },
    { name: 'Apex Triggers', icon: 'bolt', path: '/lightning/setup/ApexTriggers/home' },
    { name: 'Flows', icon: 'git', path: '/lightning/setup/Flows/home' },
    { name: 'Lightning Components', icon: 'layout', path: '/lightning/setup/LightningComponentBundles/home' },
    { name: 'Profiles', icon: 'user', path: '/lightning/setup/Profiles/home' },
    { name: 'Permission Sets', icon: 'lock', path: '/lightning/setup/PermSets/home' },
    { name: 'Users', icon: 'user', path: '/lightning/setup/ManageUsers/home' },
    { name: 'Custom Metadata Types', icon: 'file', path: '/lightning/setup/CustomMetadata/home' },
    { name: 'Custom Settings', icon: 'settings', path: '/lightning/setup/CustomSettings/home' },
    { name: 'Named Credentials', icon: 'lock', path: '/lightning/setup/NamedCredential/home' },
    { name: 'Remote Site Settings', icon: 'globe', path: '/lightning/setup/SecurityRemoteProxy/home' },
    { name: 'Connected Apps', icon: 'link', path: '/lightning/setup/ConnectedApplication/home' },
    { name: 'Custom Labels', icon: 'tag', path: '/lightning/setup/ExternalStrings/home' },
    { name: 'Static Resources', icon: 'box', path: '/lightning/setup/StaticResources/home' },
    { name: 'Email Templates', icon: 'mail', path: '/lightning/setup/CommunicationTemplatesEmail/home' },
    { name: 'Reports', icon: 'chart', path: '/lightning/o/Report/home' },
    { name: 'Dashboards', icon: 'chart', path: '/lightning/o/Dashboard/home' },
    { name: 'Debug Logs', icon: 'terminal', path: '/lightning/setup/ApexDebugLogs/home' },
    { name: 'Developer Console', icon: 'terminal', path: '/_ui/common/apex/debug/ApexCSIPage' },
    { name: 'Deployment Status', icon: 'rocket', path: '/lightning/setup/DeployStatus/home' },
    { name: 'Installed Packages', icon: 'download', path: '/lightning/setup/ImportedPackage/home' },
    { name: 'Scheduled Jobs', icon: 'clock', path: '/lightning/setup/ScheduledJobs/home' },
    { name: 'Platform Events', icon: 'bolt', path: '/lightning/setup/EventObjects/home' },
    { name: 'Auth Providers', icon: 'lock', path: '/lightning/setup/AuthProvidersPage/home' },
    { name: 'Data Loader', icon: 'database', path: '/lightning/setup/DataManagementDataLoader/home' }
  ];

  function _create() {
    if (_container) return;

    const { container } = SHADOW().getOrCreate('navigator');
    _container = container;
    const I = ICONS();

    _container.innerHTML = `
      <div class="sfdt-palette" id="sfdt-nav">
        <div class="sfdt-backdrop"></div>
        <div class="sfdt-dialog">
          <div class="sfdt-header">
            <span class="sfdt-header-icon">${I.compass}</span>
            <input type="text" class="sfdt-input" placeholder="Navigate to Setup, Objects, Fields, Flows..." autocomplete="off" spellcheck="false" />
            <span class="sfdt-shortcut">ESC</span>
          </div>
          <div class="sfdt-tabs">
            <button class="sfdt-tab active" data-tab="search">Search</button>
            <button class="sfdt-tab" data-tab="shortcuts">Setup Shortcuts</button>
            <button class="sfdt-tab" data-tab="recent">Recent</button>
          </div>
          <div class="sfdt-results" id="nav-results"></div>
          <div class="sfdt-status-bar">
            <span class="sfdt-status-text">Navigate to any Salesforce setup page</span>
          </div>
        </div>
      </div>
    `;

    _input = _container.querySelector('.sfdt-input');
    _resultsList = _container.querySelector('#nav-results');

    _container.querySelector('.sfdt-backdrop').addEventListener('click', hide);
    _input.addEventListener('input', _onInput);
    _input.addEventListener('keydown', _onKeyDown);

    _container.querySelectorAll('.sfdt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _container.querySelectorAll('.sfdt-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _showTab(tab.dataset.tab);
      });
    });

    _loadRecent();
  }

  function _showTab(tab) {
    switch (tab) {
      case 'search': _performSearch(_input.value); break;
      case 'shortcuts': _showShortcuts(); break;
      case 'recent': _showRecent(); break;
    }
  }

  function _onInput() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _container.querySelectorAll('.sfdt-tab').forEach(t => t.classList.remove('active'));
      _container.querySelector('[data-tab="search"]').classList.add('active');
      _performSearch(_input.value);
    }, 50);
  }

  function _performSearch(query) {
    const statusText = _container.querySelector('.sfdt-status-text');
    clearTimeout(_codeSearchTimer);

    if (!query || query.trim().length === 0) {
      _showShortcuts();
      statusText.textContent = 'Navigate to any Salesforce setup page';
      return;
    }

    // Instant name-based search
    const metaResults = SEARCH().quickSearch(query);
    const q = query.toLowerCase();
    const shortcutResults = SETUP_SHORTCUTS
      .filter(s => s.name.toLowerCase().includes(q))
      .map(s => ({ ...s, type: 'SetupPage', score: 900 }));

    const combined = [...shortcutResults, ...metaResults];
    combined.sort((a, b) => (b.score || 0) - (a.score || 0));

    _currentResults = combined.slice(0, 25);
    _selectedIndex = 0;
    _renderResults(_currentResults);
    statusText.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}`;

    // Trigger async server-side code search for queries >= 4 chars
    if (query.trim().length >= 4) {
      _codeSearchAbortId++;
      const currentAbortId = _codeSearchAbortId;
      _codeSearchTimer = setTimeout(() => _performCodeSearch(query.trim(), currentAbortId), 400);
      statusText.textContent += ' · searching code...';
    }
  }

  async function _performCodeSearch(query, abortId) {
    const statusText = _container.querySelector('.sfdt-status-text');
    try {
      const codeResults = await SEARCH().searchCode(query);

      // Abort if user typed something new
      if (abortId !== _codeSearchAbortId || !_visible) return;
      if (!_input || _input.value.trim() !== query) return;

      if (codeResults.length === 0) {
        statusText.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}`;
        return;
      }

      // Merge code results, dedup by id
      const existingIds = new Set(_currentResults.map(r => r.id));
      const newCodeResults = codeResults.filter(r => !existingIds.has(r.id));

      if (newCodeResults.length > 0) {
        _currentResults = [..._currentResults, ...newCodeResults];
        _currentResults.sort((a, b) => (b.score || 0) - (a.score || 0));
        _renderResults(_currentResults);
      }

      const codeNote = newCodeResults.length > 0 ? ` + ${newCodeResults.length} code` : '';
      statusText.textContent = `${_currentResults.length} result${_currentResults.length !== 1 ? 's' : ''}${codeNote}`;
    } catch (e) {
      console.warn('[SFDT] Navigator code search error:', e.message);
    }
  }

  function _showShortcuts() {
    _currentResults = SETUP_SHORTCUTS.map(s => ({ ...s, type: 'SetupPage' }));
    _selectedIndex = 0;
    _renderResults(_currentResults);
  }

  function _showRecent() {
    _currentResults = _recentItems;
    _selectedIndex = 0;
    if (_recentItems.length === 0) {
      _resultsList.innerHTML = '<div class="sfdt-empty">No recent navigation</div>';
    } else {
      _renderResults(_currentResults);
    }
  }

  function _renderResults(results) {
    if (results.length === 0) {
      _resultsList.innerHTML = _input.value
        ? '<div class="sfdt-empty">No results found</div>' : '';
      return;
    }

    const I = ICONS();
    _resultsList.innerHTML = results.map((r, i) => {
      const iconKey = r.icon || 'file';
      const iconSvg = I[iconKey] || I.file;
      const subtitle = r.type === 'SetupPage' ? 'Setup Page' : r.type;
      const description = r.label && r.label !== r.name ? ` — ${_esc(r.label)}` : '';

      return `<div class="sfdt-result ${i === _selectedIndex ? 'selected' : ''}" data-index="${i}">
        <span class="sfdt-result-icon">${iconSvg}</span>
        <div class="sfdt-result-content">
          <div class="sfdt-result-name">${_highlightMatch(_esc(r.name), _input.value)}${description}</div>
          <div class="sfdt-result-sub">${_esc(subtitle)}</div>
        </div>
        <span class="sfdt-result-arrow">${I.arrowRight}</span>
      </div>`;
    }).join('');

    _resultsList.querySelectorAll('.sfdt-result').forEach(el => {
      el.addEventListener('click', () => _selectResult(parseInt(el.dataset.index, 10)));
      el.addEventListener('mouseenter', () => {
        _selectedIndex = parseInt(el.dataset.index, 10);
        _updateSelection();
      });
    });
  }

  function _highlightMatch(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="sfdt-highlight">$1</mark>');
  }

  function _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function _onKeyDown(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); _selectedIndex = Math.min(_selectedIndex + 1, _currentResults.length - 1); _updateSelection(); break;
      case 'ArrowUp': e.preventDefault(); _selectedIndex = Math.max(_selectedIndex - 1, 0); _updateSelection(); break;
      case 'Enter': e.preventDefault(); _selectResult(_selectedIndex); break;
      case 'Escape': e.preventDefault(); hide(); break;
    }
  }

  function _updateSelection() {
    const items = _resultsList.querySelectorAll('.sfdt-result');
    items.forEach((el, i) => el.classList.toggle('selected', i === _selectedIndex));
    const selected = items[_selectedIndex];
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function _selectResult(index) {
    const result = _currentResults[index];
    if (!result) return;

    let url;
    if (result.type === 'SetupPage') {
      url = window.SalesforceAPI.getInstanceUrl() + result.path;
    } else {
      url = META().getSetupUrl(result);
    }

    if (url) {
      _addToRecent(result);
      window.location.href = url;
    }
    hide();
  }

  function _addToRecent(item) {
    _recentItems = _recentItems.filter(r => r.name !== item.name || r.type !== item.type);
    _recentItems.unshift({
      name: item.name, type: item.type, icon: item.icon,
      id: item.id, path: item.path, label: item.label,
      timestamp: Date.now()
    });
    if (_recentItems.length > MAX_RECENT) _recentItems.length = MAX_RECENT;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(_recentItems)); } catch { /* ignore */ }
  }

  function _loadRecent() {
    try { _recentItems = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { _recentItems = []; }
  }

  function show() {
    _create();
    _container.querySelector('#sfdt-nav').classList.add('visible');
    _visible = true;
    _input.value = '';
    _selectedIndex = 0;
    _showShortcuts();
    requestAnimationFrame(() => _input.focus());
  }

  function hide() {
    if (_container) _container.querySelector('#sfdt-nav').classList.remove('visible');
    _visible = false;
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }

  return { show, hide, toggle, isVisible };
})();

if (typeof window !== 'undefined') window.SFDTNavigatorPanel = NavigatorPanel;
