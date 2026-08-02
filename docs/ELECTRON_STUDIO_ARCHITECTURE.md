# Electron Studio Architecture

## Status

This document is the approved ownership map for the staged Electron reorganisation. It is deliberately non-destructive: existing workflows remain available until a replacement has been verified in its new owner Studio.

## Shared platform foundations

These are application-wide services, not Studio features:

- PM3 communication, serial-port ownership and cancellation;
- structured device, firmware and capability snapshots;
- scan-session data and parsed card results;
- inventory, backup references and audit history;
- source/build identity and truth-source labels;
- safety policy and action-risk classification.

No Studio may create its own competing PM3 session, parse the same firmware output in the renderer, or maintain a second copy of the same primary record.

## Studio ownership

| Studio | Owns | Does not own |
| --- | --- | --- |
| Device Studio | PCB, components, live board state, safe hardware diagnostics and hardware learning | Full firmware documentation, RF analysis as a primary workflow, standalone state machines |
| Firmware Studio | Installed build identity, capabilities, modules, source/build matching, firmware history and guarded future firmware management | PCB layout and ordinary card scanning |
| Signal Studio | HF/LF tune readings, empty-antenna references, RF loading comparisons, captures and analysis | Tag inventory or claims of tag identification from a raw waveform |
| Standalone Studio | Installed standalone mode, state machine, button gestures, mode-specific LEDs, source mapping, safety and simulation-only walkthroughs | Active cloning, writing, emulation or attack workflows in the learning UI |
| Card Lab | Read-only scan, detection, explanation and card report preparation | General board and firmware diagnostics |
| Collection | Inventory, individual tag records, backup references, comparison and labels | PM3 transport and RF measurement |

## Current screen map

| Current screen | Long-term owner | Transition rule |
| --- | --- | --- |
| Dashboard | Workshop overview | Keep as the entry point and link to the owner workspace. |
| Inventory, RFID Tag, Restore Helper, Compare, Labels | Collection | Keep all existing data flows; later present them as one collection area. |
| Device Console | Advanced workspace | Preserve raw commands and console output; it is not the normal beginner scan path. |
| Device Studio | Device Studio | Retain PCB, component learning and safe diagnostics. Move only deep firmware, signal and standalone material after replacement views are verified. |
| Scan / Intelligence | Card Lab | Make it the normal safe scan path; RFID Tag receives its saved result. |
| Research | Research Library | Keep user-authored knowledge and cross-link to Studios instead of duplicating their detailed explanations. |
| Electron Portal | Product/support | Keep support, licence, version and update information separate from operational history. |
| History | Collection history | Retain record and UID history only. |
| Change Log | Product history | Retain application release changes only. |

## Migration safeguards

1. Do not remove a working feature merely because its destination has changed.
2. Migrate one workflow at a time, with its data model and safety notices.
3. Keep a temporary redirect or launch link from the former location.
4. Remove an old surface only when it is a genuine duplicate and the replacement has been tested.
5. Preserve saved data, deep links, history, backups and advanced workflows.
6. Every displayed value continues to identify its source where meaningful: firmware reported, source derived, Electron observed, calculated, inferred or unknown.
7. Device Studio remains diagnostic-only. Higher-risk RFID and firmware operations remain separately guarded.

## First implementation stage

The first stage adds a Workshop / Studios directory to the Dashboard. It does not remove or rename any current tab. It tells the user which workspace owns each question and opens the existing, verified workflow while the deeper migrations are prepared.
