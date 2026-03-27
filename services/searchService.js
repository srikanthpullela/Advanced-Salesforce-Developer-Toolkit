/**
 * SearchService - Provides fast fuzzy search across the full metadata index.
 * Supports partial match, case-insensitive, symbol/method/variable search.
 * Targets <200ms response time using pre-built indexes and scoring.
 */
const SearchService = (() => {
  const META = () => window.SFDTMetadataService;

  // ─── Fuzzy Match Scoring ───────────────────────────────

  function _fuzzyScore(query, text) {
    if (!text) return 0;
    const q = query.toLowerCase();
    const t = text.toLowerCase();

    // Exact match
    if (t === q) return 1000;

    // Starts with
    if (t.startsWith(q)) return 800 + (q.length / t.length) * 100;

    // Contains exact substring
    const idx = t.indexOf(q);
    if (idx !== -1) return 600 + (q.length / t.length) * 100 - idx;

    // Word boundary match (camelCase, snake_case)
    const words = t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]/g, ' ').toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.startsWith(q)) return 500 + (q.length / word.length) * 50;
    }

    // Fuzzy character match
    let qi = 0;
    let score = 0;
    let consecutive = 0;
    let lastMatchIdx = -2;

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        qi++;
        score += 10;
        if (ti === lastMatchIdx + 1) {
          consecutive++;
          score += consecutive * 5;
        } else {
          consecutive = 0;
        }
        // Bonus for word boundary matches
        if (ti === 0 || /[^a-z0-9]/i.test(t[ti - 1])) {
          score += 20;
        }
        lastMatchIdx = ti;
      }
    }

    if (qi < q.length) return 0; // Not all chars matched
    return Math.max(1, score - (t.length - q.length));
  }

  // ─── Code Symbol Extraction ───────────────────────────

  function _extractSymbols(body) {
    if (!body) return [];
    const symbols = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Method declarations
      const methodMatch = line.match(/(?:public|private|protected|global)\s+(?:static\s+)?(?:override\s+)?(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(/);
      if (methodMatch) {
        symbols.push({ name: methodMatch[1], kind: 'method', line: lineNum, text: line.trim() });
      }

      // Variable/property declarations
      const varMatch = line.match(/(?:public|private|protected|global)\s+(?:static\s+)?(?:final\s+)?(\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*[;=]/);
      if (varMatch && !methodMatch) {
        symbols.push({ name: varMatch[2], kind: 'variable', line: lineNum, text: line.trim() });
      }

      // Inner class declarations
      const classMatch = line.match(/(?:public|private|protected|global)\s+(?:virtual\s+|abstract\s+)?(?:with sharing\s+|without sharing\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: 'class', line: lineNum, text: line.trim() });
      }

      // Interface declarations
      const ifaceMatch = line.match(/(?:public|private|protected|global)\s+interface\s+(\w+)/);
      if (ifaceMatch) {
        symbols.push({ name: ifaceMatch[1], kind: 'interface', line: lineNum, text: line.trim() });
      }
    }

    return symbols;
  }

  function _extractMethodCalls(body, query) {
    if (!body) return [];
    const results = [];
    const q = query.toLowerCase();
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes(q)) {
        results.push({ line: i + 1, text: lines[i].trim() });
      }
    }

    return results;
  }

  // ─── Search Functions ─────────────────────────────────

  function searchAll(query, options = {}) {
    if (!query || query.length < 1) return [];

    const index = META().getIndex();
    if (!index || Object.keys(index).length === 0) return [];

    const maxResults = options.maxResults || 50;
    const typeFilter = options.typeFilter || null;

    const results = [];

    // Search across all metadata categories (name/label match only — fast, synchronous)
    const categories = Object.keys(index);
    for (const category of categories) {
      const items = index[category];
      if (!items || !Array.isArray(items)) continue;

      for (const item of items) {
        if (typeFilter && item.type !== typeFilter) continue;

        const nameScore = _fuzzyScore(query, item.name);
        const labelScore = item.label ? _fuzzyScore(query, item.label) : 0;
        const devNameScore = item.devName ? _fuzzyScore(query, item.devName) : 0;

        const bestScore = Math.max(nameScore, labelScore, devNameScore);

        if (bestScore > 0) {
          results.push({
            ...item,
            score: bestScore,
            matchType: 'name',
            category
          });
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Server-side code search using SOSL via the Tooling API search endpoint.
   * SOQL WHERE Body LIKE is not supported on long text fields — SOSL is the correct approach.
   * Returns results asynchronously.
   */
  async function searchCode(query, options = {}) {
    if (!query || query.length < 2) return [];

    const API = window.SalesforceAPI;
    if (!API || !API.isConnected() || !API.toolingSearch) return [];

    const maxResults = options.maxResults || 30;

    // Escape SOSL reserved characters: ? & | ! { } [ ] ( ) ^ ~ * : \ " ' + -
    const safeQuery = query.replace(/([?&|!{}\[\]()^~*:\\"'+\-])/g, '\\$1');

    // Build SOSL RETURNING clause — only entity types that support Tooling SOSL
    // AuraDefinitionBundle and LightningComponentBundle do NOT support search
    const returning = [
      'ApexClass(Id, Name, NamespacePrefix)',
      'ApexTrigger(Id, Name, NamespacePrefix, TableEnumOrId)',
      'ApexPage(Id, Name, NamespacePrefix)',
      'ApexComponent(Id, Name, NamespacePrefix)'
    ].join(', ');

    const sosl = `FIND {${safeQuery}} IN ALL FIELDS RETURNING ${returning}`;
    const results = [];

    try {
      const response = await API.toolingSearch(sosl);
      const searchRecords = response.searchRecords || response || [];

      for (const r of searchRecords) {
        const attrs = r.attributes;
        if (!attrs) continue;
        const objType = attrs.type;

        let type, category, name;
        if (objType === 'ApexClass') { type = 'ApexClass'; category = 'apexClasses'; name = r.Name; }
        else if (objType === 'ApexTrigger') { type = 'ApexTrigger'; category = 'apexTriggers'; name = r.Name; }
        else if (objType === 'ApexPage') { type = 'VisualforcePage'; category = 'vfPages'; name = r.Name; }
        else if (objType === 'ApexComponent') { type = 'ApexComponent'; category = 'vfComponents'; name = r.Name; }
        else continue;

        results.push({
          id: r.Id,
          name: name,
          type,
          namespace: r.NamespacePrefix,
          label: r.NamespacePrefix ? `${r.NamespacePrefix}.${name}` : name,
          objectName: r.TableEnumOrId,
          score: 300,
          matchType: 'code',
          category
        });
      }

      console.log(`[SFDT] SOSL code search "${query.substring(0, 40)}": ${results.length} results`);
    } catch (e) {
      console.warn('[SFDT] SOSL code search failed:', e.message);
    }

    // Search Aura/LWC components by name via Tooling SOQL (they don't support SOSL)
    const safeLike = query.replace(/'/g, "\\'");
    const auraLwcSearches = [
      {
        soql: `SELECT Id, DeveloperName, NamespacePrefix FROM AuraDefinitionBundle WHERE DeveloperName LIKE '%${safeLike}%' LIMIT 10`,
        type: 'AuraComponent', category: 'auraComponents'
      },
      {
        soql: `SELECT Id, DeveloperName, NamespacePrefix FROM LightningComponentBundle WHERE DeveloperName LIKE '%${safeLike}%' LIMIT 10`,
        type: 'LWC', category: 'lwcComponents'
      }
    ];

    await Promise.all(auraLwcSearches.map(async (search) => {
      try {
        const resp = await API.toolingQuery(search.soql);
        for (const r of (resp.records || [])) {
          results.push({
            id: r.Id,
            name: r.DeveloperName,
            type: search.type,
            namespace: r.NamespacePrefix,
            label: r.NamespacePrefix ? `${r.NamespacePrefix}.${r.DeveloperName}` : r.DeveloperName,
            score: 280,
            matchType: 'code',
            category: search.category
          });
        }
      } catch (e) {
        console.warn(`[SFDT] ${search.type} name search failed:`, e.message);
      }
    }));

    return results.slice(0, maxResults);
  }

  /**
   * Deep code body search using Tooling API SOSL with individual entity queries.
   * The main searchCode uses a single SOSL across Apex/VF. This function runs
   * individual targeted SOSL queries per entity type to catch results that the
   * combined SOSL might miss (e.g. method names inside VF markup).
   * Also searches inside Aura component source via AuraDefinition.
   */
  async function searchCodeDeep(query, onBatchResults, shouldAbort) {
    if (!query || query.length < 4) return;

    const API = window.SalesforceAPI;
    if (!API || !API.isConnected()) return;

    const safeQuery = query.replace(/([?&|!{}\[\]()^~*:\\"'+\-])/g, '\\$1');

    // Individual SOSL queries per entity type — catches cases where combined SOSL misses results
    const soslSearches = [
      {
        returning: 'ApexClass(Id, Name, NamespacePrefix)',
        type: 'ApexClass', category: 'apexClasses', nameField: 'Name'
      },
      {
        returning: 'ApexTrigger(Id, Name, NamespacePrefix)',
        type: 'ApexTrigger', category: 'apexTriggers', nameField: 'Name'
      },
      {
        returning: 'ApexPage(Id, Name, NamespacePrefix)',
        type: 'VisualforcePage', category: 'vfPages', nameField: 'Name'
      },
      {
        returning: 'ApexComponent(Id, Name, NamespacePrefix)',
        type: 'ApexComponent', category: 'vfComponents', nameField: 'Name'
      }
    ];

    for (const search of soslSearches) {
      if (shouldAbort && shouldAbort()) return;

      try {
        const sosl = `FIND {${safeQuery}} IN ALL FIELDS RETURNING ${search.returning}`;
        const response = await API.toolingSearch(sosl);
        const records = (response.searchRecords || response || []);

        if (records.length > 0 && onBatchResults) {
          const results = records.map(r => ({
            id: r.Id,
            name: r[search.nameField],
            type: search.type,
            namespace: r.NamespacePrefix,
            label: r.NamespacePrefix ? `${r.NamespacePrefix}.${r[search.nameField]}` : r[search.nameField],
            score: 250,
            matchType: 'code',
            category: search.category,
            codeMatch: true
          }));
          onBatchResults(results);
        }
      } catch (e) {
        // Individual type search failed — skip silently
      }
    }

    console.log('[SFDT] Deep code body search completed');
  }

  // ─── ID-Based Record Lookup ──────────────────────────

  /**
   * Detect if query looks like a Salesforce record ID (15 or 18 alphanumeric chars).
   */
  function _isSalesforceId(query) {
    return /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(query);
  }

  /**
   * Look up a record directly by its Salesforce ID.
   * Uses the key prefix (first 3 chars) to identify the object type from the metadata index.
   */
  async function _lookupRecordById(API, recordId) {
    const keyPrefix = recordId.substring(0, 3);

    // Find the object with this key prefix
    const idx = META().getIndex ? META().getIndex() : {};
    const allObjects = idx.objects || [];
    const obj = allObjects.find(o => o.keyPrefix === keyPrefix);

    if (!obj || !obj.queryable) {
      console.log(`[SFDT] ID lookup: no object found for key prefix "${keyPrefix}"`);
      return [];
    }

    console.log(`[SFDT] ID lookup: ${recordId} → ${obj.name} (prefix ${keyPrefix})`);

    try {
      const soql = `SELECT Id, Name FROM ${obj.name} WHERE Id = '${recordId}' LIMIT 1`;
      const response = await API.restQuery(soql);
      const records = response.records || [];

      return records.map(r => {
        const friendlyType = obj.label || obj.name.replace(/__c$/, '').replace(/.*__/, '').replace(/_/g, ' ');
        return {
          id: r.Id,
          name: r.Name || r.Id,
          type: 'Record',
          sobjectType: obj.name,
          score: 500,
          matchType: 'record',
          category: 'records',
          recordDetail: friendlyType
        };
      });
    } catch (e) {
      console.warn(`[SFDT] ID lookup failed for ${obj.name}:`, e.message);
      return [];
    }
  }

  /**
   * Global record search using SOSL via the REST Search API (not Tooling).
   * Searches across ALL searchable objects in the org — Products, Accounts, Contacts, etc.
   * Returns results asynchronously.
   */
  async function searchRecords(query, options = {}) {
    if (!query || query.length < 2) return [];

    const API = window.SalesforceAPI;
    if (!API || !API.isConnected()) return [];

    const maxResults = options.maxResults || 40;
    const trimmed = query.trim();

    // If query looks like a Salesforce ID, do a direct lookup
    if (_isSalesforceId(trimmed)) {
      const idResults = await _lookupRecordById(API, trimmed);
      if (idResults.length > 0) return idResults;
      // If ID lookup didn't find anything, fall through to normal search
    }

    // Escape SOSL reserved characters
    const safeQuery = query.replace(/([?&|!{}\[\]()^~*:\\"'+\-])/g, '\\$1');

    // Gather objects from the metadata index
    const idx = META().getIndex ? META().getIndex() : {};
    const allObjects = idx.objects || [];
    const standardNames = new Set([
      'Account', 'Contact', 'Opportunity', 'Lead', 'Case', 'Product2', 'Campaign'
    ]);

    // SOSL-searchable custom objects
    const soslSearchableObjs = allObjects
      .filter(o => o.name && o.name.endsWith('__c') && o.searchable === true && !standardNames.has(o.name))
      .slice(0, 25)
      .map(o => `${o.name}(Id, Name)`);

    // Key non-SOSL objects to search via SOQL fallback (kept small for speed)
    const builtInFallback = [
      'Apttus_Proposal__Proposal__c',
      'Apttus_Config2__ProductConfiguration__c',
      'Apttus_Config2__ProductAttributeValue__c'
    ];

    // Merge user-defined custom search objects from extension settings
    const userObjs = await _getUserCustomSearchObjects();
    const soqlFallbackObjs = [...new Set([...builtInFallback, ...userObjs])];

    // Standard SOSL-safe objects
    const standardObjs = [
      'Account(Id, Name)',
      'Contact(Id, Name, Email)',
      'Opportunity(Id, Name, StageName)',
      'Lead(Id, Name, Company)',
      'Case(Id, CaseNumber, Subject)',
      'Product2(Id, Name, ProductCode)',
      'Campaign(Id, Name)'
    ];

    // Build SOSL
    const allSoslObjs = [...standardObjs, ...soslSearchableObjs];
    const returning = allSoslObjs.join(', ');
    const testSosl = `FIND {${safeQuery}} IN ALL FIELDS RETURNING ${returning}`;
    const sosl = encodeURIComponent(testSosl).length > 2500
      ? `FIND {${safeQuery}} IN ALL FIELDS RETURNING ${standardObjs.join(', ')}`
      : testSosl;

    // Run SOSL + supplementary SOQL in parallel
    const [soslResults, soqlResults] = await Promise.all([
      _executeSoslSearch(API, sosl, safeQuery, standardObjs, maxResults),
      _executeSupplementarySoqlSearch(API, query.trim(), soqlFallbackObjs, maxResults)
    ]);

    // Merge and deduplicate by record Id
    const seenIds = new Set();
    const merged = [];
    for (const r of [...soslResults, ...soqlResults]) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        merged.push(r);
      }
    }
    return merged.slice(0, maxResults);
  }

  /**
   * Supplementary SOQL search for objects that don't support SOSL.
   * Supplementary SOQL search for key objects that don't support SOSL.
   * Special handling for known objects with non-standard name fields.
   */
  async function _executeSupplementarySoqlSearch(API, query, soqlFallbackObjs, maxResults) {
    if (!soqlFallbackObjs || soqlFallbackObjs.length === 0) return [];

    // Escape single quotes for SOQL
    const safeQuery = query.replace(/'/g, "\\'");
    const likePattern = `%${safeQuery}%`;

    // Known objects with non-standard name fields
    const specialNameFields = {
      'Apttus_Proposal__Proposal__c': {
        fields: 'Id, Name, Apttus_Proposal__Proposal_Name__c',
        nameField: 'Apttus_Proposal__Proposal_Name__c',
        displayField: 'Apttus_Proposal__Proposal_Name__c'
      }
    };

    const promises = soqlFallbackObjs.map(async (objName) => {
      try {
        const special = specialNameFields[objName];
        const fields = special ? special.fields : 'Id, Name';
        const nameField = special ? special.nameField : 'Name';
        const displayField = special ? special.displayField : 'Name';

        // For objects with a custom name field, also search the auto-number Name field
        const whereClause = (special && nameField !== 'Name')
          ? `${nameField} LIKE '${likePattern}' OR Name LIKE '${likePattern}'`
          : `${nameField} LIKE '${likePattern}'`;
        const soql = `SELECT ${fields} FROM ${objName} WHERE ${whereClause} LIMIT 10`;
        const response = await API.restQuery(soql);
        const records = response.records || [];
        return records.map(r => {
          const displayName = r[displayField] || r.Name || r.Id;
          const autoNumber = r.Name && r.Name !== displayName ? r.Name : null;
          const friendlyType = objName.replace(/__c$/, '').replace(/.*__/, '').replace(/_/g, ' ');
          return {
            id: r.Id,
            name: displayName,
            type: 'Record',
            sobjectType: objName,
            score: 200,
            matchType: 'record',
            category: 'records',
            recordDetail: (autoNumber ? `${autoNumber} · ` : '') + friendlyType
          };
        });
      } catch (e) {
        // Object may not exist in this org — silently skip
        return [];
      }
    });

    const allResults = await Promise.all(promises);
    const results = [];
    for (const batch of allResults) {
      results.push(...batch);
    }
    return results.slice(0, maxResults);
  }

  /**
   * Deep background SOQL search across all queryable non-SOSL custom objects.
   * Runs in batches to avoid overwhelming the API. Returns results incrementally via callback.
   * @param {string} query - The search term
   * @param {Function} onBatchResults - Called with array of new results as each batch completes
   * @param {Function} shouldAbort - Called before each batch; return true to cancel
   * @returns {Promise<void>}
   */
  async function searchRecordsDynamic(query, onBatchResults, shouldAbort) {
    if (!query || query.length < 2) return;

    const API = window.SalesforceAPI;
    if (!API || !API.isConnected()) return;

    const idx = META().getIndex ? META().getIndex() : {};
    const allObjects = idx.objects || [];

    // Objects actually covered by fast search:
    // - 7 standard objects (always in SOSL RETURNING)
    // - Up to 25 searchable __c objects (same slice as searchRecords)
    // - Hardcoded SOQL fallback + user custom objects
    const userObjs = await _getUserCustomSearchObjects();
    const standardNames = new Set([
      'Account', 'Contact', 'Opportunity', 'Lead', 'Case', 'Product2', 'Campaign'
    ]);
    const soslCoveredCustom = allObjects
      .filter(o => o.name && o.name.endsWith('__c') && o.searchable === true && !standardNames.has(o.name))
      .slice(0, 25)
      .map(o => o.name);

    const alreadyCovered = new Set([
      ...standardNames,
      ...soslCoveredCustom,
      'Apttus_Proposal__Proposal__c', 'Apttus_Config2__ProductConfiguration__c',
      'Apttus_Config2__ProductAttributeValue__c',
      ...userObjs
    ]);

    // Queryable custom objects not yet covered by fast search (capped to limit API usage)
    const dynamicObjs = allObjects
      .filter(o => o.name && o.queryable === true && !alreadyCovered.has(o.name) && o.name.endsWith('__c'))
      .map(o => o.name)
      .slice(0, 50);

    console.log(`[SFDT] Dynamic search: ${dynamicObjs.length} objects to query (${allObjects.length} total, ${alreadyCovered.size} covered)`);
    if (dynamicObjs.length > 0) console.log('[SFDT] Dynamic objects:', dynamicObjs.slice(0, 10).join(', '), dynamicObjs.length > 10 ? `... +${dynamicObjs.length - 10} more` : '');

    if (dynamicObjs.length === 0) return;

    const safeQuery = query.replace(/'/g, "\\'");
    const likePattern = `%${safeQuery}%`;

    // Known objects with non-standard name fields
    const specialNameFields = {
      'Apttus_Proposal__Proposal__c': {
        fields: 'Id, Name, Apttus_Proposal__Proposal_Name__c',
        nameField: 'Apttus_Proposal__Proposal_Name__c',
        displayField: 'Apttus_Proposal__Proposal_Name__c'
      }
    };

    const BATCH_SIZE = 5;
    for (let i = 0; i < dynamicObjs.length; i += BATCH_SIZE) {
      if (shouldAbort && shouldAbort()) return;

      const batch = dynamicObjs.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (objName) => {
        try {
          const special = specialNameFields[objName];
          const fields = special ? special.fields : 'Id, Name';
          const nameField = special ? special.nameField : 'Name';
          const displayField = special ? special.displayField : 'Name';

          // For objects with a custom name field, also search the auto-number Name field
          const whereClause = (special && nameField !== 'Name')
            ? `${nameField} LIKE '${likePattern}' OR Name LIKE '${likePattern}'`
            : `${nameField} LIKE '${likePattern}'`;
          const soql = `SELECT ${fields} FROM ${objName} WHERE ${whereClause} LIMIT 5`;
          const response = await API.restQuery(soql);
          const records = response.records || [];
          return records.map(r => {
            const displayName = r[displayField] || r.Name || r.Id;
            const autoNumber = r.Name && r.Name !== displayName ? r.Name : null;
            const friendlyType = objName.replace(/__c$/, '').replace(/.*__/, '').replace(/_/g, ' ');
            return {
              id: r.Id,
              name: displayName,
              type: 'Record',
              sobjectType: objName,
              score: 150, // Lower score so instant results stay on top
              matchType: 'record',
              category: 'records',
              recordDetail: (autoNumber ? `${autoNumber} · ` : '') + friendlyType
            };
          });
        } catch (e) {
          return [];
        }
      });

      const batchResults = await Promise.all(promises);
      const newResults = batchResults.flat().filter(r => r.id);
      if (newResults.length > 0 && onBatchResults) {
        onBatchResults(newResults);
      }
    }
  }

  async function _executeSoslSearch(API, sosl, safeQuery, standardObjs, maxResults) {
    // Attempt 1: Full SOSL with all objects
    try {
      const response = await API.globalSearch(sosl);
      return _parseSoslResults(response, maxResults);
    } catch (e1) {
      console.warn('[SFDT] Full SOSL search failed:', e1.message, '— retrying with standard objects only');
    }

    // Attempt 2: Standard objects only
    try {
      const sosl2 = `FIND {${safeQuery}} IN NAME FIELDS RETURNING ${standardObjs.join(', ')}`;
      const response = await API.globalSearch(sosl2);
      return _parseSoslResults(response, maxResults);
    } catch (e2) {
      console.warn('[SFDT] Standard SOSL search failed:', e2.message, '— retrying with minimal objects');
    }

    // Attempt 3: Minimal — just Account, Contact, Product2
    try {
      const sosl3 = `FIND {${safeQuery}} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name), Product2(Id, Name, ProductCode)`;
      const response = await API.globalSearch(sosl3);
      return _parseSoslResults(response, maxResults);
    } catch (e3) {
      console.warn('[SFDT] Minimal SOSL search failed:', e3.message);
    }

    // Attempt 4: Use parameterized search as final fallback (searches everything, simpler API)
    try {
      const response = await API.parameterizedSearch(safeQuery);
      return _parseSoslResults(response, maxResults);
    } catch (e4) {
      console.warn('[SFDT] Parameterized search also failed:', e4.message);
    }

    return [];
  }

  function _parseSoslResults(response, maxResults) {
    const records = response.searchRecords || response || [];
    const results = [];

    for (const r of records) {
      const attrs = r.attributes;
      if (!attrs) continue;
      const sobjectType = attrs.type;

      const name = r.Name || r.DeveloperName || r.MasterLabel || r.Title
        || r.Subject || r.CaseNumber || r.Label || r.SolutionName
        || r.OrderNumber || r.ContractNumber || r.Id;

      results.push({
        id: r.Id,
        name: name,
        type: 'Record',
        sobjectType: sobjectType,
        score: 250,
        matchType: 'record',
        category: 'records',
        recordDetail: _extractRecordDetail(r, sobjectType)
      });
    }

    console.log(`[SFDT] Record search: ${results.length} results`);
    return results.slice(0, maxResults);
  }

  // Cache for user custom search objects (refreshed every search to pick up changes quickly)
  let _userCustomObjsCache = null;
  let _userCustomObjsCacheTime = 0;

  async function _getUserCustomSearchObjects() {
    // Cache for 30 seconds to avoid reading storage on every keystroke
    if (_userCustomObjsCache && (Date.now() - _userCustomObjsCacheTime < 30000)) {
      return _userCustomObjsCache;
    }
    try {
      const data = await chrome.storage.sync.get('sfdt_custom_search_objects');
      const raw = data.sfdt_custom_search_objects || '';
      _userCustomObjsCache = raw.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0 && /^[a-zA-Z0-9_]+__[a-zA-Z0-9_]+$/.test(s));
      _userCustomObjsCacheTime = Date.now();
      return _userCustomObjsCache;
    } catch (e) {
      return [];
    }
  }

  function _extractRecordDetail(record, sobjectType) {
    const parts = [sobjectType];
    const fields = ['Email', 'Company', 'ProductCode', 'Phone', 'Industry',
                    'StageName', 'Status', 'Type', 'CaseNumber', 'OrderNumber',
                    'ContractNumber', 'Subject', 'Title'];
    for (const f of fields) {
      if (record[f]) {
        const val = String(record[f]);
        if (val.length <= 60) { parts.push(val); break; }
      }
    }
    return parts.join(' · ');
  }

  /**
   * Field-level search using Tooling API EntityParticle.
   * Searches field labels and API names across all objects.
   */
  async function searchFields(query, options = {}) {
    if (!query || query.length < 2) return [];

    const API = window.SalesforceAPI;
    if (!API || !API.isConnected()) return [];

    const maxResults = options.maxResults || 30;
    const safeQuery = query.replace(/'/g, "\\'");

    // EntityParticle REQUIRES a filter on a reified column (EntityDefinitionId, FieldDefinitionId, or DurableId).
    // We cannot search across all objects without specifying which objects to search.
    // Approach: Gather known objects from metadata index + standard objects, then query EntityParticle.

    const allResults = [];

    // Build list of objects to search: standard + custom from metadata index
    const standardObjs = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Product2', 'Campaign', 'Order', 'Contract', 'User', 'Task', 'Event'];
    const idx = META().getIndex ? META().getIndex() : {};
    const customObjNames = (idx.objects || [])
      .map(o => o.name)
      .filter(n => n && (n.endsWith('__c') || n.endsWith('__mdt')));
    const customSettingNames = (idx.customSettings || [])
      .map(o => o.name)
      .filter(n => n);

    const allObjs = [...new Set([...standardObjs, ...customObjNames, ...customSettingNames])];

    // Build label lookup for objects from metadata index
    const objLabelMap = {};
    for (const o of (idx.objects || [])) {
      if (o.name) objLabelMap[o.name] = o.label || o.name;
    }
    for (const o of (idx.customSettings || [])) {
      if (o.name) objLabelMap[o.name] = o.label || o.name;
    }

    // Query EntityParticle in batches — dynamically sized to keep full URL under browser limit
    const seen = new Set();
    // The full URL includes: base URL (~80) + /services/data/v59.0/tooling/query/?q= (~45) + encoded SOQL
    // Browser GET URL limit is ~2048 chars; keep well under that
    const MAX_URL_LEN = 1800;
    const soqlPrefix = `SELECT DurableId, QualifiedApiName, Label, DataType, EntityDefinitionId FROM EntityParticle WHERE EntityDefinitionId IN (`;
    const soqlSuffix = `) AND Label LIKE '%${safeQuery}%' LIMIT ${maxResults}`;
    const baseUrlLen = (getInstanceUrl().length || 60) + 50; // base + path overhead

    function getInstanceUrl() { return API.getInstanceUrl ? API.getInstanceUrl() : ''; }

    const batches = [];
    let currentBatch = [];
    let currentInLen = 0;
    for (const obj of allObjs) {
      const entryLen = encodeURIComponent(`'${obj}',`).length;
      const estimatedTotal = baseUrlLen + encodeURIComponent(soqlPrefix).length + currentInLen + entryLen + encodeURIComponent(soqlSuffix).length;
      if (currentBatch.length > 0 && estimatedTotal > MAX_URL_LEN) {
        batches.push(currentBatch);
        currentBatch = [];
        currentInLen = 0;
      }
      currentBatch.push(obj);
      currentInLen += entryLen;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    for (const batch of batches) {
      if (allResults.length >= maxResults) break;
      const inClause = batch.map(o => `'${o}'`).join(',');

      // Search by Label
      try {
        const soql = `SELECT DurableId, QualifiedApiName, Label, DataType, EntityDefinitionId FROM EntityParticle WHERE EntityDefinitionId IN (${inClause}) AND Label LIKE '%${safeQuery}%' LIMIT ${maxResults}`;
        const response = await API.toolingQuery(soql);
        for (const r of (response.records || [])) {
          const id = r.DurableId || `${r.EntityDefinitionId}.${r.QualifiedApiName}`;
          if (seen.has(id)) continue;
          seen.add(id);
          // EntityDefinitionId for standard objs = 'Account', for custom = API name
          const entityApi = r.EntityDefinitionId || 'Unknown';
          allResults.push({
            id,
            name: r.Label || r.QualifiedApiName,
            type: 'Field',
            fieldApiName: r.QualifiedApiName,
            fieldDataType: r.DataType || 'Unknown',
            entityName: entityApi,
            entityLabel: objLabelMap[entityApi] || entityApi,
            score: 350,
            matchType: 'field',
            category: 'fields'
          });
        }
      } catch (err) {
        console.warn('[SFDT] EntityParticle label search failed for batch:', err.message);
      }

      // Also search by API name
      try {
        const soql = `SELECT DurableId, QualifiedApiName, Label, DataType, EntityDefinitionId FROM EntityParticle WHERE EntityDefinitionId IN (${inClause}) AND QualifiedApiName LIKE '%${safeQuery}%' LIMIT ${maxResults}`;
        const response = await API.toolingQuery(soql);
        for (const r of (response.records || [])) {
          const id = r.DurableId || `${r.EntityDefinitionId}.${r.QualifiedApiName}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const entityApi = r.EntityDefinitionId || 'Unknown';
          allResults.push({
            id,
            name: r.Label || r.QualifiedApiName,
            type: 'Field',
            fieldApiName: r.QualifiedApiName,
            fieldDataType: r.DataType || 'Unknown',
            entityName: entityApi,
            entityLabel: objLabelMap[entityApi] || entityApi,
            score: 350,
            matchType: 'field',
            category: 'fields'
          });
        }
      } catch (err) {
        console.warn('[SFDT] EntityParticle apiName search failed for batch:', err.message);
      }
    }

    if (allResults.length > 0) {
      return allResults.slice(0, maxResults);
    }

    // Fallback: CustomField (custom fields only, always works)
    try {
      const soql = `SELECT Id, DeveloperName, TableEnumOrId, FullName FROM CustomField WHERE DeveloperName LIKE '%${safeQuery}%' ORDER BY DeveloperName ASC LIMIT ${maxResults}`;
      const response = await API.toolingQuery(soql);
      const records = response.records || [];
      return records.map(r => {
        const entityName = r.TableEnumOrId || 'Unknown';
        const apiName = r.FullName ? r.FullName.split('.').pop() : (r.DeveloperName + '__c');
        return {
          id: r.Id || `${entityName}.${apiName}`,
          name: r.DeveloperName || apiName,
          type: 'Field',
          fieldApiName: apiName,
          fieldDataType: 'Custom Field',
          entityName: entityName,
          entityLabel: entityName,
          score: 350,
          matchType: 'field',
          category: 'fields'
        };
      });
    } catch (err) {
      console.warn('[SFDT] CustomField search also failed:', err.message);
    }

    return [];
  }

  function searchByType(query, type) {
    return searchAll(query, { typeFilter: type });
  }

  function searchSymbols(query) {
    if (!query || query.length < 2) return [];

    const index = META().getIndex();
    const results = [];

    // Search in Apex classes and triggers
    const codeItems = [
      ...(index.apexClasses || []),
      ...(index.apexTriggers || [])
    ];

    for (const item of codeItems) {
      if (!item.body) continue;
      const symbols = _extractSymbols(item.body);
      for (const sym of symbols) {
        const score = _fuzzyScore(query, sym.name);
        if (score > 0) {
          results.push({
            ...item,
            symbol: sym,
            score: score + 100,
            matchType: 'symbol'
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 30);
  }

  function getSymbolsForClass(classId) {
    const index = META().getIndex();
    const cls = (index.apexClasses || []).find(c => c.id === classId);
    if (!cls || !cls.body) return [];
    return _extractSymbols(cls.body);
  }

  // ─── Quick Navigation Search ──────────────────────────

  function quickSearch(query) {
    if (!query || query.length < 1) return [];
    return searchAll(query, { maxResults: 15, includeSymbols: true });
  }

  return {
    searchAll,
    searchCode,
    searchCodeDeep,
    searchRecords,
    searchRecordsDynamic,
    searchFields,
    searchByType,
    searchSymbols,
    getSymbolsForClass,
    quickSearch,
    _fuzzyScore // Exposed for testing
  };
})();

if (typeof window !== 'undefined') {
  window.SFDTSearchService = SearchService;
}
