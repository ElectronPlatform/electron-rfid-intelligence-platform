# Electron Collection Schema Version 6

**Status:** Phase 2.1 identity contract; Phase 2.3 assignment engine implemented

**Purpose:** Define an identity-capable Collection database format without
running a migration or changing current user workflows.

**Normative machine-readable schema:**

- [`../schemas/collection-v6.schema.json`](../schemas/collection-v6.schema.json)
- legacy read contract:
  [`../schemas/collection-v5.schema.json`](../schemas/collection-v5.schema.json)

## 1. Compatibility rule

Electron supports two Collection database versions during the identity
foundation period:

| Version | Meaning | Runtime behavior |
| --- | --- | --- |
| 5 | Current legacy Collection database | Read exactly as today; no identity fields are added |
| 6 | Identity-capable Collection contract | Detect, read, validate and round-trip without changing identity |

Reading either version never performs a migration. Version numbers are JSON
integers. Strings such as `"5"` are invalid and are not coerced.

## 2. Version 6 root object

A Version 6 Collection database is a JSON object with these required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | integer, exactly `6` | Collection schema version |
| `settings` | object | Existing Collection settings, preserved unchanged |
| `assets` | array of Collection Record objects | Existing asset data plus identity fields |
| `log` | array | Existing legacy Collection log, preserved unchanged |
| `relationships` | array of objects | Reserved durable Relationship records |
| `identityDecisions` | array of objects | Reserved accepted/rejected identity decision records |
| `migration` | object | Provenance for the controlled v5-to-v6 identity migration |

Unknown root fields are preserved. They do not become authoritative merely
because they are present.

```json
{
  "version": 6,
  "settings": {
    "lastAssignedNumber": 12
  },
  "assets": [],
  "log": [],
  "relationships": [],
  "identityDecisions": [],
  "migration": {
    "migrationId": "migration-2026-07-24-example",
    "sourceVersion": 5,
    "completedVersion": 6,
    "completedAt": "2026-07-24T00:00:00.000Z"
  }
}
```

Relationship and Identity Resolution semantics remain out of scope for Phase
2.1. Compatible generators should leave `relationships` and
`identityDecisions` empty until the corresponding service contracts exist.

## 3. Collection Record contract

Every object in `assets` preserves all existing asset fields and adds four
required identity fields:

| Field | Type | Rule |
| --- | --- | --- |
| `recordId` | string | Immutable `rec_`-prefixed UUID v4 |
| `assetId` | non-empty string | User-visible Collection identifier |
| `identitySchemaVersion` | integer, exactly `1` | Record-level identity contract |
| `previousAssetIds` | array of unique non-empty strings | Historical visible IDs; must not include current `assetId` |

Existing fields such as alias, form, band, type, UID, photo references, backup
references, notes, status and timestamps remain additive properties and are
preserved unchanged.

Example:

```json
{
  "recordId": "rec_11111111-1111-4111-8111-111111111111",
  "identitySchemaVersion": 1,
  "previousAssetIds": [
    "RFID-0011"
  ],
  "assetId": "RFID-0012",
  "alias": "Workshop test card",
  "currentUid": "11:22:33:44",
  "status": "Active"
}
```

Manually created records remain valid without a UID, signature or Observation.
Those technical values are evidence, not Collection identity.

Archived records retain their `recordId` permanently. A record is treated as
archived when `archived` is `true` or `status` is `Archived`.

## 4. `recordId` contract

### 4.1 Format

The canonical format is:

```text
rec_<lowercase RFC 4122 UUID version 4>
```

Pattern:

