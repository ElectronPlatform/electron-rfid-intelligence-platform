# Connection Compatibility Engine — Technical Architecture

Status: Design only
Date: 2026-07-27
Roadmap: Not supplied — not inferred

## 1. Objective

The Connection Compatibility Engine gives a new or returning user one calm,
evidence-based answer to four questions:

1. Can Electron find a usable PM3 client?
2. Can the client see and communicate with a Proxmark3?
3. Which capabilities have actually been demonstrated?
4. What can the user safely do next?

The Electron Engine is a shared connection-intelligence service, not a second PM3
transport and not a firmware updater. Splash, Device Console and Device Studio
must consume the same versioned result.

This design improves:

- **The New Proxmark3 Owner**, who needs a guided first connection;
- **The Forgotten Proxmark3**, who needs the software to explain an unfamiliar
  or older setup;
- **The Experienced Proxmark3 User**, who needs exact evidence, capability
  detail and a path to raw diagnostics.

## 2. Product and architecture boundaries

The Electron Engine must:

- keep PM3 execution and parsing outside the renderer;
- return structured, versioned JSON;
- distinguish direct evidence, inference and unknown state;
- use capability probes instead of firmware-name assumptions;
- explain what still works after a partial failure;
- keep unsupported capabilities visible as unavailable;
- remain read-only and local;
- share the existing single-owner PM3 transport;
- never recommend or start firmware flashing automatically.

The Electron Engine must not:

- parse PM3 console text in UI code;
- claim that USB presence proves firmware communication;
- claim that Iceman branding proves Device Studio firmware;
- run HF/LF searches, antenna tuning, graphs or other RF activity during a
  lightweight background check;
- open a second client while Device Console or Device Studio owns the port;
- convert an unattempted probe into `unsupported`;
- persist a connected-device identity as a Collection Record;
- edit the central Roadmap/TODO.

## 3. Existing foundation to reuse

The current project already contains most low-level building blocks:

- `pm3CommunicationLayer.js`
  - executable resolution and validation;
  - `pm3 --list` port discovery;
  - `lsof` ownership checks;
  - short-lived commands and a warmed persistent session;
  - structured Device Studio status fallback.
- `deviceStudioService.js`
  - PM3 version/tune/status parsing;
  - capability negotiation;
  - structured Device Studio snapshot models;
  - evidence source labels.
- `main.js`
  - the single PM3 process lifecycle;
  - startup discovery;
  - Device Studio snapshot orchestration;
  - IPC ownership.
- `preload.js`
  - the constrained renderer bridge.

The future Electron Engine should compose these components. It should not duplicate
binary search, serial-port ownership, firmware parsing or capability adapters.

### Current gaps the Electron Engine resolves

- Connection wording is currently assembled independently in Splash, Device
  Console and Device Studio.
- USB discovery, client launch, firmware communication and capability support
  are not yet represented as separate user-visible stages.
- Some current models use booleans where `unknown`, `not probed`, `blocked` and
  `unsupported` are materially different.
- A full Device Studio check includes `hw tune`; the Electron Engine needs a lightweight
  path that never activates RF measurements automatically.
- Multiple detected devices are listed, but there is no explicit selection
  state contract.

## 4. Proposed component boundary

Future implementation should introduce one main-process orchestration service:

`connectionCompatibilityEngine`

It owns no child process directly. It calls the existing PM3 communication
layer through a serial-owner coordinator and builds one immutable snapshot.

```text
Splash / Device Console / Device Studio
                  |
          constrained preload API
                  |
    connectionCompatibilityEngine
       |          |             |
 client check  PM3 transport  capability probes
       |          |             |
 executable    USB / port     structured parsers
 resolution    ownership      in deviceStudioService
```

The renderer may choose presentation and disclosure level. It may not revise a
probe result or infer a missing capability.

## 5. Detection pipeline

Every stage records:

- `status`;
- start and finish time;
- evidence source;
- safe user-facing explanation;
- machine-readable failure code;
- whether the result came from a direct probe, a bounded inference or no
  evidence.

### Stage 0 — Request context

Inputs:

