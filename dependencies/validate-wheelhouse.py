#!/usr/bin/env python3
"""Reject network/VCS/build inputs before pip sees an offline hash-locked wheel set."""
import pathlib
import re
import sys

REQUIRED = {"uefi-firmware", "jefferson", "ubi-reader", "lz4", "zstandard", "python-lzo", "vmlinux-to-elf"}
LINE = re.compile(r"([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9_.+!-]*)(?:\s+--hash=sha256:[a-fA-F0-9]{64})+")


def validate(requirements, wheelhouse):
    path = pathlib.Path(requirements)
    wheels = pathlib.Path(wheelhouse)
    if not path.is_file() or not wheels.is_dir() or not any(wheels.glob("*.whl")):
        raise ValueError("Supply a hash-locked requirements file and a local wheelhouse containing reviewed wheels")
    names = set()
    content = path.read_text().replace("\\\n", " ")
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = LINE.fullmatch(line)
        if not match:
            raise ValueError("Only exact package==version entries with SHA-256 hashes are permitted; no URL, VCS, path or pip options")
        names.add(re.sub(r"[-_.]+", "-", match[1]).lower())
    if not REQUIRED <= names:
        raise ValueError("The lock must include every extractor and all its dependencies; missing " + ", ".join(sorted(REQUIRED - names)))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("usage: validate-wheelhouse.py REQUIREMENTS WHEELHOUSE")
        validate(*sys.argv[1:])
    except (OSError, ValueError) as exc:
        sys.exit(str(exc))
