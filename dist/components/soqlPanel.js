/**
 * SOQLPanel - SOQL Query Editor with Shadow DOM isolation.
 * Features: built-in examples, autocomplete, history, favorites, export, maximize, open in new tab.
 */
const SOQLPanel = (() => {
  const QS = () => window.SFDTQueryService;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _panel = null;
  let _visible = false;
  let _editor = null;
  let _resultsContainer = null;
  let _statusBar = null;
  let _lastResults = null;
  let _autocompleteDropdown = null;
  let _currentSuggestions = [];
  let _suggestionIndex = -1;
  let _activeTab = 'editor';

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
    { name: 'API Limits', query: 'SELECT Name, Max, Remaining\nFROM DataStatistics' }
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
            <button class="sfdt-btn sfdt-btn-sm soql-tab" data-tab="history">History</button>
            <button class="sfdt-btn sfdt-btn-sm soql-tab" data-tab="favorites">Favorites</button>
            <span class="sfdt-soql-divider">|</span>
            <button class="sfdt-btn sfdt-btn-sm" id="soql-newtab" title="Open in new tab">${I.maximize} New Tab</button>
            <button class="sfdt-btn sfdt-btn-sm" id="soql-resize" title="Toggle size">${I.maximize}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="soql-close" title="Close panel">${I.x} Close</button>
          </div>
        </div>
        <div class="sfdt-soql-content">
          <div class="sfdt-soql-editor-area" id="soql-editor-area">
            <div class="sfdt-soql-editor-wrapper">
              <textarea class="sfdt-soql-editor" id="soql-editor"
                        placeholder="SELECT Id, Name FROM Account LIMIT 10&#10;&#10;Tip: Press Ctrl+Enter to run query"
                        spellcheck="false" autocomplete="off"></textarea>
              <div class="sfdt-autocomplete" id="soql-autocomplete"></div>
            </div>
            <div class="sfdt-soql-toolbar">
              <button class="sfdt-btn sfdt-btn-primary" id="soql-run" title="Run Query (Ctrl+Enter)">${I.play} Run</button>
              <button class="sfdt-btn" id="soql-tooling" title="Run as Tooling API query">${I.wrench} Tooling</button>
              <button class="sfdt-btn" id="soql-analyze" title="Analyze query">${I.chart} Analyze</button>
              <button class="sfdt-btn" id="soql-format" title="Format query">${I.code} Format</button>
              <button class="sfdt-btn" id="soql-save-fav" title="Save to favorites">${I.star} Save</button>
              <span class="sfdt-soql-divider">|</span>
              <button class="sfdt-btn" id="soql-csv" title="Export CSV" disabled>CSV</button>
              <button class="sfdt-btn" id="soql-json" title="Export JSON" disabled>JSON</button>
              <button class="sfdt-btn" id="soql-clipboard" title="Copy to clipboard" disabled>${I.copy} Copy</button>
            </div>
            <div class="sfdt-soql-hints" id="soql-hints"></div>
          </div>
          <div class="sfdt-soql-results" id="soql-results">
            <div class="sfdt-soql-placeholder">
              <div style="margin-bottom:12px;font-size:15px;color:#89b4fa;font-weight:600">SOQL Query Tool</div>
              <div style="margin-bottom:8px;color:#a6adc8">Write a SOQL query and press <strong style="color:#cdd6f4">Ctrl+Enter</strong> to execute.</div>
              <div style="color:#7f849c;font-size:12px">Check the <strong>Examples</strong> tab for sample queries to get started.</div>
            </div>
          </div>
          <div class="sfdt-soql-history-area" id="soql-history-area" style="display:none"></div>
          <div class="sfdt-soql-favorites-area" id="soql-favorites-area" style="display:none"></div>
          <div class="sfdt-soql-examples-area" id="soql-examples-area" style="display:none"></div>
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
    _container.querySelector('#soql-run').addEventListener('click', _runQuery);
    _container.querySelector('#soql-tooling').addEventListener('click', _runToolingQuery);
    _container.querySelector('#soql-analyze').addEventListener('click', _analyzeQuery);
    _container.querySelector('#soql-format').addEventListener('click', _formatQuery);
    _container.querySelector('#soql-save-fav').addEventListener('click', _saveFavorite);
    _container.querySelector('#soql-csv').addEventListener('click', _exportCSV);
    _container.querySelector('#soql-json').addEventListener('click', _exportJSON);
    _container.querySelector('#soql-clipboard').addEventListener('click', _copyToClipboard);
    _container.querySelector('#soql-resize').addEventListener('click', _toggleSize);
    _container.querySelector('#soql-newtab').addEventListener('click', _openInNewTab);

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
  }

  function _switchTab(tab) {
    _activeTab = tab;
    _container.querySelector('#soql-editor-area').style.display = tab === 'editor' ? '' : 'none';
    _resultsContainer.style.display = tab === 'editor' ? '' : 'none';
    _container.querySelector('#soql-history-area').style.display = tab === 'history' ? '' : 'none';
    _container.querySelector('#soql-favorites-area').style.display = tab === 'favorites' ? '' : 'none';
    _container.querySelector('#soql-examples-area').style.display = tab === 'examples' ? '' : 'none';
    _container.querySelector('#soql-databuilder-area').style.display = tab === 'databuilder' ? '' : 'none';
    if (tab === 'history') _renderHistory();
    if (tab === 'favorites') _renderFavorites();
    if (tab === 'examples') _renderExamples();
    if (tab === 'databuilder') _renderDataBuilder();
  }

  function _openInNewTab() {
    const soql = _editor.value.trim();
    const instanceUrl = window.SalesforceAPI.getInstanceUrl();
    // Open Developer Console or a query page
    if (soql) {
      // Build a QueryEditor URL with the query pre-filled
      const queryUrl = `${instanceUrl}/_ui/common/apex/debug/ApexCSIPage`;
      window.open(queryUrl, '_blank');
    } else {
      window.open(`${instanceUrl}/_ui/common/apex/debug/ApexCSIPage`, '_blank');
    }
  }

  function _onEditorKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      _runQuery();
      return;
    }

    if (_autocompleteDropdown.style.display === 'block') {
      if (e.key === 'ArrowDown') { e.preventDefault(); _suggestionIndex = Math.min(_suggestionIndex + 1, _currentSuggestions.length - 1); _updateSuggestionSelection(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); _suggestionIndex = Math.max(_suggestionIndex - 1, 0); _updateSuggestionSelection(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (_suggestionIndex >= 0 && _currentSuggestions[_suggestionIndex]) { e.preventDefault(); _applySuggestion(_currentSuggestions[_suggestionIndex]); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); _hideAutocomplete(); return; }
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const start = _editor.selectionStart;
      _editor.value = _editor.value.substring(0, start) + '  ' + _editor.value.substring(_editor.selectionEnd);
      _editor.selectionStart = _editor.selectionEnd = start + 2;
    }
  }

  function _onEditorInput() { _showAutocomplete(); }

  async function _showAutocomplete() {
    const text = _editor.value;
    const cursor = _editor.selectionStart;
    const beforeCursor = text.substring(0, cursor);
    const wordMatch = beforeCursor.match(/(\w+)$/);
    const currentWord = wordMatch ? wordMatch[1] : '';

    if (currentWord.length < 2) { _hideAutocomplete(); return; }

    let suggestions = [];

    const fromMatch = beforeCursor.match(/FROM\s+(\w*)$/i);
    if (fromMatch) {
      const objSuggestions = await QS().getObjectSuggestions(fromMatch[1]);
      suggestions = objSuggestions.map(o => ({ text: o.name, label: o.label || o.name, type: 'object' }));
    } else {
      const objectMatch = text.match(/FROM\s+(\w+)/i);
      if (objectMatch) {
        const fieldSuggestions = await QS().getFieldSuggestions(objectMatch[1]);
        suggestions = fieldSuggestions
          .filter(f => f.name.toLowerCase().includes(currentWord.toLowerCase()))
          .slice(0, 15)
          .map(f => ({ text: f.name, label: `${f.name} (${f.type})`, type: 'field' }));
      }
      const kwSuggestions = QS().getKeywordSuggestions()
        .filter(k => k.toLowerCase().startsWith(currentWord.toLowerCase()))
        .slice(0, 5)
        .map(k => ({ text: k, label: k, type: 'keyword' }));
      suggestions = [...suggestions, ...kwSuggestions];
    }

    if (suggestions.length === 0) { _hideAutocomplete(); return; }

    _currentSuggestions = suggestions;
    _suggestionIndex = 0;

    _autocompleteDropdown.innerHTML = suggestions.map((s, i) => `
      <div class="sfdt-ac-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
        <span class="sfdt-ac-text">${_esc(s.label)}</span>
        <span class="sfdt-ac-type">${_esc(s.type)}</span>
      </div>
    `).join('');

    _autocompleteDropdown.style.display = 'block';
    _autocompleteDropdown.querySelectorAll('.sfdt-ac-item').forEach(el => {
      el.addEventListener('click', () => _applySuggestion(_currentSuggestions[parseInt(el.dataset.index, 10)]));
    });
  }

  function _hideAutocomplete() {
    if (_autocompleteDropdown) _autocompleteDropdown.style.display = 'none';
    _currentSuggestions = [];
    _suggestionIndex = -1;
  }

  function _updateSuggestionSelection() {
    const items = _autocompleteDropdown.querySelectorAll('.sfdt-ac-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === _suggestionIndex));
  }

  function _applySuggestion(suggestion) {
    const cursor = _editor.selectionStart;
    const text = _editor.value;
    const wordMatch = text.substring(0, cursor).match(/(\w+)$/);
    const wordStart = wordMatch ? cursor - wordMatch[1].length : cursor;
    _editor.value = text.substring(0, wordStart) + suggestion.text + text.substring(cursor);
    _editor.selectionStart = _editor.selectionEnd = wordStart + suggestion.text.length;
    _editor.focus();
    _hideAutocomplete();
  }

  async function _runQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    _queriedSObjectType = _extractSObjectType(soql);
    _isToolingQuery = false;
    _statusBar.textContent = 'Executing query...';
    _resultsContainer.innerHTML = '<div class="sfdt-soql-loading">Running query...</div>';
    const result = await QS().executeQuery(soql);
    _displayResults(result);
  }

  async function _runToolingQuery() {
    const soql = _editor.value.trim();
    if (!soql) return;
    _queriedSObjectType = _extractSObjectType(soql);
    _isToolingQuery = true;
    _statusBar.textContent = 'Executing tooling query...';
    _resultsContainer.innerHTML = '<div class="sfdt-soql-loading">Running tooling query...</div>';
    const result = await QS().executeToolingQuery(soql);
    _displayResults(result);
  }

  function _displayResults(result) {
    if (!result.success) {
      _resultsContainer.innerHTML = `<div class="sfdt-soql-error">
        <div class="sfdt-soql-error-title">Query Error</div>
        <div class="sfdt-soql-error-msg">${_esc(result.error)}</div>
      </div>`;
      _statusBar.textContent = `Error (${result.executionTime}ms)`;
      _setExportEnabled(false);
      return;
    }

    _lastResults = result;
    _statusBar.textContent = `${result.totalSize} record${result.totalSize !== 1 ? 's' : ''} (${result.executionTime}ms)`;
    _setExportEnabled(result.records.length > 0);

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
      </div>
      <div style="overflow-x:auto !important;flex:1 !important">
        <table class="sfdt-soql-table">
          <thead><tr><th style="width:20px;min-width:20px;padding:0"></th>${keys.map(k => `<th>${_esc(k)}</th>`).join('')}${_queriedSObjectType && !_isToolingQuery ? '<th class="sfdt-actions-th">Actions</th>' : ''}</tr></thead>
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

    // Row expand/collapse
    _resultsContainer.querySelectorAll('.sfdt-row-main').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't toggle if clicking a link or copy cell
        if (e.target.closest('a')) return;
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

    // Copy on click for regular cells
    _resultsContainer.querySelectorAll('.sfdt-copyable').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
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

        switch (action) {
          case 'edit': _showRecordEditor('edit', record, keys); break;
          case 'clone': _showRecordEditor('clone', record, keys); break;
          case 'delete': _deleteRecord(record.Id || record.id); break;
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
      .map(k => `<div style="display:flex;gap:8px;padding:2px 0"><span style="color:#89b4fa;min-width:160px;font-weight:500">${_esc(k)}</span><span style="color:#cdd6f4;word-break:break-all">${_formatCellValue(k, flatRecord[k])}</span></div>`)
      .join('');

    return `<tr class="sfdt-row-main" data-row-index="${rowIndex}" style="cursor:pointer">
      <td style="width:20px;text-align:center;padding:0 4px;color:#7f849c" class="sfdt-row-toggle">▸</td>
      ${cells}
      ${actionsCell}
    </tr>
    <tr class="sfdt-row-detail" data-row-index="${rowIndex}" style="display:none">
      <td colspan="${keys.length + 1 + (_queriedSObjectType && !_isToolingQuery ? 1 : 0)}" style="padding:8px 16px;background:#1e1e2e;border-bottom:1px solid #313244">
        <div style="font-family:var(--mono);font-size:11px;max-height:300px;overflow-y:auto">${detailPairs}</div>
      </td>
    </tr>`;
  }

  /** Format cell value — make IDs and URLs clickable */
  function _formatCellValue(key, val) {
    if (val === null || val === undefined) {
      return '<span class="sfdt-null">null</span>';
    }
    if (typeof val === 'object') {
      return `<span style="font-family:var(--mono);font-size:11px;color:#7f849c">${_esc(JSON.stringify(val))}</span>`;
    }
    const str = String(val);
    // Salesforce 15 or 18 char ID — make clickable
    if (_isSalesforceId(key, str)) {
      const base = window.SalesforceAPI?.getInstanceUrl() || '';
      return `<a href="${base}/${_esc(str)}" target="_blank" rel="noopener" style="color:#89b4fa;text-decoration:underline;cursor:pointer" title="Open record">${_esc(str)}</a>`;
    }
    // URL values — make clickable
    if (/^https?:\/\//i.test(str)) {
      return `<a href="${_esc(str)}" target="_blank" rel="noopener" style="color:#89b4fa;text-decoration:underline;cursor:pointer" title="Open URL">${_esc(str.length > 60 ? str.substring(0, 57) + '...' : str)}</a>`;
    }
    // Boolean styling
    if (str === 'true' || str === 'false') {
      return `<span style="color:${str === 'true' ? '#a6e3a1' : '#f38ba8'}">${str}</span>`;
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
    const plan = QS().getQueryPlan(soql);
    const hints = _container.querySelector('#soql-hints');

    if (plan.hints.length === 0) {
      hints.innerHTML = '<div class="sfdt-hint sfdt-hint-success" style="color:#a6e3a1">Query looks good!</div>';
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
        <div><strong style="color:#89b4fa">Object:</strong> ${_esc(plan.object)}</div>
        <div><strong style="color:#89b4fa">WHERE:</strong> ${plan.hasWhereClause ? 'Yes' : 'No'}</div>
        <div><strong style="color:#89b4fa">LIMIT:</strong> ${plan.hasLimit ? 'Yes' : 'No'}</div>
        <div><strong style="color:#89b4fa">ORDER BY:</strong> ${plan.hasOrderBy ? 'Yes' : 'No'}</div>
        <div><strong style="color:#89b4fa">Subqueries:</strong> ${plan.subqueryCount}</div>
      </div>
    `;
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
        <span style="color:#89b4fa;font-weight:600;font-size:13px">${I.bolt} Built-in Example Queries</span>
        <span style="color:#7f849c;font-size:11px">(click to load into editor)</span>
      </div>
      ${EXAMPLE_QUERIES.map((ex, i) => `
        <div class="sfdt-soql-history-item" style="cursor:pointer" data-index="${i}">
          <div class="sfdt-soql-history-query" style="pointer-events:none">
            <strong style="color:#89b4fa;font-size:12px">${_esc(ex.name)}</strong>
            <pre style="color:#cdd6f4;margin-top:4px">${_esc(ex.query)}</pre>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;pointer-events:auto">
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary example-load" data-index="${i}">${I.play} Load</button>
          </div>
        </div>
      `).join('')}
    `;

    area.querySelectorAll('.example-load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        _editor.value = EXAMPLE_QUERIES[idx].query;
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
      area.innerHTML = `<div class="sfdt-soql-empty">No saved queries yet.<br><span style="color:#7f849c;font-size:11px">Use ${I.star} Save in the toolbar to add favorites.</span></div>`;
      return;
    }
    area.innerHTML = favs.map((f, i) => `
      <div class="sfdt-soql-history-item">
        <div class="sfdt-soql-history-query">
          <strong style="color:#89b4fa">${_esc(f.name)}</strong>
          <pre style="color:#cdd6f4">${_esc(f.query)}</pre>
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
      area.innerHTML = '<div class="sfdt-soql-empty">No query history yet.<br><span style="color:#7f849c;font-size:11px">Run a query and it will appear here.</span></div>';
      return;
    }
    area.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:8px 16px;font-size:12px;color:#a6adc8;border-bottom:1px solid var(--border);align-items:center">
        <span style="font-weight:600">${history.length} queries in history</span>
        <button class="sfdt-btn sfdt-btn-sm" id="soql-clear-history">${I.x} Clear All</button>
      </div>
      ${history.slice(0, 50).map((h, i) => `
        <div class="sfdt-soql-history-item ${h.success ? '' : 'error-item'}">
          <div class="sfdt-soql-history-query">
            <pre style="color:#cdd6f4">${_esc(h.query)}</pre>
            <div class="sfdt-soql-history-meta">
              <span style="color:${h.success ? '#a6e3a1' : '#f38ba8'}">${h.success ? 'OK' : 'ERR'}</span>
              <span>${h.resultCount || 0} records</span>
              <span>${h.executionTime}ms</span>
              <span>${_formatTime(h.timestamp)}</span>
            </div>
          </div>
          <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary history-load" data-index="${i}">${I.play}</button>
        </div>
      `).join('')}
    `;

    area.querySelector('#soql-clear-history')?.addEventListener('click', () => {
      QS().clearHistory();
      _renderHistory();
    });
    area.querySelectorAll('.history-load').forEach(btn => {
      btn.addEventListener('click', () => {
        _editor.value = history[parseInt(btn.dataset.index, 10)].query;
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
    QS().downloadFile(QS().recordsToCSV(_lastResults.records), 'query_results.csv', 'text/csv');
  }

  function _exportJSON() {
    if (!_lastResults?.records) return;
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

  function _toggleSize() { _panel.classList.toggle('expanded'); }

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
            console.debug('[SFDT] Full record fetch failed, using query data:', fetchErr.message);
          }
        }
      }
    } catch (err) {
      // Fallback to query keys if describe fails
      console.debug('[SFDT] Describe failed:', err.message);
      const editableKeys = _getEditableKeys(keys);
      allFields = editableKeys.map(k => ({ name: k, label: k, type: 'string', nillable: true }));
    }

    if (allFields.length === 0) {
      modal.querySelector('.sfdt-crud-body').innerHTML = '<div style="padding:16px;color:#7f849c;text-align:center">No writable fields found for this object.</div>';
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
          ${required ? '<span style="color:#f38ba8">*</span> ' : ''}${_esc(f.label || f.name)}
        </label>
        <input type="text" class="sfdt-crud-input ${required ? 'sfdt-crud-required' : ''}" 
               data-field="${_esc(f.name)}" data-type="${_esc(fieldType)}"
               value="${_esc(val)}" 
               placeholder="${_esc(f.name)}${typeHint}" />
      </div>`;
    }).join('');

    // Re-render the modal with full form
    modal.innerHTML = `
      <div class="sfdt-crud-modal">
        <div class="sfdt-crud-header">
          <span class="sfdt-crud-title">${title}</span>
          <span style="font-size:11px;color:#7f849c;margin-left:8px">${allFields.length} fields${allFields.filter(f => !f.nillable && !f.defaultedOnCreate).length > 0 ? ' · <span style="color:#f38ba8">* = required</span>' : ''}</span>
          <div style="display:flex;gap:6px;margin-left:auto">
            <input type="text" class="sfdt-crud-filter" placeholder="Filter fields..." style="padding:4px 10px;background:var(--bg);color:#cdd6f4;border:1px solid var(--border);border-radius:4px;font-size:12px;width:160px;outline:none" />
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
        msgEl.style.color = '#f9e2af';
        return;
      }

      msgEl.textContent = isNew ? 'Creating record...' : 'Saving...';
      msgEl.style.color = '#89b4fa';

      try {
        const API = window.SalesforceAPI;
        if (isNew) {
          const result = await API.restPost(_queriedSObjectType, data);
          msgEl.textContent = `Created! ID: ${result.id || result.Id || 'OK'}`;
          msgEl.style.color = '#a6e3a1';
          _statusBar.textContent = `Record created successfully`;
          setTimeout(() => { modal.remove(); _rerunLastQuery(); }, 1000);
        } else {
          const recordId = record.Id || record.id;
          if (!recordId) { msgEl.textContent = 'No Id found for update.'; msgEl.style.color = '#f38ba8'; return; }
          await API.restPatch(_queriedSObjectType, recordId, data);
          msgEl.textContent = 'Saved successfully!';
          msgEl.style.color = '#a6e3a1';
          _statusBar.textContent = `Record ${recordId} updated`;
          setTimeout(() => { modal.remove(); _rerunLastQuery(); }, 1000);
        }
      } catch (err) {
        msgEl.innerHTML = `<div style="color:#f38ba8;white-space:pre-wrap;max-height:120px;overflow-y:auto;font-size:12px"><strong>Error:</strong> ${_esc(_parseApiError(err.message))}</div>`;
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

  return { show, hide, toggle, isVisible };
})();

if (typeof window !== 'undefined') window.SFDTSOQLPanel = SOQLPanel;
