# Fork security changes

This source fork hardens the audited REA baseline against known dependency
vulnerabilities and unauthenticated optional downloads. It retains upstream
licenses and records original and patched submodule revisions. These changes
have not been published as a replacement for the upstream npm package.

## Source installation

Clone this repository and initialize optional submodules only when needed:

```sh
git clone https://github.com/YiTaChen/rea.git
cd rea
npm ci --ignore-scripts
npm run build:cached
node scripts/rea.mjs --help
```

The source `.npmrc` disables install lifecycle scripts, preventing Frida's
unverified prebuild download or source-build fallback. The curl installer also
passes `--ignore-scripts` explicitly. Build, test and documentation prerequisites
are part of their explicit scripts so disabling lifecycle hooks does not skip
those guards. To opt into the repository's Git hooks, run
`node scripts/prepare.mjs` explicitly. Release preparation must use
`npm run pack:verified` or `npm run publish:verified`; both require the existing
native-artifact verification prerequisites. No npm release is produced by the
security repair itself.

## Verified optional downloads

Hopper automatic installation accepts only reviewed vendor HTTPS release paths,
validates every redirect, bounds stream size/time, and verifies pinned SHA-256
before installation. macOS verifies the expected Apple Developer ID publisher
on both the mounted and copied application bundle. The reviewed packages are
macOS 6.6.0 and Linux 6.4.2. Future unreviewed releases fail before installation
until the pins are reviewed and updated.

Frida native bindings can be installed with `npm run install:frida:verified`.
The manifest pins official Frida 17.23.2 release digests, exact sizes and URLs.
The helper checks HTTPS redirects and the complete archive before extracting
one exact regular native binding. Offline input is limited to the pinned size
and SHA-256, and the installer never runs upstream prebuild or make scripts.
Native code is loaded only when a Frida operation is later requested.

Optional Binwalk and Unblob installation no longer downloads and executes
unverified source or system packages. Assets with vendor digests are pinned and
verified; other source archives, wheels and packages require explicitly supplied
offline artifacts with independently trusted hashes. Missing or malformed
verification material stops before compilation or system installation. Follow
the submodules' own guides when preparing those inputs; the former unattended
online installer behavior is deliberately unavailable.

The optional JADX launcher requires a real SHA-256, admits official HTTPS release
URLs or a local regular file, and bounds downloaded bytes/time before running
a verified JAR. Its Gradle distribution also has a fixed vendor SHA-256.
The source checkout and a downloaded release JAR have distinct identities;
launcher verification does not claim reproducible equivalence of every JAR byte.

## Dependency repairs and limits

The development `qs` chain is overridden to 6.16.0. Binwalk and Unblob manifests
and frozen locks raise the affected compression, hash, RNG, PyO3, cryptography
and documentation/tooling packages to reviewed fixed releases. Development Git
metadata sources use immutable commit pins. No caller-provided system software
is automatically upgraded.

The reviewed npm production and development graph has no known npm-audit
vulnerabilities after the repair. The optional Cargo/Python/direct-Maven scan
has no returned vulnerability advisory groups in its resolved scope. A
`ttf-parser` maintenance notice remains in Binwalk's font backend: no compatible
maintained replacement was established, and disabling it would break entropy
chart rendering. It is an unmaintained notice rather than an identified exploit.

Validation includes package signatures/artifact hashes, locked resolver checks,
restricted Rust compile checks, tampering/redirect/installer regressions, and a
restricted static JavaScript CLI benchmark. It does not cover all external
extractors, OS/Nix package closures, unresolved Maven dependencies, published
Wakaru platform binaries or every optional provider at runtime. No claim of
complete malware absence or a standalone antivirus certification is made.

REA's active debugger, process and instrumentation capabilities still operate
with the caller's authority. Verified downloads and process ownership checks
do not turn those capabilities into an operating-system sandbox.
