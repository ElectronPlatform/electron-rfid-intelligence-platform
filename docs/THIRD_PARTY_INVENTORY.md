# Third-Party Inventory

Initial audit: 26 July 2026
Last technical review: 30 July 2026

This inventory is derived from the current `package-lock.json`, installed package manifests, Electron 31.7.7 distribution files, the internal finalization application in `dist-rc-finalization`, the configured `extraResources`, the linked libraries reported by the bundled Proxmark3 client, and the current local Proxmark3 source checkout.

“Bundled with Electron?” means bundled in the current packaged Electron application or DMG, not merely installed on the development machine.

## Packaged runtime and bundled binaries

| Name | Version (if known) | License | Purpose | Bundled with Electron? (Yes/No) | Action required before Public Preview (if any) |
| --- | --- | --- | --- | --- | --- |
| Electron | 31.7.7 | MIT | Desktop application runtime. | Yes | Preserve the Electron MIT licence and its embedded third-party notices in the release materials. |
| Chromium | 126.0.6478.234 | BSD-3-Clause plus separately licensed embedded components | Browser and renderer engine included by Electron. | Yes | Preserve the complete Electron/Chromium embedded notice set in the release materials. |
| Node.js | 20.18.0 | MIT | Main-process JavaScript runtime included by Electron. | Yes | Preserve the Node.js licence through the Electron notice set. |
| V8 | 12.6.228.30-electron.0 | BSD-3-Clause | JavaScript engine included by Electron. | Yes | Preserve the V8 licence and its embedded component notices through the Electron notice set. |
| ReactiveObjC | 3.1.0 | MIT | macOS reactive programming framework included in the Electron runtime. | Yes | Preserve its licence through the Electron notice set. |
| Squirrel.Mac | 1.0 | MIT | macOS update framework included in the Electron runtime. | Yes | Preserve its licence through the Electron notice set. |
| Mantle | 1.0 | MIT | macOS model framework included in the Electron runtime. | Yes | Preserve its licence through the Electron notice set. |
| Electron/Chromium embedded third-party components | Electron 31.7.7 | Multiple; individually enumerated in `LICENSES.chromium.html` | Third-party components embedded in Electron and Chromium; `LICENSES.chromium.html` is their authoritative sub-inventory and licence text. | Yes | Include or reproduce the complete `LICENSES.chromium.html` notice set in the distributable release and make it reachable from the planned third-party notices surface. |
| Proxmark3 launcher script | Adjacent source checkout at `dc327884d298fce2fd0abff8c464e1f5db1958e0`, launcher locally modified | GPL-3.0-or-later | Starts the matching Proxmark3 client with the project configuration. | Yes | Record the exact distributed launcher state; include GPL text, corresponding source, local patches and reproducible build/use instructions. |
| Proxmark3 client binary | `Iceman/master/v4.21611-suspect`, release-source checksum `389522379`, macOS arm64 | GPL-3.0-or-later | Communicates with and controls supported Proxmark3 hardware. | Yes | Preserve the exact source package described in the provenance finding below and complete a clean-machine test of the portable candidate. |

**Proxmark3 client provenance finding**

- `389522379` is not a Git revision. It is the nine-character `armsrc`/`common_arm` source checksum embedded by `common/default_version_pm3.c`; a clean archive of tag `v4.21611` reproduces it exactly, and that tag resolves to commit `aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f`.
- The packaged binary has SHA-256 `3e611b9f0d27e360eb936ace834a4fbdbd28dbee678dfd384a9f82dc9ff0b5a5`. The client build copies static release metadata and does not authenticate the dirty working-tree state. **Exact corresponding source not verified.**
- Client-affecting source evidence consists of the four local commits after `v4.21611` (`3b0dac43`, `9de18890`, `7489c0c8`, `dc327884`) plus build-time uncommitted changes to `client/src/cmdhfmf.c`, `client/src/cmdhw.c`, `include/pm3_cmd.h` and `common_fpga/fpga.h`; the top-level `Makefile` change may affect build configuration. The other current dirty `armsrc` and `common_arm` files are firmware-side, while the modified `pm3` launcher is a separately bundled item.
- The required corresponding-source package is a complete snapshot of the actual build tree: upstream `v4.21611` at `aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f`, all four later local commits, the exact uncommitted build-time patch set, required dependency source and build scripts, and `LICENSE.txt`, tied to the packaged binary SHA-256 above. Because no immutable snapshot of that dirty build state is currently tied to the binary, the present checkout alone is not proof of the exact source package.

## External runtime dependencies of the bundled Proxmark3 client

### Current 30 July candidate

`otool -L` reports only macOS-provided libraries and frameworks for the
current Apple Silicon candidate:

| Name | Version (if known) | Licence | Bundled with Electron? | Release action |
| --- | --- | --- | --- | --- |
| Apple Foundation and AppKit | Provided by target macOS | Apple platform terms | No | Verify on a supported clean Mac. |
| Apple libSystem and Objective-C runtime | Provided by target macOS | Apple platform terms | No | Verify on a supported clean Mac. |
| LLVM libc++ | Provided by target macOS | Apache-2.0 WITH LLVM-exception | No | Verify on a supported clean Mac. |
| bzip2 / libbz2 | Provided by target macOS | bzip2-1.0.6 | No | Verify on a supported clean Mac. |
| zlib | Provided by target macOS | Zlib | No | Verify on a supported clean Mac. |

The current client has no absolute Homebrew dynamic-library dependency.
`npm run pm3:preview:verify` also confirms that the packaged helper resolves
and starts the intended sibling client. This supersedes the 26 July
portability finding below.

This check does not prove the exact corresponding-source archive,
reproducibility or clean-machine compatibility. Those remain release
requirements.

### Superseded 26 July candidate

The dependency inventory and design analysis below describe the earlier PM3
binary only. They are retained as audit history and must not be used as the
dependency statement for the current release candidate.