- trigger: `startup`, `manual`, `reconnect`, `background`, or
  `post-disconnect`;
- selected device/port, if the user already selected one;
- current serial owner;
- allowed probe depth: `presence`, `handshake`, `capabilities`, or
  `full-diagnostics`.

Rules:

- Startup and background requests stop at lightweight capabilities.
- `full-diagnostics` remains an explicit user action because it may run
  `hw tune`.
- A later request may enrich a prior snapshot but cannot silently downgrade
  direct evidence to inference.

### Stage 1 — Helper/client discovery

Use the existing executable resolver:

1. inspect explicit `PM3_PATH`, when supplied;
2. inspect approved project, packaged and system candidates;
3. fall back to `pm3` on `PATH`;
4. validate existence, file type and executable permission before launch when
   an absolute path is available.

Outputs distinguish:

- ready executable;
- path fallback not yet launch-verified;
- missing executable;
- non-executable file;
- invalid configured path.

The resolved path is developer evidence. Normal UI should show a human label,
not expose a long local filesystem path by default.

### Stage 2 — Client launch and client identity

Run the lowest-impact verified client operation, currently `pm3 --list`.

It proves separately:

- the process can launch;
- the process exits or responds within its timeout;
- the current client can enumerate serial devices.

Client version remains `unknown` until a verified client-only version probe or
a successful connected `hw version` result reports it. The Electron Engine must not
invent a version from a folder name or local source checkout.

Classify launch failures such as:

- executable not found;
- permission denied;
- dynamic-library/load failure;
- immediate process crash;
- launch timeout;
- unclassified launch failure.

### Stage 3 — USB and PM3 device discovery

Use two evidence sources without conflating them:

- `pm3 --list`: devices visible to the selected PM3 client;
- operating-system USB descriptors: USB identity and descriptive metadata.

Results:

- no PM3 candidate;
- one PM3 candidate;
- multiple PM3 candidates;
- USB candidate present but not visible to the PM3 client;
- PM3 port listed without a matching descriptor;
- discovery unavailable.

One PM3 port is never silently selected when several are present. The result
contains candidates and waits for an explicit selection.

### Stage 4 — Port ownership and busy-state check

Use the existing `lsof` logic for the chosen serial port and its `tty`/`cu`
counterpart.

Recognise:

- free port;
- owned by Electron Device Console;
- owned by Electron Device Studio;
- owned by another process;
- ownership unknown because the check is unavailable.

Electron-owned sessions should be reused or intentionally handed over. The
Electron Engine must not start another client against the same physical port.

External process names may be shown as troubleshooting evidence, but raw
process output is kept in Developer details.

### Stage 5 — PM3 handshake

After the port is selected and available, run a bounded read-only handshake.
The existing `hw version` route is the baseline because it demonstrates actual
client-to-firmware communication.

Separate outcomes:

- command succeeded and version evidence was parsed;
- command returned output but no supported identity could be parsed;
- serial connection opened but firmware did not answer;
- timeout;
- transport disconnected;
- client/firmware protocol mismatch;
- unknown failure.

USB detection without a successful handshake remains **PM3 detected**, not
**connected**.

### Stage 6 — Client and firmware version detection

Parse version evidence only in the main process through
`deviceStudioService`.

Record client, bootrom, firmware, FPGA and board identity independently. Each
field has its own source and may remain unknown.

Version strings provide explanation and support diagnostics. They do not enable
features by themselves.

### Stage 7 — Capability probing

Capability probes are incremental, read-only and individually bounded.

The lightweight sequence is:

1. try `hw ds-status --json`;
2. fall back to `hw ds-snapshot --json`;
3. fall back to `hw status --json`;
4. derive only conservative legacy capabilities from successfully parsed
   `hw version`;
5. leave everything else `unknown` until its safe probe is run.

An unknown command or an explicit unsupported response may prove
`unsupported`. A timeout, busy port or communication failure proves only that
the probe did not complete.

### Stage 8 — Device Studio firmware classification

Classify firmware as **Device Studio firmware** only when direct firmware
evidence reports a recognised Device Studio contract, such as:

- `device-studio-status`;
- `device-studio-snapshot`;
- another future versioned Device Studio contract accepted by the parser.

