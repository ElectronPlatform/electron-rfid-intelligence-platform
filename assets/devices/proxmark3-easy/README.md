# Proxmark3 Easy Device Studio Assets

These files are the initial photo asset set for Electron Device Studio.

Suggested location in the project:

```text
proxmark3_asset_manager_electron_v1/assets/devices/proxmark3-easy/
```

Folders:

- `images/pcb/` — mainboard images
- `images/profile/` — side/profile views
- `images/components/` — covers, LF antenna and assembled views
- `images/macros/` — chip/component macro photos
- `originals/` — original uploaded filenames retained as backup

Data files:

- `device.json` — Proxmark3 Easy manifest and image catalog
- `components.json` — Device Studio component descriptions
- `hotspots.json` — image categories and approximate clickable hotspot positions

Device Studio v1 uses these files as a read-only educational layer. Hotspot coordinates are intentionally data-driven so they can be refined without changing the UI code.
