# Electron Architectural Vision

**Status:** Approved direction

**Scope:** Long-term platform architecture

**Implementation:** This document defines direction; it does not describe the
current implementation as complete.

## Constitutional basis

This architectural vision translates
[PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) into platform boundaries.
The Constitution is the higher product-design authority; this document defines
how its principles apply to Electron's domain and workspace architecture.

## Platform statement

Electron is a **local-first RFID Collection and evidence platform**.

The RFID Collection is the durable centre of the application. Every other
capability exists to create, identify, enrich, analyse, explain, compare,
maintain or report on the Collection and its records.

Electron may gain substantially more technical capability over time without
changing this centre of gravity.

## The Collection is the durable spine

A Collection Record is Electron's durable, curated representation of an RFID
asset. It provides the stable identity through which card-specific
observations, findings, artefacts, history and applicable knowledge are
connected.

The Collection is the spine, but a Collection Record is not a container into
which every kind of platform data is copied. Shared Knowledge, Research and
cross-record relationships have their own authoritative stores and link back to
Collection Records where applicable.

## The real-world object is not the record

A Physical RFID Object exists outside Electron. Its presence during a scan is
temporary, but the object itself is not.

A Collection Record is a digital representation of the intended real-world
asset. It is not proof that Electron has perfectly identified the physical
object.

Reported identifiers, protocol responses and user annotations are evidence.
They must not become the permanent identity of a Collection Record. Every
Collection Record therefore has a stable Electron-assigned identity independent
of UID or other mutable or repeatable card-reported values.

## Temporary work and durable evidence

Physical interaction happens through temporary sessions:

- Scan Sessions;
- Engineering Sessions;
- Research working sessions;
- Compare sessions;
- temporary Workspace Contexts.

Sessions may produce proposed Observations, Findings, Artefacts, Relationships
or Research Records. A proposal becomes durable only through an explicit,
validated acceptance transition.

Closing, cancelling or losing a temporary session must not silently create or
modify permanent records.

## Evidence before conclusions

Electron preserves the distinction between:

- what hardware directly observed;
- what a parser extracted;
- what Electron inferred;
- what shared Knowledge suggested;
- what a user supplied;
- what a user explicitly accepted as a durable conclusion.

An accepted conclusion does not erase its supporting evidence. A later
interpretation may supersede an earlier conclusion, but the earlier evidence
and its provenance remain explainable.

## Provenance is mandatory

Every durable card-specific fact must be attributable to a Collection Record
and retain sufficient provenance to answer:

- where it came from;
- when it was obtained;
- which device, workflow or import produced it;
- which parser, schema or knowledge version interpreted it;
- whether it was observed, parsed, inferred or user-supplied;
- who or what accepted it;
- whether it is current, superseded, rejected or archived.

## Persistence is explicit

The normal transition is:

```text
temporary result
  -> proposal
  -> validation
  -> explicit acceptance
  -> durable entity
  -> History Event
```

Visibility does not imply persistence. Successful execution does not imply
persistence. A high-confidence identity match does not imply persistence.

Electron must always be able to state whether information is temporary,
proposed or durable.

## Identity is evidence-based and reversible

Identity resolution may conclude that a scan:

- matches one existing Collection Record;
- has several candidate matches;
- represents a new asset;
- should remain unfiled;
- was linked incorrectly and must be corrected.

No identifier is universally unique. Matching, linking, merging and splitting
must therefore remain reviewable and reversible. Corrections create new
history; they do not silently rewrite the past.

## Shared Knowledge and Research

Knowledge explains technologies independently from any one card. It is a
shared, versioned reference graph used by identification, explanation and
analysis.

Research stores explicitly saved local understanding. A Research Record may
apply to a family, protocol, technology, one Collection Record or several
records.

Collection Records reference applicable Knowledge and Research. They do not
duplicate those stores.

## Workspaces are projections and tools

Workspaces do not become independent data owners.

