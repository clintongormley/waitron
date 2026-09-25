import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  VERSITYGW_ASSETS,
  VERSITYGW_BIN,
  VERSITYGW_VERSION,
  assetFor,
  install,
  parseVersion,
} from "./setup-s3-test-server.mjs";

// The installer for the S3-compatible server the stream loop test runs as a child process. Every
// case runs offline: the "release" is a tarball built here, holding a shell script that prints a
// version line the way `versitygw --version` does.

const HOST = `${process.platform}-${process.arch}`;
const scratch = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A release tarball shaped like versitygw's: `<name>/versitygw` at the top, nothing else needed. */
function fixtureRelease(printedVersion) {
  const dir = mkdtempSync(join(tmpdir(), "waitron-vgw-fixture-"));
  scratch.push(dir);
  const name = "versitygw_fixture";
  mkdirSync(join(dir, name));
  const bin = join(dir, name, "versitygw");
  writeFileSync(bin, `#!/bin/sh\necho "Version  : ${printedVersion}"\necho "Build    : fixture"\n`);
  chmodSync(bin, 0o755);
  const archive = join(dir, "fixture.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", dir, name]);
  const bytes = readFileSync(archive);
  return {
    dir,
    assets: { [HOST]: { name, sha256: createHash("sha256").update(bytes).digest("hex") } },
    bytes,
  };
}

/** A `fetch` that answers every URL with these bytes, recording what it was asked for. */
function answering(bytes, seen = []) {
  return async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
}

describe("the pinned versitygw release", () => {
  it("pins exactly the three platforms the loop test runs on, each with a 64-hex SHA-256", () => {
    expect(Object.keys(VERSITYGW_ASSETS).sort()).toEqual([
      "darwin-arm64",
      "linux-arm64",
      "linux-x64",
    ]);
    for (const asset of Object.values(VERSITYGW_ASSETS)) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.name).toContain(`_v${VERSITYGW_VERSION}_`);
    }
  });

  it("builds the download URL from the pinned version and the asset's full name", () => {
    expect(assetFor("linux", "x64", VERSITYGW_ASSETS).url).toBe(
      "https://github.com/versity/versitygw/releases/download/v1.8.0/versitygw_v1.8.0_Linux_x86_64.tar.gz",
    );
  });

  it("refuses a platform it has no pin for, naming the ones it has", () => {
    expect(() => assetFor("win32", "x64", VERSITYGW_ASSETS)).toThrow(
      "versitygw 1.8.0 is pinned for linux-x64, linux-arm64, darwin-arm64; this host is win32-x64",
    );
  });

  it("installs into the gitignored .bin directory at the repository root", () => {
    expect(VERSITYGW_BIN.endsWith(join(".bin", "versitygw"))).toBe(true);
  });
});

describe("parseVersion", () => {
  it("reads the version off versitygw's own --version layout", () => {
    expect(
      parseVersion("Version  : 1.8.0\nBuild    : fd04bc1\nBuildTime: 2026-09-04T23:05:38Z\n"),
    ).toBe("1.8.0");
  });

  it("answers null for output with no version line", () => {
    expect(parseVersion("litestream 0.5.17\n")).toBeNull();
  });
});

describe("install", () => {
  it("downloads, checks the SHA-256, unpacks the binary to dest and confirms its version", async () => {
    const release = fixtureRelease(VERSITYGW_VERSION);
    const dest = join(release.dir, "out", "versitygw");
    const seen = [];
    await expect(
      install({
        platform: process.platform,
        arch: process.arch,
        assets: release.assets,
        fetchImpl: answering(release.bytes, seen),
        dest,
      }),
    ).resolves.toBe(dest);
    expect(seen).toEqual([assetFor(process.platform, process.arch, release.assets).url]);
    expect(execFileSync(dest, ["--version"], { encoding: "utf8" })).toContain("Version  : 1.8.0");
  });

  it("refuses bytes whose SHA-256 is not the pinned one, and installs nothing", async () => {
    const release = fixtureRelease(VERSITYGW_VERSION);
    const dest = join(release.dir, "out", "versitygw");
    const assets = { [HOST]: { ...release.assets[HOST], sha256: "0".repeat(64) } };
    await expect(
      install({
        platform: process.platform,
        arch: process.arch,
        assets,
        fetchImpl: answering(release.bytes),
        dest,
      }),
    ).rejects.toThrow(`not the pinned ${"0".repeat(64)}; nothing was installed`);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses a download the server did not answer with success", async () => {
    const release = fixtureRelease(VERSITYGW_VERSION);
    await expect(
      install({
        platform: process.platform,
        arch: process.arch,
        assets: release.assets,
        fetchImpl: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
        dest: join(release.dir, "out", "versitygw"),
      }),
    ).rejects.toThrow("answered 404 Not Found");
  });

  it("refuses a binary that reports a different version from the pin", async () => {
    const release = fixtureRelease("9.9.9");
    await expect(
      install({
        platform: process.platform,
        arch: process.arch,
        assets: release.assets,
        fetchImpl: answering(release.bytes),
        dest: join(release.dir, "out", "versitygw"),
      }),
    ).rejects.toThrow("reports version 9.9.9, not the pinned 1.8.0");
  });
});

describe("the loop test's helper", () => {
  // A TEXT pin between two copies of one string: `apps/server` cannot import this script (it sits
  // outside that package's source tree), so the helper holds its own copy of the version and this
  // case is what fails when the two drift. It reads the line, not the value the helper computes.
  it("checks for the same versitygw version this script installs", () => {
    const helper = readFileSync(
      new URL("../apps/server/src/testing/s3-test-server.ts", import.meta.url),
      "utf8",
    );
    expect(helper).toContain(`export const VERSITYGW_VERSION = "${VERSITYGW_VERSION}";`);
  });
});