| Name | Version (if known) | License | Purpose | Bundled with Electron? (Yes/No) | Action required before Public Preview (if any) |
| --- | --- | --- | --- | --- | --- |
| Apple Foundation framework | Provided by target macOS | Apple Software License Agreement | Foundation APIs used by the Proxmark3 client. | No | Confirm availability on every supported clean macOS installation. |
| Apple AppKit framework | Provided by target macOS | Apple Software License Agreement | macOS graphical APIs linked by the Proxmark3 client. | No | Confirm availability on every supported clean macOS installation. |
| Apple libSystem | Provided by target macOS | Apple Software License Agreement | Core macOS system runtime used by the Proxmark3 client. | No | Confirm availability on every supported clean macOS installation. |
| Apple Objective-C runtime (`libobjc`) | Provided by target macOS | Apple Software License Agreement | Objective-C runtime used by linked macOS frameworks. | No | Confirm availability on every supported clean macOS installation. |
| LLVM libc++ | Provided by target macOS | Apache-2.0 WITH LLVM-exception | C++ standard library runtime used by the Proxmark3 client. | No | Confirm availability on every supported clean macOS installation. |
| bzip2 / libbz2 | 1.0.8 | bzip2-1.0.6 | Compression support used by the Proxmark3 client. | No | Confirm availability on every supported clean macOS installation. |
| zlib | 1.2.12 | Zlib | Compression support used by the Proxmark3 client. | No | Confirm availability on every supported clean macOS installation. |
| LZ4 | 1.10.0 | BSD-2-Clause | Fast compression support used by the Proxmark3 client. | No | The binary currently links to an absolute Homebrew path; make the dependency portable or document and verify the installation prerequisite, and review notices if it becomes bundled. |
| Python | 3.14.6 (linked as Python 3.14) | Python-2.0 | Python runtime linked by the Proxmark3 client. | No | The binary currently links to an absolute Homebrew path; make the dependency portable or document and verify the installation prerequisite, and review notices if it becomes bundled. |
| Qt | 5.15.19 | GFDL-1.3-only AND GPL-2.0-only AND GPL-3.0-only AND LGPL-2.1-only AND LGPL-3.0-only | Qt Core, Gui and Widgets frameworks linked by the Proxmark3 client. | No | The binary currently links to absolute Homebrew paths; make the dependency portable or document and verify the installation prerequisite, and review the applicable Qt distribution obligations if it becomes bundled. |
| GD Graphics Library | 2.3.3 | GD | Image generation support linked by the Proxmark3 client. | No | The binary currently links to an absolute Homebrew path; make the dependency portable or document and verify the installation prerequisite, and review notices if it becomes bundled. |
| GNU Readline | 8.3.3 (`libreadline.8`) | GPL-3.0-or-later | Interactive command-line editing support used by the Proxmark3 client. | No | The binary currently links to an absolute Homebrew path; make the dependency portable or document and verify the installation prerequisite, and review GPL obligations if it becomes bundled. |

### Superseded Homebrew runtime portability finding

All seven absolute Homebrew load commands in the current client are mandatory `LC_LOAD_DYLIB` commands rather than optional weak links. “Must be bundled?” below applies when retaining this exact binary in a self-contained Preview; a verified replacement build may instead remove an optional feature or statically embed its dependency.

| Dependency | Required for runtime? (Yes/No) | Already provided by macOS? (Yes/No) | Must be bundled? (Yes/No) | Can be linked in a portable way? (Yes/No) | Recommended solution |
| --- | --- | --- | --- | --- | --- |
| LZ4 | Yes | No | Yes | Yes | Produce a verified client build using Proxmark3's CMake embedded/static LZ4 path, or bundle the matching dylib and use an application-relative `@rpath`. |
| Python 3.14 framework | Yes | No | Yes | Yes | If Python-backed PM3 features are required, package a private framework with an application-relative runtime path; otherwise produce and test a client with `SKIPPYTHON=1`. |
| Qt 5 Core, Gui and Widgets | Yes | No | Yes | Yes | If Qt functionality is required, deploy the matching frameworks and transitive plugins with portable runtime paths; otherwise produce and test a client with `SKIPQT=1`. |
| GD Graphics Library | Yes | No | Yes | Yes | If GD-backed image functionality is required, statically link or bundle it with an application-relative runtime path; otherwise produce and test a client with `SKIPGD=1`. |
| GNU Readline | Yes | No | Yes | Yes | Prefer Proxmark3's CMake embedded/static Readline path to retain full CLI behaviour without Homebrew, or bundle the matching library with an application-relative `@rpath`. |

### Historical replacement-client feature analysis

These classifications concern a verified replacement client build. The current
binary cannot start if any mandatory dylib is simply removed.

| Dependency | Current Electron feature dependency | User-visible result if omitted from a replacement client | Public Preview 1 classification |
| --- | --- | --- | --- |
| LZ4 | Card Viewer Advanced Recovery offers MIFARE Classic `hardnested`, whose client implementation reads the supplied LZ4-compressed hardnested state tables. | Hardnested recovery cannot use the current table format; ordinary scans remain unaffected. The current package also needs the matching hardnested resource tables before this workflow is release-complete. | Essential for Public Preview 1 while Advanced Recovery remains included. |
| Python | No guided Electron workflow invokes the Proxmark3 Python scripting runtime. It is reachable only through expert manual PM3 commands in Device Console. | User-supplied or PM3 Python scripts can no longer be run through the manual console; guided scan, Collection, Card Viewer and Device Studio workflows continue. | Optional for Public Preview 1. |
| Qt | Main/preload contain a live antenna-plot backend and the renderer contains a delegated handler, but the current renderer creates no matching plot control. Qt plots remain reachable through expert manual PM3 commands in Device Console. | No currently rendered Device Studio control is lost. PM3 graphical plots opened through the manual console become unavailable; textual and structured antenna measurements continue. | Optional for Public Preview 1. |
| GD Graphics Library | No guided Electron workflow uses GD. It supports the specialist `hf waveshare load` image conversion command reachable through expert manual PM3 commands in Device Console. | Waveshare NFC e-paper image loading is unavailable through the manual console; the existing guided workflows continue. | Optional for Public Preview 1. |
| GNU Readline | No renderer feature uses native PM3 line editing, history or completion. Electron supplies its own command entry and sends complete commands over stdin; the PM3 client has a non-Readline `getline()` fallback. | Electron's visible console controls should remain unchanged; only native terminal editing/history/completion is lost. Persistent-session startup, command completion, cancellation and reconnect must be regression-tested with the replacement client. | Can be removed before Public Preview 1 after the targeted session-lifecycle regression test. |

### Historical Preview PM3 client feasibility

A dedicated self-contained Preview client is technically feasible, but the
feature-preserving and minimum-size variants are not identical.

- A guided-workflow candidate can use `SKIPPYTHON=1`, `SKIPGD=1`,
  `SKIPREADLINE=1` and `SKIPQT=1`; PM3 then falls back to its plain
  `getline()` input path and no Qt GUI is compiled. `SKIPQT6=1` only selects
  Qt 5 and does not remove the Qt dependency.
- The current renderer does not create the Device Studio antenna-plot control
  expected by its dormant event handler. `SKIPQT=1` therefore removes no
  currently reachable Device Studio function, although expert PM3 graphical
  plots invoked manually through Device Console also disappear. Textual and
  structured antenna diagnostics remain.