A workspace:

- receives an explicit context;
- reads authoritative domain entities;
- presents a purpose-specific projection;
- may produce commands or proposals;
- delegates durable mutations to the responsible domain service.

Workspace context is explicitly one of:

- unfiled;
- single-record;
- multi-record;
- family-level;
- global.

No workspace silently assumes a Collection Record association.

## Responsibility boundaries

- **Collection** owns the lifecycle of permanent RFID Collection Records.
- **Scan / Intelligence** is the acquisition and identity-resolution gateway.
- **Card inspection** presents everything applicable to one record without
  becoming another data store.
- **Engineering** performs temporary advanced analysis and produces proposals.
- **Research** improves Electron's saved local understanding.
- **Knowledge** explains shared technologies and capabilities.
- **History** presents the platform's immutable provenance events.
- **Compare** compares records, observations, sessions or artefacts.
- **Device workspaces** operate and explain hardware; they do not own card
  records.
- **Reports** are derived from accepted domain entities and explicit session
  context.

## Information is organised, not removed

Electron must not remove valuable information or existing capability merely to
simplify a page.

The later UI architecture must derive progressive disclosure, navigation and
visual priority from documented domain and workspace responsibilities. Moving
information to its authoritative workspace is organisation, not reduction.

## Architectural invariants

1. The Collection remains Electron's durable centre.
2. A Collection Record represents an RFID asset but is not the physical object.
3. Stable record identity is independent of card-reported identifiers.
4. Every durable card-specific fact is attributable to a Collection Record.
5. Shared and cross-record information remains in dedicated authoritative
   stores.
6. Temporary sessions never persist results automatically.
7. Every durable conclusion retains provenance.
8. Identity matches and accepted conclusions are reviewable and reversible.
9. Every durable mutation produces a History Event.
10. Every workspace declares its context and primary responsibility.
11. Workspaces do not create competing data stores or competing truths.
12. New protocols extend the model instead of redefining it.
13. Electron remains local-first; sharing and export are explicit actions.

## Current implementation alignment gaps

The current application predates this formal model. Phase 1 introduced a
temporary Scan Session, Proposed Observation, Observation Service and History
Service compatibility slice. Phase 2.1 added identity/schema contracts, and
Phase 2.2 moved all active Collection mutations behind a main-process
Collection Service. These validate the direction without completing the
migration. Phase 2.3 has now implemented and isolated-tested the controlled
stable-ID migration engine, but Ronald's live Collection remains Version 5
until a separate explicit migration decision.

Remaining gaps include:

- successful live scans still use compatibility auto-accept after creating a
  temporary proposal, so there is not yet a user-controlled acceptance and
  identity-resolution transition;
- a derived signature, often based on family and UID, currently acts as an
  Intelligence association key;
- the v6 `recordId` contract and controlled migration engine exist, but no live
  Collection Record has received a permanent `recordId` and no live database
  migration has run;
- Card Viewer analysis workflows can persist results directly after execution;
- collection assets and intelligence records currently use separate persistence
  models;
- Collection mutations now use the main-process Collection Service, but
  Intelligence, Research and analysis stores do not yet share equivalent
  domain-service and relationship boundaries;
- deletion and replacement behavior is not consistently provenance-preserving
  or reversible.

These are migration findings, not instructions to remove existing
functionality. Detailed current-state conflicts are recorded in
[DOMAIN_MODEL.md](DOMAIN_MODEL.md) and
[WORKSPACE_RESPONSIBILITIES.md](WORKSPACE_RESPONSIBILITIES.md). Implementation
progress and the next controlled migration phase are recorded in
[COLLECTION_MIGRATION_STRATEGY.md](COLLECTION_MIGRATION_STRATEGY.md).

## Completion criterion

The domain model is complete enough when new capabilities normally ask which
existing entity they consume or produce, rather than creating a
workspace-specific database, competing truth or silent persistence rule.
