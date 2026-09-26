/* Temporary: selects @waitron/server so PR #682 CI runs the server jobs; reverted before landing. */
/**
 * `pnpm setup:litestream` — downloads the pinned Litestream for this machine into `.bin/litestream`
 * at the repository root (gitignored). Start a server that streams with
 * `WAITRON_LITESTREAM_BIN=<that path>`. The box image fetches its own copy (`deploy/Dockerfile`).
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = "0.5.17";

/**
 * From the release's own `checksums.txt` for the tag. The asset names use `x86_64`; the only `amd64`
 * names in the release belong to a different artefact, `litestream-vfs-…`.
 */
export const SHA256 = {
  "darwin-arm64": "e211f68ff7658d19f193f2914417afdf8f89a053ff8f263e5d6b3b1d3bbc7b08",
  "darwin-x86_64": "891875af09db152e93a4b31a8a79f538ce7ce702c132803cfe0a831e7cb1b7db",
  "linux-arm64": "f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5",
  "linux-x86_64": "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d",
};

/**
 * The release asset for a Node `process.platform` and `process.arch`.
 *
 * @param {string} platform
 * @param {string} arch
 * @param {{ version?: string, sums?: Record<string, string> }} [pin]
 * @returns {{ asset: string, url: string, sha256: string }}
 */
export function assetFor(platform, arch, { version = VERSION, sums = SHA256 } = {}) {
  const key = `${platform}-${arch === "x64" ? "x86_64" : arch}`;
  const sha256 = sums[key];
  if (sha256 === undefined) {
    throw new Error(
      `no pinned Litestream ${version} for ${key}; pinned: ${Object.keys(sums).join(", ")}`,
    );
  }
  const asset = `litestream-${version}-${key}.tar.gz`;
  const url = `https://github.com/benbjohnson/litestream/releases/download/v${version}/${asset}`;
  return { asset, url, sha256 };
}

/**
 * Installs the pinned Litestream at `<root>/.bin/litestream`, unless the binary already there
 * reports the pinned version.
 *
 * @param {object} options
 * @param {string} options.root the repository root
 * @param {string} options.platform
 * @param {string} options.arch
 * @param {(url: string) => Promise<{ ok: boolean, status: number, statusText: string, arrayBuffer(): Promise<ArrayBuffer> }>} [options.fetch]
 * @param {(file: string, args: string[]) => string} [options.run] runs a program and returns its stdout
 * @param {string} [options.tmp] where the download is unpacked
 * @param {{ version?: string, sums?: Record<string, string> }} [options.pin]
 * @returns {Promise<{ target: string, version: string, downloaded: boolean }>}
 */
export async function install({
  root,
  platform,
  arch,
  fetch = globalThis.fetch,
  run = (file, args) => execFileSync(file, args, { encoding: "utf8" }),
  tmp = tmpdir(),
  pin = {},
}) {
  const version = pin.version ?? VERSION;
  const target = join(root, ".bin", "litestream");
  const { asset, url, sha256 } = assetFor(platform, arch, pin);

  let present;
  try {
    present = run(target, ["version"]).trim();
  } catch {
    present = undefined;
  }
  if (present === version) return { target, version, downloaded: false };

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new Error(`${asset} has SHA-256 ${actual}, not the pinned ${sha256}`);
  }

  const staging = mkdtempSync(join(tmp, "waitron-litestream-"));
  try {
    const archive = join(staging, asset);
    writeFileSync(archive, bytes);
    run("tar", ["-xzf", archive, "-C", staging, "litestream"]);
    mkdirSync(join(root, ".bin"), { recursive: true });
    copyFileSync(join(staging, "litestream"), target);
    chmodSync(target, 0o755);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const reported = run(target, ["version"]).trim();
  if (reported !== version) {
    throw new Error(`${target} reports ${reported}, not the pinned ${version}`);
  }
  return { target, version, downloaded: true };
}

// The process wiring alone; the suite calls `install` with the download and the platform injected.
/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { target, version, downloaded } = await install({
    root: join(import.meta.dirname, ".."),
    platform: process.platform,
    arch: process.arch,
  });
  console.log(
    `litestream ${version} ${downloaded ? "installed" : "already installed"} at ${target}`,
  );
  console.log(`start the server with WAITRON_LITESTREAM_BIN=${target}`);
}
/* v8 ignore stop */
