#!/bin/bash
# Install reviewed wheels only; pip must not fetch VCS refs or build source packages.
set -euo pipefail
SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${BINWALK_PIP_REQUIREMENTS:?Supply an independently reviewed hash-locked requirements file; see dependencies/README.md}"
: "${BINWALK_WHEELHOUSE:?Supply a local directory of reviewed wheels; see dependencies/README.md}"
python3 "$SCRIPT_DIRECTORY/validate-wheelhouse.py" "$BINWALK_PIP_REQUIREMENTS" "$BINWALK_WHEELHOUSE"
[[ "${1:-}" != --check ]] || exit 0
pip3 --isolated install --break-system-packages --no-index --find-links "$BINWALK_WHEELHOUSE" --require-hashes \
    --only-binary :all: --disable-pip-version-check -r "$BINWALK_PIP_REQUIREMENTS"
