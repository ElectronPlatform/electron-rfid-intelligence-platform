# Electron Domain Model

**Status:** Proposed canonical domain model

**Depends on:** [ARCHITECTURAL_VISION.md](ARCHITECTURAL_VISION.md)

**Purpose:** Define the meaning, ownership, lifecycle and relationships of
Electron's core domain entities.

## 1. Domain model principles

The model separates:

- real-world objects from their digital representations;
- temporary sessions from durable evidence;
- observations from interpretations;
- card-specific information from shared knowledge;
- authoritative domain ownership from workspace presentation.

The model is not considered implemented merely because similarly named objects
exist in the current code.

## 2. Domain services

The following names describe architectural responsibilities. They are not a
claim that matching implementation modules already exist.

| Domain service | Authoritative responsibility |
| --- | --- |
| Collection Service | Collection Record lifecycle, curation, archive, merge and split |
| Acquisition Service | Scan Session lifecycle and device acquisition context |
| Observation Service | Validation, acceptance, linking and preservation of Observations |
| Analysis Service | Finding lifecycle and evidence-backed analytical conclusions |
| Artefact Service | Imported or generated files and their metadata |
| Identity Resolution Service | Candidate matches and accepted record relationships |
| Knowledge Service | Shared versioned technology, protocol, family and capability knowledge |
| Research Service | Explicitly saved local research and its scope |
| Relationship Service | Typed links between durable domain entities |
| History Service | Immutable provenance and mutation events |
| Workspace Context Service | Temporary unfiled, record, family and global task contexts |

## 3. Persistence states

Domain output uses an explicit state progression:

```text
temporary
  -> proposed
  -> validated
  -> accepted or rejected
  -> durable
  -> active, superseded or archived
```

Not every entity uses every state. The meaning of each state is:

| State | Meaning |
| --- | --- |
| Temporary | Exists only for an active session or calculation |
| Proposed | Candidate durable information awaiting a decision |
| Validated | Structurally and semantically acceptable, but not yet durable |
| Accepted | Explicitly approved for persistence |
| Rejected | Deliberately not accepted; may have a minimal decision event |
| Durable | Stored under an authoritative domain service |
| Superseded | Preserved but no longer the current accepted interpretation |
| Archived | Retained but removed from normal active use |

## 4. Provenance envelope

Every durable Observation, Finding, Artefact, Research Record, Relationship and
mutable Collection Record assertion carries or references:

- `createdAt`;
- source type;
- source identifier;
- originating session or import identifier where applicable;
- device and software context where applicable;
- parser, schema and knowledge versions;
- classification as observed, parsed, inferred, imported or user-supplied;
- acceptance actor and acceptance time;
- current status;
- supersession or correction references;
- relevant History Event identifiers.

Provenance must be sufficient to explain a durable conclusion without requiring
the original workspace to be open.

## 5. Entity overview

| Entity | Nature | Authoritative owner | Typical scope |
| --- | --- | --- | --- |
| Physical RFID Object | External | None inside Electron | Real world |
| Collection Record | Durable | Collection Service | One curated RFID asset |
| Scan Session | Temporary | Acquisition Service | One acquisition attempt |
| Observation | Proposed or durable | Observation Service | Evidence from one occurrence |
| Finding | Proposed or durable | Analysis Service | Evidence-backed conclusion |
| Artefact | Proposed or durable | Artefact Service | File or generated document |
| Knowledge Entity | Durable | Knowledge Service | Shared family/protocol/device knowledge |
| Research Record | Durable after explicit save | Research Service | Local card, family or technology research |
| Relationship | Proposed or durable | Relationship Service | Typed link between entities |
| History Event | Durable and immutable | History Service | One domain change or decision |
| Workspace Context | Temporary | Workspace Context Service | Unfiled, record, family or global task |

## 6. Physical RFID Object

### Exact meaning

The real-world RFID-bearing object with which hardware interacts. It may be a
card, tag, fob, label, token, embedded chip or another physical form.

Electron cannot directly store or prove the physical object's identity. It can
only store evidence and a curated representation.

