import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUNDLED_BIN, LITESTREAM_VERSION } from "./litestream.ts";

const TAG = `v${LITESTREAM_VERSION}`;
const RELEASE_API = `https://api.github.com/repos/benbjohnson/litestream/releases/tags/${TAG}`;

type ReleaseAsset = { name: string; browser_download_url: string };

// An exact asset name prevents picking the VFS archive instead of the CLI archive.
function assetName(): string {
  const arch = process.arch === "x64" ? "x86_64" : process.arch;
  return `litestream-${LITESTREAM_VERSION}-${process.platform}-${arch}.tar.gz`;
}

async function main(): Promise<void> {
  const wanted = assetName();
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

    // Unpack in staging because the archive contains sibling files at its root.
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
