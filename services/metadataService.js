/**
 * MetadataService - Fetches, indexes, and manages Salesforce metadata.
 * Provides structured access to all org metadata for search, navigation, and inspection.
 */
const MetadataService = (() => {
  const CACHE = window.SFDTCacheManager;
  const API = window.SalesforceAPI;

  const CACHE_VERSION_KEY = 'sfdt_cache_version';
  const CURRENT_CACHE_VERSION = '6'; // Increment when query logic changes

  let _indexing = false;
  let _indexReady = false;
  let _metadataIndex = {};
  const _listeners = [];
  const INDEX_STORAGE_PREFIX = 'sfdt_idx_'; // per-org key: sfdt_idx_{orgId}
  const INDEX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  function _indexStorageKey() {
    const orgId = API.getOrgId() || 'default';
    return `${INDEX_STORAGE_PREFIX}${orgId}`;
  }

  // Auto-invalidate cache when extension changes
  (function _checkCacheVersion() {
    try {
      const stored = localStorage.getItem(CACHE_VERSION_KEY);
      if (stored !== CURRENT_CACHE_VERSION) {
        console.log('[SFDT] Cache version mismatch — clearing stale cache.');
        CACHE.clearNamespace('metadata');
        CACHE.clearNamespace('index');
        localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
        // Clear all per-org index caches
        try {
          chrome.storage.local.get(null, (items) => {
            const keys = Object.keys(items || {}).filter(k => k.startsWith(INDEX_STORAGE_PREFIX));
            if (keys.length) chrome.storage.local.remove(keys);
          });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  })();

  function onIndexReady(fn) {
    if (_indexReady) fn();
    else _listeners.push(fn);
  }

  function _notifyReady() {
    _indexReady = true;
    _listeners.forEach(fn => fn());
    _listeners.length = 0;
  }

  /**
   * Save the full index to chrome.storage.local keyed by org ID.
   * Each org gets its own cache — multiple orgs in different tabs work independently.
   */
  function _saveIndexToStorage(index) {
    try {
      const key = _indexStorageKey();
      const payload = {
        version: CURRENT_CACHE_VERSION,
        ts: Date.now(),
        data: index
      };
      chrome.storage.local.set({ [key]: payload }, () => {
        if (chrome.runtime.lastError) {
          console.debug('[SFDT] Failed to save index to storage:', chrome.runtime.lastError.message);
        } else {
          console.debug('[SFDT] Index saved to chrome.storage.local key:', key);
        }
      });
    } catch { /* ignore */ }
  }

  /**
   * Load the cached index from chrome.storage.local for the current org.
   * Returns the index data if valid (same version, not expired), or null.
   */
  function _loadIndexFromStorage() {
    return new Promise((resolve) => {
      try {
        const key = _indexStorageKey();
        chrome.storage.local.get(key, (result) => {
          if (chrome.runtime.lastError || !result || !result[key]) {
            return resolve(null);
          }
          const entry = result[key];

          // Validate: same cache version, not expired
          if (entry.version !== CURRENT_CACHE_VERSION) {
            console.debug('[SFDT] Cached index version mismatch, will rebuild.');
            return resolve(null);
          }
          if (Date.now() - entry.ts > INDEX_CACHE_TTL) {
            console.debug('[SFDT] Cached index expired, will rebuild.');
            return resolve(null);
          }

          const count = Object.values(entry.data).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
          console.log(`[SFDT] Loaded cached index for org (${key}): ${count} items (age: ${Math.round((Date.now() - entry.ts) / 1000)}s)`);
          resolve(entry.data);
        });
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Fetch Body/Markup is no longer needed at index-build time.
   * Code search now uses server-side Tooling API LIKE queries.
   */

  // ─── Metadata Fetchers ────────────────────────────────

  async function fetchApexClasses() {
    const cached = CACHE.get('metadata', 'apexClasses');
    if (cached) return cached;
    const res = await API.toolingQueryAll(
      "SELECT Id, Name, NamespacePrefix, Status, IsValid, LengthWithoutComments, ApiVersion FROM ApexClass ORDER BY Name"
    );
    const records = res.records || [];
    CACHE.set('metadata', 'apexClasses', records);
    return records;
  }

  async function fetchApexTriggers() {
    const cached = CACHE.get('metadata', 'apexTriggers');
    if (cached) return cached;
    const res = await API.toolingQueryAll(
      "SELECT Id, Name, TableEnumOrId, NamespacePrefix, Status, IsValid, ApiVersion FROM ApexTrigger ORDER BY Name"
    );
    const records = res.records || [];
    CACHE.set('metadata', 'apexTriggers', records);
    return records;
  }

  async function fetchVisualforcePages() {
    const cached = CACHE.get('metadata', 'vfPages');
    if (cached) return cached;
    const res = await API.toolingQueryAll(
      "SELECT Id, Name, NamespacePrefix, ApiVersion, Description FROM ApexPage ORDER BY Name"
    );
    const records = res.records || [];
    CACHE.set('metadata', 'vfPages', records);
    return records;
  }

  async function fetchLightningComponents() {
    const cached = CACHE.get('metadata', 'lwcComponents');
    if (cached) return cached;
    try {
      const res = await API.toolingQueryAll(
        "SELECT Id, DeveloperName, NamespacePrefix, Description, ApiVersion FROM LightningComponentBundle ORDER BY DeveloperName"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'lwcComponents', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchAuraComponents() {
    const cached = CACHE.get('metadata', 'auraComponents');
    if (cached) return cached;
    try {
      const res = await API.toolingQueryAll(
        "SELECT Id, DeveloperName, NamespacePrefix, Description, ApiVersion FROM AuraDefinitionBundle ORDER BY DeveloperName"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'auraComponents', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchFlows() {
    const cached = CACHE.get('metadata', 'flows');
    if (cached) return cached;
    try {
      const res = await API.toolingQueryAll(
        "SELECT Id, Definition.DeveloperName, MasterLabel, ProcessType, Description, Status FROM Flow WHERE Status = 'Active' ORDER BY MasterLabel"
      );
      const records = (res.records || []).map(r => ({ ...r, DeveloperName: r.Definition?.DeveloperName || r.MasterLabel }));
      CACHE.set('metadata', 'flows', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchValidationRules() {
    const cached = CACHE.get('metadata', 'validationRules');
    if (cached) return cached;
    try {
      const res = await API.toolingQueryAll(
        "SELECT Id, ValidationName, EntityDefinitionId, Active, Description, ErrorMessage FROM ValidationRule WHERE Active = true ORDER BY ValidationName"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'validationRules', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchCustomObjects() {
    const cached = CACHE.get('metadata', 'customObjects');
    if (cached) return cached;
    const res = await API.describeGlobal();
    const objects = (res.sobjects || [])
      .filter(o => o.custom || ['Account', 'Contact', 'Opportunity', 'Lead', 'Case', 'Task', 'Event', 'Campaign', 'Order', 'Product2', 'Pricebook2', 'Quote', 'Contract'].includes(o.name))
      .map(o => ({
        name: o.name,
        label: o.label,
        custom: o.custom,
        keyPrefix: o.keyPrefix,
        queryable: o.queryable,
        searchable: o.searchable,
        createable: o.createable,
        updateable: o.updateable
      }));
    CACHE.set('metadata', 'customObjects', objects);
    return objects;
  }

  async function fetchCustomFields(objectName) {
    const cacheKey = `fields_${objectName}`;
    const cached = CACHE.get('metadata', cacheKey);
    if (cached) return cached;
    const res = await API.describeSObject(objectName);
    const fields = (res.fields || []).map(f => ({
      name: f.name,
      label: f.label,
      type: f.type,
      custom: f.custom,
      length: f.length,
      precision: f.precision,
      scale: f.scale,
      nillable: f.nillable,
      unique: f.unique,
      externalId: f.externalId,
      referenceTo: f.referenceTo,
      relationshipName: f.relationshipName,
      picklistValues: f.picklistValues,
      defaultValue: f.defaultValue,
      inlineHelpText: f.inlineHelpText,
      calculated: f.calculatedFormula ? true : false,
      formula: f.calculatedFormula
    }));
    CACHE.set('metadata', cacheKey, fields);
    return fields;
  }

  async function fetchProfiles() {
    const cached = CACHE.get('metadata', 'profiles');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Name FROM Profile ORDER BY Name"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'profiles', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchPermissionSets() {
    const cached = CACHE.get('metadata', 'permissionSets');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Name, Label, IsCustom FROM PermissionSet WHERE IsCustom = true ORDER BY Label"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'permissionSets', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchCustomMetadata() {
    const cached = CACHE.get('metadata', 'customMetadata');
    if (cached) return cached;
    try {
      const res = await API.describeGlobal();
      const cmdt = (res.sobjects || []).filter(o => o.name.endsWith('__mdt'));
      CACHE.set('metadata', 'customMetadata', cmdt);
      return cmdt;
    } catch {
      return [];
    }
  }

  async function fetchCustomSettings() {
    const cached = CACHE.get('metadata', 'customSettings');
    if (cached) return cached;
    try {
      const res = await API.describeGlobal();
      const settings = (res.sobjects || []).filter(o => o.customSetting);
      CACHE.set('metadata', 'customSettings', settings);
      return settings;
    } catch {
      return [];
    }
  }

  async function fetchNamedCredentials() {
    const cached = CACHE.get('metadata', 'namedCredentials');
    if (cached) return cached;
    try {
      const res = await API.toolingQuery(
        "SELECT Id, DeveloperName, MasterLabel, Endpoint FROM NamedCredential ORDER BY MasterLabel"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'namedCredentials', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchStaticResources() {
    const cached = CACHE.get('metadata', 'staticResources');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Name, Description, ContentType, NamespacePrefix FROM StaticResource ORDER BY Name"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'staticResources', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchCustomLabels() {
    const cached = CACHE.get('metadata', 'customLabels');
    if (cached) return cached;
    try {
      const res = await API.toolingQuery(
        "SELECT Id, Name, Value, Category, Language, NamespacePrefix FROM ExternalString WHERE NamespacePrefix = null ORDER BY Name"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'customLabels', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchEmailTemplates() {
    const cached = CACHE.get('metadata', 'emailTemplates');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Name, DeveloperName, FolderId, TemplateType FROM EmailTemplate ORDER BY Name LIMIT 200"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'emailTemplates', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchReports() {
    const cached = CACHE.get('metadata', 'reports');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Name, DeveloperName, FolderName FROM Report ORDER BY Name LIMIT 500"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'reports', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchDashboards() {
    const cached = CACHE.get('metadata', 'dashboards');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Title, DeveloperName, FolderId FROM Dashboard ORDER BY Title LIMIT 500"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'dashboards', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchConnectedApps() {
    const cached = CACHE.get('metadata', 'connectedApps');
    if (cached) return cached;
    try {
      // ConnectedApplication is not available via Tooling API in all orgs;
      // use REST API query instead
      const res = await API.restQuery(
        "SELECT Id, Name FROM ConnectedApplication ORDER BY Name LIMIT 200"
      );
      const records = (res.records || []).map(r => ({ ...r, DeveloperName: r.Name, MasterLabel: r.Name }));
      CACHE.set('metadata', 'connectedApps', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchRemoteSiteSettings() {
    const cached = CACHE.get('metadata', 'remoteSiteSettings');
    if (cached) return cached;
    try {
      // RemoteProxy is the Tooling API entity for Remote Site Settings,
      // but may not exist in all editions. Try with SiteName field.
      const res = await API.toolingQuery(
        "SELECT Id, SiteName, EndpointUrl, IsActive FROM RemoteProxy ORDER BY SiteName LIMIT 200"
      );
      const records = (res.records || []).map(r => ({ ...r, DeveloperName: r.SiteName }));
      CACHE.set('metadata', 'remoteSiteSettings', records);
      return records;
    } catch {
      return [];
    }
  }

  async function fetchTabs() {
    const cached = CACHE.get('metadata', 'tabs');
    if (cached) return cached;
    try {
      const records = await API.restGet('/tabs/');
      CACHE.set('metadata', 'tabs', records || []);
      return records || [];
    } catch {
      return [];
    }
  }

  async function fetchProductAttributes() {
    const cached = CACHE.get('metadata', 'productAttributes');
    if (cached) return cached;
    try {
      const res = await API.restQuery(
        "SELECT Id, Name, Apttus_Config2__ProductId__r.Name, Apttus_Config2__Field__c FROM Apttus_Config2__ProductAttribute__c ORDER BY Name LIMIT 2000"
      );
      const records = res.records || [];
      CACHE.set('metadata', 'productAttributes', records);
      return records;
    } catch {
      return [];
    }
  }

  // ─── Full Index Builder ────────────────────────────────

  async function buildIndex() {
    if (_indexing) return _metadataIndex;
    _indexing = true;
    _indexReady = false;

    // Verify API connection first
    if (!API.isConnected()) {
      console.debug('[SFDT] Cannot build index — not connected to Salesforce.');
      _indexing = false;
      return _metadataIndex;
    }

    // Try to load cached index from chrome.storage.local (instant, cross-domain)
    const cachedIndex = await _loadIndexFromStorage();
    if (cachedIndex) {
      const count = Object.values(cachedIndex).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      if (count > 0) {
        _metadataIndex = cachedIndex;
        _indexReady = true;
        _notifyReady();
        console.log('[SFDT] Index ready from cache. Refreshing in background...');
        // Refresh in background (non-blocking) so data stays fresh
        _indexing = false;
        _refreshIndexInBackground();
        return _metadataIndex;
      }
    }

    // No cached index — build from scratch
    return await _buildIndexFresh();
  }

  /**
   * Background refresh: re-fetches all metadata and updates the index silently.
   * Doesn't block the UI — search works with cached data while this runs.
   */
  async function _refreshIndexInBackground() {
    // Small delay to let the page finish loading first
    await new Promise(r => setTimeout(r, 3000));

    if (_indexing) return; // another build started
    _indexing = true;

    try {
      // Verify session is still valid
      await API.restGet('/limits/');
    } catch (e) {
      console.debug('[SFDT] Session invalid, skipping background refresh:', e.message);
      _indexing = false;
      return;
    }

    // Clear localStorage cache so fetchers hit the API for fresh data
    CACHE.clearNamespace('metadata');

    console.debug('[SFDT] Background index refresh started...');
    const index = await _fetchAllMetadata();
    if (index && Object.keys(index).length > 0) {
      _metadataIndex = index;
      _saveIndexToStorage(index);
      const count = Object.values(index).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      console.log('[SFDT] Background index refresh complete:', count, 'items');
    }
    _indexing = false;
  }

  /**
   * Build the index from scratch (no cache available).
   */
  async function _buildIndexFresh() {
    // Verify session with a lightweight call before firing parallel requests
    try {
      await API.restGet('/limits/');
    } catch (e) {
      console.debug('[SFDT] Session invalid, skipping index build:', e.message);
      _indexing = false;
      return _metadataIndex;
    }

    const index = await _fetchAllMetadata();
    _metadataIndex = index;

    _indexing = false;
    _notifyReady();
    _saveIndexToStorage(index);
    console.log('[SFDT] Index built with categories:', Object.keys(index).join(', '),
      'Total items:', Object.values(index).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0));
    return index;
  }

  /**
   * Fetch all metadata from API in parallel batches and build the index object.
   */
  async function _fetchAllMetadata() {
    const index = {};

    // Fetch in parallel batches to stay within API limits
    try {
      const [classes, triggers, vfPages, lwc, aura, flows, valRules, objects] = await Promise.all([
        fetchApexClasses().catch(() => []),
        fetchApexTriggers().catch(() => []),
        fetchVisualforcePages().catch(() => []),
        fetchLightningComponents().catch(() => []),
        fetchAuraComponents().catch(() => []),
        fetchFlows().catch(() => []),
        fetchValidationRules().catch(() => []),
        fetchCustomObjects().catch(() => [])
      ]);
      console.log('[SFDT] Batch 1 fetched:', { classes: classes.length, triggers: triggers.length, vfPages: vfPages.length, lwc: lwc.length, aura: aura.length, flows: flows.length, valRules: valRules.length, objects: objects.length });

      index.apexClasses = classes.map(c => ({
        id: c.Id,
        name: c.Name,
        type: 'ApexClass',
        icon: '{}',
        namespace: c.NamespacePrefix,
        label: c.NamespacePrefix ? `${c.NamespacePrefix}.${c.Name}` : c.Name,
        status: c.Status,
        apiVersion: c.ApiVersion
      }));

      index.apexTriggers = triggers.map(t => ({
        id: t.Id,
        name: t.Name,
        type: 'ApexTrigger',
        icon: '⚡',
        namespace: t.NamespacePrefix,
        label: t.NamespacePrefix ? `${t.NamespacePrefix}.${t.Name}` : t.Name,
        objectName: t.TableEnumOrId,
        status: t.Status
      }));

      index.vfPages = vfPages.map(p => ({
        id: p.Id,
        name: p.Name,
        type: 'VisualforcePage',
        icon: '📄',
        namespace: p.NamespacePrefix,
        label: p.NamespacePrefix ? `${p.NamespacePrefix}.${p.Name}` : p.Name,
        apiVersion: p.ApiVersion
      }));

      index.lwcComponents = lwc.map(c => ({
        id: c.Id,
        name: c.DeveloperName,
        type: 'LWC',
        icon: '⚛',
        description: c.Description
      }));

      index.auraComponents = aura.map(c => ({
        id: c.Id,
        name: c.DeveloperName,
        type: 'AuraComponent',
        icon: '⚡',
        description: c.Description
      }));

      index.flows = flows.map(f => ({
        id: f.Id,
        name: f.MasterLabel || f.DeveloperName,
        devName: f.DeveloperName,
        type: 'Flow',
        icon: '🔀',
        processType: f.ProcessType,
        status: f.Status
      }));

      index.validationRules = valRules.map(v => ({
        id: v.Id,
        name: v.ValidationName,
        type: 'ValidationRule',
        icon: '✓',
        entityId: v.EntityDefinitionId,
        errorMessage: v.ErrorMessage
      }));

      index.objects = objects.map(o => ({
        name: o.name,
        label: o.label,
        type: 'CustomObject',
        icon: '🗂',
        custom: o.custom,
        keyPrefix: o.keyPrefix,
        searchable: o.searchable,
        queryable: o.queryable
      }));
    } catch (e) {
      console.debug('[SFDT] Index build error (batch 1):', e);
    }

    // Batch 2 — secondary metadata
    try {
      const [profiles, permSets, cmdt, customSettings, labels, reports, dashboards] = await Promise.all([
        fetchProfiles().catch(() => []),
        fetchPermissionSets().catch(() => []),
        fetchCustomMetadata().catch(() => []),
        fetchCustomSettings().catch(() => []),
        fetchCustomLabels().catch(() => []),
        fetchReports().catch(() => []),
        fetchDashboards().catch(() => [])
      ]);

      index.profiles = profiles.map(p => ({
        id: p.Id, name: p.Name, type: 'Profile', icon: '👤'
      }));

      index.permissionSets = permSets.map(p => ({
        id: p.Id, name: p.Label || p.Name, type: 'PermissionSet', icon: '🔐'
      }));

      index.customMetadata = cmdt.map(c => ({
        name: c.name, label: c.label, type: 'CustomMetadata', icon: '📋'
      }));

      index.customSettings = customSettings.map(c => ({
        name: c.name, label: c.label, type: 'CustomSetting', icon: '⚙',
        keyPrefix: c.keyPrefix
      }));

      index.customLabels = labels.map(l => ({
        id: l.Id, name: l.Name, type: 'CustomLabel', icon: '🏷',
        value: l.Value, category: l.Category
      }));

      index.reports = reports.map(r => ({
        id: r.Id, name: r.Name, type: 'Report', icon: '📊',
        devName: r.DeveloperName, folder: r.FolderName
      }));

      index.dashboards = dashboards.map(d => ({
        id: d.Id, name: d.Title, type: 'Dashboard', icon: '📈',
        devName: d.DeveloperName
      }));
    } catch (e) {
      console.debug('[SFDT] Index build error (batch 2):', e);
    }

    // Batch 3 — remaining metadata
    try {
      const [namedCreds, staticRes, emailTpls, connApps, remoteSites, tabs, productAttrs] = await Promise.all([
        fetchNamedCredentials().catch(() => []),
        fetchStaticResources().catch(() => []),
        fetchEmailTemplates().catch(() => []),
        fetchConnectedApps().catch(() => []),
        fetchRemoteSiteSettings().catch(() => []),
        fetchTabs().catch(() => []),
        fetchProductAttributes().catch(() => [])
      ]);

      index.namedCredentials = namedCreds.map(n => ({
        id: n.Id, name: n.MasterLabel || n.DeveloperName,
        type: 'NamedCredential', icon: '🔑', endpoint: n.Endpoint
      }));

      index.staticResources = staticRes.map(s => ({
        id: s.Id, name: s.Name, type: 'StaticResource', icon: '📦',
        contentType: s.ContentType,
        namespace: s.NamespacePrefix || null,
        label: s.Description || s.Name
      }));

      index.emailTemplates = emailTpls.map(e => ({
        id: e.Id, name: e.Name, type: 'EmailTemplate', icon: '📧',
        devName: e.DeveloperName, templateType: e.TemplateType
      }));

      index.connectedApps = connApps.map(c => ({
        id: c.Id, name: c.MasterLabel || c.DeveloperName,
        type: 'ConnectedApp', icon: '🔗'
      }));

      index.remoteSiteSettings = remoteSites.map(r => ({
        id: r.Id, name: r.DeveloperName, type: 'RemoteSiteSetting', icon: '🌐',
        endpoint: r.EndpointUrl, active: r.IsActive
      }));

      index.tabs = tabs.map(t => ({
        id: t.sobjectName || t.name,
        name: t.label || t.name,
        type: 'Tab',
        icon: '📑',
        label: t.label || t.name,
        sobjectName: t.sobjectName,
        custom: t.custom,
        url: t.url
      }));

      index.productAttributes = productAttrs.map(a => ({
        id: a.Id,
        name: a.Name,
        type: 'Attribute',
        icon: '🏷',
        productName: a.Apttus_Config2__ProductId__r ? a.Apttus_Config2__ProductId__r.Name : '',
        field: a.Apttus_Config2__Field__c || ''
      }));
    } catch (e) {
      console.debug('[SFDT] Index build error (batch 3):', e);
    }

    // Setup page shortcuts (always available, no API call needed)
    index.setupPages = [
      { name: 'Apex Classes', path: '/lightning/setup/ApexClasses/home', classicPath: '/setup/build/listApexClass.apexp' },
      { name: 'Apex Triggers', path: '/lightning/setup/ApexTriggers/home', classicPath: '/setup/build/listApexTrigger.apexp' },
      { name: 'Auth Providers', path: '/lightning/setup/AuthProvidersPage/home', classicPath: '/setup/secur/AuthProviderPage.apexp' },
      { name: 'Connected Apps', path: '/lightning/setup/ConnectedApplication/home', classicPath: '/app/mgmt/forceconnectedapps/forceAppList.apexp' },
      { name: 'Custom Labels', path: '/lightning/setup/ExternalStrings/home', classicPath: '/101?setupid=ExternalStrings' },
      { name: 'Custom Metadata Types', path: '/lightning/setup/CustomMetadata/home', classicPath: '/setup/ui/listCustomMetadata.apexp' },
      { name: 'Custom Settings', path: '/lightning/setup/CustomSettings/home', classicPath: '/setup/ui/listCustomSettings.apexp' },
      { name: 'Data Loader', path: '/lightning/setup/DataManagementDataLoader/home', classicPath: '/ui/setup/dataimporter/DataImporterPage' },
      { name: 'Debug Logs', path: '/lightning/setup/ApexDebugLogs/home', classicPath: '/setup/ui/listApexTraces.apexp' },
      { name: 'Deployment Status', path: '/lightning/setup/DeployStatus/home', classicPath: '/changemgmt/monitorDeployment.apexp' },
      { name: 'Developer Console', path: '/_ui/common/apex/debug/ApexCSIPage', classicPath: '/_ui/common/apex/debug/ApexCSIPage' },
      { name: 'Email Templates', path: '/lightning/setup/CommunicationTemplatesEmail/home', classicPath: '/email/admin/listEmailTemplate.apexp' },
      { name: 'Flows', path: '/lightning/setup/Flows/home', classicPath: '/300' },
      { name: 'Installed Packages', path: '/lightning/setup/ImportedPackage/home', classicPath: '/0A3' },
      { name: 'Lightning Components', path: '/lightning/setup/LightningComponentBundles/home', classicPath: '/setup/build/listLightningComponentBundle.apexp' },
      { name: 'Named Credentials', path: '/lightning/setup/NamedCredential/home', classicPath: '/0XA' },
      { name: 'Object Manager', path: '/lightning/setup/ObjectManager/home', classicPath: '/p/setup/custent/CustomObjectsPage?setupid=CustomObjects' },
      { name: 'Permission Sets', path: '/lightning/setup/PermSets/home', classicPath: '/0PS' },
      { name: 'Platform Events', path: '/lightning/setup/EventObjects/home', classicPath: '/setup/build/listEventObjects.apexp' },
      { name: 'Profiles', path: '/lightning/setup/Profiles/home', classicPath: '/00e' },
      { name: 'Remote Site Settings', path: '/lightning/setup/SecurityRemoteProxy/home', classicPath: '/0rp' },
      { name: 'Scheduled Jobs', path: '/lightning/setup/ScheduledJobs/home', classicPath: '/08e' },
      { name: 'Static Resources', path: '/lightning/setup/StaticResources/home', classicPath: '/setup/build/listStaticResource.apexp' },
      { name: 'Tabs', path: '/lightning/setup/Tabs/home', classicPath: '/setup/ui/listTabs.apexp' },
      { name: 'Users', path: '/lightning/setup/ManageUsers/home', classicPath: '/005' },
      { name: 'Visualforce Pages', path: '/lightning/setup/ApexPages/home', classicPath: '/setup/build/listApexPage.apexp' }
    ].map(s => ({
      name: s.name, type: 'SetupPage', icon: '\u2699', label: s.name,
      path: s.path, classicPath: s.classicPath
    }));

    return index;
  }

  function getIndex() {
    return _metadataIndex;
  }

  function isReady() {
    return _indexReady;
  }

  function invalidateCache() {
    CACHE.clearNamespace('metadata');
    CACHE.clearNamespace('index');
    try { chrome.storage.local.remove(_indexStorageKey()); } catch { /* ignore */ }
    _metadataIndex = {};
    _indexReady = false;
    _indexing = false;
  }

  // ─── Navigation URL Helpers ────────────────────────────

  function getSetupUrl(item) {
    const base = API.getInstanceUrl();
    const lightning = base.includes('lightning.force.com') || document.querySelector('one-app-nav-bar');
    const isLightning = lightning || window.location.pathname.startsWith('/lightning');

    if (isLightning) {
      return _getLightningSetupUrl(base, item);
    }
    return _getClassicSetupUrl(base, item);
  }

  function _getLightningSetupUrl(base, item) {
    switch (item.type) {
      case 'ApexClass':
      case 'ApexTrigger':
        return `${base}/lightning/setup/ApexClasses/page?address=%2F${item.id}`;
      case 'VisualforcePage':
      case 'ApexComponent':
        return `${base}/lightning/setup/ApexPages/page?address=%2F${item.id}`;
      case 'LWC':
        return `${base}/lightning/setup/LightningComponentBundles/page?address=%2F${item.id}`;
      case 'AuraComponent':
        return `${base}/lightning/setup/LightningComponentBundles/page?address=%2F${item.id}`;
      case 'Flow':
        return `${base}/builder_platform_interaction/flowBuilder.app?flowId=${item.id}`;
      case 'ValidationRule':
        return `${base}/lightning/setup/ObjectManager/${item.entityId}/ValidationRules/${item.id}/view`;
      case 'CustomObject':
        return `${base}/lightning/setup/ObjectManager/${item.name}/Details/view`;
      case 'CustomSetting':
        if (item.keyPrefix) return `${base}/lightning/setup/CustomSettings/page?address=%2Fsetup%2Fui%2FlistCustomSettingsData.apexp%3Fid%3D${item.keyPrefix}`;
        return `${base}/lightning/setup/CustomSettings/home`;
      case 'Profile':
        return `${base}/lightning/setup/Profiles/page?address=%2F${item.id}`;
      case 'PermissionSet':
        return `${base}/lightning/setup/PermSets/page?address=%2F${item.id}`;
      case 'CustomMetadata':
        return `${base}/lightning/setup/CustomMetadata/page?address=%2F${item.name}`;
      case 'CustomLabel':
        return `${base}/lightning/setup/ExternalStrings/page?address=%2F${item.id}`;
      case 'Report':
        return `${base}/lightning/r/Report/${item.id}/view`;
      case 'Dashboard':
        return `${base}/lightning/r/Dashboard/${item.id}/view`;
      case 'NamedCredential':
        return `${base}/lightning/setup/NamedCredential/page?address=%2F${item.id}`;
      case 'StaticResource':
        return `${base}/lightning/setup/StaticResources/page?address=%2F${item.id}`;
      case 'EmailTemplate':
        return `${base}/lightning/setup/CommunicationTemplatesEmail/page?address=%2F${item.id}`;
      case 'ConnectedApp':
        return `${base}/lightning/setup/ConnectedApplication/page?address=%2F${item.id}`;
      case 'RemoteSiteSetting':
        return `${base}/lightning/setup/SecurityRemoteProxy/page?address=%2F${item.id}`;
      case 'Tab':
        if (item.url) {
          if (item.url.startsWith('http')) return item.url;
          return `${base}${item.url}`;
        }
        if (item.sobjectName) return `${base}/lightning/o/${item.sobjectName}/home`;
        return `${base}/lightning/setup/Tabs/home`;
      case 'Attribute':
        return `${base}/lightning/r/Apttus_Config2__ProductAttribute__c/${item.id}/view`;
      case 'SetupPage':
        return `${base}${item.path}`;
      default:
        return `${base}/lightning/setup/SetupOneHome/home`;
    }
  }

  function _getClassicSetupUrl(base, item) {
    switch (item.type) {
      case 'ApexClass':
        return `${base}/${item.id}`;
      case 'ApexTrigger':
        return `${base}/${item.id}`;
      case 'VisualforcePage':
        return `${base}/${item.id}`;
      case 'Flow':
        return `${base}/flow/${item.devName || item.id}`;
      case 'CustomObject':
        if (item.keyPrefix) return `${base}/${item.keyPrefix}?setupid=CustomObjects`;
        return `${base}/p/setup/layout/LayoutFieldList?type=${encodeURIComponent(item.name)}&setupid=ObjectManager`;
      case 'CustomSetting':
        if (item.keyPrefix) return `${base}/setup/ui/listCustomSettingsData.apexp?id=${item.keyPrefix}`;
        return `${base}/p/setup/layout/LayoutFieldList?type=${encodeURIComponent(item.name)}&setupid=ObjectManager`;
      case 'CustomMetadata':
        return `${base}/setup/ui/listCustomMetadata.apexp?type=${encodeURIComponent(item.name)}`;
      case 'Profile':
        return `${base}/${item.id}`;
      case 'PermissionSet':
        return `${base}/${item.id}`;
      case 'ValidationRule':
        return `${base}/${item.id}`;
      case 'CustomLabel':
        return `${base}/${item.id}`;
      case 'Report':
        return `${base}/${item.id}`;
      case 'Dashboard':
        return `${base}/${item.id}`;
      case 'NamedCredential':
        return `${base}/${item.id}`;
      case 'StaticResource':
        return `${base}/${item.id}`;
      case 'EmailTemplate':
        return `${base}/${item.id}`;
      case 'ConnectedApp':
        return `${base}/${item.id}`;
      case 'RemoteSiteSetting':
        return `${base}/${item.id}`;
      case 'LWC':
      case 'AuraComponent':
      case 'ApexComponent':
        return `${base}/${item.id}`;
      case 'Tab':
        if (item.url) {
          if (item.url.startsWith('http')) return item.url;
          return `${base}${item.url}`;
        }
        if (item.sobjectName) return `${base}/${item.sobjectName}/o`;
        return `${base}/setup/customize/tab/home`;
      case 'Attribute':
        return `${base}/${item.id}`;
      case 'SetupPage':
        return `${base}${item.classicPath}`;
      default:
        if (item.id) return `${base}/${item.id}`;
        return `${base}/setup/forcecomHomepage.apexp`;
    }
  }

  return {
    fetchApexClasses,
    fetchApexTriggers,
    fetchVisualforcePages,
    fetchLightningComponents,
    fetchAuraComponents,
    fetchFlows,
    fetchValidationRules,
    fetchCustomObjects,
    fetchCustomFields,
    fetchProfiles,
    fetchPermissionSets,
    fetchCustomMetadata,
    fetchCustomSettings,
    fetchNamedCredentials,
    fetchStaticResources,
    fetchCustomLabels,
    fetchEmailTemplates,
    fetchReports,
    fetchDashboards,
    fetchConnectedApps,
    fetchRemoteSiteSettings,
    fetchTabs,
    fetchProductAttributes,
    buildIndex,
    getIndex,
    isReady,
    onIndexReady,
    invalidateCache,
    getSetupUrl
  };
})();

if (typeof window !== 'undefined') {
  window.SFDTMetadataService = MetadataService;
}
