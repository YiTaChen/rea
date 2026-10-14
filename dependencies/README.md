# Binwalk dependencies

`ubuntu.sh` installs the signed distribution packages and optional extractors. It
requires reviewed offline inputs **before it makes changes to the system**. The
scripts never fetch an unpinned Git branch, install an unpinned PyPI package, or
execute an unverified downloaded source archive/binary.

## Trusted offline inputs

Supply these environment variables when running `bash dependencies/ubuntu.sh`:

- `BINWALK_ARTIFACT_DIR`: a directory containing `dumpifs.tar.gz`, `lzfse.tar.gz`,
  `dmg2img.tar.gz`, `srec_151_src.zip`, and `7z2600-linux-x64.tar.xz` (amd64)
  or `7z2600-linux-arm64.tar.xz` (arm64).
- `BINWALK_ARTIFACT_SHA256_FILE`: an independently trusted SHA-256 manifest with
  one line per archive in the format `64_HEX_DIGEST  filename` (without `*`).
- `BINWALK_WHEELHOUSE`: a directory containing reviewed Python wheels.
- `BINWALK_PIP_REQUIREMENTS`: a complete requirements lock containing exact
  `package==version --hash=sha256:64_HEX_DIGEST` entries for every wheel dependency.
  Include `uefi_firmware`, `jefferson`, `ubi-reader`, `lz4`, `zstandard`,
  `python-lzo`, and `vmlinux-to-elf`, and their transitive dependencies. Backslash
  line continuations and comment-only lines are supported. URL, VCS, local path,
  editable and arbitrary pip-option entries are refused. `pip --no-index
  --require-hashes --only-binary :all:` verifies each wheel before installation.
  `--break-system-packages` is explicitly supplied for the original system-wide
  extractor installation on Ubuntu; pip ignores user configuration via `--isolated`.

Review the full immutable commit of each Git source snapshot, export it as a
single top-level directory in the corresponding `.tar.gz`, and obtain its digest
through an independently authenticated publisher channel or your reviewed build
process. S-record 1.51 and 7-Zip 26.00 did not provide a trustworthy published
SHA-256 in this review, so their automatic unverified downloads were removed.
Do not generate a new checksum from an unknown download and treat that as proof
of its origin. A caller-supplied checksum manifest is an explicit trust input.
If a required Python extractor provides only a source distribution, build and
review a wheel separately; this installer deliberately does not execute PyPI
build backends.

`src.sh` verifies all input archives, copies them into a private temporary
workspace, re-verifies the copies, then builds them. No build is attempted if an
archive/hash is missing or mismatched. `pip.sh --check` and `src.sh --check` check
inputs without installing or building.

Sasquatch is pinned to release `sasquatch-v4.5.1-6` and per-architecture SHA-256s
from the vendor's [GitHub release metadata](https://api.github.com/repos/onekey-sec/sasquatch/releases/tags/sasquatch-v4.5.1-6).
`curl` refuses HTTP/downgrade redirects and HTTP errors, limits redirects to five
and download size to at most 256 MiB (a subshell OS file-size limit also protects
older curl versions on chunked responses), and the package is verified
in a private directory before `dpkg` sees it. The supported Sasquatch architectures
are amd64, arm64 and armhf; the complete installer supports amd64 and arm64
  because these are the supported 7-Zip bundles.

## Docker builds

Place the same inputs in `dependencies/offline/artifacts/`, the trusted manifest
in `dependencies/offline/SHA256SUMS`, wheels in `dependencies/offline/wheels/`, and
the lock in `dependencies/offline/requirements.txt` in the build context. These
artifacts are operator-supplied inputs and should not be committed. Missing inputs
stop the build. The Rust 1.92.0 toolchain image is pinned to its official Docker
registry content digest, and Cargo uses `--locked`. No Rust install script is
piped to a shell. Distribution packages are still maintained through Ubuntu's
signed repository metadata.

## Offline regression tests

Run `python3 dependencies/test_verified_installers.py`. These tests use inert
local bytes and mocked network/system install tools; they do not download, build
or install extractors.
