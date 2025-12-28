import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRATE_DIR = path.join(TS_ROOT, "native", "merkle-native");
const TARGET_DIR = path.join(CRATE_DIR, "target", "release");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run("cargo", ["build", "--release"], { cwd: CRATE_DIR });

const candidates = [
  { src: path.join(TARGET_DIR, "libmerkle_native.so"), dst: path.join(CRATE_DIR, "merkle_native.node") },
  { src: path.join(TARGET_DIR, "libmerkle_native.dylib"), dst: path.join(CRATE_DIR, "merkle_native.node") },
  { src: path.join(TARGET_DIR, "merkle_native.dll"), dst: path.join(CRATE_DIR, "merkle_native.node") },
];

const built = candidates.find((c) => fs.existsSync(c.src));
if (!built) {
  console.error(`[build-native] failed to find built artifact in ${TARGET_DIR}`);
  process.exit(1);
}

fs.copyFileSync(built.src, built.dst);
console.log(`[build-native] wrote ${built.dst}`);

