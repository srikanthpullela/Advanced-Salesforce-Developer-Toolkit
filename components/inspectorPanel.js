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
  let _pinned = false;
  let _currentRecord = null;
  let _currentDescribe = null;
  let _objectName = null;
  let _recordId = null;
  let _fieldFilter = '';
  let _sortBy = 'label';
  let _sortDir = 'asc';
  let _compareRecord = null;
  let _compareFilter = null; // null = show all, 'diff' = different only, 'same' = identical only
  let _layoutFields = new Set();    // fields currently on the page layout
  let _layoutId = null;             // Layout record Id for Tooling API
  let _layoutMetadata = null;       // full layout metadata for patching
  let _pendingLayoutAdds = new Set();    // fields to add to layout
  let _pendingLayoutRemoves = new Set(); // fields to remove from layout
  let _isSavingLayout = false;

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
            <button class="sfdt-btn sfdt-btn-sm sfdt-pin-btn" id="insp-pin" title="Pin panel open">${I.pin}</button>
            <button class="sfdt-btn sfdt-btn-sm" id="insp-toggle-size" title="Toggle Size">${I.maximize}</button>
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
    _container.querySelector('#insp-pin').addEventListener('click', _togglePin);
    _container.querySelector('#insp-json').addEventListener('click', _showJSON);
    _container.querySelector('#insp-download').addEventListener('click', _downloadJSON);
    _container.querySelector('#insp-compare').addEventListener('click', _promptCompare);
    _container.querySelector('#insp-toggle-size').addEventListener('click', () => {
      _panel.classList.toggle('expanded');
      const btn = _container.querySelector('#insp-toggle-size');
      const I = ICONS();
      btn.innerHTML = _panel.classList.contains('expanded') ? I.minimize : I.maximize;
      btn.title = _panel.classList.contains('expanded') ? 'Restore Size' : 'Expand';
    });
    _container.querySelector('#insp-filter').addEventListener('input', (e) => {
      _fieldFilter = e.target.value;
      _renderFields();
    });
    _container.querySelector('#insp-sort').addEventListener('change', (e) => {
      _sortBy = e.target.value;
      _renderFields();
    });
  }

  // ─── Layout Metadata Loading ─────────────────────────

  async function _loadLayoutMetadata() {
    if (!_objectName) return;
    _layoutFields = new Set();
    _layoutId = null;
    _layoutMetadata = null;
    _pendingLayoutAdds = new Set();
    _pendingLayoutRemoves = new Set();

    try {
      // Step 1: Query Layout Id — try by object name first, then by EntityDefinitionId
      let layoutRecord = null;

      // Try querying by object API name
      try {
        const res = await API().toolingQuery(
          `SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId = '${_objectName}' ORDER BY Name LIMIT 1`
        );
        layoutRecord = (res.records || [])[0];
      } catch (e) {
        window._sfdtLogger.debug('[SFDT] Layout query by name failed:', e.message);
      }

      // If that didn't work, try querying via EntityDefinition
      if (!layoutRecord) {
        try {
          const entityRes = await API().toolingQuery(
            `SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${_objectName}' LIMIT 1`
          );
          const entity = (entityRes.records || [])[0];
          if (entity && entity.DurableId) {
            const res2 = await API().toolingQuery(
              `SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId = '${entity.DurableId}' ORDER BY Name LIMIT 1`
            );
            layoutRecord = (res2.records || [])[0];
          }
        } catch (e) {
          window._sfdtLogger.debug('[SFDT] Layout query by EntityDefinition failed:', e.message);
        }
      }

      if (!layoutRecord) {
        window._sfdtLogger.debug('[SFDT] No layout found for', _objectName);
        return;
      }

      window._sfdtLogger.debug('[SFDT] Found layout:', layoutRecord.Name, layoutRecord.Id);

      // Step 2: GET the full Layout record with Metadata via direct REST call
      const layout = await API().toolingGet(`/sobjects/Layout/${layoutRecord.Id}`);
      if (!layout || !layout.Metadata) {
        window._sfdtLogger.debug('[SFDT] Layout GET returned no Metadata');
        return;
      }

      _layoutId = layout.Id;
      _layoutMetadata = layout.Metadata;

      // Extract all field API names from the layout sections
      const sections = _layoutMetadata.layoutSections || [];
      for (const section of sections) {
        const columns = section.layoutColumns || [];
        for (const col of columns) {
          const items = col.layoutItems || [];
          for (const item of items) {
            if (item.field) {
              _layoutFields.add(item.field);
            }
          }
        }
      }
      window._sfdtLogger.debug(`[SFDT] Layout loaded: ${layoutRecord.Name} (${_layoutFields.size} fields on layout)`);
    } catch (err) {
      window._sfdtLogger.debug('[SFDT] Layout metadata load failed:', err.message);
    }
  }

  function _toggleLayoutField(fieldName) {
    if (_layoutFields.has(fieldName)) {
      // Field is on layout — mark for removal
      if (_pendingLayoutRemoves.has(fieldName)) {
        _pendingLayoutRemoves.delete(fieldName);
      } else {
        _pendingLayoutRemoves.add(fieldName);
        _pendingLayoutAdds.delete(fieldName);
      }
    } else {
      // Field is NOT on layout — mark for addition
      if (_pendingLayoutAdds.has(fieldName)) {
        _pendingLayoutAdds.delete(fieldName);
      } else {
        _pendingLayoutAdds.add(fieldName);
        _pendingLayoutRemoves.delete(fieldName);
      }
    }
    _renderFields();
    _updateFooter();
  }

  // ─── Layout Save via SOAP Metadata API ─────

  async function _saveLayout() {
    if (!_layoutId || !_objectName) {
      window._sfdtLogger.debug('[SFDT] No layout to save');
      return;
    }
    if (_pendingLayoutAdds.size === 0 && _pendingLayoutRemoves.size === 0) return;

    console.log('%c[SFDT] _saveLayout via Metadata API', 'color:lime;font-weight:bold', { layoutId: _layoutId, objectName: _objectName, adds: [..._pendingLayoutAdds], removes: [..._pendingLayoutRemoves] });

    _isSavingLayout = true;
    _renderFields();

    try {
      // Step 1: Get the layout FullName from Tooling API (needed for Metadata API)
      console.log('[SFDT] Step 1: fetching layout FullName...');
      const layout = await API().toolingGet(`/sobjects/Layout/${_layoutId}`);
      if (!layout || !layout.FullName) throw new Error('Could not fetch layout FullName');
      const fullName = layout.FullName;
      console.log('[SFDT] Step 1 done. FullName:', fullName);

      // Step 2: Read layout via SOAP Metadata API (returns clean round-trippable XML)
      console.log('[SFDT] Step 2: reading layout via Metadata API...');
      const readXml = await API().metadataRead('Layout', fullName);
      console.log('[SFDT] Step 2 done. Response length:', readXml.length);

      // Step 3: Parse the XML and modify layoutSections
      const parser = new DOMParser();
      const doc = parser.parseFromString(readXml, 'text/xml');
      const ns = 'http://soap.sforce.com/2006/04/metadata';

      // Find all layoutItems across all sections
      const allLayoutItems = doc.querySelectorAll('layoutItems');

      // Step 3a: Remove fields
      if (_pendingLayoutRemoves.size > 0) {
        let removedCount = 0;
        allLayoutItems.forEach(item => {
          const fieldEl = item.querySelector('field');
          if (fieldEl && _pendingLayoutRemoves.has(fieldEl.textContent)) {
            console.log('[SFDT] Removing field:', fieldEl.textContent);
            item.parentNode.removeChild(item);
            removedCount++;
          }
        });
        console.log('[SFDT] Step 3a: removed', removedCount, 'fields');
      }

      // Step 3b: Add fields — add to first section's first column
      if (_pendingLayoutAdds.size > 0) {
        // Find the first layoutColumns element
        const firstCol = doc.querySelector('layoutColumns');
        if (firstCol) {
          for (const fieldName of _pendingLayoutAdds) {
            const fd = _currentDescribe ? _currentDescribe.find(f => f.name === fieldName) : null;
            const behavior = fd && (fd.calculated || fd.autoNumber || !fd.updateable) ? 'Readonly' : 'Edit';

            // Create new layoutItems element
            const itemEl = doc.createElementNS(ns, 'layoutItems');
            const behaviorEl = doc.createElementNS(ns, 'behavior');
            behaviorEl.textContent = behavior;
            const fieldEl = doc.createElementNS(ns, 'field');
            fieldEl.textContent = fieldName;
            itemEl.appendChild(behaviorEl);
            itemEl.appendChild(fieldEl);
            firstCol.appendChild(itemEl);
            console.log('[SFDT] Adding field:', fieldName, 'behavior:', behavior);
          }
        }
      }

      // Step 4: Extract the layout record XML and update via Metadata API
      console.log('[SFDT] Step 4: saving via Metadata API...');
      // Find the <records> element inside the readMetadataResponse — this is the layout metadata
      const recordsEl = doc.querySelector('records') || doc.querySelector('result records');
      if (!recordsEl) throw new Error('Could not find layout records in Metadata API response');

      // Serialize the records element content as the inner XML for updateMetadata
      // We need to re-namespace the elements for the update envelope
      const serializer = new XMLSerializer();
      let innerXml = '';
      for (const child of recordsEl.childNodes) {
        let xml = serializer.serializeToString(child);
        // Strip any existing namespace declarations from child elements
        // (they'll inherit from the envelope)
        xml = xml.replace(/ xmlns="[^"]*"/g, '');
        xml = xml.replace(/ xmlns:ns\d+="[^"]*"/g, '');
        // Convert tag names to md: namespace prefix
        xml = xml.replace(/<(\/?)([\w]+)([ >\/])/g, '<$1md:$2$3');
        innerXml += xml;
      }

      console.log('[SFDT] Step 4: sending update, XML length:', innerXml.length);
      await API().metadataUpdate(innerXml);
      console.log('[SFDT] Step 4: save successful!');

      // Success — update local state
      for (const f of _pendingLayoutAdds) _layoutFields.add(f);
      for (const f of _pendingLayoutRemoves) _layoutFields.delete(f);
      _pendingLayoutAdds.clear();
      _pendingLayoutRemoves.clear();

      _isSavingLayout = false;
      _renderFields();
      _updateFooter();
      _showLayoutToast('Layout saved! Reloading page...');

      // Refresh the page to pick up the new layout
      setTimeout(() => {
        try {
          const aura = typeof $A !== 'undefined' && $A.get && $A.get('e.force:refreshView');
          if (aura) { aura.fire(); setTimeout(() => window.location.reload(), 500); }
          else { window.location.reload(); }
        } catch (_) {
          window.location.reload();
        }
      }, 1500);
    } catch (err) {
      _isSavingLayout = false;
      _renderFields();
      _updateFooter();
      window._sfdtLogger.debug('[SFDT] Layout save error:', err);
      _showLayoutToast('Error: ' + err.message, true);
    }
  }

  // Map describe field types to layout editor type codes
  function _sfFieldTypeCode(type) {
    const map = {
      'string': 'S', 'textarea': 'J', 'boolean': 'B', 'int': 'I', 'integer': 'I',
      'double': 'N', 'currency': 'C', 'percent': 'P', 'date': 'D', 'datetime': 'T',
      'time': 'T', 'phone': 'S', 'url': 'U', 'email': 'E', 'picklist': 'L',
      'multipicklist': 'M', 'reference': 'Y', 'id': 'V', 'base64': 'S',
      'address': 'S', 'location': 'S', 'encryptedstring': 'S', 'combobox': 'L'
    };
    return map[(type || '').toLowerCase()] || 'S';
  }

  function _showLayoutToast(message, isError = false) {
    const body = _container.querySelector('#insp-body');
    if (!body) return;
    const toast = document.createElement('div');
    toast.className = 'sfdt-layout-toast';
    toast.style.cssText = `
      position:sticky;top:0;z-index:10;padding:8px 12px;font-size:12px;font-weight:500;text-align:center;
      background:${isError ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)'};
      color:${isError ? '#f87171' : '#34d399'};
      border-bottom:1px solid ${isError ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)'};
    `;
    toast.textContent = message;
    body.insertBefore(toast, body.firstChild);
    setTimeout(() => toast.remove(), 4000);
  }

  function _detectRecordFromUrl() {
    const url = window.location.href;
    const params = new URLSearchParams(window.location.search);

    // Lightning: /lightning/r/Account/001xxx/view  or  /lightning/r/Account/001xxx  or  /lightning/r/Account/001xxx#details
    const lightningMatch = url.match(/\/lightning\/r\/(\w+)\/([a-zA-Z0-9]{15,18})(?:\/|$|#|\?)/);
    if (lightningMatch) return { objectName: lightningMatch[1], recordId: lightningMatch[2] };

    // Visualforce / Classic query params: ?id=001xxx  or  ?Id=001xxx  or  ?recordId=001xxx
    // Handles URLs like: /apex/SomePage?id=a0YD4000003aawm&sfdc.override=1
    const idParam = params.get('id') || params.get('Id') || params.get('ID') ||
                    params.get('recordId') || params.get('RecordId') ||
                    params.get('recordid');
    if (idParam) {
      const cleanId = idParam.trim();
      if (/^[a-zA-Z0-9]{15,18}$/.test(cleanId)) {
        return { objectName: null, recordId: cleanId };
      }
    }

    // Classic path: /001xxx  or  /001xxx?nooverride=1  or  /001xxx#section
    // Only match if the path segment looks like a Salesforce ID (starts with a known key prefix pattern)
    const classicMatch = url.match(/\/([a-zA-Z0-9]{15,18})(?:\?|$|\/|#)/);
    if (classicMatch) {
      const candidate = classicMatch[1];
      // Avoid matching path segments like "apex", "setup", "home" etc.
      // Salesforce IDs start with a 3-char key prefix; first char is always 0-9 or a-zA-Z
      // and they contain a mix of alphanumeric chars. Filter out common false positives.
      const falsePositives = /^(apex|lightning|setup|home|servlet|one|page|classic|console|ui|aura|visualforce|secur|services|login|sfc)$/i;
      if (!falsePositives.test(candidate)) {
        return { objectName: null, recordId: candidate };
      }
    }

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

      // TODO: Re-enable when layout save is stable for all objects
      // await _loadLayoutMetadata();

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
      window._sfdtLogger.debug('[SFDT] Inspector load error:', err, 'Object:', _objectName, 'Record:', _recordId);
      body.innerHTML = `<div class="sfdt-error">Error loading ${_esc(_objectName || 'record')}: ${_esc(err.message)}</div>`;
    }
  }

  function _renderFields() {
    const body = _container.querySelector('#insp-body');
    if (!_currentDescribe || !_currentRecord) return;

    let fields = _currentDescribe.map(f => ({
      ...f,
      value: _currentRecord[f.name],
      hasValue: _currentRecord[f.name] !== null && _currentRecord[f.name] !== undefined,
      _onLayout: _layoutFields.has(f.name),
      _pendingAdd: _pendingLayoutAdds.has(f.name),
      _pendingRemove: _pendingLayoutRemoves.has(f.name)
    }));

    if (_fieldFilter) {
      const q = _fieldFilter.toLowerCase();
      fields = fields.filter(f =>
        f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q) || (f.value !== null && String(f.value).toLowerCase().includes(q))
      );
    }

    // Compare filter: show only different or identical fields
    if (_compareRecord && _compareFilter) {
      fields = fields.filter(f => {
        const isDiff = JSON.stringify(_currentRecord[f.name]) !== JSON.stringify(_compareRecord[f.name]);
        return _compareFilter === 'diff' ? isDiff : !isDiff;
      });
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

    // Compare summary banner
    let compareBanner = '';
    if (_compareRecord) {
      const compareId = _compareRecord.Id || _compareRecord.id || '?';
      const compareName = _compareRecord.Name || _compareRecord.DeveloperName || compareId;
      let diffCount = 0, sameCount = 0;
      fields.forEach(f => {
        const v1 = _currentRecord[f.name];
        const v2 = _compareRecord[f.name];
        if (JSON.stringify(v1) !== JSON.stringify(v2)) diffCount++;
        else sameCount++;
      });
      compareBanner = `
        <div class="sfdt-compare-banner">
          <div class="sfdt-compare-banner-left">
            <span style="font-weight:600;color:#58a6ff">Comparing Records</span>
            <span class="sfdt-compare-ids">
              <span class="sfdt-compare-label-a" title="Current record">A: ${_esc(String(_recordId).substring(0, 15))}</span>
              <span style="color:#383e4a">vs</span>
              <span class="sfdt-compare-label-b" title="Compare record">B: ${_esc(String(compareId).substring(0, 15))}</span>
            </span>
          </div>
          <div class="sfdt-compare-stats">
            <button class="sfdt-btn sfdt-btn-sm sfdt-compare-filter-btn sfdt-compare-btn-diff ${_compareFilter === 'diff' ? 'sfdt-filter-active-diff' : ''}" id="insp-filter-diff">${diffCount} different</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-compare-filter-btn sfdt-compare-btn-same ${_compareFilter === 'same' ? 'sfdt-filter-active-same' : ''}" id="insp-filter-same">${sameCount} identical</button>
            ${_compareFilter ? '<button class="sfdt-btn sfdt-btn-sm" id="insp-filter-all" title="Show all fields">Show All</button>' : ''}
            <button class="sfdt-btn sfdt-btn-sm sfdt-compare-clear" id="insp-clear-compare">✕ Clear</button>
          </div>
        </div>
      `;
    }

    // Layout changes info bar
    let layoutBar = '';
    const pendingCount = _pendingLayoutAdds.size + _pendingLayoutRemoves.size;
    if (_isSavingLayout) {
      layoutBar = `
        <div class="sfdt-layout-bar" style="position:sticky !important;top:0 !important;z-index:5;display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 12px !important;background:#1e2530;border-bottom:1px solid var(--border,#2d333b);font-size:11px;overflow:hidden !important">
          <div style="position:absolute !important;top:0 !important;left:0 !important;height:100% !important;width:100% !important;pointer-events:none !important;background:linear-gradient(90deg,transparent 0%,rgba(34,134,58,0.35) 40%,rgba(34,134,58,0.55) 50%,rgba(34,134,58,0.35) 60%,transparent 100%) !important;animation:sfdt-progress-sweep 1.5s ease-in-out infinite !important"></div>
          <span class="sfdt-saving-spinner" style="position:relative !important;z-index:1 !important"></span>
          <span style="color:#58a6ff;position:relative !important;z-index:1 !important">Saving layout...</span>
        </div>
      `;
    } else if (pendingCount > 0) {
      layoutBar = `
        <div class="sfdt-layout-bar" style="position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:6px 12px !important;background:#2a2318;border-bottom:1px solid var(--border,#2d333b);font-size:11px">
          <span style="color:#fbbf24">${pendingCount} layout change${pendingCount !== 1 ? 's' : ''} pending</span>
          <div style="display:flex;gap:6px">
            <button class="sfdt-btn sfdt-btn-sm" id="insp-discard-layout" style="font-size:11px;padding:2px 8px;color:#8b949e">Discard</button>
            <button class="sfdt-btn sfdt-btn-sm" id="insp-save-layout" style="font-size:11px !important;padding:3px 12px !important;color:#fff !important;font-weight:600 !important;background:#22863a !important;border:1px solid #2ea043 !important;border-radius:4px !important;cursor:pointer !important">Save Layout</button>
          </div>
        </div>
      `;
    } else if (_layoutId) {
      layoutBar = `
        <div class="sfdt-layout-bar" style="position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:6px 12px !important;background:#1a2722;border-bottom:1px solid var(--border,#2d333b);font-size:11px">
          <span style="color:#34d399">Layout loaded · ${_layoutFields.size} fields on layout</span>
          <span style="color:#8b949e;font-size:10px">Click ⊕/⊖ to add/remove fields</span>
        </div>
      `;
    } else {
      layoutBar = `
        <div class="sfdt-layout-bar" style="position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:6px 12px !important;background:#1e2024;border-bottom:1px solid var(--border,#2d333b);font-size:11px">
          <span style="color:#8b949e">Page layout not loaded</span>
          <button class="sfdt-btn sfdt-btn-sm" id="insp-retry-layout" style="font-size:11px;padding:2px 8px;color:#58a6ff">Retry</button>
        </div>
      `;
    }

    body.innerHTML = `
      ${compareBanner}
      ${layoutBar}
      <table class="sfdt-field-table">
        <thead><tr>
          <th style="width:28px;padding:0" title="Page Layout status"></th>
          <th>Label</th><th>API Name</th>
          <th>${_compareRecord ? 'Value (A — current)' : 'Value'}</th>
          <th>Type</th>
          ${_compareRecord ? '<th>Value (B — compare)</th><th>Diff</th>' : ''}
        </tr></thead>
        <tbody>
          ${fields.map(f => _renderFieldRow(f)).join('')}
        </tbody>
      </table>
    `;

    if (_compareRecord) {
      const clearBtn = body.querySelector('#insp-clear-compare');
      if (clearBtn) clearBtn.addEventListener('click', () => {
        _compareRecord = null;
        _compareFilter = null;
        _renderFields();
        _updateFooter();
      });
      const diffBtn = body.querySelector('#insp-filter-diff');
      if (diffBtn) diffBtn.addEventListener('click', () => {
        _compareFilter = _compareFilter === 'diff' ? null : 'diff';
        _renderFields();
      });
      const sameBtn = body.querySelector('#insp-filter-same');
      if (sameBtn) sameBtn.addEventListener('click', () => {
        _compareFilter = _compareFilter === 'same' ? null : 'same';
        _renderFields();
      });
      const allBtn = body.querySelector('#insp-filter-all');
      if (allBtn) allBtn.addEventListener('click', () => {
        _compareFilter = null;
        _renderFields();
      });
    }

    body.querySelectorAll('.sfdt-copyable').forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't copy if this is an editable field (edit takes priority)
        if (el.classList.contains('sfdt-inline-edit')) return;
        _copy(el.dataset.copy || el.textContent);
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 1000);
      });
    });

    body.querySelectorAll('.sfdt-inline-edit').forEach(el => {
      el.addEventListener('click', (e) => {
        _startInlineEdit(el);
      });
    });

    body.querySelectorAll('.sfdt-impact-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _showFieldImpact(btn.dataset.field, btn.dataset.label);
      });
    });

    // Layout action buttons
    const saveLayoutBtn = body.querySelector('#insp-save-layout');
    if (saveLayoutBtn) {
      saveLayoutBtn.addEventListener('click', () => _saveLayout());
    }
    const discardLayoutBtn = body.querySelector('#insp-discard-layout');
    if (discardLayoutBtn) {
      discardLayoutBtn.addEventListener('click', () => {
        _pendingLayoutAdds.clear();
        _pendingLayoutRemoves.clear();
        _renderFields();
        _updateFooter();
      });
    }
    const retryLayoutBtn = body.querySelector('#insp-retry-layout');
    if (retryLayoutBtn) {
      retryLayoutBtn.addEventListener('click', async () => {
        retryLayoutBtn.textContent = 'Loading...';
        // TODO: Re-enable when layout save is stable for all objects
        // await _loadLayoutMetadata();
        _renderFields();
        _updateFooter();
      });
    }

    // Layout toggle buttons
    body.querySelectorAll('.sfdt-layout-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _toggleLayoutField(btn.dataset.field);
      });
    });
  }

  function _renderFieldRow(field) {
    const val = field.value;
    const isRelation = field.referenceTo && field.referenceTo.length > 0;
    const typeClass = `sfdt-type-${field.type.toLowerCase()}`;
    const fieldType = (field.type || '').toLowerCase();
    const isEditable = field.updateable && !field.calculated && !field.autoNumber;

    // Render value cell content based on field type
    let valueDisplay;
    if (fieldType === 'boolean' && isEditable) {
      // Toggle switch for editable booleans
      valueDisplay = `<span class="sfdt-inline-edit sfdt-toggle-wrap" data-field="${_esc(field.name)}">
        <span class="sfdt-toggle ${val ? 'sfdt-toggle-on' : 'sfdt-toggle-off'}" title="Click to toggle">
          <span class="sfdt-toggle-track"><span class="sfdt-toggle-thumb"></span></span>
        </span>
        <span class="sfdt-toggle-label">${val ? 'true' : 'false'}</span>
      </span>`;
    } else if (val === null || val === undefined) {
      valueDisplay = `<span class="${isEditable ? 'sfdt-inline-edit' : ''} sfdt-copyable" data-field="${_esc(field.name)}"
            data-copy=""><span class="sfdt-null">null</span>${isEditable ? '<span class="sfdt-edit-hint">✎</span>' : ''}</span>`;
    } else {
      const displayVal = _esc(String(val));
      valueDisplay = `<span class="${isEditable ? 'sfdt-inline-edit' : ''} sfdt-copyable" data-field="${_esc(field.name)}"
            data-copy="${_esc(String(val))}">${displayVal}${isEditable ? '<span class="sfdt-edit-hint">✎</span>' : ''}</span>`;
    }

    // Read-only indicator for non-editable fields
    if (!isEditable && fieldType !== 'boolean') {
      const lockTitle = field.calculated ? 'Formula field' : field.autoNumber ? 'Auto-number' : 'Read-only';
      valueDisplay = `<span class="sfdt-copyable sfdt-readonly-field" data-copy="${val != null ? _esc(String(val)) : ''}" title="${lockTitle}">
        ${val === null || val === undefined ? '<span class="sfdt-null">null</span>' : _esc(String(val))}
        <span class="sfdt-lock-icon">🔒</span>
      </span>`;
    }

    let compareCells = '';
    let rowDiffClass = '';
    if (_compareRecord) {
      const compVal = _compareRecord[field.name];
      const isDiff = JSON.stringify(val) !== JSON.stringify(compVal);
      const compDisplay = compVal === null || compVal === undefined
        ? '<span class="sfdt-null">null</span>' : _esc(String(compVal));

      let diffIndicator = '<span class="sfdt-diff-same">—</span>';
      if (isDiff) {
        rowDiffClass = 'sfdt-row-diff';
        diffIndicator = '<span class="sfdt-diff-changed">Changed</span>';
      }

      compareCells = `
        <td class="sfdt-td-value ${isDiff ? 'sfdt-diff-highlight-b' : ''}">${compDisplay}</td>
        <td class="sfdt-td-diff">${diffIndicator}</td>
      `;
    }

    return `
      <tr class="sfdt-field-row ${field.custom ? 'sfdt-custom-field' : ''} ${rowDiffClass}">
        <td class="sfdt-td-layout" style="width:28px;padding:2px 4px;text-align:center">
          ${_layoutId ? _renderLayoutToggle(field) : ''}
        </td>
        <td class="sfdt-td-label">${_esc(field.label)}</td>
        <td class="sfdt-td-api">
          <span class="sfdt-copyable" data-copy="${_esc(field.name)}">${_esc(field.name)}</span>
          ${isRelation ? '<span class="sfdt-relation" title="Relationship">&#8594;</span>' : ''}
          <button class="sfdt-impact-btn" data-field="${_esc(field.name)}" data-label="${_esc(field.label)}" title="Field Impact Analysis">${ICONS().impact}</button>
        </td>
        <td class="sfdt-td-value ${_compareRecord && rowDiffClass ? 'sfdt-diff-highlight-a' : ''}">
          ${valueDisplay}
        </td>
        <td><span class="${typeClass}">${_esc(field.type)}</span></td>
        ${compareCells}
      </tr>
    `;
  }

  function _renderLayoutToggle(field) {
    const onLayout = field._onLayout;
    const pendingAdd = field._pendingAdd;
    const pendingRemove = field._pendingRemove;

    // Determine visual state
    let icon, title, color, opacity, bgColor;
    if (pendingAdd) {
      // Not on layout yet, but marked to be added
      icon = '⊕';
      title = 'Will be added to layout (click to cancel)';
      color = '#34d399';
      opacity = '1';
      bgColor = 'rgba(52,211,153,0.15)';
    } else if (pendingRemove) {
      // On layout, but marked for removal
      icon = '⊖';
      title = 'Will be removed from layout (click to cancel)';
      color = '#f87171';
      opacity = '1';
      bgColor = 'rgba(248,113,113,0.15)';
    } else if (onLayout) {
      // On layout, not modified
      icon = '✓';
      title = 'On page layout (click to remove)';
      color = '#34d399';
      opacity = '0.6';
      bgColor = 'transparent';
    } else {
      // Not on layout
      icon = '⊕';
      title = 'Not on layout (click to add)';
      color = '#8b949e';
      opacity = '0.4';
      bgColor = 'transparent';
    }

    return `<button class="sfdt-layout-toggle-btn" data-field="${_esc(field.name)}" title="${title}" style="background:${bgColor};border:none;border-radius:4px;cursor:pointer;padding:2px 4px;font-size:14px;line-height:1;opacity:${opacity};color:${color};transition:all 0.15s">${icon}</button>`;
  }

  function _startInlineEdit(el) {
    const fieldName = el.dataset.field;
    const field = _currentDescribe.find(f => f.name === fieldName);
    if (!field) return;

    // Don't allow editing non-updateable fields
    if (!field.updateable) return;

    const currentVal = _currentRecord[fieldName];
    const fieldType = (field.type || '').toLowerCase();

    // Boolean → instant toggle (no input needed)
    if (fieldType === 'boolean') {
      _saveField(el, fieldName, !currentVal);
      return;
    }

    // Picklist → dropdown select
    if (fieldType === 'picklist' && field.picklistValues && field.picklistValues.length > 0) {
      const select = document.createElement('select');
      select.className = 'sfdt-inline-input sfdt-inline-select';
      // Add blank option for nillable fields
      if (field.nillable) {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '— None —';
        select.appendChild(blank);
      }
      field.picklistValues.filter(p => p.active).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label || p.value;
        if (p.value === currentVal) opt.selected = true;
        select.appendChild(opt);
      });
      el.innerHTML = '';
      el.appendChild(select);
      select.focus();

      const save = () => _saveField(el, fieldName, select.value || null);
      select.addEventListener('change', save);
      select.addEventListener('blur', () => _renderFields());
      select.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); _renderFields(); }
      });
      return;
    }

    // Number / Currency / Percent → number input
    const isNumber = ['double', 'int', 'integer', 'currency', 'percent'].includes(fieldType);

    const input = document.createElement('input');
    input.type = isNumber ? 'number' : 'text';
    input.className = 'sfdt-inline-input';
    input.value = currentVal != null ? String(currentVal) : '';
    if (isNumber) {
      if (field.precision) input.step = field.scale ? Math.pow(10, -field.scale) : 1;
    }
    if (field.length && !isNumber) input.maxLength = field.length;
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const save = () => {
      let val = input.value;
      if (val === '') val = null;
      else if (isNumber && val !== null) val = Number(val);
      _saveField(el, fieldName, val);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); _renderFields(); }
    });
  }

  async function _saveField(el, fieldName, newValue) {
    try {
      el.innerHTML = '<span class="sfdt-saving">Saving...</span>';
      await API().restPatch(_objectName, _recordId, { [fieldName]: newValue });
      _currentRecord[fieldName] = newValue;
      _renderFields();
      // Brief success flash
      setTimeout(() => {
        const updated = _container.querySelector(`[data-field="${fieldName}"]`);
        if (updated) {
          updated.classList.add('sfdt-save-success');
          setTimeout(() => updated.classList.remove('sfdt-save-success'), 1200);
        }
      }, 50);
    } catch (err) {
      el.innerHTML = `<span class="sfdt-error">${_esc(err.message)}</span>`;
      setTimeout(() => _renderFields(), 2500);
    }
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
    // If already comparing, clear it
    if (_compareRecord) {
      _compareRecord = null;
      _compareFilter = null;
      _renderFields();
      _updateFooter();
      return;
    }
    const compareId = prompt('Enter Record ID to compare with the current record:');
    if (!compareId || compareId.length < 15) return;
    _loadCompareRecord(compareId.trim());
  }

  async function _loadCompareRecord(recordId) {
    const body = _container.querySelector('#insp-body');
    body.innerHTML = '<div class="sfdt-loading">Loading comparison record...</div>';
    try {
      _compareRecord = await API().getRecord(_objectName, recordId);
      _renderFields();
      _updateFooter();
    } catch (err) {
      _compareRecord = null;
      _renderFields();
      body.insertAdjacentHTML('afterbegin',
        `<div class="sfdt-error" style="margin:8px 0;padding:8px 12px;font-size:12px">Compare failed: ${_esc(err.message)}</div>`);
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

    let compareInfo = '';
    if (_compareRecord) {
      const compareId = _compareRecord.Id || _compareRecord.id || '?';
      compareInfo = `<span style="color:#c084fc">Comparing with ${_esc(String(compareId).substring(0, 15))}</span>`;

      // Update compare button visual
      const compareBtn = _container.querySelector('#insp-compare');
      if (compareBtn) compareBtn.classList.add('sfdt-btn-active');
    } else {
      const compareBtn = _container.querySelector('#insp-compare');
      if (compareBtn) compareBtn.classList.remove('sfdt-btn-active');
    }

    const pendingCount = _pendingLayoutAdds.size + _pendingLayoutRemoves.size;
    const layoutInfo = pendingCount > 0 ? `<span style="color:#fbbf24">Layout changes: ${pendingCount}</span>` : '';

    footer.innerHTML = `<span>Total: ${total}</span><span>Custom: ${custom}</span><span>Populated: ${populated}</span>${layoutInfo}${compareInfo}`;
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

  // ─── Field Impact Analysis ────────────────────────────

  async function _showFieldImpact(fieldApiName, fieldLabel) {
    const I = ICONS();
    const qualifiedName = `${_objectName}.${fieldApiName}`;

    // Remove any existing impact overlay before creating a new one
    const existing = _container.querySelector('.sfdt-impact-overlay');
    if (existing) existing.remove();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'sfdt-json-overlay sfdt-impact-overlay';
    overlay.innerHTML = `
      <div class="sfdt-json-dialog" style="max-width:600px;width:90%">
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px !important;background:var(--bg2,#1a1f2e);border-bottom:1px solid var(--border,#2d333b)">
          <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:#58a6ff;flex-shrink:0">${I.impact}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:#e1e4e8">Field Impact Analysis</div>
            <div style="font-size:11px;color:#8b949e;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <span style="color:#58a6ff">${_esc(fieldLabel)}</span>
              <span style="color:#383e4a;margin:0 4px">·</span>
              <span style="font-family:var(--sfdt-mono,monospace);font-size:10px">${_esc(qualifiedName)}</span>
            </div>
          </div>
          <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" style="flex-shrink:0">${I.x}</button>
        </div>
        <div class="sfdt-impact-body" style="padding:16px;max-height:60vh;overflow-y:auto">
          <div class="sfdt-loading">Scanning Apex classes, triggers, flows, validation rules, workflows...</div>
        </div>
      </div>
    `;

    _container.appendChild(overlay);
    overlay.querySelector('.sfdt-btn-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const body = overlay.querySelector('.sfdt-impact-body');

    try {
      const results = await _runFieldImpactScan(fieldApiName, qualifiedName);
      _renderImpactResults(body, results, fieldApiName, qualifiedName);
    } catch (err) {
      body.innerHTML = `<div class="sfdt-error">Error scanning: ${_esc(err.message)}</div>`;
    }
  }

  async function _runFieldImpactScan(fieldApiName, qualifiedName) {
    // Strip namespace prefix for broader matching (e.g., Apttus_Config2__FieldName__c → FieldName__c)
    const shortName = fieldApiName.replace(/^\w+__/, '');
    const useShort = shortName !== fieldApiName;

    // SOSL search term — escape special SOSL characters
    const soslEscape = (s) => s.replace(/[?&|!{}[\]()^~*:\\"'+\-]/g, '\\$&');
    const soslField = soslEscape(fieldApiName);

    // Escaped for SOQL string literals
    const escapedObjectName = _objectName.replace(/'/g, "''");

    const errors = [];

    // Run queries in parallel
    const [apexClasses, apexTriggers, validationRules, workflows] = await Promise.all([
      // Apex Classes — use SOSL (Body can't be filtered with LIKE in SOQL)
      API().toolingSearch(
        `FIND {${soslField}} IN ALL FIELDS RETURNING ApexClass(Id, Name, Body) LIMIT 50`
      ).then(r => {
        // SOSL returns array of sObject arrays
        const results = r || [];
        return Array.isArray(results) ? results.flat() : (results.searchRecords || []);
      }).catch(e => { errors.push('Apex Classes: ' + e.message); return []; }),

      // Apex Triggers — use SOSL
      API().toolingSearch(
        `FIND {${soslField}} IN ALL FIELDS RETURNING ApexTrigger(Id, Name, Body, TableEnumOrId) LIMIT 50`
      ).then(r => {
        const results = r || [];
        return Array.isArray(results) ? results.flat() : (results.searchRecords || []);
      }).catch(e => { errors.push('Apex Triggers: ' + e.message); return []; }),

      // Validation Rules — query all for this object, then filter client-side
      // (ErrorConditionFormula is not a direct queryable column — it's inside Metadata)
      API().toolingQuery(
        `SELECT Id, ValidationName, Active, Metadata FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${escapedObjectName}' LIMIT 200`
      ).then(r => {
        const rules = r.records || [];
        const fieldLower = fieldApiName.toLowerCase();
        const shortLower = shortName.toLowerCase();
        return rules.filter(v => {
          const formula = (v.Metadata && v.Metadata.errorConditionFormula) || '';
          const formulaLower = formula.toLowerCase();
          return formulaLower.includes(fieldLower) || (useShort && formulaLower.includes(shortLower));
        }).map(v => ({
          ...v,
          ErrorConditionFormula: v.Metadata ? v.Metadata.errorConditionFormula : ''
        }));
      }).catch(e => { errors.push('Validation Rules: ' + e.message); return []; }),

      // Workflow Field Updates — query all for this object, filter client-side
      // (FieldDefinition subfields can't be filtered without EntityDefinitionId)
      API().toolingQuery(
        `SELECT Id, Name, FieldDefinitionId FROM WorkflowFieldUpdate WHERE EntityDefinitionId = '${escapedObjectName}' LIMIT 200`
      ).then(r => {
        const updates = r.records || [];
        const fieldLower = fieldApiName.toLowerCase();
        const shortLower = shortName.toLowerCase();
        return updates.filter(w => {
          const fid = (w.FieldDefinitionId || w.Name || '').toLowerCase();
          return fid.includes(fieldLower) || (useShort && fid.includes(shortLower));
        });
      }).catch(e => { errors.push('Workflow Updates: ' + e.message); return []; })
    ]);

    return {
      apexClasses: _filterBodyMatches(apexClasses, fieldApiName, qualifiedName, shortName),
      apexTriggers: _filterBodyMatches(apexTriggers, fieldApiName, qualifiedName, shortName),
      validationRules,
      workflows,
      errors
    };
  }

  function _filterBodyMatches(records, fieldApiName, qualifiedName, shortName) {
    // Re-check body with case-insensitive match to filter false positives from LIKE
    const fieldLower = fieldApiName.toLowerCase();
    const shortLower = (shortName || fieldApiName).toLowerCase();
    return records.filter(r => {
      if (!r.Body) return true;
      const bodyLower = r.Body.toLowerCase();
      return bodyLower.includes(fieldLower) || bodyLower.includes(shortLower);
    }).map(r => {
      // Find matching lines
      const lines = (r.Body || '').split('\n');
      const matchingLines = [];
      const fl = fieldApiName.toLowerCase();
      const sl = shortLower;
      lines.forEach((line, i) => {
        const ll = line.toLowerCase();
        if (ll.includes(fl) || ll.includes(sl)) {
          matchingLines.push({ lineNum: i + 1, text: line.trim() });
        }
      });
      return { ...r, matchingLines: matchingLines.slice(0, 5) };
    });
  }

  function _renderImpactResults(container, results, fieldApiName, qualifiedName) {
    const I = ICONS();
    const base = API().getInstanceUrl();
    const isLightning = base.includes('lightning.force.com')
      || document.querySelector('one-app-nav-bar')
      || window.location.pathname.startsWith('/lightning');

    const totalRefs =
      results.apexClasses.length +
      results.apexTriggers.length +
      results.validationRules.length +
      results.workflows.length;

    // Show errors if any queries failed
    let errorBanner = '';
    if (results.errors && results.errors.length > 0) {
      errorBanner = `
        <div style="margin-bottom:10px;padding:6px 10px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.2);border-radius:6px;font-size:11px;color:#f85149">
          Some queries failed: ${results.errors.map(e => _esc(e)).join('; ')}
        </div>
      `;
    }

    let html = errorBanner + `
      <div style="margin-bottom:12px;padding:8px 12px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.15);border-radius:6px;font-size:12px;color:#e1e4e8;display:flex;align-items:center;gap:8px">
        <span style="width:14px;height:14px;display:inline-flex;color:#58a6ff;flex-shrink:0">${I.impact}</span>
        <span><strong style="color:#58a6ff">${totalRefs}</strong> reference${totalRefs !== 1 ? 's' : ''} found across metadata</span>
      </div>
    `;

    // Apex Classes
    if (results.apexClasses.length > 0) {
      html += _renderImpactSection('Apex Classes', I.code, results.apexClasses.map(c => {
        const url = isLightning ? `${base}/lightning/setup/ApexClasses/page?address=/${c.Id}` : `${base}/${c.Id}`;
        return {
          name: c.Name,
          url,
          lines: c.matchingLines || []
        };
      }));
    }

    // Apex Triggers
    if (results.apexTriggers.length > 0) {
      html += _renderImpactSection('Apex Triggers', I.bolt, results.apexTriggers.map(t => {
        const url = isLightning ? `${base}/lightning/setup/ApexTriggers/page?address=/${t.Id}` : `${base}/${t.Id}`;
        return {
          name: t.Name,
          url,
          lines: t.matchingLines || []
        };
      }));
    }

    // Validation Rules
    if (results.validationRules.length > 0) {
      html += _renderImpactSection('Validation Rules', I.check, results.validationRules.map(v => ({
        name: v.ValidationName,
        status: v.Active ? 'Active' : 'Inactive',
        lines: [{ text: (v.ErrorConditionFormula || '').substring(0, 120) }]
      })));
    }

    // Workflows
    if (results.workflows.length > 0) {
      html += _renderImpactSection('Workflow Field Updates', I.git, results.workflows.map(w => ({
        name: w.Name
      })));
    }

    if (totalRefs === 0 && (!results.errors || results.errors.length === 0)) {
      html = `
        <div style="text-align:center;padding:28px 16px;color:#6e7681">
          <div style="width:36px;height:36px;margin:0 auto 10px !important;color:#22c55e;opacity:0.7">${I.check}</div>
          <div style="font-size:13px;color:#22c55e;font-weight:600;margin-bottom:4px">No References Found</div>
          <div style="font-size:11px;line-height:1.5">This field is not referenced in any<br>Apex classes, triggers, or validation rules.</div>
        </div>
      `;
    } else if (totalRefs === 0 && results.errors && results.errors.length > 0) {
      // Queries failed — show errors prominently instead of hiding them
      html = errorBanner + `
        <div style="text-align:center;padding:20px 16px;color:#6e7681">
          <div style="font-size:12px;line-height:1.5">Could not complete analysis.<br>Check the errors above and try again.</div>
        </div>
      `;
    }

    // Add truncation warning if any category hit the LIMIT
    const truncated = [];
    if (results.apexClasses.length >= 50) truncated.push('Apex Classes');
    if (results.apexTriggers.length >= 50) truncated.push('Apex Triggers');
    if (results.validationRules.length >= 50) truncated.push('Validation Rules');
    if (results.workflows.length >= 50) truncated.push('Workflow Updates');
    if (truncated.length > 0) {
      html += `
        <div style="margin-top:8px;padding:6px 10px;background:rgba(210,153,34,0.1);border:1px solid rgba(210,153,34,0.2);border-radius:6px;font-size:11px;color:#d2992a">
          Results may be incomplete — ${truncated.join(', ')} hit the 50-result limit.
        </div>
      `;
    }

    container.innerHTML = html;
  }

  function _renderImpactSection(title, icon, items) {
    return `
      <div style="margin-bottom:16px">
        <div style="font-size:11px;color:#6e7681;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <span style="width:16px;height:16px;display:inline-flex">${icon}</span>
          ${title} (${items.length})
        </div>
        ${items.map(item => `
          <div style="padding:6px 12px;background:#1a1f2e;border-radius:4px;margin-bottom:4px;font-size:12px">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="color:#e1e4e8;font-weight:500">
                ${item.url ? `<a href="${item.url}" target="_blank" style="color:#58a6ff;text-decoration:none">${_esc(item.name)}</a>` : _esc(item.name)}
              </span>
              ${item.status ? `<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:${item.status === 'Active' ? '#22c55e20' : '#2d333b'};color:${item.status === 'Active' ? '#22c55e' : '#6e7681'}">${item.status}</span>` : ''}
            </div>
            ${(item.lines || []).map(l => `
              <div style="font-family:var(--sfdt-mono);font-size:10px;color:#8b949e;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${l.lineNum ? `<span style="color:#383e4a;margin-right:6px">L${l.lineNum}</span>` : ''}${_esc(l.text)}
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  function show() {
    _create();
    _panel.classList.add('visible');
    _visible = true;
    // Always re-detect from URL (Lightning SPA may have changed the URL)
    const detected = _detectRecordFromUrl();
    window._sfdtLogger.log('[SFDT] Inspector show — detected:', detected, 'URL:', window.location.href);
    if (detected) {
      _loadRecord(detected.objectName, detected.recordId);
    } else {
      const I = ICONS();
      _container.querySelector('#insp-info').innerHTML = '';
      _container.querySelector('#insp-body').innerHTML = `
        <div style="padding:24px 16px;text-align:center">
          <div style="font-size:36px;margin-bottom:12px;opacity:0.5">${I.eye}</div>
          <div style="color:#e1e4e8;font-size:14px;font-weight:600;margin-bottom:8px">No Record Detected</div>
          <div style="color:#6e7681;font-size:12px;line-height:1.6">
            Inspector works on <strong style="color:#58a6ff">record pages</strong> only.<br>
            Navigate to an Account, Contact, Case, or any object record to inspect its fields.<br><br>
            <span style="color:#fbbf24">Example URLs that work:</span><br>
            <code style="font-size:11px;color:#8b949e">/lightning/r/Account/001.../view</code><br>
            <code style="font-size:11px;color:#8b949e">/001xxx (Classic)</code><br>
            <code style="font-size:11px;color:#8b949e">/apex/SomePage?id=001xxx (Visualforce)</code><br><br>
            <span style="color:#6e7681;font-size:11px">Current URL: ${_esc(window.location.pathname + window.location.search)}</span>
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
  function isPinned() { return _pinned; }

  function _togglePin() {
    _pinned = !_pinned;
    const btn = _container.querySelector('#insp-pin');
    if (btn) {
      btn.classList.toggle('sfdt-btn-active', _pinned);
      btn.title = _pinned ? 'Unpin panel' : 'Pin panel open';
    }
  }

  return { show, hide, toggle, isVisible, isPinned };
})();

if (typeof window !== 'undefined') window.SFDTInspectorPanel = InspectorPanel;
