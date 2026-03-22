/**
 * DevTools Panel - Creates a Salesforce panel in Chrome DevTools.
 * Phase 2 will add debug log viewer, method trace, performance analysis.
 */
chrome.devtools.panels.create(
  'Salesforce',
  null, // icon path
  'devtools/panel.html',
  (panel) => {
    console.log('[SFDT] DevTools Salesforce panel created.');
  }
);
