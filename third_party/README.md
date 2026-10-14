# Upstream analysis engines

REA integrates existing tools through provider adapters. Optional source retains its upstream license and is not copied into REA's domain
or application code. This fork applies dependency and installer verification
patches to three pinned submodules; the source histories are available in the
same repository under `vendor/*-security-2026-10-14` branches.

## jadx-headless-mcp

- Source: <https://github.com/1013503897/jadx-headless-mcp>
- Submodule: `third_party/jadx-headless-mcp`
- Release: `v0.7.1`
- Commit: `dac72c40f602115d6ce3293d4d91663546ad1b4a`
- License: Apache-2.0; see the submodule's `LICENSE`.
- Release identity: `src/android/JadxRelease.ts`.
- REA integration: `src/android/`; launcher and Gradle download verification patches
  in this source fork. The original upstream revision was
  `5844800a486d2248fa949b74c9896285f5b54de2`.

Fetch source for inspection with:

```sh
git submodule update --init third_party/jadx-headless-mcp
```

Normal REA builds and installed npm packages do not require this submodule or a
Gradle build. Supply a separately obtained JAR with `REA_JADX_MCP_JAR`; REA never
downloads engines during an analysis operation. The audited release JAR is
identified by SHA-256. A caller-supplied build reporting the supported protocol
version retains its actual digest and an unknown source revision unless its
bytes match the audited release.

When updating: review upstream protocol and license changes, update the gitlink
and release identity together, exercise the adapter's producer regressions, and
run the real APK CLI/MCP lane. Never attribute modified engine bytes to the
audited source revision.

## Public APK fixture

`npm run fixtures:android` (`scripts/fixtures/android/fetch.mjs`) downloads the audited engine and
Appium ApiDemos v6.0.18 into ignored `_reference/apk-integration/`. Both downloads
are checked against fixed SHA-256 values. Fixture provenance is recorded in
`scripts/fixtures/android-apidemos.json`; the source uses Apache-2.0. This is a
static analysis fixture: no emulator, device, SDK installation or app execution
is needed. APKs and JARs are neither tracked nor included in npm packages.

## Firmware engines

| Engine | Source | Release | Pinned commit | License |
| --- | --- | --- | --- | --- |
| Binwalk | <https://github.com/ReFirmLabs/binwalk> | v3.1.0 | `b7894e029642adaf67f7b1c244a26325ea433579` | MIT, upstream `LICENSE` |
| Unblob | <https://github.com/onekey-sec/unblob> | 26.6.4 | `cbe989c04c1c45440ec16e696ee7ce18df7d7724` | MIT, upstream `LICENSE` |

Patched sources are pinned in `third_party/binwalk` and `third_party/unblob`.
Their original upstream revisions are Binwalk
`4fdab3d464d97b68e0af9088df3f9e2e1545b21c` and Unblob
`1fcc7a0a584a70a96c31f5a276c20944d199a089`. The patched revisions above
include dependency locks and verified/offline installer changes; they are not
byte-identical to the original upstream releases.
Release records live in `src/firmware/FirmwareRelease.ts`; REA adapters own the
CLI/report interpretation and lifecycle in `src/firmware/`. Caller-supplied
executables retain their actual launcher digest and unknown source revision;
version output alone does not establish source identity. REA does not bundle
extractors or download/install firmware engines during analysis.

On updates: inspect actual pinned CLI and report producers, preserve licenses,
update gitlinks/release records, run report regressions and the real firmware
lane. See [firmware setup and coverage](../docs/firmware-analysis.md).
