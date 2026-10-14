#!/bin/sh
# Third-party extractors are installed only after their bytes pass trusted SHA-256 checks.
set -eu
umask 077

verify_offline_artifact() {
    name=$1
    case "$name" in *[!A-Za-z0-9._-]*|'') echo "Invalid artifact name" >&2; return 1 ;; esac
    if [ -z "${UNBLOB_ARTIFACT_DIR:-}" ] || [ ! -d "$UNBLOB_ARTIFACT_DIR" ] ||
       [ -z "${UNBLOB_ARTIFACT_SHA256_FILE:-}" ] || [ ! -f "$UNBLOB_ARTIFACT_SHA256_FILE" ]; then
        echo "Supply UNBLOB_ARTIFACT_DIR and an independently trusted UNBLOB_ARTIFACT_SHA256_FILE; see docs/installation.md." >&2
        return 1
    fi
    artifact_path="$UNBLOB_ARTIFACT_DIR/$name"
    if [ ! -f "$artifact_path" ] || [ -L "$artifact_path" ]; then
        echo "Missing regular artifact: $name" >&2; return 1
    fi
    expected=$(awk -v name="$name" '$2 == name { print $1 }' "$UNBLOB_ARTIFACT_SHA256_FILE")
    if ! printf '%s\n' "$expected" | LC_ALL=C grep -Eq '^[0-9a-fA-F]{64}$' || [ "${#expected}" -ne 64 ]; then
        echo "Missing, duplicate or invalid trusted SHA-256 for $name" >&2; return 1
    fi
    if ! printf '%s  %s\n' "$expected" "$artifact_path" | sha256sum -c - > /dev/null; then
        echo "SHA-256 mismatch: $name" >&2; return 1
    fi
}

download_verified() {
    url=$1 expected=$2 dest=$3
    case "$url" in https://*) ;; *) echo "HTTPS URL required" >&2; return 1 ;; esac
    if ! printf '%s\n' "$expected" | LC_ALL=C grep -Eq '^[0-9a-fA-F]{64}$' || [ "${#expected}" -ne 64 ]; then
        echo "Pinned SHA-256 required" >&2; return 1
    fi
    tmp=$(mktemp "${dest}.XXXXXX")
    # Older curl (for example Debian bookworm's 7.88) may ignore max-filesize
    # on chunked responses. An OS file-size limit also bounds unknown-length bodies.
    # Shell units vary (512/1024 bytes); 262144 units allow at most 256 MiB.
    if ! (ulimit -f 262144 || exit 1
        curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
        --tlsv1.2 --connect-timeout 30 --max-time 600 --max-redirs 5 --max-filesize 268435456 --output "$tmp" "$url"); then
        rm -f "$tmp"; return 1
    fi
    if ! printf '%s  %s\n' "$expected" "$tmp" | sha256sum -c - > /dev/null; then
        echo "SHA-256 mismatch: $url" >&2; rm -f "$tmp"; return 1
    fi
    mv "$tmp" "$dest"
}

architecture=$(dpkg --print-architecture)
# Digests are pinned from the vendor's GitHub release metadata for v4.5.1-6.
case "$architecture" in
    amd64)
        sevenzip_arch=x64
        sasquatch_sha256=efbc92bd27594e01211e1b582f105a463a0017360a0746a93de3f283906ade95 ;;
    arm64)
        sevenzip_arch=arm64
        sasquatch_sha256=28e57a4ff545da32a65c3e061ff8a51e5ebaa5d170985c49f0b3eef08923476e ;;
    *) echo "Unsupported extractor architecture: $architecture" >&2; exit 1 ;;
esac

# No trustworthy publisher digests were available for these releases. Require
# operator-supplied artifacts and hashes obtained independently from trusted publishers.
verify_offline_artifact "7z2600-linux-${sevenzip_arch}.tar.xz"
for package in libext2fs2 libss2 e2fsprogs; do
    verify_offline_artifact "${package}_1.47.0-3.ok2_${architecture}.deb"
done
[ "${1:-}" != --check ] || exit 0

work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT HUP INT TERM
mkdir "$work_dir/offline"
cp "$UNBLOB_ARTIFACT_DIR/7z2600-linux-${sevenzip_arch}.tar.xz" "$work_dir/offline/"
for package in libext2fs2 libss2 e2fsprogs; do
    cp "$UNBLOB_ARTIFACT_DIR/${package}_1.47.0-3.ok2_${architecture}.deb" "$work_dir/offline/"
done
UNBLOB_ARTIFACT_DIR="$work_dir/offline"
verify_offline_artifact "7z2600-linux-${sevenzip_arch}.tar.xz"
for package in libext2fs2 libss2 e2fsprogs; do
    verify_offline_artifact "${package}_1.47.0-3.ok2_${architecture}.deb"
done

apt-get update
apt-get install --no-install-recommends -y \
    android-sdk-libsparse-utils curl erofs-utils lz4 lziprecover lzop \
    partclone unar upx xz-utils libmagic1 zstd

download_verified "https://github.com/onekey-sec/sasquatch/releases/download/sasquatch-v4.5.1-6/sasquatch_1.0_${architecture}.deb" "$sasquatch_sha256" "$work_dir/sasquatch.deb"
# Every offline artifact was verified before any archive extraction or dpkg call.
mkdir "$work_dir/7zip"
tar -xf "$UNBLOB_ARTIFACT_DIR/7z2600-linux-${sevenzip_arch}.tar.xz" -C "$work_dir/7zip" 7zz 7zzs
install -d /usr/local/bin
install -m 0755 "$work_dir/7zip/7zz" "$work_dir/7zip/7zzs" /usr/local/bin/
ln -sf /usr/local/bin/7zz /usr/local/bin/7z
dpkg -i "$work_dir/sasquatch.deb"
dpkg -i "$UNBLOB_ARTIFACT_DIR/libext2fs2_1.47.0-3.ok2_${architecture}.deb" "$UNBLOB_ARTIFACT_DIR/libss2_1.47.0-3.ok2_${architecture}.deb"
dpkg -i "$UNBLOB_ARTIFACT_DIR/e2fsprogs_1.47.0-3.ok2_${architecture}.deb"
