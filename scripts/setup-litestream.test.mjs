import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SHA256, VERSION, assetFor, install } from "./setup-litestream.mjs";

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-litestream-test-"));
  scratch.push(dir);
  return dir;
};

/** A shell script standing in for the binary: it prints `reports` for `litestream version`. */
const fakeBinary = (reports) => `#!/bin/sh\necho ${reports}\n`;

/** A real `.tar.gz` holding one `litestream` that prints `reports`, as the release archive does. */
function releaseArchive(reports) {
  const dir = tempDir();
  writeFileSync(join(dir, "litestream"), fakeBinary(reports), { mode: 0o755 });
  const archive = join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", dir, "litestream"]);
  return readFileSync(archive);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A `fetch` answering every URL with `bytes`, recording what it was asked for. */
function fakeFetch(bytes, { ok = true, status = 200, statusText = "OK" } = {}) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return { ok, status, statusText, arrayBuffer: async () => new Uint8Array(bytes).buffer };
  };
  return { fetch, urls };
}

/** The real runner, recording each program it starts. */
function recordingRun() {
  const calls = [];
  const run = (file, args) => {
    calls.push([file, ...args]);
    return execFileSync(file, args, { encoding: "utf8" });
  };
  return { run, calls };
}

describe("assetFor", () => {
  it("maps Node's x64 to the release's x86_64 and passes arm64 through", () => {
    expect(assetFor("linux", "x64")).toEqual({
      asset: `litestream-${VERSION}-linux-x86_64.tar.gz`,
      url: `https://github.com/benbjohnson/litestream/releases/download/v${VERSION}/litestream-${VERSION}-linux-x86_64.tar.gz`,
      sha256: SHA256["linux-x86_64"],
    });
    expect(assetFor("darwin", "arm64").asset).toBe(`litestream-${VERSION}-darwin-arm64.tar.gz`);
    expect(assetFor("darwin", "arm64").sha256).toBe(SHA256["darwin-arm64"]);
  });

  it("holds one checksum for each of the four machines it serves, and no other", () => {
    const reachable = [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "arm64"],
      ["linux", "x64"],
    ].map(([platform, arch]) => assetFor(platform, arch).sha256);
    expect(reachable.sort()).toEqual(Object.values(SHA256).sort());
  });

  it("refuses a platform with no pinned checksum, naming the ones there are", () => {
    expect(() => assetFor("win32", "x64")).toThrow(
      `no pinned Litestream ${VERSION} for win32-x86_64; pinned: darwin-arm64, darwin-x86_64, linux-arm64, linux-x86_64`,
    );
  });
});

describe("install", () => {
  const PLATFORM = { platform: "linux", arch: "x64" };

  it("downloads the pinned asset, unpacks it into .bin and checks the version it reports", async () => {
    const root = tempDir();
    const tmp = tempDir();
    const bytes = releaseArchive(VERSION);
    const { fetch, urls } = fakeFetch(bytes);
    const result = await install({
      root,
      ...PLATFORM,
      fetch,
      tmp,
      pin: { sums: { "linux-x86_64": sha256(bytes) } },
    });
    const target = join(root, ".bin", "litestream");
    expect(result).toEqual({ target, version: VERSION, downloaded: true });
    expect(urls).toEqual([assetFor("linux", "x64").url]);
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(execFileSync(target, ["version"], { encoding: "utf8" }).trim()).toBe(VERSION);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it("refuses a download whose SHA-256 is not the pinned one, and installs nothing", async () => {
    const root = tempDir();
    const tmp = tempDir();
    const bytes = releaseArchive(VERSION);
    const { fetch, urls } = fakeFetch(bytes);
    const { run, calls } = recordingRun();
    await expect(install({ root, ...PLATFORM, fetch, run, tmp })).rejects.toThrow(
      `litestream-${VERSION}-linux-x86_64.tar.gz has SHA-256 ${sha256(bytes)}, not the pinned ${SHA256["linux-x86_64"]}`,
    );
    expect(urls).toHaveLength(1);
    expect(existsSync(join(root, ".bin"))).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
    expect(calls.map(([file]) => file)).toEqual([join(root, ".bin", "litestream")]);
  });

  it("leaves a binary already reporting the pinned version alone, and downloads nothing", async () => {
    const root = tempDir();
    mkdirSync(join(root, ".bin"));
    writeFileSync(join(root, ".bin", "litestream"), fakeBinary(VERSION), { mode: 0o755 });
    const { fetch, urls } = fakeFetch(Buffer.alloc(0));
    const result = await install({ root, ...PLATFORM, fetch, tmp: tempDir() });
    expect(result).toEqual({
      target: join(root, ".bin", "litestream"),
      version: VERSION,
      downloaded: false,
    });
    expect(urls).toEqual([]);
  });

  it("replaces a binary reporting another version", async () => {
    const root = tempDir();
    mkdirSync(join(root, ".bin"));
    writeFileSync(join(root, ".bin", "litestream"), fakeBinary("0.0.1"), { mode: 0o755 });
    const bytes = releaseArchive(VERSION);
    const { fetch } = fakeFetch(bytes);
    const result = await install({
      root,
      ...PLATFORM,
      fetch,
      tmp: tempDir(),
      pin: { sums: { "linux-x86_64": sha256(bytes) } },
    });
    expect(result.downloaded).toBe(true);
    expect(execFileSync(result.target, ["version"], { encoding: "utf8" }).trim()).toBe(VERSION);
  });

  it("refuses a release answer that is not a success", async () => {
    const { fetch } = fakeFetch(Buffer.alloc(0), {
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    await expect(install({ root: tempDir(), ...PLATFORM, fetch, tmp: tempDir() })).rejects.toThrow(
      `${assetFor("linux", "x64").url} answered 404 Not Found`,
    );
  });

  it("refuses a binary that reports a version other than the pin after unpacking", async () => {
    const root = tempDir();
    const tmp = tempDir();
    const bytes = releaseArchive("0.5.16");
    const { fetch } = fakeFetch(bytes);
    await expect(
      install({ root, ...PLATFORM, fetch, tmp, pin: { sums: { "linux-x86_64": sha256(bytes) } } }),
    ).rejects.toThrow(
      `${join(root, ".bin", "litestream")} reports 0.5.16, not the pinned ${VERSION}`,
    );
    expect(readdirSync(tmp)).toEqual([]);
  });
});