### Temporary or durable

External, not an Electron persistence entity. Its presence in an acquisition
session is temporary.

### Creating domain service

None. Electron observes an already existing external object.

### Authoritative owner

None inside Electron.

### Allowed references and cardinality

- Zero or more Scan Sessions may interact with the same physical object.
- Zero or more Collection Records may claim to represent it because duplicate
  or mistaken records are possible.
- Electron does not persist a direct pointer to a physical object.

The intended steady state is one curated Collection Record per collected
physical asset, but this remains a correctable conclusion rather than a
mathematical guarantee.

### Lifecycle

Outside Electron. Electron may record assertions such as active, lost,
destroyed, replaced or transferred on the corresponding Collection Record.

### Persistence transition

None. Evidence about the object may be proposed as an Observation or used to
create a Collection Record.

### Provenance requirements

Any assertion about the physical object must identify whether it was observed,
inferred or supplied by the user.

### Versioning requirements

Not applicable to the external object. Interpretations of it are versioned in
Observations, Findings and Collection Records.

### Correction and reversibility

Electron must permit a Collection Record to be corrected when it represented
the wrong physical object or when two records represented the same object.

### Archive, unlink, supersede, reject and delete

- **Archive:** Not applicable directly; archive the Collection Record.
- **Unlink:** Remove or supersede the relationship between evidence and a
  Collection Record.
- **Supersede:** Supersede Electron's assertion about representation.
- **Reject:** Reject a proposed identity relationship.
- **Delete:** Electron cannot delete a physical object.

## 7. Collection Record

### Exact meaning

Electron's durable, curated representation of one intended RFID asset. It is
the aggregate root for card-specific curation and provides a stable,
Electron-assigned record ID independent of UID, protocol or family.

It links to evidence and shared knowledge; it does not copy every linked entity
into one object.

### Temporary or durable

Durable.

### Creating domain service

Collection Service.

### Authoritative owner

Collection Service.

### Allowed references and cardinality

A Collection Record may reference:

- zero or more accepted Observations;
- zero or more Findings;
- zero or more Artefacts;
- zero or more applicable Knowledge Entities;
- zero or more Research Records;
- zero or more Relationships;
- zero or more History Events;
- zero or one current preferred identity assertion per identity category.

It may temporarily have no accepted Observation when manually created or
imported.

### Lifecycle

```text
proposed
  -> validated
  -> active
  -> archived
  -> restored
```

Additional governed transitions include merge, split and tombstoned deletion.

### Persistence transition

Created only by:

- explicit user acceptance of a proposed new record;
- explicit manual creation;
- accepted import;
- governed split of an existing record.

A successful scan alone does not create a Collection Record.

### Provenance requirements

Every mutable assertion records its source. Creation, editing, merge, split,
archive and deletion each produce a History Event.

### Versioning requirements

- Stable record ID never changes.
- Record schema version is stored.
- Mutable assertions support revision or event-based history.
- Derived current state identifies the contributing evidence versions.

### Correction and reversibility

- Incorrect fields are corrected through new assertions or events.
- Duplicate records may be merged without discarding source IDs or history.
- A merge remains reversible.
- A mixed record may be split with explicit reassignment of evidence.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain record and links but remove it from normal active
  collection use.
- **Unlink:** Remove or supersede a Relationship; do not silently delete the
  referenced entity.
- **Supersede:** Individual assertions may be superseded; the record ID remains.
- **Reject:** A proposed record may be rejected before creation.
- **Delete:** Prefer a tombstone for accepted records. Permanent purge is a
  separate explicit operation governed by retention policy.

## 8. Scan Session

### Exact meaning

A bounded temporary acquisition process involving an RFID reader, zero or more
detected physical objects, command execution and parser input.

A Scan Session is not an Observation and is not a Collection Record.

### Temporary or durable

Temporary.

### Creating domain service

Acquisition Service.

### Authoritative owner

Acquisition Service while active.

### Allowed references and cardinality

- One initiating Workspace Context.
- Zero or one active device connection.
- Zero or more command executions.
- Zero or more detected object contexts.
- Zero or more proposed Observations.
- Zero or more candidate Collection Record matches.