- The CMake client build supports `EMBED_LZ4=ON`, which builds and statically
  links `liblz4.a`. This can retain hardnested without a Homebrew LZ4 dylib,
  provided the matching `client/resources/hardnested_tables` files are also
  packaged.
- Guided scanning, Collection, Card Viewer, Advanced Recovery, core Device
  Console command execution and Device Studio diagnostics remain. Manual
  Python scripts, `hf waveshare` image handling, native PM3 terminal
  editing/history/completion and all PM3 Qt plot windows disappear.
- Removing Python, Qt, GD and Readline materially reduces runtime, signing and
  licence-notice packaging work. The remaining LZ4 requirement can be embedded,
  making the candidate substantially simpler and portable.

This is source-level feasibility only. It requires a reproducible build,
feature tests, clean-machine loader verification and an exact corresponding
source package before it can replace the current client.

### Historical Qt removal impact assessment

- The current renderer exposes no reachable Device Studio live-plot control:
  only its main/preload backend and a dormant delegated event handler exist.
  Disabling that path therefore removes no currently visible Device Studio
  capability.
- PCB exploration, component explanations, source viewing, structured hardware
  status, LED/button reporting and tests, Safe Mode, textual `hw version` and
  `hw tune` diagnostics, explained antenna measurements and structured
  `hw scope` data can continue without Qt. The PM3 no-GUI build supplies dummy
  graph functions while preserving text and JSON output.
- `SKIPQT=1` removes Qt Core, Gui and Widgets completely from the client. It
  also removes every PM3 graphical plot reachable through expert manual Device
  Console commands, so the platform-wide effect is broader than the dormant
  Device Studio path alone.
- Removing Qt eliminates the largest Homebrew framework group, its runtime-path
  repair, framework/plugin deployment and nested signing work, and reduces the
  third-party notice/compliance surface. This is a substantial packaging and
  clean-machine portability simplification, subject to a replacement-client
  regression test and an explicit decision about expert manual plot support.

### Historical proposed Public Preview 1 PM3 feature matrix

This is an evidence-based record of the Public Preview 1 PM3 scope; it does
not change the product Roadmap or remove functionality.

| Feature | Keep | Remove | Reason |
| --- | --- | --- | --- |
| USB Proxmark3 discovery, connection and process lifecycle | Yes | No | **Required for Public Preview 1.** Every live workflow depends on device detection, shared port ownership, cancellation and cleanup. |
| Guided HF scan and identification | Yes | No | **Required for Public Preview 1.** Core acquisition path for HF/NFC cards. |
| Guided LF scan and identification | Yes | No | **Required for Public Preview 1.** Core acquisition path for 125/134 kHz tags. |
| Family-specific HF/LF detection and read profiles | Yes | No | **Required for Public Preview 1.** Preserves the current MIFARE, ISO14443, EMV, DESFire, Plus, SEOS, iCLASS, ISO15693, FeliCa and common LF identification paths. |
| Card Viewer and readable-data handoff | Yes | No | **Required for Public Preview 1.** It turns accepted PM3 results into the current human-readable card view. |
| Family-aware Deep Scan | Yes | No | **Required for Public Preview 1.** Existing guided card analysis and evidence capture. |
| EMV public extended analysis and redaction | Yes | No | **Required for Public Preview 1.** Existing read-only guided analysis with the current redaction boundary. |
| MIFARE Classic Advanced Recovery, including hardnested | Yes | No | **Required for Public Preview 1 while the current workflow remains included.** Requires embedded LZ4 plus the matching dictionaries and hardnested table resources. |
| Authenticated DESFire and MIFARE Plus bounded reads | Yes | No | **Required for Public Preview 1.** Existing explicitly selected family workflows; no optional Homebrew GUI dependency. |
| PM3 runtime dictionaries and hardnested tables | Yes | No | **Required for Public Preview 1.** Guided key checks and hardnested cannot be release-complete without their exact matching resources; these are absent from the current package. |
| Device Console core interactive command execution | Yes | No | **Required for Public Preview 1.** Preserves expert access, raw evidence and the current shared command transport. |
| Device Console manual advanced PM3 command surface | Yes | No | **Required for Public Preview 1.** Preserves existing expert functionality and user control; Safe Mode and command guards remain separate product boundaries. |
| Command Library, saved commands and custom command buttons | Yes | No | **Required for Public Preview 1.** Existing discoverability and repeatability layer over Device Console. |
| Console-output mirroring and parsing into guided workflows | Yes | No | **Required for Public Preview 1.** Keeps Card Viewer/scan progress reviewable and supports explicit interpretation of console evidence. |
| Restore Helper command generation | Yes | No | **Required for Public Preview 1.** Existing reviewable command-plan workflow; it does not need an optional PM3 runtime library. |
| Device Studio workspace | Yes | No | **Required for Public Preview 1.** Current hardware understanding and diagnostic workspace. |
| Device Studio PCB Explorer and component overlays | Yes | No | **Required for Public Preview 1.** Primary hardware-learning experience; independent of Qt. |
| Hardware identity, capability and firmware diagnostics | Yes | No | **Required for Public Preview 1.** Preserves structured `hw version` and status contracts. |
| Textual and structured antenna measurements | Yes | No | **Required for Public Preview 1.** `hw tune` measurements and explained comparisons continue without Qt. |
| Structured ADC scope snapshots | Yes | No | **Required for Public Preview 1.** The JSON sample path does not require a native graph window. |
| LED, button and Safe Mode status/tests | Yes | No | **Required for Public Preview 1.** Existing capability-gated Device Studio diagnostics; independent of Qt, Python, GD and Readline. |
| Lua and command-file scripting through expert Device Console | Yes | No | **Optional after Public Preview 1, retained.** Uses the client's supplied local Lua implementation and creates no identified Homebrew runtime dependency. |
| Native PM3 Qt graph and picture windows | No | Yes | **Optional after Public Preview 1. Restore effort: Medium.** No live-plot control is currently rendered in Device Studio; manual Device Console plots would disappear. Restoring requires portable Qt deployment, signing and regression tests. |
| Embedded Python scripting | No | Yes | **Optional after Public Preview 1. Restore effort: Medium.** No guided workflow uses it; restoration requires a portable private Python runtime, scripts, notices and tests. |
| Waveshare NFC e-paper image support | No | Yes | **Optional after Public Preview 1. Restore effort: Medium.** Only the specialist manual `hf waveshare` path uses GD; restoration requires portable GD and hardware/image tests. |
| Native PM3 Readline history and completion | No | Yes | **Internal/Developer only for Public Preview 1. Restore effort: Low.** Electron provides its own console input; restoration can use a portable embedded/static Readline build plus lifecycle tests. |
| Native Bluetooth client connection | No | Yes | **Optional after Public Preview 1. Restore effort: High.** The current macOS Electron path is USB-focused and has no verified Bluetooth workflow; restoration needs transport design and real-device cross-platform testing. |