```regex
^rec_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

Example:

```text
rec_6e1b1c1e-04a6-4d19-9c4f-f851202952b4
```

Uppercase, missing prefixes, non-v4 UUIDs, invalid RFC variants and malformed
strings are invalid. They are never silently repaired.

### 4.2 Identity behavior

- `recordId` is assigned exactly once by the controlled Phase 2.3 migration or
  Collection Service v6 creation path.
- It is never derived from UID, `assetId`, signature, protocol or filename.
- It is compared as an exact opaque string.
- It cannot be changed, removed, copied to a duplicate record or reused after
  archive, merge, split or deletion.
- Ordinary parsing and serialization preserve the exact valid value.
- The original Phase 2.1 contract reader still assigns no IDs. Phase 2.3 added
  generation only to explicit migration and v6 create/duplicate authorities.

The executable rules are in
[`../collectionRecordId.js`](../collectionRecordId.js).

## 5. Migration metadata

The required v6 migration object has this shape:

| Field | Type | Rule |
| --- | --- | --- |
| `migrationId` | non-empty string | Stable identity of one migration attempt/output |
| `sourceVersion` | integer, exactly `5` | Exact source Collection schema |
| `completedVersion` | integer, exactly `6` | Resulting Collection schema |
| `completedAt` | string | Canonical UTC ISO 8601 timestamp |

The migration object records provenance only. Its presence does not authorize
Electron to rerun, resume or reverse a migration automatically.

The controlled migration engine additionally produces a separate recovery
bundle containing the untouched v5 source, checksums, build/version details and
the migration report described by
[`COLLECTION_MIGRATION_PHASE_2_3.md`](COLLECTION_MIGRATION_PHASE_2_3.md).

## 6. Uniqueness and ambiguity

| Condition | Diagnostic | Migration readiness |
| --- | --- | --- |
| Duplicate `recordId`, including archived records | error | blocked |
| Malformed or missing v6 `recordId` | error | blocked |
| Duplicate active `assetId` | error | blocked |
| Reused active/archived `assetId` | warning | review required |
| Duplicate archived `assetId` | warning | review required |
| Duplicate UID | information | allowed; no merge is inferred |
| Orphaned legacy signature | information | preserved and unfiled |

`assetId` uniqueness is evaluated among active records. `recordId` uniqueness
is global because internal identities are never reused. A duplicate UID is
evidence ambiguity, not duplicate identity.

## 7. Parsing and serialization

The parser accepts a JSON string or an already parsed object and returns:

```text
ok
database
version
kind
diagnostics
```

`kind` is one of:

- `v5`
- `v6`
- `unsupported`
- `invalid`

The serializer:

- accepts only a database whose integer version is supported;
- never generates, normalizes or removes identity values;
- preserves unknown JSON properties;
- emits ordinary JSON;
- returns structured diagnostics if serialization fails.

The reader and serializer are implemented in
[`../collectionSchema.js`](../collectionSchema.js).

## 8. Validation result

Validation returns data instead of throwing renderer exceptions:

```json
{
  "valid": true,
  "version": 5,
  "kind": "v5",
  "diagnostics": [],
  "counts": {
    "assets": 1,
    "activeAssets": 1,
    "archivedAssets": 0,
    "errors": 0,
    "warnings": 0,
    "info": 0
  },
  "migrationReadiness": {
    "status": "ready",
    "ready": true,
    "blockers": [],
    "warnings": []
  }
}
```

Every diagnostic contains:

| Field | Meaning |
| --- | --- |
| `code` | Stable machine-readable diagnostic code |
| `severity` | `error`, `warning` or `info` |
| `path` | JSON-style location |
| `message` | Human-readable explanation |
| `details` | Structured supporting values |

Migration readiness states:

| State | Meaning |
| --- | --- |
| `ready` | Valid v5 input satisfies identity-assignment preflight rules |
| `blocked` | One or more errors must be resolved; no migration may run |
| `not-required` | Valid v6 database already carries the identity contract |

The validator is implemented in
[`../collectionValidation.js`](../collectionValidation.js).

## 9. Third-party generation checklist

To generate a compatible v6 database:

1. Write valid UTF-8 JSON with integer `version: 6`.
2. Include every required root field.
3. Include the four required identity fields on every Collection Record.
4. Use a canonical lowercase `rec_` UUID v4 for each record.
5. Keep every `recordId` globally unique.
6. Keep active `assetId` values unique.
7. Preserve duplicate UIDs as separate records; do not merge them.
8. Include canonical migration metadata.
9. Leave reserved relationship arrays empty unless their future service
   contracts are implemented.
10. Validate and round-trip the complete object before using it as a database.

Generating a valid v6 file does not make it safe to edit with older Electron
builds. Older renderer save paths may not preserve fields they do not know.

## 10. Schema-reader non-behavior

Ordinary schema reading does not:

- migrate a v5 database;
- assign a `recordId`;
- change import or export;
- change renderer lookup;
- create Relationships;
- link Observations;
- change Collection, Scan, Card Viewer or any other user workflow.

The main process records the detected version and structured diagnostics while
returning the database unchanged.

The separate Phase 2.3 administrative migration API may assign IDs only after
explicit invocation, exact recovery backup, mapping persistence and complete
v6 validation. It is not exposed through preload or renderer lifecycle code.