Most normal sessions produce one primary proposed Observation, but the model
must tolerate no detection or multiple detections.

### Lifecycle

```text
created
  -> acquiring
  -> parsing
  -> completed | failed | cancelled
  -> destroyed
```

### Persistence transition

The session never persists as a session object by default. It may produce a
proposed Observation. Explicit acceptance persists the Observation, not the
runtime session.

Minimal operational audit may be retained only under an explicit History or
diagnostic policy and must not contain the entire temporary payload by default.

### Provenance requirements

Carries device, transport, command, parser and timing context so that accepted
outputs can inherit provenance.

### Versioning requirements

Session contract, command-plan, parser and output schema versions are recorded
in proposed outputs.

### Correction and reversibility

Session output may be reinterpreted while active. Once destroyed, corrections
apply to accepted Observations or Findings, not to the former session.

### Archive, unlink, supersede, reject and delete

- **Archive:** Not applicable.
- **Unlink:** Candidate record matches may be withdrawn before acceptance.
- **Supersede:** A rerun creates a new session; it does not mutate the old one.
- **Reject:** Reject proposed outputs.
- **Delete:** Destruction clears temporary state.

## 9. Observation

### Exact meaning

A timestamped evidence package describing what was obtained during one
acquisition occurrence. It preserves direct readings and approved parsed
representations without claiming that every interpretation is permanently
correct.

### Temporary or durable

Proposed while awaiting acceptance; durable after acceptance.

### Creating domain service

Observation Service from Acquisition Service output, import or another
validated evidence source.

### Authoritative owner

Observation Service.

### Allowed references and cardinality

- Exactly one origin: session, import or external evidence source.
- Zero or one confirmed Collection Record link.
- Zero or more candidate Collection Record Relationships.
- Zero or more Findings.
- Zero or more Artefacts.
- Zero or more History Events.
- Zero or more parser interpretations over time.

### Lifecycle

```text
proposed
  -> validated
  -> accepted | rejected
accepted
  -> active
  -> superseded interpretation | archived
```

The evidence itself is not overwritten when its interpretation changes.

### Persistence transition

Requires explicit acceptance. Acceptance may occur together with:

- linking to an existing Collection Record;
- creating a new Collection Record;
- leaving the Observation durably unfiled for later resolution.

### Provenance requirements

Includes acquisition time, device context, source, parser version, observed
versus parsed classification, acceptance actor and any redaction or
normalisation performed.

### Versioning requirements

- Immutable evidence identity.
- Versioned payload schema.
- Parser interpretations are separate versioned projections.
- Reprocessing creates a new interpretation, not a rewritten Observation.

### Correction and reversibility

- Correct record links through Relationships.
- Correct interpretations by superseding them.
- Preserve original evidence and decision history.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain evidence but hide it from current views.
- **Unlink:** Remove the confirmed record Relationship while preserving the
  Observation as unfiled.
- **Supersede:** Supersede interpretations, not historical evidence.
- **Reject:** A proposed Observation is not persisted except for an optional
  minimal rejection event.
- **Delete:** Durable evidence follows explicit retention and purge policy;
  record deletion does not automatically delete it.

## 10. Finding

### Exact meaning

A typed analytical conclusion derived from one or more Observations, Artefacts,
Knowledge Entities or temporary analyses. Examples include a family
classification, access interpretation or validated engineering conclusion.

### Temporary or durable

Proposed while in a session; durable only after explicit acceptance.

### Creating domain service

Analysis Service.

### Authoritative owner

Analysis Service.

### Allowed references and cardinality

- One or more evidence references.
- Zero or more Collection Record targets.
- Zero or more Knowledge Entity references.
- Zero or more supporting or contradicting Findings.
- Zero or more History Events.

A card-specific durable Finding must be attributable to at least one
Collection Record.

### Lifecycle

```text
temporary
  -> proposed
  -> validated
  -> accepted | rejected
accepted
  -> current
  -> superseded | withdrawn | archived
```

