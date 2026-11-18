import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./sign-release-list.mjs";

const keyPair = () =>
  generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
const current = keyPair();
const spare = keyPair();
const app = "sha256:" + "a".repeat(64);
const agent = "sha256:" + "b".repeat(64);
const source = "c".repeat(40);

function run({
  secret,
  currentPem,
  sparePem,
  appDigest = app,
  viaCli = false,
  existingOutput,
  unreadableKey,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sign-release-list-"));
  const output = join(dir, "waitron-release.json");
  const env = {
    WAITRON_RELEASE_SIGNING_KEY: secret ?? "",
    RELEASE_VERSION: "1.2.3",
    RELEASE_SOURCE_SHA: source,
    RELEASE_APP_DIGEST: appDigest,
    RELEASE_PRINT_AGENT_DIGEST: agent,
    RELEASE_PRERELEASE: "true",
  };
  try {
    if (currentPem) writeFileSync(join(dir, "current.pem"), currentPem);
    if (sparePem) writeFileSync(join(dir, "spare.pem"), sparePem);
    if (unreadableKey) mkdirSync(join(dir, "current.pem"));
    if (existingOutput) writeFileSync(output, existingOutput);

    const readOutput = () => (existsSync(output) ? readFileSync(output) : undefined);
    if (viaCli) {
      const result = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "sign-release-list.mjs"), dir, output],
        { encoding: "utf8", timeout: 5000, env },
      );
      return { ...result, bytes: readOutput() };
    }
    let stderr = "";
    const status = main([dir, output], env, {
      log() {},
      error(message) {
        stderr += message;
      },
    });
    return { status, bytes: readOutput(), stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const publicKeys = { currentPem: current.publicKey, sparePem: spare.publicKey };

describe("sign-release-list.mjs", () => {
  it("publishes a file when run as the release job's script", () => {
    const result = run({ ...publicKeys, secret: spare.privateKey, viaCli: true });
    expect(result.status, result.stderr).toBe(0);
    const signed = JSON.parse(result.bytes);
    expect(
      verify(
        null,
        Buffer.from(signed.payload, "base64url"),
        spare.publicKey,
        Buffer.from(signed.signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("reports a bad key using a nonzero exit without printing its value", () => {
    const secret = "invalid-secret-that-must-stay-private";
    const result = run({ ...publicKeys, secret, viaCli: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/check the key format or release inputs/i);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.bytes).toBeUndefined();
  });

  it("names a failure to read a key", () => {
    const result = run({
      secret: current.privateKey,
      sparePem: spare.publicKey,
      unreadableKey: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/check that both public key files can be read/i);
    expect(result.bytes).toBeUndefined();
  });

  it("keeps a file already present at the output path", () => {
    const result = run({
      ...publicKeys,
      secret: current.privateKey,
      existingOutput: "other bytes",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/check that the output path is writable and unused/i);
    expect(result.bytes.toString()).toBe("other bytes");
  });

  it("skips signing before either the secret or trusted keys has been set up", () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.bytes).toBeUndefined();
  });

  it("writes a stable release with the given app and print-agent digests in their named roles", () => {
    const result = run({ ...publicKeys, secret: current.privateKey });
    expect(result.status, result.stderr).toBe(0);
    const signed = JSON.parse(result.bytes);
    const payload = Buffer.from(signed.payload, "base64url");
    expect(
      verify(null, payload, current.publicKey, Buffer.from(signed.signature, "base64url")),
    ).toBe(true);
    expect(JSON.parse(payload)).toEqual({
      format: 1,
      kind: "release",
      version: "1.2.3",
      prerelease: false,
      sourceSha: source,
      platform: "linux/amd64",
      images: { app, printAgent: agent },
    });
  });

  it.each([
    ["missing secret", publicKeys, /set the signing secret and both public keys/i],
    [
      "missing both keys",
      { secret: current.privateKey },
      /set the signing secret and both public keys/i,
    ],
    [
      "missing spare key",
      { secret: current.privateKey, currentPem: current.publicKey },
      /set the signing secret and both public keys/i,
    ],
    [
      "wrong secret",
      { ...publicKeys, secret: keyPair().privateKey },
      /verify with the trusted public keys/i,
    ],
    [
      "unreadable secret",
      { ...publicKeys, secret: "invalid-secret-that-must-stay-private" },
      /check the key format or release inputs/i,
    ],
    [
      "invalid public key",
      { ...publicKeys, currentPem: current.privateKey, secret: current.privateKey },
      /verify with the trusted public keys/i,
    ],
    [
      "duplicate public key",
      {
        ...publicKeys,
        sparePem: current.publicKey.replaceAll("\n", "\r\n"),
        secret: current.privateKey,
      },
      /verify with the trusted public keys/i,
    ],
    [
      "missing app digest",
      { ...publicKeys, secret: current.privateKey, appDigest: "" },
      /check the key format or release inputs/i,
    ],
  ])("refuses to publish with %s", (_reason, settings, message) => {
    const result = run(settings);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Could not sign the release/);
    expect(result.stderr).toMatch(message);
    expect(result.bytes).toBeUndefined();
  });
});