Classify **standard-compatible firmware** only when:

- the PM3 handshake succeeds; and
- Device Studio probes explicitly report unknown/unsupported commands or a
  recognised non-Device-Studio contract.

If probes time out or are blocked, the classification remains `unknown`.
`Iceman`, a version number or a local source directory is insufficient evidence
for Device Studio classification.

### Stage 9 — Error classification and recommendation

The state reducer chooses one primary user-facing state using the precedence:

1. invalid or failed client;
2. device selection required;
3. externally busy device;
4. no device;
5. connection/firmware communication failure;
6. connected capability state;
7. unknown.

Secondary facts remain visible. For example, a busy port does not erase the
fact that the client and USB device were found.

## 6. State model

The Electron Engine uses orthogonal facts internally. `primaryState` is a presentation
summary, not the storage location for all evidence.

| State | Detection condition | User-facing title | Short explanation | Recommended action | May scanning continue? |
|---|---|---|---|---|---|
| `NO_CLIENT` | No executable candidate can be launched | PM3 client not available | Electron cannot start the local PM3 helper yet. | Open setup details and select or install a compatible client. | No |
| `CLIENT_LAUNCH_FAILED` | Executable resolved, but process launch failed or timed out | PM3 client could not start | The helper was found, but macOS or the client stopped it from starting. | Review the exact launch category and developer evidence. | No |
| `NO_PM3_DETECTED` | Client launch works; no PM3 port is listed and no usable candidate is selected | No Proxmark3 detected | Electron is ready, but it cannot currently see a connected Proxmark3. | Connect directly by USB, check the cable and retry. | No; pasted/stored analysis remains available |
| `MULTIPLE_PM3_DEVICES` | More than one usable PM3 port is listed and none is selected | Choose a Proxmark3 | More than one device is available, so Electron will not guess. | Select the intended device. | No until selected |
| `PM3_DETECTED` | Exactly one PM3 candidate is listed; handshake not yet completed | Proxmark3 detected | The client can see the device. Firmware communication is still being checked. | Wait for the bounded handshake or start it manually. | Not yet |
| `PM3_CONNECTED` | The lightweight handshake succeeds; firmware classification is still unknown | Proxmark3 connected | Electron proved firmware communication without inferring a firmware family. | Review the bounded connection capabilities. | Conditional per proven capability |
| `BUSY_DEVICE` | Selected port is held by an external process | Proxmark3 is busy | The device is present, but another application owns its serial port. | Close or disconnect the named application, then retry. | No |
| `ELECTRON_BUSY` | An Electron-owned session has an active operation that must not be interrupted | Electron is using the Proxmark3 | Another Electron operation currently owns the shared session. | Wait for the current Electron operation. | No |
| `CONNECTION_FAILED` | Port was selectable but could not be opened, disappeared or was denied | Could not open the Proxmark3 connection | Electron found a candidate but could not establish the serial connection. | Reconnect the cable, check permission/ownership evidence and retry. | No |
| `FIRMWARE_COMMUNICATION_FAILED` | Port opens or is listed, but the bounded handshake receives no usable firmware response | Proxmark3 found, firmware not responding | USB is working far enough to find the device, but firmware communication did not complete. | Retry once, then inspect version/transport evidence. | No |
| `STOCK_FIRMWARE` | Handshake succeeds and Device Studio contracts are explicitly unsupported | Standard-compatible firmware detected | Core PM3 workflows can remain available; Device Studio-only features are unavailable. | Continue with supported scans or review optional capability information. | Yes, when HF/LF capability is supported |
| `DEVICE_STUDIO_FIRMWARE` | A recognised versioned Device Studio firmware contract is received | Device Studio firmware detected | Electron received structured Device Studio capability evidence. | Continue; open capability details if desired. | Yes, when HF/LF capability is supported |
| `LIMITED_CAPABILITY` | Connection succeeds but one or more core requested capabilities are unsupported or still unknown | Connected with limited capabilities | The device works, but not every Electron function has been demonstrated. | Use the available functions; inspect unavailable capability explanations. | Conditional per capability |
| `FULL_CAPABILITY` | All capabilities required by the current edition/workflow are directly supported | Connected — full capability available | Every capability required for the current workflow has been demonstrated. | Continue to the selected scan or diagnostic. | Yes |
| `UNSUPPORTED_FIRMWARE` | Handshake works, but required baseline commands/protocol cannot safely be used | Firmware is not compatible with this workflow | Electron can communicate, but cannot confirm the minimum capability required here. | Continue only with explicitly supported functions; review compatibility details. | Conditional; never assumed |
| `UNKNOWN_STATE` | Evidence is contradictory, incomplete or no classifier applies | Connection state not confirmed | Electron does not have enough reliable evidence to describe this setup. | Retry the smallest failed stage or open Developer details. | No unless a specific capability is already supported |
| `DISCONNECTED` | A previously connected device disappears or its active transport closes | Proxmark3 disconnected | The previous connection ended and Electron stopped hardware actions. | Reconnect the device and run a lightweight check. | No |

