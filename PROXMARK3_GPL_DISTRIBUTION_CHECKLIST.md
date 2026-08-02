# Proxmark3 GPL Distribution Checklist

**Status:** Release Compliance — Early Public Preview 1
**Specification:** Complete
**Execution:** In progress until final DMG verification
**Scope:** Releases containing a bundled Proxmark3/Iceman client

This checklist is technical release evidence, not legal advice. It is repeated
for every release that bundles Proxmark3/Iceman software.

## 1. Distribution model

- [x] Model B selected: Electron bundles the PM3 launcher/client and supplies
  complete corresponding source beside the binary release.
- [x] Electron's project-specific licence remains separate from GPL-covered
  third-party components.

## 2. Exact distributed artefacts

| Package path | Architecture | SHA-256 |
| --- | --- | --- |
| `Resources/pm3/pm3-electron-public-preview-1` | Mach-O arm64 | `4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6` |
| `Resources/pm3/proxmark3` | Mach-O arm64 | `4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6` |

- [x] Firmware and FPGA images are not included.
- [x] No PM3 binary is downloaded at runtime.
- [x] No external dictionaries or optional recovery tables are required by the
  packaged diagnostic/guided workflows.
- [ ] Confirm these exact paths and hashes in the final mounted DMG.

## 3. Exact corresponding source

- [x] Upstream tag: `v4.21611`.
- [x] Upstream commit: `aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f`.
- [x] Release commit: `4e41c2b37efcfd6432568bf846d87ab9a103ff5f`.
- [x] Clean source description: `v4.21611-5-g4e41c2b37`.
- [x] Complete-history Git bundle included.
- [x] Readable source-tree archive included.
- [x] Local patch series included.
- [x] GPLv3 and LZ4 licence texts included.
- [x] Exact embedded LZ4 source revision included.
- [x] Build instructions and modification record included.

Corresponding-source archive:

`Electron-Preview-0.8.0-Proxmark3-Corresponding-Source.tar.gz`

Candidate SHA-256:

`efbc72437077eb2e50df44da26c14e4d92fc4dd3721f49ac720ceccd5b473fc2`

The final public URL remains intentionally unset until Ronald approves and
creates the GitHub Release. The source archive must be uploaded beside the DMG.

## 4. Modification record

| Commit | Modification |
| --- | --- |
| `3b0dac43cbc4c17d176f1ddab029eb2b69f14f1a` | Structured hardware-status reporting. |
| `9de188901e678fc4491e5a46ab2246a69ea7c367` | Proxmark3 Easy LED mapping. |
| `7489c0c8e058e262f10ac8bb8eedff53e39ceacb` | FPGA clock and memory telemetry. |
| `dc327884d298fce2fd0abff8c464e1f5db1958e0` | Explicit hardware telemetry availability. |
| `4e41c2b37efcfd6432568bf846d87ab9a103ff5f` | Reproducible Preview preset, corrected version provenance, launcher support, tests and release documentation. |

- [x] Full format-patch series included in the source package.
- [x] Client and firmware changes are distinguished in the modification record.
- [x] Electron bundles only the client/launcher, not firmware.

## 5. Build and dependency completeness

Verified environment:

- MacOs 26.5.2, arm64;
- Apple Clang 21.0.0;
- CMake 4.4.0;
- Release build;
- embedded LZ4 enabled;
- Qt, Python, GD, Readline and Bluetooth disabled.

Verified commands from the source bundle:

```sh
cd client
cmake --preset electron-public-preview-1
FORCED_DATE="2026-08-02 18:44:39" cmake --build --preset electron-public-preview-1
```

- [x] Two independent clean bundle clones produced bit-identical clients.
- [x] Resulting SHA-256: `4da5c3373aed4b97545790fe9a632e50cacbf2732f33e4f41fa4802e4a5608b6`.
- [x] `otool -L` reports macOS system libraries/frameworks only.
- [x] No Homebrew or personal absolute path is present in the candidate client.
- [x] `bash tests/pm3_preview_helper_test.sh` passed.
- [x] `npm run pm3:preview:verify` passed against the staged client.
- [ ] Ronald clean-account PM3 hardware check on the final DMG.

## 6. Licence and source delivery

- [x] Complete GPLv3 licence text is staged in the DMG legal resources.
- [x] Upstream copyright, licence and warranty notices are preserved.
- [x] Source package filename unambiguously matches this release.
- [x] `THIRD_PARTY_NOTICES.md` identifies the source package and hash.
- [ ] Add the final durable source URL to the GitHub Release and website.
- [ ] Keep the corresponding source available for as long as the binary is
  offered.

## 7. Release compliance verification

- [x] Source archive extracts successfully.
- [x] Git bundle verifies as complete history.
- [x] Client builds from the published source archive.
- [x] Two independent rebuilds match the staged binary bit-for-bit.
- [x] Included source-package checksums verify.
- [ ] Final mounted-DMG PM3 binaries match the recorded hash.
- [ ] Final DMG and source download links work after draft upload.
- [ ] Ronald records clean-account installation and hardware results.
- [ ] Reviewer and verification date recorded in the final readiness report.
- [ ] Ronald gives explicit publication approval.

## Remaining release-specific gates

1. Build and inspect the final DMG from the frozen Electron release commit.
2. Record final DMG and source URLs/checksums in the draft release materials.
3. Complete Ronald's clean-account installation and Proxmark3 hardware checks.
4. Obtain Ronald's explicit approval before publishing.
