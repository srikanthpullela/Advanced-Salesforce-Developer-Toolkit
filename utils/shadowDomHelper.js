/**
 * ShadowDOMHelper - Creates isolated Shadow DOM containers for toolkit UI.
 * Prevents Salesforce CSS from interfering with our components.
 */
const SFDTShadowHelper = (() => {
  const _roots = {};

  /**
   * Create or get a Shadow DOM container with isolated styles.
   * @param {string} id - Unique container ID
   * @param {string} [position='body'] - Where to attach ('body' or a selector)
   * @returns {{ host: HTMLElement, shadow: ShadowRoot, container: HTMLElement }}
   */
  function getOrCreate(id) {
    if (_roots[id]) return _roots[id];

    const host = document.createElement('div');
    host.id = `sfdt-host-${id}`;
    host.style.cssText = 'all: initial !important; position: fixed !important; z-index: 2147483647 !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; overflow: visible !important; pointer-events: none !important;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject isolated styles
    const style = document.createElement('style');
    style.textContent = _getStyles();
    shadow.appendChild(style);

    // Main container inside shadow
    const container = document.createElement('div');
    container.id = `sfdt-${id}`;
    container.className = 'sfdt-root';
    shadow.appendChild(container);

    _roots[id] = { host, shadow, container };
    return _roots[id];
  }

  function remove(id) {
    if (_roots[id]) {
      _roots[id].host.remove();
      delete _roots[id];
    }
  }

  function _getStyles() {
    return `
/* Reset everything inside shadow DOM */
*, *::before, *::after {
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif !important;
  -webkit-font-smoothing: antialiased !important;
  line-height: normal !important;
}

button {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
  outline: none;
  padding: 0;
  margin: 0;
}

/* SVG sizing for all contexts */
svg {
  display: inline-block !important;
  vertical-align: middle !important;
  flex-shrink: 0 !important;
}

.sfdt-root {
  --bg: #0f1419;
  --bg2: #1a1f2e;
  --bg3: #141925;
  --bg-hover: #1c2333;
  --bg-selected: #1c2333;
  --fg: #e1e4e8;
  --fg2: #8b949e;
  --fg3: #6e7681;
  --accent: #58a6ff;
  --accent2: #58a6ff;
  --green: #22c55e;
  --red: #f85149;
  --yellow: #fbbf24;
  --orange: #d29922;
  --purple: #c084fc;
  --border: #2d333b;
  --border-light: #383e4a;
  --shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
  --radius: 16px;
  --radius-sm: 8px;
  --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  
  color: var(--fg);
  font-size: 13px;
  pointer-events: auto;
}

/* ─── Palette (Search + Navigator) ─── */

.sfdt-palette {
  position: fixed;
  top: 0; left: 0;
  width: 100vw; height: 100vh;
  display: none;
  align-items: flex-start;
  justify-content: center;
  pointer-events: auto;
}

.sfdt-palette.visible { display: flex; }

.sfdt-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
}

.sfdt-dialog {
  position: relative;
  margin-top: 8vh;
  width: 680px;
  max-width: 90vw;
  max-height: 75vh;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideDown 0.15s ease-out;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}

.sfdt-header {
  display: flex;
  align-items: center;
  padding: 12px 16px !important;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  gap: 10px;
}

.sfdt-header-icon {
  width: 20px; height: 20px;
  color: var(--accent);
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.sfdt-header-icon svg { width: 20px !important; height: 20px !important; color: var(--accent) !important; }

.sfdt-input {
  flex: 1;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  color: var(--fg) !important;
  font-size: 15px !important;
  padding: 4px 0 !important;
  min-width: 0;
}

.sfdt-input::placeholder { color: var(--fg3) !important; }

/* Search Button in header */
.sfdt-search-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px !important;
  background: var(--accent, #58a6ff) !important;
  border: none !important;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.sfdt-search-btn:hover {
  opacity: 0.8;
}
.sfdt-search-btn.disabled,
.sfdt-search-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}
.sfdt-search-btn svg {
  width: 14px !important;
  height: 14px !important;
  color: var(--bg, #0f1419) !important;
}
.sfdt-btn-label {
  font-size: 11px !important;
  font-weight: 600;
  color: var(--bg, #0f1419) !important;
  white-space: nowrap;
}
/* Deep Search button — distinct style */
.sfdt-deep-search-btn {
  background: transparent !important;
  border: 1.5px solid var(--accent, #58a6ff) !important;
  border-radius: 6px;
}
.sfdt-deep-search-btn svg {
  color: var(--accent, #58a6ff) !important;
}
.sfdt-deep-search-btn .sfdt-btn-label {
  color: var(--accent, #58a6ff) !important;
}
.sfdt-deep-search-btn:hover {
  background: rgba(88,166,255,0.15) !important;
  opacity: 1;
}

/* Auto Search toggle */
.sfdt-auto-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}
.sfdt-auto-toggle input[type="checkbox"] {
  display: none;
}
.sfdt-toggle-slider {
  position: relative;
  width: 34px;
  height: 18px;
  background: #383e4a;
  border-radius: 9px;
  transition: background 0.2s;
}
.sfdt-toggle-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #e1e4e8;
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}
.sfdt-auto-toggle input:checked + .sfdt-toggle-slider {
  background: var(--accent, #58a6ff);
}
.sfdt-auto-toggle input:checked + .sfdt-toggle-slider::after {
  transform: translateX(16px);
  background: var(--bg, #0f1419);
}
.sfdt-toggle-label {
  font-size: 11px !important;
  font-weight: 600;
  color: var(--fg, #e1e4e8);
  white-space: nowrap;
}
.sfdt-auto-toggle input:checked ~ .sfdt-toggle-label {
  color: var(--accent, #58a6ff);
}
.sfdt-search-btn.sfdt-auto-hidden {
  width: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  border: none !important;
  gap: 0 !important;
  transition: width 0.15s, opacity 0.15s, padding 0.15s;
}

/* Onboarding overlay */
.sfdt-onboarding-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.2s ease-out;
}
.sfdt-onboarding-card {
  background: var(--bg, #0f1419);
  border: 1px solid var(--border, #2d333b);
  border-radius: 12px;
  padding: 24px 28px !important;
  max-width: 560px;
  text-align: center;
}
.sfdt-onboarding-title {
  font-size: 16px !important;
  font-weight: 700;
  color: var(--fg, #e1e4e8);
  margin-bottom: 20px;
}
.sfdt-onboarding-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}
.sfdt-onboarding-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.sfdt-onboarding-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sfdt-onboarding-icon svg {
  width: 20px !important;
  height: 20px !important;
}
.sfdt-onboarding-search {
  background: var(--accent, #58a6ff);
}
.sfdt-onboarding-search svg {
  color: var(--bg, #0f1419) !important;
}
.sfdt-onboarding-deep {
  background: transparent;
  border: 2px solid var(--accent, #58a6ff);
}
.sfdt-onboarding-deep svg {
  color: var(--accent, #58a6ff) !important;
}
.sfdt-onboarding-label {
  font-size: 13px !important;
  font-weight: 700;
  color: var(--fg, #e1e4e8);
}
.sfdt-onboarding-desc {
  font-size: 11px !important;
  color: var(--fg3, #383e4a);
  line-height: 1.5;
}
.sfdt-onboarding-desc kbd {
  display: inline-block;
  padding: 1px 5px;
  background: var(--bg3, #2d333b);
  border: 1px solid var(--border, #2d333b);
  border-radius: 3px;
  font-size: 10px !important;
  color: var(--accent, #58a6ff);
}
.sfdt-onboarding-divider {
  width: 1px;
  align-self: stretch;
  background: var(--border, #2d333b);
  margin: 8px 0;
}
.sfdt-onboarding-dismiss {
  padding: 8px 28px !important;
  background: var(--accent, #58a6ff) !important;
  color: var(--bg, #0f1419) !important;
  border: none !important;
  border-radius: 8px;
  font-size: 13px !important;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.sfdt-onboarding-dismiss:hover {
  opacity: 0.85;
}

.sfdt-shortcut {
  font-size: 9px;
  color: var(--fg3);
  background: var(--bg3);
  padding: 2px 6px !important;
  border-radius: var(--radius-sm);
  font-family: var(--mono) !important;
  flex-shrink: 0;
}

/* ─── Filter Chips ─── */

.sfdt-filters {
  display: flex;
  gap: 4px;
  padding: 8px 16px !important;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.sfdt-filters::-webkit-scrollbar { display: none; }

.sfdt-chip {
  display: inline-flex !important;
  align-items: center !important;
  padding: 4px 10px !important;
  font-size: 11px !important;
  border-radius: 12px !important;
  border: 1px solid var(--border) !important;
  background: transparent !important;
  color: var(--fg2) !important;
  cursor: pointer !important;
  white-space: nowrap !important;
  outline: none !important;
  box-shadow: none !important;
  appearance: none !important;
  -webkit-appearance: none !important;
  text-decoration: none !important;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  flex-shrink: 0 !important;
}
.sfdt-chip:hover {
  border-color: var(--accent) !important;
  color: var(--accent) !important;
}
.sfdt-chip:focus {
  outline: none !important;
  box-shadow: none !important;
}
.sfdt-chip.active {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
  color: var(--bg) !important;
  font-weight: 600;
}

/* ─── Results ─── */

.sfdt-results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 !important;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.sfdt-results::-webkit-scrollbar { width: 6px; }
.sfdt-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.sfdt-result {
  display: flex;
  align-items: center;
  padding: 8px 16px !important;
  cursor: pointer;
  gap: 10px;
  transition: background 0.08s;
}
.sfdt-result:hover, .sfdt-result.selected { background: var(--bg-selected); }

.sfdt-result-icon {
  width: 20px; height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg2);
}
.sfdt-result-icon svg { width: 16px; height: 16px; }

.sfdt-result-content { flex: 1; min-width: 0; }

.sfdt-result-name {
  font-size: 13px !important;
  color: var(--fg) !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sfdt-result-sub {
  font-size: 11px !important;
  color: var(--fg3) !important;
  margin-top: 2px !important;
}

.sfdt-result-type {
  font-size: 10px !important;
  color: var(--fg3) !important;
  background: var(--bg3);
  padding: 2px 8px !important;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.sfdt-result-type-record {
  color: #22c55e !important;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.2);
}

.sfdt-result-type-field {
  color: #fbbf24 !important;
  background: rgba(251,191,36,0.1);
  border: 1px solid rgba(251,191,36,0.2);
}

.sfdt-result-sub {
  font-size: 11px !important;
  color: var(--fg3) !important;
  margin-top: 1px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sfdt-result-type {
  font-size: 10px;
  color: var(--fg3, #383e4a);
  background: rgba(56,62,74,0.15);
  padding: 2px 8px;
  border-radius: 8px;
  flex-shrink: 0;
  white-space: nowrap;
  margin-left: auto;
}

.sfdt-result-arrow {
  color: var(--fg3);
  font-size: 14px;
  flex-shrink: 0;
}

.sfdt-result-pin,
.sfdt-unpin-btn {
  background: none;
  border: none;
  color: var(--fg3);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sfdt-result-pin svg,
.sfdt-unpin-btn svg {
  width: 14px;
  height: 14px;
}
.sfdt-result:hover .sfdt-result-pin,
.sfdt-result:hover .sfdt-unpin-btn,
.sfdt-result-pin.pinned {
  opacity: 1;
}
.sfdt-result-pin.pinned {
  color: #fbbf24;
}
.sfdt-result-pin:hover {
  color: #fbbf24;
  background: var(--bg3);
}
.sfdt-unpin-btn:hover {
  color: #f85149;
  background: var(--bg3);
}

/* ── Pinned Favorites Grid ── */
.sfdt-pinned-grid {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
  padding: 6px 16px 10px !important;
}

.sfdt-pinned-tile {
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 6px 4px 5px !important;
  background: linear-gradient(135deg, #1a2233 0%, #151c2a 100%) !important;
  border: 1px solid #2d3548 !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  text-align: center !important;
  transition: all 0.15s ease !important;
  width: 68px !important;
  gap: 3px !important;
}

.sfdt-pinned-tile:hover {
  border-color: var(--accent, #58a6ff) !important;
  box-shadow: 0 0 0 1px var(--accent, #58a6ff), 0 2px 8px rgba(88,166,255,0.12) !important;
  background: linear-gradient(135deg, #1e2840 0%, #192030 100%) !important;
}

.sfdt-pinned-tile-initial {
  width: 22px !important;
  height: 22px !important;
  border-radius: 6px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  color: #fff !important;
  flex-shrink: 0 !important;
  text-transform: uppercase !important;
}

.sfdt-pinned-tile-name {
  font-size: 9px !important;
  font-weight: 500 !important;
  color: var(--fg, #e1e4e8) !important;
  line-height: 1.2 !important;
  overflow: hidden !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  word-break: break-word !important;
  max-width: 100% !important;
}

.sfdt-pinned-tile-type {
  display: none !important;
}

.sfdt-pinned-tile .sfdt-unpin-btn {
  position: absolute !important;
  top: -4px !important;
  right: -4px !important;
  width: 14px !important;
  height: 14px !important;
  padding: 1px !important;
  opacity: 0 !important;
  background: rgba(0,0,0,0.6) !important;
  border-radius: 50% !important;
}

.sfdt-pinned-tile .sfdt-unpin-btn svg {
  width: 10px !important;
  height: 10px !important;
}

.sfdt-pinned-tile:hover .sfdt-unpin-btn {
  opacity: 1 !important;
}

.sfdt-pinned-tile.dragging {
  opacity: 0.35 !important;
  transform: scale(0.9) !important;
}

.sfdt-pinned-tile.drag-over {
  border: 1.5px dashed var(--accent, #58a6ff) !important;
  background: rgba(88,166,255,0.08) !important;
}

.sfdt-pinned-tile.disabled {
  opacity: 0.45 !important;
  pointer-events: none !important;
  cursor: not-allowed !important;
}

.sfdt-impact-btn {
  background: none;
  border: none;
  color: var(--fg3);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  margin-left: 4px;
  vertical-align: middle;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sfdt-impact-btn svg {
  width: 12px;
  height: 12px;
}
.sfdt-field-row:hover .sfdt-impact-btn {
  opacity: 1;
}
.sfdt-impact-btn:hover {
  color: var(--accent, #58a6ff);
  background: var(--bg3);
}

.sfdt-show-more {
  padding: 12px 16px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent, #58a6ff);
  cursor: pointer;
  border-top: 1px solid var(--border, #2d333b);
  transition: background 0.15s, color 0.15s;
}
.sfdt-show-more:hover {
  background: rgba(88,166,255,0.1);
  color: var(--fg, #e1e4e8);
}

.sfdt-browse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: none;
  background: rgba(88,166,255,0.1);
  color: var(--accent, #58a6ff);
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s, transform 0.15s;
  padding: 0;
  margin-left: 4px;
}

.sfdt-browse-btn svg {
  width: 20px;
  height: 20px;
}

.sfdt-browse-btn:hover {
  background: var(--accent, #58a6ff);
  color: var(--bg, #0f1419);
  transform: scale(1.1);
}

.sfdt-back-btn {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #58a6ff);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s;
}
.sfdt-back-btn:hover {
  color: var(--fg, #e1e4e8);
}

.sfdt-drilldown-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg, #e1e4e8);
  padding: 10px 10px 8px;
  margin-left: 4px;
  white-space: nowrap;
  border-bottom: 2px solid var(--accent, #58a6ff);
  border-left: 1px solid var(--border, #2d333b);
}

.sfdt-result-newtab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--fg3);
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
  padding: 0;
  pointer-events: auto;
}
.sfdt-result-newtab svg { width: 14px; height: 14px; }
.sfdt-result:hover .sfdt-result-newtab,
.sfdt-result.selected .sfdt-result-newtab { opacity: 1; }
.sfdt-result-newtab:hover {
  background: var(--bg3);
  color: var(--accent);
}

.sfdt-code-line {
  display: block;
  font-family: var(--mono) !important;
  font-size: 11px !important;
  color: var(--fg2) !important;
  padding: 1px 0 !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sfdt-result-symbol {
  font-size: 11px !important;
  color: var(--purple) !important;
  margin-top: 2px !important;
}

mark.sfdt-highlight {
  background: rgba(88,166,255,0.25) !important;
  color: var(--accent) !important;
  border-radius: 2px;
  padding: 0 1px !important;
}

.sfdt-result-ns {
  font-size: 10px !important;
  color: #fbbf24 !important;
  background: rgba(251,191,36,0.12);
  padding: 1px 6px !important;
  border-radius: 8px;
  margin-left: 6px;
  white-space: nowrap;
  vertical-align: middle;
}

.sfdt-empty {
  padding: 24px !important;
  text-align: center;
  color: var(--fg3);
  font-size: 13px !important;
}

/* Enter to Search prompt */
.sfdt-enter-prompt {
  padding: 32px 24px !important;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.sfdt-enter-prompt-text {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--fg2, #8b949e);
  font-size: 15px !important;
  font-weight: 500;
}
.sfdt-enter-prompt-text kbd {
  display: inline-block;
  padding: 2px 8px;
  background: var(--bg3, #2d333b);
  border: 1px solid var(--border, #2d333b);
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px !important;
  color: var(--accent, #58a6ff);
  font-weight: 600;
}
.sfdt-enter-prompt-icon {
  color: var(--fg3, #383e4a);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
}
.sfdt-enter-prompt-icon svg {
  width: 18px !important;
  height: 18px !important;
}
.sfdt-enter-prompt-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px !important;
  background: var(--accent, #58a6ff) !important;
  color: var(--bg, #0f1419) !important;
  border: none !important;
  border-radius: 6px;
  font-size: 13px !important;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.sfdt-enter-prompt-btn:hover {
  opacity: 0.85;
}
.sfdt-enter-prompt-btn svg {
  width: 14px !important;
  height: 14px !important;
}

.sfdt-searching {
  padding: 24px !important;
  text-align: center;
  color: var(--fg2, #8b949e);
  font-size: 13px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.sfdt-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--fg3, #383e4a);
  border-top-color: var(--accent, #58a6ff);
  border-radius: 50%;
  animation: sfdt-spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes sfdt-spin {
  to { transform: rotate(360deg); }
}

.sfdt-searching-banner {
  padding: 6px 16px !important;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg3, #2d333b);
  border-bottom: 1px solid var(--border, #2d333b);
  color: var(--accent, #58a6ff);
  font-size: 12px !important;
  font-weight: 500;
  animation: sfdt-banner-pulse 1.5s ease-in-out infinite;
}

@keyframes sfdt-banner-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

.sfdt-dynamic-loader {
  padding: 10px 16px !important;
  text-align: center;
  color: var(--fg3, #383e4a);
  font-size: 12px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-top: 1px solid var(--border, #2d333b);
  opacity: 0.8;
}

/* Deep Search Slot — fixed between results and status bar */
.sfdt-deep-search-slot {
  flex-shrink: 0;
}

/* Deep Search Bar — shimmer glow animation */
@keyframes sfdt-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.sfdt-deep-search-bar {
  padding: 10px 16px !important;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--border, #2d333b);
  background: linear-gradient(90deg, var(--bg2, #181825) 0%, rgba(88,166,255,0.08) 25%, rgba(88,166,255,0.15) 50%, rgba(88,166,255,0.08) 75%, var(--bg2, #181825) 100%);
  background-size: 200% 100%;
  animation: sfdt-shimmer 3s ease-in-out infinite;
  cursor: pointer;
  transition: border-color 0.2s;
  font-size: 12px !important;
}
.sfdt-deep-search-bar:hover {
  background: linear-gradient(90deg, var(--bg-hover, #2d333b) 0%, rgba(88,166,255,0.18) 50%, var(--bg-hover, #2d333b) 100%);
  background-size: 200% 100%;
  animation: sfdt-shimmer 1.5s ease-in-out infinite;
  border-color: var(--accent, #58a6ff);
}
.sfdt-deep-search-bar.sfdt-deep-search-active {
  cursor: default;
  animation: none;
  background: var(--bg2, #181825);
  opacity: 0.8;
}
.sfdt-deep-search-bar.sfdt-deep-search-active:hover {
  background: var(--bg2, #181825);
}
.sfdt-deep-search-icon {
  color: var(--accent, #58a6ff);
  flex-shrink: 0;
}
.sfdt-deep-search-icon svg {
  width: 14px;
  height: 14px;
}
.sfdt-deep-search-text {
  color: var(--accent, #58a6ff);
  font-weight: 600;
  font-size: 12px !important;
}
.sfdt-deep-search-hint {
  color: var(--fg3, #383e4a);
  font-size: 11px !important;
  margin-left: 4px;
  flex: 1;
}
.sfdt-deep-search-arrow {
  color: var(--accent, #58a6ff);
  font-size: 16px !important;
  font-weight: 600;
  margin-left: auto;
}

/* Inline deep search card inside results panel */
.sfdt-deep-search-inline {
  margin: 12px 16px !important;
  padding: 14px 16px !important;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(88,166,255,0.25);
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(88,166,255,0.05) 0%, rgba(88,166,255,0.12) 50%, rgba(88,166,255,0.05) 100%);
  background-size: 200% 100%;
  animation: sfdt-shimmer 3s ease-in-out infinite;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.sfdt-deep-search-inline:hover {
  border-color: var(--accent, #58a6ff);
  box-shadow: 0 0 12px rgba(88,166,255,0.2);
  animation: sfdt-shimmer 1.5s ease-in-out infinite;
}

.sfdt-status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px !important;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  font-size: 11px !important;
  color: var(--fg3) !important;
  gap: 8px;
}
.sfdt-status-hint {
  font-size: 10px !important;
  color: var(--fg3) !important;
  opacity: 0.7;
}

/* ─── Navigator Tabs ─── */

.sfdt-tabs {
  display: flex;
  align-items: center;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  min-height: 40px;
  gap: 4px;
}

.sfdt-tab {
  padding: 8px 16px !important;
  font-size: 12px !important;
  color: var(--fg2) !important;
  background: transparent !important;
  border: none !important;
  border-bottom: 2px solid transparent !important;
  cursor: pointer;
  transition: all 0.12s;
}
.sfdt-tab:hover { color: var(--fg) !important; }
.sfdt-tab.active {
  color: var(--accent) !important;
  border-bottom-color: var(--accent) !important;
}

/* ─── Side Panel (Inspector) ─── */

.sfdt-panel {
  position: fixed;
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  display: none;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  z-index: 2;
}
.sfdt-panel.visible { display: flex; }



.sfdt-panel-right {
  top: 0; right: 0;
  width: 480px;
  max-width: 50vw;
  height: 100vh;
  animation: slideLeft 0.2s ease-out;
}
.sfdt-panel-right.expanded {
  width: 80vw;
  max-width: 80vw;
}
@keyframes slideLeft {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

.sfdt-panel-bottom {
  bottom: 0; left: 0; right: 0;
  height: 45vh;
  min-height: 200px;
  border-radius: var(--radius) var(--radius) 0 0;
  animation: slideUp 0.2s ease-out;
}
.sfdt-panel-bottom.expanded { height: 85vh; }
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ─── Drag Resize Handles ─── */
.sfdt-resize-handle-top {
  position: absolute;
  top: -4px; left: 0; right: 0;
  height: 8px;
  cursor: ns-resize;
  z-index: 10;
  background: transparent;
}
.sfdt-resize-handle-top:hover,
.sfdt-resize-handle-top.active {
  background: linear-gradient(to bottom, rgba(88,166,255,0.4), transparent);
}
.sfdt-resize-handle-top::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: rgba(166,173,200,0.3);
  transition: background 0.15s;
}
.sfdt-resize-handle-top:hover::after { background: rgba(88,166,255,0.6); }

.sfdt-resize-handle-left {
  position: absolute;
  top: 0; bottom: 0; left: -4px;
  width: 8px;
  cursor: ew-resize;
  z-index: 10;
  background: transparent;
}
.sfdt-resize-handle-left:hover,
.sfdt-resize-handle-left.active {
  background: linear-gradient(to right, rgba(88,166,255,0.4), transparent);
}
.sfdt-resize-handle-left::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  height: 40px;
  width: 4px;
  border-radius: 2px;
  background: rgba(166,173,200,0.3);
  transition: background 0.15s;
}
.sfdt-resize-handle-left:hover::after { background: rgba(88,166,255,0.6); }

.sfdt-panel.resizing { transition: none !important; animation: none !important; }

.sfdt-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px !important;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sfdt-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px !important;
  font-weight: 600;
}

.sfdt-panel-title svg { width: 18px !important; height: 18px !important; color: var(--accent) !important; }

/* Global: constrain inline SVG icons that lack width/height */
.sfdt-panel svg:not([width]):not(.sfdt-flame-svg) { max-width: 24px; max-height: 24px; }
.sfdt-loading svg, .sfdt-error svg { width: 16px; height: 16px; vertical-align: -2px; display: inline-block; }

.sfdt-panel-actions { display: flex; gap: 4px; }

.sfdt-panel-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 16px !important;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sfdt-panel-search {
  flex: 1;
  background: var(--bg3) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm);
  padding: 6px 10px !important;
  color: var(--fg) !important;
  font-size: 12px !important;
  outline: none !important;
}
.sfdt-panel-search:focus { border-color: var(--accent) !important; }

.sfdt-panel-sort {
  background: var(--bg3) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm);
  padding: 4px 8px !important;
  color: var(--fg) !important;
  font-size: 12px !important;
  cursor: pointer;
}

.sfdt-panel-info {
  padding: 8px 16px !important;
  background: var(--bg3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sfdt-record-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px !important;
}

.sfdt-object-name { font-weight: 600; color: var(--accent); }
.sfdt-record-name { color: var(--fg); }
.sfdt-record-id {
  color: var(--fg3);
  font-family: var(--mono) !important;
  font-size: 11px !important;
  cursor: pointer;
}

.sfdt-panel-body {
  flex: 1;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.sfdt-panel-body::-webkit-scrollbar { width: 6px; }
.sfdt-panel-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.sfdt-panel-footer {
  display: flex;
  gap: 16px;
  padding: 6px 16px !important;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  font-size: 11px !important;
  color: var(--fg3) !important;
  flex-shrink: 0;
}

.sfdt-loading, .sfdt-empty-panel, .sfdt-error {
  padding: 24px !important;
  text-align: center;
  color: var(--fg3) !important;
  font-size: 13px !important;
}
.sfdt-error { color: var(--red) !important; }

/* ─── Buttons ─── */

.sfdt-btn {
  padding: 5px 10px !important;
  font-size: 12px !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm);
  background: var(--bg3) !important;
  color: var(--fg) !important;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sfdt-btn svg { width: 14px !important; height: 14px !important; }
.sfdt-btn:hover { border-color: var(--accent) !important; color: var(--accent) !important; }
.sfdt-btn:hover svg { color: var(--accent) !important; }
.sfdt-btn:disabled { opacity: 0.4; cursor: default; }

.sfdt-btn-sm { padding: 3px 8px !important; font-size: 11px !important; }
.sfdt-btn-sm svg { width: 12px !important; height: 12px !important; }

.sfdt-btn-primary {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
  color: var(--bg) !important;
  font-weight: 600;
}
.sfdt-btn-primary:hover {
  background: var(--accent2) !important;
  border-color: var(--accent2) !important;
  color: var(--bg) !important;
}

.sfdt-btn-close:hover { color: var(--red) !important; border-color: var(--red) !important; }
.sfdt-btn-close:hover svg { color: var(--red) !important; }

/* ─── Field Table ─── */

.sfdt-field-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px !important;
}

.sfdt-field-table thead {
  position: sticky;
  top: 0;
  background: var(--bg2);
  z-index: 1;
}

.sfdt-field-table th {
  padding: 6px 10px !important;
  text-align: left;
  font-weight: 600 !important;
  font-size: 11px !important;
  color: var(--fg2) !important;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  background: var(--bg2) !important;
}

.sfdt-field-table td {
  padding: 5px 10px !important;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  color: var(--fg) !important;
  background: transparent !important;
}

.sfdt-field-row:hover td { background: var(--bg-hover) !important; }

.sfdt-custom-field { border-left: 2px solid var(--accent); }

.sfdt-td-label { font-weight: 500; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sfdt-td-api { color: var(--accent) !important; font-family: var(--mono) !important; font-size: 11px !important; white-space: nowrap; }
.sfdt-td-value { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sfdt-null { color: var(--fg3) !important; font-style: italic; }
.sfdt-relation { margin-left: 4px !important; }

.sfdt-type-string { color: var(--green) !important; }
.sfdt-type-id { color: var(--purple) !important; }
.sfdt-type-reference { color: var(--accent2) !important; }
.sfdt-type-boolean { color: var(--orange) !important; }
.sfdt-type-int, .sfdt-type-integer { color: var(--yellow) !important; }
.sfdt-type-double, .sfdt-type-currency, .sfdt-type-percent { color: var(--yellow) !important; }
.sfdt-type-date, .sfdt-type-datetime { color: var(--accent) !important; }

.sfdt-copyable {
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 2px;
  padding: 0 2px !important;
}
.sfdt-copyable:hover { background: rgba(88,166,255,0.15) !important; }
.sfdt-copyable.copied { background: rgba(34,197,94,0.2) !important; }

.sfdt-diff { background: rgba(248,81,73,0.15) !important; color: var(--red) !important; }

/* ─── Compare Banner & Diff ─── */
.sfdt-compare-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(192,132,252,0.08);
  border: 1px solid rgba(192,132,252,0.2);
  border-radius: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}
.sfdt-compare-banner-left { display: flex; align-items: center; gap: 12px; }
.sfdt-compare-ids { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.sfdt-compare-label-a {
  background: rgba(88,166,255,0.15); color: #58a6ff; padding: 2px 8px; border-radius: 4px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px;
}
.sfdt-compare-label-b {
  background: rgba(192,132,252,0.15); color: #c084fc; padding: 2px 8px; border-radius: 4px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px;
}
.sfdt-compare-stats { display: flex; align-items: center; gap: 6px; }
.sfdt-compare-stat { font-size: 12px; font-weight: 600; }
.sfdt-compare-diff { color: #f85149; }
.sfdt-compare-same { color: #22c55e; }
.sfdt-compare-clear { margin-left: 4px; }
.sfdt-compare-filter-btn { cursor: pointer; font-weight: 600; font-size: 11px; transition: all 0.15s; }
.sfdt-compare-filter-btn:hover { opacity: 0.85; }
.sfdt-compare-filter-btn.sfdt-compare-btn-diff { color: #f85149; border-color: rgba(248,81,73,0.3); }
.sfdt-compare-filter-btn.sfdt-compare-btn-same { color: #22c55e; border-color: rgba(34,197,94,0.3); }
.sfdt-filter-active-diff { background: rgba(248,81,73,0.2) !important; border-color: rgba(248,81,73,0.4) !important; color: #f85149 !important; }
.sfdt-filter-active-same { background: rgba(34,197,94,0.2) !important; border-color: rgba(34,197,94,0.4) !important; color: #22c55e !important; }
.sfdt-row-diff { background: rgba(251,191,36,0.04); }
.sfdt-row-diff td { border-top: 1px solid rgba(251,191,36,0.12) !important; border-bottom: 1px solid rgba(251,191,36,0.12) !important; }
.sfdt-diff-highlight-a { background: rgba(88,166,255,0.08); }
.sfdt-diff-highlight-b { background: rgba(192,132,252,0.08); }
.sfdt-diff-changed { color: #f85149; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.sfdt-diff-same { color: #383e4a; font-size: 11px; }
.sfdt-td-diff { text-align: center; min-width: 60px; }
.sfdt-btn-active { background: rgba(192,132,252,0.2) !important; border-color: rgba(192,132,252,0.4) !important; color: #c084fc !important; }

.sfdt-pin-btn { position: relative; }
.sfdt-pin-btn.sfdt-btn-active::after { content: ''; position: absolute; top: 2px; right: 2px; width: 5px; height: 5px; background: #22c55e; border-radius: 50%; }

.sfdt-inline-input {
  width: 100%;
  background: var(--bg3) !important;
  border: 1px solid var(--accent) !important;
  border-radius: var(--radius-sm);
  padding: 3px 6px !important;
  color: var(--fg) !important;
  font-size: 12px !important;
  outline: none !important;
}

/* ─── JSON Overlay ─── */

.sfdt-json-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.sfdt-json-dialog {
  width: 700px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sfdt-impact-overlay .sfdt-json-dialog {
  border: 1.5px solid rgba(88,166,255,0.25);
  padding: 4px !important;
}

.sfdt-json-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px !important;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}
.sfdt-json-header span:first-child { flex: 1; }

.sfdt-json-body {
  flex: 1;
  overflow: auto;
  padding: 16px !important;
  font-family: var(--mono) !important;
  font-size: 12px !important;
  line-height: 1.5 !important;
  color: var(--fg) !important;
  white-space: pre;
  tab-size: 2;
}

/* ─── SOQL Panel ─── */

.sfdt-soql-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px !important;
}

.sfdt-soql-editor-area {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sfdt-soql-editor-wrapper { position: relative; z-index: 10; background: var(--bg); }

/* Syntax Highlighting Overlay */
.sfdt-soql-highlight {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  margin: 0 !important;
  padding: 12px 16px !important;
  background: transparent !important;
  border: none !important;
  font-family: var(--mono) !important;
  font-size: 13px !important;
  line-height: 1.5 !important;
  tab-size: 2;
  color: var(--fg, #e1e4e8) !important;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
  pointer-events: none;
  z-index: 1;
}
.sfdt-hl-keyword { color: #c084fc !important; font-weight: 600; }
.sfdt-hl-string { color: #22c55e !important; }
.sfdt-hl-number { color: #d29922 !important; }

/* Run button row badge */
.sfdt-run-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 5px !important;
  border-radius: 8px;
  background: rgba(255,255,255,0.2);
  color: inherit !important;
  font-size: 10px !important;
  font-weight: 700;
  margin-left: 2px;
  line-height: 1;
}

.sfdt-soql-editor {
  width: 100%;
  min-height: 80px;
  max-height: 200px;
  padding: 12px 16px !important;
  background: transparent !important;
  border: none !important;
  color: transparent !important;
  font-family: var(--mono) !important;
  font-size: 13px !important;
  line-height: 1.5 !important;
  resize: vertical;
  outline: none !important;
  tab-size: 2;
  position: relative;
  z-index: 2;
  caret-color: var(--fg) !important;
}
.sfdt-soql-editor::placeholder { color: var(--fg3) !important; }

.sfdt-soql-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 16px !important;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
  align-items: center;
}

.sfdt-soql-divider { color: var(--border); margin: 0 4px !important; }

.sfdt-soql-hints {
  max-height: 120px;
  overflow-y: auto;
  background: var(--bg2);
}

.sfdt-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 16px !important;
  font-size: 12px !important;
  border-bottom: 1px solid var(--border);
}
.sfdt-hint-msg { color: var(--fg) !important; }
.sfdt-hint-suggestion { color: var(--fg3) !important; font-size: 11px !important; margin-top: 2px !important; }
.sfdt-hint-success { color: var(--green) !important; }
.sfdt-hint-warning .sfdt-hint-msg { color: var(--yellow) !important; }
.sfdt-hint-error .sfdt-hint-msg { color: var(--red) !important; }

.sfdt-query-plan {
  padding: 8px 16px !important;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11px !important;
  color: var(--fg2) !important;
  background: var(--bg3);
  border-top: 1px solid var(--border);
}

/* ─── SOQL Results ─── */

.sfdt-soql-results {
  flex: 1;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.sfdt-soql-result-info {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 8px 16px !important;
  background: #1a1f2e !important;
  border-bottom: 1px solid var(--border);
  font-size: 12px !important;
  color: #22c55e !important;
  font-weight: 500;
  position: relative;
  z-index: 3;
}

.sfdt-soql-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px !important;
}

.sfdt-soql-table th {
  padding: 8px 12px !important;
  text-align: left;
  font-weight: 700 !important;
  font-size: 12px !important;
  color: #58a6ff !important;
  background: #1a1f2e !important;
  border-bottom: 2px solid #2d333b;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 2;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sfdt-soql-table td {
  padding: 5px 10px !important;
  border-bottom: 1px solid var(--border);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e1e4e8 !important;
  font-size: 12px !important;
  background: transparent !important;
}

.sfdt-soql-table tr:hover td { background: var(--bg-hover) !important; }
.sfdt-soql-table tr.sfdt-row-detail:hover td { background: #0f1419 !important; }
.sfdt-soql-table tr.sfdt-row-main { cursor: pointer; }
.sfdt-soql-table .sfdt-row-toggle { user-select: none; font-size: 10px; color: #6e7681 !important; width: 20px !important; min-width: 20px !important; padding: 0 4px !important; }
.sfdt-soql-table a { color: #58a6ff !important; text-decoration: underline; cursor: pointer; }
.sfdt-soql-table a:hover { color: #b4befe !important; }

.sfdt-soql-loading, .sfdt-soql-empty, .sfdt-soql-placeholder {
  padding: 24px !important;
  text-align: center;
  color: var(--fg3) !important;
  font-size: 13px !important;
}
.sfdt-soql-empty svg {
  width: 14px; height: 14px; vertical-align: -2px; display: inline-block;
}

.sfdt-soql-error { padding: 16px !important; }
.sfdt-soql-error-title { color: var(--red) !important; font-weight: 600; margin-bottom: 6px !important; }
.sfdt-soql-error-msg {
  color: var(--fg2) !important;
  font-family: var(--mono) !important;
  font-size: 12px !important;
  white-space: pre-wrap;
  word-break: break-word;
}

/* SOQL History & Favorites */
.sfdt-soql-history-area, .sfdt-soql-favorites-area, .sfdt-soql-examples-area {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0 !important;
}
.sfdt-soql-history-item {
  padding: 8px 16px !important;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  position: relative;
  cursor: pointer;
}
.sfdt-soql-history-item.error-item { border-left: 2px solid var(--red); }

/* Custom scrollable tooltip for history */
.sfdt-history-tooltip {
  position: absolute;
  left: 12px; right: 12px;
  background: var(--bg);
  border: 1px solid var(--blue);
  border-radius: var(--radius-sm);
  padding: 10px 14px !important;
  z-index: 60;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  max-height: 200px;
  overflow-y: auto;
  pointer-events: auto;
}
.sfdt-soql-history-query { flex: 1; min-width: 0; }
.sfdt-soql-history-query pre {
  font-family: var(--mono) !important;
  font-size: 11px !important;
  color: var(--fg) !important;
  white-space: pre-wrap;
  word-break: break-all;
  margin-top: 4px !important;
}
.sfdt-soql-history-meta {
  display: flex;
  gap: 8px;
  font-size: 11px !important;
  color: var(--fg3) !important;
  margin-top: 4px !important;
}

/* History Hover Dropdown */
.sfdt-history-hover-wrap {
  position: relative;
  display: inline-flex;
}
.sfdt-history-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  width: 60vw;
  max-width: 800px;
  min-width: 400px;
  max-height: 460px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 200;
  overflow: hidden;
  pointer-events: auto;
}
.sfdt-hd-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px !important;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.sfdt-hd-list {
  overflow-y: auto;
  max-height: 410px;
}
.sfdt-hd-item {
  padding: 8px 12px !important;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
  pointer-events: auto;
}
.sfdt-hd-item:hover {
  background: var(--bg-selected);
}
.sfdt-hd-item-main {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.sfdt-hd-status {
  flex-shrink: 0;
  font-size: 12px !important;
  line-height: 1.5;
}
.sfdt-hd-query {
  font-family: var(--mono) !important;
  font-size: 11px !important;
  color: var(--fg) !important;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0 !important;
  line-height: 1.5;
  flex: 1;
  min-width: 0;
}
.sfdt-hd-item-meta {
  display: flex;
  gap: 8px;
  font-size: 10px !important;
  color: var(--fg3) !important;
  margin-top: 4px !important;
  padding-left: 20px;
  align-items: center;
}
.sfdt-hd-remove {
  margin-left: auto;
  opacity: 0.4;
  transition: opacity 0.15s;
}
.sfdt-hd-item:hover .sfdt-hd-remove {
  opacity: 1;
}

/* Autocomplete */
.sfdt-autocomplete {
  position: absolute;
  top: 100%; left: 16px; right: 16px;
  display: none;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  box-shadow: var(--shadow-sm);
  max-height: 180px;
  overflow-y: auto;
  z-index: 100;
  min-width: 250px;
}
.sfdt-ac-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px !important;
  cursor: pointer;
  font-size: 12px !important;
}
.sfdt-ac-item:hover, .sfdt-ac-item.selected { background: var(--bg-selected); }
.sfdt-ac-text { flex: 1; color: var(--fg) !important; }
.sfdt-ac-type { font-size: 10px !important; color: var(--fg3) !important; text-transform: uppercase; }

/* Field Hints Panel */
.sfdt-field-hints {
  display: none;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  padding: 8px 12px !important;
  max-height: 160px;
  overflow-y: auto;
  flex-shrink: 0;
}
.sfdt-field-hints.visible { display: block; }
.sfdt-field-hints-title {
  font-size: 11px !important;
  color: var(--fg2) !important;
  margin-bottom: 6px !important;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.sfdt-field-hints-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.sfdt-field-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px !important;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px !important;
  font-family: var(--mono) !important;
  color: #e1e4e8 !important;
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.1s, border-color 0.1s;
  line-height: 1.4;
}
.sfdt-field-chip:hover {
  background: var(--bg-selected);
  border-color: var(--blue);
  color: #fff !important;
}
.sfdt-field-chip-type {
  font-size: 9px !important;
  color: #0f1419 !important;
  background: var(--fg3);
  padding: 1px 5px !important;
  border-radius: 3px;
  text-transform: lowercase;
  font-family: var(--mono) !important;
  font-weight: 600;
  letter-spacing: 0.3px;
}

@keyframes sfdt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ─── Floating Toolbar ─── */

.sfdt-toolbar {
  position: fixed;
  right: 12px; bottom: 12px;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 6px;
  pointer-events: auto;
}

.sfdt-toolbar-toggle {
  width: 36px; height: 36px;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(88,166,255,0.3);
  transition: opacity 0.4s, transform 0.2s, box-shadow 0.2s;
  border: none !important;
  opacity: 0.35;
}
.sfdt-toolbar-toggle:hover {
  opacity: 1;
  transform: scale(1.1);
  box-shadow: 0 4px 18px rgba(88,166,255,0.5);
}
.sfdt-toolbar.expanded .sfdt-toolbar-toggle { opacity: 1; }
.sfdt-toolbar-toggle svg { width: 18px; height: 18px; color: #fff; }

.sfdt-toolbar-buttons {
  display: none;
  flex-direction: column;
  gap: 2px;
  padding: 6px !important;
  background: #0f0f1a;
  border: 1px solid rgba(255,255,255,0.08) !important;
  border-radius: 12px;
  box-shadow: var(--shadow);
  animation: fadeIn 0.15s ease-out;
}
.sfdt-toolbar.expanded .sfdt-toolbar-buttons { display: flex; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.sfdt-toolbar-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px !important;
  background: transparent !important;
  border: 1px solid transparent !important;
  border-radius: 8px;
  color: var(--fg) !important;
  cursor: pointer;
  font-size: 13px !important;
  white-space: nowrap;
  transition: all 0.15s;
}
.sfdt-toolbar-btn:hover {
  background: rgba(129,140,248,0.1) !important;
  border-color: rgba(129,140,248,0.2) !important;
}
.sfdt-toolbar-btn svg { width: 18px; height: 18px; }
.sfdt-toolbar-btn-secondary { color: var(--fg3) !important; }
.sfdt-toolbar-label { font-size: 12px !important; }

/* ─── Debug Log Panel ─── */
.sfdt-debuglog-panel { flex-direction: column; }
.sfdt-debuglog-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.sfdt-debuglog-list {
  width: 280px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sfdt-debuglog-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.sfdt-debuglog-count {
  font-size: 11px;
  color: #6e7681;
  background: rgba(110,118,129,0.12);
  padding: 2px 8px;
  border-radius: 10px;
}
.sfdt-debuglog-list-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 10px 10px;
}
.sfdt-debuglog-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: all 0.12s;
}
.sfdt-debuglog-item:hover { background: rgba(88,166,255,0.06); border-color: rgba(88,166,255,0.12); }
.sfdt-debuglog-item.active { background: rgba(88,166,255,0.1); border-color: rgba(88,166,255,0.25); }
.sfdt-debuglog-item.error { border-left: 3px solid #f85149; }
.sfdt-debuglog-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}
.sfdt-debuglog-item-time { font-size: 10px; color: #6e7681; }
.sfdt-debuglog-item-duration { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.sfdt-debuglog-item-op {
  font-size: 12px;
  color: #e1e4e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.sfdt-debuglog-item-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: #6e7681;
}
.sfdt-debuglog-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.sfdt-debuglog-detail-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  justify-content: space-between;
}
.sfdt-debuglog-detail-body {
  flex: 1;
  overflow: auto;
  padding: 0;
}

/* Summary view */
.sfdt-summary-scroll { padding: 16px; overflow-y: auto; }
.sfdt-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}
.sfdt-stat-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  text-align: center;
}
.sfdt-stat-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.sfdt-stat-value small { font-size: 12px; opacity: 0.7; margin-left: 2px; }
.sfdt-stat-label { font-size: 10px; color: #6e7681; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.sfdt-summary-section { margin-bottom: 20px; }
.sfdt-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #58a6ff;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

/* Limits bars */
.sfdt-limit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 11px;
}
.sfdt-limit-label { width: 140px; color: #8b949e; flex-shrink: 0; }
.sfdt-limit-bar {
  flex: 1;
  height: 6px;
  background: rgba(110,118,129,0.15);
  border-radius: 3px;
  overflow: hidden;
}
.sfdt-limit-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.sfdt-limit-val { width: 80px; text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; }

/* Method rows */
.sfdt-method-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 11px;
}
.sfdt-method-rank { width: 28px; color: #6e7681; text-align: right; flex-shrink: 0; }
.sfdt-method-info { flex: 1; min-width: 0; }
.sfdt-method-name {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e1e4e8;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  margin-bottom: 2px;
}
.sfdt-method-bar {
  height: 4px;
  background: rgba(110,118,129,0.1);
  border-radius: 2px;
  overflow: hidden;
}
.sfdt-method-fill { height: 100%; border-radius: 2px; }
.sfdt-method-duration { width: 52px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.sfdt-method-line { width: 42px; text-align: right; color: #6e7681; font-size: 10px; flex-shrink: 0; }

/* SOQL rows */
.sfdt-soql-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 11px;
  border-bottom: 1px solid rgba(110,118,129,0.06);
}
.sfdt-soql-idx { width: 20px; color: #6e7681; text-align: right; flex-shrink: 0; }
.sfdt-soql-query {
  flex: 1;
  color: #c084fc;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sfdt-soql-rows { width: 60px; text-align: right; color: #8b949e; flex-shrink: 0; }

/* Debug rows */
.sfdt-debug-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
}
.sfdt-debug-level {
  width: 42px;
  font-weight: 600;
  font-size: 10px;
  flex-shrink: 0;
  text-transform: uppercase;
}
.sfdt-debug-msg {
  flex: 1;
  color: #e1e4e8;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  word-break: break-word;
}
.sfdt-exception-row {
  padding: 4px 0;
  font-size: 11px;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

/* DML rows */
.sfdt-dml-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 11px;
  border-bottom: 1px solid rgba(110,118,129,0.06);
}
.sfdt-dml-op {
  width: 52px;
  font-weight: 600;
  flex-shrink: 0;
  font-size: 10px;
  text-transform: uppercase;
}
.sfdt-dml-type {
  flex: 1;
  color: #e1e4e8;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Parent unit badge (shows source trigger/class for DML/SOQL) */
.sfdt-parent-unit {
  max-width: 180px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(88,166,255,0.1);
  color: #58a6ff;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

/* Clickable summary rows */
.sfdt-clickable-line { cursor: pointer; border-radius: 4px; padding-left: 4px !important; padding-right: 4px !important; }
.sfdt-clickable-line:hover { background: rgba(88,166,255,0.08); }

/* Governor limit percentage */
.sfdt-limit-pct { width: 36px; text-align: right; font-weight: 600; font-size: 10px; flex-shrink: 0; }

/* ─── Call Tree ─── */
.sfdt-calltree { padding: 4px 8px; }
.sfdt-tree-node { margin-bottom: 2px; }
.sfdt-tree-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.sfdt-tree-header:hover { background: rgba(88,166,255,0.08); }
.sfdt-tree-toggle {
  width: 14px;
  cursor: pointer;
  color: #6e7681;
  font-size: 9px;
  flex-shrink: 0;
  user-select: none;
}
.sfdt-tree-spacer { width: 14px; flex-shrink: 0; }
.sfdt-tree-name {
  flex: 1;
  color: #e1e4e8;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}
.sfdt-tree-name.sfdt-tree-error { color: #f85149; }
.sfdt-tree-ops { display: flex; gap: 4px; flex-shrink: 0; }
.sfdt-tree-badge {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
}
.sfdt-tree-badge-soql { background: rgba(192,132,252,0.15); color: #c084fc; }
.sfdt-tree-badge-dml { background: rgba(251,191,36,0.15); color: #fbbf24; }
.sfdt-tree-badge-error { background: rgba(248,81,73,0.15); color: #f85149; }
.sfdt-tree-dur { width: 52px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; font-size: 11px; }
.sfdt-tree-children { border-left: 1px solid rgba(110,118,129,0.12); margin-left: 7px; }
.sfdt-tree-ops-detail { padding: 2px 0 4px; }
.sfdt-tree-op-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  font-size: 10px;
  border-radius: 3px;
  cursor: pointer;
}
.sfdt-tree-op-row:hover { background: rgba(110,118,129,0.08); }
.sfdt-tree-op-icon { width: 14px; font-weight: 700; text-align: center; flex-shrink: 0; }
.sfdt-tree-op-text {
  flex: 1;
  color: #8b949e;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Timeline */
.sfdt-timeline { padding: 0 8px; }
.sfdt-timeline-event {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  border-left: 2px solid rgba(110,118,129,0.15);
  margin-left: 40px;
  position: relative;
}
.sfdt-timeline-line {
  position: absolute;
  left: -50px;
  width: 38px;
  text-align: right;
  font-size: 10px;
  color: #6e7681;
  font-variant-numeric: tabular-nums;
}
.sfdt-timeline-icon {
  font-size: 11px;
  font-weight: 700;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
.sfdt-timeline-dot {
  position: absolute;
  left: -5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sfdt-timeline-name {
  flex: 1;
  color: #e1e4e8;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Tab Buttons ─── */
.sfdt-dl-tab {
  background: none;
  border: none;
  color: #6e7681;
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  white-space: nowrap;
}
.sfdt-dl-tab:hover { color: #e1e4e8; }
.sfdt-dl-tab-active {
  color: #58a6ff !important;
  border-bottom-color: #58a6ff;
}

/* ─── Limits tab ─── */
.sfdt-limit-intro {
  font-size: 12px;
  color: #8b949e;
  background: rgba(88,166,255,0.06);
  border: 1px solid rgba(88,166,255,0.2);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  line-height: 1.5;
}
.sfdt-limit-hotgrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.sfdt-limit-hotcard {
  background: rgba(110,118,129,0.05);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
}
.sfdt-limit-hotcard-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; color: #8b949e;
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 6px;
}
.sfdt-limit-hotcard-label { font-weight: 600; }
.sfdt-limit-hotcard-name {
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.sfdt-limit-hotcard-val { font-size: 11px; color: #8b949e; }
.sfdt-limits-table td, .sfdt-limits-table th { white-space: nowrap; }
.sfdt-limits-table .sfdt-an-name {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
}
.sfdt-limit-scope-toggle { display: inline-flex; gap: 4px; }

/* ─── Limits tab v2 (enhanced) ─── */
.sfdt-dl-tab {
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
}
.sfdt-dl-tab-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 13px !important;
  height: 13px !important;
  flex-shrink: 0 !important;
}
.sfdt-dl-tab-icon svg {
  width: 13px !important;
  height: 13px !important;
  display: block !important;
}

.sfdt-limits-scroll {
  padding: 18px 20px 24px 20px !important;
  overflow-y: auto !important;
  height: 100% !important;
  box-sizing: border-box !important;
}

.sfdt-limits-intro {
  display: flex !important;
  align-items: flex-start !important;
  gap: 12px !important;
  background: linear-gradient(135deg, rgba(88,166,255,0.08), rgba(88,166,255,0.02)) !important;
  border: 1px solid rgba(88,166,255,0.25) !important;
  border-radius: 10px !important;
  padding: 14px 16px !important;
  margin-bottom: 18px !important;
}
.sfdt-limits-intro-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 28px !important;
  height: 28px !important;
  flex-shrink: 0 !important;
  color: #58a6ff !important;
  background: rgba(88,166,255,0.12) !important;
  border-radius: 8px !important;
}
.sfdt-limits-intro-icon svg { width: 18px !important; height: 18px !important; }
.sfdt-limits-intro-title {
  font-size: 13px !important;
  font-weight: 700 !important;
  color: #e1e4e8 !important;
  margin-bottom: 3px !important;
}
.sfdt-limits-intro-sub {
  font-size: 11.5px !important;
  color: #8b949e !important;
  line-height: 1.5 !important;
}

.sfdt-limits-section {
  background: rgba(110,118,129,0.04) !important;
  border: 1px solid var(--border) !important;
  border-radius: 10px !important;
  padding: 14px 16px !important;
  margin-bottom: 14px !important;
}
.sfdt-limits-section-head {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  color: #e1e4e8 !important;
  margin-bottom: 12px !important;
  padding-bottom: 8px !important;
  border-bottom: 1px solid var(--border) !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}
.sfdt-limits-section-icon {
  display: inline-flex !important;
  color: #58a6ff !important;
  width: 14px !important;
  height: 14px !important;
}
.sfdt-limits-section-icon svg { width: 14px !important; height: 14px !important; }
.sfdt-limits-section-head-row {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  gap: 12px !important;
  margin-bottom: 12px !important;
  padding-bottom: 8px !important;
  border-bottom: 1px solid var(--border) !important;
}
.sfdt-limits-count {
  color: #8b949e !important;
  font-weight: 500 !important;
  margin-left: 4px !important;
}
.sfdt-limits-controls { display: flex !important; gap: 8px !important; align-items: center !important; }

/* Transaction totals rows v2 */
.sfdt-limitrows-v2 {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)) !important;
  gap: 10px !important;
}
.sfdt-limitrow-v2 {
  display: flex !important;
  gap: 10px !important;
  padding: 10px 12px !important;
  background: rgba(13,17,23,0.4) !important;
  border: 1px solid var(--border) !important;
  border-radius: 8px !important;
}
.sfdt-limitrow-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 28px !important;
  height: 28px !important;
  flex-shrink: 0 !important;
}
.sfdt-limitrow-icon svg { width: 16px !important; height: 16px !important; }
.sfdt-limitrow-info { flex: 1 !important; min-width: 0 !important; }
.sfdt-limitrow-top {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  margin-bottom: 4px !important;
}
.sfdt-limitrow-label {
  font-size: 11.5px !important;
  font-weight: 600 !important;
  color: #e1e4e8 !important;
}
.sfdt-limitrow-status {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  font-size: 9.5px !important;
  font-weight: 700 !important;
  padding: 2px 7px !important;
  border-radius: 10px !important;
  letter-spacing: 0.5px !important;
}
.sfdt-limitrow-statusicon { display: inline-flex !important; width: 10px !important; height: 10px !important; }
.sfdt-limitrow-statusicon svg { width: 10px !important; height: 10px !important; }
.sfdt-limitrow-status-ok { color: #22c55e !important; background: rgba(34,197,94,0.12) !important; }
.sfdt-limitrow-status-warn { color: #fbbf24 !important; background: rgba(251,191,36,0.15) !important; }
.sfdt-limitrow-status-critical { color: #f85149 !important; background: rgba(248,81,73,0.15) !important; }

.sfdt-limitrow-barwrap {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  margin-bottom: 4px !important;
}
.sfdt-limitrow-bar {
  flex: 1 !important;
  height: 8px !important;
  background: rgba(110,118,129,0.18) !important;
  border-radius: 4px !important;
  overflow: hidden !important;
}
.sfdt-limitrow-fill { height: 100% !important; border-radius: 4px !important; transition: width 0.3s !important; }
.sfdt-limitrow-pct {
  font-size: 11px !important;
  font-weight: 700 !important;
  font-variant-numeric: tabular-nums !important;
  min-width: 36px !important;
  text-align: right !important;
}
.sfdt-limitrow-meta {
  display: flex !important;
  justify-content: space-between !important;
  font-size: 10.5px !important;
  color: #8b949e !important;
}
.sfdt-limitrow-val { font-family: 'SF Mono', Monaco, Menlo, monospace !important; color: #e1e4e8 !important; }
.sfdt-limitrow-sflimit { color: #6e7681 !important; font-style: italic !important; }

/* Hot consumer cards */
.sfdt-hotgrid {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) !important;
  gap: 10px !important;
}
.sfdt-hotcard {
  background: rgba(13,17,23,0.4) !important;
  border: 1px solid var(--border) !important;
  border-radius: 8px !important;
  padding: 12px 14px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
}
.sfdt-hotcard-head {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
}
.sfdt-hotcard-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 32px !important;
  height: 32px !important;
  flex-shrink: 0 !important;
  background: rgba(110,118,129,0.12) !important;
  border-radius: 8px !important;
}
.sfdt-hotcard-icon svg { width: 18px !important; height: 18px !important; }
.sfdt-hotcard-titles { flex: 1 !important; min-width: 0 !important; }
.sfdt-hotcard-label {
  font-size: 9.5px !important;
  font-weight: 700 !important;
  color: #8b949e !important;
  text-transform: uppercase !important;
  letter-spacing: 0.6px !important;
  margin-bottom: 2px !important;
}
.sfdt-hotcard-desc {
  font-size: 10.5px !important;
  color: #6e7681 !important;
  line-height: 1.35 !important;
}
.sfdt-hotcard-name {
  font-family: 'SF Mono', Monaco, Menlo, monospace !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
  color: #e1e4e8 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  padding: 6px 10px !important;
  background: rgba(110,118,129,0.08) !important;
  border-radius: 6px !important;
}
.sfdt-hotcard-val {
  display: flex !important;
  align-items: baseline !important;
  gap: 8px !important;
  flex-wrap: wrap !important;
}
.sfdt-hotcard-num { font-size: 20px !important; font-weight: 800 !important; font-variant-numeric: tabular-nums !important; }
.sfdt-hotcard-of { font-size: 11px !important; color: #6e7681 !important; }
.sfdt-hotcard-pct { font-size: 13px !important; font-weight: 700 !important; margin-left: auto !important; }

/* Hotspot table wrapper with padding */
.sfdt-limits-tablewrap {
  overflow: auto !important;
  max-height: 520px !important;
  border: 1px solid var(--border) !important;
  border-radius: 8px !important;
  background: rgba(13,17,23,0.3) !important;
  position: relative !important;
}
.sfdt-limits-table {
  width: 100% !important;
  border-collapse: separate !important;
  border-spacing: 0 !important;
  font-size: 11px !important;
}
.sfdt-limits-table thead tr {
  background: #1e2634 !important;
}
.sfdt-limits-table th {
  padding: 11px 14px !important;
  text-align: left !important;
  font-weight: 700 !important;
  color: #8b949e !important;
  text-transform: uppercase !important;
  font-size: 10px !important;
  letter-spacing: 0.5px !important;
  cursor: pointer !important;
  white-space: nowrap !important;
  position: sticky !important;
  top: 0 !important;
  background: #1e2634 !important;
  z-index: 5 !important;
  user-select: none !important;
  border-bottom: 1px solid var(--border) !important;
  box-shadow: 0 1px 0 0 var(--border) !important;
}
.sfdt-limits-table th:hover { color: #e1e4e8 !important; }
.sfdt-limits-table th.sfdt-an-num,
.sfdt-limits-table td.sfdt-an-num { text-align: right !important; font-variant-numeric: tabular-nums !important; }
.sfdt-limits-table tbody tr { border-bottom: 1px solid rgba(110,118,129,0.1) !important; }
.sfdt-limits-table tbody tr:hover { background: rgba(88,166,255,0.05) !important; }
.sfdt-limits-table td {
  padding: 8px 12px !important;
  color: #e1e4e8 !important;
  white-space: nowrap !important;
}
.sfdt-limits-table .sfdt-an-name {
  max-width: 420px !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  font-family: 'SF Mono', Monaco, Menlo, monospace !important;
  font-size: 11px !important;
}
.sfdt-cell-empty { color: #3b4048 !important; }
.sfdt-cell-fire {
  display: inline-flex !important;
  vertical-align: middle !important;
  width: 11px !important;
  height: 11px !important;
  color: #f85149 !important;
  margin-right: 4px !important;
}
.sfdt-cell-fire svg { width: 11px !important; height: 11px !important; }
.sfdt-sort-arrow { font-size: 8px !important; margin-left: 3px !important; color: #58a6ff !important; }

/* Scope toggle segmented */
.sfdt-scope-toggle {
  display: inline-flex !important;
  background: rgba(110,118,129,0.1) !important;
  border: 1px solid var(--border) !important;
  border-radius: 7px !important;
  padding: 2px !important;
}
.sfdt-scope-btn {
  background: none !important;
  border: none !important;
  color: #8b949e !important;
  font-size: 10.5px !important;
  font-weight: 600 !important;
  padding: 5px 12px !important;
  border-radius: 5px !important;
  cursor: pointer !important;
  transition: all 0.15s !important;
}
.sfdt-scope-btn:hover { color: #e1e4e8 !important; }
.sfdt-scope-btn.active {
  background: #58a6ff !important;
  color: #ffffff !important;
}

/* Smart Insights */
.sfdt-insights-list {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
}
.sfdt-insight-item {
  display: flex !important;
  gap: 12px !important;
  padding: 12px 14px !important;
  border-radius: 8px !important;
  border-left: 3px solid transparent !important;
  background: rgba(13,17,23,0.4) !important;
  border: 1px solid var(--border) !important;
}
.sfdt-insight-critical {
  border-left: 3px solid #f85149 !important;
  background: rgba(248,81,73,0.06) !important;
  border-color: rgba(248,81,73,0.25) !important;
}
.sfdt-insight-warn {
  border-left: 3px solid #fbbf24 !important;
  background: rgba(251,191,36,0.05) !important;
  border-color: rgba(251,191,36,0.22) !important;
}
.sfdt-insight-icon {
  display: inline-flex !important;
  align-items: flex-start !important;
  justify-content: center !important;
  width: 18px !important;
  height: 18px !important;
  flex-shrink: 0 !important;
  margin-top: 2px !important;
}
.sfdt-insight-critical .sfdt-insight-icon { color: #f85149 !important; }
.sfdt-insight-warn .sfdt-insight-icon { color: #fbbf24 !important; }
.sfdt-insight-icon svg { width: 16px !important; height: 16px !important; }
.sfdt-insight-body { flex: 1 !important; min-width: 0 !important; }
.sfdt-insight-title {
  font-size: 12.5px !important;
  font-weight: 700 !important;
  color: #e1e4e8 !important;
  margin-bottom: 4px !important;
}
.sfdt-insight-detail {
  font-size: 11.5px !important;
  color: #c9d1d9 !important;
  line-height: 1.5 !important;
  margin-bottom: 6px !important;
  word-break: break-word !important;
}
.sfdt-insight-detail code {
  font-family: 'SF Mono', Monaco, Menlo, monospace !important;
  font-size: 10.5px !important;
  background: rgba(13,17,23,0.6) !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  color: #c084fc !important;
  display: inline-block !important;
  max-width: 100% !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  vertical-align: middle !important;
}
.sfdt-insight-fix {
  font-size: 11px !important;
  color: #8b949e !important;
  line-height: 1.5 !important;
  padding-top: 6px !important;
  border-top: 1px dashed rgba(110,118,129,0.25) !important;
}
.sfdt-insight-fix b { color: #58a6ff !important; }
.sfdt-insights-empty {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 14px 16px !important;
  font-size: 12px !important;
  color: #8b949e !important;
  background: rgba(34,197,94,0.06) !important;
  border: 1px solid rgba(34,197,94,0.2) !important;
  border-radius: 8px !important;
}
.sfdt-insights-empty .sfdt-insight-icon { margin-top: 0 !important; }

/* Legend */
.sfdt-limit-legend {
  background: rgba(110,118,129,0.04) !important;
  border: 1px dashed rgba(110,118,129,0.3) !important;
  border-radius: 10px !important;
  padding: 14px 16px !important;
  margin-top: 6px !important;
}
.sfdt-legend-title {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  color: #8b949e !important;
  margin-bottom: 10px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}
.sfdt-legend-icon { display: inline-flex !important; color: #58a6ff !important; width: 14px !important; height: 14px !important; }
.sfdt-legend-icon svg { width: 14px !important; height: 14px !important; }
.sfdt-legend-grid {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)) !important;
  gap: 8px 16px !important;
}
.sfdt-legend-item {
  font-size: 11px !important;
  color: #8b949e !important;
  line-height: 1.5 !important;
}
.sfdt-legend-item code {
  font-family: 'SF Mono', Monaco, Menlo, monospace !important;
  font-size: 10.5px !important;
  background: rgba(110,118,129,0.15) !important;
  padding: 1px 5px !important;
  border-radius: 3px !important;
  color: #e1e4e8 !important;
}


/* ─── Flame Chart ─── */
.sfdt-flame-wrap { padding: 12px 16px; overflow-x: auto; overflow-y: auto; height: 100%; }
.sfdt-flame-axis {
  position: relative;
  height: 22px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.sfdt-flame-tick {
  position: absolute;
  bottom: 4px;
  font-size: 9px;
  color: #6e7681;
  transform: translateX(-50%);
  font-variant-numeric: tabular-nums;
}
.sfdt-flame-chart { min-width: 100%; }
.sfdt-flame-bar {
  position: absolute;
  border-radius: 3px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  min-width: 2px;
  transition: opacity 0.1s;
  box-sizing: border-box;
}
.sfdt-flame-bar:hover { opacity: 0.8; z-index: 1; }
.sfdt-flame-err { box-shadow: inset 0 0 0 1px rgba(248,81,73,0.5); }
.sfdt-flame-lbl {
  font-size: 9px;
  color: #e1e4e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}
.sfdt-flame-dur {
  font-size: 9px;
  color: #8b949e;
  flex-shrink: 0;
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.sfdt-flame-legend {
  display: flex;
  gap: 14px;
  padding: 10px 0 4px;
  flex-wrap: wrap;
}
.sfdt-flame-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #8b949e;
}
.sfdt-flame-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

/* ─── Call Tree (enhanced) ─── */
.sfdt-ct-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px;
  font-size: 10px;
  color: #6e7681;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
  font-weight: 600;
}
.sfdt-ct-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.sfdt-ct-row:hover { background: rgba(88,166,255,0.08); }
.sfdt-ct-col-name { flex: 1; display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; }
.sfdt-ct-col-total { width: 58px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; font-size: 11px; }
.sfdt-ct-col-self { width: 54px; text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; font-size: 11px; }
.sfdt-ct-col-badge { width: 36px; text-align: center; flex-shrink: 0; }
.sfdt-ct-col-line { width: 42px; text-align: right; color: #6e7681; font-size: 10px; flex-shrink: 0; }

/* ─── Analysis Table ─── */
.sfdt-analysis-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.sfdt-analysis-table thead th {
  text-align: left;
  padding: 6px 8px;
  font-size: 10px;
  font-weight: 600;
  color: #6e7681;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 1;
}
.sfdt-an-sort { cursor: pointer; user-select: none; }
.sfdt-an-sort:hover { color: #58a6ff; }
.sfdt-analysis-table tbody tr { border-bottom: 1px solid rgba(110,118,129,0.06); }
.sfdt-analysis-table tbody tr:hover { background: rgba(88,166,255,0.06); }
.sfdt-analysis-table td {
  padding: 5px 8px;
  color: #e1e4e8;
  vertical-align: middle;
}
.sfdt-an-name {
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  max-width: 350px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sfdt-an-num { text-align: right !important; font-variant-numeric: tabular-nums; }
.sfdt-an-type {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}
.sfdt-an-type-method { background: rgba(34,197,94,0.12); color: #22c55e; }
.sfdt-an-type-trigger { background: rgba(88,166,255,0.12); color: #58a6ff; }
.sfdt-an-type-flow { background: rgba(192,132,252,0.12); color: #c084fc; }
.sfdt-an-type-soql { background: rgba(251,191,36,0.12); color: #fbbf24; }
.sfdt-an-type-dml { background: rgba(250,179,135,0.12); color: #d29922; }
.sfdt-an-type-other { background: rgba(110,118,129,0.12); color: #6e7681; }
.sfdt-analysis-export {
  cursor: pointer;
}

/* ─── Database Table ─── */
.sfdt-db-table { margin-bottom: 8px; }
.sfdt-db-table thead th { font-size: 10px; }
.sfdt-db-query-cell {
  max-width: 350px;
}
.sfdt-db-query-cell code {
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 10px;
  color: #c084fc;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sfdt-db-row-clickable { cursor: pointer; }
.sfdt-db-row-clickable:hover { background: rgba(88,166,255,0.08); }
.sfdt-db-sub-row { opacity: 0.7; }

/* Raw log */
.sfdt-raw-log {
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  line-height: 1.6;
}
.sfdt-log-line {
  display: flex;
  padding: 0 12px;
  min-height: 20px;
  align-items: flex-start;
}
.sfdt-log-line:hover { background: rgba(88,166,255,0.04); }
.sfdt-log-num {
  width: 48px;
  text-align: right;
  color: #383e4a;
  flex-shrink: 0;
  padding-right: 12px;
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.sfdt-log-text { flex: 1; word-break: break-all; color: #8b949e; }
.sfdt-log-user_debug .sfdt-log-text { color: #58a6ff; }
.sfdt-log-error .sfdt-log-text { color: #f85149; background: rgba(248,81,73,0.06); }
.sfdt-log-warn .sfdt-log-text { color: #fbbf24; }
.sfdt-log-soql .sfdt-log-text { color: #c084fc; }
.sfdt-log-dml .sfdt-log-text { color: #fbbf24; }
.sfdt-log-method .sfdt-log-text { color: #22c55e; }
.sfdt-log-limit .sfdt-log-text { color: #2dd4bf; }
.sfdt-highlight { background: rgba(251,191,36,0.3); color: #fbbf24; border-radius: 2px; }

/* ─── Data Builder ─── */
.sfdt-db { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

/* Toolbar */
.sfdt-db-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px; border-bottom: 1px solid rgba(110,118,129,0.12);
  background: rgba(15,20,25,0.3); flex-shrink: 0;
}
.sfdt-db-tl-left { display: flex; align-items: center; gap: 8px; }
.sfdt-db-tl-title { font-size: 13px; font-weight: 700; color: #e1e4e8; letter-spacing: -0.01em; }
.sfdt-db-tl-badge {
  font-size: 10px; color: #58a6ff; background: rgba(88,166,255,0.12);
  padding: 1px 7px; border-radius: 10px; font-weight: 600;
}
.sfdt-db-tl-right { display: flex; align-items: center; gap: 6px; }
.sfdt-db-tl-sep { width: 1px; height: 18px; background: rgba(110,118,129,0.15); margin: 0 4px; }
.sfdt-db-recipe-sel {
  background: rgba(110,118,129,0.08); color: #8b949e; border: 1px solid rgba(110,118,129,0.12);
  border-radius: 6px; padding: 4px 8px; font-size: 11px; max-width: 160px; cursor: pointer;
}
.sfdt-db-recipe-sel:hover { border-color: rgba(88,166,255,0.3); }
.sfdt-db-recipe-sel:focus { border-color: rgba(88,166,255,0.5); outline: none; }
.sfdt-db-tbtn {
  padding: 4px 10px; border-radius: 6px; border: none;
  background: rgba(110,118,129,0.08); color: #8b949e; font-size: 11px;
  cursor: pointer; font-weight: 500; transition: all 0.15s;
}
.sfdt-db-tbtn:hover { background: rgba(110,118,129,0.15); color: #e1e4e8; }
.sfdt-db-tbtn:disabled { opacity: 0.3; pointer-events: none; }
.sfdt-db-tbtn-dim { color: #6e7681; }
.sfdt-db-go-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 14px; border-radius: 6px; border: none;
  background: rgba(88,166,255,0.15); color: #58a6ff; font-size: 11px;
  font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.sfdt-db-go-btn:hover { background: rgba(88,166,255,0.25); }
.sfdt-db-go-btn:disabled { opacity: 0.3; pointer-events: none; }

/* Body */
.sfdt-db-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 14px 18px; }

/* Empty state */
.sfdt-db-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 20px; text-align: center;
}
.sfdt-db-empty-ico { margin-bottom: 14px; color: #383e4a; }
.sfdt-db-empty-h { font-size: 14px; font-weight: 600; color: #e1e4e8; margin-bottom: 4px; }
.sfdt-db-empty-p { font-size: 12px; color: #6e7681; margin-bottom: 8px; line-height: 1.5; }
.sfdt-db-empty-tip { font-size: 11px; color: #383e4a; }
.sfdt-db-empty-tip b { color: #58a6ff; }

/* ── Quick-start templates ────────────────────────── */
.sfdt-db-templates {
  margin-bottom: 4px; padding: 0 4px;
}
.sfdt-db-tpl-grid {
  display: flex; flex-direction: column; gap: 6px;
}
.sfdt-db-tpl-btn {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-radius: 10px;
  border: 1px dashed rgba(88,166,255,0.2);
  background: rgba(88,166,255,0.03); color: #8b949e;
  cursor: pointer; transition: all 0.2s; text-align: left;
}
.sfdt-db-tpl-btn:hover {
  border-color: rgba(88,166,255,0.35); border-style: solid;
  background: rgba(88,166,255,0.08); transform: translateX(2px);
}
.sfdt-db-tpl-icon { font-size: 24px; flex-shrink: 0; }
.sfdt-db-tpl-info { display: flex; flex-direction: column; gap: 1px; }
.sfdt-db-tpl-name { font-size: 12px; font-weight: 700; color: #e1e4e8; }
.sfdt-db-tpl-desc { font-size: 10px; color: #383e4a; line-height: 1.35; }

/* ── Root cards (big buttons) ─────────────────────── */
.sfdt-db-root-cards {
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid rgba(110,118,129,0.08);
}
.sfdt-db-root-label {
  font-size: 11px; font-weight: 600; color: #383e4a; text-transform: uppercase;
  letter-spacing: 0.06em; margin-bottom: 8px;
}
.sfdt-db-root-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px;
}
.sfdt-db-root-btn {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 14px 16px; border-radius: 10px;
  border: 1px solid rgba(110,118,129,0.1);
  background: rgba(15,20,25,0.4); color: #8b949e;
  cursor: pointer; transition: all 0.2s; text-align: left;
}
.sfdt-db-root-btn:hover {
  border-color: rgba(88,166,255,0.25); background: rgba(88,166,255,0.06);
  transform: translateY(-1px); box-shadow: 0 2px 12px rgba(0,0,0,0.15);
}
.sfdt-db-root-btn-icon { font-size: 22px; margin-bottom: 2px; }
.sfdt-db-root-btn-name { font-size: 12px; font-weight: 700; color: #e1e4e8; }
.sfdt-db-root-btn-desc { font-size: 10px; color: #383e4a; line-height: 1.35; }

/* ── Pill (inline small buttons) ──────────────────── */
.sfdt-db-pill {
  padding: 5px 11px; border-radius: 14px;
  border: 1px solid rgba(110,118,129,0.1);
  background: rgba(110,118,129,0.04); color: #8b949e; font-size: 11px;
  font-weight: 500; cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.sfdt-db-pill:hover {
  background: rgba(88,166,255,0.08); border-color: rgba(88,166,255,0.2); color: #58a6ff;
}

/* ── Tree structure & connector lines ─────────────── */
.sfdt-db-tree { position: relative; }

.sfdt-db-tree-row {
  display: flex; align-items: flex-start; min-height: 36px;
}

.sfdt-db-tree-indent {
  display: flex; flex-shrink: 0; align-self: stretch;
}

/* Vertical pipe for ancestor levels */
.sfdt-db-tree-pipe {
  display: block; width: 24px; flex-shrink: 0; position: relative;
}
.sfdt-db-tree-pipe::before {
  content: ''; position: absolute; left: 11px; top: 0; bottom: 0;
  width: 1px; background: rgba(110,118,129,0.15);
}

/* Branch connector: vertical + horizontal */
.sfdt-db-tree-branch {
  display: block; width: 24px; flex-shrink: 0; position: relative; min-height: 36px;
}
.sfdt-db-tree-branch::before {
  content: ''; position: absolute; left: 11px; top: 0; bottom: 0;
  width: 1px; background: rgba(110,118,129,0.15);
}
.sfdt-db-tree-branch::after {
  content: ''; position: absolute; left: 11px; top: 17px;
  width: 12px; height: 1px; background: rgba(110,118,129,0.15);
}

/* Last child: elbow (vertical stops at branch point) */
.sfdt-db-tree-elbow::before {
  bottom: auto; height: 18px;
}

/* Hide vertical continuation on last rows at root level */
.sfdt-db-tree-last > .sfdt-db-tree-indent > .sfdt-db-tree-pipe:last-child::before,
.sfdt-db-tree-last > .sfdt-db-tree-indent > .sfdt-db-tree-elbow::before {
  /* elbow already handled, but keep pipe for deeply nested */
}

/* ── Tree node card ───────────────────────────────── */
.sfdt-db-node {
  flex: 1; min-width: 0; max-width: 600px;
  border: 1px solid rgba(110,118,129,0.08); border-radius: 8px;
  background: rgba(15,20,25,0.35); margin-bottom: 4px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.sfdt-db-node:hover { border-color: rgba(110,118,129,0.15); }
.sfdt-db-node.ok { border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.02); }
.sfdt-db-node.fail { border-color: rgba(248,81,73,0.2); background: rgba(248,81,73,0.02); }
.sfdt-db-node.run { border-color: rgba(88,166,255,0.3); box-shadow: 0 0 10px rgba(88,166,255,0.05); }
.sfdt-db-node-existing { border-style: dashed; }

/* Color dot */
.sfdt-db-node-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}

/* Existing tag */
.sfdt-db-node-existing-tag {
  font-size: 9px; color: #383e4a; background: rgba(110,118,129,0.1);
  padding: 1px 6px; border-radius: 3px; font-weight: 600; flex-shrink: 0;
  text-transform: uppercase; letter-spacing: 0.04em;
}

/* Add child dot */
.sfdt-db-acb-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}

/* Node header */
.sfdt-db-node-hd {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; cursor: pointer; transition: background 0.1s;
  min-height: 36px;
}
.sfdt-db-node-hd:hover { background: rgba(110,118,129,0.04); border-radius: 7px 7px 0 0; }
.sfdt-db-node-arrow {
  width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #383e4a; cursor: pointer;
  font-size: 12px; flex-shrink: 0; padding: 0;
}
.sfdt-db-node-arrow:hover { color: #8b949e; }
.sfdt-db-node-arrow-ph { width: 18px; flex-shrink: 0; }
.sfdt-db-node-icon { font-size: 14px; flex-shrink: 0; line-height: 1; }
.sfdt-db-node-seq {
  font-size: 10px; color: #383e4a; font-weight: 600; flex-shrink: 0;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}
.sfdt-db-node-name {
  font-size: 12px; font-weight: 600; color: #e1e4e8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
.sfdt-db-node-tag {
  font-size: 9px; color: #6e7681; background: rgba(110,118,129,0.08);
  padding: 1px 6px; border-radius: 3px; flex-shrink: 0;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}
.sfdt-db-node-cnt { font-size: 9px; color: #383e4a; flex-shrink: 0; }

/* Status icons */
.sfdt-db-node-ok {
  font-size: 11px; color: #22c55e; font-weight: 700; flex-shrink: 0; cursor: default;
}
.sfdt-db-node-link {
  font-size: 11px; color: #58a6ff; font-weight: 700; flex-shrink: 0; cursor: default;
}
.sfdt-db-node-err {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
  background: rgba(248,81,73,0.15); color: #f85149;
  font-size: 10px; font-weight: 700; cursor: default;
}

/* Node tools (hover reveal) */
.sfdt-db-node-tools {
  display: flex; align-items: center; gap: 1px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.15s;
}
.sfdt-db-node-hd:hover .sfdt-db-node-tools { opacity: 1; }
.sfdt-db-node-tb {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 4px; border: none;
  background: transparent; color: #383e4a; cursor: pointer;
  font-size: 11px; transition: all 0.1s;
}
.sfdt-db-node-tb:hover { background: rgba(110,118,129,0.1); color: #8b949e; }
.sfdt-db-node-rm:hover { background: rgba(248,81,73,0.1); color: #f85149; }
.sfdt-db-dup-node:hover { background: rgba(88,166,255,0.1); color: #58a6ff; }

/* Add child dropdown */
.sfdt-db-add-child-wrap { position: relative; display: inline-flex; }
.sfdt-db-add-child-menu {
  display: none; position: absolute; top: 100%; right: 0; z-index: 10;
  background: rgba(30,30,46,0.97); border: 1px solid rgba(110,118,129,0.15);
  border-radius: 8px; padding: 4px; min-width: 180px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  flex-direction: column; gap: 2px;
}
.sfdt-db-add-child-menu.sfdt-db-menu-open { display: flex; }
.sfdt-db-add-child-wrap:hover .sfdt-db-add-child-menu { display: flex; }
.sfdt-db-add-child-btn {
  display: flex; align-items: center; gap: 6px; padding: 5px 10px;
  border: none; border-radius: 5px; background: transparent;
  color: #8b949e; font-size: 11px; cursor: pointer; white-space: nowrap;
  transition: background 0.1s;
}
.sfdt-db-add-child-btn:hover { background: rgba(88,166,255,0.1); color: #58a6ff; }
.sfdt-db-use-existing-btn {
  border-top: 1px solid rgba(110,118,129,0.08);
  margin-top: 2px; padding-top: 6px;
  color: #6e7681; font-style: italic;
}
.sfdt-db-use-existing-btn:hover { color: #c084fc; background: rgba(192,132,252,0.08); }

/* Node results */
.sfdt-db-node-res-ok {
  padding: 2px 10px 4px 44px; font-size: 10px; color: #22c55e;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}
.sfdt-db-node-res-fail {
  padding: 2px 10px 4px 44px; font-size: 10px; color: #f85149;
  background: rgba(248,81,73,0.04); border-radius: 0 0 7px 7px;
}

/* Node body (expanded form) — constrained width */
.sfdt-db-node-bd {
  padding: 10px 14px 14px 48px; max-width: 580px;
  border-top: 1px solid rgba(110,118,129,0.05);
}

/* Preview (collapsed summary) */
.sfdt-db-pv { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 4px 14px 8px 48px; }
.sfdt-db-pv-item { font-size: 10px; color: #6e7681; }
.sfdt-db-pv-k { color: #383e4a; margin-right: 3px; }
.sfdt-db-pv-more { font-size: 10px; color: #383e4a; font-style: italic; }

/* Child hint bar (inline add for empty expanded nodes) */
.sfdt-db-child-hint {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
  padding: 6px 0 4px 0; flex: 1; min-width: 0;
}
.sfdt-db-child-hint-txt { font-size: 10px; color: #383e4a; }

/* Link record section */
.sfdt-db-link-section {
  margin-top: 8px; padding-top: 8px;
  border-top: 1px dashed rgba(110,118,129,0.1);
}
.sfdt-db-link-hdr {
  font-size: 10px; font-weight: 600; color: #58a6ff; margin-bottom: 6px;
}

/* Read-only object label */
.sfdt-db-obj-ro {
  flex: 1; font-size: 11px; color: #6e7681; padding: 5px 8px;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}

/* Form rows (shared) */
.sfdt-db-row {
  display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
}
.sfdt-db-lbl {
  width: 140px; flex-shrink: 0; font-size: 11px; color: #8b949e; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sfdt-db-lbl-req::after { content: ' *'; color: #f85149; font-weight: 700; }
.sfdt-db-inp {
  flex: 1; max-width: 350px; background: rgba(110,118,129,0.06); color: #e1e4e8;
  border: 1px solid rgba(110,118,129,0.12); border-radius: 6px;
  padding: 7px 10px; font-size: 11px;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  transition: border-color 0.15s;
}
.sfdt-db-inp:focus { border-color: rgba(88,166,255,0.4); outline: none; box-shadow: 0 0 0 2px rgba(88,166,255,0.06); }
.sfdt-db-inp-ref { color: #fbbf24; border-color: rgba(251,191,36,0.2); }
.sfdt-db-inp-ref:focus { border-color: rgba(251,191,36,0.4); box-shadow: 0 0 0 2px rgba(251,191,36,0.06); }
.sfdt-db-obj-input { font-weight: 500; }

.sfdt-db-frow { border-radius: 6px; padding: 4px 6px; transition: background 0.1s; }
.sfdt-db-frow:hover { background: rgba(110,118,129,0.03); }
.sfdt-db-frow-ref { background: rgba(251,191,36,0.03); }
.sfdt-db-frow-ref:hover { background: rgba(251,191,36,0.06); }

.sfdt-db-loadbtn {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 6px; border: 1px solid rgba(88,166,255,0.15);
  background: rgba(88,166,255,0.06); color: #58a6ff; font-size: 11px;
  font-weight: 500; cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.sfdt-db-loadbtn:hover { background: rgba(88,166,255,0.12); border-color: rgba(88,166,255,0.25); }
.sfdt-db-loadbtn:disabled { opacity: 0.5; pointer-events: none; }

.sfdt-db-xbtn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex-shrink: 0; border-radius: 5px; border: none;
  background: transparent; color: #383e4a; cursor: pointer; opacity: 0;
  transition: all 0.15s; font-size: 11px;
}
.sfdt-db-frow:hover .sfdt-db-xbtn { opacity: 0.6; }
.sfdt-db-xbtn:hover { opacity: 1 !important; color: #f85149; background: rgba(248,81,73,0.08); }

.sfdt-db-nofields {
  padding: 12px 14px; color: #383e4a; font-size: 11px; text-align: center; line-height: 1.5;
}
.sfdt-db-nofields b { color: #58a6ff; font-weight: 600; }

.sfdt-db-picker-row { margin-top: 4px; }
.sfdt-db-field-picker {
  background: rgba(110,118,129,0.04); color: #6e7681; border: 1px dashed rgba(110,118,129,0.12);
  border-radius: 6px; padding: 5px 8px; font-size: 11px; max-width: 350px; cursor: pointer;
}
.sfdt-db-field-picker:hover { border-color: rgba(88,166,255,0.2); color: #8b949e; }
.sfdt-db-field-picker:focus { border-color: rgba(88,166,255,0.4); outline: none; }

@keyframes sfdt-pulse { 50% { opacity: 0.4; } }

/* ─── Execute Anonymous Panel ─── */
.sfdt-execanon-panel {
  /* Override default bottom panel height for exec anon */
}
.sfdt-execanon-layout {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.sfdt-execanon-editor-wrap {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  flex: 1;
  min-width: 0;
}
.sfdt-execanon-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg2);
  flex-shrink: 0;
}
.sfdt-execanon-textarea {
  width: 100%;
  flex: 1;
  padding: 14px 16px;
  background: var(--bg);
  color: #e1e4e8;
  border: none;
  border-left: 2px solid rgba(88,166,255,0.2);
  outline: none;
  resize: none;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
  tab-size: 4;
}
.sfdt-execanon-textarea::placeholder { color: #383e4a; }
.sfdt-execanon-textarea:focus { box-shadow: inset 0 0 0 1px rgba(88,166,255,0.3); }
.sfdt-execanon-run-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.sfdt-btn-run {
  padding: 6px 18px !important;
  font-weight: 600 !important;
  gap: 6px;
}
.sfdt-btn-run svg { width: 14px; height: 14px; }
.sfdt-execanon-status {
  font-size: 12px;
  font-weight: 500;
}
.sfdt-execanon-status.running { color: #58a6ff; }
.sfdt-execanon-status.success { color: #22c55e; }
.sfdt-execanon-status.error { color: #f85149; }

.sfdt-execanon-results-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.sfdt-execanon-results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sfdt-execanon-results-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.sfdt-exec-raw-log { overflow-y: auto; flex: 1; }
.sfdt-exec-error {
  padding: 16px;
  background: rgba(248,81,73,0.06);
  border-left: 3px solid #f85149;
  margin: 12px;
  border-radius: 6px;
}
.sfdt-exec-error-title { font-size: 14px; font-weight: 600; color: #f85149; margin-bottom: 8px; }
.sfdt-exec-error-msg { font-size: 12px; color: #e1e4e8; font-family: 'SF Mono', Monaco, Menlo, monospace; margin-bottom: 6px; }
.sfdt-exec-error-loc { font-size: 11px; color: #fbbf24; }
.sfdt-exec-stacktrace {
  font-size: 11px;
  color: #8b949e;
  white-space: pre-wrap;
  padding: 8px 12px;
  background: var(--bg);
  border-radius: 4px;
  margin-top: 8px;
  max-height: 150px;
  overflow-y: auto;
}
.sfdt-exec-success {
  padding: 16px;
  background: rgba(34,197,94,0.06);
  border-left: 3px solid #22c55e;
  margin: 12px;
  border-radius: 6px;
}
.sfdt-exec-success-title { font-size: 14px; font-weight: 600; color: #22c55e; }
.sfdt-exec-debugs { padding: 0 12px 12px; }
.sfdt-exec-debug-line {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 3px 0;
  font-size: 11px;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}

/* Dropdown panels (snippets, history) */
.sfdt-dropdown-panel {
  position: absolute;
  top: 45px;
  right: 10px;
  width: 320px;
  max-height: 350px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideDown 0.12s ease-out;
}
.sfdt-dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.sfdt-dropdown-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.sfdt-snippet-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}
.sfdt-snippet-item:hover { background: rgba(88,166,255,0.06); }
.sfdt-snippet-info { flex: 1; min-width: 0; }
.sfdt-snippet-name {
  display: block;
  font-size: 12px;
  color: #e1e4e8;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sfdt-snippet-preview {
  display: block;
  font-size: 10px;
  color: #6e7681;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}
.sfdt-btn-danger { color: #f85149 !important; }
.sfdt-btn-danger:hover { background: rgba(248,81,73,0.15) !important; }

/* ─── SOQL CRUD ─── */
.sfdt-actions-th {
  width: 90px;
  min-width: 90px;
  text-align: center;
  font-size: 11px !important;
  color: #6e7681 !important;
}
.sfdt-actions-cell {
  text-align: center;
  white-space: nowrap;
  padding: 2px 4px !important;
}
.sfdt-row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #6e7681;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.12s;
  padding: 0;
  margin: 0 1px;
}
.sfdt-row-edit:hover { color: #58a6ff; background: rgba(88,166,255,0.1); border-color: rgba(88,166,255,0.2); }
.sfdt-row-clone:hover { color: #22c55e; background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.2); }
.sfdt-row-delete:hover { color: #f85149; background: rgba(248,81,73,0.1); border-color: rgba(248,81,73,0.2); }
.sfdt-btn-create {
  color: #22c55e !important;
  border-color: rgba(34,197,94,0.3) !important;
}
.sfdt-btn-create:hover { background: rgba(34,197,94,0.1) !important; }

/* CRUD Modal */
.sfdt-crud-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}
.sfdt-crud-modal {
  width: 720px;
  max-width: 92%;
  max-height: 85%;
  min-height: 350px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideDown 0.15s ease-out;
}
.sfdt-crud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}
.sfdt-crud-title {
  font-size: 16px;
  font-weight: 600;
  color: #58a6ff;
}
.sfdt-crud-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sfdt-crud-field {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--border) !important;
  border-radius: 6px !important;
  background: var(--bg2) !important;
  margin-bottom: 2px;
  transition: border-color 0.15s;
}
.sfdt-crud-field:hover {
  border-color: rgba(88,166,255,0.3) !important;
  background: rgba(30,30,46,0.8) !important;
}
.sfdt-crud-label {
  width: 220px;
  min-width: 180px;
  font-size: 13px;
  font-weight: 500;
  color: #58a6ff;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}
.sfdt-crud-input {
  flex: 1;
  padding: 9px 12px;
  background: var(--bg2);
  color: #e1e4e8;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  outline: none;
  transition: border-color 0.15s;
}
.sfdt-crud-input:focus { border-color: rgba(88,166,255,0.5); box-shadow: 0 0 0 2px rgba(88,166,255,0.1); }
.sfdt-crud-input.sfdt-crud-required { border-left: 2px solid #f85149; }
.sfdt-crud-filter:focus { border-color: rgba(88,166,255,0.5); box-shadow: 0 0 0 2px rgba(88,166,255,0.1); }
.sfdt-loading { color: #58a6ff; font-size: 13px; }
.sfdt-crud-footer {
  padding: 10px 20px;
  font-size: 13px;
  min-height: 36px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
}

/* Responsive */
@media (max-width: 800px) {
  .sfdt-dialog { width: 95vw; margin-top: 5vh; max-height: 80vh; }
  .sfdt-panel-right { width: 100vw; max-width: 100vw; }
  .sfdt-panel-bottom { height: 60vh; }
}
`;
  }

  /**
   * Initialize drag-to-resize on a panel.
   * @param {HTMLElement} panel - The .sfdt-panel element
   * @param {string} direction - 'top' for bottom panels (drag from top edge), 'left' for right panels (drag from left edge)
   * @param {string} storageKey - localStorage key to persist the size
   */
  function initPanelResize(panel, direction, storageKey) {
    if (!panel) return;

    const handle = document.createElement('div');
    handle.className = direction === 'top' ? 'sfdt-resize-handle-top' : 'sfdt-resize-handle-left';
    panel.style.position = 'fixed'; // ensure fixed
    panel.insertBefore(handle, panel.firstChild);

    // Restore saved size — skip open animation when restoring a user-set size
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const size = parseInt(saved, 10);
        if (direction === 'top' && size >= 200 && size <= window.innerHeight * 0.92) {
          panel.style.height = size + 'px';
          panel.style.animation = 'none';
        } else if (direction === 'left' && size >= 280 && size <= window.innerWidth * 0.8) {
          panel.style.width = size + 'px';
          panel.style.animation = 'none';
        }
      }
    } catch (_) {}

    let startY = 0, startX = 0, startSize = 0, dragging = false;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      handle.classList.add('active');
      panel.classList.add('resizing');

      if (direction === 'top') {
        startY = e.clientY;
        startSize = panel.offsetHeight;
      } else {
        startX = e.clientX;
        startSize = panel.offsetWidth;
      }

      const onMouseMove = (e) => {
        if (!dragging) return;
        if (direction === 'top') {
          const delta = startY - e.clientY;
          const newH = Math.max(200, Math.min(window.innerHeight * 0.92, startSize + delta));
          panel.style.height = newH + 'px';
          // Clear expanded class when manually resizing
          panel.classList.remove('expanded');
        } else {
          const delta = startX - e.clientX;
          const newW = Math.max(280, Math.min(window.innerWidth * 0.8, startSize + delta));
          panel.style.width = newW + 'px';
        }
      };

      const onMouseUp = () => {
        dragging = false;
        handle.classList.remove('active');
        panel.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Save size
        try {
          const size = direction === 'top' ? panel.offsetHeight : panel.offsetWidth;
          localStorage.setItem(storageKey, String(size));
        } catch (_) {}
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  return { getOrCreate, remove, initPanelResize };
})();

if (typeof window !== 'undefined') window.SFDTShadowHelper = SFDTShadowHelper;
