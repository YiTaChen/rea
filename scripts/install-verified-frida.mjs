#!/usr/bin/env node
import {
  readFile,
  lstat,
  realpath,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadVerifiedFrida,
  readVerifiedFridaArchive,
  fridaBindingFromArchive,
} from "./lib/verified-frida.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === "--archive"))
  throw new Error(
    "Usage: node scripts/install-verified-frida.mjs [--archive FILE]",
  );
const manifest = JSON.parse(
  await readFile(
    join(root, "third_party/frida/verified-artifacts.json"),
    "utf8",
  ),
);
const packageRoot = join(root, "node_modules", "frida");
const installed = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
if (installed.name !== "frida" || installed.version !== manifest.version)
  throw new Error(
    "Installed Frida version does not match the reviewed artifact manifest",
  );
const target = `${process.platform}-${process.arch}`;
const artifact = manifest.artifacts[target];
if (artifact === undefined || Number(process.versions.napi) < manifest.napi)
  throw new Error(
    `No reviewed Frida native artifact for ${target} on this Node runtime`,
  );
const build = join(packageRoot, "build");
if (
  (await lstat(packageRoot)).isSymbolicLink() ||
  (await lstat(build)).isSymbolicLink() ||
  (await realpath(build)) !== build
)
  throw new Error("Refusing a redirected Frida installation directory");
const archive =
  args.length === 0
    ? await downloadVerifiedFrida(artifact)
    : await readVerifiedFridaArchive(resolve(args[1]), artifact);
const binding = fridaBindingFromArchive(archive);
const destination = join(build, "frida_binding.node");
const temporary = join(
  build,
  `.frida-binding-${process.pid}-${Date.now()}.tmp`,
);
try {
  await writeFile(temporary, binding, { flag: "wx", mode: 0o644 });
  await rename(temporary, destination);
} finally {
  await rm(temporary, { force: true });
}
process.stdout.write(
  `Installed SHA-256 verified Frida ${manifest.version} binding for ${target}.\n`,
);
