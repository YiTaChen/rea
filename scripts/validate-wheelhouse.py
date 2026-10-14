#!/usr/bin/env python3
"""Accept only exact, SHA-256-locked offline wheel requirements for Docker installation."""
from pathlib import Path
import re
import sys
import tomllib

LINE = re.compile(r"([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9_.+!-]*)(?:\s+--hash=sha256:[a-fA-F0-9]{64})+")


def validate(requirements, wheelhouse, project_file):
    path, wheels = Path(requirements), Path(wheelhouse)
    project = tomllib.loads(Path(project_file).read_text())["project"]
    if not path.is_file() or not wheels.is_dir() or not any(wheels.glob("*.whl")):
        raise ValueError("Supply reviewed wheels and a complete platform-specific hash-locked requirements.txt")
    packages = {}
    content = path.read_text().replace("\\\n", " ")
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = LINE.fullmatch(line)
        if not match:
            raise ValueError("Only exact package==version entries with SHA-256 hashes are permitted; no URL, VCS, path, markers or pip options")
        name = re.sub(r"[-_.]+", "-", match[1]).lower()
        if name in packages:
            raise ValueError("Duplicate requirement: " + name)
        packages[name] = match[2]
    required = re.sub(r"[-_.]+", "-", project["name"]).lower()
    if packages.get(required) != project["version"]:
        raise ValueError("The lock must include the locally built project wheel at its exact source version")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 4:
            raise ValueError("usage: validate-wheelhouse.py REQUIREMENTS WHEELHOUSE PYPROJECT")
        validate(*sys.argv[1:])
    except (OSError, ValueError) as exc:
        sys.exit(str(exc))
