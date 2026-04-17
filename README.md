# Advanced Salesforce Developer Toolkit

A comprehensive Chrome extension that supercharges your Salesforce development workflow. Access powerful developer tools directly from any Salesforce page — no more switching between tabs, windows, or external tools.

![Chrome Web Store](https://img.shields.io/badge/platform-Chrome-green) ![Manifest V3](https://img.shields.io/badge/manifest-v3-blue) ![License](https://img.shields.io/badge/license-MIT-brightgreen)

## Features

### 🔍 Global Search Palette — `Ctrl+Shift+P` / `Cmd+Shift+P`

A VS Code-style command palette for instant search across your entire Salesforce org.

- Search across **12+ categories**: Apex Classes, Triggers, LWC, Aura Components, Flows, Validation Rules, Custom Objects, Fields, Visualforce Pages, Reports, and Records
- Smart metadata indexing with automatic cache management
- Server-side SOSL code search for finding methods and classes
- Search history (up to 30 recent searches)
- Category chip filtering for quick result narrowing

### 🔎 Record Inspector — `Ctrl+Shift+X` / `Cmd+Shift+X`

Instantly inspect any Salesforce record with full field metadata.

- Auto-detects the current record from the URL (Lightning & Classic)
- View field labels, API names, values, types, and nullable status
- 4-way sorting: by Label, API Name, Type, or Has Value
- Filter fields by name, label, type, or value
- Inline field editing for writable fields
- Side-by-side record comparison
- JSON export and click-to-copy for any value

### 🧭 Smart Navigator — `Ctrl+Shift+Y` / `Cmd+Shift+Y`

One-stop navigation hub with **26+ built-in setup shortcuts**.

- Quick access to Object Manager, Apex Classes, Triggers, Flows, Lightning Components, Profiles, Permission Sets, Users, and more
- Fuzzy search across all metadata and setup pages
- Recent pages tracking (last 20 visited)
- Async code search with score-based relevance ranking

### 📊 SOQL Query Tool — `Ctrl+Shift+L` / `Cmd+Shift+L`

Full-featured SOQL editor with execution, analysis, and export.

- Syntax-aware editor with autocomplete for objects and fields
- Execute queries against REST API or Tooling API
- 10 built-in example queries to get started
- Real-time query analysis with performance hints
- Query history and favorites
- Export results as CSV, JSON, or copy to clipboard
- Smart table rendering with pagination

### 🐛 Debug Log Analyzer — `Ctrl+Shift+K` / `Cmd+Shift+K`

Advanced Apex debug log analysis with rich visualizations.

- Auto-loads last 50 debug logs with metadata
- **6 analysis views**: Summary, Flame Chart, Call Tree, Analysis, Database, and Raw
- Flame chart timeline visualization of execution spans
- Expandable call tree showing self-time vs. total-time per method
- SOQL/DML breakdown with counts, rows affected, and timing
- Filter by: Errors, Warnings, SOQL, DML, Methods, Limits, USER_DEBUG
- Auto-refresh every 5 seconds

### ⚡ Execute Anonymous Apex — `Ctrl+Shift+E` / `Cmd+Shift+E`

In-browser Apex code execution.

- Run Apex code directly from any Salesforce page
- Compile error detection with line/column info
- Runtime exception display with full stack trace
- Auto-fetches debug log after execution
- Save and manage reusable code snippets
- Execution history tracking

### 🏗️ Data Builder

CPQ-aware hierarchical record builder with a visual tree.

- Build connected record hierarchies (Bundles, Option Groups, Options, Attributes, Price Book Entries, Constraint Rules, Custom objects)
- Auto-wire parent IDs during execution
- Drag-to-reorder nodes
- Apttus CPQ namespace support (`Apttus_Config2__`)
- Batch execution in correct dependency order

## Additional Features

- **Floating toolbar** on all Salesforce pages with quick-access buttons
- **Right-click context menu** — search selected text, inspect record, open SOQL
- **Full Shadow DOM isolation** — zero style conflicts with Salesforce
- **Smart session detection** from cookies
- **Local caching** with version-based invalidation
- Works on all Salesforce domains: Lightning, Classic, Visualforce, and Sandbox

## Keyboard Shortcuts

| Action | Windows / Linux | Mac |
| --- | --- | --- |
| Search Palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| Record Inspector | `Ctrl+Shift+X` | `Cmd+Shift+X` |
| SOQL Query Tool | `Ctrl+Shift+L` | `Cmd+Shift+L` |
| Smart Navigator | `Ctrl+Shift+Y` | `Cmd+Shift+Y` |
| Debug Log Analyzer | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| Execute Anonymous | `Ctrl+Shift+E` | `Cmd+Shift+E` |
| Close Active Panel | `Escape` | `Escape` |

## Installation

### From Chrome Web Store

1. Visit the [Chrome Web Store listing](#) (link coming soon)
2. Click **Add to Chrome**
3. Navigate to any Salesforce page — the toolkit toolbar will appear automatically

### Manual Installation (Developer Mode)

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `dist/` folder
5. Navigate to any Salesforce page

## Supported Salesforce Domains

- `*.salesforce.com`
- `*.force.com`
- `*.lightning.force.com`
- `*.my.salesforce.com`
- `*.sandbox.my.salesforce.com`
- `*.salesforce-setup.com`
- `*.visual.force.com`
- `*.visualforce.com`

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Detect Salesforce pages and inject toolkit UI |
| `storage` | Persist preferences, cached metadata, query history, and snippets locally |
| `scripting` | Inject content scripts and toolkit components into Salesforce pages |
| `tabs` | Detect navigation and open setup/metadata pages in new tabs |
| `cookies` | Read the Salesforce session cookie (sid) for API authentication |
| `webRequest` | Detect active Salesforce session and API version |
| `clipboardWrite` | Copy field values, query results, and record IDs to clipboard |
| `contextMenus` | Right-click menu items for search, inspect, and SOQL |

## Privacy

This extension:

- **Does not collect, transmit, or sell any user data**
- All data (metadata cache, query history, preferences) is stored **locally** in your browser
- The Salesforce session cookie is read at runtime for API calls and is **never stored or sent externally**
- No analytics, telemetry, or tracking of any kind

See our full [Privacy Policy](https://github.com/srikanthpullela/Advanced-Salesforce-Developer-Toolkit/blob/main/PRIVACY_POLICY.md) for details.

## Tech Stack

- **Manifest Version 3** (MV3 compliant)
- Vanilla JavaScript — no external frameworks or dependencies
- Shadow DOM for complete CSS isolation
- Chrome Storage & localStorage APIs for caching
- Salesforce REST API & Tooling API

## License

MIT License — see [LICENSE](LICENSE) for details.
