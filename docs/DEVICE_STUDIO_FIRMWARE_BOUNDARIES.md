# Device Studio Firmware Boundaries

Device Studio is intended to help users understand Proxmark3 hardware safely. The first version is educational and read-only.

## Safe Now

- Show photos of the Proxmark3 Easy.
- Show clickable components and explanations.
- Explain what each visible part does.
- Show static safety notes.
- Prepare a live status area without running commands automatically.
- Later, use existing read-only diagnostics such as device discovery, version, status and antenna tune checks after separate testing.

## Requires Firmware or Client Support

Some useful Device Studio features cannot be implemented responsibly from Electron alone.

| Desired Feature | Best Location | Why It Helps | Difficulty | Backwards Compatible |
| --- | --- | --- | --- | --- |
| Structured `hw status --json` output | PM3 client | Lets Electron parse status without fragile text scraping. | Medium | Yes, if added as optional output. |
| Structured `hw tune --json` output | PM3 client | Allows reliable HF/LF antenna diagnostics. | Medium | Yes, if existing text output remains. |
| Board/profile descriptor | Firmware or client | Identifies board type, revision and optional modules. | Medium | Yes, if additive. |
| LED role map | Firmware or client | Lets Electron explain which LED means what on each hardware revision. | Low to medium | Yes, if read-only. |
| Temporary LED self-test | Firmware | Helps users identify LEDs A-D without guessing. | Medium | Yes, if timed and non-persistent. |
| Button state query | Firmware | Enables a guided "press the button" diagnostic. | Medium | Yes, if query-only. |
| Optional module detection | Firmware or client | Could identify Bluetooth/LF modules when supported by hardware. | Medium to high | Yes, if unsupported devices return "unknown". |
| Safe diagnostic mode | Firmware/client/Electron | Prevents write workflows during hardware diagnostics. | Medium | Yes, if opt-in. |

## What Would Require Firmware Changes

- Reading a physical button state if the current firmware does not expose it.
- Mapping LED identities reliably across board revisions.
- Running a timed LED identification pattern.
- Reporting board revision and optional module presence in a structured way.
- Providing machine-readable diagnostic output for Electron.

## Why Firmware Flashing Must Not Be Added Yet

Firmware flashing is a high-risk workflow. It can fail because of the wrong board target, interrupted USB connection, bootloader mismatch, bad image, power problems or user confusion. A failed flash can leave a device unusable until recovered with separate tools and knowledge.

Device Studio v1 must therefore avoid:

- flashing;
- bootloader switching;
- FPGA reconfiguration;
- persistent device settings;
- automatic recovery workflows.

Firmware work should become a separate future "Firmware Studio" only after recovery documentation, target verification, dry-run checks and explicit user confirmations are designed.

## Possible Future Safe LED Architecture

A future LED diagnostic should be firmware-backed, temporary and non-persistent.

Suggested properties:

- user-triggered only;
- short timeout;
- no card interaction;
- no stored state;
- blocked while scans are running;
- output mirrored to Device Console;
- clear message that it is a hardware identification test.

Electron should not fake LED control if the firmware does not expose it.

## Possible Future Button Mapping Architecture

A future button diagnostic should be query-only.

Suggested flow:

1. User clicks "Test Button".
2. Electron confirms the device is connected and idle.
3. Firmware/client reports button state for a short window.
4. User presses and releases the button.
5. Electron shows detected state changes.
6. No standalone action is triggered.

## Avoiding Bricked Devices

Before any future flashing feature exists, the project should have:

- reliable board identification;
- image compatibility checks;
- checksum verification;
- dry-run mode;
- clear recovery instructions;
- warning boundaries in UI;
- safe rollback documentation;
- no automatic flash on app startup;
- no hidden writes.

## Future Contribution Notes

The most valuable upstream-friendly improvements would be structured diagnostic output and read-only hardware descriptors. Those features help Electron and other tools without changing existing workflows or requiring users to accept new risk.

