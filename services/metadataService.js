/**
 * MetadataService - Fetches, indexes, and manages Salesforce metadata.
 * Provides structured access to all org metadata for search, navigation, and inspection.
 */
const MetadataService = (() => {
  const CACHE = window.SFDTCacheManager;
  const API = window.SalesforceAPI;

  const CACHE_VERSION_KEY = 'sfdt_cache_version';
  const CURRENT_CACHE_VERSION = '8'; // Increment when query logic changes

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
        window._sfdtLogger.log('[SFDT] Cache version mismatch — clearing stale cache.');
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
          window._sfdtLogger.debug('[SFDT] Failed to save index to storage:', chrome.runtime.lastError.message);
        } else {
          window._sfdtLogger.debug('[SFDT] Index saved to chrome.storage.local key:', key);
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
            window._sfdtLogger.debug('[SFDT] Cached index version mismatch, will rebuild.');
            return resolve(null);
          }
          if (Date.now() - entry.ts > INDEX_CACHE_TTL) {
            window._sfdtLogger.debug('[SFDT] Cached index expired, will rebuild.');
            return resolve(null);
          }

          const count = Object.values(entry.data).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
          window._sfdtLogger.log(`[SFDT] Loaded cached index for org (${key}): ${count} items (age: ${Math.round((Date.now() - entry.ts) / 1000)}s)`);
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

    // Enrich custom objects with their EntityDefinition DurableId — the 01I…-prefixed
    // object definition Id. Classic Setup links to a custom object detail page via
    // /{01I…}?setupid=CustomObjects; the record key prefix (e.g. a1I) is NOT a valid
    // navigation target on its own, so without this the link 404s / lands on the wrong page.
    try {
      const customNames = objects.filter(o => o.custom).map(o => o.name);
      const durableIds = await _fetchEntityDurableIds(customNames);
      objects.forEach(o => {
        if (o.custom && durableIds[o.name]) o.durableId = durableIds[o.name];
      });
    } catch (e) {
      window._sfdtLogger.debug('[SFDT] Custom object DurableId enrichment failed:', e);
    }

    CACHE.set('metadata', 'customObjects', objects);
    return objects;
  }

  /**
   * Resolve EntityDefinition DurableIds (01I…-prefixed object definition Ids) for the
   * given custom object API names, returned as a { QualifiedApiName: DurableId } map.
   *
   * Tooling queries run as GET requests, so the SOQL (with its IN (...) list) rides in
   * the URL. Orgs with many long-named managed-package objects (e.g. Apttus/CPQ) easily
   * exceed the ~2KB browser URL limit, which makes the request fail silently and leaves
   * objects without a DurableId. So batches are sized by *encoded URL length*, not a
   * fixed count, mirroring the EntityParticle field search in searchService.
   */
  async function _fetchEntityDurableIds(apiNames) {
    const map = {};
    if (!apiNames || !apiNames.length) return map;

    const MAX_URL_LEN = 1800;
    const base = (API.getInstanceUrl && API.getInstanceUrl()) || '';
    const selectPrefix = 'SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN (';
    const selectSuffix = ')';
    // base URL + /services/data/vXX/tooling/query/?q= path + encoded static SOQL parts
    const overhead = base.length + 60 + encodeURIComponent(selectPrefix + selectSuffix).length;

    // Group names into batches whose full request URL stays under the limit.
    const batches = [];
    let cur = [];
    let curLen = 0;
    for (const name of apiNames) {
      const encLen = encodeURIComponent(`'${String(name).replace(/'/g, "\\'")}',`).length;
      if (cur.length > 0 && overhead + curLen + encLen > MAX_URL_LEN) {
        batches.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(name);
      curLen += encLen;
    }
    if (cur.length) batches.push(cur);

    // Batches are independent reads — run them in parallel.
    await Promise.all(batches.map(async (batch) => {
      const inClause = batch.map(n => `'${String(n).replace(/'/g, "\\'")}'`).join(',');
      try {
        const res = await API.toolingQuery(`${selectPrefix}${inClause}${selectSuffix}`);
        (res.records || []).forEach(r => {
          if (r.QualifiedApiName && r.DurableId) map[r.QualifiedApiName] = r.DurableId;
        });
      } catch (e) {
        window._sfdtLogger.debug('[SFDT] EntityDefinition batch query failed:', e);
      }
    }));

    return map;
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

  let _indexingPromise = null;

  async function buildIndex() {
    // If a build is already in progress, return the same promise so concurrent
    // callers await the same work instead of getting a half-built index.
    if (_indexingPromise) return _indexingPromise;

    _indexingPromise = (async () => {
      _indexing = true;
      _indexReady = false;

      // Verify API connection first
      if (!API.isConnected()) {
        window._sfdtLogger.debug('[SFDT] Cannot build index — not connected to Salesforce.');
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
          window._sfdtLogger.log('[SFDT] Index ready from cache. Refreshing in background...');
          // Refresh in background (non-blocking) so data stays fresh
          _indexing = false;
          _refreshIndexInBackground();
          return _metadataIndex;
        }
      }

      // No cached index — build from scratch
      return await _buildIndexFresh();
    })();

    try {
      return await _indexingPromise;
    } finally {
      _indexingPromise = null;
    }
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
      window._sfdtLogger.debug('[SFDT] Session invalid, skipping background refresh:', e.message);
      _indexing = false;
      return;
    }

    // Clear localStorage cache so fetchers hit the API for fresh data
    CACHE.clearNamespace('metadata');

    window._sfdtLogger.debug('[SFDT] Background index refresh started...');
    const index = await _fetchAllMetadata();
    if (index && Object.keys(index).length > 0) {
      _metadataIndex = index;
      _saveIndexToStorage(index);
      const count = Object.values(index).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      window._sfdtLogger.log('[SFDT] Background index refresh complete:', count, 'items');
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
      window._sfdtLogger.debug('[SFDT] Session invalid, skipping index build:', e.message);
      _indexing = false;
      return _metadataIndex;
    }

    const index = await _fetchAllMetadata();
    _metadataIndex = index;

    _indexing = false;
    _notifyReady();
    _saveIndexToStorage(index);
    window._sfdtLogger.log('[SFDT] Index built with categories:', Object.keys(index).join(', '),
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
      window._sfdtLogger.log('[SFDT] Batch 1 fetched:', { classes: classes.length, triggers: triggers.length, vfPages: vfPages.length, lwc: lwc.length, aura: aura.length, flows: flows.length, valRules: valRules.length, objects: objects.length });

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
        durableId: o.durableId,
        searchable: o.searchable,
        queryable: o.queryable
      }));
    } catch (e) {
      window._sfdtLogger.debug('[SFDT] Index build error (batch 1):', e);
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
      window._sfdtLogger.debug('[SFDT] Index build error (batch 2):', e);
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
      window._sfdtLogger.debug('[SFDT] Index build error (batch 3):', e);
    }

    // Setup page shortcuts (always available, no API call needed)
    // Setup pages use setupId for dynamic URL resolution.
    // Classic URLs are built dynamically via _getClassicSetupUrl using
    // /ui/setup/Setup?setupid=XXX (Salesforce's stable redirect pattern)
    // so they never break when Salesforce changes internal page paths.
    index.setupPages = [
      // Development
      { name: 'Apex Classes', setupId: 'ApexClasses' },
      { name: 'Apex Triggers', setupId: 'ApexTriggers' },
      { name: 'Apex Test Execution', setupId: 'ApexTestQueue' },
      { name: 'Apex Jobs', setupId: 'AsyncApexJobs' },
      { name: 'Apex Flex Queue', setupId: 'ApexFlexQueue' },
      { name: 'Visualforce Pages', setupId: 'ApexPages' },
      { name: 'Visualforce Components', setupId: 'ApexComponents' },
      { name: 'Lightning Components', setupId: 'LightningComponentBundles' },
      { name: 'LWC Debug Mode', setupId: 'UserDebugModeSetup' },
      { name: 'Static Resources', setupId: 'StaticResources' },
      { name: 'Platform Events', setupId: 'EventObjects' },
      { name: 'Change Data Capture', setupId: 'CdcObjectEnablement' },
      { name: 'Platform Cache', setupId: 'PlatformCache' },
      { name: 'Custom Metadata Types', setupId: 'CustomMetadata' },
      { name: 'Custom Settings', setupId: 'CustomSettings' },
      { name: 'Custom Labels', setupId: 'ExternalStrings', classicPath: '/101?retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DDevTools&setupid=ExternalStrings' },
      { name: 'Custom Permissions', setupId: 'CustomPermissions' },
      { name: 'Email Services', setupId: 'EmailToApexFunction' },
      { name: 'Dev Hub', setupId: 'DevHub' },
      { name: 'DevOps Center', setupId: 'DevOpsCenterSetup' },

      // Automation
      { name: 'Flows', setupId: 'Flows' },
      { name: 'Paused & Failed Flow Interviews', setupId: 'Pausedflows' },
      { name: 'Process Builder', setupId: 'ProcessAutomation' },
      { name: 'Process Automation Settings', setupId: 'WorkflowSettings' },
      { name: 'Workflow Rules', setupId: 'WorkflowRules' },
      { name: 'Workflow Email Alerts', setupId: 'WorkflowEmails' },
      { name: 'Workflow Field Updates', setupId: 'WorkflowFieldUpdates' },
      { name: 'Workflow Outbound Messages', setupId: 'WorkflowOutboundMessaging' },
      { name: 'Approval Processes', setupId: 'ApprovalProcesses' },
      { name: 'Scheduled Jobs', setupId: 'ScheduledJobs' },
      { name: 'Time-Based Workflow', setupId: 'DataManagementManageWorkflowQueue' },

      // Deployment & Packages
      { name: 'Deployment Status', setupId: 'DeployStatus' },
      { name: 'Deployment Settings', setupId: 'DeploymentSettings' },
      { name: 'Installed Packages', setupId: 'ImportedPackage' },
      { name: 'Package Manager', setupId: 'Package' },
      { name: 'Change Sets (Outbound)', setupId: 'OutboundChangeSet' },
      { name: 'Change Sets (Inbound)', setupId: 'InboundChangeSet' },

      // Security & Access
      { name: 'Profiles', setupId: 'EnhancedProfiles', classicPath: '/00e?setupid=EnhancedProfiles' },
      { name: 'Permission Sets', setupId: 'PermSets', classicPath: '/0PS?setupid=PermSets&retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DUsers' },
      { name: 'Permission Set Groups', setupId: 'PermSetGroups' },
      { name: 'Users', setupId: 'ManageUsers' },
      { name: 'Roles', setupId: 'Roles' },
      { name: 'Public Groups', setupId: 'PublicGroups' },
      { name: 'Queues', setupId: 'Queues' },
      { name: 'Delegated Administration', setupId: 'DelegateGroups' },
      { name: 'User Access Policies', setupId: 'UserAccessPolicies' },
      { name: 'Sharing Settings', setupId: 'SecuritySharing' },
      { name: 'Field Accessibility', setupId: 'FieldAccessibility' },
      { name: 'Password Policies', setupId: 'SecurityPolicies' },
      { name: 'Session Settings', setupId: 'SecuritySession' },
      { name: 'Network Access', setupId: 'NetworkAccess' },
      { name: 'Health Check', setupId: 'HealthCheck' },
      { name: 'Login History', setupId: 'OrgLoginHistory' },
      { name: 'Session Management', setupId: 'SessionManagement' },
      { name: 'Single Sign-On Settings', setupId: 'SingleSignOn' },
      { name: 'Identity Provider', setupId: 'IdpPage' },
      { name: 'Login Flows', setupId: 'LoginFlow' },
      { name: 'Auth Providers', setupId: 'AuthProvidersPage' },
      { name: 'Connected Apps', setupId: 'ConnectedApplication' },
      { name: 'Connected Apps OAuth Usage', setupId: 'ConnectedAppsUsage' },
      { name: 'Named Credentials', setupId: 'NamedCredential' },
      { name: 'External Credentials', setupId: 'ExternalCredential' },
      { name: 'Remote Site Settings', setupId: 'SecurityRemoteProxy' },
      { name: 'CORS', setupId: 'CorsWhitelistEntries' },
      { name: 'CSP Trusted Sites', setupId: 'SecurityCspTrustedSite' },
      { name: 'Certificates & Key Management', setupId: 'CertificatesAndKeysManagement' },
      { name: 'Transaction Security Policies', setupId: 'TransactionSecurityNew' },
      { name: 'Event Log File Browser', setupId: 'ElfBrowser' },
      { name: 'Event Monitoring Settings', setupId: 'EventMonitoringSetup' },
      { name: 'MFA Assistant', setupId: 'MfaAssistant' },

      // Data & Integration
      { name: 'Object Manager', setupId: 'ObjectManager' },
      { name: 'Schema Builder', setupId: 'SchemaBuilder' },
      { name: 'Picklist Value Sets', setupId: 'Picklists' },
      { name: 'State & Country Picklists', setupId: 'AddressCleanerOverview' },
      { name: 'Duplicate Rules', setupId: 'DuplicateRules' },
      { name: 'Matching Rules', setupId: 'MatchingRules' },
      { name: 'Data Import Wizard', setupId: 'DataManagementDataImporter' },
      { name: 'Data Loader', setupId: 'DataManagementDataLoader' },
      { name: 'Data Export', setupId: 'DataManagementExport' },
      { name: 'Mass Delete Records', setupId: 'DataManagementDelete' },
      { name: 'Mass Transfer Records', setupId: 'DataManagementTransfer' },
      { name: 'Storage Usage', setupId: 'CompanyResourceDisk' },
      { name: 'Big Objects', setupId: 'BigObjects' },
      { name: 'External Services', setupId: 'ExternalServices' },
      { name: 'External Data Sources', setupId: 'ExternalDataSource' },
      { name: 'API Usage', setupId: 'MonitoringRateLimitingNotification' },

      // Email & Notifications
      { name: 'Email Templates', setupId: 'CommunicationTemplatesEmail' },
      { name: 'Lightning Email Templates', setupId: 'LightningEmailTemplateSetup' },
      { name: 'Organization-Wide Addresses', setupId: 'OrgWideEmailAddresses' },
      { name: 'Email Deliverability', setupId: 'OrgEmailSettings' },
      { name: 'Test Deliverability', setupId: 'TestEmailDeliverability' },
      { name: 'DKIM Keys', setupId: 'EmailDKIMList' },
      { name: 'Email to Salesforce', setupId: 'EmailToSalesforce' },
      { name: 'Custom Notifications', setupId: 'CustomNotifications' },

      // UI & Navigation
      { name: 'Tabs', setupId: 'CustomTabs', path: '/lightning/setup/CustomTabs/home', classicPath: '/setup/ui/customtabs.jsp?setupid=CustomTabs&retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DDevTools' },
      { name: 'App Manager', setupId: 'NavigationMenus' },
      { name: 'Lightning App Builder', setupId: 'FlexiPageList' },
      { name: 'Page Layouts', setupId: 'PageLayouts' },
      { name: 'Record Types', setupId: 'RecordTypes' },
      { name: 'Global Actions', setupId: 'GlobalActions' },
      { name: 'Path Settings', setupId: 'PathAssistantSetupHome' },
      { name: 'In-App Guidance', setupId: 'Prompts' },
      { name: 'Themes and Branding', setupId: 'ThemingAndBranding' },
      { name: 'User Interface', setupId: 'UserInterface', path: '/lightning/setup/UserInterfaceUI/home', classicPath: '/ui/setup/org/UserInterfaceUI?setupid=UserInterface&retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DCustomize' },
      { name: 'All Sites', setupId: 'SetupNetworks' },

      // Monitoring & Logs
      { name: 'Debug Logs', setupId: 'ApexDebugLogs', classicPath: '/setup/ui/listApexTraces.apexp?retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DLogs&setupid=ApexDebugLogs' },
      { name: 'Email Logs', setupId: 'EmailLogFiles' },
      { name: 'Setup Audit Trail', setupId: 'SecurityEvents' },
      { name: 'Bulk Data Load Jobs', setupId: 'AsyncApiJobStatus' },
      { name: 'Outbound Messages Monitor', setupId: 'WorkflowOmStatus' },
      { name: 'System Overview', setupId: 'SystemOverview' },

      // Company Settings
      { name: 'Company Information', setupId: 'CompanyProfileInfo' },
      { name: 'Business Hours', setupId: 'BusinessHours' },
      { name: 'Holidays', setupId: 'Holiday' },
      { name: 'Manage Currencies', setupId: 'CompanyCurrency' },
      { name: 'Release Updates', setupId: 'ReleaseUpdates' },
      { name: 'Salesforce Optimizer', setupId: 'SalesforceOptimizer' },

      // Reports & Dashboards
      { name: 'Report Types', setupId: 'CustomReportTypeLightning' },
      { name: 'Reporting Snapshots', setupId: 'AnalyticSnapshots' },

      // Sales & Service
      { name: 'Web-to-Lead', setupId: 'WebToLead' },
      { name: 'Support Settings', setupId: 'CaseSettings' },
      { name: 'Email-to-Case', setupId: 'EmailToCase' },
      { name: 'Web-to-Case', setupId: 'CaseWebtocase' },
      { name: 'Knowledge Settings', setupId: 'KnowledgeSettings' },
      { name: 'Omni-Channel Settings', setupId: 'OmniChannelSettings' },

      // Tools
      { name: 'Developer Console', setupId: 'DeveloperConsole', path: '/_ui/common/apex/debug/ApexCSIPage', classicPath: '/_ui/common/apex/debug/ApexCSIPage' },
      { name: 'Rename Tabs and Labels', setupId: 'RenameTab' },
      { name: 'My Domain', setupId: 'OrgDomain' },
      { name: 'Sandboxes', setupId: 'DataManagementCreateTestInstance' },

      // Personal
      { name: 'Personal Setup', setupId: 'PersonalSetup', path: '/lightning/settings/personal/PersonalInformation/home', classicPath: '/ui/setup/Setup?setupid=PersonalSetup' },
      { name: 'My Settings', setupId: 'PersonalSetup', path: '/lightning/settings/personal/PersonalInformation/home', classicPath: '/ui/setup/Setup?setupid=PersonalSetup' },
      { name: 'Advanced User Details', setupId: 'AdvancedUserDetails', path: '/lightning/settings/personal/AdvancedUserDetails/home', classicPath: '/ui/setup/Setup?setupid=AdvancedUserDetails' },
      { name: 'Change My Password', setupId: 'ChangePassword', path: '/lightning/settings/personal/ChangePassword/home', classicPath: '/ui/setup/Setup?setupid=ChangePassword' },
      { name: 'Language & Time Zone', setupId: 'LanguageAndTimeZone', path: '/lightning/settings/personal/LanguageAndTimeZone/home', classicPath: '/ui/setup/Setup?setupid=LanguageAndTimeZone' },
      { name: 'Reset My Security Token', setupId: 'ResetApiToken', path: '/lightning/settings/personal/ResetApiToken/home', classicPath: '/ui/setup/Setup?setupid=ResetApiToken' },
      { name: 'Grant Account Login Access', setupId: 'GrantLoginAccess', path: '/lightning/settings/personal/GrantLoginAccess/home', classicPath: '/ui/setup/Setup?setupid=GrantLoginAccess' },
    ].map(s => ({
      name: s.name, type: 'SetupPage', icon: '\u2699', label: s.name,
      setupId: s.setupId,
      path: s.path || `/lightning/setup/${s.setupId}/home`,
      classicPath: s.classicPath || `/ui/setup/Setup?setupid=${s.setupId}`
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

  // Rewrite known-stale Salesforce URLs to their current equivalents.
  // Old cached entries (recent items, search history, pins) may still hold
  // retired paths — normalize them at navigation time so links never 404.
  function normalizeUrl(url) {
    if (!url) return url;
    if (url.includes('/setup/ui/listTabs.apexp')) {
      return url.replace(
        '/setup/ui/listTabs.apexp',
        '/setup/ui/customtabs.jsp?setupid=CustomTabs&retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DDevTools'
      );
    }
    if (url.includes('/lightning/setup/Tabs/home')) {
      return url.replace('/lightning/setup/Tabs/home', '/lightning/setup/CustomTabs/home');
    }
    return url;
  }

  function getSetupUrl(item) {
    const base = API.getInstanceUrl();
    const lightning = base.includes('lightning.force.com') || document.querySelector('one-app-nav-bar');
    const isLightning = lightning || window.location.pathname.startsWith('/lightning');

    const url = isLightning
      ? _getLightningSetupUrl(base, item)
      : _getClassicSetupUrl(base, item);
    return normalizeUrl(url);
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
        return `${base}/lightning/setup/EnhancedProfiles/page?address=%2F${item.id}`;
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
        return `${base}/lightning/setup/CustomTabs/home`;
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
        // Classic Setup opens a custom object's detail page via its 01I…-prefixed
        // object definition Id (EntityDefinition.DurableId) — NOT the record key
        // prefix (e.g. a1I), which is not a valid navigation target.
        if (item.durableId) return `${base}/${item.durableId}?setupid=CustomObjects`;
        // No DurableId resolved (e.g. stale cache): fall back to Object Manager's
        // Details view, which routes by API name and works without the id. The old
        // /p/setup/layout/LayoutFieldList target throws "Insufficient Privileges".
        return `${base}/lightning/setup/ObjectManager/${encodeURIComponent(item.name)}/Details/view`;
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
        return `${base}/setup/ui/customtabs.jsp?setupid=CustomTabs&retURL=%2Fui%2Fsetup%2FSetup%3Fsetupid%3DDevTools`;
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
    getSetupUrl,
    normalizeUrl
  };
})();

if (typeof window !== 'undefined') {
  window.SFDTMetadataService = MetadataService;
}
