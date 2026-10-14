#!/usr/bin/env python3
"""Offline security regression: inert bytes, mocked networking/install commands."""
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent


class VerifiedInstallersTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        self.log = self.dir / "calls"
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"], CALL_LOG=str(self.log))
        self.write_tool("dpkg", 'printf "amd64\\n"\n')
        # Use the stdlib hash implementation when GNU sha256sum is not installed.
        if not shutil.which("sha256sum"):
            self.write_tool("sha256sum", '''exec python3 -c 'import hashlib,sys; h,p=sys.stdin.readline().rstrip("\\n").split("  ",1); sys.exit(0 if hashlib.sha256(open(p,"rb").read()).hexdigest()==h.lower() else 1)'\n''')
        for name in ("apt-get", "tar", "unzip", "make", "install", "pip3"):
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

    def run_shell(self, body):
        return subprocess.run(["bash", "-c", body], env=self.env, capture_output=True, text=True)

    def offline_inputs(self):
        artifacts = self.dir / "artifacts"
        artifacts.mkdir()
        names = ("dumpifs.tar.gz", "lzfse.tar.gz", "dmg2img.tar.gz", "srec_151_src.zip", "7z2600-linux-x64.tar.xz")
        lines = []
        for name in names:
            content = ("inert " + name).encode()
            (artifacts / name).write_bytes(content)
            lines.append(hashlib.sha256(content).hexdigest() + "  " + name)
        manifest = self.dir / "SHA256SUMS"
        manifest.write_text("\n".join(lines) + "\n")
        self.env.update(BINWALK_ARTIFACT_DIR=str(artifacts), BINWALK_ARTIFACT_SHA256_FILE=str(manifest))
        return artifacts, manifest

    def test_source_preflight_accepts_matching_hashes_without_execution(self):
        self.offline_inputs()
        r = subprocess.run(["bash", str(ROOT / "src.sh"), "--check"], env=self.env, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.log.exists())

    def test_source_mismatch_stops_before_build_or_install(self):
        artifacts, _ = self.offline_inputs()
        (artifacts / "srec_151_src.zip").write_bytes(b"tampered")
        r = subprocess.run(["bash", str(ROOT / "src.sh")], env=self.env, capture_output=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"SHA-256 mismatch", r.stderr)
        self.assertFalse(self.log.exists())

    def test_duplicate_digest_is_refused(self):
        _, manifest = self.offline_inputs()
        manifest.write_text(manifest.read_text() + manifest.read_text().splitlines()[0] + "\n")
        r = subprocess.run(["bash", str(ROOT / "src.sh"), "--check"], env=self.env, capture_output=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_missing_offline_inputs_stops_before_apt(self):
        r = subprocess.run(["bash", str(ROOT / "ubuntu.sh")], env=self.env, capture_output=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_download_mismatch_keeps_existing_destination_and_cleans_temp(self):
        dest = self.dir / "artifact.deb"
        dest.write_bytes(b"original")
        r = self.run_shell('source "' + str(ROOT / "verified-artifacts.sh") + '"; download_verified https://example.invalid/pinned.deb ' + '0' * 64 + ' "' + str(dest) + '"')
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(dest.read_bytes(), b"original")
        self.assertEqual(list(self.dir.glob("artifact.deb.*")), [])
        self.assertIn("--proto =https --proto-redir =https", self.log.read_text())
        self.assertIn("--fail", self.log.read_text())
        self.assertIn("--max-filesize 268435456", self.log.read_text())
        self.assertIn("--max-redirs 5", self.log.read_text())

    def test_download_valid_digest_promotes_exact_bytes(self):
        dest = self.dir / "artifact.deb"
        payload = b"inert test download"
        expected = hashlib.sha256(payload).hexdigest()
        r = self.run_shell('source "' + str(ROOT / "verified-artifacts.sh") + '"; download_verified https://example.invalid/pinned.deb ' + expected + ' "' + str(dest) + '"')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(dest.read_bytes(), payload)
        self.assertEqual(list(self.dir.glob("artifact.deb.*")), [])

    def test_http_is_refused_before_network(self):
        dest = self.dir / "artifact.deb"
        r = self.run_shell('source "' + str(ROOT / "verified-artifacts.sh") + '"; download_verified http://example.invalid/pinned.deb ' + '0' * 64 + ' "' + str(dest) + '"')
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.log.exists())
        self.assertFalse(dest.exists())

    def test_hash_locked_offline_wheel_set_is_accepted(self):
        spec = importlib.util.spec_from_file_location("wheelcheck", ROOT / "validate-wheelhouse.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        wheelhouse = self.dir / "wheels"
        wheelhouse.mkdir()
        (wheelhouse / "inert.whl").write_bytes(b"inert")
        lock = self.dir / "requirements.txt"
        valid = "\n".join(name + "==1.0 --hash=sha256:" + "0" * 64 for name in sorted(module.REQUIRED))
        lock.write_text(valid)
        module.validate(lock, wheelhouse)
        for bad in ("malicious @ https://example.invalid/payload.whl", "--extra-index-url https://example.invalid", "-r elsewhere.txt", "malicious==1.0", "git+https://example.invalid/repo"):
            lock.write_text(valid + "\n" + bad)
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.validate(lock, wheelhouse)


if __name__ == "__main__":
    unittest.main()
