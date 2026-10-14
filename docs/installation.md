---
hide:
  - navigation
---

# Installation

Unblob consists of two main parts:

- unblob, the Python package.
- extractor command line tools like `7zip`, `unar`, etc. (See [Extractors](./extractors.md) for explanation.)

All of these need to be installed to make unblob fully functional.  
Depending the packaging solution you choose, you might need to
install external extractors manually.

## Python package

unblob can be installed (without the extractors) from PyPI (Python Package Index).  
This might be the easiest method, depending on whether you have Python 3 installed already.

1.  First, install the Python package:

        python3 -m pip install --user unblob

    This will install the `unblob` script in `~/.local/bin`. You can put that
    directory in your `PATH` environment variable, or call it directly.

    !!! Warning

        System-wide installation (with `sudo`) is not recommended, because it can potentially break your system.

2.  Make sure to [install extractors](#install-extractors).

3.  Check that everything works correctly:

        unblob --show-external-dependencies

## Kali Linux

If you're on Kali Linux, unblob is available through the [distribution
repository](https://www.kali.org/tools/unblob/). You can install it with:

```
apt install unblob
```

## Docker image

unblob can be used right away from a `docker` image: `ghcr.io/onekey-sec/unblob:latest`,
which contains everything needed to run unblob, even the [extractors](extractors.md).

The `--pull always` option is recommended, because the project is currently under heavy development, so we expect frequent changes.

The extracted files will be in the `/data/output` folder inside the container. Mount
your host directory where you want to see the extracted files there:

```console
docker run \
  --rm \
  --pull always \
  -v /path/to/extract-dir/on/host:/data/output \
  -v /path/to/files/on/host:/data/input \
ghcr.io/onekey-sec/unblob:latest /data/input/path/to/file
```

Help on usage:

```shell
docker run --rm --pull always ghcr.io/onekey-sec/unblob:latest --help
```

⚠️  When you bind mount directories from the host in the container using the `-v` option, you must
make sure that they are owned by the same `uid:gid` pair otherwise you'll get
into permission issues.

If you're on a multi-user Linux host (i.e. your $UID is > 1000), it's recommended you
launch the container this way to map the container user's UID to yours:

```console
docker run \
  --rm \
  --pull always \
  -u $UID:$GID
  -v /path/to/extract-dir/on/host:/data/output \
  -v /path/to/files/on/host:/data/input \
ghcr.io/onekey-sec/unblob:latest /data/input/path/to/file
```

## Nix package

You can install stable releases of unblob directly from nixpkgs using your preferred package installation method, e.g:

For a system-wide installation on [NixOS](https://nixos.org):

```nix
# configuration.nix

{ pkgs, ...}:

{
  environment.systemPackages = [ pkgs.unblob ];
}
```

For [home-manager](https://nix-community.github.io/home-manager/):

```nix
# home.nix

{ pkgs, ...}:

{
  home.packages = [ pkgs.unblob ];
}
```

Using `nix-env`:

```console
$ nix-env -iA nixpkgs.unblob
```

Or `nix profile`:
```console
$ nix profile install nixpkgs#unblob
```

Alternatively you can also install the latest version from git:

Using the provided overlay:

```nix
{
  nixpkgs.overlays = [
    (let
      unblob = import (builtins.fetchTarball {
        url = "https://github.com/onekey-sec/unblob/archive/main.tar.gz";
      });
    in
      "{unblob}/overlay.nix")
  ];

  environment.systemPackages = [ pkgs.unblob ]; # or `home.packages` for home-manager
}
```

You can use the provided flake as well:

```nix
{
  inputs.nixpkgs.url = "...";
  inputs.unblob.url = "github:onekey-sec/unblob";

  outputs = { nixpkgs, unblob, ...}: {
    nixosConfiguration.<my-host> = nixpkgs.lib.nixosSystem {
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = [ unblob.packages.${pkgs.system}.default ];
        })
      ];
    };
  };
}
```

For imperative package installation, follow these steps:

1.  _Optional_: enable the experimental features so that you don't need to pass  
    `--extra-experimental-features "nix-command flakes"` to `nix` command invocations:

          mkdir -p ~/.config/nix
          cat > ~/.config/nix/nix.conf <<EOF
          experimental-features = nix-command flakes
          EOF

1.  Install unblob:

        $ nix profile install github:onekey-sec/unblob
        do you want to allow configuration setting 'extra-substituters' to be set to 'https://unblob.cachix.org' (y/N)? y
        do you want to permanently mark this value as trusted (y/N)? y
        do you want to allow configuration setting 'extra-trusted-public-keys' to be set to
        'unblob.cachix.org-1:5kWA6DwOg176rSqU8TOTBXWxsDB4LoCMfGfTgL5qCAE=' (y/N)? y
        do you want to permanently mark this value as trusted (y/N)? y

    Using and trusting substituter (binary cache) and its public key is optional but greatly speeds up installation.

- Check that everything works correctly:

        unblob --show-external-dependencies

## From source

1.  Install [Git](https://git-scm.com/download/) if you don't have it yet.
2.  Install [uv](https://docs.astral.sh/uv/getting-started/installation/) Python package manager.
3.  **Clone** the unblob **repository from GitHub**:

        git clone https://github.com/onekey-sec/unblob.git

4.  Install **Python dependencies** with uv:

    1.  Python packages:

            cd unblob
            uv sync --no-dev

    2.  Make sure you [installed all extractors](#install-extractors).

    3.  Check that everything works correctly:

            uv run unblob --show-external-dependencies

## Install extractors

There is a handy `install-deps.sh` script included in the repository and PyPI packages that can be used to install the following dependencies.

1.  With your operating system package manager:  
    On Ubuntu 22.04, install extractors with APT:

        sudo apt install android-sdk-libsparse-utils e2fsprogs p7zip-full unar zlib1g-dev liblzo2-dev lzop lziprecover libhyperscan-dev zstd lz4

2. For **squashfs support** and the maintained e2fsprogs fork, use the verified
   `install-deps.sh` installer. It pins Sasquatch release `sasquatch-v4.5.1-6` and
   per-architecture SHA-256s from the vendor's
   [GitHub release metadata](https://api.github.com/repos/onekey-sec/sasquatch/releases/tags/sasquatch-v4.5.1-6).
   Its downloader accepts HTTPS only (including redirects), fails on HTTP errors,
   limits redirects to five and responses to at most 256 MiB with an OS file-size
   limit protecting older curl's chunked-body behavior, and verifies the package before
   `dpkg` runs.

3. The 7-Zip 26.00 and e2fsprogs `v1.47.0-3.ok2` release assets did not have
   trustworthy publisher-provided digests available in this review. Their
   automatic unverified downloads are disabled. Supply reviewed offline artifacts
   and an independently authenticated SHA-256 manifest before invoking the installer:

   - `UNBLOB_ARTIFACT_DIR` must contain `7z2600-linux-x64.tar.xz` on amd64, or
     `7z2600-linux-arm64.tar.xz` on arm64, plus the matching architecture's
     `libext2fs2_1.47.0-3.ok2_ARCH.deb`, `libss2_1.47.0-3.ok2_ARCH.deb` and
     `e2fsprogs_1.47.0-3.ok2_ARCH.deb`.
   - `UNBLOB_ARTIFACT_SHA256_FILE` must name a trusted manifest with one entry per
     artifact in the format `64_HEX_DIGEST  filename` (without `*`). Missing,
     duplicate or mismatched hashes stop installation before any package manager
     writes. These files are copied into a private workspace and re-verified
     before extraction/installation.
   - Acquire the hashes through an independently authenticated publisher channel
     or a reviewed packaging process. Computing a checksum from an unknown
     download does not authenticate its origin. The supplied manifest is an
     explicit trust input.

   Use `sh install-deps.sh --check` with those variables to validate inputs without
   installing. To build the Docker image, provide these same files and the manifest
   as `extractor-artifacts/SHA256SUMS` in its build context. No artifact bytes or
   generated checksum values are supplied by this source repository. Missing build
   inputs intentionally stop the image build. Supported architectures are amd64
   and arm64.

   Docker builds also require `python-wheelhouse/requirements.txt` and all reviewed
   runtime dependency wheels in `python-wheelhouse/`. Build the local project wheel
   with the audited frozen `uv.lock` and keep it in `dist/`. Prepare a complete,
   platform-specific lock from that frozen graph, with exact `package==version`
   entries and every wheel's `--hash=sha256:64_HEX_DIGEST`, including the locally
   built `unblob` wheel at the source project's exact version. Review any separately
   built wheels before admitting their hashes. This lock accepts no environment
   markers, URL/VCS/path dependencies or pip options; multiline hash entries and
   comment-only lines are accepted. Pip's offline `--require-hashes --only-binary
   :all:` resolver rejects missing unpinned transitives rather than downloading or
   building them. It never contacts PyPI during image installation. The supplied
   complete wheel lock and wheelhouse are explicit operator trust inputs.

   Offline installer regression tests can be run with
   `python3 tests/test_install_deps_security.py`; they mock all network and package
   tools and never install or extract third-party binaries.

   In case you already had e2fsprogs installed, you might need to upgrade some more packages from e2fsprogs.
   You can get the names of the installed e2fsprogs binary packages this way:

        sudo dpkg-query -W -f '${db:Status-Abbrev}\t${source:Package}\t${Package}\n' | grep '^i...e2fsprogs' | cut -f3
