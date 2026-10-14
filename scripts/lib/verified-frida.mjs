import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { open } from "node:fs/promises";
import { constants } from "node:fs";

const ALLOWED_ORIGINS = new Set([
  "https://github.com",
  "https://release-assets.githubusercontent.com",
]);
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

const checkedUrl = (value) => {
  const url = new URL(value);
  if (!ALLOWED_ORIGINS.has(url.origin) || url.username || url.password)
    throw new Error(
      "Frida download must stay on approved HTTPS release origins",
    );
  return url;
};

/** Download only a reviewed release asset; redirects and stream size are bounded. */
export const downloadVerifiedFrida = async (artifact, fetcher = fetch) => {
  if (
    !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    artifact.bytes > 128 * 1024 * 1024
  )
    throw new Error("Invalid pinned Frida artifact identity");
  let url = checkedUrl(artifact.url);
  if (
    url.origin !== "https://github.com" ||
    !url.pathname.startsWith("/frida/frida/releases/download/")
  )
    throw new Error(
      "Frida artifact must come from the official release repository",
    );
  const signal = AbortSignal.timeout(120_000);
  let response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetcher(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (location === null || redirects === 5)
        throw new Error("Invalid or excessive Frida download redirect");
      url = checkedUrl(new URL(location, url));
      continue;
    }
    break;
  }
  if (!response?.ok || response.body === null)
    throw new Error(
      `Frida release download failed (${response?.status ?? "no response"})`,
    );
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > artifact.bytes)
        throw new Error("Frida release exceeds pinned byte count");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return verifyFridaArchive(Buffer.concat(chunks), artifact);
};

/** Verify the complete downloaded bytes before reading or installing native code. */
export const verifyFridaArchive = (archive, artifact) => {
  if (
    archive.length !== artifact.bytes ||
    createHash("sha256").update(archive).digest("hex") !== artifact.sha256
  )
    throw new Error("Frida release failed pinned size or SHA-256 verification");
  return archive;
};

/** Read a bounded pinned payload from an opened regular offline file. */
export const readVerifiedFridaArchive = async (path, artifact) => {
  if (
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    artifact.bytes > 128 * 1024 * 1024
  )
    throw new Error("Invalid pinned Frida artifact size");
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== artifact.bytes)
      throw new Error(
        "Offline Frida archive must be a regular file of the pinned size",
      );
    const bytes = Buffer.alloc(artifact.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0)
        throw new Error("Offline Frida archive was truncated while reading");
      offset += bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, bytes.length);
    if (extra.bytesRead !== 0)
      throw new Error("Offline Frida archive grew past its pinned size");
    return verifyFridaArchive(bytes, artifact);
  } finally {
    await handle.close();
  }
};

/** Extract one exact regular file in memory; never use tar paths for filesystem writes. */
export const fridaBindingFromArchive = (archive) => {
  const tar = gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES });
  let binding;
  let paxSeen = false;
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      if (tar.subarray(offset).some((value) => value !== 0))
        throw new Error("Frida archive has content after its end marker");
      break;
    }
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .split("\0", 1)[0];
    const sizeText = text(124, 12).trim();
    if (!/^[0-7]+$/u.test(sizeText)) throw new Error("Invalid Frida tar size");
    const size = Number.parseInt(sizeText, 8);
    const name = text(0, 100);
    const prefix = text(345, 155);
    const type = header[156];
    if (size === 0 || offset + 512 + size > tar.length)
      throw new Error("Invalid Frida tar entry size");
    const checksumText = text(148, 8).trim();
    const checksum = [...header].reduce(
      (sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value),
      0,
    );
    if (
      !/^[0-7]+$/u.test(checksumText) ||
      Number.parseInt(checksumText, 8) !== checksum
    )
      throw new Error("Invalid Frida tar header checksum");
    if (type === 120) {
      // Frida's official archives include one PAX timestamp header. Reject path,
      // size and link overrides; they are never needed for this exact binding.
      if (paxSeen || binding !== undefined || size > 4096)
        throw new Error("Unexpected Frida PAX metadata");
      const metadata = tar.subarray(offset + 512, offset + 512 + size);
      let position = 0;
      while (position < metadata.length) {
        const separator = metadata.indexOf(32, position);
        const lengthText = metadata
          .subarray(position, separator)
          .toString("ascii");
        if (separator < position || !/^[1-9][0-9]*$/u.test(lengthText))
          throw new Error("Invalid Frida PAX record");
        const length = Number(lengthText);
        if (
          !Number.isSafeInteger(length) ||
          length <= separator - position ||
          position + length > metadata.length
        )
          throw new Error("Invalid Frida PAX record length");
        const record = metadata
          .subarray(position, position + length)
          .toString("ascii");
        if (
          !/^[1-9][0-9]* (?:mtime|atime|ctime)=-?[0-9]+(?:\.[0-9]+)?\n$/u.test(
            record,
          )
        )
          throw new Error("Frida PAX metadata may contain only timestamps");
        position += length;
      }
      paxSeen = true;
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    if (
      (type !== 0 && type !== 48) ||
      name !== "build/frida_binding.node" ||
      prefix !== "" ||
      binding !== undefined
    )
      throw new Error(
        "Frida archive must contain one exact regular native binding",
      );
    binding = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (binding === undefined || offset + 512 > tar.length)
    throw new Error("Frida archive is missing its binding or end marker");
  return binding;
};
