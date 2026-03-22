/**
 * DataBuilderPanel - CPQ-aware hierarchical record builder.
 *
 * Visual tree with connector lines showing parent-child relationships:
 *   Bundle -> Option Group -> Options -> Sub-options -> Attributes
 *
 * Auto-wires parent IDs at execution time.
 */
const DataBuilderPanel = (() => {
  const API = () => window.SalesforceAPI;
  const NS = 'Apttus_Config2__';

  const NODE_TYPES = {
    bundle: {
      label: 'Bundle', icon: '\uD83D\uDCE6', object: 'Product2',
      defaults: { Name: '', IsActive: 'true', [`${NS}ConfigurationType__c`]: 'Bundle' },
      allowedChildren: ['option_group', 'option', 'attribute', 'pricebook_entry'],
      description: 'Product bundle - top-level configurable product',
      color: '#89b4fa'
    },
    option_group: {
      label: 'Option Group', icon: '\uD83D\uDCC2', object: `${NS}ProductOptionGroup__c`,
      defaults: { [`${NS}Sequence__c`]: '1' },
      parentField: `${NS}ProductId__c`,
      allowedChildren: ['option'],
      description: 'Groups options under a bundle',
      color: '#cba6f7',
      canUseExisting: true
    },
    option: {
      label: 'Option', icon: '\u2699\uFE0F', object: 'Product2',
      defaults: { Name: '', IsActive: 'true', [`${NS}ConfigurationType__c`]: 'Option' },
      linkObject: `${NS}ProductOptionComponent__c`,
      linkDefaults: { [`${NS}Sequence__c`]: '10', [`${NS}Default__c`]: 'true', [`${NS}DefaultQuantity__c`]: '1' },
      linkParentField: `${NS}ParentProductId__c`,
      linkChildField: `${NS}ComponentProductId__c`,
      linkGroupField: `${NS}ProductOptionGroupId__c`,
      allowedChildren: ['option', 'attribute', 'pricebook_entry'],
      description: 'Option product linked to parent',
      color: '#a6e3a1'
    },
    attribute: {
      label: 'Attribute', icon: '\uD83C\uDFF7\uFE0F', object: `${NS}ProductAttributeValue__c`,
      defaults: {},
      parentField: `${NS}ProductId__c`,
      allowedChildren: [],
      description: 'Attribute value on a product',
      color: '#f9e2af'
    },
    pricebook_entry: {
      label: 'Price', icon: '\uD83D\uDCB2', object: 'PricebookEntry',
      defaults: { IsActive: 'true', UseStandardPrice: 'false', UnitPrice: '0' },
      parentField: 'Product2Id',
      allowedChildren: [],
      description: 'Pricebook entry for a product',
      color: '#94e2d5'
    },
    constraint_rule: {
      label: 'Constraint Rule', icon: '\uD83D\uDEE1\uFE0F', object: `${NS}ProductConstraintRule__c`,
      defaults: { [`${NS}Active__c`]: 'true' },
      allowedChildren: ['constraint_rule_entry'],
      description: 'Product constraint rule',
      color: '#f38ba8'
    },
    constraint_rule_entry: {
      label: 'Rule Entry', icon: '\u2192', object: `${NS}ProductConstraintRuleEntry__c`,
      defaults: {},
      parentField: `${NS}ConstraintRuleId__c`,
      allowedChildren: [],
      description: 'Constraint rule entry',
      color: '#fab387'
    },
    custom: {
      label: 'Custom', icon: '\u2726', object: '',
      defaults: {},
      allowedChildren: ['custom'],
      description: 'Any sObject',
      color: '#7f849c'
    }
  };

  let _tree = [];
  let _results = {};
  let _describeCache = {};
  let _running = false;
  let _container = null;
  let _nodeSeq = 1;
  let _existingGroupsCache = null;

  // ═══════════════════════════════════════════════════════
  //  Tree model
  // ═══════════════════════════════════════════════════════

  function _newNode(type, parentId) {
    var def = NODE_TYPES[type];
    if (!def) return null;
    return {
      id: 'n' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      seq: _nodeSeq++, type: type, label: def.label, object: def.object,
      fields: Object.assign({}, def.defaults),
      children: [], expanded: false, parentId: parentId || null, describe: null,
      linkFields: def.linkDefaults ? Object.assign({}, def.linkDefaults) : null,
      useExistingId: null // for linking to an existing SF record instead of creating
    };
  }

  function _findNode(id, nodes) {
    if (!nodes) nodes = _tree;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i];
      var f = _findNode(id, nodes[i].children);
      if (f) return f;
    }
    return null;
  }

  function _findParent(id, nodes, parent) {
    if (!nodes) nodes = _tree;
    if (!parent) parent = null;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return parent;
      var f = _findParent(id, nodes[i].children, nodes[i]);
      if (f !== undefined) return f;
    }
    return undefined;
  }

  function _flattenTree(nodes) {
    if (!nodes) nodes = _tree;
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      out.push(nodes[i]);
      var k = _flattenTree(nodes[i].children);
      for (var j = 0; j < k.length; j++) out.push(k[j]);
    }
    return out;
  }

  function addNode(type, parentId) {
    var parent = parentId ? _findNode(parentId) : null;
    if (parent) {
      var pd = NODE_TYPES[parent.type];
      if (pd && pd.allowedChildren.indexOf(type) === -1) return null;
    }
    var node = _newNode(type, parentId || null);
    if (!node) return null;
    if (parent) { parent.children.push(node); parent.expanded = true; }
    else _tree.push(node);
    return node;
  }

  function removeNode(id) {
    var p = _findParent(id);
    var list = p ? p.children : _tree;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { list.splice(i, 1); break; } }
    delete _results[id];
  }

  function moveNode(id, dir) {
    var p = _findParent(id);
    var list = p ? p.children : _tree;
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { idx = i; break; } }
    var to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return;
    var tmp = list[idx]; list[idx] = list[to]; list[to] = tmp;
  }

  // ─── Describe / Existing records ──────────────────────

  async function _getDescribe(objectName) {
    if (!objectName) return null;
    if (_describeCache[objectName]) return _describeCache[objectName];
    try {
      var desc = await API().describeSObject(objectName);
      var fields = (desc.fields || [])
        .filter(function(f) { return f.createable; })
        .sort(function(a, b) {
          if (a.nillable === b.nillable) return a.label.localeCompare(b.label);
          return a.nillable ? 1 : -1;
        });
      _describeCache[objectName] = fields;
      return fields;
    } catch (e) {
      console.warn('[SFDT] Describe failed for', objectName, e.message);
      return null;
    }
  }

  async function _fetchExistingOptionGroups() {
    if (_existingGroupsCache) return _existingGroupsCache;
    try {
      var r = await API().restQuery(
        'SELECT Id, Name, ' + NS + 'Label__c, ' + NS + 'ProductId__r.Name FROM ' + NS + 'ProductOptionGroup__c ORDER BY Name LIMIT 200'
      );
      _existingGroupsCache = (r.records || []).map(function(rec) {
        return {
          id: rec.Id,
          name: rec.Name,
          label: rec[NS + 'Label__c'] || rec.Name,
          product: rec[NS + 'ProductId__r'] ? rec[NS + 'ProductId__r'].Name : ''
        };
      });
      return _existingGroupsCache;
    } catch (e) {
      console.warn('[SFDT] Could not fetch option groups', e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════
  //  Execution Engine
  // ═══════════════════════════════════════════════════════

  async function executeAll(container) {
    if (_running) return;
    _running = true;
    _results = {};
    var flat = _flattenTree();
    var idMap = {};

    for (var i = 0; i < flat.length; i++) {
      var node = flat[i];

      // If using an existing record, skip creation
      if (node.useExistingId) {
        idMap[node.id] = node.useExistingId;
        _results[node.id] = { success: true, recordId: node.useExistingId, existing: true };
        _updateNodeStatus(container, node.id, 'success');
        continue;
      }

      if (!node.object) {
        _results[node.id] = { success: false, error: 'No object specified' };
        _reRender(container);
        continue;
      }

      var data = await _resolveFields(node.fields, node.object, idMap);
      var parentNode = node.parentId ? _findNode(node.parentId) : null;
      var def = NODE_TYPES[node.type];

      if (def && def.parentField && parentNode && idMap[parentNode.id]) {
        data[def.parentField] = idMap[parentNode.id];
      }

      _updateNodeStatus(container, node.id, 'running');

      try {
        var res = await API().restPost(node.object, data);
        var recId = res.id || res.Id;
        idMap[node.id] = recId;
        _results[node.id] = { success: true, recordId: recId };
        _updateNodeStatus(container, node.id, 'success', recId);
      } catch (err) {
        _results[node.id] = { success: false, error: _parseError(err.message) };
        _updateNodeStatus(container, node.id, 'error');
        continue;
      }

      // Link record (ProductOptionComponent for options)
      if (def && def.linkObject && node.linkFields && parentNode) {
        var linkData = await _resolveFields(node.linkFields, def.linkObject, idMap);
        if (def.linkParentField) {
          var pp = _findNearestProductAncestor(parentNode);
          if (pp && idMap[pp.id]) linkData[def.linkParentField] = idMap[pp.id];
        }
        if (def.linkChildField && idMap[node.id]) linkData[def.linkChildField] = idMap[node.id];
        if (def.linkGroupField && parentNode.type === 'option_group' && idMap[parentNode.id]) {
          linkData[def.linkGroupField] = idMap[parentNode.id];
        }
        try {
          var lr = await API().restPost(def.linkObject, linkData);
          _results[node.id].linkRecordId = lr.id || lr.Id;
        } catch (le) {
          _results[node.id].linkError = _parseError(le.message);
        }
      }
    }
    _running = false;
    _reRender(container);
  }

  function _findNearestProductAncestor(node) {
    if (!node) return null;
    if (node.object === 'Product2') return node;
    var p = node.parentId ? _findNode(node.parentId) : null;
    return _findNearestProductAncestor(p);
  }

  async function _resolveFields(fields, objectName, idMap) {
    var data = {};
    var keys = Object.keys(fields);
    for (var k = 0; k < keys.length; k++) {
      var field = keys[k], rawVal = fields[field];
      if (rawVal === '' || rawVal === null || rawVal === undefined) continue;
      var val = String(rawVal);
      val = val.replace(/\{\{Step(\d+)\.Id\}\}/g, function(match, stepNum) {
        var num = parseInt(stepNum, 10);
        var flat = _flattenTree();
        for (var j = 0; j < flat.length; j++) { if (flat[j].seq === num && idMap[flat[j].id]) return idMap[flat[j].id]; }
        return match;
      });
      var desc = _describeCache[objectName] || await _getDescribe(objectName);
      var meta = null;
      if (desc) { for (var m = 0; m < desc.length; m++) { if (desc[m].name === field) { meta = desc[m]; break; } } }
      var fType = meta ? meta.type : 'string';
      if (fType === 'boolean') data[field] = val.toLowerCase() === 'true';
      else if (['double', 'currency', 'percent', 'int', 'long'].indexOf(fType) !== -1) data[field] = Number(val);
      else if (val === 'null') data[field] = null;
      else data[field] = val;
    }
    return data;
  }

  function _parseError(msg) {
    try { var m = msg.match(/\[(\{.*\})\]/); if (m) { var e = JSON.parse(m[1]); return e.message || msg; } } catch (x) {}
    return msg.length > 150 ? msg.substring(0, 147) + '...' : msg;
  }

  // ─── Recipes ──────────────────────────────────────────

  function _serializeTree(nodes) {
    if (!nodes) nodes = _tree;
    return nodes.map(function(n) {
      return { type: n.type, label: n.label, object: n.object,
        fields: Object.assign({}, n.fields),
        linkFields: n.linkFields ? Object.assign({}, n.linkFields) : null,
        useExistingId: n.useExistingId,
        children: _serializeTree(n.children) };
    });
  }
  function _deserializeTree(nodes, parentId) {
    if (!parentId) parentId = null;
    return nodes.map(function(n) {
      var node = _newNode(n.type, parentId);
      node.label = n.label; node.object = n.object;
      node.fields = Object.assign({}, n.fields);
      node.linkFields = n.linkFields ? Object.assign({}, n.linkFields) : null;
      node.useExistingId = n.useExistingId || null;
      node.children = _deserializeTree(n.children || [], node.id);
      return node;
    });
  }
  function saveRecipe(name) {
    var r = _getRecipes();
    r[name] = { name: name, savedAt: new Date().toISOString(), tree: _serializeTree() };
    localStorage.setItem('sfdt_databuilder_recipes', JSON.stringify(r));
  }
  function loadRecipe(name) {
    var r = _getRecipes()[name];
    if (!r) return false;
    _nodeSeq = 1; _tree = _deserializeTree(r.tree || []); _results = {};
    return true;
  }
  function deleteRecipe(name) {
    var r = _getRecipes(); delete r[name];
    localStorage.setItem('sfdt_databuilder_recipes', JSON.stringify(r));
  }
  function _getRecipes() {
    try { return JSON.parse(localStorage.getItem('sfdt_databuilder_recipes') || '{}'); } catch (e) { return {}; }
  }
  function getRecipeNames() { return Object.keys(_getRecipes()); }

  // ═══════════════════════════════════════════════════════
  //  UI Rendering
  // ═══════════════════════════════════════════════════════

  function render(container) { _container = container; _reRender(container); }

  function _reRender(container) {
    if (!container) return;
    var rn = getRecipeNames();
    var hasNodes = _tree.length > 0;
    var flat = _flattenTree();

    var h = '<div class="sfdt-db">';

    // Toolbar
    h += '<div class="sfdt-db-toolbar">';
    h += '<div class="sfdt-db-tl-left">';
    h += '<span class="sfdt-db-tl-title">CPQ Data Builder</span>';
    if (hasNodes) h += '<span class="sfdt-db-tl-badge">' + flat.length + '</span>';
    h += '</div><div class="sfdt-db-tl-right">';
    h += '<select class="sfdt-db-recipe-sel" id="db-recipe-select"><option value="">Recipes' + (rn.length ? ' (' + rn.length + ')' : '') + '</option>';
    for (var ri = 0; ri < rn.length; ri++) h += '<option value="' + _esc(rn[ri]) + '">' + _esc(rn[ri]) + '</option>';
    h += '</select>';
    h += '<button class="sfdt-db-tbtn" id="db-save-recipe">Save</button>';
    h += '<button class="sfdt-db-tbtn sfdt-db-tbtn-dim" id="db-delete-recipe">Del</button>';
    h += '<span class="sfdt-db-tl-sep"></span>';
    h += '<button class="sfdt-db-tbtn sfdt-db-tbtn-dim" id="db-clear"' + (!hasNodes ? ' disabled' : '') + '>Clear</button>';
    h += '<button class="sfdt-db-go-btn" id="db-execute"' + (!hasNodes ? ' disabled' : '') + '>';
    h += '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5l9 5.5-9 5.5z"/></svg> Execute All</button>';
    h += '</div></div>';

    // Body
    h += '<div class="sfdt-db-body" id="db-body">';

    if (!hasNodes) {
      h += _renderEmpty();
    } else {
      // Tree
      h += '<div class="sfdt-db-tree">';
      for (var ti = 0; ti < _tree.length; ti++) {
        h += _renderNode(_tree[ti], 0, ti === _tree.length - 1);
      }
      h += '</div>';
    }

    // Add root cards
    h += '<div class="sfdt-db-root-cards">';
    h += '<div class="sfdt-db-root-label">Add New</div>';
    h += '<div class="sfdt-db-root-grid">';
    var rootTypes = ['bundle', 'constraint_rule', 'custom'];
    for (var rt = 0; rt < rootTypes.length; rt++) {
      var rd = NODE_TYPES[rootTypes[rt]];
      h += '<button class="sfdt-db-root-btn sfdt-db-add-root" data-type="' + rootTypes[rt] + '">'
        + '<span class="sfdt-db-root-btn-icon" style="color:' + rd.color + '">' + rd.icon + '</span>'
        + '<span class="sfdt-db-root-btn-name">' + rd.label + '</span>'
        + '<span class="sfdt-db-root-btn-desc">' + _esc(rd.description) + '</span>'
        + '</button>';
    }
    h += '</div></div>';

    h += '</div>'; // body
    h += '</div>'; // sfdt-db

    container.innerHTML = h;
    _attachListeners(container);
  }

  function _renderEmpty() {
    return '<div class="sfdt-db-empty">'
      + '<div class="sfdt-db-empty-ico">'
      + '<svg width="48" height="48" viewBox="0 0 48 48" fill="none">'
      + '<rect x="4" y="4" width="16" height="12" rx="3" stroke="#585b70" stroke-width="1.4"/>'
      + '<rect x="28" y="4" width="16" height="12" rx="3" stroke="#585b70" stroke-width="1.4"/>'
      + '<rect x="16" y="32" width="16" height="12" rx="3" stroke="#585b70" stroke-width="1.4"/>'
      + '<path d="M12 16v6h12m12-6v6h-12m0 0v10" stroke="#585b70" stroke-width="1.2" stroke-linecap="round"/>'
      + '</svg></div>'
      + '<div class="sfdt-db-empty-h">Build a CPQ product hierarchy</div>'
      + '<div class="sfdt-db-empty-p">Start with a Bundle below, then add Option Groups, Options, Attributes and Prices as children.</div>'
      + '<div class="sfdt-db-empty-tip">Parent-child links are <b>auto-wired</b> at execution time.</div>'
      + '</div>';
  }

  // ─── Tree node with connector lines ────────────────────

  function _renderNode(node, depth, isLast) {
    var def = NODE_TYPES[node.type] || NODE_TYPES.custom;
    var res = _results[node.id];
    var st = res ? (res.success ? 'ok' : 'fail') : '';
    var flds = Object.entries(node.fields);
    var hasKids = node.children.length > 0;
    var nameVal = node.fields.Name || '';
    var allowed = def.allowedChildren || [];
    var isExisting = !!node.useExistingId;

    // Preview when collapsed
    var preview = '';
    if (!node.expanded && flds.length > 0) {
      var bits = [];
      var pc = Math.min(3, flds.length);
      for (var pi = 0; pi < pc; pi++) {
        var pk = flds[pi][0], pv = flds[pi][1];
        var pm = null;
        if (node.describe) { for (var di = 0; di < node.describe.length; di++) { if (node.describe[di].name === pk) { pm = node.describe[di]; break; } } }
        bits.push('<span class="sfdt-db-pv-item"><span class="sfdt-db-pv-k">' + _esc(pm ? pm.label : pk) + '</span> ' + _esc(pv || '\u2014') + '</span>');
      }
      if (flds.length > 3) bits.push('<span class="sfdt-db-pv-more">+' + (flds.length - 3) + ' more</span>');
      preview = '<div class="sfdt-db-pv">' + bits.join('') + '</div>';
    }

    // Wrapper with tree-line structure
    var h = '<div class="sfdt-db-tree-row' + (isLast ? ' sfdt-db-tree-last' : '') + '" data-depth="' + depth + '">';

    // Tree connector lines
    if (depth > 0) {
      h += '<div class="sfdt-db-tree-indent">';
      for (var d = 0; d < depth - 1; d++) {
        h += '<span class="sfdt-db-tree-pipe"></span>';
      }
      h += '<span class="sfdt-db-tree-branch' + (isLast ? ' sfdt-db-tree-elbow' : '') + '"></span>';
      h += '</div>';
    }

    // The node card
    h += '<div class="sfdt-db-node ' + st + (isExisting ? ' sfdt-db-node-existing' : '') + '" data-id="' + node.id + '">';

    // Header
    h += '<div class="sfdt-db-node-hd" data-id="' + node.id + '">';

    // Expand/collapse arrow
    if (hasKids || allowed.length > 0 || flds.length > 0) {
      h += '<button class="sfdt-db-node-arrow sfdt-db-toggle" data-id="' + node.id + '">' + (node.expanded ? '\u25BE' : '\u25B8') + '</button>';
    } else {
      h += '<span class="sfdt-db-node-arrow-ph"></span>';
    }

    // Color dot + icon
    h += '<span class="sfdt-db-node-dot" style="background:' + def.color + '"></span>';
    h += '<span class="sfdt-db-node-icon">' + def.icon + '</span>';
    h += '<span class="sfdt-db-node-seq">#' + node.seq + '</span>';
    h += '<span class="sfdt-db-node-name">' + _esc(nameVal || def.label) + '</span>';

    if (isExisting) {
      h += '<span class="sfdt-db-node-existing-tag">existing</span>';
    }

    // Status
    if (res && res.recordId) h += '<span class="sfdt-db-node-ok" title="' + res.recordId + '">\u2713</span>';
    if (res && res.linkRecordId) h += '<span class="sfdt-db-node-link" title="Link: ' + res.linkRecordId + '">\u2194</span>';
    if (res && res.error) h += '<span class="sfdt-db-node-err" title="' + _esc(res.error) + '">!</span>';

    // Tools
    h += '<span class="sfdt-db-node-tools">';
    if (allowed.length > 0) {
      h += '<span class="sfdt-db-add-child-wrap">';
      h += '<button class="sfdt-db-node-tb sfdt-db-add-child-trigger" data-id="' + node.id + '" title="Add child">+</button>';
      h += '<span class="sfdt-db-add-child-menu" data-parent="' + node.id + '">';
      for (var ci = 0; ci < allowed.length; ci++) {
        var cd = NODE_TYPES[allowed[ci]];
        h += '<button class="sfdt-db-add-child-btn" data-parent="' + node.id + '" data-type="' + allowed[ci] + '">'
          + '<span class="sfdt-db-acb-dot" style="background:' + cd.color + '"></span>' + cd.icon + ' ' + cd.label + '</button>';
      }
      // "Use Existing" option for nodes that support it
      for (var ui = 0; ui < allowed.length; ui++) {
        if (NODE_TYPES[allowed[ui]].canUseExisting) {
          h += '<button class="sfdt-db-add-child-btn sfdt-db-use-existing-btn" data-parent="' + node.id + '" data-type="' + allowed[ui] + '">'
            + '<span class="sfdt-db-acb-dot" style="background:#585b70"></span>\uD83D\uDD0D Use Existing ' + NODE_TYPES[allowed[ui]].label + '</button>';
        }
      }
      h += '</span></span>';
    }
    h += '<button class="sfdt-db-node-tb sfdt-db-move-node" data-id="' + node.id + '" data-dir="-1" title="Move up">\u25B2</button>';
    h += '<button class="sfdt-db-node-tb sfdt-db-move-node" data-id="' + node.id + '" data-dir="1" title="Move down">\u25BC</button>';
    h += '<button class="sfdt-db-node-tb sfdt-db-node-rm sfdt-db-remove-node" data-id="' + node.id + '" title="Remove">\u2715</button>';
    h += '</span>';
    h += '</div>'; // hd end

    // Preview when collapsed
    if (!node.expanded) h += preview;

    // Results
    if (res && res.recordId) {
      h += '<div class="sfdt-db-node-res-ok">\u2713 ' + (res.existing ? 'Linked existing ' : 'Created ') + res.recordId;
      if (res.linkRecordId) h += '  \u2194 Link ' + res.linkRecordId;
      h += '</div>';
    }
    if (res && res.error) h += '<div class="sfdt-db-node-res-fail">' + _esc(res.error) + '</div>';
    if (res && res.linkError) h += '<div class="sfdt-db-node-res-fail">Link error: ' + _esc(res.linkError) + '</div>';

    // Body (expanded)
    if (node.expanded && !isExisting) {
      h += _renderNodeBody(node);
    }

    h += '</div>'; // node end

    h += '</div>'; // tree-row end

    // Children (rendered as sibling tree-rows, not nested inside the card)
    if (node.expanded && hasKids) {
      for (var ki = 0; ki < node.children.length; ki++) {
        h += _renderNode(node.children[ki], depth + 1, ki === node.children.length - 1);
      }
    }

    // Inline add hint when expanded but no children
    if (node.expanded && allowed.length > 0 && !hasKids) {
      h += '<div class="sfdt-db-tree-row" data-depth="' + (depth + 1) + '">';
      if (depth + 1 > 0) {
        h += '<div class="sfdt-db-tree-indent">';
        for (var ai = 0; ai < depth; ai++) h += '<span class="sfdt-db-tree-pipe"></span>';
        h += '<span class="sfdt-db-tree-branch sfdt-db-tree-elbow"></span>';
        h += '</div>';
      }
      h += '<div class="sfdt-db-child-hint">';
      for (var bi = 0; bi < allowed.length; bi++) {
        var bd = NODE_TYPES[allowed[bi]];
        h += '<button class="sfdt-db-pill sfdt-db-add-child-btn" data-parent="' + node.id + '" data-type="' + allowed[bi] + '">'
          + bd.icon + ' ' + bd.label + '</button>';
      }
      h += '</div></div>';
    }

    return h;
  }

  function _renderNodeBody(node) {
    var flds = Object.entries(node.fields);
    var def = NODE_TYPES[node.type] || NODE_TYPES.custom;
    var h = '<div class="sfdt-db-node-bd">';

    // Object row
    if (node.type === 'custom') {
      h += '<div class="sfdt-db-row">'
        + '<label class="sfdt-db-lbl">Object</label>'
        + '<input type="text" class="sfdt-db-inp sfdt-db-obj-input" data-id="' + node.id + '" value="' + _esc(node.object) + '" placeholder="e.g. Product2" spellcheck="false"/>'
        + '<button class="sfdt-db-loadbtn sfdt-db-load-fields" data-id="' + node.id + '">Load Fields</button>'
        + '</div>';
    } else {
      h += '<div class="sfdt-db-row">'
        + '<label class="sfdt-db-lbl">Object</label>'
        + '<span class="sfdt-db-obj-ro">' + _esc(node.object) + '</span>'
        + '<button class="sfdt-db-loadbtn sfdt-db-load-fields" data-id="' + node.id + '">Load Fields</button>'
        + '</div>';
    }

    // Fields
    if (flds.length > 0) {
      for (var fi = 0; fi < flds.length; fi++) {
        var field = flds[fi][0], value = flds[fi][1];
        var meta = null;
        if (node.describe) { for (var di = 0; di < node.describe.length; di++) { if (node.describe[di].name === field) { meta = node.describe[di]; break; } } }
        var label = meta ? meta.label : field;
        var type = meta ? meta.type : '';
        var req = meta ? !meta.nillable : false;
        var isRef = String(value).indexOf('{{Step') !== -1;
        h += '<div class="sfdt-db-row sfdt-db-frow ' + (isRef ? 'sfdt-db-frow-ref' : '') + '">'
          + '<label class="sfdt-db-lbl ' + (req ? 'sfdt-db-lbl-req' : '') + '" title="' + _esc(field) + (type ? ' (' + type + ')' : '') + '">' + _esc(label) + '</label>'
          + '<input type="text" class="sfdt-db-inp sfdt-db-field-value ' + (isRef ? 'sfdt-db-inp-ref' : '') + '" data-nid="' + node.id + '" data-field="' + _esc(field) + '"'
          + ' value="' + _esc(String(value)) + '" placeholder="' + (type || 'value') + '" spellcheck="false"/>'
          + '<button class="sfdt-db-xbtn sfdt-db-field-del" data-nid="' + node.id + '" data-field="' + _esc(field) + '" title="Remove">\u2715</button>'
          + '</div>';
      }
    } else {
      h += '<div class="sfdt-db-nofields">No fields yet \u2014 click <b>Load Fields</b> or pick from dropdown</div>';
    }

    // Link record section
    if (node.linkFields && Object.keys(node.linkFields).length > 0) {
      h += '<div class="sfdt-db-link-section">';
      h += '<div class="sfdt-db-link-hdr">\u2194 Link record (' + _esc(def.linkObject || '') + ')</div>';
      var lks = Object.entries(node.linkFields);
      for (var li = 0; li < lks.length; li++) {
        h += '<div class="sfdt-db-row sfdt-db-frow">'
          + '<label class="sfdt-db-lbl" title="' + _esc(lks[li][0]) + '">' + _esc(lks[li][0].replace(NS, '').replace('__c', '')) + '</label>'
          + '<input type="text" class="sfdt-db-inp sfdt-db-link-value" data-nid="' + node.id + '" data-field="' + _esc(lks[li][0]) + '"'
          + ' value="' + _esc(String(lks[li][1])) + '" spellcheck="false"/>'
          + '</div>';
      }
      h += '</div>';
    }

    // Field picker
    h += '<div class="sfdt-db-row sfdt-db-picker-row">';
    h += '<select class="sfdt-db-field-picker" data-nid="' + node.id + '"><option value="">+ Add a field\u2026</option>';
    if (node.describe) {
      for (var pi = 0; pi < node.describe.length; pi++) {
        var pf = node.describe[pi];
        if (!node.fields.hasOwnProperty(pf.name)) {
          h += '<option value="' + pf.name + '">' + pf.label + ' (' + pf.name + ')' + (pf.nillable ? '' : ' *') + '</option>';
        }
      }
    }
    h += '</select></div>';

    h += '</div>';
    return h;
  }

  function _updateNodeStatus(container, nodeId, status) {
    var el = container.querySelector('.sfdt-db-node[data-id="' + nodeId + '"]');
    if (!el) return;
    var cls = { running: 'run', success: 'ok', error: 'fail' };
    el.className = el.className.replace(/ (ok|fail|run)/g, '') + ' ' + (cls[status] || '');
  }

  // ─── Event Handlers ───────────────────────────────────

  function _attachListeners(container) {
    // Root add
    container.querySelectorAll('.sfdt-db-add-root').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var node = addNode(btn.dataset.type);
        if (node) node.expanded = true;
        _reRender(container);
      });
    });

    // Add child
    container.querySelectorAll('.sfdt-db-add-child-btn:not(.sfdt-db-use-existing-btn)').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        addNode(btn.dataset.type, btn.dataset.parent);
        _reRender(container);
      });
    });

    // Use Existing button
    container.querySelectorAll('.sfdt-db-use-existing-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var type = btn.dataset.type;
        var parentId = btn.dataset.parent;
        if (type === 'option_group') {
          btn.textContent = 'Loading\u2026';
          var groups = await _fetchExistingOptionGroups();
          if (groups.length === 0) {
            alert('No existing Option Groups found.');
            _reRender(container);
            return;
          }
          // Show a picker
          var names = groups.map(function(g, i) { return (i + 1) + '. ' + g.label + (g.product ? ' (' + g.product + ')' : '') + ' [' + g.id + ']'; });
          var choice = prompt('Pick an existing Option Group (enter number):\\n\\n' + names.join('\\n'));
          if (choice) {
            var idx = parseInt(choice, 10) - 1;
            if (idx >= 0 && idx < groups.length) {
              var node = addNode(type, parentId);
              if (node) {
                node.useExistingId = groups[idx].id;
                node.fields.Name = groups[idx].label;
                node.label = groups[idx].label;
              }
            }
          }
        }
        _reRender(container);
      });
    });

    // Add child trigger
    container.querySelectorAll('.sfdt-db-add-child-trigger').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var menu = btn.nextElementSibling;
        if (menu) menu.classList.toggle('sfdt-db-menu-open');
      });
    });

    // Toggle
    container.querySelectorAll('.sfdt-db-toggle').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var node = _findNode(btn.dataset.id);
        if (node) { node.expanded = !node.expanded; _reRender(container); }
      });
    });

    // Header click toggle
    container.querySelectorAll('.sfdt-db-node-hd').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.closest('button') || e.target.closest('.sfdt-db-add-child-menu')) return;
        var node = _findNode(el.dataset.id);
        if (node) { node.expanded = !node.expanded; _reRender(container); }
      });
    });

    // Remove / Move
    container.querySelectorAll('.sfdt-db-remove-node').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); removeNode(btn.dataset.id); _reRender(container); });
    });
    container.querySelectorAll('.sfdt-db-move-node').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); moveNode(btn.dataset.id, parseInt(btn.dataset.dir)); _reRender(container); });
    });

    // Object input
    container.querySelectorAll('.sfdt-db-obj-input').forEach(function(inp) {
      inp.addEventListener('change', function() { var n = _findNode(inp.dataset.id); if (n) n.object = inp.value.trim(); });
    });

    // Load Fields
    container.querySelectorAll('.sfdt-db-load-fields').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var node = _findNode(btn.dataset.id);
        if (!node || !node.object) return;
        btn.textContent = 'Loading\u2026'; btn.disabled = true;
        var fields = await _getDescribe(node.object);
        if (fields) {
          node.describe = fields;
          for (var fi = 0; fi < fields.length; fi++) {
            if (!fields[fi].nillable && !fields[fi].defaultedOnCreate && !node.fields.hasOwnProperty(fields[fi].name))
              node.fields[fields[fi].name] = '';
          }
        }
        _reRender(container);
      });
    });

    // Field picker / value / link / delete
    container.querySelectorAll('.sfdt-db-field-picker').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var n = _findNode(sel.dataset.nid);
        if (n && sel.value) { n.fields[sel.value] = ''; _reRender(container); }
      });
    });
    container.querySelectorAll('.sfdt-db-field-value').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var n = _findNode(inp.dataset.nid); if (n) n.fields[inp.dataset.field] = inp.value;
        var r = inp.value.indexOf('{{Step') !== -1;
        inp.classList.toggle('sfdt-db-inp-ref', r);
        var fr = inp.closest('.sfdt-db-frow'); if (fr) fr.classList.toggle('sfdt-db-frow-ref', r);
      });
    });
    container.querySelectorAll('.sfdt-db-link-value').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var n = _findNode(inp.dataset.nid); if (n && n.linkFields) n.linkFields[inp.dataset.field] = inp.value;
      });
    });
    container.querySelectorAll('.sfdt-db-field-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var n = _findNode(btn.dataset.nid); if (n) { delete n.fields[btn.dataset.field]; _reRender(container); }
      });
    });

    // Execute / Clear / Recipes
    var ex = container.querySelector('#db-execute');
    if (ex) ex.addEventListener('click', function() { executeAll(container); });
    var cl = container.querySelector('#db-clear');
    if (cl) cl.addEventListener('click', function() {
      if (_tree.length === 0 || confirm('Remove all nodes?')) { _tree = []; _results = {}; _nodeSeq = 1; _reRender(container); }
    });
    var sv = container.querySelector('#db-save-recipe');
    if (sv) sv.addEventListener('click', function() {
      var n = prompt('Recipe name:', 'Recipe ' + new Date().toLocaleDateString());
      if (n) { saveRecipe(n.trim()); _reRender(container); }
    });
    var rs = container.querySelector('#db-recipe-select');
    if (rs) rs.addEventListener('change', function(e) { if (e.target.value && loadRecipe(e.target.value)) _reRender(container); });
    var dl = container.querySelector('#db-delete-recipe');
    if (dl) dl.addEventListener('click', function() {
      var s = container.querySelector('#db-recipe-select');
      if (s && s.value && confirm('Delete "' + s.value + '"?')) { deleteRecipe(s.value); _reRender(container); }
    });
  }

  function _esc(str) { if (!str) return ''; var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  return {
    render: render, addNode: addNode, removeNode: removeNode, moveNode: moveNode,
    executeAll: executeAll, saveRecipe: saveRecipe, loadRecipe: loadRecipe, deleteRecipe: deleteRecipe,
    getRecipeNames: getRecipeNames,
    getTree: function() { return _tree; }, getResults: function() { return _results; },
    isRunning: function() { return _running; }, NODE_TYPES: NODE_TYPES
  };
})();

if (typeof window !== 'undefined') window.SFDTDataBuilder = DataBuilderPanel;
