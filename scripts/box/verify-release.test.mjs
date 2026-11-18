import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signReleaseList } from "./release-list.mjs";
import { main } from "./verify-release.mjs";

const sourceSha = "1234567890abcdef1234567890abcdef12345678";
const app = `sha256:${"a".repeat(64)}`;
const printAgent = `sha256:${"b".repeat(64)}`;
const release = {
  format: 1,
  kind: "release",
  version: "1.10.3",
  prerelease: true,
  sourceSha,
  platform: "linux/amd64",
  images: { app, printAgent },
};
const keyPair = () =>
  generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
const current = keyPair();
const spare = keyPair();
const outside = keyPair();
let trust;

beforeEach(() => {
  trust = mkdtempSync(join(tmpdir(), "waitron-release-trust-"));
  writeFileSync(join(trust, "current.pem"), current.publicKey);
  writeFileSync(join(trust, "spare.pem"), spare.publicKey);
});

afterEach(() => rmSync(trust, { recursive: true, force: true }));

function runInstalledVerifier(args, input) {
  mkdirSync(join(trust, "upgrades"));
  for (const file of ["verify-release.mjs", "release-list.mjs", "upgrades/contracts.mjs"]) {
    copyFileSync(new URL(file, import.meta.url), join(trust, file));
  }
  const result = spawnSync(process.execPath, [join(trust, "verify-release.mjs"), ...args], {
    input,
    encoding: "utf8",
    timeout: 3_000,
  });
  if (result.error) throw result.error;
  return result;
}

async function invoke(args, input = Buffer.alloc(0)) {
  let stdout = "";
  let stderr = "";
  const status = await main(args, Readable.from([input]), trust, {
    log(message) {
      stdout += message + "\n";
    },
    error(message) {
      stderr += message + "\n";
    },
  });
  return { status, stdout, stderr };
}

describe("verify-release on the box", () => {
  it("accepts a prerelease signed by the current key through the installed script", () => {
    const result = runInstalledVerifier(["v1.10.3"], signReleaseList(release, current.privateKey));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${sourceSha} ${app} ${printAgent}\n`);
  });

  it("accepts a release signed by the spare key", async () => {
    const result = await invoke(["v1.10.3"], signReleaseList(release, spare.privateKey));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(sourceSha + " " + app + " " + printAgent + "\n");
  });

  it("rejects a malformed release file", async () => {
    const result = await invoke(["v1.10.3"], Buffer.from("partial JSON"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid release file");
    expect(result.stdout).toBe("");
  });

  it("refuses to compare an unreadable installed version", async () => {
    const result = await invoke(["--check-version", "v1.10.3", ""]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected a numbered release tag");
  });

  it("rejects a signature from outside the installed key pair", async () => {
    const result = await invoke(["v1.10.3"], signReleaseList(release, outside.privateKey));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid release signature");
    expect(result.stdout).toBe("");
  });

  it("rejects a valid signature for another tag", async () => {
    const result = await invoke(["v1.10.4"], signReleaseList(release, current.privateKey));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("signed version does not match v1.10.4");
    expect(result.stdout).toBe("");
  });

  it("requires both installed keys", async () => {
    rmSync(join(trust, "spare.pem"));
    const result = await invoke(["v1.10.3"], signReleaseList(release, current.privateKey));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("both retained release keys");
    expect(result.stdout).toBe("");
  });

  it("refuses a file larger than 16 KiB", async () => {
    const bytes = signReleaseList(release, current.privateKey);
    const result = await invoke(["v1.10.3"], Buffer.concat([bytes, Buffer.alloc(16_384, " ")]));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("16 KiB");
    expect(result.stdout).toBe("");
  });

  it.each([
    ["v1.10.3", "v1.9.3", 0],
    ["v1.9.3", "v1.10.3", 1],
    ["v2.0.0", "v1.999.999", 0],
    ["v1.10.2", "v1.10.3", 1],
    ["v1.10.3", "v1.10.3", 0],
    ["v1.0.9007199254740992", "v1.0.9007199254740993", 1],
  ])("checks candidate %s against installed release %s", async (candidate, installed, status) => {
    const result = await invoke(["--check-version", candidate, installed]);
    expect(result.status, result.stderr).toBe(status);
    if (status) expect(result.stderr).toContain(`older than installed release ${installed}`);
  });
});
