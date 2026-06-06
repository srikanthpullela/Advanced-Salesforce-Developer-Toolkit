/**
 * DependencyPanel - Interactive dependency graph visualizer using MetadataComponentDependency.
 * Shows inbound/outbound dependencies for fields, Apex classes, Flows, etc.
 * Canvas2D-based radial graph with pan/zoom/click-to-expand.
 */
const DependencyPanel = (() => {
  const API = () => window.SalesforceAPI;
  const META = () => window.SFDTMetadataService;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _panel = null;
  let _visible = false;
  let _pinned = false;

  // Graph state
  let _nodes = [];
  let _edges = [];
  let _centerNodeId = null;
  let _selectedNodeId = null;
  let _expandedNodes = new Set();
  let _activeFilters = new Set(['ApexClass', 'ApexTrigger', 'Flow', 'ValidationRule', 'Layout', 'LightningComponentBundle', 'AuraDefinitionBundle', 'CustomField', 'FlexiPage', 'WorkflowFieldUpdate', 'CustomObject']);
  let _direction = 'both'; // 'inbound', 'outbound', 'both'

  // Canvas state
  let _canvas = null;
  let _ctx = null;
  let _panX = 0, _panY = 0;
  let _zoom = 1;
  let _dragging = false;
  let _dragStartX = 0, _dragStartY = 0;
  let _animFrame = null;

  // Cache
  let _depCache = {};

  // Type colors
  const TYPE_COLORS = {
    ApexClass: '#58a6ff',
    ApexTrigger: '#58a6ff',
    CustomField: '#fbbf24',
    Flow: '#22c55e',
    ValidationRule: '#f97316',
    Layout: '#c084fc',
    FlexiPage: '#c084fc',
    LightningComponentBundle: '#06b6d4',
    AuraDefinitionBundle: '#ec4899',
    WorkflowFieldUpdate: '#f97316',
    CustomObject: '#8b949e',
    ApexPage: '#8b949e',
    ApexComponent: '#8b949e',
  };

  const TYPE_SHORT = {
    ApexClass: 'Apex',
    ApexTrigger: 'Trigger',
    CustomField: 'Field',
    Flow: 'Flow',
    ValidationRule: 'VR',
    Layout: 'Layout',
    FlexiPage: 'Page',
    LightningComponentBundle: 'LWC',
    AuraDefinitionBundle: 'Aura',
    WorkflowFieldUpdate: 'WFU',
    CustomObject: 'Object',
    ApexPage: 'VF',
    ApexComponent: 'VF Comp',
  };

  function _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Layer 1: Resolver ────────────────────────────────

  async function _resolveComponentId(input) {
    // If it looks like a Salesforce ID (15 or 18 char), use directly
    if (/^[a-zA-Z0-9]{15,18}$/.test(input)) {
      return { id: input, name: input, type: 'Unknown' };
    }

    // If it's ObjectName.FieldName format, resolve via FieldDefinition
    if (input.includes('.')) {
      const [objName, fieldName] = input.split('.');
      try {
        const r = await API().toolingQuery(
          `SELECT DurableId, QualifiedApiName, EntityDefinition.QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objName.replace(/'/g, "''")}' AND QualifiedApiName = '${fieldName.replace(/'/g, "''")}' LIMIT 1`
        );
        if (r.records && r.records.length > 0) {
          const fd = r.records[0];
          return { id: fd.DurableId, name: `${objName}.${fieldName}`, type: 'CustomField' };
        }
      } catch (e) {
        window._sfdtLogger.debug('[SFDT] FieldDefinition resolve failed:', e.message);
      }
    }

    // Try Apex Class
    try {
      const r = await API().toolingQuery(
        `SELECT Id, Name FROM ApexClass WHERE Name = '${input.replace(/'/g, "''")}' LIMIT 1`
      );
      if (r.records && r.records.length > 0) {
        return { id: r.records[0].Id, name: r.records[0].Name, type: 'ApexClass' };
      }
    } catch { /* continue */ }

    // Try Flow
    try {
      const r = await API().toolingQuery(
        `SELECT DurableId, MasterLabel FROM FlowDefinition WHERE DeveloperName = '${input.replace(/'/g, "''")}' LIMIT 1`
      );
      if (r.records && r.records.length > 0) {
        return { id: r.records[0].DurableId, name: r.records[0].MasterLabel, type: 'Flow' };
      }
    } catch { /* continue */ }

    // Try by name pattern across MetadataComponentDependency
    try {
      const r = await API().toolingQuery(
        `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentName = '${input.replace(/'/g, "''")}' LIMIT 1`
      );
      if (r.records && r.records.length > 0) {
        const m = r.records[0];
        return { id: m.MetadataComponentId, name: m.MetadataComponentName, type: m.MetadataComponentType };
      }
    } catch { /* continue */ }

    return null;
  }

  // ─── Layer 2: Dependency Fetcher ──────────────────────

  async function _fetchDependencies(metadataId, direction) {
    const cacheKey = `${metadataId}_${direction}`;
    if (_depCache[cacheKey]) return _depCache[cacheKey];

    const results = { inbound: [], outbound: [] };

    if (direction === 'inbound' || direction === 'both') {
      try {
        const r = await API().toolingQueryAll(
          `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, MetadataComponentNamespace, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = '${metadataId}' LIMIT 2000`
        );
        results.inbound = r.records || [];
      } catch (e) {
        window._sfdtLogger.debug('[SFDT] Inbound dep fetch error:', e.message);
      }
    }

    if (direction === 'outbound' || direction === 'both') {
      try {
        const r = await API().toolingQueryAll(
          `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, MetadataComponentNamespace, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentId = '${metadataId}' LIMIT 2000`
        );
        results.outbound = r.records || [];
      } catch (e) {
        window._sfdtLogger.debug('[SFDT] Outbound dep fetch error:', e.message);
      }
    }

    _depCache[cacheKey] = results;
    return results;
  }

  // ─── Layer 3: Graph Builder ───────────────────────────

  function _buildGraph(centerNode, depResults) {
    const nodesMap = {};
    const edges = [];

    // Center node
    nodesMap[centerNode.id] = {
      id: centerNode.id,
      label: centerNode.name,
      type: centerNode.type,
      isCenter: true,
      x: 0, y: 0,
      radius: 28,
      deps: 0
    };

    // Inbound: other components reference the center node
    (depResults.inbound || []).forEach(d => {
      const nodeId = d.MetadataComponentId;
      if (!nodesMap[nodeId]) {
        nodesMap[nodeId] = {
          id: nodeId,
          label: d.MetadataComponentName,
          type: d.MetadataComponentType,
          namespace: d.MetadataComponentNamespace,
          isCenter: false,
          x: 0, y: 0,
          radius: 18,
          deps: 0
        };
      }
      edges.push({
        source: nodeId,
        target: centerNode.id,
        direction: 'inbound'
      });
    });

    // Outbound: center node references others
    (depResults.outbound || []).forEach(d => {
      const nodeId = d.RefMetadataComponentId;
      if (!nodesMap[nodeId]) {
        nodesMap[nodeId] = {
          id: nodeId,
          label: d.RefMetadataComponentName,
          type: d.RefMetadataComponentType,
          isCenter: false,
          x: 0, y: 0,
          radius: 18,
          deps: 0
        };
      }
      edges.push({
        source: centerNode.id,
        target: nodeId,
        direction: 'outbound'
      });
    });

    // Count deps per node
    Object.values(nodesMap).forEach(n => {
      n.deps = edges.filter(e => e.source === n.id || e.target === n.id).length;
    });

    _nodes = Object.values(nodesMap);
    _edges = edges;

    _layoutRadial();
  }

  function _layoutRadial() {
    const center = _nodes.find(n => n.isCenter);
    if (!center) return;
    center.x = 0;
    center.y = 0;

    // Group non-center nodes by type
    const others = _nodes.filter(n => !n.isCenter && _activeFilters.has(n.type));
    if (others.length === 0) return;

    // Sort by type for visual grouping
    others.sort((a, b) => (a.type || '').localeCompare(b.type || ''));

    const baseRadius = Math.max(160, others.length * 12);
    const angleStep = (2 * Math.PI) / others.length;

    others.forEach((node, i) => {
      const angle = angleStep * i - Math.PI / 2;
      // Add slight jitter per type group to prevent overlap
      const r = baseRadius + (node.deps > 3 ? 20 : 0);
      node.x = Math.cos(angle) * r;
      node.y = Math.sin(angle) * r;
    });
  }

  // ─── Layer 4: Canvas Renderer ─────────────────────────

  function _initCanvas() {
    _canvas = _container.querySelector('#dep-canvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _resizeCanvas();

    _canvas.addEventListener('wheel', _onWheel, { passive: false });
    _canvas.addEventListener('mousedown', _onMouseDown);
    _canvas.addEventListener('mousemove', _onMouseMove);
    _canvas.addEventListener('mouseup', _onMouseUp);
    _canvas.addEventListener('dblclick', _onDblClick);
    _canvas.addEventListener('click', _onClick);

    window.addEventListener('resize', _resizeCanvas);
  }

  function _resizeCanvas() {
    if (!_canvas) return;
    const rect = _canvas.parentElement.getBoundingClientRect();
    _canvas.width = rect.width * window.devicePixelRatio;
    _canvas.height = rect.height * window.devicePixelRatio;
    _canvas.style.width = rect.width + 'px';
    _canvas.style.height = rect.height + 'px';
    _ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    _render();
  }

  function _render() {
    if (!_ctx || !_canvas) return;
    const w = _canvas.width / window.devicePixelRatio;
    const h = _canvas.height / window.devicePixelRatio;

    _ctx.clearRect(0, 0, w, h);
    _ctx.save();

    // Apply pan and zoom — center the view
    const cx = w / 2 + _panX;
    const cy = h / 2 + _panY;
    _ctx.translate(cx, cy);
    _ctx.scale(_zoom, _zoom);

    // Draw edges
    const visibleIds = new Set(_nodes.filter(n => n.isCenter || _activeFilters.has(n.type)).map(n => n.id));
    _edges.forEach(e => {
      const src = _nodes.find(n => n.id === e.source);
      const tgt = _nodes.find(n => n.id === e.target);
      if (!src || !tgt) return;
      if (!visibleIds.has(src.id) || !visibleIds.has(tgt.id)) return;

      _ctx.beginPath();
      _ctx.moveTo(src.x, src.y);
      _ctx.lineTo(tgt.x, tgt.y);
      _ctx.strokeStyle = e.direction === 'inbound' ? 'rgba(88,166,255,0.25)' : 'rgba(34,197,94,0.25)';
      _ctx.lineWidth = 1;
      _ctx.stroke();

      // Arrow head
      const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
      const arrowLen = 8;
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      _ctx.beginPath();
      _ctx.moveTo(midX + arrowLen * Math.cos(angle), midY + arrowLen * Math.sin(angle));
      _ctx.lineTo(midX + arrowLen * Math.cos(angle + 2.5), midY + arrowLen * Math.sin(angle + 2.5));
      _ctx.lineTo(midX + arrowLen * Math.cos(angle - 2.5), midY + arrowLen * Math.sin(angle - 2.5));
      _ctx.closePath();
      _ctx.fillStyle = e.direction === 'inbound' ? 'rgba(88,166,255,0.4)' : 'rgba(34,197,94,0.4)';
      _ctx.fill();
    });

    // Draw nodes
    _nodes.forEach(node => {
      if (!node.isCenter && !_activeFilters.has(node.type)) return;

      const color = TYPE_COLORS[node.type] || '#8b949e';
      const isSelected = node.id === _selectedNodeId;
      const isExpanded = _expandedNodes.has(node.id);

      // Node circle
      _ctx.beginPath();
      _ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      _ctx.fillStyle = node.isCenter ? '#1a1f2e' : 'rgba(15,20,25,0.9)';
      _ctx.fill();
      _ctx.strokeStyle = isSelected ? '#ffffff' : color;
      _ctx.lineWidth = isSelected ? 3 : node.isCenter ? 2.5 : 1.5;
      _ctx.stroke();

      // Expanded indicator
      if (isExpanded) {
        _ctx.beginPath();
        _ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        _ctx.strokeStyle = color;
        _ctx.lineWidth = 1;
        _ctx.setLineDash([3, 3]);
        _ctx.stroke();
        _ctx.setLineDash([]);
      }

      // Type badge text inside node
      const shortType = TYPE_SHORT[node.type] || node.type || '?';
      _ctx.fillStyle = color;
      _ctx.font = `bold ${node.isCenter ? 10 : 8}px -apple-system, system-ui, sans-serif`;
      _ctx.textAlign = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(shortType, node.x, node.y);

      // Label below node
      _ctx.fillStyle = '#e1e4e8';
      _ctx.font = `${node.isCenter ? 12 : 10}px -apple-system, system-ui, sans-serif`;
      const label = node.label || '';
      const truncLabel = label.length > 25 ? label.substring(0, 22) + '...' : label;
      _ctx.fillText(truncLabel, node.x, node.y + node.radius + 12);

      // Dep count badge
      if (node.deps > 0 && !node.isCenter) {
        const badgeX = node.x + node.radius - 4;
        const badgeY = node.y - node.radius + 4;
        _ctx.beginPath();
        _ctx.arc(badgeX, badgeY, 8, 0, Math.PI * 2);
        _ctx.fillStyle = node.deps > 10 ? '#f85149' : node.deps > 5 ? '#f97316' : '#383e4a';
        _ctx.fill();
        _ctx.fillStyle = '#fff';
        _ctx.font = 'bold 8px -apple-system, system-ui, sans-serif';
        _ctx.fillText(String(node.deps), badgeX, badgeY);
      }
    });

    _ctx.restore();
  }

  function _screenToWorld(sx, sy) {
    const w = _canvas.width / window.devicePixelRatio;
    const h = _canvas.height / window.devicePixelRatio;
    const cx = w / 2 + _panX;
    const cy = h / 2 + _panY;
    return {
      x: (sx - cx) / _zoom,
      y: (sy - cy) / _zoom
    };
  }

  function _nodeAt(sx, sy) {
    const { x, y } = _screenToWorld(sx, sy);
    for (let i = _nodes.length - 1; i >= 0; i--) {
      const n = _nodes[i];
      if (!n.isCenter && !_activeFilters.has(n.type)) continue;
      const dx = x - n.x, dy = y - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius) return n;
    }
    return null;
  }

  function _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    _zoom = Math.max(0.2, Math.min(4, _zoom * delta));
    _render();
  }

  function _onMouseDown(e) {
    _dragging = true;
    _dragStartX = e.clientX - _panX;
    _dragStartY = e.clientY - _panY;
    _canvas.style.cursor = 'grabbing';
  }

  function _onMouseMove(e) {
    if (_dragging) {
      _panX = e.clientX - _dragStartX;
      _panY = e.clientY - _dragStartY;
      _render();
    } else {
      const rect = _canvas.getBoundingClientRect();
      const n = _nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      _canvas.style.cursor = n ? 'pointer' : 'grab';
    }
  }

  function _onMouseUp() {
    _dragging = false;
    _canvas.style.cursor = 'grab';
  }

  function _onClick(e) {
    const rect = _canvas.getBoundingClientRect();
    const n = _nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    _selectedNodeId = n ? n.id : null;
    _renderDetailPanel(n);
    _render();
  }

  async function _onDblClick(e) {
    const rect = _canvas.getBoundingClientRect();
    const n = _nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!n || n.isCenter || _expandedNodes.has(n.id)) return;

    // Expand 2nd hop
    _expandedNodes.add(n.id);
    _showLoading('Expanding...');

    try {
      const deps = await _fetchDependencies(n.id, _direction);
      _addToGraph(n, deps);
      _layoutRadial();
      _render();
    } catch (err) {
      window._sfdtLogger.debug('[SFDT] Expand error:', err);
    }

    _hideLoading();
  }

  function _addToGraph(parentNode, depResults) {
    const existingIds = new Set(_nodes.map(n => n.id));

    (depResults.inbound || []).forEach(d => {
      const nodeId = d.MetadataComponentId;
      if (!existingIds.has(nodeId)) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 40;
        _nodes.push({
          id: nodeId,
          label: d.MetadataComponentName,
          type: d.MetadataComponentType,
          namespace: d.MetadataComponentNamespace,
          isCenter: false,
          x: parentNode.x + Math.cos(angle) * dist,
          y: parentNode.y + Math.sin(angle) * dist,
          radius: 14,
          deps: 0
        });
        existingIds.add(nodeId);
      }
      _edges.push({ source: nodeId, target: parentNode.id, direction: 'inbound' });
    });

    (depResults.outbound || []).forEach(d => {
      const nodeId = d.RefMetadataComponentId;
      if (!existingIds.has(nodeId)) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 40;
        _nodes.push({
          id: nodeId,
          label: d.RefMetadataComponentName,
          type: d.RefMetadataComponentType,
          isCenter: false,
          x: parentNode.x + Math.cos(angle) * dist,
          y: parentNode.y + Math.sin(angle) * dist,
          radius: 14,
          deps: 0
        });
        existingIds.add(nodeId);
      }
      _edges.push({ source: parentNode.id, target: nodeId, direction: 'outbound' });
    });

    // Re-count deps
    _nodes.forEach(n => {
      n.deps = _edges.filter(e => e.source === n.id || e.target === n.id).length;
    });
  }

  // ─── Detail Panel ─────────────────────────────────────

  function _renderDetailPanel(node) {
    const detail = _container.querySelector('#dep-detail');
    if (!detail) return;

    if (!node) {
      detail.innerHTML = `<div class="sfdt-dep-detail-empty">Click a node to see details</div>`;
      return;
    }

    const base = API().getInstanceUrl();
    const isLightning = base.includes('lightning.force.com')
      || document.querySelector('one-app-nav-bar')
      || window.location.pathname.startsWith('/lightning');

    let setupUrl = '';
    if (node.type === 'ApexClass' && node.id) {
      setupUrl = isLightning ? `${base}/lightning/setup/ApexClasses/page?address=/${node.id}` : `${base}/${node.id}`;
    } else if (node.type === 'ApexTrigger' && node.id) {
      setupUrl = isLightning ? `${base}/lightning/setup/ApexTriggers/page?address=/${node.id}` : `${base}/${node.id}`;
    } else if (node.type === 'Flow' && node.id) {
      setupUrl = isLightning ? `${base}/lightning/setup/Flows/page?address=/${node.id}` : `${base}/${node.id}`;
    } else if (node.type === 'CustomField' && node.id) {
      const parts = (node.label || '').split('.');
      if (parts.length === 2) {
        setupUrl = isLightning ? `${base}/lightning/setup/ObjectManager/${encodeURIComponent(parts[0])}/FieldsAndRelationships/${encodeURIComponent(parts[1])}/view` : '';
      }
    }

    const color = TYPE_COLORS[node.type] || '#8b949e';
    const typeLabel = TYPE_SHORT[node.type] || node.type || 'Unknown';

    const inboundCount = _edges.filter(e => e.target === node.id).length;
    const outboundCount = _edges.filter(e => e.source === node.id).length;

    detail.innerHTML = `
      <div class="sfdt-dep-detail-header">
        <span class="sfdt-dep-detail-type" style="background:${color}20;color:${color};border:1px solid ${color}40">${_esc(typeLabel)}</span>
        ${node.isCenter ? '<span class="sfdt-dep-detail-center">CENTER</span>' : ''}
      </div>
      <div class="sfdt-dep-detail-name">${_esc(node.label)}</div>
      ${node.namespace ? `<div class="sfdt-dep-detail-ns">Namespace: ${_esc(node.namespace)}</div>` : ''}
      <div class="sfdt-dep-detail-stats">
        <span title="Components that reference this">← ${inboundCount} inbound</span>
        <span title="Components this references">→ ${outboundCount} outbound</span>
      </div>
      ${setupUrl ? `<a href="${setupUrl}" target="_blank" class="sfdt-dep-detail-link">Open in Setup →</a>` : ''}
      ${!node.isCenter && !_expandedNodes.has(node.id) ? `<button class="sfdt-btn sfdt-btn-sm sfdt-dep-expand-btn" data-id="${node.id}">Expand Dependencies</button>` : ''}
    `;

    // Wire expand button
    const expandBtn = detail.querySelector('.sfdt-dep-expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', async () => {
        expandBtn.textContent = 'Loading...';
        expandBtn.disabled = true;
        _expandedNodes.add(node.id);
        try {
          const deps = await _fetchDependencies(node.id, _direction);
          _addToGraph(node, deps);
          _layoutRadial();
          _render();
          _renderDetailPanel(node);
        } catch (err) {
          expandBtn.textContent = 'Error';
        }
      });
    }
  }

  // ─── Filter / Direction Controls ──────────────────────

  function _updateFilters() {
    const filterBar = _container.querySelector('#dep-filters');
    if (!filterBar) return;

    const types = new Set(_nodes.filter(n => !n.isCenter).map(n => n.type));

    filterBar.innerHTML = Array.from(types).sort().map(type => {
      const color = TYPE_COLORS[type] || '#8b949e';
      const label = TYPE_SHORT[type] || type;
      const active = _activeFilters.has(type);
      const count = _nodes.filter(n => n.type === type).length;
      return `<button class="sfdt-dep-filter ${active ? 'active' : ''}" data-type="${_esc(type)}" style="${active ? `background:${color}20;color:${color};border-color:${color}40` : ''}">
        ${_esc(label)} <span class="sfdt-dep-filter-count">${count}</span>
      </button>`;
    }).join('');

    filterBar.querySelectorAll('.sfdt-dep-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (_activeFilters.has(type)) {
          _activeFilters.delete(type);
        } else {
          _activeFilters.add(type);
        }
        _updateFilters();
        _layoutRadial();
        _render();
      });
    });
  }

  function _setupDirectionToggle() {
    const dirBtns = _container.querySelectorAll('.sfdt-dep-dir-btn');
    dirBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        _direction = btn.dataset.dir;
        dirBtns.forEach(b => b.classList.toggle('active', b.dataset.dir === _direction));
        // Re-fetch with new direction
        if (_centerNodeId) _loadComponent({ id: _centerNodeId, name: _nodes.find(n => n.isCenter)?.label, type: _nodes.find(n => n.isCenter)?.type });
      });
    });
  }

  // ─── Loading / Search UI ──────────────────────────────

  function _showLoading(msg) {
    const el = _container.querySelector('#dep-loading');
    if (el) { el.textContent = msg || 'Loading...'; el.style.display = 'block'; }
  }

  function _hideLoading() {
    const el = _container.querySelector('#dep-loading');
    if (el) el.style.display = 'none';
  }

  async function _onSearch() {
    const input = _container.querySelector('#dep-search');
    if (!input) return;
    const query = input.value.trim();
    if (!query) return;

    _showLoading('Resolving component...');
    const resolved = await _resolveComponentId(query);

    if (!resolved) {
      _hideLoading();
      const detail = _container.querySelector('#dep-detail');
      if (detail) detail.innerHTML = `<div class="sfdt-error" style="padding:12px;font-size:12px">Could not find component: "${_esc(query)}"<br><span style="font-size:11px;color:#8b949e">Try: ObjectName.FieldName, ApexClassName, or FlowDevName</span></div>`;
      return;
    }

    await _loadComponent(resolved);
  }

  async function _loadComponent(resolved) {
    _showLoading(`Fetching dependencies for ${resolved.name}...`);
    _centerNodeId = resolved.id;
    _expandedNodes.clear();
    _selectedNodeId = null;
    _panX = 0; _panY = 0; _zoom = 1;

    try {
      const deps = await _fetchDependencies(resolved.id, _direction);
      _buildGraph(resolved, deps);
      _updateFilters();
      _render();

      const totalDeps = (deps.inbound || []).length + (deps.outbound || []).length;
      const detail = _container.querySelector('#dep-detail');
      if (detail) {
        detail.innerHTML = `
          <div class="sfdt-dep-detail-header">
            <span class="sfdt-dep-detail-type" style="background:${(TYPE_COLORS[resolved.type] || '#8b949e')}20;color:${TYPE_COLORS[resolved.type] || '#8b949e'}">${_esc(TYPE_SHORT[resolved.type] || resolved.type)}</span>
            <span class="sfdt-dep-detail-center">CENTER</span>
          </div>
          <div class="sfdt-dep-detail-name">${_esc(resolved.name)}</div>
          <div class="sfdt-dep-detail-stats">
            <span>← ${(deps.inbound || []).length} inbound</span>
            <span>→ ${(deps.outbound || []).length} outbound</span>
          </div>
          <div style="margin-top:8px;font-size:11px;color:#8b949e">
            ${totalDeps === 0 ? 'No dependencies found via MetadataComponentDependency API.' : `${totalDeps} total dependencies. Click a node for details. Double-click to expand.`}
          </div>
        `;
      }
    } catch (err) {
      const detail = _container.querySelector('#dep-detail');
      if (detail) detail.innerHTML = `<div class="sfdt-error" style="padding:12px;font-size:12px">${_esc(err.message)}</div>`;
    }

    _hideLoading();
  }

  // ─── Panel Creation ───────────────────────────────────

  function _create() {
    if (_container) return;
    const { container } = SHADOW().getOrCreate('dependency-panel');
    _container = container;

    const I = ICONS();
    container.innerHTML = `
      <div class="sfdt-panel sfdt-panel-right sfdt-dep-panel" id="dep-panel" style="display:none">
        <div class="sfdt-panel-header" style="padding:8px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border,#2d333b)">
          <span style="width:18px;height:18px;display:flex;color:var(--accent,#58a6ff)">${I.graph}</span>
          <span style="font-size:13px;font-weight:600;color:var(--fg,#e1e4e8);flex:1">Dependency Graph</span>
          <button class="sfdt-btn sfdt-btn-sm" id="dep-pin" title="Pin panel">${I.pin}</button>
          <button class="sfdt-btn sfdt-btn-sm" id="dep-close">${I.x}</button>
        </div>

        <div style="padding:8px 12px;border-bottom:1px solid var(--border,#2d333b);display:flex;gap:6px;align-items:center">
          <input type="text" id="dep-search" class="sfdt-input" placeholder="Object.Field, ApexClass, or FlowName" style="flex:1;font-size:12px;padding:5px 8px;background:var(--bg3,#141925);border:1px solid var(--border,#2d333b);border-radius:6px;color:var(--fg,#e1e4e8);outline:none" />
          <button class="sfdt-btn sfdt-btn-sm sfdt-btn-accent" id="dep-search-btn">${I.search}</button>
        </div>

        <div style="padding:4px 12px;border-bottom:1px solid var(--border,#2d333b);display:flex;gap:4px;align-items:center">
          <span style="font-size:10px;color:var(--fg3,#6e7681);margin-right:4px">Direction:</span>
          <button class="sfdt-btn sfdt-btn-xs sfdt-dep-dir-btn active" data-dir="both">Both</button>
          <button class="sfdt-btn sfdt-btn-xs sfdt-dep-dir-btn" data-dir="inbound">← Inbound</button>
          <button class="sfdt-btn sfdt-btn-xs sfdt-dep-dir-btn" data-dir="outbound">Outbound →</button>
        </div>

        <div id="dep-filters" style="padding:4px 12px;border-bottom:1px solid var(--border,#2d333b);display:flex;flex-wrap:wrap;gap:4px;min-height:28px"></div>

        <div style="flex:1;position:relative;overflow:hidden;min-height:0">
          <canvas id="dep-canvas" style="width:100%;height:100%;cursor:grab"></canvas>
          <div id="dep-loading" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;color:var(--fg2,#8b949e);background:var(--bg,#0f1419);padding:8px 16px;border-radius:8px;border:1px solid var(--border,#2d333b)">Loading...</div>
        </div>

        <div id="dep-detail" style="border-top:1px solid var(--border,#2d333b);padding:10px 12px;max-height:160px;overflow-y:auto;font-size:12px">
          <div class="sfdt-dep-detail-empty">Search for a component to visualize dependencies</div>
        </div>
      </div>
    `;

    _panel = container.querySelector('#dep-panel');

    // Wire events
    container.querySelector('#dep-close').addEventListener('click', hide);
    container.querySelector('#dep-pin').addEventListener('click', () => {
      _pinned = !_pinned;
      container.querySelector('#dep-pin').classList.toggle('sfdt-btn-active', _pinned);
    });
    container.querySelector('#dep-search-btn').addEventListener('click', _onSearch);
    container.querySelector('#dep-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _onSearch(); }
    });

    _setupDirectionToggle();

    SHADOW().initPanelResize(_panel, 'left', 'sfdt_dep_width');
  }

  // ─── Public API ───────────────────────────────────────

  function show() {
    _create();
    _panel.style.display = 'flex';
    _visible = true;
    if (!_canvas) _initCanvas();
    _resizeCanvas();
    const input = _container.querySelector('#dep-search');
    if (input) input.focus();
  }

  function hide() {
    if (_pinned) return;
    if (_panel) _panel.style.display = 'none';
    _visible = false;
  }

  function toggle() {
    _visible ? hide() : show();
  }

  function showForField(objectName, fieldName) {
    show();
    const input = _container.querySelector('#dep-search');
    if (input) input.value = `${objectName}.${fieldName}`;
    _onSearch();
  }

  return {
    show,
    hide,
    toggle,
    isVisible: () => _visible,
    isPinned: () => _pinned,
    showForField,
    // Expose fetcher for Inspector integration
    fetchFieldDependencyCounts: async (objectName) => {
      try {
        const r = await API().toolingQueryAll(
          `SELECT RefMetadataComponentName, MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentName LIKE '${objectName.replace(/'/g, "''")}%' LIMIT 2000`
        );
        // Group by field
        const counts = {};
        (r.records || []).forEach(d => {
          const refName = d.RefMetadataComponentName || '';
          // RefMetadataComponentName could be "ObjectName.FieldName"
          const parts = refName.split('.');
          const fieldKey = parts.length > 1 ? parts.slice(1).join('.') : refName;
          if (!counts[fieldKey]) counts[fieldKey] = 0;
          counts[fieldKey]++;
        });
        return counts;
      } catch (e) {
        window._sfdtLogger.debug('[SFDT] fetchFieldDependencyCounts error:', e.message);
        return {};
      }
    }
  };
})();

if (typeof window !== 'undefined') window.SFDTDependencyPanel = DependencyPanel;
