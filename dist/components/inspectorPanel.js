/**
 * InspectorPanel - Enhanced Salesforce Record Inspector with Shadow DOM isolation.
 */
const InspectorPanel = (() => {
  const API = () => window.SalesforceAPI;
  const META = () => window.SFDTMetadataService;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _panel = null;
  let _visible = false;
  let _currentRecord = null;
  let _currentDescribe = null;
  let _objectName = null;
  let _recordId = null;
  let _fieldFilter = '';
  let _sortBy = 'label';
  let _sortDir = 'asc';
  let _compareRecord = null;

  function _create() {
    if (_container) return;

    const { container } = SHADOW().getOrCreate('inspector');
    _container = container;
    const I = ICONS();

    _container.innerHTML = `
      <div class="sfdt-panel sfdt-panel-right" id="sfdt-insp">
        <div class="sfdt-panel-header">
          <div class="sfdt-panel-title">
            ${I.eye}
            <span>Record Inspector</span>
          </div>
          <div class="sfdt-panel-actions">
            <button class="sfdt-btn sfdt-btn-sm" id="insp-json" title="View Raw JSON">${I.json}</button>
            <button class="sfdt-btn sfdt-btn-sm" id="insp-download" title="Download">${I.download}</button>
            <button class="sfdt-btn sfdt-btn-sm" id="insp-compare" title="Compare">${I.compare}</button>
            <button class="sfdt-btn sfdt-btn-sm" id="insp-refresh" title="Refresh">${I.refresh}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="insp-close" title="Close">${I.x}</button>
          </div>
        </div>
        <div class="sfdt-panel-toolbar">
          <input type="text" class="sfdt-panel-search" id="insp-filter" placeholder="Filter fields..." autocomplete="off" />
          <select class="sfdt-panel-sort" id="insp-sort">
            <option value="label">Sort: Label</option>
            <option value="apiName">Sort: API Name</option>
            <option value="type">Sort: Type</option>
            <option value="modified">Sort: Has Value</option>
          </select>
        </div>
        <div class="sfdt-panel-info" id="insp-info"></div>
        <div class="sfdt-panel-body" id="insp-body">
          <div class="sfdt-loading">Loading record data...</div>
        </div>
        <div class="sfdt-panel-footer" id="insp-footer"></div>
      </div>
    `;

    _panel = _container.querySelector('#sfdt-insp');

    // Initialize drag-to-resize (left handle for right panel)
    SHADOW().initPanelResize(_panel, 'left', 'sfdt_inspector_width');

    _container.querySelector('#insp-close').addEventListener('click', hide);
    _container.querySelector('#insp-refresh').addEventListener('click', _refresh);
    _container.querySelector('#insp-json').addEventListener('click', _showJSON);
    _container.querySelector('#insp-download').addEventListener('click', _downloadJSON);
    _container.querySelector('#insp-compare').addEventListener('click', _promptCompare);
    _container.querySelector('#insp-filter').addEventListener('input', (e) => {
      _fieldFilter = e.target.value;
      _renderFields();
    });
    _container.querySelector('#insp-sort').addEventListener('change', (e) => {
      _sortBy = e.target.value;
      _renderFields();
    });
  }

  function _detectRecordFromUrl() {
    const url = window.location.href;
    // Lightning: /lightning/r/Account/001xxx/view  or  /lightning/r/Account/001xxx  or  /lightning/r/Account/001xxx#details
    const lightningMatch = url.match(/\/lightning\/r\/(\w+)\/([a-zA-Z0-9]{15,18})(?:\/|$|#|\?)/);
    if (lightningMatch) return { objectName: lightningMatch[1], recordId: lightningMatch[2] };
    // Classic: /001xxx  or  /001xxx?nooverride=1  or  /001xxx#section
    const classicMatch = url.match(/\/([a-zA-Z0-9]{15,18})(?:\?|$|\/|#)/);
    if (classicMatch) return { objectName: null, recordId: classicMatch[1] };
    return null;
  }

  async function _loadRecord(objectName, recordId) {
    _recordId = recordId;
    _objectName = objectName;
    const body = _container.querySelector('#insp-body');
    body.innerHTML = '<div class="sfdt-loading">Loading record data...</div>';

    try {
      if (!_objectName) {
        const keyPrefix = recordId.substring(0, 3);
        const index = META().getIndex();
        const obj = (index.objects || []).find(o => o.keyPrefix === keyPrefix);
        if (obj) _objectName = obj.name;
      }

      if (!_objectName) {
        body.innerHTML = '<div class="sfdt-error">Could not determine object type for this record.</div>';
        return;
      }

      const [describe, record] = await Promise.all([
        META().fetchCustomFields(_objectName),
        API().getRecord(_objectName, _recordId)
      ]);

      _currentDescribe = describe;
      _currentRecord = record;

      const info = _container.querySelector('#insp-info');
      const recordName = record.Name || record.DeveloperName || recordId;
      info.innerHTML = `
        <div class="sfdt-record-info">
          <span class="sfdt-object-name">${_esc(_objectName)}</span>
          <span class="sfdt-record-name">${_esc(recordName)}</span>
          <span class="sfdt-record-id sfdt-copyable" data-copy="${_esc(recordId)}">${_esc(recordId)}</span>
        </div>
      `;

      _renderFields();
      _updateFooter();
    } catch (err) {
      console.error('[SFDT] Inspector load error:', err, 'Object:', _objectName, 'Record:', _recordId);
      body.innerHTML = `<div class="sfdt-error">Error loading ${_esc(_objectName || 'record')}: ${_esc(err.message)}</div>`;
    }
  }

  function _renderFields() {
    const body = _container.querySelector('#insp-body');
    if (!_currentDescribe || !_currentRecord) return;

    let fields = _currentDescribe.map(f => ({
      ...f,
      value: _currentRecord[f.name],
      hasValue: _currentRecord[f.name] !== null && _currentRecord[f.name] !== undefined
    }));

    if (_fieldFilter) {
      const q = _fieldFilter.toLowerCase();
      fields = fields.filter(f =>
        f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q) || (f.value !== null && String(f.value).toLowerCase().includes(q))
      );
    }

    fields.sort((a, b) => {
      let cmp = 0;
      switch (_sortBy) {
        case 'label': cmp = (a.label || '').localeCompare(b.label || ''); break;
        case 'apiName': cmp = (a.name || '').localeCompare(b.name || ''); break;
        case 'type': cmp = (a.type || '').localeCompare(b.type || ''); break;
        case 'modified': cmp = (b.hasValue ? 1 : 0) - (a.hasValue ? 1 : 0); break;
      }
      return _sortDir === 'asc' ? cmp : -cmp;
    });

    if (fields.length === 0) {
      body.innerHTML = '<div class="sfdt-empty-panel">No matching fields</div>';
      return;
    }

    body.innerHTML = `
      <table class="sfdt-field-table">
        <thead><tr>
          <th>Label</th><th>API Name</th><th>Value</th><th>Type</th>
          ${_compareRecord ? '<th>Compare</th>' : ''}
        </tr></thead>
        <tbody>
          ${fields.map(f => _renderFieldRow(f)).join('')}
        </tbody>
      </table>
    `;

    body.querySelectorAll('.sfdt-copyable').forEach(el => {
      el.addEventListener('click', () => {
        _copy(el.dataset.copy || el.textContent);
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 1000);
      });
    });

    body.querySelectorAll('.sfdt-inline-edit').forEach(el => {
      el.addEventListener('dblclick', () => _startInlineEdit(el));
    });
  }

  function _renderFieldRow(field) {
    const val = field.value;
    const displayVal = val === null || val === undefined
      ? '<span class="sfdt-null">null</span>'
      : _esc(String(val));
    const isRelation = field.referenceTo && field.referenceTo.length > 0;
    const typeClass = `sfdt-type-${field.type.toLowerCase()}`;

    let compareCell = '';
    if (_compareRecord) {
      const compVal = _compareRecord[field.name];
      const isDiff = JSON.stringify(val) !== JSON.stringify(compVal);
      const compDisplay = compVal === null || compVal === undefined
        ? '<span class="sfdt-null">null</span>' : _esc(String(compVal));
      compareCell = `<td class="${isDiff ? 'sfdt-diff' : ''}">${compDisplay}</td>`;
    }

    return `
      <tr class="sfdt-field-row ${field.custom ? 'sfdt-custom-field' : ''}">
        <td class="sfdt-td-label">${_esc(field.label)}</td>
        <td class="sfdt-td-api">
          <span class="sfdt-copyable" data-copy="${_esc(field.name)}">${_esc(field.name)}</span>
          ${isRelation ? '<span class="sfdt-relation" title="Relationship">&#8594;</span>' : ''}
        </td>
        <td class="sfdt-td-value">
          <span class="sfdt-inline-edit sfdt-copyable" data-field="${_esc(field.name)}"
                data-copy="${val != null ? _esc(String(val)) : ''}">${displayVal}</span>
        </td>
        <td><span class="${typeClass}">${_esc(field.type)}</span></td>
        ${compareCell}
      </tr>
    `;
  }

  function _startInlineEdit(el) {
    const fieldName = el.dataset.field;
    const field = _currentDescribe.find(f => f.name === fieldName);
    if (!field) return;

    const currentVal = _currentRecord[fieldName];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sfdt-inline-input';
    input.value = currentVal != null ? String(currentVal) : '';
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
      try {
        await API().restPatch(_objectName, _recordId, { [fieldName]: input.value || null });
        _currentRecord[fieldName] = input.value || null;
        _renderFields();
      } catch (err) {
        el.innerHTML = `<span class="sfdt-error">${_esc(err.message)}</span>`;
        setTimeout(() => _renderFields(), 2000);
      }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); _renderFields(); }
    });
  }

  function _showJSON() {
    if (!_currentRecord) return;
    const cleaned = { ..._currentRecord };
    delete cleaned.attributes;
    const I = ICONS();

    const overlay = document.createElement('div');
    overlay.className = 'sfdt-json-overlay';
    overlay.innerHTML = `
      <div class="sfdt-json-dialog">
        <div class="sfdt-json-header">
          <span>Raw JSON - ${_esc(_objectName)}</span>
          <button class="sfdt-btn sfdt-btn-sm">${I.copy} Copy</button>
          <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close">${I.x}</button>
        </div>
        <pre class="sfdt-json-body">${_esc(JSON.stringify(cleaned, null, 2))}</pre>
      </div>
    `;

    _container.appendChild(overlay);
    overlay.querySelectorAll('.sfdt-btn')[0].addEventListener('click', () => {
      _copy(JSON.stringify(cleaned, null, 2));
    });
    overlay.querySelectorAll('.sfdt-btn-close')[0].addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function _downloadJSON() {
    if (!_currentRecord) return;
    const cleaned = { ..._currentRecord };
    delete cleaned.attributes;
    const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${_objectName}_${_recordId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _promptCompare() {
    const compareId = prompt('Enter Record ID to compare:');
    if (!compareId || compareId.length < 15) return;
    _loadCompareRecord(compareId);
  }

  async function _loadCompareRecord(recordId) {
    try {
      _compareRecord = await API().getRecord(_objectName, recordId);
      _renderFields();
    } catch (err) {
      alert(`Could not load record: ${err.message}`);
    }
  }

  function _updateFooter() {
    const footer = _container.querySelector('#insp-footer');
    const total = _currentDescribe ? _currentDescribe.length : 0;
    const custom = _currentDescribe ? _currentDescribe.filter(f => f.custom).length : 0;
    const populated = _currentDescribe ? _currentDescribe.filter(f => {
      const v = _currentRecord[f.name];
      return v !== null && v !== undefined;
    }).length : 0;
    footer.innerHTML = `<span>Total: ${total}</span><span>Custom: ${custom}</span><span>Populated: ${populated}</span>`;
  }

  async function _refresh() {
    if (_objectName && _recordId) await _loadRecord(_objectName, _recordId);
  }

  function _copy(text) {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
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
    // Always re-detect from URL (Lightning SPA may have changed the URL)
    const detected = _detectRecordFromUrl();
    console.log('[SFDT] Inspector show — detected:', detected, 'URL:', window.location.href);
    if (detected) {
      _loadRecord(detected.objectName, detected.recordId);
    } else {
      const I = ICONS();
      _container.querySelector('#insp-info').innerHTML = '';
      _container.querySelector('#insp-body').innerHTML = `
        <div style="padding:24px 16px;text-align:center">
          <div style="font-size:36px;margin-bottom:12px;opacity:0.5">${I.eye}</div>
          <div style="color:#cdd6f4;font-size:14px;font-weight:600;margin-bottom:8px">No Record Detected</div>
          <div style="color:#7f849c;font-size:12px;line-height:1.6">
            Inspector works on <strong style="color:#89b4fa">record pages</strong> only.<br>
            Navigate to an Account, Contact, Case, or any object record to inspect its fields.<br><br>
            <span style="color:#f9e2af">Example URLs that work:</span><br>
            <code style="font-size:11px;color:#a6adc8">/lightning/r/Account/001.../view</code><br>
            <code style="font-size:11px;color:#a6adc8">/lightning/r/Contact/003.../view</code><br><br>
            <span style="color:#7f849c;font-size:11px">Current URL: ${_esc(window.location.pathname)}</span>
          </div>
        </div>`;
      _container.querySelector('#insp-footer').innerHTML = '';
    }
  }

  function hide() {
    if (_panel) _panel.classList.remove('visible');
    _visible = false;
    _compareRecord = null;
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }

  return { show, hide, toggle, isVisible };
})();

if (typeof window !== 'undefined') window.SFDTInspectorPanel = InspectorPanel;
