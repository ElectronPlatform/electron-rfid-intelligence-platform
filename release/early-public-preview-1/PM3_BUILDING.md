# Building the Electron Early Public Preview 1 PM3 Client

## Supported verification environment

- MacOs 26.5.2, arm64
- Apple Clang 21.0.0
- CMake 4.4.0

## Obtain the exact source

Clone the included Git bundle and select the release commit:

```sh
git clone proxmark3-iceman-electron-preview-1.bundle proxmark3-iceman-source
cd proxmark3-iceman-source
git checkout 4e41c2b37efcfd6432568bf846d87ab9a103ff5f
```

The checkout must be clean before building:

```sh
git status --short
```

## Configure and build

```sh
cd client
cmake --preset electron-public-preview-1
FORCED_DATE="2026-08-02 18:44:39" cmake --build --preset electron-public-preview-1
```

The preset produces:

```text
client/build-electron-public-preview-1/proxmark3
```

It selects a Release build with embedded LZ4 and disables Qt, Python, GD,
Readline and Bluetooth support. See `client/CMakePresets.json` for the exact
configuration.

## Verify

```sh
client/build-electron-public-preview-1/proxmark3 --incognito --version
otool -L client/build-electron-public-preview-1/proxmark3
bash tests/pm3_preview_helper_test.sh
```

The fixed date is the PM3 release-source commit time. It prevents the embedded
version source from changing merely because the same commit is rebuilt later.

The expected release source identity begins with:

```text
Iceman/HEAD/v4.21611-5-g4e41c2b37
```

The resulting binary should depend only on MacOs system libraries/frameworks.
The packaged client is built from a detached checkout. Compiler, linker,
build-path and load-command metadata can still
prevent bit-for-bit identity on another system; functional output and any
binary differences must therefore be recorded during release verification.