## Project components intentionally not bundled in the current package

| Name | Version (if known) | License | Purpose | Bundled with Electron? (Yes/No) | Action required before Public Preview (if any) |
| --- | --- | --- | --- | --- | --- |
| Proxmark3 firmware and FPGA build outputs | Git commit `dc327884d298fce2fd0abff8c464e1f5db1958e0`, locally modified source checkout | GPL-3.0-or-later | Firmware and FPGA support for the separately maintained Proxmark3 hardware build. | No | Do not describe firmware or FPGA images as included in the current Electron release; if the package scope changes, add the exact binaries, corresponding source, notices and installation documentation to this inventory. |

## npm development and packaging dependencies

The project has no npm production dependencies. The following complete lockfile inventory contains Electron itself and the tools used to download, package and build the application. Electron is listed above because its runtime is bundled; every other npm package below is development/build-time only and is not copied into the packaged application.

| Name | Version (if known) | License | Purpose | Bundled with Electron? (Yes/No) | Action required before Public Preview (if any) |
| --- | --- | --- | --- | --- | --- |
| @develar/schema-utils | 2.6.5 | MIT | Development/build dependency: webpack Validation Utils | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @electron/asar | 3.4.1 | MIT | Development/build dependency: Creating Electron app packages | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @electron/get | 2.0.3 | MIT | Development/build dependency: Utility for downloading artifacts from different versions of Electron | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @electron/notarize | 2.2.1 | MIT | Development/build dependency: Notarize your Electron app | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @electron/osx-sign | 1.0.5 | BSD-2-Clause | Development/build dependency: Codesign Electron macOS apps | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @electron/universal | 1.5.1 | MIT | Development/build dependency: Utility for creating Universal macOS applications from two x64 and arm64 Electron applications | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @isaacs/cliui | 8.0.2 | ISC | Development/build dependency: easily create complex multi-column command-line-interfaces | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @malept/cross-spawn-promise | 1.1.1 | Apache-2.0 | Development/build dependency: Promisified version of cross-spawn | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @malept/flatpak-bundler | 0.4.0 | MIT | Development/build dependency: A small utility for packing files in a flatpak. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @pkgjs/parseargs | 0.11.0 | MIT | Development/build dependency: Polyfill of future proposal for `util.parseArgs()` | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @sindresorhus/is | 4.6.0 | MIT | Development/build dependency: Type check values | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @szmarczak/http-timer | 4.0.6 | MIT | Development/build dependency: Timings for HTTP requests | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @tootallnate/once | 2.0.1 | MIT | Development/build dependency: Creates a Promise that waits for a single event | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/cacheable-request | 6.0.3 | MIT | Development/build dependency: TypeScript definitions for cacheable-request | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/debug | 4.1.13 | MIT | Development/build dependency: TypeScript definitions for debug | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/fs-extra | 9.0.13 | MIT | Development/build dependency: TypeScript definitions for fs-extra | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/http-cache-semantics | 4.2.0 | MIT | Development/build dependency: TypeScript definitions for http-cache-semantics | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/keyv | 3.1.4 | MIT | Development/build dependency: TypeScript definitions for keyv | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/ms | 2.1.0 | MIT | Development/build dependency: TypeScript definitions for ms | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/node | 20.19.43 | MIT | Development/build dependency: TypeScript definitions for node | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/plist | 3.0.5 | MIT | Development/build dependency: TypeScript definitions for plist | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/responselike | 1.0.3 | MIT | Development/build dependency: TypeScript definitions for responselike | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/verror | 1.10.11 | MIT | Development/build dependency: TypeScript definitions for verror | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @types/yauzl | 2.10.3 | MIT | Development/build dependency: TypeScript definitions for yauzl | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| @xmldom/xmldom | 0.9.10 | MIT | Development/build dependency: A pure JavaScript W3C standard-based (XML DOM Level 2 Core) DOMParser and XMLSerializer module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| 7zip-bin | 5.2.0 | MIT | Development/build dependency: 7-Zip precompiled binaries | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| agent-base | 6.0.2 | MIT | Development/build dependency: Turn a function into an `http.Agent` instance | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ajv | 6.15.0 | MIT | Development/build dependency: Another JSON Schema Validator | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ajv-keywords | 3.5.2 | MIT | Development/build dependency: Custom JSON-Schema keywords for Ajv validator | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ansi-regex | 5.0.1 | MIT | Development/build dependency: Regular expression for matching ANSI escape codes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ansi-regex | 6.2.2 | MIT | Development/build dependency: Regular expression for matching ANSI escape codes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ansi-styles | 4.3.0 | MIT | Development/build dependency: ANSI escape codes for styling strings in the terminal | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ansi-styles | 6.2.3 | MIT | Development/build dependency: ANSI escape codes for styling strings in the terminal | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| app-builder-bin | 4.0.0 | MIT | Development/build dependency: app-builder precompiled binaries | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| app-builder-lib | 24.13.3 | MIT | Development/build dependency: electron-builder lib | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| archiver | 5.3.2 | MIT | Development/build dependency: a streaming interface for archive generation | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| archiver-utils | 2.1.0 | MIT | Development/build dependency: utility functions for archiver | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| archiver-utils | 3.0.4 | MIT | Development/build dependency: utility functions for archiver | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| argparse | 2.0.1 | Python-2.0 | Development/build dependency: CLI arguments parser. Native port of python's argparse. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| assert-plus | 1.0.0 | MIT | Development/build dependency: Extra assertions on top of node's assert module | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| astral-regex | 2.0.0 | MIT | Development/build dependency: Regular expression for matching astral symbols | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| async | 3.2.6 | MIT | Development/build dependency: Higher-order functions and common patterns for asynchronous code | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| async-exit-hook | 2.0.1 | MIT | Development/build dependency: Run some code when the process exits (supports async hooks and pm2 clustering) | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| asynckit | 0.4.0 | MIT | Development/build dependency: Minimal async jobs utility library, with streams support | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| at-least-node | 1.0.0 | ISC | Development/build dependency: Lightweight Node.js version sniffing/comparison | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| balanced-match | 1.0.2 | MIT | Development/build dependency: Match balanced character pairs, like "{" and "}" | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| base64-js | 1.5.1 | MIT | Development/build dependency: Base64 encoding/decoding in pure JS | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| bl | 4.1.0 | MIT | Development/build dependency: Buffer List: collect buffers and access with a standard readable Buffer interface, streamable too! | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| bluebird | 3.7.2 | MIT | Development/build dependency: Full featured Promises/A+ implementation with exceptionally good performance | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| bluebird-lst | 1.0.9 | MIT | Development/build dependency: Bluebird — longStackTraces: true, cancellation: true | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| boolean | 3.2.0 | MIT | Development/build dependency: boolean converts lots of things to boolean. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| brace-expansion | 1.1.15 | MIT | Development/build dependency: Brace expansion as known from sh/bash | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| brace-expansion | 2.1.1 | MIT | Development/build dependency: Brace expansion as known from sh/bash | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| buffer | 5.7.1 | MIT | Development/build dependency: Node.js Buffer API, for the browser | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| buffer-crc32 | 0.2.13 | MIT | Development/build dependency: A pure javascript CRC32 algorithm that plays nice with binary data | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| buffer-equal | 1.0.1 | MIT | Development/build dependency: return whether two buffers are equal | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| buffer-from | 1.1.2 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| builder-util | 24.13.1 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| builder-util-runtime | 9.2.4 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| cacheable-lookup | 5.0.4 | MIT | Development/build dependency: A cacheable dns.lookup(…) that respects the TTL | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| cacheable-request | 7.0.4 | MIT | Development/build dependency: Wrap native HTTP requests with RFC compliant cache support | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| call-bind-apply-helpers | 1.0.2 | MIT | Development/build dependency: Helper functions around Function call/apply/bind, for use in `call-bind` | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| chalk | 4.1.2 | MIT | Development/build dependency: Terminal string styling done right | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| chownr | 2.0.0 | ISC | Development/build dependency: like `chown -R` | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| chromium-pickle-js | 0.2.0 | MIT | Development/build dependency: Binary value packing and unpacking | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ci-info | 3.9.0 | MIT | Development/build dependency: Get details about the current Continuous Integration environment | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| cli-truncate | 2.1.0 | MIT | Development/build dependency: Truncate a string to a specific width in the terminal | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| cliui | 8.0.1 | ISC | Development/build dependency: easily create complex multi-column command-line-interfaces | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| clone-response | 1.0.3 | MIT | Development/build dependency: Clone a Node.js HTTP response stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| color-convert | 2.0.1 | MIT | Development/build dependency: Plain color conversion functions | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| color-name | 1.1.4 | MIT | Development/build dependency: A list of color names and its values | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| combined-stream | 1.0.8 | MIT | Development/build dependency: A stream that emits multiple other streams one after another. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| commander | 5.1.0 | MIT | Development/build dependency: the complete solution for node.js command-line programs | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| compare-version | 0.1.2 | MIT | Development/build dependency: Compare semver version numbers | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| compress-commons | 4.1.2 | MIT | Development/build dependency: a library that defines a common interface for working with archive formats within node | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| concat-map | 0.0.1 | MIT | Development/build dependency: concatenative mapdashery | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| config-file-ts | 0.2.6 | MIT | Development/build dependency: Use Typescript for configuration files. Types for safety. Compiled for speed. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| core-util-is | 1.0.2 | MIT | Development/build dependency: The `util.is*` functions introduced in Node v0.12. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| crc | 3.8.0 | MIT | Development/build dependency: Module for calculating Cyclic Redundancy Check (CRC) for Node.js and the Browser. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| crc-32 | 1.2.2 | Apache-2.0 | Development/build dependency: Pure-JS CRC-32 | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| crc32-stream | 4.0.3 | MIT | Development/build dependency: a streaming CRC32 checksumer | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| cross-spawn | 7.0.6 | MIT | Development/build dependency: Cross platform child_process#spawn and child_process#spawnSync | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| debug | 4.4.3 | MIT | Development/build dependency: Lightweight debugging utility for Node.js and the browser | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| decompress-response | 6.0.0 | MIT | Development/build dependency: Decompress a HTTP response if needed | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| defer-to-connect | 2.0.1 | MIT | Development/build dependency: The safe way to handle the `connect` socket event | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| define-data-property | 1.1.4 | MIT | Development/build dependency: Define a data property on an object. Will fall back to assignment in an engine without descriptors. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| define-properties | 1.2.1 | MIT | Development/build dependency: Define multiple non-enumerable properties at once. Uses `Object.defineProperty` when available; falls back to standard assignment in older engines. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| delayed-stream | 1.0.0 | MIT | Development/build dependency: Buffers events from a stream until you are ready to handle them. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| detect-node | 2.1.0 | MIT | Development/build dependency: Detect Node.JS (as opposite to browser environment) (reliable) | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| dir-compare | 3.3.0 | MIT | Development/build dependency: Node JS directory compare | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| dmg-builder | 24.13.3 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| dmg-license | 1.0.11 | MIT | Development/build dependency: Generate license agreements for macOS .dmg files | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| dotenv | 9.0.2 | BSD-2-Clause | Development/build dependency: Loads environment variables from .env file | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| dotenv-expand | 5.1.0 | BSD-2-Clause | Development/build dependency: Expand environment variables using dotenv | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| dunder-proto | 1.0.1 | MIT | Development/build dependency: If available, the `Object.prototype.__proto__` accessor and mutator, call-bound | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| eastasianwidth | 0.2.0 | MIT | Development/build dependency: Get East Asian Width from a character. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ejs | 3.1.10 | Apache-2.0 | Development/build dependency: Embedded JavaScript templates | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| electron-builder | 24.13.3 | MIT | Builds and packages the Electron application and macOS DMG. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| electron-builder-squirrel-windows | 24.13.3 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| electron-publish | 24.13.1 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| emoji-regex | 8.0.0 | MIT | Development/build dependency: A regular expression to match all Emoji-only symbols as per the Unicode Standard. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| emoji-regex | 9.2.2 | MIT | Development/build dependency: A regular expression to match all Emoji-only symbols as per the Unicode Standard. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| end-of-stream | 1.4.5 | MIT | Development/build dependency: Call a callback when a readable/writable/duplex stream has completed or failed. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| env-paths | 2.2.1 | MIT | Development/build dependency: Get paths for storing things like data, config, cache, etc | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| err-code | 2.0.3 | MIT | Development/build dependency: Create an error with a code | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| es-define-property | 1.0.1 | MIT | Development/build dependency: `Object.defineProperty`, but not IE 8's broken one. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| es-errors | 1.3.0 | MIT | Development/build dependency: A simple cache for a few of the JS Error constructors. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| es-object-atoms | 1.1.2 | MIT | Development/build dependency: ES Object-related atoms: Object, ToObject, RequireObjectCoercible | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| es-set-tostringtag | 2.1.0 | MIT | Development/build dependency: A helper to optimistically set Symbol.toStringTag, when possible. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| es6-error | 4.1.1 | MIT | Development/build dependency: Easily-extendable error for use with ES6 classes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| escalade | 3.2.0 | MIT | Development/build dependency: A tiny (183B to 210B) and fast utility to ascend parent directories | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| escape-string-regexp | 4.0.0 | MIT | Development/build dependency: Escape RegExp special characters | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| extract-zip | 2.0.1 | BSD-2-Clause | Development/build dependency: unzip a zip file into a directory using 100% javascript | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| extsprintf | 1.4.1 | MIT | Development/build dependency: extended POSIX-style sprintf | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fast-deep-equal | 3.1.3 | MIT | Development/build dependency: Fast deep equal | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fast-json-stable-stringify | 2.1.0 | MIT | Development/build dependency: deterministic `JSON.stringify()` - a faster version of substack's json-stable-strigify without jsonify | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fd-slicer | 1.1.0 | MIT | Development/build dependency: safely create multiple ReadStream or WriteStream objects from the same file descriptor | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| filelist | 1.0.6 | Apache-2.0 | Development/build dependency: Lazy-evaluating list of files, based on globs or regex patterns | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| foreground-child | 3.3.1 | ISC | Development/build dependency: Run a child as if it's the foreground process. Give it stdio. Exit when it exits. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| form-data | 4.0.6 | MIT | Development/build dependency: A library to create readable "multipart/form-data" streams. Can be used to submit forms and file uploads to other web applications. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fs-constants | 1.0.0 | MIT | Development/build dependency: Require constants across node and the browser | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fs-extra | 8.1.0 | MIT | Development/build dependency: fs-extra contains methods that aren't included in the vanilla Node.js fs package. Such as mkdir -p, cp -r, and rm -rf. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fs-extra | 9.1.0 | MIT | Development/build dependency: fs-extra contains methods that aren't included in the vanilla Node.js fs package. Such as recursive mkdir, copy, and remove. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fs-extra | 10.1.0 | MIT | Development/build dependency: fs-extra contains methods that aren't included in the vanilla Node.js fs package. Such as recursive mkdir, copy, and remove. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fs-minipass | 2.1.0 | ISC | Development/build dependency: fs read and write streams based on minipass | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| fs.realpath | 1.0.0 | ISC | Development/build dependency: Use node's fs.realpath, but fall back to the JS implementation if the native one fails | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| function-bind | 1.1.2 | MIT | Development/build dependency: Implementation of Function.prototype.bind | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| get-caller-file | 2.0.5 | ISC | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| get-intrinsic | 1.3.0 | MIT | Development/build dependency: Get and robustly cache all JS language-level intrinsics at first require time | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| get-proto | 1.0.1 | MIT | Development/build dependency: Robustly get the [[Prototype]] of an object | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| get-stream | 5.2.0 | MIT | Development/build dependency: Get a stream as a string, buffer, or array | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| glob | 7.2.3 | ISC | Development/build dependency: a little globber | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| glob | 10.5.0 | ISC | Development/build dependency: the most correct and second fastest glob implementation in JavaScript | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| global-agent | 3.0.0 | BSD-3-Clause | Development/build dependency: Global HTTP/HTTPS proxy configurable using environment variables. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| globalthis | 1.0.4 | MIT | Development/build dependency: ECMAScript spec-compliant polyfill/shim for `globalThis` | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| gopd | 1.2.0 | MIT | Development/build dependency: `Object.getOwnPropertyDescriptor`, but accounts for IE's broken implementation. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| got | 11.8.6 | MIT | Development/build dependency: Human-friendly and powerful HTTP request library for Node.js | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| graceful-fs | 4.2.11 | ISC | Development/build dependency: A drop-in replacement for fs, making various improvements. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| has-flag | 4.0.0 | MIT | Development/build dependency: Check if argv has a specific flag | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| has-property-descriptors | 1.0.2 | MIT | Development/build dependency: Does the environment have full property descriptor support? Handles IE 8's broken defineProperty/gOPD. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| has-symbols | 1.1.0 | MIT | Development/build dependency: Determine if the JS environment has Symbol support. Supports spec, or shams. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| has-tostringtag | 1.0.2 | MIT | Development/build dependency: Determine if the JS environment has `Symbol.toStringTag` support. Supports spec, or shams. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| hasown | 2.0.4 | MIT | Development/build dependency: A robust, ES3 compatible, "has own property" predicate. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| hosted-git-info | 4.1.0 | ISC | Development/build dependency: Provides metadata and conversions from repository urls for GitHub, Bitbucket and GitLab | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| http-cache-semantics | 4.2.0 | BSD-2-Clause | Development/build dependency: Parses Cache-Control and other headers. Helps building correct HTTP caches and proxies | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| http-proxy-agent | 5.0.0 | MIT | Development/build dependency: An HTTP(s) proxy `http.Agent` implementation for HTTP | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| http2-wrapper | 1.0.3 | MIT | Development/build dependency: HTTP2 client, just with the familiar `https` API | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| https-proxy-agent | 5.0.1 | MIT | Development/build dependency: An HTTP(s) proxy `http.Agent` implementation for HTTPS | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| iconv-corefoundation | 1.1.7 | MIT | Development/build dependency: Character set conversion using the macOS CoreFoundation API | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| iconv-lite | 0.6.3 | MIT | Development/build dependency: Convert character encodings in pure javascript. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ieee754 | 1.2.1 | BSD-3-Clause | Development/build dependency: Read/write IEEE754 floating point numbers from/to a Buffer or array-like object | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| inflight | 1.0.6 | ISC | Development/build dependency: Add callbacks to requests in flight to avoid async duplication | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| inherits | 2.0.4 | ISC | Development/build dependency: Browser-friendly inheritance fully compatible with standard node.js inherits() | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| is-ci | 3.0.1 | MIT | Development/build dependency: Detect if the current environment is a CI server | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| is-fullwidth-code-point | 3.0.0 | MIT | Development/build dependency: Check if the character represented by a given Unicode code point is fullwidth | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| isarray | 1.0.0 | MIT | Development/build dependency: Array#isArray for older browsers | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| isbinaryfile | 4.0.10 | MIT | Development/build dependency: Detects if a file is binary in Node.js. Similar to Perl's -B. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| isbinaryfile | 5.0.7 | MIT | Development/build dependency: Detects if a file is binary in Node.js. Similar to Perl's -B. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| isexe | 2.0.0 | ISC | Development/build dependency: Minimal module to check if a file is executable. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| jackspeak | 3.4.3 | BlueOak-1.0.0 | Development/build dependency: A very strict and proper argument parser. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| jake | 10.9.4 | Apache-2.0 | Development/build dependency: JavaScript build tool, similar to Make or Rake | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| js-yaml | 4.2.0 | MIT | Development/build dependency: YAML 1.2 parser and serializer | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| json-buffer | 3.0.1 | MIT | Development/build dependency: JSON parse & stringify that supports binary via bops & base64 | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| json-schema-traverse | 0.4.1 | MIT | Development/build dependency: Traverse JSON Schema passing each schema object to callback | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| json-stringify-safe | 5.0.1 | ISC | Development/build dependency: Like JSON.stringify, but doesn't blow up on circular refs. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| json5 | 2.2.3 | MIT | Development/build dependency: JSON for Humans | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| jsonfile | 4.0.0 | MIT | Development/build dependency: Easily read/write JSON files. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| jsonfile | 6.2.1 | MIT | Development/build dependency: Easily read/write JSON files. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| keyv | 4.5.4 | MIT | Development/build dependency: Simple key-value storage with support for multiple backends | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lazy-val | 1.0.5 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lazystream | 1.0.1 | MIT | Development/build dependency: Open Node Streams on demand. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lodash | 4.18.1 | MIT | Development/build dependency: Lodash modular utilities. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lodash.defaults | 4.2.0 | MIT | Development/build dependency: The lodash method `_.defaults` exported as a module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lodash.difference | 4.5.0 | MIT | Development/build dependency: The lodash method `_.difference` exported as a module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lodash.flatten | 4.4.0 | MIT | Development/build dependency: The lodash method `_.flatten` exported as a module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lodash.isplainobject | 4.0.6 | MIT | Development/build dependency: The lodash method `_.isPlainObject` exported as a module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lodash.union | 4.6.0 | MIT | Development/build dependency: The lodash method `_.union` exported as a module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lowercase-keys | 2.0.0 | MIT | Development/build dependency: Lowercase the keys of an object | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lru-cache | 6.0.0 | ISC | Development/build dependency: A cache object that deletes the least-recently-used items. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| lru-cache | 10.4.3 | ISC | Development/build dependency: A cache object that deletes the least-recently-used items. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| matcher | 3.0.0 | MIT | Development/build dependency: Simple wildcard matching | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| math-intrinsics | 1.1.0 | MIT | Development/build dependency: ES Math-related intrinsics and helpers, robustly cached. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| mime | 2.6.0 | MIT | Development/build dependency: A comprehensive library for mime-type mapping | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| mime-db | 1.52.0 | MIT | Development/build dependency: Media Type Database | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| mime-types | 2.1.35 | MIT | Development/build dependency: The ultimate javascript content-type utility. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| mimic-response | 1.0.1 | MIT | Development/build dependency: Mimic a Node.js HTTP response stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| mimic-response | 3.1.0 | MIT | Development/build dependency: Mimic a Node.js HTTP response stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minimatch | 3.1.5 | ISC | Development/build dependency: a glob matcher in javascript | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minimatch | 5.1.9 | ISC | Development/build dependency: a glob matcher in javascript | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minimatch | 9.0.9 | ISC | Development/build dependency: a glob matcher in javascript | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minimist | 1.2.8 | MIT | Development/build dependency: parse argument options | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minipass | 3.3.6 | ISC | Development/build dependency: minimal implementation of a PassThrough stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minipass | 5.0.0 | ISC | Development/build dependency: minimal implementation of a PassThrough stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minipass | 7.1.3 | BlueOak-1.0.0 | Development/build dependency: minimal implementation of a PassThrough stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| minizlib | 2.1.2 | MIT | Development/build dependency: A small fast zlib stream built on [minipass](http://npm.im/minipass) and Node.js's zlib binding. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| mkdirp | 1.0.4 | MIT | Development/build dependency: Recursively mkdir, like `mkdir -p` | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| ms | 2.1.3 | MIT | Development/build dependency: Tiny millisecond conversion utility | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| node-addon-api | 1.7.2 | MIT | Development/build dependency: Node.js API (N-API) | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| normalize-path | 3.0.0 | MIT | Development/build dependency: Normalize slashes in a file path to be posix/unix-like forward slashes. Also condenses repeat slashes to a single slash and removes and trailing slashes, unless disabled. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| normalize-url | 6.1.0 | MIT | Development/build dependency: Normalize a URL | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| object-keys | 1.1.1 | MIT | Development/build dependency: An Object.keys replacement, in case Object.keys is not available. From https://github.com/es-shims/es5-shim | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| once | 1.4.0 | ISC | Development/build dependency: Run a function exactly one time | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| p-cancelable | 2.1.1 | MIT | Development/build dependency: Create a promise that can be canceled | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| package-json-from-dist | 1.0.1 | BlueOak-1.0.0 | Development/build dependency: Load the local package.json from either src or dist folder | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| path-is-absolute | 1.0.1 | MIT | Development/build dependency: Node.js 0.12 path.isAbsolute() ponyfill | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| path-key | 3.1.1 | MIT | Development/build dependency: Get the PATH environment variable key cross-platform | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| path-scurry | 1.11.1 | BlueOak-1.0.0 | Development/build dependency: walk paths fast and efficiently | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| pend | 1.2.0 | MIT | Development/build dependency: dead-simple optimistic async helper | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| picocolors | 1.1.1 | ISC | Development/build dependency: The tiniest and the fastest library for terminal output formatting with ANSI colors | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| plist | 3.1.1 | MIT | Development/build dependency: Apple's property list parser/builder for Node.js and browsers | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| process-nextick-args | 2.0.1 | MIT | Development/build dependency: process.nextTick but always with args | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| progress | 2.0.3 | MIT | Development/build dependency: Flexible ascii progress bar | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| promise-retry | 2.0.1 | MIT | Development/build dependency: Retries a function that returns a promise, leveraging the power of the retry module. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| pump | 3.0.4 | MIT | Development/build dependency: pipe streams together and close all of them if one of them closes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| punycode | 2.3.1 | MIT | Development/build dependency: A robust Punycode converter that fully complies to RFC 3492 and RFC 5891, and works on nearly all JavaScript platforms. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| quick-lru | 5.1.1 | MIT | Development/build dependency: Simple “Least Recently Used” (LRU) cache | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| read-config-file | 6.3.2 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| readable-stream | 2.3.8 | MIT | Development/build dependency: Streams3, a user-land copy of the stream library from Node.js | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| readable-stream | 3.6.2 | MIT | Development/build dependency: Streams3, a user-land copy of the stream library from Node.js | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| readdir-glob | 1.1.3 | Apache-2.0 | Development/build dependency: Recursive fs.readdir with streaming API and glob filtering. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| require-directory | 2.1.1 | MIT | Development/build dependency: Recursively iterates over specified directory, require()'ing each file, and returning a nested hash structure containing those modules. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| resolve-alpn | 1.2.1 | MIT | Development/build dependency: Detects the ALPN protocol | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| responselike | 2.0.1 | MIT | Development/build dependency: A response-like object for mocking a Node.js HTTP response stream | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| retry | 0.12.0 | MIT | Development/build dependency: Abstraction for exponential and custom retry strategies for failed operations. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| roarr | 2.15.4 | BSD-3-Clause | Development/build dependency: JSON logger for Node.js and browser. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| safe-buffer | 5.1.2 | MIT | Development/build dependency: Safer Node.js Buffer API | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| safe-buffer | 5.2.1 | MIT | Development/build dependency: Safer Node.js Buffer API | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| safer-buffer | 2.1.2 | MIT | Development/build dependency: Modern Buffer API polyfill without footguns | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| sanitize-filename | 1.6.4 | WTFPL OR ISC | Development/build dependency: Sanitize a string for use as a filename | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| sax | 1.6.0 | BlueOak-1.0.0 | Development/build dependency: An evented streaming XML parser in JavaScript | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| semver | 6.3.1 | ISC | Development/build dependency: The semantic version parser used by npm. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| semver | 7.8.5 | ISC | Development/build dependency: The semantic version parser used by npm. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| semver-compare | 1.0.0 | MIT | Development/build dependency: compare two semver version strings, returning -1, 0, or 1 | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| serialize-error | 7.0.1 | MIT | Development/build dependency: Serialize/deserialize an error into a plain object | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| shebang-command | 2.0.0 | MIT | Development/build dependency: Get the command from a shebang | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| shebang-regex | 3.0.0 | MIT | Development/build dependency: Regular expression for matching a shebang line | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| signal-exit | 4.1.0 | ISC | Development/build dependency: when you want to fire an event no matter how a process exits. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| simple-update-notifier | 2.0.0 | MIT | Development/build dependency: Simple update notifier to check for npm updates for cli applications | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| slice-ansi | 3.0.0 | MIT | Development/build dependency: Slice a string with ANSI escape codes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| smart-buffer | 4.2.0 | MIT | Development/build dependency: smart-buffer is a Buffer wrapper that adds automatic read & write offset tracking, string operations, data insertions, and more. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| source-map | 0.6.1 | BSD-3-Clause | Development/build dependency: Generates and consumes source maps | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| source-map-support | 0.5.21 | MIT | Development/build dependency: Fixes stack traces for files with source maps | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| sprintf-js | 1.1.3 | BSD-3-Clause | Development/build dependency: JavaScript sprintf implementation | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| stat-mode | 1.0.0 | MIT | Development/build dependency: Offers convenient getters and setters for the stat `mode` | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| string_decoder | 1.1.1 | MIT | Development/build dependency: The string_decoder module from Node core | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| string_decoder | 1.3.0 | MIT | Development/build dependency: The string_decoder module from Node core | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| string-width | 4.2.3 | MIT | Development/build dependency: Get the visual width of a string - the number of columns required to display it | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| string-width | 5.1.2 | MIT | Development/build dependency: Get the visual width of a string - the number of columns required to display it | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| string-width-cjs | 4.2.3 | MIT | Development/build dependency: Get the visual width of a string - the number of columns required to display it | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| strip-ansi | 6.0.1 | MIT | Development/build dependency: Strip ANSI escape codes from a string | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| strip-ansi | 7.2.0 | MIT | Development/build dependency: Strip ANSI escape codes from a string | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| strip-ansi-cjs | 6.0.1 | MIT | Development/build dependency: Strip ANSI escape codes from a string | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| sumchecker | 3.0.1 | Apache-2.0 | Development/build dependency: Checksum validator | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| supports-color | 7.2.0 | MIT | Development/build dependency: Detect whether a terminal supports color | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| tar | 6.2.1 | ISC | Development/build dependency: tar for node | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| tar-stream | 2.2.0 | MIT | Development/build dependency: tar-stream is a streaming tar parser and generator and nothing else. It is streams2 and operates purely using streams which means you can easily extract/parse tarballs without ever hitting the file system. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| temp-file | 3.4.0 | MIT | Transitive development, build or packaging dependency. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| tmp | 0.2.7 | MIT | Development/build dependency: Temporary file and directory creator | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| tmp-promise | 3.0.3 | MIT | Development/build dependency: The tmp package with promises support and disposers. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| truncate-utf8-bytes | 1.0.2 | WTFPL | Development/build dependency: Truncate string to given length in bytes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | Development/build dependency: A collection of essential TypeScript types | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| typescript | 5.9.3 | Apache-2.0 | Development/build dependency: TypeScript is a language for application scale JavaScript development | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| undici-types | 6.21.0 | MIT | Development/build dependency: A stand-alone types package for Undici | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| universalify | 0.1.2 | MIT | Development/build dependency: Make a callback- or promise-based function support both promises and callbacks. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| universalify | 2.0.1 | MIT | Development/build dependency: Make a callback- or promise-based function support both promises and callbacks. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| uri-js | 4.4.1 | BSD-2-Clause | Development/build dependency: An RFC 3986/3987 compliant, scheme extendable URI/IRI parsing/validating/resolving library for JavaScript. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| utf8-byte-length | 1.0.5 | (WTFPL OR MIT) | Development/build dependency: Get utf8 byte length of string | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| util-deprecate | 1.0.2 | MIT | Development/build dependency: The Node.js `util.deprecate()` function with browser support | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| verror | 1.10.1 | MIT | Development/build dependency: richer JavaScript errors | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| which | 2.0.2 | ISC | Development/build dependency: Like which(1) unix command. Find the first instance of an executable in the PATH. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| wrap-ansi | 7.0.0 | MIT | Development/build dependency: Wordwrap a string with ANSI escape codes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| wrap-ansi | 8.1.0 | MIT | Development/build dependency: Wordwrap a string with ANSI escape codes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| wrap-ansi-cjs | 7.0.0 | MIT | Development/build dependency: Wordwrap a string with ANSI escape codes | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| wrappy | 1.0.2 | ISC | Development/build dependency: Callback wrapping utility | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| xmlbuilder | 15.1.1 | MIT | Development/build dependency: An XML builder for node.js | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| y18n | 5.0.8 | ISC | Development/build dependency: the bare-bones internationalization library used by yargs | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| yallist | 4.0.0 | ISC | Development/build dependency: Yet Another Linked List | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| yargs | 17.7.3 | MIT | Development/build dependency: yargs the modern, pirate-themed, successor to optimist. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| yargs-parser | 21.1.1 | ISC | Development/build dependency: the mighty option parser used by yargs | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| yauzl | 2.10.0 | MIT | Development/build dependency: yet another unzip library for node | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
| zip-stream | 4.1.1 | MIT | Development/build dependency: a streaming zip archive generator. | No | Confirm it remains build-only; no packaged notice action unless the distribution scope changes. |
