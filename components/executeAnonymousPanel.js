/**
 * ExecuteAnonymousPanel - Run anonymous Apex code with output viewer.
 * Supports saved snippets, execution history, and debug log parsing.
 */
const ExecuteAnonymousPanel = (() => {
  const API = () => window.SalesforceAPI;
  const SHADOW = () => window.SFDTShadowHelper;
  const ICONS = () => window.SFDTIcons;

  let _container = null;
  let _panel = null;
  let _visible = false;
  let _pinned = false;
  const STORAGE_KEY = 'sfdt_exec_snippets';
  const HISTORY_KEY = 'sfdt_exec_history';

  function _create() {
    if (_container) return;

    const { container } = SHADOW().getOrCreate('execanon');
    _container = container;
    const I = ICONS();

    _container.innerHTML = `
      <div class="sfdt-panel sfdt-panel-bottom sfdt-execanon-panel" id="sfdt-execanon">
        <div class="sfdt-panel-header">
          <div class="sfdt-panel-title">
            ${I.code}
            <span>Execute Anonymous Apex</span>
          </div>
          <div class="sfdt-panel-actions">
            <button class="sfdt-btn sfdt-btn-sm" id="ea-snippets-btn" title="Saved Snippets">${I.list} Snippets</button>
            <button class="sfdt-btn sfdt-btn-sm" id="ea-history-btn" title="Execution History">${I.clock} History</button>
            <button class="sfdt-btn sfdt-btn-sm" id="ea-resize" title="Toggle size">${I.maximize}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-pin-btn" id="ea-pin" title="Pin panel open">${I.pin}</button>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="ea-close">${I.x} Close</button>
          </div>
        </div>
        <div class="sfdt-execanon-layout">
          <!-- Code editor -->
          <div class="sfdt-execanon-editor-wrap">
            <div class="sfdt-execanon-editor-header">
              <span style="font-size:11px;color:#7f849c">Apex Code</span>
              <div style="display:flex;gap:4px">
                <button class="sfdt-btn sfdt-btn-sm" id="ea-save" title="Save as Snippet">${I.save} Save</button>
                <button class="sfdt-btn sfdt-btn-sm" id="ea-clear" title="Clear Code">${I.x} Clear</button>
              </div>
            </div>
            <textarea id="ea-code" style="padding: 0 10px !important;" class="sfdt-execanon-textarea" spellcheck="false" placeholder="// Enter Apex code here...&#10;System.debug('Hello World!');"
            ></textarea>
            <div class="sfdt-execanon-run-bar">
              <button class="sfdt-btn sfdt-btn-primary sfdt-btn-run" id="ea-run">${I.play} Execute (Ctrl+Enter)</button>
              <span id="ea-status" class="sfdt-execanon-status"></span>
            </div>
          </div>
          <!-- Results -->
          <div class="sfdt-execanon-results-wrap">
            <div class="sfdt-execanon-results-header">
              <span style="font-size:11px;color:#7f849c">Results</span>
              <div style="display:flex;gap:4px">

                <button class="sfdt-btn sfdt-btn-sm" id="ea-tab-debugs" title="Open Debug Logs in Salesforce Setup">🔗 Debug Logs</button>
              </div>
            </div>
            <div class="sfdt-execanon-results-body" id="ea-results">
              <div style="padding:24px;text-align:center;color:#7f849c;font-size:12px">
                <div style="margin-bottom:8px">Write Apex code and click Execute or press <kbd>Ctrl+Enter</kbd></div>
                <div style="font-size:11px;color:#585b70">Results, debug statements, and errors will appear here</div>
              </div>
            </div>
          </div>
        </div>
        <!-- Snippets dropdown -->
        <div class="sfdt-dropdown-panel" id="ea-snippets-panel" style="display:none">
          <div class="sfdt-dropdown-header">
            <span style="font-weight:600;font-size:12px;color:#89b4fa">Saved Snippets</span>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="ea-snippets-close">${I.x}</button>
          </div>
          <div class="sfdt-dropdown-body" id="ea-snippets-list"></div>
        </div>
        <!-- History dropdown -->
        <div class="sfdt-dropdown-panel" id="ea-history-panel" style="display:none">
          <div class="sfdt-dropdown-header">
            <span style="font-weight:600;font-size:12px;color:#89b4fa">Recent Executions</span>
            <button class="sfdt-btn sfdt-btn-sm sfdt-btn-close" id="ea-history-close">${I.x}</button>
          </div>
          <div class="sfdt-dropdown-body" id="ea-history-list"></div>
        </div>
      </div>
    `;

    _panel = _container.querySelector('#sfdt-execanon');
    const codeEl = _container.querySelector('#ea-code');

    _container.querySelector('#ea-close').addEventListener('click', hide);
    _container.querySelector('#ea-pin').addEventListener('click', _togglePin);
    _container.querySelector('#ea-run').addEventListener('click', _execute);
    _container.querySelector('#ea-clear').addEventListener('click', () => { codeEl.value = ''; codeEl.focus(); });
    _container.querySelector('#ea-save').addEventListener('click', _saveSnippet);
    _container.querySelector('#ea-tab-debugs').addEventListener('click', _openDebugLogsPage);
    _container.querySelector('#ea-resize').addEventListener('click', function() {
      _panel.classList.toggle('expanded');
      const I = ICONS();
      this.innerHTML = _panel.classList.contains('expanded') ? I.minimize : I.maximize;
      this.title = _panel.classList.contains('expanded') ? 'Restore Size' : 'Expand';
    });

    // Initialize drag-to-resize
    SHADOW().initPanelResize(_panel, 'top', 'sfdt_execanon_height');

    _container.querySelector('#ea-snippets-btn').addEventListener('click', () => _toggleDropdown('snippets'));
    _container.querySelector('#ea-history-btn').addEventListener('click', () => _toggleDropdown('history'));
    _container.querySelector('#ea-snippets-close').addEventListener('click', () => _closeDropdown('snippets'));
    _container.querySelector('#ea-history-close').addEventListener('click', () => _closeDropdown('history'));

    // Ctrl+Enter to execute
    codeEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        _execute();
      }
      // Tab key inserts spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = codeEl.selectionStart;
        const end = codeEl.selectionEnd;
        codeEl.value = codeEl.value.substring(0, start) + '    ' + codeEl.value.substring(end);
        codeEl.selectionStart = codeEl.selectionEnd = start + 4;
      }
    });
  }

  // ─── Execute ──────────────────────────────────────────

  let _lastOutput = '';
  let _cachedUserId = null;
  let _cachedDebugLevelId = null;

  /**
   * Get the current user's ID (cached after first call).
   */
  async function _getUserId() {
    if (_cachedUserId) return _cachedUserId;
    const user = await API().getCurrentUser();
    _cachedUserId = user.id || user.Id;
    return _cachedUserId;
  }

  /**
   * Ensure a DebugLevel record exists for SFDT executions.
   * Reuses an existing one if found, otherwise creates a new one.
   */
  async function _ensureDebugLevel() {
    if (_cachedDebugLevelId) return _cachedDebugLevelId;

    // Check if our debug level already exists
    try {
      const existing = await API().toolingQuery(
        "SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDT_Execute' LIMIT 1"
      );
      if (existing.records && existing.records.length > 0) {
        _cachedDebugLevelId = existing.records[0].Id;
        return _cachedDebugLevelId;
      }
    } catch { /* not found, create it */ }

    // Create a new debug level with full visibility
    const result = await API().toolingPost('DebugLevel', {
      DeveloperName: 'SFDT_Execute',
      MasterLabel: 'SFDT Execute Anonymous',
      ApexCode: 'FINEST',
      ApexProfiling: 'INFO',
      Callout: 'INFO',
      Database: 'INFO',
      System: 'DEBUG',
      Validation: 'INFO',
      Visualforce: 'INFO',
      Workflow: 'INFO',
      Nba: 'INFO',
      Wave: 'INFO'
    });
    _cachedDebugLevelId = result.id || result.Id;
    return _cachedDebugLevelId;
  }

  /**
   * Create a temporary TraceFlag for the current user so Salesforce generates a debug log.
   * Returns the TraceFlag ID for cleanup.
   */
  async function _ensureTraceFlag(userId, debugLevelId) {
    const now = new Date().toISOString();
    const expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Check if there's already an active trace flag for this user
    try {
      const existing = await API().toolingQuery(
        `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'DEVELOPER_LOG' AND ExpirationDate > ${now} LIMIT 1`
      );
      if (existing.records && existing.records.length > 0) {
        return existing.records[0].Id;
      }
    } catch { /* query failed, try creating */ }

    // Try to create a new trace flag
    try {
      const result = await API().toolingPost('TraceFlag', {
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: 'DEVELOPER_LOG',
        ExpirationDate: expiration
      });
      return result.id || result.Id;
    } catch (err) {
      // If one already exists with overlapping dates, that's fine — we'll get logs anyway
      if (err.message && err.message.includes('already being traced')) {
        window._sfdtLogger.debug('[SFDT] Trace flag already exists, continuing');
        return 'existing';
      }
      // For other errors, log but don't block execution
      window._sfdtLogger.debug('[SFDT] Trace flag creation failed:', err.message);
      return null;
    }
  }

  async function _execute() {
    const codeEl = _container.querySelector('#ea-code');
    const code = codeEl.value.trim();
    if (!code) return;

    const statusEl = _container.querySelector('#ea-status');
    const runBtn = _container.querySelector('#ea-run');
    const resultsBody = _container.querySelector('#ea-results');

    runBtn.disabled = true;
    statusEl.textContent = 'Setting up trace flag...';
    statusEl.className = 'sfdt-execanon-status running';
    resultsBody.innerHTML = '<div class="sfdt-loading">Setting up trace flag...</div>';

    try {
      // Step 1: Ensure trace flag exists so Salesforce generates a debug log
      const userId = await _getUserId();
      const debugLevelId = await _ensureDebugLevel();
      await _ensureTraceFlag(userId, debugLevelId);

      // Step 2: Execute the anonymous Apex
      statusEl.textContent = 'Executing Apex...';
      resultsBody.innerHTML = '<div class="sfdt-loading">Executing Apex...</div>';

      const result = await API().executeAnonymous(code);

      const success = result.success === true || result.success === 'true';
      const compiled = result.compiled === true || result.compiled === 'true';
      const compileProblem = result.compileProblem || '';
      const exceptionMessage = result.exceptionMessage || '';
      const exceptionStackTrace = result.exceptionStackTrace || '';
      const line = result.line || '';
      const column = result.column || '';

      // Save to history
      _addToHistory(code, success);

      if (!compiled) {
        statusEl.textContent = 'Compile Error';
        statusEl.className = 'sfdt-execanon-status error';
        _lastOutput = `<div class="sfdt-exec-error">
          <div class="sfdt-exec-error-title">❌ Compile Error</div>
          <div class="sfdt-exec-error-msg">${_esc(compileProblem)}</div>
          ${line ? `<div class="sfdt-exec-error-loc">Line ${line}${column ? ', Column ' + column : ''}</div>` : ''}
        </div>`;
      } else if (!success) {
        statusEl.textContent = 'Runtime Error';
        statusEl.className = 'sfdt-execanon-status error';
        _lastOutput = `<div class="sfdt-exec-error">
          <div class="sfdt-exec-error-title">❌ Runtime Exception</div>
          <div class="sfdt-exec-error-msg">${_esc(exceptionMessage)}</div>
          ${exceptionStackTrace ? `<pre class="sfdt-exec-stacktrace">${_esc(exceptionStackTrace)}</pre>` : ''}
        </div>`;
      } else {
        statusEl.textContent = 'Fetching debug log...';
        _lastOutput = `<div class="sfdt-exec-success">
          <div class="sfdt-exec-success-title">✓ Executed Successfully</div>
        </div>`;
      }

      // Step 3: Fetch the debug log generated by this execution
      statusEl.textContent = compiled ? (success ? 'Fetching debug log...' : statusEl.textContent) : statusEl.textContent;
      try {
        // Wait for Salesforce to write the log
        await new Promise(r => setTimeout(r, 2000));
        const logsResult = await API().getDebugLogs(1);
        const logs = logsResult.records || [];
        if (logs.length > 0) {
          const logBody = await API().getDebugLogBody(logs[0].Id);
          // Parse USER_DEBUG statements from the log
          const debugLines = logBody.split('\n')
            .filter(l => l.includes('|USER_DEBUG|'))
            .map(l => {
              const parts = l.split('|');
              const level = parts[3] || 'DEBUG';
              const msg = parts.slice(4).join('|').trim();
              return { level, msg };
            });

          if (debugLines.length > 0) {
            _lastOutput += `<div class="sfdt-exec-debugs">
              <div class="sfdt-section-title" style="margin-top:12px">Debug Output (${debugLines.length} statements)</div>
              ${debugLines.map(d => {
                const c = d.level === 'ERROR' ? '#f38ba8' : d.level === 'WARN' ? '#f9e2af' : d.level === 'INFO' ? '#89b4fa' : '#cdd6f4';
                return `<div class="sfdt-exec-debug-line"><span class="sfdt-debug-level" style="color:${c}">${d.level}</span><span>${_esc(d.msg)}</span></div>`;
              }).join('')}
            </div>`;
          }

          if (success) {
            statusEl.textContent = `Success ✓ — ${debugLines.length} debug statement${debugLines.length !== 1 ? 's' : ''}`;
            statusEl.className = 'sfdt-execanon-status success';
          }
        } else {
          if (success) {
            statusEl.textContent = 'Success ✓ — no debug log generated';
            statusEl.className = 'sfdt-execanon-status success';
          }
        }
      } catch (logErr) {
        window._sfdtLogger.debug('[SFDT] Debug log fetch error:', logErr.message);
        if (success) {
          statusEl.textContent = 'Success ✓ — could not fetch debug log';
          statusEl.className = 'sfdt-execanon-status success';
        }
      }

      _setResultTab('output');

    } catch (err) {
      statusEl.textContent = 'Error';
      statusEl.className = 'sfdt-execanon-status error';
      _lastOutput = `<div class="sfdt-exec-error">
        <div class="sfdt-exec-error-title">❌ API Error</div>
        <div class="sfdt-exec-error-msg">${_esc(err.message)}</div>
      </div>`;
      _setResultTab('output');
    } finally {
      runBtn.disabled = false;
    }
  }

  function _openDebugLogsPage() {
    const base = API().getInstanceUrl();
    const url = `${base}/setup/ui/listApexTraces.apexp?retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DMonitoring&setupid=ApexDebugLogs`;
    window.open(url, '_blank');
  }

  function _setResultTab(tab) {
    const resultsBody = _container.querySelector('#ea-results');
    resultsBody.innerHTML = _lastOutput || '<div style="padding:16px;color:#7f849c;font-size:12px">No output yet.</div>';
  }

  // ─── Snippets ─────────────────────────────────────────

  function _getSnippets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }

  function _saveSnippet() {
    const code = _container.querySelector('#ea-code').value.trim();
    if (!code) return;
    const name = prompt('Snippet name:');
    if (!name) return;

    const snippets = _getSnippets();
    snippets.unshift({ name, code, created: Date.now() });
    // Keep max 50 snippets
    if (snippets.length > 50) snippets.length = 50;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    _renderSnippets();
  }

  function _renderSnippets() {
    const list = _container.querySelector('#ea-snippets-list');
    const snippets = _getSnippets();

    if (snippets.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:#7f849c;font-size:12px">No saved snippets yet.<br>Write code and click Save.</div>';
      return;
    }

    list.innerHTML = snippets.map((s, i) => `
      <div class="sfdt-snippet-item">
        <div class="sfdt-snippet-info" data-idx="${i}">
          <span class="sfdt-snippet-name">${_esc(s.name)}</span>
          <span class="sfdt-snippet-preview">${_esc(s.code.substring(0, 60).replace(/\n/g, ' '))}</span>
        </div>
        <button class="sfdt-btn sfdt-btn-sm sfdt-btn-danger sfdt-snippet-del" data-idx="${i}" title="Delete">×</button>
      </div>
    `).join('');

    list.querySelectorAll('.sfdt-snippet-info').forEach(el => {
      el.addEventListener('click', () => {
        const snippet = snippets[parseInt(el.dataset.idx)];
        _container.querySelector('#ea-code').value = snippet.code;
        _closeDropdown('snippets');
      });
    });

    list.querySelectorAll('.sfdt-snippet-del').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        snippets.splice(parseInt(el.dataset.idx), 1);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
        _renderSnippets();
      });
    });
  }

  // ─── History ──────────────────────────────────────────

  function _addToHistory(code, success) {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      history.unshift({ code, success, timestamp: Date.now() });
      if (history.length > 30) history.length = 30;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch { }
  }

  function _renderHistory() {
    const list = _container.querySelector('#ea-history-list');
    let history;
    try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }

    if (history.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:#7f849c;font-size:12px">No execution history yet.</div>';
      return;
    }

    list.innerHTML = history.map((h, i) => {
      const time = new Date(h.timestamp);
      const timeStr = time.toLocaleTimeString() + ' ' + time.toLocaleDateString();
      return `<div class="sfdt-snippet-item" data-idx="${i}">
        <div class="sfdt-snippet-info" data-idx="${i}">
          <span class="sfdt-snippet-name">${h.success ? '<span style="color:#a6e3a1">✓</span>' : '<span style="color:#f38ba8">✕</span>'} ${_esc(timeStr)}</span>
          <span class="sfdt-snippet-preview">${_esc(h.code.substring(0, 60).replace(/\n/g, ' '))}</span>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.sfdt-snippet-info').forEach(el => {
      el.addEventListener('click', () => {
        const entry = history[parseInt(el.dataset.idx)];
        _container.querySelector('#ea-code').value = entry.code;
        _closeDropdown('history');
      });
    });
  }

  // ─── Dropdown ─────────────────────────────────────────

  function _toggleDropdown(name) {
    const panel = _container.querySelector(`#ea-${name}-panel`);
    const isShown = panel.style.display !== 'none';

    // Close all dropdowns
    _container.querySelector('#ea-snippets-panel').style.display = 'none';
    _container.querySelector('#ea-history-panel').style.display = 'none';

    if (!isShown) {
      panel.style.display = 'flex';
      if (name === 'snippets') _renderSnippets();
      else _renderHistory();
    }
  }

  function _closeDropdown(name) {
    _container.querySelector(`#ea-${name}-panel`).style.display = 'none';
  }

  // ─── Helpers ──────────────────────────────────────────

  function _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Lifecycle ────────────────────────────────────────

  function show() {
    _create();
    _panel.classList.add('visible');
    _visible = true;
    requestAnimationFrame(() => {
      const code = _container.querySelector('#ea-code');
      if (code) { code.focus(); code.setSelectionRange(code.value.length, code.value.length); }
    });
  }

  function hide() {
    if (_panel) _panel.classList.remove('visible');
    _visible = false;
    // Close dropdowns
    if (_container) {
      _container.querySelector('#ea-snippets-panel').style.display = 'none';
      _container.querySelector('#ea-history-panel').style.display = 'none';
    }
  }

  function toggle() { _visible ? hide() : show(); }
  function isVisible() { return _visible; }
  function isPinned() { return _pinned; }

  function _togglePin() {
    _pinned = !_pinned;
    const btn = _container.querySelector('#ea-pin');
    if (btn) {
      btn.classList.toggle('sfdt-btn-active', _pinned);
      btn.title = _pinned ? 'Unpin panel' : 'Pin panel open';
    }
  }

  return { show, hide, toggle, isVisible, isPinned };
})();

if (typeof window !== 'undefined') window.SFDTExecuteAnonymousPanel = ExecuteAnonymousPanel;