### Persistence transition

Requires explicit acceptance after schema validation and evidence binding.
Accepting one Finding does not persist the rest of its temporary session.

### Provenance requirements

Includes analysis type, algorithm/parser version, evidence references,
confidence, knowledge version, acceptance actor and time.

### Versioning requirements

Findings are immutable revisions. A changed conclusion creates a new Finding
that supersedes the earlier one.

### Correction and reversibility

An accepted Finding may be withdrawn or superseded with a reason. The earlier
Finding remains available to History.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain but remove from current conclusions.
- **Unlink:** Supersede the target Relationship; preserve the Finding.
- **Supersede:** Create a replacement Finding referencing the previous one.
- **Reject:** Do not persist the proposal beyond optional rejection provenance.
- **Delete:** Use governed purge only; normal correction uses withdrawal or
  supersession.

## 11. Artefact

### Exact meaning

A durable or proposed binary or textual object associated with RFID work, such
as a dump, photograph, imported capture, report or generated comparison
document.

An Artefact is distinct from the metadata describing it and from conclusions
derived from it.

### Temporary or durable

Temporary while generated or selected; durable after explicit import, capture
acceptance or save.

### Creating domain service

Artefact Service.

### Authoritative owner

Artefact Service.

### Allowed references and cardinality

- Zero or more Collection Records.
- Zero or more Observations.
- Zero or more Findings.
- Zero or more Relationships.
- Zero or more History Events.

An Artefact may remain unfiled if its source record is unknown.

### Lifecycle

```text
temporary
  -> proposed
  -> validated
  -> durable | rejected
durable
  -> active
  -> archived | superseded | purged
```

### Persistence transition

Requires explicit save or accepted import. Generated preview content is not
durable until saved.

### Provenance requirements

Includes origin, creation/import time, format, content hash, producing tool,
source session or record, validation result and acceptance actor.

### Versioning requirements

Content is immutable by hash. A changed file becomes a new Artefact version or
new Artefact linked by a supersession Relationship.

### Correction and reversibility

Metadata and links may be corrected without rewriting content. Replacing a file
creates a new version.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain content and metadata outside normal active use.
- **Unlink:** Remove a record or evidence link; the Artefact may remain unfiled.
- **Supersede:** Link replacement Artefact to prior version.
- **Reject:** Do not import or retain temporary content.
- **Delete:** Purge only through explicit Artefact retention policy; record
  deletion does not automatically purge shared artefacts.

## 12. Knowledge Entity

### Exact meaning

A versioned shared description of a technology, family, protocol, manufacturer,
device, capability, command concept or other reusable technical subject.

It explains categories of RFID technology independently from one particular
physical object.

### Temporary or durable

Durable.

### Creating domain service

Knowledge Service through bundled data, validated update or accepted knowledge
contribution.

### Authoritative owner

Knowledge Service.

### Allowed references and cardinality

- Zero or more other Knowledge Entities.
- Zero or more Collection Records.
- Zero or more Findings.
- Zero or more Research Records.
- Zero or more History Events.

Knowledge-to-record applicability is many-to-many.

### Lifecycle

```text
draft
  -> validated
  -> published
  -> superseded | deprecated | archived
```

### Persistence transition

Bundled trusted knowledge is durable by distribution. Local additions require
explicit validation and acceptance through Knowledge or Research governance.

### Provenance requirements

Includes source, author or package, evidence basis, version, review state and
effective date.

### Versioning requirements

Knowledge content is explicitly versioned. Findings and interpretations record
which Knowledge version they used.

### Correction and reversibility

Publish a new version or withdraw applicability. Do not silently rewrite the
version used by historical Findings.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain historical version.
- **Unlink:** Remove applicability Relationship without deleting knowledge.
- **Supersede:** Publish a new version referencing the prior version.
- **Reject:** Discard unaccepted draft or preserve only review metadata.
- **Delete:** Bundled or previously used versions are normally deprecated, not
  deleted.

## 13. Research Record

### Exact meaning

An explicitly saved local research contribution that improves Electron's
understanding. It may contain user notes, a scoped hypothesis, references or
curated local context.

