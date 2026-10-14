#!/bin/bash
# Build only operator-supplied, reviewed source archives with trusted hashes.
set -euo pipefail
umask 077
SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIRECTORY/verified-artifacts.sh"

case "$(dpkg --print-architecture)" in
    amd64) sevenzip_arch=x64 ;;
    arm64) sevenzip_arch=arm64 ;;
    *) echo "Unsupported 7-Zip architecture" >&2; exit 1 ;;
esac
sevenzip_archive="7z2600-linux-${sevenzip_arch}.tar.xz"
artifacts=(dumpifs.tar.gz lzfse.tar.gz dmg2img.tar.gz srec_151_src.zip "$sevenzip_archive")
for artifact in "${artifacts[@]}"; do verify_offline_artifact "$artifact"; done
[[ "${1:-}" != --check ]] || exit 0

# A private working directory prevents collisions with attacker-created /tmp paths.
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
mkdir "$work_dir/artifacts"
for artifact in "${artifacts[@]}"; do cp -- "$BINWALK_ARTIFACT_DIR/$artifact" "$work_dir/artifacts/$artifact"; done
BINWALK_ARTIFACT_DIR="$work_dir/artifacts"
for artifact in "${artifacts[@]}"; do verify_offline_artifact "$artifact"; done
for name in dumpifs lzfse dmg2img; do
    mkdir "$work_dir/$name"
    tar -xzf "$BINWALK_ARTIFACT_DIR/$name.tar.gz" --strip-components=1 -C "$work_dir/$name"
done
(cd "$work_dir/dumpifs" && make dumpifs && install -m 0755 dumpifs /usr/local/bin/dumpifs)
(cd "$work_dir/lzfse" && make install)
(cd "$work_dir/dmg2img" && make dmg2img HAVE_LZFSE=1 && make install)
mkdir "$work_dir/srec"
(cd "$work_dir/srec" && unzip -q "$BINWALK_ARTIFACT_DIR/srec_151_src.zip" && make && install -m 0755 srec2bin /usr/local/bin/srec2bin)
mkdir "$work_dir/7z"
tar -xf "$BINWALK_ARTIFACT_DIR/${sevenzip_archive}" -C "$work_dir/7z" 7zzs
install -m 0755 "$work_dir/7z/7zzs" /usr/local/bin/7zzs
