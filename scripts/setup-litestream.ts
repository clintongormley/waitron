/**
 * `pnpm setup:litestream` — downloads the pinned Litestream for this machine into `.bin/litestream`
 * at the repository root (gitignored), checks the download against the release's published SHA-256
 * and checks the binary reports the pinned version. Start a server that streams with
 * `WAITRON_LITESTREAM_BIN=<that path>`. The box image fetches its own copy (`deploy/Dockerfile`);
 * `packages/stream`'s tests drive a fake child process and need none.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = "0.5.17";

/**
 * From the release's own `checksums.txt` for the tag. The asset names use `x86_64`; the only `amd64`
 * names in the release belong to a different artefact, `litestream-vfs-…`.
 */
const SHA256: Readonly<Record<string, string>> = {
  "darwin-arm64": "e211f68ff7658d19f193f2914417afdf8f89a053ff8f263e5d6b3b1d3bbc7b08",
  "darwin-x86_64": "891875af09db152e93a4b31a8a79f538ce7ce702c132803cfe0a831e7cb1b7db",
  "linux-arm64": "f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5",
  "linux-x86_64": "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d",
};

const root = join(import.meta.dirname, "..");
const target = join(root, ".bin", "litestream");
const platform = `${process.platform}-${process.arch === "x64" ? "x86_64" : process.arch}`;
const expected = SHA256[platform];
if (expected === undefined) {
  throw new Error(
    `no pinned Litestream ${VERSION} for ${platform}; pinned: ${Object.keys(SHA256).join(", ")}`,
  );
}
const asset = `litestream-${VERSION}-${platform}.tar.gz`;
const url = `https://github.com/benbjohnson/litestream/releases/download/v${VERSION}/${asset}`;

const response = await fetch(url);
if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== expected) {
  throw new Error(`${asset} has SHA-256 ${actual}, not the pinned ${expected}`);
}

const staging = mkdtempSync(join(tmpdir(), "waitron-litestream-"));
try {
  const archive = join(staging, asset);
  writeFileSync(archive, bytes);
  execFileSync("tar", ["-xzf", archive, "-C", staging, "litestream"], { stdio: "inherit" });
  mkdirSync(join(root, ".bin"), { recursive: true });
  copyFileSync(join(staging, "litestream"), target);
  chmodSync(target, 0o755);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const reported = execFileSync(target, ["version"], { encoding: "utf8" }).trim();
if (reported !== VERSION) {
  throw new Error(`${target} reports ${reported}, not the pinned ${VERSION}`);
}
console.log(`litestream ${reported} installed at ${target}`);
console.log(`start the server with WAITRON_LITESTREAM_BIN=${target}`);