It is distinct from a temporary Research working session and from packaged
Knowledge.

### Temporary or durable

Durable after explicit save.

### Creating domain service

Research Service.

### Authoritative owner

Research Service.

### Allowed references and cardinality

- Zero or more Collection Records.
- Zero or more Observations or Findings.
- Zero or more Knowledge Entities.
- Zero or more Artefacts.
- Zero or more Relationships and History Events.

A Research Record may be family-level or global and need not belong to one
Collection Record.

### Lifecycle

```text
working draft
  -> proposed
  -> saved
  -> revised
  -> promoted to knowledge | archived
```

### Persistence transition

Requires an explicit save action. Merely opening Research or entering notes
does not persist them.

### Provenance requirements

Includes author, source context, creation and revision times, scope, linked
evidence and whether the content is user assertion or evidence-backed.

### Versioning requirements

Saved revisions are versioned or event-tracked. Promotion to Knowledge records
the Research version used.

### Correction and reversibility

Edit through a new revision. Applicability links may be corrected without
rewriting earlier use.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain record and history but exclude from active matching.
- **Unlink:** Remove a target Relationship; do not delete shared research.
- **Supersede:** Create a replacement revision.
- **Reject:** Discard an unsaved proposal.
- **Delete:** Prefer archive when the record contributed to a historical
  conclusion; explicit purge remains possible under retention policy.

## 14. Relationship

### Exact meaning

A typed, directional link between two durable domain entities. It represents
identity matches, evidence support, applicability, derivation, supersession,
membership, comparison participation or other explicit associations.

### Temporary or durable

Candidate Relationships are temporary or proposed. Accepted Relationships are
durable.

### Creating domain service

Relationship Service, with Identity Resolution Service responsible for
identity-related proposals.

### Authoritative owner

Relationship Service.

### Allowed references and cardinality

- Exactly one source endpoint.
- Exactly one target endpoint.
- One relationship type.
- Optional confidence and effective interval.
- Zero or more supporting evidence references.
- Zero or more History Events.

Complex multi-entity associations use several Relationships or a dedicated
entity such as a comparison Artefact.

### Lifecycle

```text
candidate
  -> proposed
  -> confirmed | rejected
confirmed
  -> superseded | ended | archived
```

### Persistence transition

High-confidence automated matching may create a proposal, never a silently
confirmed durable identity link. Confirmation is explicit or governed by a
separately documented acceptance policy.

### Provenance requirements

Includes proposing service, evidence, confidence, decision actor, timestamps
and correction reason.

### Versioning requirements

Relationships are immutable decisions. A correction ends or supersedes the
prior Relationship and creates a new one.

### Correction and reversibility

All identity, merge, split and applicability Relationships are reversible.

### Archive, unlink, supersede, reject and delete

- **Archive:** Retain inactive relationship for history.
- **Unlink:** End or supersede the Relationship.
- **Supersede:** Create a new Relationship with a reference to the old one.
- **Reject:** Preserve optional minimal decision provenance.
- **Delete:** Avoid hard deletion after the Relationship influenced durable
  state; use ended or superseded status.

## 15. History Event

### Exact meaning

An immutable record that a durable domain mutation, acceptance decision,
correction or lifecycle transition occurred.

History is not a copy of every entity. It records the event and references the
affected subjects.

### Temporary or durable

Durable and immutable.

### Creating domain service

History Service, invoked by every domain service that performs a durable
mutation.

### Authoritative owner

History Service.

### Allowed references and cardinality

- Exactly one event type.
- Exactly one primary subject.
- Zero or more secondary subjects.
- Exactly one timestamp.
- One actor or system authority.
- Optional before/after summaries or revision references.

### Lifecycle

Append-only:

```text
created
  -> retained
```

Corrections are new History Events.

### Persistence transition

Created atomically with the durable mutation it describes.

### Provenance requirements

The event itself is provenance and therefore records actor, reason, source
service and affected revisions.

### Versioning requirements

Event schema is versioned. Existing events remain readable through migrations
or compatibility projections.

