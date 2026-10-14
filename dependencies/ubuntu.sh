#!/bin/bash
set -euo pipefail
umask 077
SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIRECTORY/verified-artifacts.sh"

# Preflight offline inputs before any package install or source execution.
bash "$SCRIPT_DIRECTORY/pip.sh" --check
bash "$SCRIPT_DIRECTORY/src.sh" --check
architecture=$(dpkg --print-architecture)
# GitHub's vendor release metadata supplies the immutable asset digests (v4.5.1-6).
case "$architecture" in
    amd64) sasquatch_sha256=efbc92bd27594e01211e1b582f105a463a0017360a0746a93de3f283906ade95 ;;
    arm64) sasquatch_sha256=28e57a4ff545da32a65c3e061ff8a51e5ebaa5d170985c49f0b3eef08923476e ;;
    armhf) sasquatch_sha256=29c721598df93dcdf3c876b61d9941764f40af8f0ec4f0f8ac3d2fe75b8f1c22 ;;
    *) echo "Unsupported Sasquatch architecture: $architecture" >&2; exit 1 ;;
esac

# Install dependencies from apt repository
DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install \
    p7zip-full \
    zstd \
    tar \
    unzip \
    sleuthkit \
    cabextract \
    curl \
    wget \
    git \
    lz4 \
    lzop \
    device-tree-compiler \
    unrar \
    unyaffs \
    python3-pip \
    build-essential \
    clang \
    liblzo2-dev \
    libucl-dev \
    liblz4-dev \
    libbz2-dev \
    zlib1g-dev \
    libfontconfig1-dev \
    liblzma-dev \
    libssl-dev

work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
download_verified "https://github.com/onekey-sec/sasquatch/releases/download/sasquatch-v4.5.1-6/sasquatch_1.0_${architecture}.deb" "$sasquatch_sha256" "$work_dir/sasquatch.deb"
dpkg -i "$work_dir/sasquatch.deb"
bash "$SCRIPT_DIRECTORY/pip.sh"
bash "$SCRIPT_DIRECTORY/src.sh"
