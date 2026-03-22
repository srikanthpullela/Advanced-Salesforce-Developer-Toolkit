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

    // Build SOSL RETURNING clause based on type filter
    const returning = [
      'ApexClass(Id, Name, NamespacePrefix)',
      'ApexTrigger(Id, Name, NamespacePrefix, TableEnumOrId)',
      'ApexPage(Id, Name, NamespacePrefix)'
    ].join(', ');

    const sosl = `FIND {${safeQuery}} IN ALL FIELDS RETURNING ${returning}`;

    try {
      const response = await API.toolingSearch(sosl);
      const searchRecords = response.searchRecords || response || [];

      const results = [];
      for (const r of searchRecords) {
        const attrs = r.attributes;
        if (!attrs) continue;
        const objType = attrs.type;

        let type, category;
        if (objType === 'ApexClass') { type = 'ApexClass'; category = 'apexClasses'; }
        else if (objType === 'ApexTrigger') { type = 'ApexTrigger'; category = 'apexTriggers'; }
        else if (objType === 'ApexPage') { type = 'VisualforcePage'; category = 'vfPages'; }
        else continue;

        results.push({
          id: r.Id,
          name: r.Name,
          type,
          namespace: r.NamespacePrefix,
          label: r.NamespacePrefix ? `${r.NamespacePrefix}.${r.Name}` : r.Name,
          objectName: r.TableEnumOrId,
          score: 300,
          matchType: 'code',
          category
        });
      }

      console.log(`[SFDT] SOSL code search "${query.substring(0, 40)}": ${results.length} results`);
      return results.slice(0, maxResults);
    } catch (e) {
      console.warn('[SFDT] SOSL code search failed:', e.message);
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

    // Escape SOSL reserved characters
    const safeQuery = query.replace(/([?&|!{}\[\]()^~*:\\"'+\-])/g, '\\$1');

    // Gather custom objects from the metadata index to include in search
    const idx = META().getIndex ? META().getIndex() : {};
    const customObjs = (idx.customObjects || [])
      .filter(o => o.name && o.name.endsWith('__c') && o.searchable !== false)
      .slice(0, 8)
      .map(o => `${o.name}(Id, Name)`);

    // Build SOSL with safe standard objects + custom objects
    const standardObjs = [
      'Account(Id, Name)',
      'Contact(Id, Name, Email)',
      'Opportunity(Id, Name, StageName)',
      'Lead(Id, Name, Company)',
      'Case(Id, CaseNumber, Subject)',
      'Product2(Id, Name, ProductCode)',
      'Campaign(Id, Name)'
    ];

    // Check total URL length — if too many custom objects, skip them
    const allObjs = [...standardObjs, ...customObjs];
    const returning = allObjs.join(', ');
    const testSosl = `FIND {${safeQuery}} IN NAME FIELDS RETURNING ${returning}`;

    // If SOSL would create URL > 1500 chars, use standard objects only
    const sosl = encodeURIComponent(testSosl).length > 1500
      ? `FIND {${safeQuery}} IN NAME FIELDS RETURNING ${standardObjs.join(', ')}`
      : testSosl;

    // Try with full object list, fall back to smaller sets on error
    const result = await _executeSoslSearch(API, sosl, safeQuery, standardObjs, maxResults);
    return result;
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
    const customObjNames = (idx.customObjects || [])
      .map(o => o.name)
      .filter(n => n && (n.endsWith('__c') || n.endsWith('__mdt')));
    const customSettingNames = (idx.customSettings || [])
      .map(o => o.name)
      .filter(n => n);

    const allObjs = [...new Set([...standardObjs, ...customObjNames, ...customSettingNames])];

    // Build label lookup for objects from metadata index
    const objLabelMap = {};
    for (const o of (idx.customObjects || [])) {
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
            score: 200,
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
            score: 200,
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
          score: 200,
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
    searchRecords,
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