### State composition rules

- Firmware classification and capability summary can coexist. A standard
  firmware device may still have enough capabilities for full Card Lab use.
- `FULL_CAPABILITY` is relative to the requested workflow/edition, not a promise
  that every future feature exists.
- `UNSUPPORTED_FIRMWARE` never means every PM3 function is unusable.
- An unavailable optional feature is not a connection error.
- A cached supported capability becomes stale after disconnect, client change,
  firmware change or port change.

## 7. Capability model

Every capability uses a five-state result:

- `supported`: a direct successful probe or accepted structured contract proves
  it;
- `unsupported`: a completed probe explicitly rejects or lacks the capability;
- `unknown`: no adequate probe has completed;
- `blocked`: the probe could not run because of ownership, selection or policy;
- `error`: the probe ran but failed unexpectedly.

Each entry contains:

- capability ID;
- status;
- direct/inferred/unknown source;
- probe and parser version;
- evidence summary/reference;
- timestamp;
- limitation/reason;
- safe action availability.

### Required capability definitions

| Capability ID | Support evidence | Unsupported evidence | Unknown/blocked behavior | Consumer |
|---|---|---|---|---|
| `structuredHardwareStatus` | Accepted JSON from `hw status --json` or a newer Device Studio contract | Explicit unknown/unsupported command response | Timeout remains unknown; busy remains blocked | Device Studio status |
| `ledStatus` | Structured firmware response containing LED state and a recognised source | Explicit unsupported `hw leds --json` or contract capability false | Do not animate a physical state | Header LEDs, Device Studio |
| `safeMode` | `deviceStudioSafeMode.available === true` from firmware | Recognised contract explicitly reports unavailable | Never infer from Electron command filtering | Device Studio guard |
| `snapshot` | Accepted versioned Device Studio snapshot/status contract | Explicit contract/command rejection | Legacy status does not prove snapshot support | Quick Refresh |
| `boardMapping` | Valid complete firmware-reported mapping plus mapping source | Contract explicitly reports no mapping | Keep LEDs/parts unknown; never guess from board art | Device Studio board |
| `textualHwTune` | A user-requested bounded `hw tune` returns parseable textual measurements | Completed command explicitly reports unsupported | Startup does not probe it; remains unknown until Full RF Check | Antenna measurement |
| `nativeGraphs` | Verified client/runtime graph launch contract succeeds on this installation | Verified launch reports unavailable | Never open a graph as a background probe | Advanced diagnostics |
| `hfScan` | Validated non-RF command-capability probe, or a successful user-requested HF scan | Explicit command/firmware unsupported response | Merely knowing the device has an HF antenna is insufficient | Card Lab |
| `lfScan` | Validated non-RF command-capability probe, or a successful user-requested LF scan | Explicit command/firmware unsupported response | A failed/no-tag LF search proves execution only if the command itself completed | Card Lab |

Additional useful capabilities:

- `clientLaunch`;
- `serialEnumeration`;
- `firmwareHandshake`;
- `persistentSession`;
- `scopeSnapshot`;
- `buttonStatus`;
- `buttonProfile`;
- `selfTest`;
- `deviceStudioStatus`;
- `deviceStudioSafeMode`.

