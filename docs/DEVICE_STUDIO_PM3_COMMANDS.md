# Device Studio PM3 Command Investigation

Device Studio v1 is a read-only hardware visualizer. It does not run Proxmark3 commands yet. This document records safe command candidates that could later populate live status panels after separate review and testing.

## Current Boundary

- No firmware flashing.
- No writes to cards.
- No persistent hardware configuration changes.
- No LED or button control unless a safe, documented diagnostic command exists.
- Prefer commands already used by Electron or clearly read-only Proxmark3 diagnostics.

## Command Candidates

| Command | Purpose | Expected Output | Safe / Read-Only | Useful For Device Studio | Parsing Notes | Future Risk Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `pm3 --list` | Detect available Proxmark3 devices and serial ports. | Device/port list, or no device found. | Yes. Client-side discovery only. | Connection status, detected device port, availability. | Electron already uses this through the existing detection logic in `main.js`. Output varies by pm3 client version and platform. | May fail when another process owns the serial port. Treat failure as status, not as a device error. |
| `hw version` | Read hardware, firmware and client version information. | Firmware build, bootrom/fullimage details, hardware identifiers where available. | Yes. Read-only. | Firmware version, hardware type, capability hints. | Electron already exposes this as Device Information. Parse conservatively because output differs across firmware/client versions. | Do not infer unsupported features from version text alone. Pair with capability checks later. |
| `hw status` | Inspect current hardware/client status. | Status fields such as device state, voltage or mode information depending on firmware. | Expected read-only, but verify against target pm3 client before automation. | Live status area, device health, possible voltage hints. | Existing project references do not show this as a first-class workflow yet. Treat output schema as unknown. | Must remain diagnostic only. Do not trigger state changes based on ambiguous text. |
| `hw tune` | Measure HF/LF antenna tuning. | HF/LF tuning values and antenna voltage/resonance information depending on hardware. | Read-only diagnostic, but it energizes the antenna field. | HF/LF antenna status, antenna tune warnings, hardware education. | Useful for a future antenna panel. Parse only known numeric fields after testing on real PM3 Easy output. | Should not be run repeatedly without user intent. Make clear that it is a hardware diagnostic, not a card read. |
| `hw ping` | Check whether the client can communicate with the device. | Ping/response result or timeout depending on firmware/client. | Expected read-only, but verify command availability per pm3 version. | Connection health and latency indicator. | Command availability and output format should be verified before UI integration. | Avoid using as a high-frequency background poll. |
| Unknown safe LED diagnostic | Show LED mapping or temporarily test LEDs. | Unknown. | Unknown. | Would help explain Power LED and LEDs A-D. | No existing safe LED diagnostic command was found in the project references inspected for this pass. | Do not invent this in Electron. It belongs in firmware/client design if needed. |
| Unknown safe button diagnostic | Read current button state or run a guided press test. | Unknown. | Unknown. | Would help explain physical button behavior and standalone workflows. | No existing safe button-state command was found in the project references inspected for this pass. | Should be query-only or short guided test. Do not bind to standalone actions without explicit firmware support. |

## Later Integration Approach

1. Keep Device Studio static by default.
2. Add a user-triggered "Read Device Status" action only after command parsing is reviewed.
3. Run through Device Guard before any command.
4. Mirror output to Device Console for transparency.
5. Store parsed values as temporary status only, not as configuration.

## Commands Not Suitable For Device Studio v1

- Firmware flashing commands.
- FPGA or bootloader write workflows.
- Card write commands.
- Persistent hardware configuration commands.
- Any command with unclear side effects.

