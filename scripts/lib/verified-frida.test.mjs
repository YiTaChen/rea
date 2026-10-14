import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  downloadVerifiedFrida,
  fridaBindingFromArchive,
  verifyFridaArchive,
  readVerifiedFridaArchive,
} from "./verified-frida.mjs";

const archive = (name = "build/frida_binding.node", type = "0") => {
  const content = Buffer.from("inert native binding test data");
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
  header.fill(32, 148, 156);
  header.write(type, 156);
  const sum = [...header].reduce((total, value) => total + value, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(
    Buffer.concat([
      header,
      content,
      Buffer.alloc(512 - content.length),
      Buffer.alloc(1024),
    ]),
  );
};
const identity = (bytes) => ({
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  url: "https://github.com/frida/frida/releases/download/17.23.2/test.tar.gz",
});

test("accepts matching bytes and extracts only the intended inert binding", () => {
  const bytes = archive();
  assert.equal(verifyFridaArchive(bytes, identity(bytes)), bytes);
  assert.equal(
    fridaBindingFromArchive(bytes).toString(),
    "inert native binding test data",
  );
});

test("rejects altered or truncated bytes before extraction", () => {
  const bytes = archive();
  const altered = Buffer.from(bytes);
  altered[15] ^= 1;
  assert.throws(() => verifyFridaArchive(altered, identity(bytes)), /SHA-256/u);
  assert.throws(
    () =>
      verifyFridaArchive(bytes.subarray(0, bytes.length - 1), identity(bytes)),
    /size/u,
  );
});

test("offline input is size-bounded, regular and hash-verified before extraction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-frida-read-"));
  try {
    const bytes = archive();
    const path = join(directory, "release.tar.gz");
    await writeFile(path, bytes);
    assert.deepEqual(
      await readVerifiedFridaArchive(path, identity(bytes)),
      bytes,
    );
    await assert.rejects(
      readVerifiedFridaArchive(directory, identity(bytes)),
      /regular file/u,
    );
    await assert.rejects(
      readVerifiedFridaArchive(path, {
        ...identity(bytes),
        bytes: bytes.length - 1,
      }),
      /pinned size/u,
    );
    await assert.rejects(
      readVerifiedFridaArchive(path, {
        ...identity(bytes),
        sha256: "0".repeat(64),
      }),
      /SHA-256/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline installer writes only verified inert data and preserves it after tampering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-frida-installer-"));
  try {
    await mkdir(join(directory, "scripts/lib"), { recursive: true });
    await mkdir(join(directory, "third_party/frida"), { recursive: true });
    await mkdir(join(directory, "node_modules/frida/build"), {
      recursive: true,
    });
    await copyFile(
      new URL("../install-verified-frida.mjs", import.meta.url),
      join(directory, "scripts/install-verified-frida.mjs"),
    );
    await copyFile(
      new URL("./verified-frida.mjs", import.meta.url),
      join(directory, "scripts/lib/verified-frida.mjs"),
    );
    const bytes = archive();
    const target = `${process.platform}-${process.arch}`;
    await writeFile(
      join(directory, "third_party/frida/verified-artifacts.json"),
      JSON.stringify({
        version: "17.23.2",
        napi: 8,
        artifacts: { [target]: identity(bytes) },
      }),
    );
    await writeFile(
      join(directory, "node_modules/frida/package.json"),
      JSON.stringify({ name: "frida", version: "17.23.2" }),
    );
    const path = join(directory, "release.tar.gz");
    await writeFile(path, bytes);
    const invoke = () =>
      promisify(execFile)(
        process.execPath,
        [
          join(directory, "scripts/install-verified-frida.mjs"),
          "--archive",
          path,
        ],
        { env: {}, timeout: 10_000 },
      );
    await invoke();
    const destination = join(
      directory,
      "node_modules/frida/build/frida_binding.node",
    );
    assert.equal(
      (await readFile(destination)).toString(),
      "inert native binding test data",
    );
    const altered = Buffer.from(bytes);
    altered[15] ^= 1;
    await writeFile(path, altered);
    await assert.rejects(invoke(), /SHA-256/u);
    assert.equal(
      (await readFile(destination)).toString(),
      "inert native binding test data",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects traversal paths, links, extra entries and truncated tar", () => {
  for (const [name, type] of [
    ["../frida_binding.node", "0"],
    ["build/frida_binding.node", "2"],
    ["other.node", "0"],
  ])
    assert.throws(
      () => fridaBindingFromArchive(archive(name, type)),
      /exact regular/u,
    );
  const concatenated = Buffer.concat([archive(), archive()]);
  assert.throws(() => fridaBindingFromArchive(concatenated), /end marker/u);
  assert.throws(
    () => fridaBindingFromArchive(gzipSync(Buffer.alloc(10))),
    /missing/u,
  );
});

test("permits timestamp-only PAX headers and rejects metadata path overrides", () => {
  const regular = gunzipSync(archive());
  const pax = (record) => {
    const header = Buffer.alloc(512);
    header.write("././@PaxHeader");
    header.write(record.length.toString(8).padStart(11, "0") + "\0", 124);
    header.fill(32, 148, 156);
    header.write("x", 156);
    const sum = [...header].reduce((total, value) => total + value, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return gzipSync(
      Buffer.concat([
        header,
        Buffer.from(record),
        Buffer.alloc(512 - record.length),
        regular,
      ]),
    );
  };
  assert.equal(
    fridaBindingFromArchive(pax("27 mtime=1791552498.954624\n")).toString(),
    "inert native binding test data",
  );
  assert.throws(
    () => fridaBindingFromArchive(pax("27 path=../../malicious.js\n")),
    /timestamps|length/u,
  );
});

test("permits a vendor HTTPS CDN redirect and verifies the body", async () => {
  const bytes = archive();
  const urls = [];
  const result = await downloadVerifiedFrida(
    identity(bytes),
    async (url, options) => {
      urls.push(String(url));
      assert.equal(options.redirect, "manual");
      return urls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                "https://release-assets.githubusercontent.com/reviewed-file",
            },
          })
        : new Response(bytes);
    },
  );
  assert.deepEqual(result, bytes);
  assert.equal(urls.length, 2);
});

test("blocks HTTP, external origins and embedded credentials before following redirects", async () => {
  const bytes = archive();
  for (const location of [
    "http://github.com/file",
    "https://attacker.example/file",
    "https://token@github.com/file",
  ])
    await assert.rejects(
      downloadVerifiedFrida(
        identity(bytes),
        async () => new Response(null, { status: 302, headers: { location } }),
      ),
      /approved HTTPS/u,
    );
});

test("rejects bad status, redirect loops, oversize and wrong digest", async () => {
  const bytes = archive();
  await assert.rejects(
    downloadVerifiedFrida(
      identity(bytes),
      async () => new Response(null, { status: 404 }),
    ),
    /failed/u,
  );
  await assert.rejects(
    downloadVerifiedFrida(
      identity(bytes),
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "/frida/frida/releases/download/17.23.2/loop" },
        }),
    ),
    /excessive/u,
  );
  await assert.rejects(
    downloadVerifiedFrida(
      { ...identity(bytes), bytes: bytes.length - 1 },
      async () => new Response(bytes),
    ),
    /byte count/u,
  );
  await assert.rejects(
    downloadVerifiedFrida(
      { ...identity(bytes), sha256: "0".repeat(64) },
      async () => new Response(bytes),
    ),
    /SHA-256/u,
  );
});