### Enabling and disabling actions

- Enable an action only when all required capabilities are `supported`.
- Show an unavailable action when a requirement is `unsupported`, with the
  exact reason.
- Show **Check availability** when requirements are `unknown` and a safe probe
  exists.
- Show **Temporarily blocked** when the device is busy or selection is pending.
- Never translate `error` into `unsupported`.
- Never enable a Device Studio control from firmware version text alone.

## 8. Versioned snapshot contract

Implementation Task 1 establishes the pure renderer-facing contract in
`connectionCompatibilityContract.js`, with scenario fixtures in
`tests/fixtures/connection-compatibility/scenarios.json`. It contains no transport,
IPC or UI behavior. The contract rejects raw `stdout`, `stderr` and `raw`
fields, defaults unreported capabilities to `unknown` and validates semantic
requirements for multiple-device, firmware-classification and
full-capability states.

Implementation Task 2 adds pure evidence mapping in
`connectionCompatibilityEvidenceAdapter.js`. It converts the existing
executable-resolution, `pm3 --list`, USB-descriptor and port-preflight result
shapes into bounded stage evidence. It deliberately drops full paths, PM3 raw
output and raw `lsof` lines. It does not launch a process, inspect USB or alter
the existing PM3 transport.

Implementation Task 3 adds the pure deterministic reducer in
`connectionCompatibilityStateReducer.js`. It applies the documented
state precedence, derives scan-continuation behavior and recommended actions,
and aggregates only bounded structured failures. Contradictory stage evidence
produces `UNKNOWN_STATE`; missing stages remain unknown; future safe capability
IDs pass through the contract; and an Electron-owned session is not reported
as externally busy. A capability blocked by an active
Electron operation does not erase separately proven capabilities. The reducer
performs no runtime I/O, does not mutate its input and validates every returned
snapshot against the Task 1 contract.

Implementation Task 4 adds the explicitly callable, dependency-injected
main-process orchestration boundary in
`connectionCompatibilityEngine.js`. It supports only `presence` and
`handshake` depths. `presence` stops after executable discovery, passive USB
evidence, `pm3 --list` evidence and port ownership. `handshake` may additionally
reuse an idle Electron-owned session or call the existing shared lightweight
version-metadata route.

The service has a positive operation allowlist; every allowed stage has its own
timeout. Cancellation calls the injected stage canceller, owned-resource
cleanup runs in `finally`, identical concurrent requests are merged and different requests are
serialized. An active Electron operation blocks the additional handshake
without being interrupted. Its process-memory snapshot cache expires after a
short bounded interval and is cleared on disconnect. No PM3 command string,
serial implementation, child process, RF diagnostic, persistence, startup
hook, IPC or UI is present in this service.

Task 4.1 hardens the shared-session lifecycle before IPC exposure:

- session and port-lease ownership are explicitly `none`, `borrowed` or
  `engine-created`;
- borrowed resources are never passed to cleanup, while Engine-created
  resources are cleaned exactly once;
- identical requests have consumer-aware cancellation, so one caller cannot
  cancel a shared job needed by another caller;
- the underlying stage is cancelled only after all consumers leave;
- only stable snapshots enter the short process-memory cache; busy, blocked,
  selection-required, timeout, cancellation and transient errors are not
  cached;
- cache reads can require an exact probe depth, and disconnect or selection
  change invalidates cached evidence;
- cleanup failures remain bounded lifecycle reports and cannot overwrite a
  successful handshake snapshot;
- a proven handshake with unclassified firmware is `PM3_CONNECTED`, while an
  active Electron-owned operation is `ELECTRON_BUSY`, with a different action
  from an externally busy port.

Task 4A removes the pre-existing automatic RF diagnostic from app startup.
`createWindow()` now reaches only `warmDeviceStudioPresence()`, which performs
passive preflight/presence classification and never opens a session or runs a
firmware/RF command. Multiple devices require selection and busy/no-device
states stop safely. The renamed `fullRfSnapshotCommands()` route containing
`hw version; hw tune` remains reachable only from the explicit **Full RF
Check** action. This correction does not yet connect the Electron Engine to startup.

