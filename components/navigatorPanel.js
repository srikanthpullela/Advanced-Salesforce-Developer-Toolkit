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
  let _drilldownActive = false;
  let _drilldownCategory = null;
  let _drilldownAllItems = [];
  let _drilldownFilteredItems = [];
  let _drilldownVisibleCount = 100;

  const RECENT_KEY = 'sfdt_nav_recent';
  const MAX_RECENT = 20;

  // Map shortcut names to metadata fetch functions and item URL builders
  const BROWSEABLE_CATEGORIES = {
    'Apex Classes': { fetch: () => META().fetchApexClasses(), type: 'ApexClass' },
    'Apex Triggers': { fetch: () => META().fetchApexTriggers(), type: 'ApexTrigger' },
    'Flows': { fetch: () => META().fetchFlows(), type: 'Flow' },
    'Lightning Components': { fetch: () => META().fetchLightningComponents(), type: 'LWC' },
    'Profiles': { fetch: () => META().fetchProfiles(), type: 'Profile' },
    'Permission Sets': { fetch: () => META().fetchPermissionSets(), type: 'PermissionSet' },
    'Custom Metadata Types': { fetch: () => META().fetchCustomMetadata(), type: 'CustomMetadata' },
    'Custom Settings': { fetch: () => META().fetchCustomSettings(), type: 'CustomSetting' },
    'Static Resources': { fetch: () => META().fetchStaticResources(), type: 'StaticResource' },
    'Custom Labels': { fetch: () => META().fetchCustomLabels(), type: 'CustomLabel' },
    'Reports': { fetch: () => META().fetchReports(), type: 'Report' },
    'Dashboards': { fetch: () => META().fetchDashboards(), type: 'Dashboard' },
    'Email Templates': { fetch: () => META().fetchEmailTemplates(), type: 'EmailTemplate' },
    'Debug Logs': { fetch: () => META().fetchDebugLogs ? META().fetchDebugLogs() : window.SalesforceAPI.getDebugLogs(50).then(r => (r.records || []).map(l => ({ name: l.Id, label: `${l.LogUser?.Name || 'User'} — ${l.Operation || ''} (${(l.LogLength/1024).toFixed(1)}KB)`, id: l.Id }))), type: 'DebugLog' },
    'Named Credentials': { fetch: () => META().fetchNamedCredentials(), type: 'NamedCredential' },
    'Remote Site Settings': { fetch: () => META().fetchRemoteSiteSettings(), type: 'RemoteSiteSetting' },
    'Connected Apps': { fetch: () => META().fetchConnectedApps(), type: 'ConnectedApp' },
    'Object Manager': { fetch: () => META().fetchCustomObjects(), type: 'CustomObject' },
    'Installed Packages': { fetch: () => _fetchInstalledPackages(), type: 'InstalledPackage' },
    'Visualforce Pages': { fetch: () => META().fetchVisualforcePages(), type: 'VisualforcePage' },
    'Tabs': { fetch: () => META().fetchTabs(), type: 'Tab' },
  };

  async function _fetchInstalledPackages() {
    try {
      const res = await window.SalesforceAPI.toolingQuery("SELECT Id, SubscriberPackage.Name, SubscriberPackageVersion.Name FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.Name");
      return (res.records || []).map(p => ({
        name: p.SubscriberPackage?.Name || p.Id,
        label: p.SubscriberPackageVersion?.Name || '',
        id: p.Id
      }));
    } catch (e) {
      return [];
    }
  }

  function _isLightning() {
    const base = window.SalesforceAPI.getInstanceUrl();
    return base.includes('lightning.force.com')
      || !!document.querySelector('one-app-nav-bar')
      || window.location.pathname.startsWith('/lightning');
  }

  const SETUP_SHORTCUTS = [
    { name: 'Apex Classes', icon: 'code', path: '/lightning/setup/ApexClasses/home', classicPath: '/setup/build/listApexClass.apexp' },
    { name: 'Apex Triggers', icon: 'bolt', path: '/lightning/setup/ApexTriggers/home', classicPath: '/setup/build/listApexTrigger.apexp' },
    { name: 'Auth Providers', icon: 'lock', path: '/lightning/setup/AuthProvidersPage/home', classicPath: '/setup/secur/AuthProviderPage.apexp' },
    { name: 'Connected Apps', icon: 'link', path: '/lightning/setup/ConnectedApplication/home', classicPath: '/app/mgmt/forceconnectedapps/forceAppList.apexp' },
    { name: 'Custom Labels', icon: 'tag', path: '/lightning/setup/ExternalStrings/home', classicPath: '/101?setupid=ExternalStrings' },
    { name: 'Custom Metadata Types', icon: 'file', path: '/lightning/setup/CustomMetadata/home', classicPath: '/setup/ui/listCustomMetadata.apexp' },
    { name: 'Custom Settings', icon: 'settings', path: '/lightning/setup/CustomSettings/home', classicPath: '/setup/ui/listCustomSettings.apexp' },
    { name: 'Dashboards', icon: 'chart', path: '/lightning/o/Dashboard/home', classicPath: '/01Z' },
    { name: 'Data Loader', icon: 'database', path: '/lightning/setup/DataManagementDataLoader/home', classicPath: '/ui/setup/dataimporter/DataImporterPage' },
    { name: 'Debug Logs', icon: 'terminal', path: '/lightning/setup/ApexDebugLogs/home', classicPath: '/setup/ui/listApexTraces.apexp' },
    { name: 'Deployment Status', icon: 'rocket', path: '/lightning/setup/DeployStatus/home', classicPath: '/changemgmt/monitorDeployment.apexp' },
    { name: 'Developer Console', icon: 'terminal', path: '/_ui/common/apex/debug/ApexCSIPage', classicPath: '/_ui/common/apex/debug/ApexCSIPage' },
    { name: 'Email Templates', icon: 'mail', path: '/lightning/setup/CommunicationTemplatesEmail/home', classicPath: '/email/admin/listEmailTemplate.apexp' },
    { name: 'Flows', icon: 'git', path: '/lightning/setup/Flows/home', classicPath: '/300' },
    { name: 'Installed Packages', icon: 'download', path: '/lightning/setup/ImportedPackage/home', classicPath: '/0A3' },
    { name: 'Lightning Components', icon: 'layout', path: '/lightning/setup/LightningComponentBundles/home', classicPath: '/setup/build/listLightningComponentBundle.apexp' },
    { name: 'Named Credentials', icon: 'lock', path: '/lightning/setup/NamedCredential/home', classicPath: '/0XA' },
    { name: 'Object Manager', icon: 'folder', path: '/lightning/setup/ObjectManager/home', classicPath: '/p/setup/custent/CustomObjectsPage?setupid=CustomObjects' },
    { name: 'Permission Sets', icon: 'lock', path: '/lightning/setup/PermSets/home', classicPath: '/0PS' },
    { name: 'Platform Events', icon: 'bolt', path: '/lightning/setup/EventObjects/home', classicPath: '/setup/build/listEventObjects.apexp' },
    { name: 'Profiles', icon: 'user', path: '/lightning/setup/Profiles/home', classicPath: '/00e' },
    { name: 'Remote Site Settings', icon: 'globe', path: '/lightning/setup/SecurityRemoteProxy/home', classicPath: '/0rp' },
    { name: 'Reports', icon: 'chart', path: '/lightning/o/Report/home', classicPath: '/00O' },
    { name: 'Scheduled Jobs', icon: 'clock', path: '/lightning/setup/ScheduledJobs/home', classicPath: '/08e' },
    { name: 'Static Resources', icon: 'box', path: '/lightning/setup/StaticResources/home', classicPath: '/setup/build/listStaticResource.apexp' },
    { name: 'Tabs', icon: 'layout', path: '/lightning/setup/Tabs/home', classicPath: '/setup/ui/listTabs.apexp' },
    { name: 'Users', icon: 'user', path: '/lightning/setup/ManageUsers/home', classicPath: '/005' },
    { name: 'Visualforce Pages', icon: 'file', path: '/lightning/setup/ApexPages/home', classicPath: '/setup/build/listApexPage.apexp' }
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
            <button class="sfdt-tab active" data-tab="search">Setup Shortcuts</button>
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
      case 'recent': _showRecent(); break;
    }
  }

  function _onInput() {
    clearTimeout(_debounceTimer);
    if (_drilldownActive) {
      _debounceTimer = setTimeout(() => _filterDrilldown(_input.value), 30);
      return;
    }
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
      console.debug('[SFDT] Navigator code search error:', e.message);
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
      const isBrowseable = r.type === 'SetupPage' && BROWSEABLE_CATEGORIES[r.name];

      return `<div class="sfdt-result ${i === _selectedIndex ? 'selected' : ''}" data-index="${i}">
        <span class="sfdt-result-icon">${iconSvg}</span>
        <div class="sfdt-result-content">
          <div class="sfdt-result-name">${_highlightMatch(_esc(r.name), _input.value)}${description}</div>
          <div class="sfdt-result-sub">${_esc(subtitle)}</div>
        </div>
        ${isBrowseable
          ? `<button class="sfdt-browse-btn" data-category="${_esc(r.name)}" title="Browse all ${_esc(r.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></button>`
          : `<span class="sfdt-result-arrow">${I.arrowRight}</span>`}
      </div>`;
    }).join('');

    _resultsList.querySelectorAll('.sfdt-result').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.sfdt-browse-btn')) return;
        _selectResult(parseInt(el.dataset.index, 10));
      });
      el.addEventListener('mouseenter', () => {
        _selectedIndex = parseInt(el.dataset.index, 10);
        _updateSelection();
      });
    });

    // Browse button handlers
    _resultsList.querySelectorAll('.sfdt-browse-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _openDrilldown(btn.dataset.category);
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
    if (_drilldownActive) {
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); _selectedIndex = Math.min(_selectedIndex + 1, _drilldownFilteredItems.length - 1); _updateDrilldownSelection(); break;
        case 'ArrowUp': e.preventDefault(); _selectedIndex = Math.max(_selectedIndex - 1, 0); _updateDrilldownSelection(); break;
        case 'Enter': e.preventDefault(); _selectDrilldownItem(_selectedIndex); break;
        case 'Escape': e.preventDefault(); _closeDrilldown(); break;
        case 'Backspace':
          if (_input.value === '') { e.preventDefault(); _closeDrilldown(); }
          break;
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); _selectedIndex = Math.min(_selectedIndex + 1, _currentResults.length - 1); _updateSelection(); break;
      case 'ArrowUp': e.preventDefault(); _selectedIndex = Math.max(_selectedIndex - 1, 0); _updateSelection(); break;
      case 'Enter': e.preventDefault(); _selectResult(_selectedIndex); break;
      case 'Escape': e.preventDefault(); hide(); break;
    }
  }

  // ── Drilldown (Browse) ──────────────────────────────────────────

  async function _openDrilldown(categoryName) {
    const cat = BROWSEABLE_CATEGORIES[categoryName];
    if (!cat) return;

    _drilldownActive = true;
    _drilldownCategory = categoryName;
    _drilldownAllItems = [];
    _drilldownFilteredItems = [];
    _drilldownVisibleCount = 100;
    _selectedIndex = 0;

    // Show loading state
    const statusText = _container.querySelector('.sfdt-status-text');
    _input.value = '';
    _input.placeholder = `Search in ${categoryName}... (ESC to go back)`;
    statusText.textContent = `Loading ${categoryName}...`;
    _resultsList.innerHTML = '<div class="sfdt-searching"><span class="sfdt-spinner"></span> Loading...</div>';

    // Hide tabs, show back button
    const tabs = _container.querySelector('.sfdt-tabs');
    tabs.innerHTML = `<button class="sfdt-back-btn" id="sfdt-drilldown-back">← Back to Navigator</button><span class="sfdt-drilldown-title">${_esc(categoryName)}</span>`;
    _container.querySelector('#sfdt-drilldown-back').addEventListener('click', _closeDrilldown);

    try {
      const items = await cat.fetch();
      if (!_drilldownActive || _drilldownCategory !== categoryName) return; // Aborted

      _drilldownAllItems = (items || []).map(item => ({
        ...item,
        name: item.name || item.Name || item.DeveloperName || item.Id,
        label: item.label || item.Label || item.MasterLabel || '',
        type: cat.type,
        id: item.id || item.Id
      }));

      // Sort alphabetically by label (or name if no label)
      _drilldownAllItems.sort((a, b) => (a.label || a.name || '').localeCompare(b.label || b.name || ''));

      _drilldownFilteredItems = _drilldownAllItems;
      _selectedIndex = 0;
      _renderDrilldown();
      statusText.textContent = `${_drilldownAllItems.length} ${categoryName}`;
    } catch (e) {
      console.debug('[SFDT] Drilldown fetch error:', e.message);
      _resultsList.innerHTML = `<div class="sfdt-empty">Failed to load ${_esc(categoryName)}</div>`;
      statusText.textContent = 'Error loading items';
    }

    _input.focus();
  }

  function _filterDrilldown(query) {
    if (!query || query.trim().length === 0) {
      _drilldownFilteredItems = _drilldownAllItems;
    } else {
      const q = query.toLowerCase();
      _drilldownFilteredItems = _drilldownAllItems.filter(item =>
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.label && item.label.toLowerCase().includes(q))
      );
    }
    _selectedIndex = 0;
    _drilldownVisibleCount = 100;
    _renderDrilldown();
    const statusText = _container.querySelector('.sfdt-status-text');
    statusText.textContent = query
      ? `${_drilldownFilteredItems.length} of ${_drilldownAllItems.length} ${_drilldownCategory}`
      : `${_drilldownAllItems.length} ${_drilldownCategory}`;
  }

  function _renderDrilldown() {
    const I = ICONS();
    const items = _drilldownFilteredItems;

    if (items.length === 0) {
      _resultsList.innerHTML = '<div class="sfdt-empty">No items found</div>';
      return;
    }

    const visible = items.slice(0, _drilldownVisibleCount);
    const remaining = items.length - visible.length;

    _resultsList.innerHTML = visible.map((item, i) => {
      const cat = BROWSEABLE_CATEGORIES[_drilldownCategory];
      const iconKey = SETUP_SHORTCUTS.find(s => s.name === _drilldownCategory)?.icon || 'file';
      const iconSvg = I[iconKey] || I.file;
      const displayName = item.label && item.label !== item.name ? item.label : item.name;
      const apiName = item.label && item.label !== item.name ? item.name : '';

      return `<div class="sfdt-result ${i === _selectedIndex ? 'selected' : ''}" data-index="${i}">
        <span class="sfdt-result-icon">${iconSvg}</span>
        <div class="sfdt-result-content">
          <div class="sfdt-result-name">${_highlightMatch(_esc(displayName), _input.value)}</div>
          <div class="sfdt-result-sub">${apiName ? _esc(apiName) : _esc(item.type)}</div>
        </div>
        ${apiName ? `<span class="sfdt-result-type">${_esc(item.type)}</span>` : ''}
        <span class="sfdt-result-arrow">${I.arrowRight}</span>
      </div>`;
    }).join('') + (remaining > 0 ? `<div class="sfdt-show-more" id="sfdt-drilldown-more">Show More (${remaining} remaining)</div>` : '');

    _resultsList.querySelectorAll('.sfdt-result').forEach(el => {
      el.addEventListener('click', () => _selectDrilldownItem(parseInt(el.dataset.index, 10)));
      el.addEventListener('mouseenter', () => {
        _selectedIndex = parseInt(el.dataset.index, 10);
        _updateDrilldownSelection();
      });
    });

    const moreBtn = _resultsList.querySelector('#sfdt-drilldown-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        _drilldownVisibleCount += 100;
        _renderDrilldown();
      });
    }
  }

  function _updateDrilldownSelection() {
    const items = _resultsList.querySelectorAll('.sfdt-result');
    items.forEach((el, i) => el.classList.toggle('selected', i === _selectedIndex));
    const selected = items[_selectedIndex];
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function _selectDrilldownItem(index) {
    const item = _drilldownFilteredItems[index];
    if (!item) return;

    const url = META().getSetupUrl(item);
    if (url) {
      _addToRecent(item);
      window.location.href = url;
      hide();
    }
  }

  function _closeDrilldown() {
    _drilldownActive = false;
    _drilldownCategory = null;
    _drilldownAllItems = [];
    _drilldownFilteredItems = [];
    _input.value = '';
    _input.placeholder = 'Navigate to Setup, Objects, Fields, Flows...';

    // Restore tabs
    const tabs = _container.querySelector('.sfdt-tabs');
    tabs.innerHTML = `
      <button class="sfdt-tab active" data-tab="search">Search</button>
      <button class="sfdt-tab" data-tab="shortcuts">Setup Shortcuts</button>
      <button class="sfdt-tab" data-tab="recent">Recent</button>
    `;
    tabs.querySelectorAll('.sfdt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _container.querySelectorAll('.sfdt-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _showTab(tab.dataset.tab);
      });
    });

    _showShortcuts();
    const statusText = _container.querySelector('.sfdt-status-text');
    statusText.textContent = 'Navigate to any Salesforce setup page';
    _input.focus();
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
      const base = window.SalesforceAPI.getInstanceUrl();
      const usePath = _isLightning() ? result.path : (result.classicPath || result.path);
      url = base + usePath;
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
    if (_drilldownActive) _closeDrilldown();
    _input.value = '';
    _selectedIndex = 0;
    _showShortcuts();
    requestAnimationFrame(() => _input.focus());
  }

  function hide() {
    if (_container) _container.querySelector('#sfdt-nav').classList.remove('visible');
    _visible = false;
    _drilldownActive = false;
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }

  return { show, hide, toggle, isVisible };
})();

if (typeof window !== 'undefined') window.SFDTNavigatorPanel = NavigatorPanel;
