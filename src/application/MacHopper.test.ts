import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  installMacHopper,
  macHopperInstallDisclosure,
  type MacHopperBundleVerification,
  type MacHopperInstallHost,
  type MacHopperRelease,
} from "./MacHopper.js";

class FakeMacHopperHost implements MacHopperInstallHost {
  readonly archive = new TextEncoder().encode("hopper-dmg");
  readonly release: MacHopperRelease = {
    filename:
      "https://www.hopperapp.com:443/downloader/public/Hopper-fixture.dmg",
    file_length: String(this.archive.byteLength),
    file_sha256: createHash("sha256").update(this.archive).digest("hex"),
  };
  metadataFilename = this.release.filename;
  downloaded: string[] = [];
  archiveOk = true;
  verification: MacHopperBundleVerification = "verified";
  existing = false;
  mountSucceeds = true;
  copySucceeds = true;
  launcherSucceeds = true;
  badArchive = false;
  unmounts = 0;
  cleanups = 0;
  installs = 0;
  opens = 0;
  replaces = false;

  download = (url: string) => {
    this.downloaded.push(url);
    return Promise.resolve(
      url.includes("files-api")
        ? {
            ok: true,
            bytes: new TextEncoder().encode(
              JSON.stringify({
                "OS X": {
                  filename: this.metadataFilename,
                  file_length: String(this.archive.byteLength),
                  // Even a metadata checksum matching malicious replacement
                  // bytes must not replace the independently pinned SHA-256.
                  file_hash: createHash("sha1")
                    .update(this.downloadedArchive())
                    .digest("hex"),
                },
              }),
            ),
          }
        : { ok: this.archiveOk, bytes: this.downloadedArchive() },
    );
  };
  downloadedArchive = () =>
    this.badArchive ? new TextEncoder().encode("evil!!-dmg") : this.archive;
  createTemporaryDirectory = () => Promise.resolve("/tmp/rea-hopper-test");
  createMountDirectory = () => Promise.resolve();
  writePackage = () => Promise.resolve();
  mount = () => Promise.resolve(this.mountSucceeds);
  unmount = () => {
    this.unmounts += 1;
    return Promise.resolve();
  };
  appBundle = () => Promise.resolve("/mounted/Hopper Disassembler.app");
  validBundle = () => Promise.resolve(this.verification);
  destinationExists = () => Promise.resolve(this.existing);
  installBundle = (
    _source: string,
    _destination: string,
    _stage: string,
    replaceExisting: boolean,
  ) => {
    this.installs += 1;
    this.replaces = replaceExisting;
    return Promise.resolve(this.copySucceeds);
  };
  launcherReady = () => Promise.resolve(this.launcherSucceeds);
  openApplication = () => {
    this.opens += 1;
    return Promise.resolve();
  };
  cleanup = () => {
    this.cleanups += 1;
    return Promise.resolve();
  };
  destination = () => "/home/user/Applications/Hopper Disassembler.app";
}

describe("macOS Hopper installation", () => {
  it("installs, verifies, opens, and cleans the official package", async () => {
    const host = new FakeMacHopperHost();
    await expect(
      installMacHopper({ release: host.release }, host),
    ).resolves.toEqual({
      status: "installed",
      launcherPath:
        "/home/user/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
    });
    expect(host.opens).toBe(1);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("rejects an integrity mismatch before mounting", async () => {
    const host = new FakeMacHopperHost();
    host.badArchive = true;
    await expect(
      installMacHopper({ release: host.release }, host),
    ).resolves.toEqual({
      status: "failed",
      reason: "integrity",
    });
    expect(host.unmounts).toBe(0);
    expect(host.cleanups).toBe(0);
  });

  it.each(["", "0".repeat(40)])(
    "refuses an unavailable or invalid trusted SHA-256 pin before downloading the archive",
    async (digest) => {
      const host = new FakeMacHopperHost();
      await expect(
        installMacHopper(
          { release: { ...host.release, file_sha256: digest } },
          host,
        ),
      ).resolves.toEqual({ status: "failed", reason: "release_metadata" });
      expect(host.downloaded).toHaveLength(1);
      expect(host.installs).toBe(0);
      expect(host.cleanups).toBe(0);
    },
  );

  it("classifies malformed release metadata without mounting or installation", async () => {
    const host = new FakeMacHopperHost();
    host.download = () =>
      Promise.resolve({
        ok: true,
        bytes: new TextEncoder().encode("not JSON"),
      });
    await expect(
      installMacHopper({ release: host.release }, host),
    ).resolves.toEqual({ status: "failed", reason: "release_metadata" });
    expect(host.installs).toBe(0);
    expect(host.cleanups).toBe(0);
  });

  it("refuses to overwrite an existing application", async () => {
    const host = new FakeMacHopperHost();
    host.existing = true;
    await expect(
      installMacHopper({ release: host.release }, host),
    ).resolves.toEqual({
      status: "failed",
      reason: "destination_exists",
    });
  });

  it("replaces the managed application when explicitly requested", async () => {
    const host = new FakeMacHopperHost();
    host.existing = true;

    await expect(
      installMacHopper({ replaceExisting: true, release: host.release }, host),
    ).resolves.toMatchObject({ status: "installed" });
    expect(host.replaces).toBe(true);
  });

  it("cleans and detaches after bundle validation fails", async () => {
    const host = new FakeMacHopperHost();
    host.verification = "invalid_signature";
    await expect(
      installMacHopper({ release: host.release }, host),
    ).resolves.toEqual({
      status: "failed",
      reason: "bundle",
    });
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("reports a publisher mismatch without copying or launching the bundle", async () => {
    const host = new FakeMacHopperHost();
    host.verification = "unverified_publisher";
    await expect(
      installMacHopper({ release: host.release }, host),
    ).resolves.toEqual({
      status: "failed",
      reason: "publisher_verification_failed",
    });
    expect(host.installs).toBe(0);
    expect(host.opens).toBe(0);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it.each([
    "https://www.hopperapp.com:443/downloader/public/Hopper-new-release.dmg",
    "https://attacker.test/downloader/public/Hopper-fixture.dmg",
    "http://www.hopperapp.com/downloader/public/Hopper-fixture.dmg",
  ])(
    "refuses an unpinned or foreign metadata URL before downloading %s",
    async (filename) => {
      const host = new FakeMacHopperHost();
      host.metadataFilename = filename;
      await expect(
        installMacHopper({ release: host.release }, host),
      ).resolves.toEqual({
        status: "failed",
        reason: "release_metadata",
      });
      expect(host.downloaded).toHaveLength(1);
      expect(host.installs).toBe(0);
      expect(host.cleanups).toBe(0);
    },
  );

  it("discloses the pinned artifact and SHA-256 instead of trusting the latest metadata hash", () => {
    expect(macHopperInstallDisclosure.downloadUrl).toContain(
      "Hopper-6.6.0-demo.dmg",
    );
    expect(macHopperInstallDisclosure.expectedSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });
});