### Correction and reversibility

History Events are not edited. A correcting event references the earlier event.

### Archive, unlink, supersede, reject and delete

- **Archive:** Events may move to archival storage but remain queryable.
- **Unlink:** Subject references are retained even when subjects are tombstoned.
- **Supersede:** A correcting event may supersede an interpretation, not erase
  the original event.
- **Reject:** Not applicable after atomic creation.
- **Delete:** Only exceptional governed purge; normal record deletion retains
  history or a non-sensitive tombstone.

## 16. Workspace Context

### Exact meaning

A temporary, purpose-specific description of what a workspace is currently
working with. It carries references and projections, not independent domain
truth.

Allowed context kinds are:

- unfiled;
- single-record;
- multi-record;
- family-level;
- global.

### Temporary or durable

Temporary.

### Creating domain service

Workspace Context Service.

### Authoritative owner

Workspace Context Service for lifecycle; underlying domain services own the
referenced entities.

### Allowed references and cardinality

- **Unfiled:** zero records; optional Scan Session or proposed Observation.
- **Single-record:** exactly one Collection Record; optional related entities.
- **Multi-record:** two or more records, observations, sessions or artefacts.
- **Family-level:** exactly one primary Knowledge Entity or family scope.
- **Global:** no required card or family subject.

The context may include temporary session handles and read-only projections.

### Lifecycle

```text
created
  -> active
  -> updated
  -> transferred | closed | expired
  -> destroyed
```

### Persistence transition

Workspace Context never persists as domain truth. A user action may create a
proposal that a responsible domain service accepts separately.

### Provenance requirements

Tracks originating workspace, source context and referenced entity revisions
for reliable handoff. This operational context is not automatically a durable
History Event.

### Versioning requirements

Context contract and projection schema are versioned so workspaces can hand off
without copying internal models.

### Correction and reversibility

Switching subjects creates or updates context without mutating domain entities.
Stale context is rejected.

### Archive, unlink, supersede, reject and delete

- **Archive:** Not applicable.
- **Unlink:** Remove a context reference without changing the entity.
- **Supersede:** A new generation replaces prior context.
- **Reject:** Reject invalid or stale handoff.
- **Delete:** Destroy temporary context on close, expiry or app shutdown.

## 17. Difficult-scenario validation

The model is considered coherent only if these scenarios require no
workspace-specific persistence exception.

### 17.1 Unknown card remains unfiled

A Scan Session produces a proposed Observation with no confirmed Collection
Record Relationship. The user may reject it, accept it as durably unfiled or
create a new Collection Record later.

### 17.2 Several candidate record matches

Identity Resolution creates candidate Relationships with evidence and
confidence. No Collection Record is updated until one candidate is accepted.

### 17.3 Two physical cards report the same identifier

The identifier remains an observed value, not a record primary key. Separate
Collection Records can exist and retain distinguishing evidence.

### 17.4 One card reports different identifiers over time

Each Observation preserves the reported value. The Collection Record may adopt
a new preferred identity assertion without erasing earlier Observations.

### 17.5 Scan linked to the wrong record

End or supersede the incorrect Relationship, return the Observation to unfiled
state or link it to another record, and append History Events.

### 17.6 Duplicate Collection Records are merged

Create explicit merge Relationships and a surviving record decision. Preserve
both source IDs, evidence and histories so the merge can be reversed.

### 17.7 A merge must be reversed

End merge Relationships and restore evidence assignments from retained merge
provenance. Do not reconstruct from flattened current fields.

### 17.8 Engineering Session is cancelled

Destroy the temporary session and Workspace Context. No Finding, Observation
or Collection Record mutation occurs.

### 17.9 One Engineering result is accepted

Create one validated Finding with evidence and record Relationships. Discard
the rest of the temporary session.

### 17.10 Research applies to a family

Save a family-level Research Record linked to a Knowledge Entity. Do not copy
it into every Collection Record.

### 17.11 Comparison uses records and an unfiled scan

