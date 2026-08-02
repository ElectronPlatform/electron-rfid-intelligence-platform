# Proxmark3/Iceman Modification Record

Electron Early Public Preview 1 is based on upstream Proxmark3/Iceman tag
`v4.21611` at commit `aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f`.

Local commits included after that base:

| Commit | Date | Modification |
| --- | --- | --- |
| `3b0dac43cbc4c17d176f1ddab029eb2b69f14f1a` | 10 July 2026 | Add structured hardware status reporting. |
| `9de188901e678fc4491e5a46ab2246a69ea7c367` | 10 July 2026 | Report Proxmark3 Easy LED mapping in hardware-status JSON. |
| `7489c0c8e058e262f10ac8bb8eedff53e39ceacb` | 11 July 2026 | Report FPGA clock and memory telemetry. |
| `dc327884d298fce2fd0abff8c464e1f5db1958e0` | 11 July 2026 | Report explicit hardware telemetry availability. |
| `4e41c2b37efcfd6432568bf846d87ab9a103ff5f` | 2 August 2026 | Add the reproducible Public Preview client preset, version provenance correction, launcher support, tests and release documentation. |

The complete patch series is included in the corresponding-source package.
The source contains both client and firmware work, while Electron Public
Preview 1 bundles only the macOS arm64 client and launcher. It does not bundle
firmware or FPGA images.
