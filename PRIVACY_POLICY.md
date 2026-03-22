# Privacy Policy

**Advanced Salesforce Developer Toolkit**
**Last Updated:** March 22, 2026

## Overview

Advanced Salesforce Developer Toolkit ("the Extension") is a Chrome browser extension that provides developer productivity tools for Salesforce. This privacy policy explains what data the Extension accesses, how it is used, and how it is protected.

## Data Collection

**The Extension does not collect, transmit, store remotely, or sell any user data.**

No personal information, usage analytics, telemetry, crash reports, or tracking data of any kind is gathered or sent to any external server, third-party service, or the Extension developer.

## Data Access

The Extension accesses the following data solely to provide its functionality, and all access occurs **locally within your browser**:

### Salesforce Session Cookie

- The Extension reads the Salesforce session identifier (`sid` cookie) from Salesforce domains to authenticate REST API and Tooling API calls to **your own Salesforce org**.
- The session cookie is used at runtime only and is **never stored persistently, logged, or transmitted** to any external service.

### Salesforce Org Data

- The Extension makes API calls to your Salesforce org to retrieve metadata (Apex classes, custom objects, fields, etc.), execute SOQL queries, run anonymous Apex code, and fetch debug logs.
- All API calls are made directly from your browser to your Salesforce org's API endpoints. **No data passes through any intermediary server.**

### Locally Stored Data

The Extension stores the following data in your browser's local storage (`chrome.storage.local` and `localStorage`):

- **Metadata cache:** Indexed metadata (object names, field names, Apex class names) for fast search
- **Query history:** Previously executed SOQL queries
- **Saved favorites:** User-saved SOQL queries and code snippets
- **Preferences:** Panel sizes, toolbar state, and display settings
- **Recent navigation:** Recently visited Salesforce setup pages (up to 20 entries)
- **Search history:** Recent search terms (up to 30 entries)

All locally stored data:
- Remains entirely on your device
- Is never transmitted to any external server
- Can be cleared at any time via the Extension's popup (Clear All Cache)
- Is automatically invalidated when the Extension version changes

## Data Sharing

**The Extension does not share any data with third parties.** Specifically:

- No data is sold, transferred, or disclosed to any third party
- No data is used for advertising, marketing, or profiling
- No data is sent to the Extension developer or any analytics service
- No remote servers are contacted other than your own Salesforce org's API endpoints

## Remote Code

The Extension does **not** load or execute any remote code. All JavaScript is bundled within the extension package. The Extension makes `fetch()` calls to Salesforce REST APIs for data retrieval but does not load, import, or evaluate any external JavaScript, WebAssembly, or dynamically fetched code.

## Permissions

The Extension requests the following Chrome permissions, each used solely for the purposes described:

| Permission | Purpose |
| --- | --- |
| `activeTab` | Detect whether the active tab is a Salesforce page and inject the toolkit UI |
| `storage` | Store preferences, metadata cache, query history, and snippets locally |
| `scripting` | Inject content scripts and toolkit panels into Salesforce pages |
| `tabs` | Detect page navigation and open Salesforce setup pages in new tabs |
| `cookies` | Read the Salesforce session cookie for API authentication |
| `webRequest` | Detect the active Salesforce session and API version |
| `clipboardWrite` | Copy field values, query results, and record IDs to clipboard |
| `contextMenus` | Provide right-click menu options for search, inspection, and SOQL |

### Host Permissions

The Extension requests access to Salesforce domains only:

- `*.salesforce.com`
- `*.force.com`
- `*.lightning.force.com`
- `*.my.salesforce.com`
- `*.sandbox.my.salesforce.com`
- `*.salesforce-setup.com`
- `*.visual.force.com`
- `*.visualforce.com`

No other websites are accessed.

## Security

- All communication with Salesforce uses HTTPS
- The Extension operates within Chrome's sandboxed extension environment
- UI components use Shadow DOM for complete isolation from page content
- No data is persisted outside of the user's local browser storage

## Children's Privacy

The Extension is not directed at children under 13 and does not knowingly collect any information from children.

## Changes to This Policy

If this privacy policy is updated, the changes will be reflected in the "Last Updated" date above. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/srikanthpullela/Advanced-Salesforce-Developer-Toolkit).
