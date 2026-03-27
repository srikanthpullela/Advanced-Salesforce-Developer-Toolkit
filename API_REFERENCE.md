# SFDT — Complete API Call Reference

> Every Salesforce API call made by the Advanced Salesforce Developer Toolkit extension.

**API Version:** `v59.0`
**Session Token:** `Bearer` header using `sid` cookie

---

## Table of Contents

1. [Session & Authentication](#1-session--authentication)
2. [Index Build — Batch 1 (Apex, Lightning, Flows, Objects)](#2-index-build--batch-1)
3. [Index Build — Batch 2 (Profiles, Permissions, Labels, Reports)](#3-index-build--batch-2)
4. [Index Build — Batch 3 (Credentials, Resources, Templates, Tabs)](#4-index-build--batch-3)
5. [Search — Code (SOSL + SOQL)](#5-search--code)
6. [Search — Records (SOSL + SOQL)](#6-search--records)
7. [Search — Records Dynamic (Background SOQL)](#7-search--records-dynamic)
8. [Search — Fields (Tooling API)](#8-search--fields)
9. [SOQL Query Panel](#9-soql-query-panel)
10. [Debug Log Panel](#10-debug-log-panel)
11. [Execute Anonymous Panel](#11-execute-anonymous-panel)
12. [Record Inspector Panel](#12-record-inspector-panel)
13. [Data Builder Panel (CPQ)](#13-data-builder-panel)
14. [Navigator Panel](#14-navigator-panel)
15. [Background Service Worker](#15-background-service-worker)
16. [Session Validation](#16-session-validation)

---

## 1. Session & Authentication

| Step | Method | Details |
|------|--------|---------|
| **Primary** | `chrome.cookies.get('sid')` | Background script reads HttpOnly `sid` cookie via `chrome.cookies` API. Tries multiple candidate URLs (main domain, Lightning domain, VF parent domain). Also reads `oid` cookie for Org ID. |
| **Fallback 1** | `document.cookie` | Parses `sid=` from `document.cookie` (works in Classic where cookie is not HttpOnly). |
| **Fallback 2** | Aura config extraction | Scans `<script>` tags for `"token": "..."` in Aura framework config. |
| **Cross-Origin** | Background proxy (`_proxyFetch`) | When content script is on a VF domain (`*.vf.force.com`) but API target is `*.my.salesforce.com`, requests are proxied through the background service worker to bypass CORS. |

**All subsequent API calls use:**
```
Authorization: Bearer {sessionId}
Content-Type: application/json
```

---

## 2. Index Build — Batch 1

> Fetched in parallel via `Promise.all()` on extension load. Results are cached in `localStorage`.

| # | Function | API Type | Endpoint | SOQL/Query |
|---|----------|----------|----------|------------|
| 1 | `fetchApexClasses()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, Name, NamespacePrefix, Status, IsValid, LengthWithoutComments, ApiVersion FROM ApexClass ORDER BY Name` |
| 2 | `fetchApexTriggers()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, Name, TableEnumOrId, NamespacePrefix, Status, IsValid, ApiVersion FROM ApexTrigger ORDER BY Name` |
| 3 | `fetchVisualforcePages()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, Name, NamespacePrefix, ApiVersion, Description FROM ApexPage ORDER BY Name` |
| 4 | `fetchLightningComponents()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, DeveloperName, NamespacePrefix, Description, ApiVersion FROM LightningComponentBundle ORDER BY DeveloperName` |
| 5 | `fetchAuraComponents()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, DeveloperName, NamespacePrefix, Description, ApiVersion FROM AuraDefinitionBundle ORDER BY DeveloperName` |
| 6 | `fetchFlows()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, Definition.DeveloperName, MasterLabel, ProcessType, Description, Status FROM Flow WHERE Status = 'Active' ORDER BY MasterLabel` |
| 7 | `fetchValidationRules()` | **Tooling API** (QueryAll) | `/services/data/v59.0/tooling/query/` | `SELECT Id, ValidationName, EntityDefinitionId, Active, Description, ErrorMessage FROM ValidationRule WHERE Active = true ORDER BY ValidationName` |
| 8 | `fetchCustomObjects()` | **REST API** (Describe) | `/services/data/v59.0/sobjects/` | `describeGlobal()` — returns all sObjects. Filters to custom objects + key standard objects (Account, Contact, Opportunity, Lead, Case, Task, Event, Campaign, Order, Product2, Pricebook2, Quote, Contract). |

---

## 3. Index Build — Batch 2

> Fetched in parallel via `Promise.all()` after Batch 1 completes.

| # | Function | API Type | Endpoint | SOQL/Query |
|---|----------|----------|----------|------------|
| 9 | `fetchProfiles()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name FROM Profile ORDER BY Name` |
| 10 | `fetchPermissionSets()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name, Label, IsCustom FROM PermissionSet WHERE IsCustom = true ORDER BY Label` |
| 11 | `fetchCustomMetadata()` | **REST API** (Describe) | `/services/data/v59.0/sobjects/` | `describeGlobal()` — filters to objects ending with `__mdt`. |
| 12 | `fetchCustomSettings()` | **REST API** (Describe) | `/services/data/v59.0/sobjects/` | `describeGlobal()` — filters to objects where `customSetting = true`. |
| 13 | `fetchCustomLabels()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, Name, Value, Category, Language, NamespacePrefix FROM ExternalString WHERE NamespacePrefix = null ORDER BY Name` |
| 14 | `fetchReports()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name, DeveloperName, FolderName FROM Report ORDER BY Name LIMIT 500` |
| 15 | `fetchDashboards()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Title, DeveloperName, FolderId FROM Dashboard ORDER BY Title LIMIT 500` |

---

## 4. Index Build — Batch 3

> Fetched in parallel via `Promise.all()` after Batch 2 completes.

| # | Function | API Type | Endpoint | SOQL/Query |
|---|----------|----------|----------|------------|
| 16 | `fetchNamedCredentials()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, DeveloperName, MasterLabel, Endpoint FROM NamedCredential ORDER BY MasterLabel` |
| 17 | `fetchStaticResources()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name, Description, ContentType, NamespacePrefix FROM StaticResource ORDER BY Name` |
| 18 | `fetchEmailTemplates()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name, DeveloperName, FolderId, TemplateType FROM EmailTemplate ORDER BY Name LIMIT 200` |
| 19 | `fetchConnectedApps()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name FROM ConnectedApplication ORDER BY Name LIMIT 200` |
| 20 | `fetchRemoteSiteSettings()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, SiteName, EndpointUrl, IsActive FROM RemoteProxy ORDER BY SiteName LIMIT 200` |
| 21 | `fetchTabs()` | **REST API** (GET) | `/services/data/v59.0/tabs/` | Returns all tabs (standard + custom). No SOQL. |
| 22 | `fetchProductAttributes()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name, Apttus_Config2__ProductId__r.Name, Apttus_Config2__Field__c FROM Apttus_Config2__ProductAttribute__c ORDER BY Name LIMIT 2000` |

---

## 5. Search — Code

> Triggered when search query is ≥ 4 characters. Runs asynchronously after name-based search returns instant results.

### 5a. Primary Code Search (Combined SOSL)

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 23 | `searchCode()` | **Tooling API** (SOSL Search) | `/services/data/v59.0/tooling/search/` | `FIND {query} IN ALL FIELDS RETURNING ApexClass(Id, Name, NamespacePrefix), ApexTrigger(Id, Name, NamespacePrefix, TableEnumOrId), ApexPage(Id, Name, NamespacePrefix), ApexComponent(Id, Name, NamespacePrefix)` |

### 5b. Aura/LWC Name Search (SOQL — SOSL not supported for these)

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 24 | `searchCode()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, DeveloperName, NamespacePrefix FROM AuraDefinitionBundle WHERE DeveloperName LIKE '%{query}%' LIMIT 10` |
| 25 | `searchCode()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, DeveloperName, NamespacePrefix FROM LightningComponentBundle WHERE DeveloperName LIKE '%{query}%' LIMIT 10` |

### 5c. Deep Code Search (Individual SOSL per entity — fallback)

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 26 | `searchCodeDeep()` | **Tooling API** (SOSL Search) | `/services/data/v59.0/tooling/search/` | `FIND {query} IN ALL FIELDS RETURNING ApexClass(Id, Name, NamespacePrefix)` |
| 27 | `searchCodeDeep()` | **Tooling API** (SOSL Search) | `/services/data/v59.0/tooling/search/` | `FIND {query} IN ALL FIELDS RETURNING ApexTrigger(Id, Name, NamespacePrefix)` |
| 28 | `searchCodeDeep()` | **Tooling API** (SOSL Search) | `/services/data/v59.0/tooling/search/` | `FIND {query} IN ALL FIELDS RETURNING ApexPage(Id, Name, NamespacePrefix)` |
| 29 | `searchCodeDeep()` | **Tooling API** (SOSL Search) | `/services/data/v59.0/tooling/search/` | `FIND {query} IN ALL FIELDS RETURNING ApexComponent(Id, Name, NamespacePrefix)` |

---

## 6. Search — Records

> Triggered when search query is ≥ 2 characters. Uses REST API (not Tooling) for SOSL.

### 6a. ID-Based Lookup

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 30 | `_lookupRecordById()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name FROM {ObjectType} WHERE Id = '{recordId}' LIMIT 1` — object determined from key prefix (first 3 chars of ID). |

### 6b. SOSL Record Search (4 fallback attempts)

| # | Attempt | API Type | Endpoint | Query |
|---|---------|----------|----------|-------|
| 31 | **Attempt 1: Full** | **REST API** (SOSL) | `/services/data/v59.0/search/` | `FIND {query} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email), Opportunity(Id, Name, StageName), Lead(Id, Name, Company), Case(Id, CaseNumber, Subject), Product2(Id, Name, ProductCode), Campaign(Id, Name), {up to 25 searchable custom objects}(Id, Name)` |
| 32 | **Attempt 2: Standard only** | **REST API** (SOSL) | `/services/data/v59.0/search/` | `FIND {query} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email), ... Campaign(Id, Name)` |
| 33 | **Attempt 3: Minimal** | **REST API** (SOSL) | `/services/data/v59.0/search/` | `FIND {query} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name), Product2(Id, Name, ProductCode)` |
| 34 | **Attempt 4: Parameterized** | **REST API** (Parameterized Search) | `/services/data/v59.0/parameterizedSearch/` | `?q={query}` — Salesforce decides which objects to search. |

### 6c. Supplementary SOQL for Non-SOSL Objects

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 35 | `_executeSupplementarySoqlSearch()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name FROM {ObjectName} WHERE Name LIKE '%{query}%' LIMIT 10` — for each hardcoded + user-configured object. |

**Hardcoded SOQL-fallback objects:**
- `Apttus_Proposal__Proposal__c` (searches `Apttus_Proposal__Proposal_Name__c` + `Name`)
- `Apttus_Config2__ProductConfiguration__c`
- `Apttus_Config2__ProductAttributeValue__c`

**User-configured objects:** Stored in `chrome.storage.sync` under key `sfdt_custom_search_objects` (one API name per line).

---

## 7. Search — Records Dynamic

> Background search triggered when query is ≥ 3 characters. Searches remaining queryable custom objects not covered by the fast search.

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 36 | `searchRecordsDynamic()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name FROM {ObjectName} WHERE Name LIKE '%{query}%' LIMIT 5` — runs in **batches of 5 objects** across up to **50 custom objects**. Results stream incrementally via `onBatchResults` callback. |

**Objects searched:** All queryable `__c` objects from the metadata index that are NOT already covered by:
- 7 standard objects (Account, Contact, Opportunity, Lead, Case, Product2, Campaign)
- Up to 25 SOSL-searchable custom objects
- 3 hardcoded SOQL fallback objects
- User-configured custom objects

---

## 8. Search — Fields

> Triggered when search query is ≥ 3 characters. Searches field labels and API names.

### 8a. EntityParticle Search (Primary)

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 37 | `searchFields()` — by Label | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT DurableId, QualifiedApiName, Label, DataType, EntityDefinitionId FROM EntityParticle WHERE EntityDefinitionId IN ({objects}) AND Label LIKE '%{query}%' LIMIT 30` |
| 38 | `searchFields()` — by API Name | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT DurableId, QualifiedApiName, Label, DataType, EntityDefinitionId FROM EntityParticle WHERE EntityDefinitionId IN ({objects}) AND QualifiedApiName LIKE '%{query}%' LIMIT 30` |

> Runs in dynamically-sized batches to keep URL under ~1800 chars (browser GET limit). Searches across: 12 standard objects + all custom objects + custom metadata types + custom settings from the metadata index.

### 8b. CustomField Search (Fallback — if EntityParticle returns nothing)

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 39 | `searchFields()` — fallback | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, DeveloperName, TableEnumOrId, FullName FROM CustomField WHERE DeveloperName LIKE '%{query}%' ORDER BY DeveloperName ASC LIMIT 30` |

---

## 9. SOQL Query Panel

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 40 | `executeQuery()` | **REST API** (Query) | `/services/data/v59.0/query/` | User-entered SOQL |
| 41 | `executeToolingQuery()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | User-entered SOQL (when Tooling toggle is on) |
| 42 | `fetchNextPage()` | **REST API** (GET) | `{nextRecordsUrl}` | Automatic pagination for large result sets |
| 43 | Autocomplete — Objects | Local | — | Searches in-memory metadata index (no API call) |
| 44 | Autocomplete — Fields | **REST API** (Describe) | `/services/data/v59.0/sobjects/{ObjectName}/describe/` | `describeSObject()` — returns all fields for autocomplete. Cached after first call per object. |

---

## 10. Debug Log Panel

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 45 | `getDebugLogs(50)` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, LogUserId, LogLength, LastModifiedDate, Request, Operation, Application, Status, DurationMilliseconds FROM ApexLog ORDER BY LastModifiedDate DESC LIMIT 50` |
| 46 | `getDebugLogs(200)` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | Same as above with `LIMIT 200` (used for bulk operations) |
| 47 | `getDebugLogBody(logId)` | **Tooling API** (GET) | `/services/data/v59.0/tooling/sobjects/ApexLog/{logId}/Body` | Returns raw log text (`Accept: text/plain`). |

---

## 11. Execute Anonymous Panel

| # | Function | API Type | Endpoint | Query |
|---|----------|----------|----------|-------|
| 48 | `executeAnonymous(code)` | **Tooling API** (GET) | `/services/data/v59.0/tooling/executeAnonymous/?anonymousBody={code}` | Executes anonymous Apex code. |
| 49 | `getDebugLogs(1)` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, ... FROM ApexLog ORDER BY LastModifiedDate DESC LIMIT 1` — fetches the most recent log after execution. |
| 50 | `getDebugLogBody(logId)` | **Tooling API** (GET) | `/services/data/v59.0/tooling/sobjects/ApexLog/{logId}/Body` | Retrieves the execution log body. |

---

## 12. Record Inspector Panel

| # | Function | API Type | Endpoint | Usage |
|---|----------|----------|----------|-------|
| 51 | `getRecord(objectName, recordId)` | **REST API** (GET) | `/services/data/v59.0/sobjects/{ObjectName}/{RecordId}` | Loads all fields for the current record. Auto-detected from the page URL. |
| 52 | `restPatch(objectName, recordId, data)` | **REST API** (PATCH) | `/services/data/v59.0/sobjects/{ObjectName}/{RecordId}` | Inline field edit — updates a single field value. |
| 53 | `getRecord()` (compare) | **REST API** (GET) | `/services/data/v59.0/sobjects/{ObjectName}/{RecordId}` | Fetches a second record for side-by-side comparison. |

---

## 13. Data Builder Panel (CPQ)

| # | Function | API Type | Endpoint | Usage |
|---|----------|----------|----------|-------|
| 54 | `describeSObject(objectName)` | **REST API** (Describe) | `/services/data/v59.0/sobjects/{ObjectName}/describe/` | Gets creatable fields for Product2, option groups, etc. |
| 55 | `restQuery()` | **REST API** (Query) | `/services/data/v59.0/query/` | `SELECT Id, Name, {NS}Label__c, {NS}ProductId__r.Name FROM {NS}ProductOptionGroup__c ORDER BY Name LIMIT 200` — fetches existing option groups. |
| 56 | `restPost(objectName, data)` | **REST API** (POST) | `/services/data/v59.0/sobjects/{ObjectName}` | Creates records: Product2, ProductOptionGroup, ProductOptionComponent, ProductAttribute, PriceListItem, etc. |
| 57 | `restPost(linkObject, linkData)` | **REST API** (POST) | `/services/data/v59.0/sobjects/{LinkObject}` | Creates junction/link records between parent and child objects. |

---

## 14. Navigator Panel

| # | Function | API Type | Endpoint | Usage |
|---|----------|----------|----------|-------|
| 58 | `_fetchInstalledPackages()` | **Tooling API** (Query) | `/services/data/v59.0/tooling/query/` | `SELECT Id, SubscriberPackage.Name, SubscriberPackageVersion.Name FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.Name` |

> All other Navigator categories call the same `fetchXxx()` functions from MetadataService listed in Batches 1–3 above (cached — no duplicate API calls).

---

## 15. Background Service Worker

| # | Action | Method | Details |
|---|--------|--------|---------|
| 59 | `get-session` | `chrome.cookies.get()` | Reads `sid` and `oid` cookies from multiple candidate URLs. |
| 60 | `proxy-fetch` | `fetch()` | Proxies REST/Tooling API calls from content scripts when cross-origin (VF pages). Supports JSON & text response types. |
| 61 | `open-new-tab` | `chrome.tabs.create()` | Opens search results in a new tab. |
| 62 | `open-setup-url` | `chrome.tabs.update()` | Navigates current tab to a setup URL. |

---

## 16. Session Validation

| # | Function | API Type | Endpoint | Usage |
|---|----------|----------|----------|-------|
| 63 | `getLimits()` | **REST API** (GET) | `/services/data/v59.0/limits/` | Lightweight call at start of `buildIndex()` to verify the session is valid before firing parallel metadata queries. |

---

## Summary by API Type

| API Type | Endpoint Pattern | Count | Used For |
|----------|------------------|-------|----------|
| **Tooling API — Query** | `/tooling/query/?q=` | ~18 | Apex, VF, Flows, Validation Rules, Labels, Named Credentials, Remote Sites, Debug Logs, EntityParticle, CustomField, InstalledPackages |
| **Tooling API — QueryAll** | `/tooling/query/?q=` (with pagination) | 5 | ApexClass, ApexTrigger, ApexPage, LWC, Aura (fetches ALL records) |
| **Tooling API — SOSL Search** | `/tooling/search/?q=` | 5-9 | Code search across Apex/VF body content |
| **Tooling API — GET** | `/tooling/sobjects/...` | 2 | Debug log body, Execute Anonymous |
| **REST API — Query** | `/query/?q=` | ~12 | Profiles, Permissions, Reports, Dashboards, Static Resources, Email Templates, Connected Apps, Product Attributes, record search, user SOQL |
| **REST API — SOSL Search** | `/search/?q=` | 1-4 | Global record search with fallback chain |
| **REST API — Parameterized Search** | `/parameterizedSearch/?q=` | 0-1 | Final record search fallback |
| **REST API — Describe** | `/sobjects/` or `/sobjects/{name}/describe/` | 3+ | Custom objects list, field metadata, Data Builder |
| **REST API — GET** | `/sobjects/{type}/{id}`, `/tabs/`, `/limits/` | 3+ | Record inspector, tabs, session check |
| **REST API — PATCH** | `/sobjects/{type}/{id}` | 1 | Record inspector inline edit |
| **REST API — POST** | `/sobjects/{type}` | 2 | Data Builder record creation |
| **chrome.cookies** | N/A | 1 | Session token retrieval |

---

## API Usage Estimate Per Session

| Scenario | Approx. API Calls |
|----------|-------------------|
| Extension load (full index build, uncached) | ~22 calls (3 batches) |
| Extension load (cached) | 1 call (session validation only) |
| Single global search (4+ chars) | 3–15 calls (name match + code SOSL + record SOSL + field search + deep code + dynamic records) |
| SOQL query execution | 1 call |
| Debug log view | 1–2 calls (list + body) |
| Execute Anonymous | 2–3 calls (execute + log list + log body) |
| Record Inspector | 1 call (getRecord) |
| Inline field edit | 1 call (PATCH) |
