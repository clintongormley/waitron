/**
 * `pnpm --filter @waitron/bench-sqlite-failover setup:litestream` — download the pinned litestream
 * release into the gitignored `.bin/`, where `resolveLitestream()` looks for it.
 *
 * Nothing in the repository ships a litestream binary and nothing installs one: the scenarios that
 * drive it report SKIPPED until this has been run once.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUNDLED_BIN, LITESTREAM_VERSION } from "./litestream.ts";

const TAG = `v${LITESTREAM_VERSION}`;
const RELEASE_API = `https://api.github.com/repos/benbjohnson/litestream/releases/tags/${TAG}`;

type ReleaseAsset = { name: string; browser_download_url: string };

/**
 * The asset is matched on its FULL name, never a substring. The `v0.5.17` release lists both
 * `litestream-0.5.17-darwin-arm64.tar.gz` (the CLI) and `litestream-vfs-v0.5.17-darwin-arm64.tar.gz`
 * (a different artefact), so a `includes("darwin-arm64")` test matches two assets and the one it
 * picks depends on the order the API happens to return (measured against the release API,
 * 2026-09-18).
 *
 * The name is composed from this host rather than hardcoded, so a platform this rig has not been run
 * on fails on a missing asset instead of installing a darwin binary. Only darwin/arm64 has actually
 * been downloaded and run; the other names are read off the release listing, not exercised.
 *
 * `x64` maps to `x86_64` because that is what the CLI assets are called — the listing for this tag
 * holds `litestream-0.5.17-darwin-x86_64.tar.gz` and `litestream-0.5.17-linux-x86_64.tar.gz`, and
 * the only `amd64` names in it belong to the `litestream-vfs-…` artefact (read from the release API,
 * 2026-09-18).
 */
function assetName(): string {
  const arch = process.arch === "x64" ? "x86_64" : process.arch;
  return `litestream-${LITESTREAM_VERSION}-${process.platform}-${arch}.tar.gz`;
}

async function main(): Promise<void> {
  const wanted = assetName();
  // A named User-Agent rather than the runtime's default; nothing here has tested what this API
  // does without one.
  const response = await fetch(RELEASE_API, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "waitron-bench-sqlite-failover",
    },
  });
  if (!response.ok) {
    throw new Error(`${RELEASE_API} answered ${response.status} ${response.statusText}`);
  }
  const release = (await response.json()) as { assets?: ReleaseAsset[] };
  const asset = (release.assets ?? []).find((candidate) => candidate.name === wanted);
  if (!asset) {
    throw new Error(
      `${TAG} has no asset named ${wanted}; it lists ${(release.assets ?? []).map((a) => a.name).join(", ")}`,
    );
  }

  const staging = mkdtempSync(join(tmpdir(), "waitron-litestream-"));
  try {
    const archive = join(staging, wanted);
    const download = await fetch(asset.browser_download_url);
    if (!download.ok) {
      throw new Error(
        `${asset.browser_download_url} answered ${download.status} ${download.statusText}`,
      );
    }
    writeFileSync(archive, Buffer.from(await download.arrayBuffer()));

    // The tarball unpacks `litestream`, `LICENSE`, `README.md` and an `etc/` directory into the
    // current directory — it is not nested in a release folder — so it is unpacked into the staging
    // directory and only the binary is kept.
    execFileSync("tar", ["-xzf", archive, "-C", staging], { stdio: "inherit" });
    mkdirSync(dirname(BUNDLED_BIN), { recursive: true });
    copyFileSync(join(staging, "litestream"), BUNDLED_BIN);
    chmodSync(BUNDLED_BIN, 0o755);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const version = execFileSync(BUNDLED_BIN, ["version"], { encoding: "utf8" }).trim();
  if (version !== LITESTREAM_VERSION) {
    throw new Error(`${BUNDLED_BIN} reports ${version}, not the pinned ${LITESTREAM_VERSION}`);
  }
  console.log(`litestream ${version} installed at ${BUNDLED_BIN}`);
}

await main();