Use a multi-record Workspace Context referencing the records and temporary or
accepted Observation. The comparison remains temporary unless explicitly
saved as an Artefact or Finding.

### 17.12 New parser reinterprets old evidence

Create a new versioned interpretation or Finding referencing the immutable
Observation. Preserve the previous interpretation and parser version.

### 17.13 Record is archived

The Collection Record leaves active use. Its Observations, Findings, Artefacts,
Relationships and History remain intact and queryable according to retention
policy.

### 17.14 Imported Artefact has no known card

Accept it as an unfiled Artefact with import provenance. Link it later without
rewriting the content.

### 17.15 Application closes during an active session

Destroy Scan, Engineering and Workspace Context state. Only previously
accepted durable entities remain.

## 18. Cross-entity invariants

1. Card-reported identifiers never serve as the sole permanent record identity.
2. Temporary sessions do not write directly to durable stores.
3. Every durable mutation is performed by one authoritative domain service.
4. Every durable mutation creates a History Event.
5. Durable evidence remains distinguishable from interpretation.
6. Shared Knowledge and Research are linked, not copied into records.
7. Candidate identity matches do not silently become confirmed Relationships.
8. Unfiled evidence is a valid first-class state.
9. Merge, split, correction and supersession preserve prior provenance.
10. Workspace Context contains references and projections, not competing truth.
11. Deleting one record does not silently delete shared evidence or knowledge.
12. New protocol support extends Observation and Finding schemas through
    versioned types rather than creating a new database.

## 19. Current implementation conflicts

Phase 1, Phase 2.1, Phase 2.2 and Phase 2.3 have validated several boundaries without
claiming that the canonical model is complete. The active Collection database
is now mutated only by the main-process Collection Service, renderer
projections are detached, v5/v6 contracts exist and rendering no longer
persists. The controlled stable-ID migration engine now exists and has been
tested only against isolated fixtures; the live Collection has not been
migrated. The following current behaviors still do not satisfy the canonical
model:

1. `createSignatureId()` derives identity primarily from module and UID, and
   `upsertSignature()` automatically creates or updates that signature. This is
   not a stable Collection Record identity and cannot represent ambiguous or
   duplicate identifiers safely.
2. Card Lab now creates a temporary Scan Session and Proposed Observation, then
   routes acceptance through Observation Service and History Service. For
   compatibility it immediately invokes that acceptance with
   `legacy-compatible-auto-accept`, which still upserts the legacy signature
   and scan history without a separate user decision or identity-resolution
   outcome.
3. Current scan-history records are compact snapshots rather than immutable,
   versioned Observations with full provenance and separately versioned
   interpretations.
4. `saveAuthorizedReadResult()` replaces the prior authorized-read result for a
   signature, which loses an explicit durable revision chain.
5. `saveFamilyAnalysisResult()` persists an analysis result directly without a
   general Finding proposal/acceptance service.
6. Research, known-by-you data, signatures, scan history, authorized reads and
   family analyses are stored in renderer `localStorage`, while Collection
   assets are owned by the main-process Collection Service and stored in the
   main application database file. These durable domains are not yet linked by
   stable Collection Record IDs or Relationships.
7. Several delete operations remove current records directly rather than
   archiving, tombstoning or creating reversible supersession history.
8. Current History is split between UID history, change log and intelligence
   scan history rather than one platform provenance model.
9. The v6 Collection schema, `recordId` contract and controlled assignment
   engine exist, but live records remain v5 until an explicit migration is
   separately authorized and run.

These conflicts are documented for future migration. No existing data or
functionality should be removed before a compatible migration and preservation
plan exists. Phase status and migration sequencing are maintained in
[COLLECTION_MIGRATION_STRATEGY.md](COLLECTION_MIGRATION_STRATEGY.md).

## 20. Completeness criterion

This model is complete enough when:

- every current workflow can identify the entities it consumes and proposes;
- every durable write has one authoritative service;
- all difficult scenarios above preserve evidence and reversibility;
- a new protocol normally adds versioned Observation, Finding or Knowledge
  types rather than another storage centre;
- no workspace needs a private database or silent persistence rule.
