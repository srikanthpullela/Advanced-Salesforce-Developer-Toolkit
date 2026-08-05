// ══════════════════════════════════════════════════════════════
// Google Apps Script — Receives BOTH install telemetry AND usage analytics
//
// HOW TO UPDATE YOUR EXISTING APPS SCRIPT:
// 1. Go to your existing Google Sheet (the one already receiving installs)
// 2. Extensions → Apps Script
// 3. Replace the existing doPost() function with this code
// 4. Click Deploy → Manage Deployments → Edit (pencil icon) → Version: New → Deploy
//
// This will:
// - Continue logging installs to "Installs" sheet (existing behavior)
// - Log feature usage data to a new "Usage" sheet (automatically created)
// ══════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === 'usage') {
      // ─── Feature Usage Analytics ───
      let sheet = ss.getSheetByName('Usage');
      if (!sheet) {
        sheet = ss.insertSheet('Usage');
        sheet.appendRow([
          'Timestamp', 'Org ID', 'Extension Version', 'Sessions',
          'Last Active', 'First Seen',
          // Feature opens
          'Search Opens', 'Inspector Opens', 'SOQL Opens',
          'Navigator Opens', 'Debug Log Opens', 'Exec Anon Opens',
          // Search actions
          'Search Queries', 'Search Navigates',
          // SOQL actions
          'SOQL Runs', 'SOQL Export CSV', 'SOQL Export JSON',
          'SOQL SOSL', 'SOQL Explain', 'SOQL Select All Fields',
          'SOQL Apex', 'SOQL Inline Edit', 'SOQL Import',
          'SOQL Template', 'SOQL Schema', 'SOQL Chart',
          'SOQL Sort', 'SOQL Diff', 'SOQL Relationship',
          'SOQL Picklist', 'SOQL New Tab', 'SOQL Keyboard',
          'SOQL History Search',
          // Inspector actions
          'Inspector Edits', 'Inspector Impact', 'Inspector Graph',
          'Inspector Compare', 'Inspector JSON',
          // Navigator actions
          'Navigator Navigates',
          // Other actions
          'Exec Anon Runs', 'Debug Log Views', 'Debug Log Analyze'
        ]);
        // Bold header
        sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }

      sheet.appendRow([
        data.timestamp || new Date().toISOString(),
        data.orgId || '',
        data.extensionVersion || '',
        data.sessions || 0,
        data.lastActive || '',
        data.firstSeen || '',
        // Feature opens
        data.search_open || 0,
        data.inspector_open || 0,
        data.soql_open || 0,
        data.navigator_open || 0,
        data.debuglog_open || 0,
        data.execanon_open || 0,
        // Search actions
        data.search_query || 0,
        data.search_navigate || 0,
        // SOQL actions
        data.soql_run || 0,
        data.soql_export_csv || 0,
        data.soql_export_json || 0,
        data.soql_sosl || 0,
        data.soql_explain || 0,
        data.soql_selectAllFields || 0,
        data.soql_apex || 0,
        data.soql_inlineEdit || 0,
        data.soql_import || 0,
        data.soql_template || 0,
        data.soql_schema || 0,
        data.soql_chart || 0,
        data.soql_sort || 0,
        data.soql_diff || 0,
        data.soql_relationship || 0,
        data.soql_picklist || 0,
        data.soql_newTab || 0,
        data.soql_keyboard || 0,
        data.soql_historySearch || 0,
        // Inspector actions
        data.inspector_edit || 0,
        data.inspector_impact || 0,
        data.inspector_graph || 0,
        data.inspector_compare || 0,
        data.inspector_json || 0,
        // Navigator actions
        data.navigator_navigate || 0,
        // Other actions
        data.execanon_run || 0,
        data.debuglog_view || 0,
        data.debuglog_analyze || 0
      ]);

    } else {
      // ─── Install Telemetry (existing behavior) ───
      let sheet = ss.getSheetByName('Installs');
      if (!sheet) {
        sheet = ss.getSheets()[0]; // Use first sheet
        if (sheet.getName() === 'Sheet1') sheet.setName('Installs');
      }

      // Check if header row exists
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          'Timestamp', 'Org ID', 'Company Name', 'Org Type',
          'Is Sandbox', 'Instance URL', 'City', 'Country',
          'Installed Packages', 'Extension Version'
        ]);
        sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }

      sheet.appendRow([
        data.timestamp || new Date().toISOString(),
        data.orgId || '',
        data.companyName || '',
        data.orgType || '',
        data.isSandbox || false,
        data.instanceUrl || '',
        data.city || '',
        data.country || '',
        data.installedPackages || '',
        data.extensionVersion || ''
      ]);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'ok' })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Allow GET requests for testing
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', message: 'SFDT Telemetry endpoint is live.' })
  ).setMimeType(ContentService.MimeType.JSON);
}
