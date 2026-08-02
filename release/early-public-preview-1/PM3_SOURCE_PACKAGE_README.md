# Proxmark3/Iceman Corresponding Source

This package accompanies Electron Early Public Preview 1 when the macOS arm64
application bundles the Proxmark3/Iceman client.

It contains:

- a Git bundle with the exact PM3 source commit used for the distributed
  client;
- a plain source-tree archive for convenient inspection;
- the local patch series after upstream tag `v4.21611`;
- build instructions and a modification record;
- the exact LZ4 source revision linked statically into the client;
- GPLv3 and dependency licence texts;
- SHA-256 checksums for the package contents.

Release source commit:

`4e41c2b37efcfd6432568bf846d87ab9a103ff5f`

Upstream base:

`v4.21611` / `aaacc75e9fc4eb8d0bca4d834423a57f9b90f36f`

The Git bundle is the authoritative source for reproducing the embedded PM3
version metadata because it preserves the exact release commit identity.

This package is provided under the licences contained within its source trees.
The Proxmark3/Iceman source is GPL-3.0-or-later. Electron's separate application
licence does not replace or restrict those third-party terms.
