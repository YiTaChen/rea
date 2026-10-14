#!/bin/bash
# Shared integrity checks. Source this file; do not execute downloaded scripts.
set -euo pipefail

verify_offline_artifact() {
    local name="$1" expected path
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid artifact name" >&2; return 1; }
    [[ -n "${BINWALK_ARTIFACT_DIR:-}" && -d "$BINWALK_ARTIFACT_DIR" &&
       -n "${BINWALK_ARTIFACT_SHA256_FILE:-}" && -f "$BINWALK_ARTIFACT_SHA256_FILE" ]] || {
        echo "Supply BINWALK_ARTIFACT_DIR and an independently trusted BINWALK_ARTIFACT_SHA256_FILE; see dependencies/README.md." >&2
        return 1
    }
    path="$BINWALK_ARTIFACT_DIR/$name"
    [[ -f "$path" && ! -L "$path" ]] || { echo "Missing regular artifact: $name" >&2; return 1; }
    expected=$(awk -v name="$name" '$2 == name { print $1 }' "$BINWALK_ARTIFACT_SHA256_FILE")
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Missing, duplicate or invalid trusted SHA-256 for $name" >&2; return 1; }
    printf '%s  %s\n' "$expected" "$path" | sha256sum -c - > /dev/null || {
        echo "SHA-256 mismatch: $name" >&2; return 1
    }
}

download_verified() {
    local url="$1" expected="$2" dest="$3" tmp
    [[ "$url" == https://* && "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || {
        echo "A pinned HTTPS URL and SHA-256 are required" >&2; return 1
    }
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
