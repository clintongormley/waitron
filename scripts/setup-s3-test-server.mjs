/**
 * `node scripts/setup-s3-test-server.mjs` — install the pinned versitygw release at `.bin/versitygw`
 * under the repository root, where the stream loop test looks for it
 * (`apps/server/src/testing/s3-test-server.ts`).
 *
 * versitygw is the S3-compatible server that test runs as a plain child process; why this one is in
 * docs/developers/testing-guide.md → "The stream loop test". The archive's SHA-256 is checked against
 * the value pinned here, copied from the release's own `checksums.txt`, before anything is unpacked.
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERSITYGW_VERSION = "1.8.0";

/** Keyed by `<process.platform>-<process.arch>`; each tarball unpacks to `<name>/versitygw`. */
export const VERSITYGW_ASSETS = {
  "linux-x64": {
    name: "versitygw_v1.8.0_Linux_x86_64",
    sha256: "2ba2c734d10d2c4e651d03182cb4b246656bc735a2f282db7b0b73fba6073467",
  },
  "linux-arm64": {
    name: "versitygw_v1.8.0_Linux_arm64",
    sha256: "b34051d33f5a9c457f790896acb7bd7d7e15ad8d92efb70616b924f37e401910",
  },
  "darwin-arm64": {
    name: "versitygw_v1.8.0_Darwin_arm64",
    sha256: "4953096f65a9c0d62ab184fb6b2ba7c2435229205cf00a56cb62cd4bf6b216ca",
  },
};

export const VERSITYGW_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".bin",
  "versitygw",
);

/** The pinned asset for one platform, with its download URL; throws for a platform with no pin. */
export function assetFor(platform, arch, assets) {
  const asset = assets[`${platform}-${arch}`];
  if (asset === undefined) {
    throw new Error(
      `versitygw ${VERSITYGW_VERSION} is pinned for ${Object.keys(assets).join(", ")}; ` +
        `this host is ${platform}-${arch}`,
    );
  }
  return {
    ...asset,
    url: `https://github.com/versity/versitygw/releases/download/v${VERSITYGW_VERSION}/${asset.name}.tar.gz`,
  };
}

/** The version from `versitygw --version`'s `Version  : x.y.z` line, or null when there is none. */
export function parseVersion(output) {
  return /^Version\s*:\s*(\S+)\s*$/m.exec(output)?.[1] ?? null;
}

/** Download, verify, unpack and version-check one release into `dest`; returns `dest`. */
export async function install({ platform, arch, assets, fetchImpl, dest }) {
  const asset = assetFor(platform, arch, assets);
  const response = await fetchImpl(asset.url);
  if (!response.ok) {
    throw new Error(`${asset.url} answered ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(
      `${asset.url} has SHA-256 ${actual}, not the pinned ${asset.sha256}; nothing was installed`,
    );
  }
  const staging = mkdtempSync(join(tmpdir(), "waitron-versitygw-"));
  try {
    const archive = join(staging, "archive.tar.gz");
    writeFileSync(archive, bytes);
    execFileSync("tar", ["-xzf", archive, "-C", staging]);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(staging, asset.name, "versitygw"), dest);
    chmodSync(dest, 0o755);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  const version = parseVersion(
    execFileSync(dest, ["--version"], { encoding: "utf8", timeout: 10_000 }),
  );
  if (version !== VERSITYGW_VERSION) {
    throw new Error(`${dest} reports version ${version}, not the pinned ${VERSITYGW_VERSION}`);
  }
  return dest;
}

// The process wiring alone; the suite calls `install` with the download and the platform injected.
/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dest = await install({
    platform: process.platform,
    arch: process.arch,
    assets: VERSITYGW_ASSETS,
    fetchImpl: globalThis.fetch,
    dest: VERSITYGW_BIN,
  });
  console.log(`versitygw ${VERSITYGW_VERSION} installed at ${dest}`);
}
/* v8 ignore stop */