Contract shape:

```json
{
  "schemaVersion": "1.0",
  "capturedAt": "ISO-8601",
  "trigger": "manual",
  "probeDepth": "capabilities",
  "primaryState": "LIMITED_CAPABILITY",
  "client": {
    "status": "ready",
    "pathSource": "candidate",
    "version": null,
    "source": "electron-observed"
  },
  "usb": {
    "status": "single-device",
    "devices": [],
    "source": "pm3-list-plus-os-descriptor"
  },
  "connection": {
    "status": "connected",
    "port": "/dev/tty.example",
    "owner": "electron",
    "source": "electron-observed"
  },
  "versions": {
    "client": null,
    "firmware": null,
    "bootrom": null,
    "fpga": null
  },
  "firmware": {
    "classification": "standard-compatible",
    "source": "firmware-probe"
  },
  "capabilities": {
    "hfScan": {
      "status": "supported",
      "source": "direct-probe",
      "evidence": "Accepted command capability response"
    },
    "ledStatus": {
      "status": "unsupported",
      "source": "direct-probe",
      "evidence": "Firmware rejected the structured LED-status command"
    }
  },
  "recommendedAction": {
    "id": "continue-core-workflows",
    "label": "Continue with supported scans"
  },
  "failures": []
}
```

Later schema versions may add fields through an explicit contract review. They
must keep the semantic separation between discovery, connection, firmware and
capabilities.

Raw command output remains in bounded diagnostic evidence owned by the main
process and Device Console. Normal renderer state receives structured summaries
and evidence references, not renderer-parseable PM3 text.

## 9. Failure philosophy

1. **Evidence before inference.** USB presence, process launch and firmware
   communication are separate facts.
2. **Explain what still works.** A missing LED contract must not hide working
   HF/LF scans.
3. **Unsupported is not broken.** Optional features remain visible with an
   explanation.
4. **Unknown is honest.** An unattempted, timed-out or blocked probe is unknown,
   not unsupported.
5. **No automatic firmware recommendation.** The Electron Engine never recommends
   flashing as the default repair and never starts a flash workflow.
6. **One safe next action.** Every primary state offers one recommended action,
   with technical detail behind disclosure.
7. **No false recovery.** A successful retry may replace a failure only with
   newer direct evidence.
8. **No stale hardware truth.** Disconnect invalidates live capability and
   telemetry state.
9. **No hidden RF work.** Background checks do not search cards, tune antennas
   or open graph windows.
10. **User control for ambiguity.** Multiple devices require selection; the
    Electron Engine never guesses.

## 10. Lifecycle, concurrency and caching

- One serial-owner coordinator arbitrates Device Console, Device Studio,
  Card Lab and Electron Engine probes.
- Lightweight checks reuse a healthy Electron-owned session.
- A probe queue is serial per physical port.
- Manual requests may cancel or supersede older background requests.
- Every probe has a bounded timeout and cancellation result.
- Presence snapshots may be cached briefly; handshake/capability evidence is
  invalidated by port, client, firmware or process-owner changes.
- Disconnect immediately disables hardware actions and clears live telemetry.
- A failed background refresh does not overwrite a still-valid connected state
  until transport loss is directly confirmed; it records a refresh failure.
- The Electron Engine does not persist indefinite hardware history. Diagnostic history
  follows the existing bounded local policy and records provenance.

## 11. Presentation contract

All consuming surfaces use the same snapshot:

- **Splash**: one short, non-blocking progress summary and a strict maximum
  wait; no RF diagnostics.
- **Device Console**: connection banner, connect/disconnect action and Developer
  evidence.
- **Device Studio**: firmware and per-capability detail.
- **Card Lab**: only the required HF/LF action availability and a link to the
  Electron Engine when blocked.

Progressive disclosure:

1. outcome;
2. what still works;
3. recommended action;
4. detected client/device/firmware facts;
5. per-capability evidence;
6. bounded raw diagnostic details.

The surfaces must not rewrite `unknown` as failure or present inferred data as
firmware-reported.

## 12. Testing strategy

### Pure contract tests

Fixtures must cover:

