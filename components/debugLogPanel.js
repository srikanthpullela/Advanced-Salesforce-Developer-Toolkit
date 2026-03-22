/**
 * DebugLogPanel - Advanced Apex Debug Log Analyzer.
 * Inspired by Certinia's Log Analyzer: flame chart timeline, call tree with
 * self/total time, method analysis, database insights, and raw log view.
 */
const DebugLogPanel = (() => {
  const API = () => window.SalesforceAPI;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _panel = null;
  let _visible = false;
  let _autoRefreshTimer = null;
  let _currentLogId = null;
  let _logFilter = 'all';
  let _searchTerm = '';

  function _create() {
    if (_container) return;

    const { container } = SHADOW().getOrCreate('debuglog');
    _container = container;
    const I = ICONS();

    _container.innerHTML = `
      <div class="sfdt-panel sfdt-panel-bottom sfdt-debuglog-panel" id="sfdt-debuglog">
        <div class="sfdt-panel-header">
          <div class="sfdt-panel-title">
            ${I.terminal}
            <span>Debug Log Analyzer</span>
          </div>
          <div class="sfdt-panel-actions">
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-primary" id="dl-refresh" title="Refresh Logs">${I.refresh} Refresh</button>
            <button class="sfdt-btn sfdt-btn-sm" id="dl-auto" title="Auto-refresh every 5s">${I.clock} Auto</button>
            <button class="sfdt-btn sfdt-btn-sm" id="dl-clear" title="Delete All Logs">${I.x} Clear</button>
            <button class="sfdt-btn sfdt-btn-sm" id="dl-toggle-size" title="Toggle Size">${I.maximize}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="dl-close">${I.x}</button>
          </div>
        </div>
        <div class="sfdt-debuglog-layout">
          <!-- Left: Log list -->
          <div class="sfdt-debuglog-list" id="dl-list">
            <div class="sfdt-debuglog-list-header">
              <span style="font-weight:600;color:#89b4fa;font-size:12px">Recent Logs</span>
              <span class="sfdt-debuglog-count" id="dl-count">\u2014</span>
            </div>
            <div class="sfdt-debuglog-list-body" id="dl-list-body">
              <div class="sfdt-loading">Loading logs...</div>
            </div>
          </div>
          <!-- Right: Log detail -->
          <div class="sfdt-debuglog-detail" id="dl-detail">
            <div class="sfdt-debuglog-detail-toolbar" id="dl-detail-toolbar" style="display:none">
              <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0">
                <input type="text" class="sfdt-panel-search" id="dl-search" placeholder="Search log..." autocomplete="off" style="flex:1" />
                <select class="sfdt-panel-sort" id="dl-filter">
                  <option value="all">All Lines</option>
                  <option value="error">Errors</option>
                  <option value="warn">Warnings</option>
                  <option value="soql">SOQL</option>
                  <option value="dml">DML</option>
                  <option value="method">Methods</option>
                  <option value="limit">Limits</option>
                  <option value="user_debug">USER_DEBUG</option>
                </select>
              </div>
              <div class="sfdt-dl-tabs">
                <button class="sfdt-dl-tab" id="dl-tab-summary" title="Overview with stats, limits, and top issues">\uD83D\uDCCA Summary</button>
                <button class="sfdt-dl-tab" id="dl-tab-timeline" title="Flame chart showing execution spans">\uD83D\uDD25 Flame Chart</button>
                <button class="sfdt-dl-tab" id="dl-tab-calltree" title="Expandable call stack with self/total time">\uD83C\uDF33 Call Tree</button>
                <button class="sfdt-dl-tab" id="dl-tab-analysis" title="Aggregated method metrics">\uD83E\uDDE0 Analysis</button>
                <button class="sfdt-dl-tab" id="dl-tab-database" title="SOQL and DML insights">\uD83D\uDCBE Database</button>
                <button class="sfdt-dl-tab" id="dl-tab-raw" title="Raw log lines with color coding">\uD83D\uDCC4 Raw</button>
                <button class="sfdt-btn sfdt-btn-sm" id="dl-download" title="Download log">${I.download}</button>
              </div>
            </div>
            <div class="sfdt-debuglog-detail-body" id="dl-detail-body">
              <div style="padding:40px;text-align:center;color:#7f849c">
                <div style="font-size:28px;margin-bottom:12px;opacity:0.4">${I.terminal}</div>
                <div style="font-size:13px;font-weight:600;color:#cdd6f4;margin-bottom:6px">Debug Log Analyzer</div>
                <div style="font-size:12px;color:#7f849c;line-height:1.6">Select a log from the list to analyze.<br>
                Views: <b style="color:#89b4fa">Summary</b> \u00B7 <b style="color:#f38ba8">Flame Chart</b> \u00B7 <b style="color:#a6e3a1">Call Tree</b> \u00B7 <b style="color:#f9e2af">Analysis</b> \u00B7 <b style="color:#cba6f7">Database</b> \u00B7 Raw</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    _panel = _container.querySelector('#sfdt-debuglog');

    _container.querySelector('#dl-close').addEventListener('click', hide);
    _container.querySelector('#dl-refresh').addEventListener('click', _loadLogs);
    _container.querySelector('#dl-auto').addEventListener('click', _toggleAutoRefresh);
    _container.querySelector('#dl-clear').addEventListener('click', _clearLogs);
    _container.querySelector('#dl-toggle-size').addEventListener('click', function() { _panel.classList.toggle('expanded'); });

    SHADOW().initPanelResize(_panel, 'top', 'sfdt_debuglog_height');

    _container.querySelector('#dl-search').addEventListener('input', function(e) { _searchTerm = e.target.value; _applyFilters(); });
    _container.querySelector('#dl-filter').addEventListener('change', function(e) { _logFilter = e.target.value; _applyFilters(); });
    _container.querySelector('#dl-tab-summary').addEventListener('click', function() { _showTab('summary'); });
    _container.querySelector('#dl-tab-calltree').addEventListener('click', function() { _showTab('calltree'); });
    _container.querySelector('#dl-tab-timeline').addEventListener('click', function() { _showTab('timeline'); });
    _container.querySelector('#dl-tab-analysis').addEventListener('click', function() { _showTab('analysis'); });
    _container.querySelector('#dl-tab-database').addEventListener('click', function() { _showTab('database'); });
    _container.querySelector('#dl-tab-raw').addEventListener('click', function() { _showTab('raw'); });
    _container.querySelector('#dl-download').addEventListener('click', _downloadLog);
  }

  // ─── Log List ─────────────────────────────────────────

  async function _loadLogs() {
    const listBody = _container.querySelector('#dl-list-body');
    listBody.innerHTML = '<div class="sfdt-loading">Loading logs...</div>';

    try {
      const result = await API().getDebugLogs(50);
      const logs = result.records || [];
      _container.querySelector('#dl-count').textContent = `${logs.length} logs`;

      if (logs.length === 0) {
        listBody.innerHTML = '<div style="padding:16px;text-align:center;color:#7f849c;font-size:12px">No debug logs found.<br>Enable debug logging in Setup first.</div>';
        return;
      }

      listBody.innerHTML = logs.map(log => {
        const time = _formatLogTime(log.LastModifiedDate);
        const duration = log.DurationMilliseconds;
        const size = _formatBytes(log.LogLength);
        const op = (log.Operation || '').replace(/^\//, '').substring(0, 35);
        const status = log.Status || '';
        const isError = status.toLowerCase().includes('error') || status.toLowerCase().includes('fatal');
        const durationColor = duration > 5000 ? '#f38ba8' : duration > 2000 ? '#f9e2af' : '#a6e3a1';

        return `<div class="sfdt-debuglog-item ${_currentLogId === log.Id ? 'active' : ''} ${isError ? 'error' : ''}" data-id="${log.Id}">
          <div class="sfdt-debuglog-item-header">
            <span class="sfdt-debuglog-item-time">${time}</span>
            <span class="sfdt-debuglog-item-duration" style="color:${durationColor}">${duration}ms</span>
          </div>
          <div class="sfdt-debuglog-item-op" title="${_esc(log.Operation || '')}">${_esc(op || 'Unknown')}</div>
          <div class="sfdt-debuglog-item-meta">
            <span>${_esc(log.Request || '')}</span>
            <span>${size}</span>
            ${isError ? '<span style="color:#f38ba8">ERROR</span>' : ''}
          </div>
        </div>`;
      }).join('');

      listBody.querySelectorAll('.sfdt-debuglog-item').forEach(el => {
        el.addEventListener('click', () => _loadLogDetail(el.dataset.id));
      });
    } catch (err) {
      listBody.innerHTML = `<div class="sfdt-error" style="padding:12px;font-size:12px">Error: ${_esc(err.message)}</div>`;
    }
  }

  // ─── Log Detail ───────────────────────────────────────

  let _rawLog = '';
  let _parsedLog = null;

  async function _loadLogDetail(logId) {
    _currentLogId = logId;

    // Highlight active item
    _container.querySelectorAll('.sfdt-debuglog-item').forEach(el =>
      el.classList.toggle('active', el.dataset.id === logId)
    );

    const detailBody = _container.querySelector('#dl-detail-body');
    _container.querySelector('#dl-detail-toolbar').style.display = 'flex';
    detailBody.innerHTML = '<div class="sfdt-loading">Loading log body...</div>';

    try {
      _rawLog = await API().getDebugLogBody(logId);
      _parsedLog = _parseLog(_rawLog);
      _showTab('summary');
    } catch (err) {
      detailBody.innerHTML = `<div class="sfdt-error" style="padding:16px">Error loading log: ${_esc(err.message)}</div>`;
    }
  }

  // ─── Log Parser ───────────────────────────────────────

  function _parseLog(raw) {
    const lines = raw.split('\n');
    const parsed = {
      lines: [],
      methods: [],
      soqlQueries: [],
      dmlOps: [],
      limits: {},
      userDebugs: [],
      exceptions: [],
      callTree: [],
      totalTime: 0,
      soqlCount: 0,
      soqlRows: 0,
      dmlCount: 0,
      dmlRows: 0,
      heapSize: 0,
      cpuTime: 0
    };

    const methodStack = [];
    // Call tree tracking: CODE_UNIT_STARTED/FINISHED form the top-level tree
    const treeStack = [];
    let soqlIdx = 0;
    let dmlIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const entry = { num: i + 1, raw: line, type: 'info' };

      // Classify line type
      if (line.includes('|CODE_UNIT_STARTED|')) {
        entry.type = 'method';
        const ts = _extractTimestamp(line);
        const unitName = line.split('|').slice(3).join('|').trim();
        const node = { name: unitName, startLine: i + 1, startTs: ts, children: [], soql: [], dml: [], exceptions: [], durationMs: 0 };
        if (treeStack.length > 0) {
          treeStack[treeStack.length - 1].children.push(node);
        } else {
          parsed.callTree.push(node);
        }
        treeStack.push(node);
      } else if (line.includes('|CODE_UNIT_FINISHED|')) {
        entry.type = 'method';
        if (treeStack.length > 0) {
          const node = treeStack.pop();
          node.endLine = i + 1;
          const endTs = _extractTimestamp(line);
          node.durationMs = Math.round((endTs - node.startTs) / 1000000);
        }
      } else if (line.includes('|FATAL_ERROR|') || line.includes('|EXCEPTION_THROWN|')) {
        entry.type = 'error';
        const exMsg = line.split('|').slice(3).join('|').trim();
        if (exMsg) {
          const ex = { line: i + 1, message: exMsg };
          parsed.exceptions.push(ex);
          if (treeStack.length > 0) treeStack[treeStack.length - 1].exceptions.push(ex);
        }
      } else if (line.includes('|USER_DEBUG|')) {
        entry.type = 'user_debug';
        const parts = line.split('|');
        const debugLevel = parts[3] || '';
        const debugMsg = parts.slice(4).join('|').trim();
        parsed.userDebugs.push({ line: i + 1, level: debugLevel, message: debugMsg });
        if (debugLevel === 'ERROR') entry.type = 'error';
        else if (debugLevel === 'WARN') entry.type = 'warn';
      } else if (line.includes('|METHOD_ENTRY|') || line.includes('|CONSTRUCTOR_ENTRY|') || line.includes('|SYSTEM_METHOD_ENTRY|')) {
        entry.type = 'method';
        const ts = _extractTimestamp(line);
        const methodName = _extractMethodName(line);
        methodStack.push({ name: methodName, startLine: i + 1, startTs: ts });
      } else if (line.includes('|METHOD_EXIT|') || line.includes('|CONSTRUCTOR_EXIT|') || line.includes('|SYSTEM_METHOD_EXIT|')) {
        entry.type = 'method';
        if (methodStack.length > 0) {
          const method = methodStack.pop();
          const endTs = _extractTimestamp(line);
          const duration = endTs - method.startTs;
          if (duration >= 0 && method.name && !method.name.startsWith('System.')) {
            parsed.methods.push({
              name: method.name,
              startLine: method.startLine,
              endLine: i + 1,
              duration: duration,
              durationMs: Math.round(duration / 1000000)
            });
          }
        }
      } else if (line.includes('|SOQL_EXECUTE_BEGIN|')) {
        entry.type = 'soql';
        const soqlMatch = line.match(/\|SOQL_EXECUTE_BEGIN\|[^|]*\|(.*)/);
        const parentUnit = treeStack.length > 0 ? treeStack[treeStack.length - 1].name : '';
        const q = { line: i + 1, query: soqlMatch ? soqlMatch[1].trim() : '', rows: 0, duration: 0, parentUnit };
        parsed.soqlQueries.push(q);
        if (treeStack.length > 0) treeStack[treeStack.length - 1].soql.push(q);
        parsed.soqlCount++;
      } else if (line.includes('|SOQL_EXECUTE_END|')) {
        entry.type = 'soql';
        const rowMatch = line.match(/Rows:(\d+)/);
        if (rowMatch && parsed.soqlQueries.length > 0) {
          const lastQ = parsed.soqlQueries[parsed.soqlQueries.length - 1];
          lastQ.rows = parseInt(rowMatch[1], 10);
          parsed.soqlRows += lastQ.rows;
        }
      } else if (line.includes('|DML_BEGIN|')) {
        entry.type = 'dml';
        const dmlMatch = line.match(/\|DML_BEGIN\|[^|]*\|Op:(\w+)\|Type:(\w+)\|Rows:(\d+)/);
        const parentUnit = treeStack.length > 0 ? treeStack[treeStack.length - 1].name : '';
        const d = {
          line: i + 1,
          operation: dmlMatch ? dmlMatch[1] : '',
          type: dmlMatch ? dmlMatch[2] : '',
          rows: dmlMatch ? parseInt(dmlMatch[3], 10) : 0,
          parentUnit
        };
        parsed.dmlOps.push(d);
        if (treeStack.length > 0) treeStack[treeStack.length - 1].dml.push(d);
        parsed.dmlCount++;
        if (dmlMatch) parsed.dmlRows += parseInt(dmlMatch[3], 10);
      } else if (line.includes('|DML_END|')) {
        entry.type = 'dml';
      } else if (line.includes('|LIMIT_USAGE|') || line.includes('|LIMIT_USAGE_FOR_NS|')) {
        entry.type = 'limit';
      } else if (line.includes('|HEAP_ALLOCATE|')) {
        const heapMatch = line.match(/Bytes:(\d+)/);
        if (heapMatch) parsed.heapSize = Math.max(parsed.heapSize, parseInt(heapMatch[1], 10));
      } else if (line.includes('WARN')) {
        entry.type = 'warn';
      }

      // Extract cumulative limits from log footer
      if (line.includes('Number of SOQL queries:')) {
        const m = line.match(/Number of SOQL queries:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) parsed.limits.soqlQueries = { used: parseInt(m[1]), max: parseInt(m[2]) };
      }
      if (line.includes('Number of DML statements:')) {
        const m = line.match(/Number of DML statements:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) parsed.limits.dmlStatements = { used: parseInt(m[1]), max: parseInt(m[2]) };
      }
      if (line.includes('Maximum CPU time:')) {
        const m = line.match(/Maximum CPU time:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) { parsed.limits.cpuTime = { used: parseInt(m[1]), max: parseInt(m[2]) }; parsed.cpuTime = parseInt(m[1]); }
      }
      if (line.includes('Maximum heap size:')) {
        const m = line.match(/Maximum heap size:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) parsed.limits.heapSize = { used: parseInt(m[1]), max: parseInt(m[2]) };
      }
      if (line.includes('Number of query rows:')) {
        const m = line.match(/Number of query rows:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) parsed.limits.queryRows = { used: parseInt(m[1]), max: parseInt(m[2]) };
      }
      if (line.includes('Number of callouts:')) {
        const m = line.match(/Number of callouts:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) parsed.limits.callouts = { used: parseInt(m[1]), max: parseInt(m[2]) };
      }
      if (line.includes('Number of future calls:')) {
        const m = line.match(/Number of future calls:\s*(\d+)\s*out of\s*(\d+)/);
        if (m) parsed.limits.futureCalls = { used: parseInt(m[1]), max: parseInt(m[2]) };
      }

      parsed.lines.push(entry);
    }

    // Sort methods by duration (slowest first)
    parsed.methods.sort((a, b) => b.duration - a.duration);

    // Compute self time for call tree nodes (totalTime - sum of children totalTime)
    function _computeSelfTime(nodes) {
      for (var ci = 0; ci < nodes.length; ci++) {
        var n = nodes[ci];
        _computeSelfTime(n.children);
        var childSum = 0;
        for (var cj = 0; cj < n.children.length; cj++) childSum += n.children[cj].durationMs;
        n.selfTimeMs = Math.max(0, n.durationMs - childSum);
        n.endTs = n.startTs + (n.durationMs * 1000000);
      }
    }
    _computeSelfTime(parsed.callTree);

    return parsed;
  }

  function _extractTimestamp(line) {
    const match = line.match(/^([\d:.]+)\s*\((\d+)\)/);
    return match ? parseInt(match[2], 10) : 0;
  }

  function _extractMethodName(line) {
    const parts = line.split('|');
    // Method name is usually the last meaningful part
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i].trim();
      if (p && p.length > 1 && !p.match(/^\[?\d+\]?$/) && !p.includes('METHOD_') && !p.includes('CONSTRUCTOR_') && !p.includes('SYSTEM_METHOD_')) {
        return p;
      }
    }
    return parts[parts.length - 1] || '';
  }

  // ─── Tab Views (6 tabs) ─────────────────────────────

  let _currentTab = 'summary';
  let _analysisSort = { col: 'selfTime', dir: 'desc' };
  let _dbSort = { col: 'rows', dir: 'desc' };

  function _showTab(tab) {
    _currentTab = tab;
    var tabs = ['summary', 'timeline', 'calltree', 'analysis', 'database', 'raw'];
    for (var t = 0; t < tabs.length; t++) {
      var b = _container.querySelector('#dl-tab-' + tabs[t]);
      if (b) b.classList.toggle('sfdt-dl-tab-active', tabs[t] === tab);
    }
    switch (tab) {
      case 'summary': _renderSummary(); break;
      case 'calltree': _renderCallTree(); break;
      case 'timeline': _renderFlameChart(); break;
      case 'analysis': _renderAnalysis(); break;
      case 'database': _renderDatabase(); break;
      case 'raw': _renderRaw(); break;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SUMMARY TAB
  // ═══════════════════════════════════════════════════════

  function _renderSummary() {
    if (!_parsedLog) return;
    var p = _parsedLog;
    var body = _container.querySelector('#dl-detail-body');

    var limitsHtml = Object.entries(p.limits).map(function(kv) {
      var key = kv[0], val = kv[1];
      var pct = Math.round((val.used / val.max) * 100);
      var color = pct > 80 ? '#f38ba8' : pct > 50 ? '#f9e2af' : '#a6e3a1';
      var label = key.replace(/([A-Z])/g, ' $1').replace(/^./, function(s) { return s.toUpperCase(); });
      return '<div class="sfdt-limit-row">'
        + '<span class="sfdt-limit-label">' + label + '</span>'
        + '<div class="sfdt-limit-bar"><div class="sfdt-limit-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
        + '<span class="sfdt-limit-pct" style="color:' + color + '">' + pct + '%</span>'
        + '<span class="sfdt-limit-val" style="color:' + color + '">' + val.used + '/' + val.max + '</span>'
        + '</div>';
    }).join('');

    // Top 10 slowest methods
    var methodsHtml = p.methods.slice(0, 10).map(function(m, i) {
      var maxDur = (p.methods[0] && p.methods[0].durationMs) || 1;
      var pct = Math.round((m.durationMs / maxDur) * 100);
      var color = m.durationMs > 1000 ? '#f38ba8' : m.durationMs > 200 ? '#f9e2af' : '#a6e3a1';
      return '<div class="sfdt-method-row">'
        + '<span class="sfdt-method-rank">#' + (i + 1) + '</span>'
        + '<div class="sfdt-method-info">'
        + '<span class="sfdt-method-name" title="' + _esc(m.name) + '">' + _esc(m.name.length > 55 ? m.name.substring(0, 52) + '...' : m.name) + '</span>'
        + '<div class="sfdt-method-bar"><div class="sfdt-method-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
        + '</div>'
        + '<span class="sfdt-method-duration" style="color:' + color + '">' + m.durationMs + 'ms</span>'
        + '<span class="sfdt-method-line">L' + m.startLine + '</span>'
        + '</div>';
    }).join('');

    var exceptionsHtml = p.exceptions.length > 0
      ? '<div class="sfdt-summary-section">'
        + '<div class="sfdt-section-title" style="color:#f38ba8">\u26A0 Exceptions (' + p.exceptions.length + ')</div>'
        + p.exceptions.map(function(ex) {
            return '<div class="sfdt-exception-row"><span class="sfdt-method-line">L' + ex.line + '</span> <span style="color:#f38ba8">' + _esc(ex.message.substring(0, 150)) + '</span></div>';
          }).join('')
        + '</div>' : '';

    var debugPreview = p.userDebugs.slice(0, 10).map(function(d) {
      var levelColor = d.level === 'ERROR' ? '#f38ba8' : d.level === 'WARN' ? '#f9e2af' : d.level === 'INFO' ? '#89b4fa' : '#a6adc8';
      return '<div class="sfdt-debug-row">'
        + '<span class="sfdt-debug-level" style="color:' + levelColor + '">' + d.level + '</span>'
        + '<span class="sfdt-debug-msg">' + _esc(d.message.length > 100 ? d.message.substring(0, 97) + '...' : d.message) + '</span>'
        + '<span class="sfdt-method-line">L' + d.line + '</span></div>';
    }).join('');

    body.innerHTML = '<div class="sfdt-summary-scroll">'
      + '<div class="sfdt-stats-grid">'
      + _statCard(p.cpuTime || '\u2014', 'ms', 'CPU Time', '#89b4fa')
      + _statCard(p.soqlCount, '', 'SOQL Queries', '#cba6f7')
      + _statCard(p.soqlRows, '', 'Query Rows', '#f9e2af')
      + _statCard(p.dmlCount, '', 'DML Ops', '#a6e3a1')
      + _statCard(p.dmlRows, '', 'DML Rows', '#fab387')
      + _statCard(_formatBytes(p.heapSize), '', 'Heap', '#94e2d5')
      + _statCard(p.methods.length, '', 'Methods', '#7f849c')
      + _statCard(p.exceptions.length, '', 'Errors', p.exceptions.length > 0 ? '#f38ba8' : '#7f849c')
      + '</div>'
      + exceptionsHtml
      + (Object.keys(p.limits).length > 0 ? '<div class="sfdt-summary-section"><div class="sfdt-section-title">\uD83D\uDCCF Governor Limits</div>' + limitsHtml + '</div>' : '')
      + (p.methods.length > 0 ? '<div class="sfdt-summary-section"><div class="sfdt-section-title">\u23F1 Slowest Methods (Top 10)</div>' + methodsHtml + '</div>' : '')
      + (p.userDebugs.length > 0 ? '<div class="sfdt-summary-section"><div class="sfdt-section-title">\uD83D\uDCDD Debug Statements (' + p.userDebugs.length + ')</div>' + debugPreview + (p.userDebugs.length > 10 ? '<div style="padding:6px 0;color:#585b70;font-size:10px">+' + (p.userDebugs.length - 10) + ' more \u2014 see Raw tab for all</div>' : '') + '</div>' : '')
      + '</div>';
  }

  function _statCard(value, unit, label, color) {
    return '<div class="sfdt-stat-card">'
      + '<div class="sfdt-stat-value" style="color:' + color + '">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>'
      + '<div class="sfdt-stat-label">' + label + '</div></div>';
  }

  // ═══════════════════════════════════════════════════════
  //  FLAME CHART TAB
  // ═══════════════════════════════════════════════════════

  function _renderFlameChart() {
    if (!_parsedLog) return;
    var body = _container.querySelector('#dl-detail-body');
    var p = _parsedLog;

    // Build flat span list from call tree with depth
    var spans = [];
    var globalMin = Infinity, globalMax = 0;

    function _collectSpans(nodes, depth) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.startTs > 0 && n.endTs > 0) {
          var startMs = n.startTs / 1000000;
          var endMs = n.endTs / 1000000;
          if (startMs < globalMin) globalMin = startMs;
          if (endMs > globalMax) globalMax = endMs;
          spans.push({
            name: _cleanCodeUnitName(n.name),
            fullName: n.name,
            startMs: startMs,
            endMs: endMs,
            durationMs: n.durationMs,
            selfTimeMs: n.selfTimeMs,
            depth: depth,
            type: _classifyNodeType(n.name),
            soqlCount: n.soql.length,
            dmlCount: n.dml.length,
            hasError: n.exceptions.length > 0,
            startLine: n.startLine
          });
        }
        _collectSpans(n.children, depth + 1);
      }
    }
    _collectSpans(p.callTree, 0);

    if (spans.length === 0) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#7f849c">No execution spans found. Set log level to FINEST for detailed flame chart.</div>';
      return;
    }

    var totalMs = globalMax - globalMin;
    if (totalMs <= 0) totalMs = 1;
    var maxDepth = 0;
    for (var si = 0; si < spans.length; si++) { if (spans[si].depth > maxDepth) maxDepth = spans[si].depth; }
    var rowH = 24;
    var chartH = (maxDepth + 1) * rowH + 40;

    // Render SVG-like flame chart using divs for performance
    var h = '<div class="sfdt-flame-wrap">';

    // Time axis
    h += '<div class="sfdt-flame-axis">';
    var divisions = Math.min(10, Math.ceil(totalMs / 100));
    if (divisions < 2) divisions = 2;
    for (var di = 0; di <= divisions; di++) {
      var t = (di / divisions) * totalMs;
      var xPct = (di / divisions) * 100;
      h += '<span class="sfdt-flame-tick" style="left:' + xPct + '%">' + _fmtMs(t) + '</span>';
    }
    h += '</div>';

    // Spans
    h += '<div class="sfdt-flame-chart" style="height:' + chartH + 'px;position:relative">';
    for (var fi = 0; fi < spans.length; fi++) {
      var sp = spans[fi];
      var left = ((sp.startMs - globalMin) / totalMs) * 100;
      var width = ((sp.endMs - sp.startMs) / totalMs) * 100;
      if (width < 0.05) width = 0.05;
      var top = sp.depth * rowH;
      var typeColor = _typeColor(sp.type);
      var tooltip = sp.name + '\\nTotal: ' + sp.durationMs + 'ms  Self: ' + (sp.selfTimeMs || 0) + 'ms'
        + (sp.soqlCount ? '\\nSOQL: ' + sp.soqlCount : '') + (sp.dmlCount ? '  DML: ' + sp.dmlCount : '')
        + '\\nLine: ' + sp.startLine;

      h += '<div class="sfdt-flame-bar' + (sp.hasError ? ' sfdt-flame-err' : '') + '" '
        + 'style="left:' + left + '%;width:' + width + '%;top:' + top + 'px;height:' + (rowH - 2) + 'px;background:' + typeColor + '50;border-left:2px solid ' + typeColor + '" '
        + 'title="' + _esc(tooltip) + '" data-logline="' + sp.startLine + '">'
        + '<span class="sfdt-flame-lbl">' + _esc(sp.name.length > 60 ? sp.name.substring(0, 57) + '...' : sp.name) + '</span>'
        + '<span class="sfdt-flame-dur">' + sp.durationMs + 'ms</span>'
        + '</div>';
    }
    h += '</div>';

    // Legend
    h += '<div class="sfdt-flame-legend">';
    var legends = [['Method', '#a6e3a1'], ['Trigger', '#89b4fa'], ['Flow', '#cba6f7'], ['SOQL', '#f9e2af'], ['DML', '#fab387'], ['Other', '#7f849c']];
    for (var li = 0; li < legends.length; li++) {
      h += '<span class="sfdt-flame-legend-item"><span class="sfdt-flame-legend-dot" style="background:' + legends[li][1] + '"></span>' + legends[li][0] + '</span>';
    }
    h += '</div>';

    h += '</div>';
    body.innerHTML = h;

    // Click → jump to raw
    body.querySelectorAll('.sfdt-flame-bar').forEach(function(el) {
      el.addEventListener('click', function() {
        var ln = parseInt(el.dataset.logline, 10);
        _showTab('raw');
        setTimeout(function() { _scrollToLogLine(ln); }, 100);
      });
    });
  }

  function _typeColor(type) {
    switch (type) {
      case 'method': return '#a6e3a1';
      case 'trigger': return '#89b4fa';
      case 'flow': return '#cba6f7';
      case 'soql': return '#f9e2af';
      case 'dml': return '#fab387';
      default: return '#7f849c';
    }
  }

  function _classifyNodeType(name) {
    if (!name) return 'other';
    var n = name.toLowerCase();
    if (n.includes('trigger')) return 'trigger';
    if (n.includes('flow')) return 'flow';
    if (n.includes('soql') || n.includes('query')) return 'soql';
    if (n.includes('dml')) return 'dml';
    return 'method';
  }

  function _fmtMs(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return Math.round(ms) + 'ms';
  }

  // ═══════════════════════════════════════════════════════
  //  CALL TREE TAB (with Self Time, Total Time, counts)
  // ═══════════════════════════════════════════════════════

  function _renderCallTree() {
    if (!_parsedLog) return;
    var body = _container.querySelector('#dl-detail-body');
    var tree = _parsedLog.callTree;

    if (tree.length === 0) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#7f849c">No code unit entries found in this log.<br><span style="font-size:11px;">Set log level to FINEST for triggers and classes.</span></div>';
      return;
    }

    // Table header
    var h = '<div class="sfdt-summary-scroll"><div class="sfdt-calltree">';
    h += '<div class="sfdt-ct-header">'
      + '<span class="sfdt-ct-col-name">Event</span>'
      + '<span class="sfdt-ct-col-total">Total</span>'
      + '<span class="sfdt-ct-col-self">Self</span>'
      + '<span class="sfdt-ct-col-badge">SOQL</span>'
      + '<span class="sfdt-ct-col-badge">DML</span>'
      + '<span class="sfdt-ct-col-badge">Rows</span>'
      + '<span class="sfdt-ct-col-line">Line</span>'
      + '</div>';
    for (var ti = 0; ti < tree.length; ti++) {
      h += _renderTreeNode(tree[ti], 0);
    }
    h += '</div></div>';
    body.innerHTML = h;

    // Toggle handlers
    body.querySelectorAll('.sfdt-tree-toggle').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var children = el.closest('.sfdt-tree-node').querySelector('.sfdt-tree-children');
        if (children) {
          var collapsed = children.style.display === 'none';
          children.style.display = collapsed ? '' : 'none';
          el.textContent = collapsed ? '\u25BC' : '\u25B6';
        }
      });
    });

    body.querySelectorAll('.sfdt-clickable-line').forEach(function(el) {
      el.addEventListener('click', function() {
        _showTab('raw');
        setTimeout(function() { _scrollToLogLine(parseInt(el.dataset.logline, 10)); }, 100);
      });
    });
  }

  function _renderTreeNode(node, depth) {
    var hasChildren = node.children.length > 0;
    var durColor = node.durationMs > 1000 ? '#f38ba8' : node.durationMs > 200 ? '#f9e2af' : '#a6e3a1';
    var selfColor = (node.selfTimeMs || 0) > 500 ? '#f38ba8' : (node.selfTimeMs || 0) > 100 ? '#f9e2af' : '#a6e3a1';
    var hasExceptions = node.exceptions.length > 0;
    var indent = depth * 16;
    var totalRows = 0;
    for (var si = 0; si < node.soql.length; si++) totalRows += node.soql[si].rows;
    for (var di = 0; di < node.dml.length; di++) totalRows += node.dml[di].rows;
    var cleanName = _cleanCodeUnitName(node.name);

    var h = '<div class="sfdt-tree-node" style="margin-left:' + indent + 'px">';
    h += '<div class="sfdt-ct-row sfdt-clickable-line" data-logline="' + node.startLine + '">';
    h += '<span class="sfdt-ct-col-name">';
    h += hasChildren ? '<span class="sfdt-tree-toggle">\u25BC</span>' : '<span class="sfdt-tree-spacer"></span>';
    h += '<span class="sfdt-tree-name' + (hasExceptions ? ' sfdt-tree-error' : '') + '" title="' + _esc(node.name) + '">' + _esc(cleanName) + '</span>';
    h += '</span>';
    h += '<span class="sfdt-ct-col-total" style="color:' + durColor + '">' + (node.durationMs > 0 ? node.durationMs + 'ms' : '') + '</span>';
    h += '<span class="sfdt-ct-col-self" style="color:' + selfColor + '">' + ((node.selfTimeMs || 0) > 0 ? node.selfTimeMs + 'ms' : '') + '</span>';
    h += '<span class="sfdt-ct-col-badge">' + (node.soql.length > 0 ? '<span class="sfdt-tree-badge sfdt-tree-badge-soql">' + node.soql.length + '</span>' : '') + '</span>';
    h += '<span class="sfdt-ct-col-badge">' + (node.dml.length > 0 ? '<span class="sfdt-tree-badge sfdt-tree-badge-dml">' + node.dml.length + '</span>' : '') + '</span>';
    h += '<span class="sfdt-ct-col-badge">' + (totalRows > 0 ? '<span style="color:#a6adc8;font-size:10px">' + totalRows + '</span>' : '') + '</span>';
    h += '<span class="sfdt-ct-col-line">L' + node.startLine + '</span>';
    h += '</div>';

    if (hasChildren) {
      h += '<div class="sfdt-tree-children">';
      for (var ci = 0; ci < node.children.length; ci++) {
        h += _renderTreeNode(node.children[ci], depth + 1);
      }
      h += '</div>';
    }

    // Inline SOQL/DML
    if (node.soql.length > 0 || node.dml.length > 0) {
      h += '<div class="sfdt-tree-ops-detail" style="margin-left:' + (indent + 24) + 'px">';
      for (var qi = 0; qi < node.soql.length; qi++) {
        var q = node.soql[qi];
        h += '<div class="sfdt-tree-op-row sfdt-clickable-line" data-logline="' + q.line + '">'
          + '<span class="sfdt-tree-op-icon" style="color:#cba6f7">Q</span>'
          + '<span class="sfdt-tree-op-text">' + _esc(q.query.length > 55 ? q.query.substring(0, 52) + '...' : q.query) + '</span>'
          + '<span style="color:#a6adc8;font-size:10px">' + q.rows + ' rows</span></div>';
      }
      for (var dli = 0; dli < node.dml.length; dli++) {
        var d = node.dml[dli];
        var opColor = d.operation === 'Delete' ? '#f38ba8' : d.operation === 'Update' ? '#f9e2af' : '#a6e3a1';
        h += '<div class="sfdt-tree-op-row sfdt-clickable-line" data-logline="' + d.line + '">'
          + '<span class="sfdt-tree-op-icon" style="color:' + opColor + '">D</span>'
          + '<span class="sfdt-tree-op-text">' + _esc(d.operation) + ' ' + _esc(d.type) + '</span>'
          + '<span style="color:#a6adc8;font-size:10px">' + d.rows + ' rows</span></div>';
      }
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  // ═══════════════════════════════════════════════════════
  //  ANALYSIS TAB (aggregated method metrics)
  // ═══════════════════════════════════════════════════════

  function _renderAnalysis() {
    if (!_parsedLog) return;
    var body = _container.querySelector('#dl-detail-body');
    var p = _parsedLog;

    // Aggregate methods by name
    var agg = {};
    for (var i = 0; i < p.methods.length; i++) {
      var m = p.methods[i];
      var key = m.name;
      if (!agg[key]) {
        agg[key] = { name: m.name, count: 0, totalMs: 0, selfMs: 0, type: _classifyNodeType(m.name), namespace: _extractNamespace(m.name) };
      }
      agg[key].count++;
      agg[key].totalMs += m.durationMs;
    }

    // Also aggregate from call tree nodes for self time
    var flatNodes = [];
    function _flattenNodes(nodes) {
      for (var j = 0; j < nodes.length; j++) {
        flatNodes.push(nodes[j]);
        _flattenNodes(nodes[j].children);
      }
    }
    _flattenNodes(p.callTree);
    for (var k = 0; k < flatNodes.length; k++) {
      var fn = flatNodes[k];
      var key2 = fn.name;
      if (!agg[key2]) {
        agg[key2] = { name: fn.name, count: 0, totalMs: 0, selfMs: 0, type: _classifyNodeType(fn.name), namespace: _extractNamespace(fn.name) };
      }
      agg[key2].selfMs += fn.selfTimeMs || 0;
      if (agg[key2].count === 0) { agg[key2].count = 1; agg[key2].totalMs = fn.durationMs; }
    }

    var rows = Object.values(agg);
    // Sort
    var col = _analysisSort.col, dir = _analysisSort.dir;
    rows.sort(function(a, b) {
      var va, vb;
      if (col === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
      if (col === 'count') { va = a.count; vb = b.count; }
      else if (col === 'totalTime') { va = a.totalMs; vb = b.totalMs; }
      else if (col === 'type') { va = a.type; vb = b.type; return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
      else { va = a.selfMs; vb = b.selfMs; }
      return dir === 'asc' ? va - vb : vb - va;
    });

    if (rows.length === 0) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#7f849c">No method calls found in this log.</div>';
      return;
    }

    var arrow = function(c) { return col === c ? (dir === 'asc' ? ' \u25B2' : ' \u25BC') : ''; };

    var h = '<div class="sfdt-summary-scroll">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
      + '<div class="sfdt-section-title" style="margin:0;border:0;padding:0">\uD83E\uDDE0 Method Analysis (' + rows.length + ' unique)</div>'
      + '<button class="sfdt-btn sfdt-btn-sm sfdt-analysis-export" id="dl-analysis-csv" title="Copy as CSV">\uD83D\uDCCB Copy CSV</button>'
      + '</div>';
    h += '<table class="sfdt-analysis-table">';
    h += '<thead><tr>'
      + '<th class="sfdt-an-sort" data-col="name">Name' + arrow('name') + '</th>'
      + '<th class="sfdt-an-sort" data-col="type">Type' + arrow('type') + '</th>'
      + '<th class="sfdt-an-sort sfdt-an-num" data-col="count">Count' + arrow('count') + '</th>'
      + '<th class="sfdt-an-sort sfdt-an-num" data-col="totalTime">Total Time' + arrow('totalTime') + '</th>'
      + '<th class="sfdt-an-sort sfdt-an-num" data-col="selfTime">Self Time' + arrow('selfTime') + '</th>'
      + '</tr></thead><tbody>';

    for (var ri = 0; ri < Math.min(rows.length, 200); ri++) {
      var r = rows[ri];
      var selfColor = r.selfMs > 500 ? '#f38ba8' : r.selfMs > 100 ? '#f9e2af' : '#a6e3a1';
      var totalColor = r.totalMs > 1000 ? '#f38ba8' : r.totalMs > 200 ? '#f9e2af' : '#a6e3a1';
      h += '<tr>'
        + '<td class="sfdt-an-name" title="' + _esc(r.name) + '">' + _esc(r.name.length > 55 ? r.name.substring(0, 52) + '...' : r.name) + '</td>'
        + '<td><span class="sfdt-an-type sfdt-an-type-' + r.type + '">' + r.type + '</span></td>'
        + '<td class="sfdt-an-num">' + r.count + '</td>'
        + '<td class="sfdt-an-num" style="color:' + totalColor + '">' + r.totalMs + 'ms</td>'
        + '<td class="sfdt-an-num" style="color:' + selfColor + '">' + r.selfMs + 'ms</td>'
        + '</tr>';
    }
    h += '</tbody></table></div>';
    body.innerHTML = h;

    // Sort handlers
    body.querySelectorAll('.sfdt-an-sort').forEach(function(th) {
      th.addEventListener('click', function() {
        var c = th.dataset.col;
        if (_analysisSort.col === c) _analysisSort.dir = _analysisSort.dir === 'asc' ? 'desc' : 'asc';
        else { _analysisSort.col = c; _analysisSort.dir = 'desc'; }
        _renderAnalysis();
      });
    });

    // CSV export
    var csvBtn = body.querySelector('#dl-analysis-csv');
    if (csvBtn) csvBtn.addEventListener('click', function() {
      var csv = 'Name,Type,Count,Total Time (ms),Self Time (ms)\n';
      for (var xi = 0; xi < rows.length; xi++) {
        csv += '"' + rows[xi].name.replace(/"/g, '""') + '",' + rows[xi].type + ',' + rows[xi].count + ',' + rows[xi].totalMs + ',' + rows[xi].selfMs + '\n';
      }
      _copy(csv);
      csvBtn.textContent = '\u2713 Copied!';
      setTimeout(function() { csvBtn.textContent = '\uD83D\uDCCB Copy CSV'; }, 1500);
    });
  }

  function _extractNamespace(name) {
    if (!name) return 'default';
    var m = name.match(/^([a-zA-Z_]\w+)\./);
    return m ? m[1] : 'default';
  }

  // ═══════════════════════════════════════════════════════
  //  DATABASE TAB (SOQL + DML insights)
  // ═══════════════════════════════════════════════════════

  function _renderDatabase() {
    if (!_parsedLog) return;
    var body = _container.querySelector('#dl-detail-body');
    var p = _parsedLog;

    // Group SOQL by query text
    var soqlGroups = {};
    for (var si = 0; si < p.soqlQueries.length; si++) {
      var q = p.soqlQueries[si];
      var qKey = q.query.trim();
      if (!soqlGroups[qKey]) soqlGroups[qKey] = { query: q.query, count: 0, totalRows: 0, calls: [] };
      soqlGroups[qKey].count++;
      soqlGroups[qKey].totalRows += q.rows;
      soqlGroups[qKey].calls.push(q);
    }
    var soqlList = Object.values(soqlGroups).sort(function(a, b) { return b.totalRows - a.totalRows; });

    // Group DML by operation+type
    var dmlGroups = {};
    for (var di = 0; di < p.dmlOps.length; di++) {
      var d = p.dmlOps[di];
      var dKey = d.operation + ' ' + d.type;
      if (!dmlGroups[dKey]) dmlGroups[dKey] = { key: dKey, operation: d.operation, type: d.type, count: 0, totalRows: 0, calls: [] };
      dmlGroups[dKey].count++;
      dmlGroups[dKey].totalRows += d.rows;
      dmlGroups[dKey].calls.push(d);
    }
    var dmlList = Object.values(dmlGroups).sort(function(a, b) { return b.totalRows - a.totalRows; });

    var h = '<div class="sfdt-summary-scroll">';

    // SOQL Section
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
      + '<div class="sfdt-section-title" style="margin:0;border:0;padding:0">\uD83D\uDD0D SOQL Queries (' + p.soqlQueries.length + ' total, ' + soqlList.length + ' unique)</div>'
      + '<button class="sfdt-btn sfdt-btn-sm" id="dl-db-soql-csv" title="Copy SOQL as CSV">\uD83D\uDCCB CSV</button>'
      + '</div>';

    if (soqlList.length > 0) {
      h += '<table class="sfdt-analysis-table sfdt-db-table">';
      h += '<thead><tr><th>Query</th><th class="sfdt-an-num">Count</th><th class="sfdt-an-num">Total Rows</th><th>Source</th><th class="sfdt-an-num">Line</th></tr></thead><tbody>';
      for (var sqi = 0; sqi < soqlList.length; sqi++) {
        var sg = soqlList[sqi];
        var firstCall = sg.calls[0];
        h += '<tr class="sfdt-db-row-clickable" data-logline="' + firstCall.line + '">'
          + '<td class="sfdt-db-query-cell" title="' + _esc(sg.query) + '"><code>' + _esc(sg.query.length > 70 ? sg.query.substring(0, 67) + '...' : sg.query) + '</code></td>'
          + '<td class="sfdt-an-num">' + sg.count + '</td>'
          + '<td class="sfdt-an-num" style="color:#f9e2af">' + sg.totalRows + '</td>'
          + '<td class="sfdt-parent-unit" title="' + _esc(firstCall.parentUnit) + '">' + _esc(firstCall.parentUnit ? (firstCall.parentUnit.length > 25 ? firstCall.parentUnit.substring(0, 22) + '...' : firstCall.parentUnit) : '') + '</td>'
          + '<td class="sfdt-an-num">L' + firstCall.line + '</td>'
          + '</tr>';
        // Show individual calls if more than 1
        if (sg.count > 1) {
          for (var sci = 0; sci < Math.min(sg.calls.length, 5); sci++) {
            var sc = sg.calls[sci];
            h += '<tr class="sfdt-db-sub-row sfdt-db-row-clickable" data-logline="' + sc.line + '">'
              + '<td style="padding-left:28px;color:#585b70;font-size:10px">\u2514 call ' + (sci + 1) + '</td>'
              + '<td></td>'
              + '<td class="sfdt-an-num" style="font-size:10px">' + sc.rows + '</td>'
              + '<td class="sfdt-parent-unit" style="font-size:9px">' + _esc(sc.parentUnit ? (sc.parentUnit.length > 20 ? sc.parentUnit.substring(0, 17) + '...' : sc.parentUnit) : '') + '</td>'
              + '<td class="sfdt-an-num" style="font-size:10px">L' + sc.line + '</td>'
              + '</tr>';
          }
          if (sg.calls.length > 5) {
            h += '<tr class="sfdt-db-sub-row"><td style="padding-left:28px;color:#585b70;font-size:10px" colspan="5">+' + (sg.calls.length - 5) + ' more calls</td></tr>';
          }
        }
      }
      h += '</tbody></table>';
    } else {
      h += '<div style="padding:12px;color:#7f849c;font-size:12px">No SOQL queries in this log.</div>';
    }

    // DML Section
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 10px">'
      + '<div class="sfdt-section-title" style="margin:0;border:0;padding:0">\uD83D\uDCDD DML Operations (' + p.dmlOps.length + ' total, ' + dmlList.length + ' unique)</div>'
      + '<button class="sfdt-btn sfdt-btn-sm" id="dl-db-dml-csv" title="Copy DML as CSV">\uD83D\uDCCB CSV</button>'
      + '</div>';

    if (dmlList.length > 0) {
      h += '<table class="sfdt-analysis-table sfdt-db-table">';
      h += '<thead><tr><th>Operation</th><th>Object</th><th class="sfdt-an-num">Count</th><th class="sfdt-an-num">Total Rows</th><th>Source</th><th class="sfdt-an-num">Line</th></tr></thead><tbody>';
      for (var dgi = 0; dgi < dmlList.length; dgi++) {
        var dg = dmlList[dgi];
        var fc = dg.calls[0];
        var opColor = dg.operation === 'Delete' ? '#f38ba8' : dg.operation === 'Update' ? '#f9e2af' : '#a6e3a1';
        h += '<tr class="sfdt-db-row-clickable" data-logline="' + fc.line + '">'
          + '<td style="color:' + opColor + ';font-weight:600">' + _esc(dg.operation) + '</td>'
          + '<td>' + _esc(dg.type) + '</td>'
          + '<td class="sfdt-an-num">' + dg.count + '</td>'
          + '<td class="sfdt-an-num" style="color:#fab387">' + dg.totalRows + '</td>'
          + '<td class="sfdt-parent-unit" title="' + _esc(fc.parentUnit) + '">' + _esc(fc.parentUnit ? (fc.parentUnit.length > 25 ? fc.parentUnit.substring(0, 22) + '...' : fc.parentUnit) : '') + '</td>'
          + '<td class="sfdt-an-num">L' + fc.line + '</td>'
          + '</tr>';
      }
      h += '</tbody></table>';
    } else {
      h += '<div style="padding:12px;color:#7f849c;font-size:12px">No DML operations in this log.</div>';
    }

    h += '</div>';
    body.innerHTML = h;

    // Click to jump to raw
    body.querySelectorAll('.sfdt-db-row-clickable').forEach(function(el) {
      el.addEventListener('click', function() {
        _showTab('raw');
        setTimeout(function() { _scrollToLogLine(parseInt(el.dataset.logline, 10)); }, 100);
      });
    });

    // CSV exports
    var soqlCsvBtn = body.querySelector('#dl-db-soql-csv');
    if (soqlCsvBtn) soqlCsvBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var csv = 'Query,Count,Total Rows,Source,Line\n';
      for (var xi = 0; xi < soqlList.length; xi++) {
        var sg2 = soqlList[xi];
        csv += '"' + sg2.query.replace(/"/g, '""') + '",' + sg2.count + ',' + sg2.totalRows + ',"' + (sg2.calls[0].parentUnit || '') + '",' + sg2.calls[0].line + '\n';
      }
      _copy(csv);
      soqlCsvBtn.textContent = '\u2713 Copied!';
      setTimeout(function() { soqlCsvBtn.textContent = '\uD83D\uDCCB CSV'; }, 1500);
    });

    var dmlCsvBtn = body.querySelector('#dl-db-dml-csv');
    if (dmlCsvBtn) dmlCsvBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var csv = 'Operation,Object,Count,Total Rows,Source,Line\n';
      for (var yi = 0; yi < dmlList.length; yi++) {
        var dg2 = dmlList[yi];
        csv += dg2.operation + ',' + dg2.type + ',' + dg2.count + ',' + dg2.totalRows + ',"' + (dg2.calls[0].parentUnit || '') + '",' + dg2.calls[0].line + '\n';
      }
      _copy(csv);
      dmlCsvBtn.textContent = '\u2713 Copied!';
      setTimeout(function() { dmlCsvBtn.textContent = '\uD83D\uDCCB CSV'; }, 1500);
    });
  }

  // ═══════════════════════════════════════════════════════
  //  RAW TAB
  // ═══════════════════════════════════════════════════════

  function _renderRaw() {
    if (!_rawLog) return;
    _renderFilteredLines();
  }

  function _renderFilteredLines() {
    if (!_parsedLog) return;
    var body = _container.querySelector('#dl-detail-body');
    var lines = _parsedLog.lines;

    if (_logFilter !== 'all') lines = lines.filter(function(l) { return l.type === _logFilter; });
    if (_searchTerm) {
      var q = _searchTerm.toLowerCase();
      lines = lines.filter(function(l) { return l.raw.toLowerCase().includes(q); });
    }

    var h = '<div class="sfdt-raw-log">';
    var max = Math.min(lines.length, 2000);
    for (var i = 0; i < max; i++) {
      var l = lines[i];
      var typeClass = 'sfdt-log-' + l.type;
      var text;
      if (_searchTerm && (l.type === 'error' || l.type === 'warn' || l.type === 'user_debug')) {
        text = l.raw.replace(new RegExp('(' + _searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark class="sfdt-highlight">$1</mark>');
      } else {
        text = _esc(l.raw);
      }
      h += '<div class="sfdt-log-line ' + typeClass + '"><span class="sfdt-log-num">' + l.num + '</span><span class="sfdt-log-text">' + text + '</span></div>';
    }
    if (lines.length > 2000) h += '<div style="padding:8px 16px;color:#7f849c">...' + (lines.length - 2000) + ' more lines</div>';
    h += '</div>';
    body.innerHTML = h;
  }

  function _applyFilters() { if (_currentTab === 'raw') _renderFilteredLines(); }

  function _scrollToLogLine(lineNum) {
    var rawContainer = _container.querySelector('.sfdt-raw-log');
    if (!rawContainer) return;
    var lineEl = rawContainer.querySelector('.sfdt-log-line:nth-child(' + Math.min(lineNum, 2000) + ')');
    if (lineEl) {
      lineEl.scrollIntoView({ block: 'center' });
      lineEl.style.background = 'rgba(137,180,250,0.2)';
      setTimeout(function() { lineEl.style.background = ''; }, 2000);
    }
  }

  // ─── Actions ──────────────────────────────────────────

  function _toggleAutoRefresh() {
    const btn = _container.querySelector('#dl-auto');
    if (_autoRefreshTimer) {
      clearInterval(_autoRefreshTimer);
      _autoRefreshTimer = null;
      btn.classList.remove('sfdt-btn-primary');
      btn.title = 'Auto-refresh every 5s';
    } else {
      _autoRefreshTimer = setInterval(_loadLogs, 5000);
      btn.classList.add('sfdt-btn-primary');
      btn.title = 'Auto-refresh ON (click to stop)';
      _loadLogs();
    }
  }

  async function _clearLogs() {
    if (!confirm('Delete all debug logs in this org?')) return;
    try {
      const result = await API().getDebugLogs(200);
      const logs = result.records || [];
      for (const log of logs) {
        await API().toolingGet(`/sobjects/ApexLog/${log.Id}`).catch(() => {});
        // Delete via REST
        const base = API().getInstanceUrl();
        await fetch(`${base}/services/data/${API().API_VERSION}/tooling/sobjects/ApexLog/${log.Id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${API().getSessionId()}` },
          credentials: 'include'
        }).catch(() => {});
      }
      _loadLogs();
    } catch (err) {
      console.warn('[SFDT] Clear logs error:', err.message);
    }
  }

  function _downloadLog() {
    if (!_rawLog) return;
    const blob = new Blob([_rawLog], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug_log_${_currentLogId || 'unknown'}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Helpers ──────────────────────────────────────────

  function _formatLogTime(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const now = new Date();
    const diff = now - d;
    const pad = n => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (diff < 60000) return `${time} (just now)`;
    if (diff < 3600000) return `${time} (${Math.floor(diff / 60000)}m ago)`;
    if (diff < 86400000) return `${time} (${Math.floor(diff / 3600000)}h ago)`;
    return `${d.toLocaleDateString()} ${time}`;
  }

  function _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0B';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1048576).toFixed(1) + 'MB';
  }

  function _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function _copy(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(function() {});
    }
  }

  function _cleanCodeUnitName(name) {
    return name
      .replace(/^[a-zA-Z0-9]{15,18}\s*/, '')
      .replace(/^(trigger|class)\s*/i, '')
      .trim() || name;
  }

  // ─── Lifecycle ────────────────────────────────────────

  function show() {
    _create();
    _panel.classList.add('visible');
    _visible = true;
    _loadLogs();
  }

  function hide() {
    if (_panel) _panel.classList.remove('visible');
    _visible = false;
    if (_autoRefreshTimer) {
      clearInterval(_autoRefreshTimer);
      _autoRefreshTimer = null;
    }
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }

  return { show, hide, toggle, isVisible };
})();

if (typeof window !== 'undefined') window.SFDTDebugLogPanel = DebugLogPanel;
