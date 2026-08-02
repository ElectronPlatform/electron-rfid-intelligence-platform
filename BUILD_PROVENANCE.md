# Electron Early Public Preview 1 — Build Provenance

**Status:** Frozen PM3 provenance; final Electron artefact pending
**Last technical review:** 2 August 2026
**Application version:** 0.8.0

This record identifies the source and toolchain used for Electron Early Public
Preview 1. Final DMG and Electron-source hashes are recorded in the release
staging manifest after the clean Electron release commit is created. This
avoids placing self-referential artefact hashes inside that source commit.

## 1. Application identity

| Field | Release value |
| --- | --- |
| Package name | `electron-rfid-intelligence-platform` |
| Product name | `Electron Preview` |
| Version | `0.8.0` |
| Application ID | `app.electronrfid.preview` |
| Target | MacOs, Apple Silicon arm64 |
| Distribution model | Model B: Electron plus bundled PM3 client/launcher |
| Electron licence | `ELECTRON_PUBLIC_PREVIEW_LICENSE_v1.0.md` |
| Signing | Local ad-hoc signature only; no Apple Developer ID |
| Notarization | Not notarized |

## 2. Electron build environment

| Component | Verified value |
| --- | --- |
| MacOs | 26.5.2, build 25F84 |
| Architecture | arm64 |
| Xcode | 26.6, build 17F113 |
| Node.js build shell | 24.16.0 |
| npm | 11.16.0 |
| Electron | 31.7.7 |
| Electron embedded Node.js | 20.18.0 |
| Chromium | 126.0.6478.234 |
| V8 | 12.6.228.30-electron.0 |
| electron-builder | 24.13.3 |

## 3. Electron source freeze

The clean release commit and local annotated tag are created only after all
source, documentation, compliance and secret-audit checks pass. Their exact
identities, plus the Electron source-archive hash, are written to the local
release staging manifest and GitHub Release draft. No tag or commit is pushed
without Ronald's explicit publication approval.

## 4. Package configuration

- ASAR enabled.
- MacOs targets: unpacked application and DMG.
- Public product name: `Electron Preview`.
- Bundle identifier: `app.electronrfid.preview`.
- The strict PM3 launcher and portable arm64 client are copied from
  `client/build-electron-public-preview-1`.
- Packaged execution resolves the bundled launcher/client; local checkout and
  `PATH` fallbacks are development-only.
- Electron, Chromium, Proxmark3 and project licence/notice files are copied to
  the application `legal` resources.
- Original device photographs, local review archives and generated runtime
  data are excluded.
- The complete bundled command library is verified before packaging.

Final packaging command:

```sh
ELECTRON_LOCAL_ADHOC_SIGN=1 npx electron-builder --mac --arm64 \
  --config.directories.output=dist-early-public-preview-1
```

The final execution time, result and artefact checksums are recorded in the
release staging manifest.

## 5. Proxmark3 source and client

| Field | Verified value |
| --- | --- |
| Upstream tag | `v4.21611` |
| Upstream tag commit | `aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f` |
| Release commit | `4e41c2b37efcfd6432568bf846d87ab9a103ff5f` |
| Clean description | `v4.21611-5-g4e41c2b37` |
| Client identity | `Iceman/HEAD/v4.21611-5-g4e41c2b37 2026-08-02 18:44:39` |
| Client architecture | Mach-O arm64 |
| Launcher/client SHA-256 | `4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6` |
| Corresponding-source archive | `Electron-Preview-0.8.0-Proxmark3-Corresponding-Source.tar.gz` |
| Source archive SHA-256 | `efbc72437077eb2e50df44da26c14e4d92fc4dd3721f49ac720ceccd5b473fc2` |

Local commits after the upstream base:

```text
3b0dac43cbc4c17d176f1ddab029eb2b69f14f1a
9de188901e678fc4491e5a46ab2246a69ea7c367
7489c0c8e058e262f10ac8bb8eedff53e39ceacb
dc327884d298fce2fd0abff8c464e1f5db1958e0
4e41c2b37efcfd6432568bf846d87ab9a103ff5f
```

## 6. Proxmark3 build configuration

```sh
cd client
cmake --preset electron-public-preview-1
FORCED_DATE="2026-08-02 18:44:39" cmake --build --preset electron-public-preview-1
```

Preset characteristics:

- Release build;
- embedded LZ4 enabled;
- Qt, Python, GD, Readline and Bluetooth disabled;
- no external PM3 dictionaries/resources required for the packaged workflows.

Two independent clean clones from the included Git bundle produced
bit-identical clients with SHA-256
`4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6`.

`otool -L` reports only MacOs system libraries/frameworks: libSystem, zlib,
bzip2, Foundation, AppKit, libc++ and the Objective-C runtime.

## 7. Corresponding source

The corresponding-source archive contains:

- a complete-history Git bundle;
- a readable source-tree archive;
- the complete local patch series;
- build instructions and modification log;
- GPLv3 text and preserved upstream notices;
- exact embedded LZ4 source and licence;
- internal checksums.

The final public source URL intentionally remains unset until Ronald approves
the GitHub Release. The archive must be uploaded beside the DMG and remain
available for as long as the binary is offered.

## 8. Required verification

Before publication:

```sh
npm run preview:check
npm run command-library:verify
npm run pm3:preview:verify
node --check main.js
node --check preload.js
node --check renderer/renderer.js
shasum -a 256 <release artefacts>
hdiutil verify <DMG>
codesign --verify --deep --strict <application>
```

The local release staging report records the actual results. Ronald's clean-
account installation and Proxmark3 hardware acceptance remain owner-operated
release gates.

## 9. Publication boundary

This provenance record does not authorize publication. The repository commit,
tag, website changes, DMG, source archive and GitHub Release draft remain local
until Ronald explicitly approves publication.
