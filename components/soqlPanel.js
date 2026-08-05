/**
 * SOQLPanel - SOQL Query Editor with Shadow DOM isolation.
 * Features: built-in examples, autocomplete, history, favorites, export, maximize, open in new tab.
 */
const SOQLPanel = (() => {
  const QS = () => window.SFDTQueryService;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;
  const _track = (action) => { try { if (window.SFDTTelemetryService) window.SFDTTelemetryService.trackEvent('soql', action); } catch {} };

  let _container = null;
  let _panel = null;
  let _visible = false;
  let _pinned = false;
  let _editor = null;
  let _resultsContainer = null;
  let _statusBar = null;
  let _lastResults = null;
  let _autocompleteDropdown = null;
  let _currentSuggestions = [];
  let _suggestionIndex = -1;
  let _suggestionNavigated = false;
  let _activeTab = 'editor';

  // ─── Multi-Tab State ────────────────────────────────
  const TABS_KEY = 'sfdt_soql_tabs';
  let _queryTabs = []; // Array of { id, name, query, resultsHtml, scrollTop, isTooling, resultCount }
  let _activeQueryTabId = null;
  let _tabIdCounter = 0;

  // Known Tooling API objects — auto-detect when querying these
  const TOOLING_OBJECTS = new Set([
    'apexclass', 'apextrigger', 'apexpage', 'apexcomponent', 'apexlog',
    'apextestresult', 'apextestqueueitem', 'apexcodecover', 'apexcodecoverage',
    'apexcodecoverageaggregate', 'apexexecutionoverlayaction',
    'validationrule', 'workflowrule', 'flowdefinition', 'flow',
    'customfield', 'customobject', 'entitydefinition', 'entityparticle',
    'fielddefinition', 'customtab', 'staticresource',
    'aaboracomponentbundle', 'auradefinitionbundle', 'auradefinition',
    'lightningcomponentbundle', 'lightningcomponentresource',
    'debuglevel', 'traceflag', 'metadatacontainer',
    'apexclassmember', 'apextriggermember', 'apexpagemember',
    'scontrol', 'weblink', 'profile', 'permissionset',
    'installedsubscriberpackage', 'subscriberpackage', 'subscriberpackageversion'
  ]);

  const EXAMPLE_QUERIES = [
    { name: 'All Accounts (first 10)', query: 'SELECT Id, Name, Industry, Type, Phone\nFROM Account\nLIMIT 10' },
    { name: 'Recent Contacts', query: 'SELECT Id, FirstName, LastName, Email, Phone, Account.Name\nFROM Contact\nORDER BY CreatedDate DESC\nLIMIT 20' },
    { name: 'Open Opportunities', query: 'SELECT Id, Name, StageName, Amount, CloseDate, Account.Name\nFROM Opportunity\nWHERE IsClosed = false\nORDER BY CloseDate ASC\nLIMIT 50' },
    { name: 'Apex Classes (Tooling)', query: 'SELECT Id, Name, Status, LengthWithoutComments, ApiVersion\nFROM ApexClass\nWHERE NamespacePrefix = null\nORDER BY Name\nLIMIT 50' },
    { name: 'Custom Objects', query: 'SELECT Id, DeveloperName, Label, QualifiedApiName\nFROM EntityDefinition\nWHERE IsCustomizable = true\nORDER BY Label\nLIMIT 100' },
    { name: 'Users by Profile', query: 'SELECT Id, Name, Username, Profile.Name, IsActive, LastLoginDate\nFROM User\nWHERE IsActive = true\nORDER BY LastLoginDate DESC\nLIMIT 20' },
    { name: 'Recent Cases', query: 'SELECT Id, CaseNumber, Subject, Status, Priority, CreatedDate\nFROM Case\nORDER BY CreatedDate DESC\nLIMIT 20' },
    { name: 'Validation Rules (Tooling)', query: 'SELECT Id, ValidationName, EntityDefinition.DeveloperName, Active\nFROM ValidationRule\nWHERE Active = true\nORDER BY ValidationName\nLIMIT 50' },
    { name: 'Record Types', query: 'SELECT Id, Name, DeveloperName, SobjectType, IsActive\nFROM RecordType\nWHERE IsActive = true\nORDER BY SobjectType, Name' },
    { name: 'API Limits', query: 'SELECT Name, Max, Remaining\nFROM DataStatistics' },
    { name: '── SOSL Examples ──', query: '', separator: true },
    { name: 'Search All Fields (SOSL)', query: 'FIND {test}\nIN ALL FIELDS\nRETURNING Account(Id, Name), Contact(Id, Name, Email)\nLIMIT 20' },
    { name: 'Search Names Only (SOSL)', query: 'FIND {Acme*}\nIN NAME FIELDS\nRETURNING Account(Id, Name, Industry)\nLIMIT 10' },
    { name: 'Search Email Fields (SOSL)', query: 'FIND {*@gmail.com}\nIN EMAIL FIELDS\nRETURNING Contact(Id, FirstName, LastName, Email)\nLIMIT 20' }
  ];

  function _create() {
    if (_container) return;

    const { container } = SHADOW().getOrCreate('soql');
    _container = container;
    const I = ICONS();

    _container.innerHTML = `
      <div class="sfdt-panel sfdt-panel-bottom" id="sfdt-soql">
        <div class="sfdt-panel-header">
          <div class="sfdt-panel-title">
            ${I.database}
            <span>SOQL Query Tool</span>
          </div>
          <div class="sfdt-panel-actions">
            <button class="sfdt-btn sfdt-btn-sm soql-tab active" data-tab="editor">Editor</button>
            <button class="sfdt-btn sfdt-btn-sm soql-tab" data-tab="databuilder">Data Builder</button>
            <button class="sfdt-btn sfdt-btn-sm soql-tab" data-tab="examples">Examples</button>
            <div class="sfdt-history-hover-wrap" id="soql-history-wrap">
              <button class="sfdt-btn sfdt-btn-sm" id="soql-history-btn">History</button>
              <div class="sfdt-history-dropdown" id="soql-history-dropdown"></div>
            </div>
            <button class="sfdt-btn sfdt-btn-sm soql-tab" data-tab="favorites">Favorites</button>
            <button class="sfdt-btn sfdt-btn-sm soql-tab" data-tab="templates">Templates</button>
            <span class="sfdt-soql-divider">|</span>
            <button class="sfdt-btn sfdt-btn-sm" id="soql-newtab" title="Run query in browser via REST API">${I.maximize} Query API</button>
            <button class="sfdt-btn sfdt-btn-sm" id="soql-resize" title="Toggle size">${I.maximize}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-pin-btn" id="soql-pin" title="Pin panel open">${I.pin}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="soql-close" title="Close panel">${I.x} Close</button>
          </div>
        </div>
        <div class="sfdt-soql-tabbar" id="soql-tabbar">
          <div class="sfdt-soql-tabbar-tabs" id="soql-tabbar-tabs"></div>
          <button class="sfdt-btn sfdt-btn-sm sfdt-soql-tab-add" id="soql-tab-add" title="New query tab (Ctrl+T)">+</button>
        </div>
        <div class="sfdt-soql-content">
          <div class="sfdt-soql-editor-area" id="soql-editor-area">
            <div class="sfdt-soql-editor-wrapper">
              <pre class="sfdt-soql-highlight" id="soql-highlight" aria-hidden="true"></pre>
              <textarea class="sfdt-soql-editor" id="soql-editor"
                        placeholder="SELECT Id, Name FROM Account LIMIT 10&#10;&#10;Tip: Press Ctrl+Enter to run query"
                        spellcheck="false" autocomplete="off"></textarea>
              <div class="sfdt-autocomplete" id="soql-autocomplete"></div>
            </div>
            <div class="sfdt-soql-toolbar">
              <button class="sfdt-btn sfdt-btn-primary" id="soql-run" title="Run Query (Ctrl+Enter)">${I.play} Run</button>
              <button class="sfdt-btn" id="soql-tooling" title="Run as Tooling API query (Ctrl+Shift+Enter)">${I.wrench} Tooling</button>
              <button class="sfdt-btn" id="soql-sosl" title="Run as SOSL search">${I.search || I.eye} SOSL</button>
              <button class="sfdt-btn" id="soql-apex" title="Execute as Anonymous Apex">${I.bolt} Apex</button>
              <span class="sfdt-soql-divider">|</span>
              <button class="sfdt-btn" id="soql-explain" title="Query Plan / EXPLAIN">${I.chart} Explain</button>
              <button class="sfdt-btn" id="soql-analyze" title="Analyze query">${I.chart} Analyze</button>
              <button class="sfdt-btn" id="soql-format" title="Format query (Ctrl+Shift+F)">${I.code} Format</button>
              <button class="sfdt-btn" id="soql-select-all" title="Insert all fields (Ctrl+Space)">✦ Fields</button>
              <button class="sfdt-btn" id="soql-save-fav" title="Save to favorites (Ctrl+S)">${I.star} Save</button>
              <span class="sfdt-soql-divider">|</span>
              <button class="sfdt-btn" id="soql-csv" title="Export CSV" disabled>CSV</button>
              <button class="sfdt-btn" id="soql-json" title="Export JSON" disabled>JSON</button>
              <button class="sfdt-btn" id="soql-clipboard" title="Copy to clipboard" disabled>${I.copy} Copy</button>
              <button class="sfdt-btn" id="soql-export-all" title="Export all records (beyond 2000)" disabled style="display:none">⬇ Export All</button>
              <button class="sfdt-btn" id="soql-import" title="Bulk data import">${I.database} Import</button>
              <button class="sfdt-btn" id="soql-schema" title="Schema Explorer">🔎 Schema</button>
              <span class="sfdt-soql-divider">|</span>
              <button class="sfdt-btn" id="soql-local-time" title="Toggle local time conversion">🕐 Local Time</button>
              <button class="sfdt-btn" id="soql-diff" title="Query diff/compare">⇔ Diff</button>
            </div>
            <div class="sfdt-field-hints" id="soql-field-hints">
              <div class="sfdt-field-hints-title" id="soql-field-hints-title">Available Fields</div>
              <div class="sfdt-field-hints-list" id="soql-field-hints-list"></div>
            </div>
            <div class="sfdt-soql-hints" id="soql-hints"></div>
          </div>
          <div class="sfdt-soql-results" id="soql-results">
            <div class="sfdt-soql-placeholder">
              <div style="margin-bottom:12px;font-size:15px;color:#58a6ff;font-weight:600">SOQL Query Tool</div>
              <div style="margin-bottom:8px;color:#8b949e">Write a SOQL query and press <strong style="color:#e1e4e8">Ctrl+Enter</strong> to execute.</div>
              <div style="color:#6e7681;font-size:12px">Check the <strong>Examples</strong> tab for sample queries to get started.</div>
            </div>
          </div>
          <div class="sfdt-soql-history-area" id="soql-history-area" style="display:none"></div>
          <div class="sfdt-soql-favorites-area" id="soql-favorites-area" style="display:none"></div>
          <div class="sfdt-soql-examples-area" id="soql-examples-area" style="display:none"></div>
          <div class="sfdt-soql-templates-area" id="soql-templates-area" style="display:none"></div>
          <div class="sfdt-soql-schema-sidebar" id="soql-schema-sidebar" style="display:none">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border)">
              <span style="font-weight:600;font-size:13px;color:#e1e4e8">🔎 Schema Explorer</span>
              <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="soql-schema-close" title="Close">${I.x}</button>
            </div>
            <div style="padding:6px 12px">
              <input type="text" id="soql-schema-search" placeholder="Search objects..."
                style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;outline:none" />
            </div>
            <div id="soql-schema-tree" style="overflow-y:auto;flex:1;padding:4px 0"></div>
          </div>
          <div class="sfdt-soql-databuilder-area" id="soql-databuilder-area" style="display:none"></div>
        </div>
        <div class="sfdt-panel-footer" id="soql-status">
          <span id="soql-status-text">Ready</span>
        </div>
      </div>
    `;

    _panel = _container.querySelector('#sfdt-soql');
    _editor = _container.querySelector('#soql-editor');
    _resultsContainer = _container.querySelector('#soql-results');
    _statusBar = _container.querySelector('#soql-status-text');
    _autocompleteDropdown = _container.querySelector('#soql-autocomplete');

    _container.querySelector('#soql-close').addEventListener('click', hide);
    _container.querySelector('#soql-pin').addEventListener('click', _togglePin);
    _container.querySelector('#soql-run').addEventListener('click', _runQuery);
    _container.querySelector('#soql-tooling').addEventListener('click', _runToolingQuery);
    _container.querySelector('#soql-sosl').addEventListener('click', _runSOSLQuery);
    _container.querySelector('#soql-apex').addEventListener('click', _executeAnonymousApex);
    _container.querySelector('#soql-explain').addEventListener('click', _explainQuery);
    _container.querySelector('#soql-analyze').addEventListener('click', _analyzeQuery);
    _container.querySelector('#soql-format').addEventListener('click', _formatQuery);
    _container.querySelector('#soql-select-all').addEventListener('click', _selectAllFields);
    _container.querySelector('#soql-save-fav').addEventListener('click', _saveFavorite);
    _container.querySelector('#soql-csv').addEventListener('click', _exportCSV);
    _container.querySelector('#soql-json').addEventListener('click', _exportJSON);
    _container.querySelector('#soql-clipboard').addEventListener('click', _copyToClipboard);
    _container.querySelector('#soql-export-all').addEventListener('click', _bulkExportAll);
    _container.querySelector('#soql-import').addEventListener('click', _showBulkImport);
    _container.querySelector('#soql-local-time').addEventListener('click', _toggleLocalTime);
    _container.querySelector('#soql-schema').addEventListener('click', _toggleSchemaExplorer);
    _container.querySelector('#soql-schema-close').addEventListener('click', () => {
      _container.querySelector('#soql-schema-sidebar').style.display = 'none';
    });
    _container.querySelector('#soql-diff').addEventListener('click', _showQueryDiff);
    _container.querySelector('#soql-resize').addEventListener('click', _toggleSize);
    _container.querySelector('#soql-newtab').addEventListener('click', _openInNewTab);
    _container.querySelector('#soql-tab-add').addEventListener('click', _addQueryTab);

    // Initialize drag-to-resize
    SHADOW().initPanelResize(_panel, 'top', 'sfdt_soql_height');

    _container.querySelectorAll('.soql-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _container.querySelectorAll('.soql-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _switchTab(tab.dataset.tab);
      });
    });

    _editor.addEventListener('keydown', _onEditorKeyDown);
    _editor.addEventListener('input', _onEditorInput);
    _editor.addEventListener('scroll', () => {
      const highlight = _container.querySelector('#soql-highlight');
      if (highlight) { highlight.scrollTop = _editor.scrollTop; highlight.scrollLeft = _editor.scrollLeft; }
    });

    // Click outside field hints to close them
    _container.addEventListener('click', (e) => {
      const hintsPanel = _container.querySelector('#soql-field-hints');
      if (hintsPanel && hintsPanel.classList.contains('visible') && !hintsPanel.contains(e.target)) {
        _hideFieldHints();
      }
    });

    // History hover dropdown
    _initHistoryHoverDropdown();

    // Initialize multi-tab system
    _initQueryTabs();
  }

  let _historyDropdownTimeout = null;

  function _initHistoryHoverDropdown() {
    const wrap = _container.querySelector('#soql-history-wrap');
    const dropdown = _container.querySelector('#soql-history-dropdown');

    wrap.addEventListener('mouseenter', () => {
      clearTimeout(_historyDropdownTimeout);
      _renderHistoryDropdown();
      dropdown.style.display = 'block';
    });

    wrap.addEventListener('mouseleave', () => {
      _historyDropdownTimeout = setTimeout(() => {
        dropdown.style.display = 'none';
      }, 300);
    });

    dropdown.addEventListener('mouseenter', () => {
      clearTimeout(_historyDropdownTimeout);
    });

    dropdown.addEventListener('mouseleave', () => {
      _historyDropdownTimeout = setTimeout(() => {
        dropdown.style.display = 'none';
      }, 300);
    });
  }

  function _renderHistoryDropdown() {
    const dropdown = _container.querySelector('#soql-history-dropdown');
    const history = QS().getHistory();
    const I = ICONS();

    if (history.length === 0) {
      dropdown.innerHTML = '<div style="padding:20px;text-align:center;color:#6e7681;font-size:12px">No query history yet.<br>Run a query and it will appear here.</div>';
      return;
    }

    dropdown.innerHTML = `
      <div class="sfdt-hd-header">
        <span style="font-weight:600;color:#58a6ff;font-size:12px">Query History (${history.length})</span>
        <button class="sfdt-btn sfdt-btn-sm" id="soql-hd-clear">${I.x} Clear</button>
      </div>
      <div class="sfdt-hd-list">
        ${history.slice(0, 30).map((h, i) => `
          <div class="sfdt-hd-item" data-index="${i}">
            <div class="sfdt-hd-item-main">
              <span class="sfdt-hd-status" style="color:${h.success ? '#22c55e' : '#f85149'}">${h.success ? '✓' : '✕'}</span>
              <pre class="sfdt-hd-query">${_esc(h.query)}</pre>
            </div>
            <div class="sfdt-hd-item-meta">
              <span>${h.resultCount || 0} records</span>
              <span>${h.executionTime}ms</span>
              <span>${_formatTime(h.timestamp)}</span>
              <button class="sfdt-btn sfdt-btn-sm sfdt-hd-remove" data-index="${i}" title="Remove">${I.x}</button>
            </div>
          </div>
        `).join('')}
        ${history.length > 30 ? `<div style="padding:8px 12px;text-align:center;color:#383e4a;font-size:11px">+${history.length - 30} more — open History tab to see all</div>` : ''}
      </div>
    `;

    // Clear all
    dropdown.querySelector('#soql-hd-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      QS().clearHistory();
      _renderHistoryDropdown();
    });

    // Click item to load query
    dropdown.querySelectorAll('.sfdt-hd-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index, 10);
        _editor.value = history[idx].query;
        _updateHighlight();
        _editor.focus();
        dropdown.style.display = 'none';
        // Switch to editor tab if not already
        if (_activeTab !== 'editor') {
          _container.querySelectorAll('.soql-tab').forEach(t => t.classList.remove('active'));
          _container.querySelector('[data-tab="editor"]').classList.add('active');
          _switchTab('editor');
        }
        _statusBar.textContent = `Loaded query from history`;
      });
    });

    // Remove individual item
    dropdown.querySelectorAll('.sfdt-hd-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        QS().removeHistoryItem(idx);
        _renderHistoryDropdown();
      });
    });
  }

  function _switchTab(tab) {
    _activeTab = tab;
    _container.querySelectorAll('.soql-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    const isEditor = (tab === 'editor');
    _container.querySelector('#soql-editor-area').style.display = isEditor ? '' : 'none';
    _resultsContainer.style.display = isEditor ? '' : 'none';
    _container.querySelector('#soql-history-area').style.display = tab === 'history' ? '' : 'none';
    _container.querySelector('#soql-favorites-area').style.display = tab === 'favorites' ? '' : 'none';
    _container.querySelector('#soql-examples-area').style.display = tab === 'examples' ? '' : 'none';
    _container.querySelector('#soql-templates-area').style.display = tab === 'templates' ? '' : 'none';
    _container.querySelector('#soql-databuilder-area').style.display = tab === 'databuilder' ? '' : 'none';

    if (tab === 'history') _renderHistory();
    if (tab === 'favorites') _renderFavorites();
    if (tab === 'examples') _renderExamples();
    if (tab === 'templates') _renderTemplates();
    if (tab === 'databuilder') _renderDataBuilder();
  }

  function _openInNewTab() {
    const soql = _editor.value.trim();
    const instanceUrl = window.SalesforceAPI.getInstanceUrl();
    if (soql) {
      // Open Salesforce Query Editor with query pre-filled via the REST Explorer
      const encoded = encodeURIComponent(soql);
      const queryUrl = `${instanceUrl}/services/data/${window.SalesforceAPI.API_VERSION}/query?q=${encoded}`;
      window.open(queryUrl, '_blank');
    } else {
      window.open(`${instanceUrl}/_ui/search/ui/UnifiedSearchResults`, '_blank');
    }
  }

  function _onEditorKeyDown(e) {
    // Ctrl+Shift+Enter → Tooling query
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      _track('keyboard');
      _runToolingQuery();
      return;
    }
    // Ctrl+Enter → Run query
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      _track('keyboard');
      _runQuery();
      return;
    }
    // Ctrl+Space → Select All Fields
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault();
      _track('keyboard');
      _selectAllFields();
      return;
    }
    // Ctrl+T → New query tab
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
      e.preventDefault();
      _track('keyboard');
      _addQueryTab();
      return;
    }
    // Ctrl+W → Close current query tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      if (_queryTabs.length > 1) {
        e.preventDefault();
        _closeQueryTab(_activeQueryTabId);
        return;
      }
    }
    // Ctrl+L → Clear editor
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      _editor.value = '';
      _updateHighlight();
      _statusBar.textContent = 'Editor cleared';
      return;
    }
    // Ctrl+S → Save to favorites
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      _saveFavorite();
      return;
    }
    // Ctrl+Shift+F → Format query
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      _formatQuery();
      return;
    }
    // Ctrl+D → Duplicate current line
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      _duplicateLine();
      return;
    }
    // Ctrl+/ → Toggle comment
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      _toggleComment();
      return;
    }
    // ? key (when editor is empty or at start) → show shortcuts
    if (e.key === '?' && _editor.value.trim() === '') {
      e.preventDefault();
      _showShortcutHelp();
      return;
    }

    if (_autocompleteDropdown.style.display === 'block') {
      if (e.key === 'ArrowDown') { e.preventDefault(); _suggestionIndex = Math.min(_suggestionIndex + 1, _currentSuggestions.length - 1); _suggestionNavigated = true; _updateSuggestionSelection(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); _suggestionIndex = Math.max(_suggestionIndex - 1, 0); _suggestionNavigated = true; _updateSuggestionSelection(); return; }
      if (e.key === 'Tab') {
        // Tab always accepts the highlighted suggestion.
        if (_suggestionIndex >= 0 && _currentSuggestions[_suggestionIndex]) { e.preventDefault(); _applySuggestion(_currentSuggestions[_suggestionIndex]); return; }
      }
      if (e.key === 'Enter') {
        // Only accept with Enter once the user has explicitly moved through the
        // list — otherwise Enter should insert a newline, not the default item.
        if (_suggestionNavigated && _suggestionIndex >= 0 && _currentSuggestions[_suggestionIndex]) { e.preventDefault(); _applySuggestion(_currentSuggestions[_suggestionIndex]); return; }
        _hideAutocomplete();
      }
      if (e.key === 'Escape') { e.preventDefault(); _hideAutocomplete(); return; }
    }

    // Escape also closes field hints
    if (e.key === 'Escape') { _hideFieldHints(); }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const start = _editor.selectionStart;
      _editor.value = _editor.value.substring(0, start) + '  ' + _editor.value.substring(_editor.selectionEnd);
      _editor.selectionStart = _editor.selectionEnd = start + 2;
      _updateHighlight();
    }
  }

  // ─── Syntax Highlighting ───
  const SOQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST|WITH|TYPEOF|USING\s+SCOPE|FOR\s+VIEW|FOR\s+REFERENCE|FOR\s+UPDATE|INCLUDES|EXCLUDES|ABOVE|AT|BELOW|ABOVE_OR_BELOW|ROLLUP|CUBE|TRUE|FALSE|NULL|LAST_N_DAYS|NEXT_N_DAYS|TODAY|YESTERDAY|TOMORROW|LAST_WEEK|THIS_WEEK|NEXT_WEEK|LAST_MONTH|THIS_MONTH|NEXT_MONTH|LAST_YEAR|THIS_YEAR|NEXT_YEAR|LAST_90_DAYS|NEXT_90_DAYS|LAST_N_MONTHS|NEXT_N_MONTHS|LAST_N_YEARS|NEXT_N_YEARS|COUNT|AVG|SUM|MIN|MAX|COUNT_DISTINCT|CALENDAR_MONTH|CALENDAR_YEAR|DAY_IN_MONTH|DAY_IN_WEEK|DAY_IN_YEAR|DAY_ONLY|HOUR_IN_DAY|FISCAL_MONTH|FISCAL_QUARTER|FISCAL_YEAR|WEEK_IN_MONTH|WEEK_IN_YEAR|toLabel|convertCurrency|FORMAT|DISTANCE|GEOLOCATION|FIND|RETURNING|IN\s+ALL\s+FIELDS|IN\s+NAME\s+FIELDS|IN\s+EMAIL\s+FIELDS|IN\s+PHONE\s+FIELDS|IN\s+SIDEBAR\s+FIELDS|WITH\s+DIVISION|WITH\s+DATA\s+CATEGORY|WITH\s+NETWORK|WITH\s+SNIPPET|WITH\s+HIGHLIGHT)\b/gi;
  const SOQL_STRINGS = /'[^']*'/g;
  const SOQL_NUMBERS = /\b\d+(\.\d+)?\b/g;
  const SOQL_OPERATORS = /(\b(!=|<=|>=|<|>|=)\b|:)/g;

  function _updateHighlight() {
    const highlight = _container ? _container.querySelector('#soql-highlight') : null;
    if (!highlight || !_editor) return;
    const text = _editor.value;
    if (!text) { highlight.innerHTML = '\n'; return; }

    // Escape HTML first
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Tokenize: protect strings first, then highlight keywords/numbers
    const tokens = [];
    html = html.replace(SOQL_STRINGS, m => { const id = `__STR${tokens.length}__`; tokens.push(`<span class="sfdt-hl-string">${m}</span>`); return id; });
    html = html.replace(SOQL_KEYWORDS, m => `<span class="sfdt-hl-keyword">${m.toUpperCase()}</span>`);
    html = html.replace(SOQL_NUMBERS, m => `<span class="sfdt-hl-number">${m}</span>`);
    // Restore string tokens
    tokens.forEach((t, i) => { html = html.replace(`__STR${i}__`, t); });

    highlight.innerHTML = html + '\n';
    // Sync scroll
    highlight.scrollTop = _editor.scrollTop;
    highlight.scrollLeft = _editor.scrollLeft;
  }

  let _autocompleteTimer = null;
  function _onEditorInput() {
    // The textarea text is transparent — the syntax-highlight overlay is the
    // only visible text. Update it synchronously so what the user sees always
    // matches the caret; otherwise deletes/edits appear to hit the wrong line.
    _updateHighlight();
    clearTimeout(_autocompleteTimer);
    _autocompleteTimer = setTimeout(() => {
      _showAutocomplete();
      _showFieldHintsIfNeeded();
    }, 120);
  }

  let _fieldHintsCache = {};

  async function _showFieldHintsIfNeeded() {
    const text = _editor.value;
    const cursor = _editor.selectionStart;
    const beforeCursor = text.substring(0, cursor);
    const objectMatch = text.match(/FROM\s+(\w+)/i);
    if (!objectMatch) { _hideFieldHints(); return; }

    // Check if cursor is in SELECT clause (before FROM) and last non-space char is comma
    const fromIdx = text.search(/\bFROM\b/i);
    if (fromIdx >= 0 && cursor > fromIdx) { _hideFieldHints(); return; }

    const trimmed = beforeCursor.replace(/\s+$/, '');
    // Show field hints after comma, or after SELECT keyword
    const afterComma = /,\s*$/.test(beforeCursor) || /\bSELECT\s+$/i.test(beforeCursor);
    if (!afterComma) { _hideFieldHints(); return; }

    const objName = objectMatch[1];
    const hintsPanel = _container.querySelector('#soql-field-hints');
    const hintsList = _container.querySelector('#soql-field-hints-list');
    const hintsTitle = _container.querySelector('#soql-field-hints-title');

    // Show loading state while fetching fields
    if (!_fieldHintsCache[objName]) {
      hintsTitle.textContent = `Loading ${objName} fields...`;
      hintsList.innerHTML = '<span class="sfdt-field-chip" style="color:var(--fg3);border:none;cursor:default;animation:sfdt-pulse 1.2s infinite">⏳ Fetching field list...</span>';
      hintsPanel.classList.add('visible');
      _fieldHintsCache[objName] = await QS().getFieldSuggestions(objName);
    }
    const fields = _fieldHintsCache[objName];
    if (!fields || fields.length === 0) { _hideFieldHints(); return; }

    // Parse already-selected fields from the SELECT clause
    const selectPart = text.substring(0, fromIdx);
    const selectedFields = selectPart.replace(/^SELECT\s+/i, '').split(',').map(f => f.trim().toLowerCase()).filter(Boolean);

    // Filter out already selected fields
    const remaining = fields.filter(f => !selectedFields.includes(f.name.toLowerCase()));

    hintsTitle.textContent = `${objName} Fields (${remaining.length} available)`;
    hintsList.innerHTML = remaining.slice(0, 80).map(f =>
      `<span class="sfdt-field-chip" data-field="${_esc(f.name)}" title="${_esc(f.label || f.name)} (${f.type})">${_esc(f.name)}<span class="sfdt-field-chip-type">${_esc(f.type)}</span></span>`
    ).join('');
    hintsPanel.classList.add('visible');

    // Click field chip to insert
    hintsList.querySelectorAll('.sfdt-field-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const fieldName = chip.dataset.field;
        const cursorPos = _editor.selectionStart;
        const before = _editor.value.substring(0, cursorPos);
        const after = _editor.value.substring(cursorPos);
        // Add space if needed
        const needsSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith(',');
        const insert = (needsSpace ? ' ' : '') + fieldName;
        _editor.value = before + insert + after;
        _editor.selectionStart = _editor.selectionEnd = cursorPos + insert.length;
        _editor.focus();
        _updateHighlight();
        _showFieldHintsIfNeeded();
      });
    });
  }

  function _hideFieldHints() {
    const hintsPanel = _container.querySelector('#soql-field-hints');
    if (hintsPanel) hintsPanel.classList.remove('visible');
  }

  async function _showAutocomplete() {
    const text = _editor.value;
    const cursor = _editor.selectionStart;
    const beforeCursor = text.substring(0, cursor);

    // Don't interrupt editing inside an existing word (common when tweaking a
    // pasted query). Only suggest when the caret is at the end of a token.
    if (/^\w/.test(text.substring(cursor))) { _hideAutocomplete(); return; }

    // Match the current word being typed — could be after comma+space
    const wordMatch = beforeCursor.match(/(\w+)$/);
    const currentWord = wordMatch ? wordMatch[1] : '';

    if (currentWord.length < 2) { _hideAutocomplete(); return; }

    let suggestions = [];

    // Check for relationship field suggestions (e.g. "Account.")
    const relMatch = beforeCursor.match(/(\w+)\.\s*(\w*)$/);
    if (relMatch && _schemaCache[relMatch[1]]) {
      const prefix = relMatch[2] || '';
      suggestions = _schemaCache[relMatch[1]]
        .filter(function(f) { return f.name.toLowerCase().startsWith(prefix.toLowerCase()); })
        .slice(0, 15)
        .map(function(f) { return { text: f.name, label: f.name + ' (' + f.type + ')', type: 'rel-field' }; });
      if (suggestions.length > 0) {
        _currentSuggestions = suggestions;
        _suggestionIndex = 0;
        _renderAutocompleteSuggestions(suggestions);
        return;
      }
    }

    // Check for picklist value context (WHERE Field = '')
    const picklistMatch = beforeCursor.match(/WHERE\s+.*?(\w+)\s*=\s*'(\w*)$/i) || beforeCursor.match(/AND\s+(\w+)\s*=\s*'(\w*)$/i) || beforeCursor.match(/OR\s+(\w+)\s*=\s*'(\w*)$/i);
    if (picklistMatch) {
      const fieldName = picklistMatch[1];
      const objectMatch = text.match(/FROM\s+(\w+)/i);
      if (objectMatch) {
        const pvs = await _getPicklistValues(objectMatch[1], fieldName);
        if (pvs.length > 0) {
          const partial = picklistMatch[2] || '';
          suggestions = pvs
            .filter(function(v) { return v.value.toLowerCase().startsWith(partial.toLowerCase()); })
            .slice(0, 15)
            .map(function(v) { return { text: v.value + "'", label: v.value + (v.label !== v.value ? ' (' + v.label + ')' : ''), type: 'picklist' }; });
          if (suggestions.length > 0) {
            _currentSuggestions = suggestions;
            _suggestionIndex = 0;
            _renderAutocompleteSuggestions(suggestions);
            return;
          }
        }
      }
    }

    const fromMatch = beforeCursor.match(/FROM\s+(\w*)$/i);
    if (fromMatch) {
      const objSuggestions = await QS().getObjectSuggestions(fromMatch[1]);
      suggestions = objSuggestions.map(o => ({ text: o.name, label: o.label || o.name, type: 'object' }));
    } else {
      const objectMatch = text.match(/FROM\s+(\w+)/i);
      if (objectMatch) {
        // Check if we're in the SELECT clause (before FROM keyword)
        const fromIdx = text.search(/\bFROM\b/i);
        const inSelectClause = fromIdx < 0 || cursor <= fromIdx;

        const fieldSuggestions = await QS().getFieldSuggestions(objectMatch[1]);
        suggestions = fieldSuggestions
          .filter(f => f.name.toLowerCase().includes(currentWord.toLowerCase()))
          .slice(0, 15)
          .map(f => ({ text: f.name, label: `${f.name} (${f.type})`, type: 'field' }));
      }
      // Only add keyword suggestions when not clearly typing a field name after comma
      const afterComma = /,\s*\w*$/.test(beforeCursor);
      if (!afterComma) {
        const kwSuggestions = QS().getKeywordSuggestions()
          .filter(k => k.toLowerCase().startsWith(currentWord.toLowerCase()))
          .slice(0, 5)
          .map(k => ({ text: k, label: k, type: 'keyword' }));
        suggestions = [...suggestions, ...kwSuggestions];
      }
    }

    if (suggestions.length === 0) { _hideAutocomplete(); return; }

    _currentSuggestions = suggestions;
    _suggestionIndex = 0;
    _renderAutocompleteSuggestions(suggestions);
  }

  function _renderAutocompleteSuggestions(suggestions) {
    _autocompleteDropdown.innerHTML = suggestions.map((s, i) => `
      <div class="sfdt-ac-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
        <span class="sfdt-ac-text">${_esc(s.label)}</span>
        <span class="sfdt-ac-type">${_esc(s.type)}</span>
      </div>
    `).join('');

    _autocompleteDropdown.style.display = 'block';
    _suggestionNavigated = false;
    _autocompleteDropdown.querySelectorAll('.sfdt-ac-item').forEach(el => {
      el.addEventListener('click', () => _applySuggestion(_currentSuggestions[parseInt(el.dataset.index, 10)]));
    });
  }

  function _hideAutocomplete() {
    if (_autocompleteDropdown) _autocompleteDropdown.style.display = 'none';
    _currentSuggestions = [];
    _suggestionIndex = -1;
    _suggestionNavigated = false;
  }

  function _updateSuggestionSelection() {
    const items = _autocompleteDropdown.querySelectorAll('.sfdt-ac-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === _suggestionIndex));
  }

  function _applySuggestion(suggestion) {
    const cursor = _editor.selectionStart;
    const text = _editor.value;
    // Replace the whole identifier surrounding the caret — both the part before
    // AND the part after it — so editing inside an existing token replaces it
    // instead of appending and leaving the tail behind.
    const before = text.substring(0, cursor).match(/\w+$/);
    const after = text.substring(cursor).match(/^\w+/);
    const start = before ? cursor - before[0].length : cursor;
    const end = after ? cursor + after[0].length : cursor;
    _editor.value = text.substring(0, start) + suggestion.text + text.substring(end);
    _editor.selectionStart = _editor.selectionEnd = start + suggestion.text.length;
    _editor.focus();
    _hideAutocomplete();
    _updateHighlight();
  }

  function _updateRunBadge(count) {
    const runBtn = _container ? _container.querySelector('#soql-run') : null;
    if (!runBtn) return;
    const I = ICONS();
    if (count != null && count > 0) {
      runBtn.innerHTML = `${I.play} Run <span class="sfdt-run-badge">${count}</span>`;
    } else {
      runBtn.innerHTML = `${I.play} Run`;
    }
  }

  function _isToolingObject(objName) {
    return objName && TOOLING_OBJECTS.has(objName.toLowerCase());
  }

  async function _runQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    _track('run');
    _queriedSObjectType = _extractSObjectType(soql);
    _clearNonQueryResults();

    // Auto-detect Tooling API objects
    if (_isToolingObject(_queriedSObjectType)) {
      _isToolingQuery = true;
      _statusBar.textContent = `Executing tooling query (auto-detected ${_queriedSObjectType})...`;
    } else {
      _isToolingQuery = false;
      _statusBar.textContent = 'Executing query...';
    }

    _updateRunBadge(null);
    _resultsContainer.innerHTML = `<div class="sfdt-soql-loading">Running ${_isToolingQuery ? 'tooling ' : ''}query...</div>`;
    try {
      const result = _isToolingQuery ? await QS().executeToolingQuery(soql) : await QS().executeQuery(soql);
      _displayResults(result);
    } catch (err) {
      _resultsContainer.innerHTML = `<div class="sfdt-soql-error">
        <div class="sfdt-soql-error-title">Query Error</div>
        <div class="sfdt-soql-error-msg">${_esc(err && err.message ? err.message : String(err))}</div>
      </div>`;
      _statusBar.textContent = 'Error';
      _setExportEnabled(false);
      _updateRunBadge(null);
    }
  }

  async function _runToolingQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    _queriedSObjectType = _extractSObjectType(soql);
    _isToolingQuery = true;
    _updateRunBadge(null);
    _statusBar.textContent = 'Executing tooling query...';
    _resultsContainer.innerHTML = '<div class="sfdt-soql-loading">Running tooling query...</div>';
    try {
      const result = await QS().executeToolingQuery(soql);
      _displayResults(result);
    } catch (err) {
      _resultsContainer.innerHTML = `<div class="sfdt-soql-error">
        <div class="sfdt-soql-error-title">Query Error</div>
        <div class="sfdt-soql-error-msg">${_esc(err && err.message ? err.message : String(err))}</div>
      </div>`;
      _statusBar.textContent = 'Error';
      _setExportEnabled(false);
      _updateRunBadge(null);
    }
  }

  function _displayResults(result) {
    if (!result.success) {
      _resultsContainer.innerHTML = `<div class="sfdt-soql-error">
        <div class="sfdt-soql-error-title">Query Error</div>
        <div class="sfdt-soql-error-msg">${_esc(result.error)}</div>
      </div>`;
      _statusBar.textContent = `Error (${result.executionTime}ms)`;
      _setExportEnabled(false);
      _updateRunBadge(null);
      return;
    }

    _lastResults = result;
    _statusBar.textContent = `${result.totalSize} record${result.totalSize !== 1 ? 's' : ''} (${result.executionTime}ms)`;
    _setExportEnabled(result.records.length > 0);
    _updateRunBadge(result.totalSize);

    // Update current tab with result count and auto-name
    const currentTab = _queryTabs.find(t => t.id === _activeQueryTabId);
    if (currentTab) {
      currentTab.resultCount = result.totalSize;
      _autoNameTab();
    }

    if (result.records.length === 0) {
      _resultsContainer.innerHTML = '<div class="sfdt-soql-empty">No records returned</div>';
      return;
    }

    // Flatten nested relationship fields into dot-notation columns
    const flatRecords = result.records.map(r => _flattenRecord(r));
    const keys = _collectKeys(flatRecords);

    _resultsContainer.innerHTML = `
      <div class="sfdt-soql-result-info">
        <span>${result.totalSize} total records</span>
        <span>Showing ${result.records.length}</span>
        <span>Execution: ${result.executionTime}ms</span>
        <button class="sfdt-btn sfdt-btn-sm" id="soql-expand-all" title="Expand/Collapse all rows">Expand All</button>
        ${_queriedSObjectType && !_isToolingQuery ? `<button class="sfdt-btn sfdt-btn-sm sfdt-btn-create" id="soql-create-new" title="Create new ${_esc(_queriedSObjectType)} record">+ New</button>` : ''}
        ${!result.done ? '<button class="sfdt-btn sfdt-btn-sm" id="soql-more">Load More</button>' : ''}
        ${!result.done && result.totalSize > result.records.length ? '<button class="sfdt-btn sfdt-btn-sm" id="soql-export-all-inline" title="Export all records to CSV">⬇ Export All (' + result.totalSize + ')</button>' : ''}
      </div>
      <div style="overflow-x:auto !important;flex:1 !important">
        <table class="sfdt-soql-table">
          <thead><tr><th style="width:20px;min-width:20px;padding:0"></th>${keys.map(k => `<th class="sfdt-sortable-th" data-sort-key="${_esc(k)}" style="cursor:pointer" title="Click to sort">${_esc(k)} <span class="sfdt-sort-icon" style="color:var(--fg3);font-size:10px"></span></th>`).join('')}${_queriedSObjectType && !_isToolingQuery ? '<th class="sfdt-actions-th">Actions</th>' : ''}</tr></thead>
          <tbody>
            ${flatRecords.map((r, ri) => _renderRow(r, keys, ri)).join('')}
          </tbody>
        </table>
      </div>
    `;

    const moreBtn = _resultsContainer.querySelector('#soql-more');
    if (moreBtn && result.nextRecordsUrl) {
      moreBtn.addEventListener('click', () => _loadMore(result.nextRecordsUrl));
    }

    // Expand All toggle
    const expandBtn = _resultsContainer.querySelector('#soql-expand-all');
    let allExpanded = false;
    expandBtn.addEventListener('click', () => {
      allExpanded = !allExpanded;
      expandBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';
      _resultsContainer.querySelectorAll('.sfdt-row-detail').forEach(el => {
        el.style.display = allExpanded ? 'table-row' : 'none';
      });
      _resultsContainer.querySelectorAll('.sfdt-row-toggle').forEach(el => {
        el.textContent = allExpanded ? '▾' : '▸';
      });
    });

    // Row expand/collapse — now handled in _bindRowEvents

    // Copy on click for regular cells
    _resultsContainer.querySelectorAll('.sfdt-copyable').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('input')) return;
        navigator.clipboard.writeText(el.dataset.copy || el.textContent).catch(() => {});
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 800);
      });
    });

    // CRUD: Create New button
    const createBtn = _resultsContainer.querySelector('#soql-create-new');
    if (createBtn) {
      createBtn.addEventListener('click', () => _showRecordEditor('create', null, keys));
    }

    // CRUD: Row action buttons
    _resultsContainer.querySelectorAll('.sfdt-row-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const ri = parseInt(btn.dataset.row, 10);
        const record = flatRecords[ri];
        if (!record) return;

        if ((action === 'edit' || action === 'delete' || action === 'clone') && !_confirmProdDML(action)) return;

        switch (action) {
          case 'edit': _showRecordEditor('edit', record, keys); break;
          case 'clone': _showRecordEditor('clone', record, keys); break;
          case 'delete': _deleteRecord(record.Id || record.id); break;
        }
      });
    });

    // Column sorting
    let _sortKey = null;
    let _sortAsc = true;
    _resultsContainer.querySelectorAll('.sfdt-sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        _track('sort');
        const key = th.dataset.sortKey;
        if (_sortKey === key) { _sortAsc = !_sortAsc; } else { _sortKey = key; _sortAsc = true; }
        flatRecords.sort((a, b) => {
          const va = a[key], vb = b[key];
          if (va == null && vb == null) return 0;
          if (va == null) return _sortAsc ? 1 : -1;
          if (vb == null) return _sortAsc ? -1 : 1;
          if (typeof va === 'number' && typeof vb === 'number') return _sortAsc ? va - vb : vb - va;
          return _sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
        // Re-render tbody
        const tbody = _resultsContainer.querySelector('.sfdt-soql-table tbody');
        if (tbody) tbody.innerHTML = flatRecords.map((r, ri) => _renderRow(r, keys, ri)).join('');
        // Update sort indicators
        _resultsContainer.querySelectorAll('.sfdt-sort-icon').forEach(icon => icon.textContent = '');
        th.querySelector('.sfdt-sort-icon').textContent = _sortAsc ? '▲' : '▼';
        // Re-bind row events
        _bindRowEvents(flatRecords, keys);
      });
    });

    // Inline export all
    const exportAllBtn = _resultsContainer.querySelector('#soql-export-all-inline');
    if (exportAllBtn) {
      exportAllBtn.addEventListener('click', _bulkExportAll);
    }

    // Enable inline editing on double-click
    _bindRowEvents(flatRecords, keys);

    // Render chart for aggregate queries
    _renderResultChart(flatRecords, keys);
  }

  function _bindRowEvents(flatRecords, keys) {
    // Row expand/collapse
    _resultsContainer.querySelectorAll('.sfdt-row-main').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('input')) return;
        const idx = row.dataset.rowIndex;
        const detail = _resultsContainer.querySelector(`.sfdt-row-detail[data-row-index="${idx}"]`);
        const toggle = row.querySelector('.sfdt-row-toggle');
        if (detail) {
          const visible = detail.style.display !== 'none';
          detail.style.display = visible ? 'none' : 'table-row';
          if (toggle) toggle.textContent = visible ? '▸' : '▾';
        }
      });
    });

    // Inline editing on double-click
    _resultsContainer.querySelectorAll('.sfdt-copyable').forEach(el => {
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('a')) return;
        const cell = el;
        const rowEl = cell.closest('.sfdt-row-main');
        if (!rowEl) return;
        const ri = parseInt(rowEl.dataset.rowIndex, 10);
        const record = flatRecords[ri];
        if (!record) return;
        // Determine which key this cell belongs to
        const cells = Array.from(rowEl.querySelectorAll('.sfdt-copyable'));
        const cellIdx = cells.indexOf(cell);
        if (cellIdx >= 0 && keys[cellIdx]) {
          _enableInlineEdit(cell, record, keys[cellIdx], ri);
        }
      });
    });
  }

  /** Flatten nested objects like Account.Name into dot-notation keys */
  function _flattenRecord(record, prefix) {
    const flat = {};
    for (const [key, val] of Object.entries(record)) {
      if (key === 'attributes') continue;
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (val && typeof val === 'object' && !Array.isArray(val) && val.attributes) {
        // Related object — recurse
        Object.assign(flat, _flattenRecord(val, fullKey));
      } else {
        flat[fullKey] = val;
      }
    }
    return flat;
  }

  /** Collect all unique keys across flat records, preserving order */
  function _collectKeys(flatRecords) {
    const keySet = new Set();
    for (const r of flatRecords) {
      for (const k of Object.keys(r)) keySet.add(k);
    }
    return [...keySet];
  }

  /** Render a table row with clickable IDs and expandable detail */
  function _renderRow(flatRecord, keys, rowIndex) {
    const cells = keys.map(k => {
      const val = flatRecord[k];
      return `<td class="sfdt-copyable" data-copy="${val != null ? _esc(String(val)) : ''}">${_formatCellValue(k, val)}</td>`;
    }).join('');

    const hasId = flatRecord.Id || flatRecord.id;
    const actionsCell = _queriedSObjectType && !_isToolingQuery
      ? `<td class="sfdt-actions-cell">
          <button class="sfdt-row-action sfdt-row-edit" data-action="edit" data-row="${rowIndex}" title="Edit">✎</button>
          <button class="sfdt-row-action sfdt-row-clone" data-action="clone" data-row="${rowIndex}" title="Clone">⧉</button>
          ${hasId ? `<button class="sfdt-row-action sfdt-row-delete" data-action="delete" data-row="${rowIndex}" title="Delete">✕</button>` : ''}
        </td>` : '';

    // Build detail row with all field:value pairs for expand view
    const detailPairs = keys
      .filter(k => flatRecord[k] !== null && flatRecord[k] !== undefined)
      .map(k => `<div style="display:flex;gap:8px;padding:2px 0"><span style="color:#58a6ff;min-width:160px;font-weight:500">${_esc(k)}</span><span style="color:#e1e4e8;word-break:break-all">${_formatCellValue(k, flatRecord[k])}</span></div>`)
      .join('');

    return `<tr class="sfdt-row-main" data-row-index="${rowIndex}" style="cursor:pointer">
      <td style="width:20px;text-align:center;padding:0 4px;color:#6e7681" class="sfdt-row-toggle">▸</td>
      ${cells}
      ${actionsCell}
    </tr>
    <tr class="sfdt-row-detail" data-row-index="${rowIndex}" style="display:none">
      <td colspan="${keys.length + 1 + (_queriedSObjectType && !_isToolingQuery ? 1 : 0)}" style="padding:8px 16px;background:#0f1419;border-bottom:1px solid #2d333b">
        <div style="font-family:var(--mono);font-size:11px;max-height:300px;overflow-y:auto">${detailPairs}</div>
      </td>
    </tr>`;
  }

  /** Format cell value — make IDs and URLs clickable, convert timestamps */
  function _formatCellValue(key, val) {
    if (val === null || val === undefined) {
      return '<span class="sfdt-null">null</span>';
    }
    if (typeof val === 'object') {
      return `<span style="font-family:var(--mono);font-size:11px;color:#6e7681">${_esc(JSON.stringify(val))}</span>`;
    }
    const str = String(val);
    // Salesforce 15 or 18 char ID — make clickable
    if (_isSalesforceId(key, str)) {
      const base = window.SalesforceAPI?.getInstanceUrl() || '';
      return `<a href="${base}/${_esc(str)}" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:underline;cursor:pointer" title="Open record">${_esc(str)}</a>`;
    }
    // URL values — make clickable
    if (/^https?:\/\//i.test(str)) {
      return `<a href="${_esc(str)}" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:underline;cursor:pointer" title="Open URL">${_esc(str.length > 60 ? str.substring(0, 57) + '...' : str)}</a>`;
    }
    // Boolean styling
    if (str === 'true' || str === 'false') {
      return `<span style="color:${str === 'true' ? '#22c55e' : '#f85149'}">${str}</span>`;
    }
    // Date/time conversion — ISO 8601 format from Salesforce
    if (_localTimeEnabled && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
      try {
        const d = new Date(str);
        const local = d.toLocaleString();
        return `<span title="UTC: ${_esc(str)}" style="color:#d2a8ff">${_esc(local)}</span>`;
      } catch (e) { /* fall through */ }
    }
    return _esc(str);
  }

  /** Check if a value looks like a Salesforce ID */
  function _isSalesforceId(key, str) {
    if (!str) return false;
    const k = key.toLowerCase();
    // Field name ends with 'id' or is 'Id'
    if (k === 'id' || k.endsWith('id') || k.endsWith('.id')) {
      return /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(str);
    }
    return false;
  }

  async function _loadMore(nextUrl) {
    try {
      const more = await QS().fetchNextPage(nextUrl);
      if (more.records) {
        _lastResults.records = [..._lastResults.records, ...more.records];
        _lastResults.done = more.done;
        _lastResults.nextRecordsUrl = more.nextRecordsUrl;
        _displayResults(_lastResults);
      }
    } catch (err) {
      _statusBar.textContent = `Error: ${err.message}`;
    }
  }

  function _analyzeQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    const hints = _container.querySelector('#soql-hints');

    // Toggle: if hints are already visible, hide them
    if (hints.innerHTML.trim() !== '') {
      hints.innerHTML = '';
      return;
    }

    const plan = QS().getQueryPlan(soql);

    if (plan.hints.length === 0) {
      hints.innerHTML = '<div class="sfdt-hint sfdt-hint-success" style="color:#22c55e">Query looks good!</div>';
    } else {
      hints.innerHTML = plan.hints.map(h => `
        <div class="sfdt-hint sfdt-hint-${h.severity}">
          <div>
            <div class="sfdt-hint-msg">${_esc(h.message)}</div>
            <div class="sfdt-hint-suggestion">${_esc(h.suggestion)}</div>
          </div>
        </div>
      `).join('');
    }

    hints.innerHTML += `
      <div class="sfdt-query-plan">
        <div><strong style="color:#58a6ff">Object:</strong> ${_esc(plan.object)}</div>
        <div><strong style="color:#58a6ff">WHERE:</strong> ${plan.hasWhereClause ? 'Yes' : 'No'}</div>
        <div><strong style="color:#58a6ff">LIMIT:</strong> ${plan.hasLimit ? 'Yes' : 'No'}</div>
        <div><strong style="color:#58a6ff">ORDER BY:</strong> ${plan.hasOrderBy ? 'Yes' : 'No'}</div>
        <div><strong style="color:#58a6ff">Subqueries:</strong> ${plan.subqueryCount}</div>
      </div>
    `;
  }

  /** Clear stacked results from hints and non-query results areas */
  function _clearNonQueryResults() {
    const hints = _container.querySelector('#soql-hints');
    if (hints) hints.innerHTML = '';
  }

  // ─── Query Plan / EXPLAIN ────────────────────────────

  async function _explainQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    _track('explain');
    const hints = _container.querySelector('#soql-hints');

    // Toggle: if already showing explain results, hide them
    if (hints.innerHTML.includes('sfdt-explain-plan')) {
      hints.innerHTML = '';
      return;
    }

    // Clear previous non-query results to prevent stacking
    _clearNonQueryResults();

    hints.innerHTML = '<div class="sfdt-hint" style="color:#58a6ff">Fetching query plan...</div>';

    const result = await QS().explainQuery(soql);
    if (!result.success) {
      hints.innerHTML = `<div class="sfdt-hint sfdt-hint-error"><div class="sfdt-hint-msg">Explain Error: ${_esc(result.error)}</div></div>`;
      return;
    }

    if (!result.plans || result.plans.length === 0) {
      hints.innerHTML = '<div class="sfdt-hint sfdt-hint-success" style="color:#22c55e">No plan data returned — query may be too simple to analyze.</div>';
      return;
    }

    hints.innerHTML = `<div class="sfdt-explain-plan">
      <div style="font-weight:600;color:#58a6ff;margin-bottom:8px;font-size:13px">Query Plan (${result.executionTime}ms)</div>
      ${result.plans.map((p, i) => {
        const costColor = p.relativeCost < 0.5 ? '#22c55e' : p.relativeCost < 1.5 ? '#fbbf24' : '#f85149';
        return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-weight:600;color:#e1e4e8">Plan ${i + 1}</span>
            <span style="background:${costColor}22;color:${costColor};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">Cost: ${p.relativeCost != null ? p.relativeCost.toFixed(2) : 'N/A'}</span>
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:4px;font-size:12px">
            <span style="color:#8b949e">Cardinality:</span><span style="color:#e1e4e8">${p.cardinality != null ? p.cardinality.toLocaleString() : 'N/A'}</span>
            <span style="color:#8b949e">Leading Op:</span><span style="color:#e1e4e8">${_esc(p.leadingOperationType || 'N/A')}</span>
            <span style="color:#8b949e">sObject Type:</span><span style="color:#e1e4e8">${_esc(p.sobjectType || 'N/A')}</span>
            <span style="color:#8b949e">sObject Cardinality:</span><span style="color:#e1e4e8">${p.sobjectCardinality != null ? p.sobjectCardinality.toLocaleString() : 'N/A'}</span>
            ${p.fields && p.fields.length ? `<span style="color:#8b949e">Fields:</span><span style="color:#e1e4e8">${p.fields.map(f => _esc(f)).join(', ')}</span>` : ''}
          </div>
          ${p.notes ? `<div style="margin-top:6px;color:#6e7681;font-size:11px;font-style:italic">${_esc(p.notes)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  // ─── SOSL Search ────────────────────────────────────

  async function _runSOSLQuery() {
    const sosl = _editor.value.trim();
    if (!sosl) return;
    _track('sosl');
    _statusBar.textContent = 'Executing SOSL search...';
    _updateRunBadge(null);
    _clearNonQueryResults();
    _resultsContainer.innerHTML = '<div class="sfdt-soql-loading">Running SOSL search...</div>';
    try {
      const result = await QS().executeSOSL(sosl);
      _displayResults(result);
    } catch (err) {
      _resultsContainer.innerHTML = `<div class="sfdt-soql-error">
        <div class="sfdt-soql-error-title">SOSL Error</div>
        <div class="sfdt-soql-error-msg">${_esc(err && err.message ? err.message : String(err))}</div>
      </div>`;
      _statusBar.textContent = 'Error';
      _setExportEnabled(false);
      _updateRunBadge(null);
    }
  }

  // ─── Select All Fields ──────────────────────────────

  async function _selectAllFields() {
    _track('selectAllFields');
    const text = _editor.value;
    const objectMatch = text.match(/FROM\s+(\w+)/i);
    if (!objectMatch) {
      _statusBar.textContent = 'Add a FROM clause first (e.g., FROM Account)';
      return;
    }

    const objName = objectMatch[1];
    _statusBar.textContent = `Loading ${objName} fields...`;

    // Show a filter dropdown
    const existingMenu = _container.querySelector('.sfdt-allfields-menu');
    if (existingMenu) { existingMenu.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'sfdt-allfields-menu';
    menu.innerHTML = `
      <div style="padding:10px 16px !important;font-size:12px !important;color:#58a6ff !important;font-weight:600 !important;border-bottom:1px solid var(--border) !important">Insert All Fields for ${_esc(objName)}</div>
      <div class="sfdt-allfields-option" data-filter="all">All Fields</div>
      <div class="sfdt-allfields-option" data-filter="custom">Custom Only (__c)</div>
      <div class="sfdt-allfields-option" data-filter="standard">Standard Only</div>
      <div class="sfdt-allfields-option" data-filter="date">Date Fields Only</div>
    `;
    menu.style.cssText = 'position:absolute !important;z-index:10001 !important;background:var(--bg2) !important;border:1px solid var(--border) !important;border-radius:6px !important;box-shadow:0 4px 12px rgba(0,0,0,.4) !important;min-width:200px !important;padding:4px 0 !important;';

    // Position near the button
    const btn = _container.querySelector('#soql-select-all');
    const rect = btn.getBoundingClientRect();
    const panelRect = _panel.getBoundingClientRect();
    menu.style.left = (rect.left - panelRect.left) + 'px';
    menu.style.top = (rect.bottom - panelRect.top + 4) + 'px';

    _panel.appendChild(menu);

    // Style options
    menu.querySelectorAll('.sfdt-allfields-option').forEach(opt => {
      opt.style.cssText = 'padding:10px 16px !important;cursor:pointer !important;font-size:13px !important;color:#e1e4e8 !important;border-bottom:1px solid rgba(255,255,255,0.05) !important;';
      opt.addEventListener('mouseenter', () => { opt.style.background = 'rgba(88,166,255,0.15)'; opt.style.color = '#58a6ff'; });
      opt.addEventListener('mouseleave', () => { opt.style.background = ''; opt.style.color = '#e1e4e8'; });
      opt.addEventListener('click', async () => {
        menu.remove();
        const filter = opt.dataset.filter;
        _statusBar.textContent = `Loading ${filter === 'all' ? '' : filter + ' '}fields for ${objName}...`;
        const fields = await QS().getAllFields(objName, filter === 'all' ? null : filter);
        if (fields.length === 0) {
          _statusBar.textContent = 'No fields found';
          return;
        }
        // Insert fields into the SELECT clause
        const fieldStr = fields.join(', ');
        const fromIdx = text.search(/\bFROM\b/i);
        if (fromIdx >= 0) {
          // Replace existing SELECT ... FROM with SELECT <all fields> FROM
          const afterFrom = text.substring(fromIdx);
          _editor.value = `SELECT ${fieldStr}\n${afterFrom}`;
        } else {
          _editor.value = `SELECT ${fieldStr}\nFROM ${objName}`;
        }
        _updateHighlight();
        _statusBar.textContent = `Inserted ${fields.length} ${filter === 'all' ? '' : filter + ' '}fields`;
      });
    });

    // Close on click outside
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  // ─── Multi-Tab System ───────────────────────────────

  function _initQueryTabs() {
    // Load persisted tabs or create default tab
    _loadQueryTabs().then(() => {
      if (_queryTabs.length === 0) {
        _addQueryTab(true);
      } else {
        _renderTabBar();
        // Restore active tab's state
        const activeTab = _queryTabs.find(t => t.id === _activeQueryTabId) || _queryTabs[0];
        _activeQueryTabId = activeTab.id;
        if (activeTab.query) _editor.value = activeTab.query;
        _updateHighlight();
      }
    });
  }

  async function _loadQueryTabs() {
    try {
      const data = await chrome.storage.local.get(TABS_KEY);
      const saved = data[TABS_KEY];
      if (saved && saved.tabs && saved.tabs.length > 0) {
        _queryTabs = saved.tabs;
        _activeQueryTabId = saved.activeTabId || saved.tabs[0].id;
        _tabIdCounter = saved.tabIdCounter || saved.tabs.length;
      }
    } catch { /* ignore — will create default tab */ }
  }

  async function _saveQueryTabs() {
    // Save current editor state to active tab before persisting
    _syncCurrentTabState();
    try {
      await chrome.storage.local.set({
        [TABS_KEY]: {
          tabs: _queryTabs.map(t => ({ id: t.id, name: t.name, query: t.query, isTooling: t.isTooling })),
          activeTabId: _activeQueryTabId,
          tabIdCounter: _tabIdCounter
        }
      });
    } catch { /* ignore */ }
  }

  function _syncCurrentTabState() {
    const tab = _queryTabs.find(t => t.id === _activeQueryTabId);
    if (tab && _editor) {
      tab.query = _editor.value;
      // Save results HTML so we can restore when switching back
      tab._resultsHtml = _resultsContainer.innerHTML;
      tab._lastResults = _lastResults;
    }
  }

  function _addQueryTab(isInitial) {
    if (!isInitial) _track('newTab');
    _tabIdCounter++;
    const newTab = {
      id: `tab-${_tabIdCounter}`,
      name: `Query ${_tabIdCounter}`,
      query: '',
      isTooling: false,
      resultCount: null
    };

    // Save current tab state before switching
    if (!isInitial) _syncCurrentTabState();

    _queryTabs.push(newTab);
    _activeQueryTabId = newTab.id;

    if (!isInitial) {
      _editor.value = '';
      _resultsContainer.innerHTML = `
        <div class="sfdt-soql-placeholder">
          <div style="margin-bottom:12px;font-size:15px;color:#58a6ff;font-weight:600">SOQL Query Tool</div>
          <div style="margin-bottom:8px;color:#8b949e">Write a SOQL query and press <strong style="color:#e1e4e8">Ctrl+Enter</strong> to execute.</div>
          <div style="color:#6e7681;font-size:12px">Check the <strong>Examples</strong> tab for sample queries to get started.</div>
        </div>`;
      _updateHighlight();
      _setExportEnabled(false);
      _updateRunBadge(null);
      _statusBar.textContent = 'Ready';
    }

    _renderTabBar();
    _saveQueryTabs();
  }

  function _switchQueryTab(tabId) {
    if (tabId === _activeQueryTabId) return;

    // Save current tab state (including results)
    _syncCurrentTabState();

    _activeQueryTabId = tabId;
    const tab = _queryTabs.find(t => t.id === tabId);
    if (!tab) return;

    // Restore editor state
    _editor.value = tab.query || '';
    _updateHighlight();
    _updateRunBadge(tab.resultCount);

    // Restore saved results or show placeholder
    if (tab._resultsHtml) {
      _resultsContainer.innerHTML = tab._resultsHtml;
      _lastResults = tab._lastResults || null;
      _setExportEnabled(_lastResults && _lastResults.records && _lastResults.records.length > 0);
      _statusBar.textContent = tab.resultCount != null ? `${tab.resultCount} records` : 'Ready';
      // Re-bind event handlers for the restored results
      if (_lastResults && _lastResults.records && _lastResults.records.length > 0) {
        const flatRecords = _lastResults.records.map(r => _flattenRecord(r));
        const keys = _collectKeys(flatRecords);
        _bindRowEvents(flatRecords, keys);
      }
    } else {
      _resultsContainer.innerHTML = tab.query ? `
        <div class="sfdt-soql-placeholder">
          <div style="color:#8b949e;font-size:13px">Press <strong style="color:#e1e4e8">Ctrl+Enter</strong> to re-run this query.</div>
        </div>` : `
        <div class="sfdt-soql-placeholder">
          <div style="margin-bottom:12px;font-size:15px;color:#58a6ff;font-weight:600">SOQL Query Tool</div>
          <div style="margin-bottom:8px;color:#8b949e">Write a SOQL query and press <strong style="color:#e1e4e8">Ctrl+Enter</strong> to execute.</div>
        </div>`;
      _lastResults = null;
      _setExportEnabled(false);
      _statusBar.textContent = 'Ready';
    }

    _renderTabBar();
    _saveQueryTabs();
    _editor.focus();
  }

  function _closeQueryTab(tabId) {
    if (_queryTabs.length <= 1) return; // Keep at least one tab

    const idx = _queryTabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    _queryTabs.splice(idx, 1);

    // If closing active tab, switch to adjacent tab
    if (tabId === _activeQueryTabId) {
      const newIdx = Math.min(idx, _queryTabs.length - 1);
      _activeQueryTabId = _queryTabs[newIdx].id;
      const tab = _queryTabs[newIdx];
      _editor.value = tab.query || '';
      _updateHighlight();
      _statusBar.textContent = 'Ready';
    }

    _renderTabBar();
    _saveQueryTabs();
  }

  function _renameQueryTab(tabId) {
    const tab = _queryTabs.find(t => t.id === tabId);
    if (!tab) return;
    const tabEl = _container.querySelector(`.sfdt-qtab[data-tab-id="${tabId}"] .sfdt-qtab-name`);
    if (!tabEl) return;

    // Replace text with an inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.value = tab.name;
    input.style.cssText = 'width:80px;background:var(--bg);color:#e1e4e8;border:1px solid var(--accent);border-radius:3px;padding:1px 4px;font-size:11px;outline:none;';
    tabEl.textContent = '';
    tabEl.appendChild(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim() || tab.name;
      tab.name = newName;
      tabEl.textContent = newName;
      _saveQueryTabs();
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = tab.name; input.blur(); }
    });
  }

  function _autoNameTab() {
    const tab = _queryTabs.find(t => t.id === _activeQueryTabId);
    if (!tab) return;
    const text = _editor.value;
    const fromMatch = text.match(/FROM\s+(\w+)/i);
    if (fromMatch && tab.name.startsWith('Query ')) {
      tab.name = fromMatch[1];
      _renderTabBar();
      _saveQueryTabs();
    }
  }

  function _renderTabBar() {
    const tabContainer = _container.querySelector('#soql-tabbar-tabs');
    if (!tabContainer) return;

    tabContainer.innerHTML = _queryTabs.map(t => `
      <div class="sfdt-qtab ${t.id === _activeQueryTabId ? 'active' : ''}" data-tab-id="${t.id}">
        <span class="sfdt-qtab-name">${_esc(t.name)}</span>
        ${_queryTabs.length > 1 ? `<span class="sfdt-qtab-close" data-tab-id="${t.id}" title="Close tab">×</span>` : ''}
      </div>
    `).join('');

    // Tab click to switch
    tabContainer.querySelectorAll('.sfdt-qtab').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('sfdt-qtab-close')) return;
        _switchQueryTab(el.dataset.tabId);
      });
      el.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('sfdt-qtab-close')) return;
        _renameQueryTab(el.dataset.tabId);
      });
    });

    // Close button
    tabContainer.querySelectorAll('.sfdt-qtab-close').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _closeQueryTab(el.dataset.tabId);
      });
    });
  }

  // ─── Keyboard Shortcut Helpers ──────────────────────

  function _duplicateLine() {
    const start = _editor.selectionStart;
    const text = _editor.value;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.substring(lineStart, lineEnd);
    _editor.value = text.substring(0, lineEnd) + '\n' + line + text.substring(lineEnd);
    _editor.selectionStart = _editor.selectionEnd = start + line.length + 1;
    _updateHighlight();
  }

  function _toggleComment() {
    const start = _editor.selectionStart;
    const text = _editor.value;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.substring(lineStart, lineEnd);
    if (line.trimStart().startsWith('//')) {
      const uncommented = line.replace(/^(\s*)\/\/\s?/, '$1');
      _editor.value = text.substring(0, lineStart) + uncommented + text.substring(lineEnd);
      _editor.selectionStart = _editor.selectionEnd = start - (line.length - uncommented.length);
    } else {
      const commented = line.replace(/^(\s*)/, '$1// ');
      _editor.value = text.substring(0, lineStart) + commented + text.substring(lineEnd);
      _editor.selectionStart = _editor.selectionEnd = start + (commented.length - line.length);
    }
    _updateHighlight();
  }

  function _showShortcutHelp() {
    _resultsContainer.innerHTML = `
      <div style="padding:16px;color:#e1e4e8;font-size:13px">
        <div style="font-weight:600;color:#58a6ff;font-size:15px;margin-bottom:12px">⌨ Keyboard Shortcuts</div>
        <div style="display:grid;grid-template-columns:180px 1fr;gap:6px 16px;font-size:12px">
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+Enter</span><span>Run SOQL query</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+Shift+Enter</span><span>Run as Tooling API query</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+Space</span><span>Select all fields</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+T</span><span>New query tab</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+W</span><span>Close current tab</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+L</span><span>Clear editor</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+S</span><span>Save to favorites</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+Shift+F</span><span>Format query</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+D</span><span>Duplicate current line</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Ctrl+/</span><span>Toggle comment</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Tab</span><span>Insert 2 spaces</span>
          <span style="color:#58a6ff;font-family:var(--mono)">Escape</span><span>Close autocomplete / hints</span>
          <span style="color:#58a6ff;font-family:var(--mono)">?</span><span>Show this help (when editor empty)</span>
        </div>
      </div>`;
  }

  // ─── Record Count Preview ───────────────────────────

  async function _recordCountPreview(soql) {
    const objectMatch = soql.match(/FROM\s+(\w+)/i);
    if (!objectMatch) return null;
    // Build a COUNT() version of the query
    const whereMatch = soql.match(/WHERE\s+(.+?)(?:\bORDER\b|\bGROUP\b|\bLIMIT\b|\bOFFSET\b|$)/is);
    const countQuery = `SELECT COUNT() FROM ${objectMatch[1]}${whereMatch ? ' WHERE ' + whereMatch[1].trim() : ''}`;
    try {
      const isTooling = _isToolingObject(objectMatch[1]);
      const result = isTooling ? await QS().executeToolingQuery(countQuery) : await QS().executeQuery(countQuery);
      return result.success ? result.totalSize : null;
    } catch {
      return null;
    }
  }

  // ─── Local Time Conversion ──────────────────────────

  let _localTimeEnabled = false;

  function _toggleLocalTime() {
    _localTimeEnabled = !_localTimeEnabled;
    const btn = _container.querySelector('#soql-local-time');
    if (btn) {
      btn.classList.toggle('sfdt-btn-active', _localTimeEnabled);
      btn.title = _localTimeEnabled ? 'Showing local time (click for UTC)' : 'Showing UTC (click for local time)';
    }
    // Re-render results if we have them
    if (_lastResults) _displayResults(_lastResults);
  }

  // ─── Production Safety ──────────────────────────────

  function _isProductionOrg() {
    try {
      const url = window.SalesforceAPI.getInstanceUrl();
      // Sandbox URLs contain --<name>.sandbox. or .scratch. or cs/test patterns
      if (/\.scratch\.|--\w+\.sandbox\.|\.cs\d+\.|\.test\.|\.develop\./i.test(url)) return false;
      return true;
    } catch { return false; }
  }

  function _confirmProdDML(action) {
    if (!_isProductionOrg()) return true;
    return confirm(`⚠️ PRODUCTION ORG\n\nYou are about to ${action} records in a PRODUCTION org.\n\nAre you sure you want to continue?`);
  }

  // ─── Query History Search & Filter ──────────────────

  let _historySearchQuery = '';
  let _historyFilterStatus = 'all'; // 'all', 'success', 'error'

  // ─── Anonymous Apex ─────────────────────────────────

  async function _executeAnonymousApex() {
    const code = _editor.value.trim();
    if (!code) return;
    _track('apex');
    if (_isProductionOrg() && !confirm('⚠️ PRODUCTION ORG\n\nYou are about to execute Anonymous Apex in PRODUCTION.\n\nAre you sure?')) return;
    _statusBar.textContent = 'Executing Anonymous Apex...';
    // Clear previous results to prevent stacking
    _clearNonQueryResults();
    _resultsContainer.innerHTML = '<div class="sfdt-soql-loading">Executing Apex code...</div>';
    try {
      const API = window.SalesforceAPI;
      const result = await API.executeAnonymous(code);
      const success = result.compiled && result.success;
      const statusColor = success ? '#22c55e' : '#f85149';
      _resultsContainer.innerHTML = `
        <div style="padding:16px;font-size:13px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-weight:600;font-size:15px;color:${statusColor}">${success ? '✓ Execution Successful' : '✕ Execution Failed'}</span>
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:4px;font-size:12px;margin-bottom:12px">
            <span style="color:#8b949e">Compiled:</span><span style="color:${result.compiled ? '#22c55e' : '#f85149'}">${result.compiled ? 'Yes' : 'No'}</span>
            <span style="color:#8b949e">Success:</span><span style="color:${result.success ? '#22c55e' : '#f85149'}">${result.success ? 'Yes' : 'No'}</span>
            ${result.line ? `<span style="color:#8b949e">Line:</span><span style="color:#e1e4e8">${result.line}</span>` : ''}
            ${result.column ? `<span style="color:#8b949e">Column:</span><span style="color:#e1e4e8">${result.column}</span>` : ''}
          </div>
          ${result.compileProblem ? `<div style="background:#1a0000;border:1px solid #f85149;border-radius:6px;padding:10px;margin-bottom:8px">
            <div style="color:#f85149;font-weight:600;font-size:12px;margin-bottom:4px">Compile Error</div>
            <pre style="color:#e1e4e8;font-size:12px;white-space:pre-wrap;font-family:var(--mono)">${_esc(result.compileProblem)}</pre>
          </div>` : ''}
          ${result.exceptionMessage ? `<div style="background:#1a0000;border:1px solid #f85149;border-radius:6px;padding:10px;margin-bottom:8px">
            <div style="color:#f85149;font-weight:600;font-size:12px;margin-bottom:4px">Runtime Exception</div>
            <pre style="color:#e1e4e8;font-size:12px;white-space:pre-wrap;font-family:var(--mono)">${_esc(result.exceptionMessage)}</pre>
            ${result.exceptionStackTrace ? `<pre style="color:#6e7681;font-size:11px;white-space:pre-wrap;margin-top:6px;font-family:var(--mono)">${_esc(result.exceptionStackTrace)}</pre>` : ''}
          </div>` : ''}
        </div>`;
      _statusBar.textContent = success ? 'Apex executed successfully' : 'Apex execution failed';
    } catch (err) {
      _resultsContainer.innerHTML = `<div class="sfdt-soql-error">
        <div class="sfdt-soql-error-title">Apex Execution Error</div>
        <div class="sfdt-soql-error-msg">${_esc(err && err.message ? err.message : String(err))}</div>
      </div>`;
      _statusBar.textContent = 'Error';
    }
  }

  // ─── Inline Cell Editing ────────────────────────────

  let _pendingEdits = {}; // { recordId: { field: newValue, ... } }

  function _enableInlineEdit(cell, flatRecord, key, rowIndex) {
    if (key.toLowerCase() === 'id' || key.includes('.')) return; // Can't edit Id or relationship fields
    if (_isToolingQuery) return; // Can't edit tooling results
    if (!_queriedSObjectType) return;

    const originalValue = flatRecord[key];
    const originalText = cell.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalValue != null ? String(originalValue) : '';
    input.style.cssText = 'width:100%;background:var(--bg);color:#fbbf24;border:1px solid var(--accent);border-radius:3px;padding:2px 6px;font-size:12px;font-family:var(--mono);outline:none;';
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const recordId = flatRecord.Id || flatRecord.id;
    const finish = (save) => {
      if (save && input.value !== String(originalValue || '')) {
        cell.textContent = input.value;
        cell.style.background = 'rgba(251,191,36,.1)';
        cell.style.borderLeft = '2px solid #fbbf24';
        if (recordId) {
          if (!_pendingEdits[recordId]) _pendingEdits[recordId] = {};
          _pendingEdits[recordId][key] = input.value === 'null' ? null : input.value;
          _showPendingEditsBar();
        }
      } else {
        cell.textContent = originalText;
      }
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); input.remove(); cell.textContent = originalText; }
    });
  }

  function _showPendingEditsBar() {
    let bar = _container.querySelector('#soql-pending-edits');
    const count = Object.keys(_pendingEdits).length;
    if (count === 0) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'soql-pending-edits';
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 16px;background:rgba(251,191,36,.1);border-top:1px solid #fbbf24;font-size:12px;color:#fbbf24;';
      const resultInfo = _resultsContainer.querySelector('.sfdt-soql-result-info');
      if (resultInfo) resultInfo.after(bar);
      else _resultsContainer.prepend(bar);
    }
    const I = ICONS();
    bar.innerHTML = `
      <span style="font-weight:600">${count} record${count > 1 ? 's' : ''} modified</span>
      <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary" id="soql-save-edits">${I.check} Save All</button>
      <button class="sfdt-btn sfdt-btn-sm" id="soql-discard-edits">${I.x} Discard</button>
    `;
    bar.querySelector('#soql-save-edits').addEventListener('click', _savePendingEdits);
    bar.querySelector('#soql-discard-edits').addEventListener('click', () => {
      _pendingEdits = {};
      _rerunLastQuery();
    });
  }

  async function _savePendingEdits() {
    if (!_queriedSObjectType) return;
    _track('inlineEdit');
    if (!_confirmProdDML('update')) return;
    const API = window.SalesforceAPI;
    const entries = Object.entries(_pendingEdits);
    let successCount = 0;
    let errorCount = 0;
    _statusBar.textContent = `Saving ${entries.length} record(s)...`;

    for (const [recordId, fields] of entries) {
      try {
        await API.restPatch(_queriedSObjectType, recordId, fields);
        successCount++;
      } catch {
        errorCount++;
      }
    }

    _pendingEdits = {};
    _statusBar.textContent = `Saved: ${successCount} success, ${errorCount} error${errorCount !== 1 ? 's' : ''}`;
    _rerunLastQuery();
  }

  // ─── Bulk Export (Beyond 2000) ──────────────────────

  async function _bulkExportAll() {
    if (!_lastResults || !_editor.value.trim()) return;
    const soql = _editor.value.trim();
    _statusBar.textContent = 'Exporting all records...';
    let allRecords = [...(_lastResults.records || [])];
    let nextUrl = _lastResults.nextRecordsUrl;
    let fetched = allRecords.length;
    const total = _lastResults.totalSize;

    while (nextUrl && !_lastResults.done) {
      try {
        _statusBar.textContent = `Fetched ${fetched} / ${total} records...`;
        const more = await QS().fetchNextPage(nextUrl);
        if (more.records) {
          allRecords = allRecords.concat(more.records);
          fetched = allRecords.length;
        }
        nextUrl = more.nextRecordsUrl;
        if (more.done) break;
      } catch (err) {
        _statusBar.textContent = `Export error at ${fetched} records: ${err.message}`;
        break;
      }
    }

    // Download as CSV
    const csv = QS().recordsToCSV(allRecords);
    QS().downloadFile(csv, `export_${_queriedSObjectType || 'query'}_${allRecords.length}.csv`, 'text/csv');
    _statusBar.textContent = `Exported ${allRecords.length} records to CSV`;
  }

  // ─── Bulk Data Import ───────────────────────────────

  function _showBulkImport() {
    _track('import');
    const I = ICONS();
    const modal = document.createElement('div');
    modal.className = 'sfdt-crud-overlay';
    modal.innerHTML = `
      <div class="sfdt-crud-modal" style="max-width:700px !important">
        <div class="sfdt-crud-header">
          <span class="sfdt-crud-title">${I.database} Bulk Data Import</span>
          <div style="display:flex;gap:6px;margin-left:auto">
            <button class="sfdt-btn sfdt-crud-cancel">${I.x} Cancel</button>
          </div>
        </div>
        <div class="sfdt-crud-body" style="flex-direction:column !important;gap:12px !important;padding:16px !important">
          <div style="display:flex;gap:8px;align-items:center">
            <label style="color:#8b949e;font-size:12px;min-width:80px">sObject:</label>
            <input type="text" id="import-sobject" class="sfdt-crud-input" placeholder="Account, Contact, etc." style="flex:1" value="${_esc(_queriedSObjectType || '')}" />
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <label style="color:#8b949e;font-size:12px;min-width:80px">Operation:</label>
            <select id="import-operation" style="flex:1;background:var(--bg);color:#e1e4e8;border:1px solid var(--border);border-radius:4px;padding:6px 10px;font-size:12px">
              <option value="insert">Insert</option>
              <option value="update">Update</option>
              <option value="upsert">Upsert</option>
              <option value="delete">Delete</option>
            </select>
          </div>
          <div id="import-upsert-field" style="display:none;display:flex;gap:8px;align-items:center">
            <label style="color:#8b949e;font-size:12px;min-width:80px">External ID:</label>
            <input type="text" id="import-extid" class="sfdt-crud-input" placeholder="External_Id__c" style="flex:1" />
          </div>
          <div>
            <label style="color:#8b949e;font-size:12px;display:block;margin-bottom:4px">Paste CSV data (first row = headers):</label>
            <textarea id="import-csv" style="width:100%;height:200px;background:var(--bg);color:#e1e4e8;border:1px solid var(--border);border-radius:6px;padding:10px;font-family:var(--mono);font-size:12px;resize:vertical;outline:none" placeholder="Id,Name,Industry&#10;001xx000003ABCD,Acme,Technology&#10;001xx000003EFGH,Globex,Manufacturing"></textarea>
          </div>
          ${_isProductionOrg() ? '<div style="background:rgba(248,81,73,.1);border:1px solid #f85149;border-radius:6px;padding:8px 12px;color:#f85149;font-size:12px;font-weight:600">⚠️ You are connected to a PRODUCTION org</div>' : ''}
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="sfdt-btn sfdt-btn-primary" id="import-execute">${I.play} Execute Import</button>
          </div>
          <div id="import-progress" style="display:none"></div>
          <div id="import-results" style="display:none"></div>
        </div>
      </div>
    `;
    _resultsContainer.appendChild(modal);
    modal.querySelector('.sfdt-crud-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Show/hide upsert field
    const opSelect = modal.querySelector('#import-operation');
    const upsertDiv = modal.querySelector('#import-upsert-field');
    opSelect.addEventListener('change', () => {
      upsertDiv.style.display = opSelect.value === 'upsert' ? 'flex' : 'none';
    });

    // Execute import
    modal.querySelector('#import-execute').addEventListener('click', async () => {
      const sobjectType = modal.querySelector('#import-sobject').value.trim();
      const operation = opSelect.value;
      const csvText = modal.querySelector('#import-csv').value.trim();

      if (!sobjectType || !csvText) {
        modal.querySelector('#import-results').style.display = 'block';
        modal.querySelector('#import-results').innerHTML = '<div style="color:#f85149;font-size:12px">Please fill in sObject type and CSV data.</div>';
        return;
      }

      if (!_confirmProdDML(operation)) return;

      // Parse CSV
      const rows = _parseCSV(csvText);
      if (rows.length < 2) {
        modal.querySelector('#import-results').innerHTML = '<div style="color:#f85149;font-size:12px">CSV must have a header row and at least one data row.</div>';
        modal.querySelector('#import-results').style.display = 'block';
        return;
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);
      const progressEl = modal.querySelector('#import-progress');
      const resultsEl = modal.querySelector('#import-results');
      progressEl.style.display = 'block';
      resultsEl.style.display = 'block';

      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      const API = window.SalesforceAPI;

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const record = {};
        headers.forEach((h, idx) => {
          const val = row[idx]?.trim();
          if (val && val !== '') {
            record[h.trim()] = val === 'null' ? null : val === 'true' ? true : val === 'false' ? false : val;
          }
        });

        progressEl.innerHTML = `<div style="color:#58a6ff;font-size:12px">Processing ${i + 1} / ${dataRows.length}... (${successCount} ok, ${errorCount} errors)</div>
          <div style="background:var(--border);height:4px;border-radius:2px;margin-top:4px;overflow:hidden"><div style="background:var(--accent);height:100%;width:${Math.round(((i + 1) / dataRows.length) * 100)}%;transition:width 0.2s"></div></div>`;

        try {
          if (operation === 'insert') {
            await API.restPost(sobjectType, record);
          } else if (operation === 'update') {
            const id = record.Id || record.id;
            delete record.Id; delete record.id;
            if (!id) throw new Error('No Id field for update');
            await API.restPatch(sobjectType, id, record);
          } else if (operation === 'delete') {
            const id = record.Id || record.id;
            if (!id) throw new Error('No Id field for delete');
            await API.restDelete(sobjectType, id);
          } else if (operation === 'upsert') {
            const extId = modal.querySelector('#import-extid').value.trim();
            if (!extId) throw new Error('External ID field required for upsert');
            const extIdValue = record[extId];
            delete record[extId];
            await API.restGet(`/sobjects/${sobjectType}/${extId}/${extIdValue}`).catch(() =>
              API.restPost(sobjectType, { ...record, [extId]: extIdValue })
            );
          }
          successCount++;
        } catch (err) {
          errorCount++;
          errors.push({ row: i + 2, error: err.message });
        }
      }

      progressEl.innerHTML = `<div style="color:${errorCount > 0 ? '#fbbf24' : '#22c55e'};font-size:12px;font-weight:600">Complete: ${successCount} success, ${errorCount} errors</div>`;
      if (errors.length > 0) {
        resultsEl.innerHTML = `<div style="max-height:150px;overflow-y:auto;font-size:11px;font-family:var(--mono)">
          ${errors.map(e => `<div style="color:#f85149;padding:2px 0">Row ${e.row}: ${_esc(e.error)}</div>`).join('')}
        </div>`;
      } else {
        resultsEl.innerHTML = '<div style="color:#22c55e;font-size:12px">All records processed successfully!</div>';
      }
      _statusBar.textContent = `Import: ${successCount} success, ${errorCount} errors`;
    });
  }

  function _parseCSV(text) {
    const rows = [];
    let current = [];
    let inQuotes = false;
    let field = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { current.push(field); field = ''; }
        else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
          current.push(field); field = '';
          if (current.some(c => c.trim())) rows.push(current);
          current = [];
          if (ch === '\r') i++;
        } else { field += ch; }
      }
    }
    current.push(field);
    if (current.some(c => c.trim())) rows.push(current);
    return rows;
  }

  // ─── Query Templates ───────────────────────────────

  const QUERY_TEMPLATES = [
    { category: 'Admin', name: 'Inactive Users (90+ days)', query: "SELECT Id, Name, Username, Profile.Name, LastLoginDate\nFROM User\nWHERE IsActive = true\nAND LastLoginDate < LAST_N_DAYS:90\nORDER BY LastLoginDate ASC" },
    { category: 'Admin', name: 'Users Never Logged In', query: "SELECT Id, Name, Username, Profile.Name, CreatedDate\nFROM User\nWHERE IsActive = true\nAND LastLoginDate = null\nORDER BY CreatedDate DESC" },
    { category: 'Admin', name: 'Permission Set Assignments', query: "SELECT Id, Assignee.Name, PermissionSet.Name, PermissionSet.Label\nFROM PermissionSetAssignment\nWHERE Assignee.IsActive = true\nORDER BY Assignee.Name\nLIMIT 100" },
    { category: 'Admin', name: 'Setup Audit Trail', query: "SELECT Id, Action, Section, CreatedDate, CreatedBy.Name, Display\nFROM SetupAuditTrail\nORDER BY CreatedDate DESC\nLIMIT 50" },
    { category: 'Admin', name: 'Login History', query: "SELECT UserId, LoginTime, SourceIp, Status, Application, Browser, Platform\nFROM LoginHistory\nORDER BY LoginTime DESC\nLIMIT 50" },
    { category: 'Data Quality', name: 'Duplicate Accounts', query: "SELECT Name, COUNT(Id) cnt\nFROM Account\nGROUP BY Name\nHAVING COUNT(Id) > 1\nORDER BY COUNT(Id) DESC\nLIMIT 50" },
    { category: 'Data Quality', name: 'Duplicate Contacts (Email)', query: "SELECT Email, COUNT(Id) cnt\nFROM Contact\nWHERE Email != null\nGROUP BY Email\nHAVING COUNT(Id) > 1\nORDER BY COUNT(Id) DESC\nLIMIT 50" },
    { category: 'Data Quality', name: 'Records Missing Owner', query: "SELECT Id, Name, OwnerId, Owner.Name\nFROM Account\nWHERE Owner.IsActive = false\nLIMIT 50" },
    { category: 'Development', name: 'Apex Test Coverage (Tooling)', query: "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered\nFROM ApexCodeCoverageAggregate\nORDER BY NumLinesUncovered DESC\nLIMIT 50" },
    { category: 'Development', name: 'Failed Apex Jobs', query: "SELECT Id, ApexClass.Name, MethodName, Status, ExtendedStatus, CreatedDate\nFROM AsyncApexJob\nWHERE Status = 'Failed'\nORDER BY CreatedDate DESC\nLIMIT 20" },
    { category: 'Development', name: 'Scheduled Jobs', query: "SELECT Id, CronJobDetail.Name, State, NextFireTime, PreviousFireTime, TimesTriggered\nFROM CronTrigger\nWHERE State = 'WAITING'\nORDER BY NextFireTime ASC" },
    { category: 'Development', name: 'Debug Logs (Tooling)', query: "SELECT Id, Application, Operation, Status, LogLength, StartTime, LogUser.Name\nFROM ApexLog\nORDER BY StartTime DESC\nLIMIT 20" },
    { category: 'Development', name: 'Custom Fields (Tooling)', query: "SELECT Id, DeveloperName, TableEnumOrId, NamespacePrefix, DataType\nFROM CustomField\nWHERE NamespacePrefix = null\nORDER BY TableEnumOrId, DeveloperName\nLIMIT 100" },
    { category: 'Reporting', name: 'Opportunity Pipeline', query: "SELECT StageName, COUNT(Id) cnt, SUM(Amount) total\nFROM Opportunity\nWHERE IsClosed = false\nGROUP BY StageName\nORDER BY SUM(Amount) DESC" },
    { category: 'Reporting', name: 'Cases by Status', query: "SELECT Status, COUNT(Id) cnt\nFROM Case\nGROUP BY Status\nORDER BY COUNT(Id) DESC" },
    { category: 'Reporting', name: 'Records Created This Month', query: "SELECT CreatedById, CreatedBy.Name, COUNT(Id) cnt\nFROM Account\nWHERE CreatedDate = THIS_MONTH\nGROUP BY CreatedById, CreatedBy.Name\nORDER BY COUNT(Id) DESC" }
  ];

  function _renderTemplates() {
    const area = _container.querySelector('#soql-templates-area');
    const I = ICONS();
    const categories = {};
    for (const t of QUERY_TEMPLATES) {
      if (!categories[t.category]) categories[t.category] = [];
      categories[t.category].push(t);
    }
    const catIcons = { Admin: '👤', 'Data Quality': '🔍', Development: '⚙️', Reporting: '📊' };

    area.innerHTML = `
      <div style="padding:12px 16px">
        <div style="color:#8b949e;font-size:12px;margin-bottom:12px">
          Pre-built query templates for common tasks. Click to load into editor.
        </div>
        ${Object.entries(categories).map(function(entry) {
          const cat = entry[0];
          const templates = entry[1];
          return `
          <div style="margin-bottom:16px">
            <div style="font-weight:600;color:#e1e4e8;font-size:13px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border)">
              ${catIcons[cat] || '📋'} ${_esc(cat)}
            </div>
            ${templates.map(function(t, i) {
              return `
              <div class="sfdt-soql-history-item template-item" data-category="${_esc(cat)}" data-index="${i}" style="cursor:pointer">
                <div class="sfdt-soql-history-query">
                  <div style="font-weight:500;color:#58a6ff;font-size:12px;margin-bottom:2px">${_esc(t.name)}</div>
                  <pre style="color:#8b949e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;font-size:11px;margin:0">${_esc(t.query.split('\n')[0])}</pre>
                </div>
                <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary template-load" data-category="${_esc(cat)}" data-index="${i}" title="Load template">${I.play}</button>
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
    `;

    area.querySelectorAll('.template-load').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const cat = btn.dataset.category;
        const idx = parseInt(btn.dataset.index, 10);
        const tmpl = (categories[cat] || [])[idx];
        if (tmpl) {
          _track('template');
          _editor.value = tmpl.query;
          _updateHighlight();
          _switchTab('editor');
          _container.querySelectorAll('.soql-tab').forEach(function(t) { t.classList.remove('active'); });
          _container.querySelector('[data-tab="editor"]').classList.add('active');
          if (tmpl.query.match(/\bFROM\s+(ApexClass|ApexTrigger|ApexLog|ApexCodeCoverage|CustomField|FlexiPage|ApexTestResult|ApexTestQueueItem|ApexPage|ApexComponent|AuraDefinitionBundle|LightningComponentBundle|FlowDefinition|ValidationRule|WorkflowRule)\b/i)) {
            const toolingCheckbox = _container.querySelector('#soql-tooling');
            if (toolingCheckbox) toolingCheckbox.checked = true;
          }
          _statusBar.textContent = 'Template loaded: ' + tmpl.name;
        }
      });
    });

    area.querySelectorAll('.template-item').forEach(function(item) {
      item.addEventListener('click', function() {
        const btn = item.querySelector('.template-load');
        if (btn) btn.click();
      });
    });
  }

  function _formatQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    _editor.value = soql
      .replace(/\s+/g, ' ')
      .replace(/\bSELECT\b/gi, '\nSELECT')
      .replace(/\bFROM\b/gi, '\nFROM')
      .replace(/\bWHERE\b/gi, '\nWHERE')
      .replace(/\bAND\b/gi, '\n  AND')
      .replace(/\bOR\b/gi, '\n  OR')
      .replace(/\bORDER BY\b/gi, '\nORDER BY')
      .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
      .replace(/\bHAVING\b/gi, '\nHAVING')
      .replace(/\bLIMIT\b/gi, '\nLIMIT')
      .replace(/\bOFFSET\b/gi, '\nOFFSET')
      .trim();
    _updateHighlight();
  }

  function _saveFavorite() {
    const soql = _editor.value.trim();
    if (!soql) return;
    const name = prompt('Name for this query:');
    if (!name) return;
    QS().saveFavorite(name, soql);
    _statusBar.textContent = `Saved "${name}" to favorites`;
  }

  function _renderExamples() {
    const area = _container.querySelector('#soql-examples-area');
    const I = ICONS();
    area.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="color:#58a6ff;font-weight:600;font-size:13px">${I.bolt} Built-in Example Queries</span>
        <span style="color:#6e7681;font-size:11px">(click to load into editor)</span>
      </div>
      ${EXAMPLE_QUERIES.map((ex, i) => {
        if (ex.separator) {
          return `<div style="padding:8px 16px;color:#58a6ff;font-weight:600;font-size:12px;background:var(--bg2);border-bottom:1px solid var(--border)">${_esc(ex.name)}</div>`;
        }
        return `
        <div class="sfdt-soql-history-item" style="cursor:pointer" data-index="${i}">
          <div class="sfdt-soql-history-query" style="pointer-events:none">
            <strong style="color:#58a6ff;font-size:12px">${_esc(ex.name)}</strong>
            <pre style="color:#e1e4e8;margin-top:4px">${_esc(ex.query)}</pre>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;pointer-events:auto">
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary example-load" data-index="${i}">${I.play} Load</button>
          </div>
        </div>`;
      }).join('')}
    `;

    area.querySelectorAll('.example-load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        _editor.value = EXAMPLE_QUERIES[idx].query;
        _updateHighlight();
        _switchTab('editor');
        _container.querySelectorAll('.soql-tab').forEach(t => t.classList.remove('active'));
        _container.querySelector('[data-tab="editor"]').classList.add('active');
        _statusBar.textContent = `Loaded: ${EXAMPLE_QUERIES[idx].name}`;
      });
    });

    area.querySelectorAll('.sfdt-soql-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index, 10);
        _editor.value = EXAMPLE_QUERIES[idx].query;
        _updateHighlight();
        _switchTab('editor');
        _container.querySelectorAll('.soql-tab').forEach(t => t.classList.remove('active'));
        _container.querySelector('[data-tab="editor"]').classList.add('active');
        _statusBar.textContent = `Loaded: ${EXAMPLE_QUERIES[idx].name}`;
      });
    });
  }

  function _renderDataBuilder() {
    const area = _container.querySelector('#soql-databuilder-area');
    if (window.SFDTDataBuilder) {
      window.SFDTDataBuilder.render(area);
    } else {
      area.innerHTML = '<div class="sfdt-soql-empty">Data Builder module not loaded.</div>';
    }
  }

  function _renderFavorites() {
    const area = _container.querySelector('#soql-favorites-area');
    const favs = QS().getFavorites();
    const I = ICONS();
    if (favs.length === 0) {
      area.innerHTML = `<div class="sfdt-soql-empty">No saved queries yet.<br><span style="color:#6e7681;font-size:11px">Use ${I.star} Save in the toolbar to add favorites.</span></div>`;
      return;
    }
    area.innerHTML = favs.map((f, i) => `
      <div class="sfdt-soql-history-item">
        <div class="sfdt-soql-history-query">
          <strong style="color:#58a6ff">${_esc(f.name)}</strong>
          <pre style="color:#e1e4e8">${_esc(f.query)}</pre>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary fav-load" data-index="${i}">${I.play} Load</button>
          <button class="sfdt-btn sfdt-btn-sm fav-remove" data-index="${i}">${I.x}</button>
        </div>
      </div>
    `).join('');

    area.querySelectorAll('.fav-load').forEach(btn => {
      btn.addEventListener('click', () => {
        _editor.value = favs[parseInt(btn.dataset.index, 10)].query;
        _updateHighlight();
        _switchTab('editor');
        _container.querySelectorAll('.soql-tab').forEach(t => t.classList.remove('active'));
        _container.querySelector('[data-tab="editor"]').classList.add('active');
      });
    });
    area.querySelectorAll('.fav-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        QS().removeFavorite(parseInt(btn.dataset.index, 10));
        _renderFavorites();
      });
    });
  }

  function _renderHistory() {
    const area = _container.querySelector('#soql-history-area');
    const history = QS().getHistory();
    const I = ICONS();
    if (history.length === 0) {
      area.innerHTML = '<div class="sfdt-soql-empty">No query history yet.<br><span style="color:#6e7681;font-size:11px">Run a query and it will appear here.</span></div>';
      return;
    }

    // Apply search and filter
    let filtered = history;
    if (_historySearchQuery) {
      const q = _historySearchQuery.toLowerCase();
      filtered = filtered.filter(h => h.query.toLowerCase().includes(q));
    }
    if (_historyFilterStatus === 'success') {
      filtered = filtered.filter(h => h.success);
    } else if (_historyFilterStatus === 'error') {
      filtered = filtered.filter(h => !h.success);
    }

    area.innerHTML = `
      <div style="padding:8px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <input type="text" id="soql-history-search" placeholder="Search history..." value="${_esc(_historySearchQuery || '')}"
            style="flex:1;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:12px;outline:none" />
          <button class="sfdt-btn sfdt-btn-sm ${_historyFilterStatus === 'success' ? 'sfdt-btn-primary' : ''}" id="soql-history-filter-ok" title="Show successful only" style="min-width:32px">✓</button>
          <button class="sfdt-btn sfdt-btn-sm ${_historyFilterStatus === 'error' ? 'sfdt-btn-primary' : ''}" id="soql-history-filter-err" title="Show errors only" style="min-width:32px">✗</button>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#8b949e;align-items:center">
          <span style="font-weight:600">${filtered.length} of ${history.length} queries</span>
          <button class="sfdt-btn sfdt-btn-sm" id="soql-clear-history">${I.x} Clear All</button>
        </div>
      </div>
      ${filtered.slice(0, 50).map((h, i) => {
        const origIdx = history.indexOf(h);
        return `
        <div class="sfdt-soql-history-item ${h.success ? '' : 'error-item'}" data-query-index="${origIdx}">
          <div class="sfdt-soql-history-query">
            <pre style="color:#e1e4e8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${_esc(h.query.length > 80 ? h.query.substring(0, 80) + '...' : h.query)}</pre>
            <div class="sfdt-soql-history-meta">
              <span style="color:${h.success ? '#22c55e' : '#f85149'}">${h.success ? 'OK' : 'ERR'}</span>
              <span>${h.resultCount || 0} records</span>
              <span>${h.executionTime}ms</span>
              <span>${_formatTime(h.timestamp)}</span>
            </div>
          </div>
          <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary history-load" data-index="${origIdx}">${I.play}</button>
        </div>`;
      }).join('')}
      <div class="sfdt-history-tooltip" id="soql-history-tooltip" style="display:none"></div>
    `;

    // History search input
    const searchInput = area.querySelector('#soql-history-search');
    searchInput.addEventListener('input', () => {
      _historySearchQuery = searchInput.value;
      if (_historySearchQuery) _track('historySearch');
      _renderHistory();
    });

    // Filter buttons
    area.querySelector('#soql-history-filter-ok').addEventListener('click', () => {
      _historyFilterStatus = _historyFilterStatus === 'success' ? null : 'success';
      _renderHistory();
    });
    area.querySelector('#soql-history-filter-err').addEventListener('click', () => {
      _historyFilterStatus = _historyFilterStatus === 'error' ? null : 'error';
      _renderHistory();
    });

    // Custom tooltip on hover
    const tooltip = area.querySelector('#soql-history-tooltip');
    let tooltipTimeout = null;
    area.querySelectorAll('.sfdt-soql-history-item[data-query-index]').forEach(item => {
      item.addEventListener('mouseenter', (e) => {
        const idx = parseInt(item.dataset.queryIndex, 10);
        const query = history[idx]?.query;
        if (!query) return;
        clearTimeout(tooltipTimeout);
        tooltip.innerHTML = `<pre style="margin:0;font-family:var(--mono);font-size:12px;color:#e1e4e8;white-space:pre-wrap;word-break:break-all">${_esc(query)}</pre>`;
        tooltip.style.display = 'block';
        // Position near the item
        const itemRect = item.getBoundingClientRect();
        const areaRect = area.getBoundingClientRect();
        tooltip.style.top = (itemRect.top - areaRect.top - tooltip.offsetHeight - 4) + 'px';
        // If tooltip goes above viewport, show below instead
        if (itemRect.top - tooltip.offsetHeight - 4 < areaRect.top) {
          tooltip.style.top = (itemRect.bottom - areaRect.top + 4) + 'px';
        }
      });
      item.addEventListener('mouseleave', () => {
        tooltipTimeout = setTimeout(() => { tooltip.style.display = 'none'; }, 200);
      });
    });
    // Keep tooltip visible when hovering over it
    tooltip.addEventListener('mouseenter', () => { clearTimeout(tooltipTimeout); });
    tooltip.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

    area.querySelector('#soql-clear-history')?.addEventListener('click', () => {
      QS().clearHistory();
      _renderHistory();
    });
    area.querySelectorAll('.history-load').forEach(btn => {
      btn.addEventListener('click', () => {
        _editor.value = history[parseInt(btn.dataset.index, 10)].query;
        _updateHighlight();
        _switchTab('editor');
        _container.querySelectorAll('.soql-tab').forEach(t => t.classList.remove('active'));
        _container.querySelector('[data-tab="editor"]').classList.add('active');
      });
    });
  }

  function _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  }

  function _exportCSV() {
    if (!_lastResults?.records) return;
    _track('export_csv');
    QS().downloadFile(QS().recordsToCSV(_lastResults.records), 'query_results.csv', 'text/csv');
  }

  function _exportJSON() {
    if (!_lastResults?.records) return;
    _track('export_json');
    QS().downloadFile(QS().recordsToJSON(_lastResults.records), 'query_results.json', 'application/json');
  }

  function _copyToClipboard() {
    if (!_lastResults?.records) return;
    navigator.clipboard.writeText(QS().recordsToJSON(_lastResults.records)).catch(() => {});
    _statusBar.textContent = 'Results copied to clipboard';
  }

  function _setExportEnabled(enabled) {
    _container.querySelector('#soql-csv').disabled = !enabled;
    _container.querySelector('#soql-json').disabled = !enabled;
    _container.querySelector('#soql-clipboard').disabled = !enabled;
  }

  function _toggleSize() {
    _panel.classList.toggle('expanded');
    const btn = _container.querySelector('#soql-resize');
    if (btn) {
      const I = ICONS();
      btn.innerHTML = _panel.classList.contains('expanded') ? I.minimize : I.maximize;
      btn.title = _panel.classList.contains('expanded') ? 'Restore Size' : 'Expand';
    }
  }

  // ─── CRUD Operations ────────────────────────────────

  let _queriedSObjectType = null;
  let _isToolingQuery = false;

  /** Extract sObject type from SOQL query */
  function _extractSObjectType(soql) {
    const match = soql.match(/\bFROM\s+(\w+)/i);
    return match ? match[1] : null;
  }

  /** Determine which fields are editable (exclude Id, system fields, relationship fields) */
  function _getEditableKeys(keys) {
    const systemFields = new Set([
      'id', 'createddate', 'createdbyid', 'lastmodifieddate', 'lastmodifiedbyid',
      'systemmodstamp', 'isdeleted', 'attributes', 'ownerid'
    ]);
    return keys.filter(k => {
      const lower = k.toLowerCase();
      // Skip system fields
      if (systemFields.has(lower)) return false;
      // Skip relationship traversals (contain dots like Account.Name)
      if (k.includes('.')) return false;
      // Skip relationship objects (end with __r — these are read-only lookups)
      if (k.endsWith('__r')) return false;
      return true;
    });
  }

  /** Parse Salesforce API error into a clean message */
  function _parseApiError(errMessage) {
    if (!errMessage) return 'Unknown error';
    // Try to extract JSON error array from the message
    const jsonMatch = errMessage.match(/\[(\{.*\})\]/s);
    if (jsonMatch) {
      try {
        const errors = JSON.parse(`[${jsonMatch[1]}]`);
        return errors.map(e => {
          let msg = e.message || '';
          // Clean up \n\n to actual newlines
          msg = msg.replace(/\\n/g, '\n').trim();
          const code = e.errorCode ? ` (${e.errorCode})` : '';
          const fields = e.fields && e.fields.length > 0 ? `\nFields: ${e.fields.join(', ')}` : '';
          return msg + code + fields;
        }).join('\n\n');
      } catch { }
    }
    // Just clean up the raw message
    return errMessage.replace(/^Salesforce API \d+:\s*/, '').replace(/\\n/g, '\n');
  }

  /** Show record editor modal (for Edit, Clone, or Create) */
  async function _showRecordEditor(mode, record, keys) {
    // mode: 'edit' | 'clone' | 'create'
    if (!_queriedSObjectType) {
      alert('Cannot determine sObject type from query.');
      return;
    }

    const isNew = mode === 'clone' || mode === 'create';
    const title = mode === 'edit' ? `Edit ${_queriedSObjectType}`
      : mode === 'clone' ? `Clone ${_queriedSObjectType}`
      : `Create ${_queriedSObjectType}`;

    // Show loading modal first
    const modal = document.createElement('div');
    modal.className = 'sfdt-crud-overlay';
    modal.innerHTML = `
      <div class="sfdt-crud-modal">
        <div class="sfdt-crud-header">
          <span class="sfdt-crud-title">${title}</span>
          <div style="display:flex;gap:6px">
            <button class="sfdt-btn sfdt-crud-cancel">${ICONS().x} Cancel</button>
          </div>
        </div>
        <div class="sfdt-crud-body" style="align-items:center;justify-content:center;padding:40px">
          <div class="sfdt-loading">Loading fields...</div>
        </div>
      </div>
    `;
    _resultsContainer.appendChild(modal);
    modal.querySelector('.sfdt-crud-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Fetch full field describe for the sObject
    let allFields = [];
    let fullRecord = record; // will be enriched for clone
    try {
      const API = window.SalesforceAPI;
      const describe = await API.describeSObject(_queriedSObjectType);
      allFields = (describe.fields || [])
        .filter(f => {
          if (mode === 'edit') return f.updateable;
          return f.createable; // clone and create
        })
        .sort((a, b) => {
          // Required fields first, then alphabetical
          if (a.nillable === b.nillable) return a.label.localeCompare(b.label);
          return a.nillable ? 1 : -1;
        });

      // For clone, fetch the FULL record so all field values are available (not just SOQL columns)
      if (mode === 'clone' && record) {
        const recordId = record.Id || record.id;
        if (recordId) {
          try {
            const creatableNames = allFields.map(f => f.name);
            const fetchFields = creatableNames.join(',');
            const fullData = await API.restGet(`/sobjects/${_queriedSObjectType}/${recordId}?fields=${fetchFields}`);
            fullRecord = fullData;
          } catch (fetchErr) {
            window._sfdtLogger.debug('[SFDT] Full record fetch failed, using query data:', fetchErr.message);
          }
        }
      }
    } catch (err) {
      // Fallback to query keys if describe fails
      window._sfdtLogger.debug('[SFDT] Describe failed:', err.message);
      const editableKeys = _getEditableKeys(keys);
      allFields = editableKeys.map(k => ({ name: k, label: k, type: 'string', nillable: true }));
    }

    if (allFields.length === 0) {
      modal.querySelector('.sfdt-crud-body').innerHTML = '<div style="padding:16px;color:#6e7681;text-align:center">No writable fields found for this object.</div>';
      return;
    }

    // Build form fields — pre-fill from record data where available
    const fieldsHtml = allFields.map(f => {
      let val = '';
      if (fullRecord && mode !== 'create') {
        const recVal = fullRecord[f.name];
        if (recVal != null) val = String(recVal);
      }
      const required = !f.nillable && !f.defaultedOnCreate;
      const fieldType = f.type || 'string';
      const typeHint = fieldType !== 'string' ? ` (${fieldType})` : '';

      return `<div class="sfdt-crud-field">
        <label class="sfdt-crud-label" title="${_esc(f.name)}${typeHint}">
          ${required ? '<span style="color:#f85149">*</span> ' : ''}${_esc(f.label || f.name)}
        </label>
        <input type="text" class="sfdt-crud-input ${required ? 'sfdt-crud-required' : ''}" 
               data-field="${_esc(f.name)}" data-type="${_esc(fieldType)}"
               value="${_esc(val)}" 
               placeholder="${_esc(f.name)}${typeHint}" />
      </div>`;
    }).join('');

    // Re-render the modal with full form
    modal.innerHTML = `
       <div class="sfdt-crud-modal" style="padding:10px !important">
        <div class="sfdt-crud-header">
          <span class="sfdt-crud-title">${title}</span>
          <span style="font-size:11px;color:#6e7681;margin-left:8px">${allFields.length} fields${allFields.filter(f => !f.nillable && !f.defaultedOnCreate).length > 0 ? ' · <span style="color:#f85149">* = required</span>' : ''}</span>
          <div style="display:flex;gap:6px;margin-left:auto">
            <input type="text" class="sfdt-crud-filter" placeholder="Filter fields..." style="padding:4px 10px;background:var(--bg);color:#e1e4e8;border:1px solid var(--border);border-radius:4px;font-size:12px;width:160px;outline:none" />
            <button class="sfdt-btn sfdt-btn-primary sfdt-crud-save">${ICONS().check} ${isNew ? 'Create' : 'Save'}</button>
            <button class="sfdt-btn sfdt-crud-cancel">${ICONS().x} Cancel</button>
          </div>
        </div>
        <div class="sfdt-crud-body">
          ${fieldsHtml}
        </div>
        <div class="sfdt-crud-footer" id="crud-msg"></div>
      </div>
    `;

    // Cancel
    modal.querySelector('.sfdt-crud-cancel').addEventListener('click', () => modal.remove());

    // Filter fields
    const filterInput = modal.querySelector('.sfdt-crud-filter');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        const q = filterInput.value.toLowerCase();
        modal.querySelectorAll('.sfdt-crud-field').forEach(el => {
          const label = el.querySelector('.sfdt-crud-label').textContent.toLowerCase();
          const name = el.querySelector('.sfdt-crud-input').dataset.field.toLowerCase();
          el.style.display = (!q || label.includes(q) || name.includes(q)) ? '' : 'none';
        });
      });
    }

    // Save
    modal.querySelector('.sfdt-crud-save').addEventListener('click', async () => {
      const msgEl = modal.querySelector('#crud-msg');
      const data = {};
      modal.querySelectorAll('.sfdt-crud-input').forEach(inp => {
        const field = inp.dataset.field;
        const fieldType = inp.dataset.type;
        const val = inp.value.trim();

        if (val === '') return; // Skip empty fields

        // Type coercion based on field type
        if (fieldType === 'boolean') {
          data[field] = val.toLowerCase() === 'true';
        } else if (['double', 'currency', 'percent', 'int', 'long'].includes(fieldType)) {
          data[field] = Number(val);
        } else if (val === 'null') {
          data[field] = null;
        } else {
          data[field] = val;
        }
      });

      if (Object.keys(data).length === 0) {
        msgEl.textContent = 'No fields to save.';
        msgEl.style.color = '#fbbf24';
        return;
      }

      msgEl.textContent = isNew ? 'Creating record...' : 'Saving...';
      msgEl.style.color = '#58a6ff';

      try {
        const API = window.SalesforceAPI;
        if (isNew) {
          const result = await API.restPost(_queriedSObjectType, data);
          msgEl.textContent = `Created! ID: ${result.id || result.Id || 'OK'}`;
          msgEl.style.color = '#22c55e';
          _statusBar.textContent = `Record created successfully`;
          setTimeout(() => { modal.remove(); _rerunLastQuery(); }, 1000);
        } else {
          const recordId = record.Id || record.id;
          if (!recordId) { msgEl.textContent = 'No Id found for update.'; msgEl.style.color = '#f85149'; return; }
          await API.restPatch(_queriedSObjectType, recordId, data);
          msgEl.textContent = 'Saved successfully!';
          msgEl.style.color = '#22c55e';
          _statusBar.textContent = `Record ${recordId} updated`;
          setTimeout(() => { modal.remove(); _rerunLastQuery(); }, 1000);
        }
      } catch (err) {
        msgEl.innerHTML = `<div style="color:#f85149;white-space:pre-wrap;max-height:120px;overflow-y:auto;font-size:12px"><strong>Error:</strong> ${_esc(_parseApiError(err.message))}</div>`;
      }
    });
  }

  /** Delete a record with confirmation */
  async function _deleteRecord(recordId) {
    if (!_queriedSObjectType || !recordId) return;
    if (!confirm(`Delete this ${_queriedSObjectType} record?\n\nID: ${recordId}\n\nThis cannot be undone.`)) return;

    _statusBar.textContent = 'Deleting record...';
    try {
      const API = window.SalesforceAPI;
      await API.restDelete(_queriedSObjectType, recordId);
      _statusBar.textContent = `Record ${recordId} deleted`;
      // Re-run query to refresh
      _rerunLastQuery();
    } catch (err) {
      _statusBar.textContent = `Delete error: ${_parseApiError(err.message).substring(0, 100)}`;
    }
  }

  // ─── Schema Explorer ───────────────────────────────

  let _schemaCache = {};

  function _toggleSchemaExplorer() {
    _track('schema');
    const sidebar = _container.querySelector('#soql-schema-sidebar');
    const visible = sidebar.style.display !== 'none';
    sidebar.style.display = visible ? 'none' : 'flex';
    if (!visible) _loadSchemaObjects();
  }

  async function _loadSchemaObjects() {
    const tree = _container.querySelector('#soql-schema-tree');
    const searchInput = _container.querySelector('#soql-schema-search');
    tree.innerHTML = '<div style="padding:12px;color:#8b949e;font-size:12px">Loading objects...</div>';

    try {
      const API = window.SalesforceAPI;
      const res = await API.describeGlobal();
      const objects = (res.sobjects || [])
        .filter(function(o) { return o.queryable; })
        .sort(function(a, b) { return a.name.localeCompare(b.name); });

      function renderObjectList(filter) {
        const filtered = filter
          ? objects.filter(function(o) { return o.name.toLowerCase().includes(filter.toLowerCase()) || (o.label && o.label.toLowerCase().includes(filter.toLowerCase())); })
          : objects;

        tree.innerHTML = filtered.slice(0, 100).map(function(obj) {
          return '<div class="sfdt-schema-obj" data-obj="' + _esc(obj.name) + '" style="padding:4px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04)">' +
            '<span style="color:#58a6ff;font-weight:500">' + _esc(obj.name) + '</span>' +
            (obj.label && obj.label !== obj.name ? ' <span style="color:#6e7681;font-size:11px">(' + _esc(obj.label) + ')</span>' : '') +
            (obj.custom ? ' <span style="color:#d29922;font-size:10px">Custom</span>' : '') +
            '<div class="sfdt-schema-fields" data-obj="' + _esc(obj.name) + '" style="display:none;padding:4px 0 4px 16px"></div>' +
          '</div>';
        }).join('');

        if (filtered.length > 100) {
          tree.innerHTML += '<div style="padding:8px 12px;color:#8b949e;font-size:11px">' + (filtered.length - 100) + ' more objects... refine search</div>';
        }

        // Click to expand/collapse object fields
        tree.querySelectorAll('.sfdt-schema-obj').forEach(function(el) {
          el.addEventListener('click', function(e) {
            if (e.target.closest('.sfdt-schema-field-item')) return;
            const objName = el.dataset.obj;
            const fieldsDiv = el.querySelector('.sfdt-schema-fields');
            if (fieldsDiv.style.display !== 'none') {
              fieldsDiv.style.display = 'none';
              return;
            }
            fieldsDiv.style.display = 'block';
            _loadSchemaFields(objName, fieldsDiv);
          });
        });
      }

      renderObjectList('');
      searchInput.addEventListener('input', function() {
        renderObjectList(searchInput.value);
      });
    } catch (err) {
      tree.innerHTML = '<div style="padding:12px;color:#f85149;font-size:12px">Error loading objects: ' + _esc(err.message) + '</div>';
    }
  }

  async function _loadSchemaFields(objName, container) {
    if (_schemaCache[objName]) {
      _renderSchemaFields(_schemaCache[objName], container);
      return;
    }
    container.innerHTML = '<span style="color:#8b949e;font-size:11px">Loading fields...</span>';
    try {
      const API = window.SalesforceAPI;
      const desc = await API.describeSObject(objName);
      _schemaCache[objName] = desc.fields || [];
      _renderSchemaFields(desc.fields || [], container);
    } catch (err) {
      container.innerHTML = '<span style="color:#f85149;font-size:11px">Error: ' + _esc(err.message) + '</span>';
    }
  }

  function _renderSchemaFields(fields, container) {
    const typeColors = {
      string: '#22c55e', textarea: '#22c55e', url: '#22c55e', email: '#22c55e', phone: '#22c55e',
      id: '#58a6ff', reference: '#58a6ff',
      'double': '#d29922', currency: '#d29922', percent: '#d29922', 'int': '#d29922', integer: '#d29922',
      'boolean': '#c084fc',
      date: '#d2a8ff', datetime: '#d2a8ff',
      picklist: '#f97316', multipicklist: '#f97316'
    };

    container.innerHTML = fields.sort(function(a, b) { return a.name.localeCompare(b.name); }).map(function(f) {
      const color = typeColors[f.type] || '#8b949e';
      const indicators = [];
      if (f.custom) indicators.push('<span style="color:#d29922" title="Custom field">●</span>');
      if (f.calculated) indicators.push('<span style="color:#c084fc" title="Formula field">ƒ</span>');
      if (!f.nillable && !f.defaultedOnCreate) indicators.push('<span style="color:#f85149" title="Required">*</span>');
      if (f.externalId) indicators.push('<span style="color:#22c55e" title="External ID">⚷</span>');

      return '<div class="sfdt-schema-field-item" data-field="' + _esc(f.name) + '" ' +
        'style="padding:2px 0;cursor:pointer;display:flex;align-items:center;gap:4px;font-size:11px" ' +
        'title="' + _esc(f.label + ' (' + f.type + ')' + (f.length ? ' length:' + f.length : '') + (f.referenceTo && f.referenceTo.length ? ' → ' + f.referenceTo.join(', ') : '')) + '">' +
        '<span style="color:' + color + ';font-family:var(--mono);min-width:8ch">' + _esc(f.type.substring(0, 8)) + '</span>' +
        '<span style="color:#e1e4e8">' + _esc(f.name) + '</span>' +
        (indicators.length ? ' ' + indicators.join('') : '') +
      '</div>';
    }).join('');

    // Click a field to insert at cursor
    container.querySelectorAll('.sfdt-schema-field-item').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const fieldName = el.dataset.field;
        const pos = _editor.selectionStart;
        const text = _editor.value;
        _editor.value = text.substring(0, pos) + fieldName + text.substring(pos);
        _editor.selectionStart = _editor.selectionEnd = pos + fieldName.length;
        _editor.focus();
        _updateHighlight();
        _statusBar.textContent = 'Inserted: ' + fieldName;
      });
    });
  }

  // ─── Result Visualization (Charts for GROUP BY) ─────

  function _renderResultChart(flatRecords, keys) {
    // Only show for aggregate queries with GROUP BY
    const soql = _editor.value.trim().toUpperCase();
    if (!soql.includes('GROUP BY') && !soql.includes('COUNT(') && !soql.includes('SUM(')) return;
    if (flatRecords.length === 0 || flatRecords.length > 50) return;
    _track('chart');

    // Find label key (first non-aggregate) and value key (first aggregate)
    let labelKey = null, valueKey = null;
    for (const k of keys) {
      const kl = k.toLowerCase();
      if (!labelKey && !kl.startsWith('expr') && kl !== 'cnt' && kl !== 'total' && kl !== 'count' && kl !== 'avg') {
        labelKey = k;
      }
      if (!valueKey && (kl === 'cnt' || kl === 'total' || kl === 'count' || kl === 'avg' || kl.startsWith('expr') || typeof flatRecords[0][k] === 'number')) {
        valueKey = k;
      }
    }
    if (!labelKey || !valueKey) return;

    const maxVal = Math.max.apply(null, flatRecords.map(function(r) { return parseFloat(r[valueKey]) || 0; }));
    if (maxVal === 0) return;

    const colors = ['#58a6ff', '#22c55e', '#d29922', '#f85149', '#c084fc', '#f97316', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981'];

    const chartHtml = '<div style="padding:12px;border-top:1px solid var(--border);background:rgba(0,0,0,0.2)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<span style="font-weight:600;font-size:12px;color:#8b949e">📊 Result Chart</span>' +
        '<button class="sfdt-btn sfdt-btn-sm" id="soql-chart-close">Hide</button>' +
      '</div>' +
      flatRecords.slice(0, 20).map(function(r, i) {
        const val = parseFloat(r[valueKey]) || 0;
        const pct = (val / maxVal * 100).toFixed(1);
        const color = colors[i % colors.length];
        const label = String(r[labelKey] || '(empty)');
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px">' +
          '<span style="min-width:120px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e1e4e8" title="' + _esc(label) + '">' + _esc(label.substring(0, 30)) + '</span>' +
          '<div style="flex:1;background:rgba(255,255,255,0.05);border-radius:3px;height:18px;overflow:hidden">' +
            '<div style="width:' + pct + '%;background:' + color + ';height:100%;border-radius:3px;transition:width .3s"></div>' +
          '</div>' +
          '<span style="min-width:50px;text-align:right;color:' + color + ';font-weight:500;font-family:var(--mono)">' + val + '</span>' +
        '</div>';
      }).join('') +
    '</div>';

    // Append chart after results table
    const existingChart = _resultsContainer.querySelector('#soql-result-chart');
    if (existingChart) existingChart.remove();
    const chartDiv = document.createElement('div');
    chartDiv.id = 'soql-result-chart';
    chartDiv.innerHTML = chartHtml;
    _resultsContainer.appendChild(chartDiv);

    chartDiv.querySelector('#soql-chart-close').addEventListener('click', function() {
      chartDiv.remove();
    });
  }

  // ─── Relationship Query Helper ─────────────────────

  function _getRelationshipSuggestions(text, cursorPos) {
    // Detect if user is typing a relationship field like "Account."
    const beforeCursor = text.substring(0, cursorPos);
    const match = beforeCursor.match(/(\w+)\.\s*$/);
    if (!match) return null;
    const relName = match[1];
    // Check if it's a known cached object
    if (_schemaCache[relName]) {
      return {
        fields: _schemaCache[relName].map(function(f) { return f.name; }),
        prefix: relName + '.'
      };
    }
    return null;
  }

  // ─── Picklist Value Dropdown in WHERE ──────────────

  async function _getPicklistValues(objectName, fieldName) {
    try {
      const API = window.SalesforceAPI;
      const desc = await API.describeSObject(objectName);
      const field = (desc.fields || []).find(function(f) { return f.name.toLowerCase() === fieldName.toLowerCase(); });
      if (field && field.picklistValues && field.picklistValues.length > 0) {
        return field.picklistValues
          .filter(function(v) { return v.active; })
          .map(function(v) { return { value: v.value, label: v.label || v.value }; });
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  function _showPicklistDropdown(objectName, fieldName, insertPos) {
    _track('picklist');
    _getPicklistValues(objectName, fieldName).then(function(values) {
      if (values.length === 0) return;

      const existing = _container.querySelector('#soql-picklist-dropdown');
      if (existing) existing.remove();

      const dropdown = document.createElement('div');
      dropdown.id = 'soql-picklist-dropdown';
      dropdown.style.cssText = 'position:absolute !important;background:var(--bg2) !important;border:1px solid var(--border) !important;border-radius:6px !important;box-shadow:0 4px 12px rgba(0,0,0,.4) !important;z-index:1000 !important;max-height:200px !important;overflow-y:auto !important;min-width:200px !important;padding:4px 0 !important;';

      dropdown.innerHTML = '<div style="padding:10px 16px !important;font-size:11px !important;color:#6e7681 !important;border-bottom:1px solid var(--border) !important;margin-bottom:2px !important">' +
        _esc(fieldName) + ' values</div>' +
        values.map(function(v) {
          return '<div class="sfdt-picklist-item" data-value="' + _esc(v.value) + '" ' +
            'style="padding:8px 16px !important;cursor:pointer !important;font-size:13px !important;color:#e1e4e8 !important" ' +
            'title="' + _esc(v.label) + '">' +
            _esc(v.value) + (v.label !== v.value ? ' <span style="color:#6e7681">(' + _esc(v.label) + ')</span>' : '') +
          '</div>';
        }).join('');

      // Position near editor
      const editorRect = _editor.getBoundingClientRect();
      const containerRect = _container.getBoundingClientRect();
      dropdown.style.top = (editorRect.bottom - containerRect.top + 2) + 'px';
      dropdown.style.left = '16px';
      _container.appendChild(dropdown);

      dropdown.querySelectorAll('.sfdt-picklist-item').forEach(function(item) {
        item.addEventListener('mouseenter', function() { item.style.background = 'var(--bg-hover)'; });
        item.addEventListener('mouseleave', function() { item.style.background = ''; });
        item.addEventListener('click', function() {
          const val = "'" + item.dataset.value + "'";
          const text = _editor.value;
          _editor.value = text.substring(0, insertPos) + val + text.substring(insertPos);
          _editor.selectionStart = _editor.selectionEnd = insertPos + val.length;
          _editor.focus();
          _updateHighlight();
          dropdown.remove();
        });
      });

      // Close on click outside
      setTimeout(function() {
        document.addEventListener('click', function closePicklist(e) {
          if (!dropdown.contains(e.target)) {
            dropdown.remove();
            document.removeEventListener('click', closePicklist);
          }
        });
      }, 10);
    });
  }

  // ─── Query Diff / Compare ─────────────────────────

  let _diffQueryA = null;
  let _diffQueryB = null;

  function _showQueryDiff() {
    _track('diff');
    const soql = _editor.value.trim();
    if (!soql) {
      _statusBar.textContent = 'Enter a query first';
      return;
    }

    const existingModal = _container.querySelector('#soql-diff-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'soql-diff-modal';
    modal.className = 'sfdt-crud-modal';
    modal.innerHTML =
      '<div class="sfdt-crud-dialog" style="max-width:900px;width:90%">' +
        '<div class="sfdt-crud-header">' +
          '<span class="sfdt-crud-title">📊 Query Diff / Compare</span>' +
          '<button class="sfdt-btn sfdt-btn-sm" id="diff-close">' + ICONS().x + '</button>' +
        '</div>' +
        '<div style="padding:16px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
            '<div>' +
              '<label style="font-size:12px;color:#8b949e;display:block;margin-bottom:4px">Query A</label>' +
              '<textarea id="diff-query-a" style="width:100%;height:80px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-family:var(--mono);font-size:12px;resize:none">' + _esc(_diffQueryA || soql) + '</textarea>' +
              '<button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary" id="diff-run-a" style="margin-top:4px">Run A</button>' +
              '<div id="diff-result-a" style="margin-top:8px;max-height:300px;overflow:auto;font-size:11px"></div>' +
            '</div>' +
            '<div>' +
              '<label style="font-size:12px;color:#8b949e;display:block;margin-bottom:4px">Query B</label>' +
              '<textarea id="diff-query-b" style="width:100%;height:80px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-family:var(--mono);font-size:12px;resize:none">' + _esc(_diffQueryB || '') + '</textarea>' +
              '<button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary" id="diff-run-b" style="margin-top:4px">Run B</button>' +
              '<div id="diff-result-b" style="margin-top:8px;max-height:300px;overflow:auto;font-size:11px"></div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">' +
            '<button class="sfdt-btn sfdt-btn-primary" id="diff-compare" disabled>Compare Results</button>' +
            '<div id="diff-comparison" style="margin-top:8px;max-height:250px;overflow:auto;font-size:11px"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    _container.appendChild(modal);

    let resultA = null, resultB = null;

    modal.querySelector('#diff-close').addEventListener('click', function() { modal.remove(); });

    async function runDiffQuery(query, resultDiv, side) {
      resultDiv.innerHTML = '<span style="color:#8b949e">Running...</span>';
      try {
        const API = window.SalesforceAPI;
        const res = await API.query(query);
        if (side === 'a') resultA = res.records || [];
        else resultB = res.records || [];
        resultDiv.innerHTML = '<span style="color:#22c55e">' + (res.records || []).length + ' records returned</span>';
        if (resultA && resultB) modal.querySelector('#diff-compare').disabled = false;
      } catch (err) {
        resultDiv.innerHTML = '<span style="color:#f85149">Error: ' + _esc(err.message).substring(0, 80) + '</span>';
      }
    }

    modal.querySelector('#diff-run-a').addEventListener('click', function() {
      const q = modal.querySelector('#diff-query-a').value.trim();
      _diffQueryA = q;
      runDiffQuery(q, modal.querySelector('#diff-result-a'), 'a');
    });
    modal.querySelector('#diff-run-b').addEventListener('click', function() {
      const q = modal.querySelector('#diff-query-b').value.trim();
      _diffQueryB = q;
      runDiffQuery(q, modal.querySelector('#diff-result-b'), 'b');
    });

    modal.querySelector('#diff-compare').addEventListener('click', function() {
      const compDiv = modal.querySelector('#diff-comparison');
      if (!resultA || !resultB) { compDiv.innerHTML = '<span style="color:#f85149">Run both queries first</span>'; return; }

      // Compare by Id if available, otherwise by row index
      const aIds = new Set(resultA.map(function(r) { return r.Id || r.id; }).filter(Boolean));
      const bIds = new Set(resultB.map(function(r) { return r.Id || r.id; }).filter(Boolean));

      let html = '<div style="font-weight:600;margin-bottom:6px;color:#e1e4e8">Comparison Summary</div>';
      if (aIds.size > 0 && bIds.size > 0) {
        const onlyA = []; aIds.forEach(function(id) { if (!bIds.has(id)) onlyA.push(id); });
        const onlyB = []; bIds.forEach(function(id) { if (!aIds.has(id)) onlyB.push(id); });
        const both = []; aIds.forEach(function(id) { if (bIds.has(id)) both.push(id); });

        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">' +
          '<div style="background:rgba(88,166,255,.1);border-radius:6px;padding:8px;text-align:center">' +
            '<div style="font-size:20px;color:#58a6ff;font-weight:700">' + onlyA.length + '</div>' +
            '<div style="font-size:11px;color:#8b949e">Only in A</div>' +
          '</div>' +
          '<div style="background:rgba(34,197,94,.1);border-radius:6px;padding:8px;text-align:center">' +
            '<div style="font-size:20px;color:#22c55e;font-weight:700">' + both.length + '</div>' +
            '<div style="font-size:11px;color:#8b949e">In Both</div>' +
          '</div>' +
          '<div style="background:rgba(210,169,34,.1);border-radius:6px;padding:8px;text-align:center">' +
            '<div style="font-size:20px;color:#d29922;font-weight:700">' + onlyB.length + '</div>' +
            '<div style="font-size:11px;color:#8b949e">Only in B</div>' +
          '</div>' +
        '</div>';

        if (onlyA.length > 0) {
          html += '<div style="color:#58a6ff;font-size:11px;margin-bottom:4px">IDs only in A: ' + onlyA.slice(0, 10).map(function(id) { return _esc(id); }).join(', ') + (onlyA.length > 10 ? '...' : '') + '</div>';
        }
        if (onlyB.length > 0) {
          html += '<div style="color:#d29922;font-size:11px;margin-bottom:4px">IDs only in B: ' + onlyB.slice(0, 10).map(function(id) { return _esc(id); }).join(', ') + (onlyB.length > 10 ? '...' : '') + '</div>';
        }
      } else {
        html += '<div style="color:#8b949e;font-size:12px">A: ' + resultA.length + ' records, B: ' + resultB.length + ' records</div>' +
          '<div style="color:#8b949e;font-size:11px">No Id field for detailed comparison — showing record counts only</div>';
      }
      compDiv.innerHTML = html;
    });
  }

  /** Re-run the current query to refresh results */
  function _rerunLastQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    if (_isToolingQuery) {
      _runToolingQuery();
    } else {
      _runQuery();
    }
  }

  function _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function show() {
    _create();
    _switchTab('editor');
    _panel.classList.add('visible');
    _visible = true;
    requestAnimationFrame(() => _editor.focus());
  }

  function hide() {
    if (_panel) _panel.classList.remove('visible');
    _visible = false;
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }
  function isPinned() { return _pinned; }

  function _togglePin() {
    _pinned = !_pinned;
    const btn = _container.querySelector('#soql-pin');
    if (btn) {
      btn.classList.toggle('sfdt-btn-active', _pinned);
      btn.title = _pinned ? 'Unpin panel' : 'Pin panel open';
    }
  }

  return { show, hide, toggle, isVisible, isPinned };
})();

if (typeof window !== 'undefined') window.SFDTSOQLPanel = SOQLPanel;
