#!/usr/bin/env python3
"""Standalone offline installer checks; does not import or execute unblob/extractors."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import importlib.util
import sys
sys.dont_write_bytecode = True

INSTALLER = Path(__file__).resolve().parents[1] / "install-deps.sh"


class InstallDepsSecurityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        self.log = self.dir / "calls"
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"], CALL_LOG=str(self.log))
        self.write_tool("dpkg", '''if [ "$1" = --print-architecture ]; then printf 'amd64\n'; else printf '%s\n' "dpkg $*" >> "$CALL_LOG"; exit 99; fi
''')
        if not shutil.which("sha256sum"):
            self.write_tool("sha256sum", '''exec python3 -c 'import hashlib,sys; h,p=sys.stdin.readline().rstrip("\\n").split("  ",1); sys.exit(0 if hashlib.sha256(open(p,"rb").read()).hexdigest()==h.lower() else 1)'\n''')
        self.write_tool("apt-get", 'printf "%s\\n" "apt-get $*" >> "$CALL_LOG"\n')
        for name in ("tar", "install", "ln"):
            self.write_tool(name, 'printf "%s\\n" "' + name + ' $*" >> "$CALL_LOG"\nexit 99\n')
        self.write_tool("curl", '''printf '%s\n' "curl $*" >> "$CALL_LOG"
while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then shift; output=$1; fi
    shift
done
printf 'inert test download' > "$output"
''')

    def tearDown(self):
        self.temp.cleanup()

    def write_tool(self, name, body):
        p = self.bin / name
        p.write_text("#!/bin/sh\n" + body)
        p.chmod(0o755)

    def inputs(self):
        artifacts = self.dir / "artifacts"
        artifacts.mkdir()
        names = ("7z2600-linux-x64.tar.xz", "libext2fs2_1.47.0-3.ok2_amd64.deb", "libss2_1.47.0-3.ok2_amd64.deb", "e2fsprogs_1.47.0-3.ok2_amd64.deb")
        lines = []
        for name in names:
            content = ("inert " + name).encode()
            (artifacts / name).write_bytes(content)
            lines.append(hashlib.sha256(content).hexdigest() + "  " + name)
        manifest = self.dir / "SHA256SUMS"
        manifest.write_text("\n".join(lines) + "\n")
        self.env.update(UNBLOB_ARTIFACT_DIR=str(artifacts), UNBLOB_ARTIFACT_SHA256_FILE=str(manifest))
        return artifacts, manifest

    def run_installer(self, *args):
        return subprocess.run(["sh", str(INSTALLER), *args], env=self.env, capture_output=True)

    def test_missing_inputs_stop_before_package_manager(self):
        r = self.run_installer()
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_valid_offline_preflight_does_not_install_or_download(self):
        self.inputs()
        r = self.run_installer("--check")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.log.exists())

    def test_tampered_offline_package_stops_before_package_manager(self):
        artifacts, _ = self.inputs()
        (artifacts / "libss2_1.47.0-3.ok2_amd64.deb").write_bytes(b"tampered")
        r = self.run_installer()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"SHA-256 mismatch", r.stderr)
        self.assertFalse(self.log.exists())

    def test_duplicate_hash_and_symlink_are_refused(self):
        artifacts, manifest = self.inputs()
        manifest.write_text(manifest.read_text() + manifest.read_text().splitlines()[0] + "\n")
        r = self.run_installer("--check")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.log.exists())
        manifest.write_text("\n".join(manifest.read_text().splitlines()[:-1]) + "\n")
        artifact = artifacts / "7z2600-linux-x64.tar.xz"
        original = self.dir / "original"
        artifact.rename(original)
        artifact.symlink_to(original)
        r = self.run_installer("--check")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_docker_wheel_lock_refuses_unpinned_network_and_wrong_project(self):
        project_root = INSTALLER.parent
        spec = importlib.util.spec_from_file_location("wheelcheck", project_root / "scripts/validate-wheelhouse.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        wheelhouse = self.dir / "wheels"
        wheelhouse.mkdir()
        (wheelhouse / "inert.whl").write_bytes(b"inert")
        lock = wheelhouse / "requirements.txt"
        version = module.tomllib.loads((project_root / "pyproject.toml").read_text())["project"]["version"]
        valid = "unblob==" + version + " --hash=sha256:" + "0" * 64
        lock.write_text(valid)
        module.validate(lock, wheelhouse, project_root / "pyproject.toml")
        for bad in ("payload @ https://example.invalid/payload.whl", "--extra-index-url https://example.invalid", "dependency>=1", "-r external.txt"):
            lock.write_text(valid + "\n" + bad)
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.validate(lock, wheelhouse, project_root / "pyproject.toml")
        lock.write_text("unblob==0.0.0 --hash=sha256:" + "0" * 64)
        with self.assertRaises(ValueError):
            module.validate(lock, wheelhouse, project_root / "pyproject.toml")

    def test_bad_network_digest_stops_before_tar_and_dpkg(self):
        self.inputs()
        r = self.run_installer()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"SHA-256 mismatch", r.stderr)
        log = self.log.read_text()
        self.assertIn("curl", log)
        self.assertIn("--fail", log)
        self.assertIn("--proto =https --proto-redir =https", log)
        self.assertIn("--max-filesize 268435456", log)
        self.assertIn("--max-redirs 5", log)
        self.assertNotIn("tar ", log)
        self.assertNotIn("dpkg -i", log)
        self.assertFalse(any(line.startswith("install ") for line in log.splitlines()))


if __name__ == "__main__":
    unittest.main()