- missing/non-executable client;
- client launch failure;
- no PM3;
- one PM3;
- multiple PM3 devices;
- external busy owner;
- Electron-owned session reuse;
- disappearing port;
- firmware timeout;
- standard-compatible firmware;
- Device Studio contract;
- partial capabilities;
- unknown command versus command timeout;
- contradictory evidence;
- stale cache invalidation.

### Transport integration tests

- Verify no concurrent client opens the same port.
- Verify a busy process is not terminated.
- Verify cancellation releases temporary processes.
- Verify startup depth never runs `hw tune`, HF/LF search or graphs.
- Verify Full RF Check remains explicit.

### Renderer contract tests

- Every state renders its required title, explanation and action.
- Scan controls follow capability state, not firmware labels.
- Unknown, blocked and unsupported remain visually distinct.
- Developer details are optional and escaped.

### Hardware acceptance

Test, with Ronald’s explicit hardware participation:

- no device;
- current Device Studio firmware;
- standard compatible firmware;
- unplug/replug;
- externally busy port;
- multiple devices when available;
- successful HF and LF command capability confirmation.

No firmware flashing is part of Electron Engine acceptance.

## 13. Implementation sequence

Each future task should be independently testable and approximately one to two
hours.

1. **Contract and fixture task**
   Add the Electron Engine snapshot schema, enums, validation and pure fixtures. No UI.

2. **Existing evidence adapter task**
   Adapt executable resolution, `pm3 --list`, USB descriptors and `lsof` results
   into stage results without changing their transport behavior.

3. **Pure state reducer task**
   Implement state precedence, recommended actions and scan-continuation rules
   from fixture data.

4. **Lightweight orchestration task**
   Add the main-process Electron Engine service with presence and handshake depths.
   Confirm it never runs RF diagnostics.

5. **Capability probe task**
   Reuse Device Studio structured-status parsing and add five-state capability
   results. Keep `hw tune`, scans and graphs unprobed by default.

6. **Serial-owner coordination task**
   Make Electron Engine, Device Console and Device Studio reuse or queue the single PM3
   owner deterministically.

7. **Preload/IPC contract task**
   Expose one constrained snapshot request and one progress subscription.

8. **Connection banner task**
   Replace duplicated Device Console connection wording with the Electron Engine
   snapshot. Preserve the existing console.

9. **Device Studio consumption task**
   Map Device Studio capability cards to Electron Engine capability results without
   weakening firmware-reported source labels.

10. **Card Lab gating task**
    Gate HF/LF actions only from `hfScan`/`lfScan` capability results and show a
    Electron Engine link for blocked states.

11. **Startup integration task**
    Replace startup full diagnostics with the bounded lightweight Electron Engine path.
    Keep Full RF Check explicit in Device Studio.

12. **Failure and lifecycle task**
    Add unplug, retry, stale cache, busy owner, timeout and cancellation tests.

13. **Hardware acceptance and documentation task**
    Run the approved read-only matrix, capture evidence and update technical
    implementation documentation. Do not change the central Roadmap/TODO.

## 14. Acceptance criteria

Architecture is ready for implementation when:

- all required states have deterministic fixture coverage;
- a renderer never needs PM3 text to decide connection or capability state;
- standard and Device Studio firmware can both reach useful supported states;
- capability support comes from successful probes/contracts;
- optional unsupported features do not block core workflows;
- timeout, blocked and unknown remain distinct;
- startup performs no RF measurement or scan;
- serial ownership prevents concurrent client access;
- no path recommends or performs automatic firmware flashing;
- every failure explains what remains available and the next safe action.

## 15. Open implementation evidence, not product blockers

- Verify a client-only version command against the exact Preview client before
  adding it to Stage 2. Until then, client version remains unknown before a
  device handshake.
- Verify a non-RF command-capability query for HF/LF scanning. Until then,
  successful user-requested scans may enrich those capability states.
- Native graph capability requires packaged-runtime verification; the Electron Engine
  must leave it unknown when that verification has not run.
- Multiple-device hardware acceptance depends on two devices being available.

These items do not justify firmware-name assumptions or optimistic UI states.
