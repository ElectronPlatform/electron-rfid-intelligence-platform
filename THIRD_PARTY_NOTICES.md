# Electron Preview — Third-Party Notices

**Status:** Early Public Preview 1 release candidate
**Last technical review:** 2 August 2026
**Application version reviewed:** 0.8.0

This document records third-party software included in, or used to build,
Electron Early Public Preview 1. It is not legal advice. Each component remains
subject to its own licence terms.

The detailed working inventory is maintained in
`docs/THIRD_PARTY_INVENTORY.md`.

## 1. Electron runtime

| Component | Reviewed version | Licence | Distribution status |
| --- | --- | --- | --- |
| Electron | 31.7.7 | MIT | Bundled |
| Chromium | 126.0.6478.234 | BSD-3-Clause and separately licensed embedded components | Bundled by Electron |
| Node.js | 20.18.0 | MIT | Bundled by Electron |
| V8 | 12.6.228.30-electron.0 | BSD-3-Clause | Bundled by Electron |
| ReactiveObjC | 3.1.0 | MIT | Bundled by Electron |
| Squirrel.Mac | 1.0 | MIT | Bundled by Electron |
| Mantle | 1.0 | MIT | Bundled by Electron |

The package configuration preserves Electron's `LICENSE` and the complete
`LICENSES.chromium.html` notice set under the application's `legal` resources.
The final packaged-app inspection remains a release gate.

## 2. Proxmark3 / Iceman

| Component | Reviewed identity | Licence | Distribution status |
| --- | --- | --- | --- |
| Electron PM3 launcher | Source commit `4e41c2b37efcfd6432568bf846d87ab9a103ff5f` | GPL-3.0-or-later | Bundled by `extraResources` |
| Proxmark3 client | `Iceman/HEAD/v4.21611-5-g4e41c2b37`, macOS arm64 | GPL-3.0-or-later | Bundled by `extraResources` |

The two packaged executables are reproducible from the same frozen source and
currently have the same SHA-256:

| Packaged file | SHA-256 |
| --- | --- |
| `pm3/pm3-electron-public-preview-1` | `4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6` |
| `pm3/proxmark3` | `4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6` |

The inspected upstream base is tag `v4.21611`, commit
`aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f`. The complete corresponding-source
package is:

`Electron-Preview-0.8.0-Proxmark3-Corresponding-Source.tar.gz`

Candidate archive SHA-256:

`efbc72437077eb2e50df44da26c14e4d92fc4dd3721f49ac720ceccd5b473fc2`

The archive contains the complete Git history and exact release commit, a
readable source tree, the local patch series, build instructions, modification
record, GPLv3 text, and the exact LZ4 source revision used by the embedded
build. Its final public URL must be placed beside the binary on the same GitHub
Release before publication.

## 3. Proxmark3 runtime dependencies

The Apple Silicon client links dynamically only to macOS-provided components:

| Component | Reviewed version | Licence | Bundled by Electron |
| --- | --- | --- | --- |
| Apple Foundation, AppKit, libSystem and Objective-C runtime | Target macOS | Apple platform terms | No |
| LLVM libc++ | Target macOS | Apache-2.0 WITH LLVM-exception | No |
| bzip2 | 1.0.8 | bzip2-1.0.6 | No |
| zlib | 1.2.12 | Zlib | No |

LZ4 is embedded statically. The corresponding-source archive includes the
exact source revision and licence used for that dependency.

`otool -L` reports no Homebrew or other non-system dynamic-library path. The
strict Preview helper starts successfully during `npm run pm3:preview:verify`.

## 4. Firmware and FPGA images

Electron Early Public Preview 1 bundles the PM3 client/launcher only. It does
not bundle Proxmark3 firmware or FPGA images.

## 5. npm development and packaging dependencies

The application declares no npm production dependencies. Electron and
electron-builder are development dependencies; Electron supplies the packaged
runtime and electron-builder supplies the packaging toolchain.

| Direct package | Reviewed version | Licence | Packaged as application runtime |
| --- | --- | --- | --- |
| `electron` | 31.7.7 | MIT | Yes |
| `electron-builder` | 24.13.3 | MIT | No |

The complete transitive build inventory is recorded in
`docs/THIRD_PARTY_INVENTORY.md`.

## 6. Electron application licence

The Electron application is distributed for this release under the project-
specific `ELECTRON_PUBLIC_PREVIEW_LICENSE_v1.0.md`. That licence does not
replace or restrict the separate third-party licence terms described above.

## 7. Final release gate

- [x] Electron Public Preview licence supplied.
- [x] GPLv3 licence text staged for Proxmark3/Iceman.
- [x] Exact corresponding Proxmark3 source archive prepared.
- [x] Local modifications and build instructions supplied.
- [x] Reproducible PM3 build verified from two independent bundle clones.
- [ ] Final DMG inspected for the actual bundled components and notices.
- [ ] Final source/download URLs recorded on the GitHub Release.
- [ ] Final public artefact checksums recorded after packaging.

## No warranty statement

Third-party software is provided under its respective licence terms. Consult
the complete licence texts distributed with the release for the applicable
copyright, warranty and liability provisions.
