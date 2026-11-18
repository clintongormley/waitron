import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

function run({ secret, currentPem, sparePem, appDigest = app } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sign-release-list-"));
  const output = join(dir, "waitron-release.json");
  try {
    if (currentPem) writeFileSync(join(dir, "current.pem"), currentPem);
    if (sparePem) writeFileSync(join(dir, "spare.pem"), sparePem);
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "sign-release-list.mjs"), dir, output],
      {
        encoding: "utf8",
        timeout: 5000,
        env: {
          WAITRON_RELEASE_SIGNING_KEY: secret ?? "",
          RELEASE_VERSION: "1.2.3",
          RELEASE_SOURCE_SHA: source,
          RELEASE_APP_DIGEST: appDigest,
          RELEASE_PRINT_AGENT_DIGEST: agent,
          RELEASE_PRERELEASE: "true",
        },
      },
    );
    return { ...result, bytes: existsSync(output) ? readFileSync(output) : undefined };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const publicKeys = { currentPem: current.publicKey, sparePem: spare.publicKey };

describe("sign-release-list.mjs", () => {
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
    ["missing secret", publicKeys],
    ["missing both keys", { secret: current.privateKey }],
    ["missing spare key", { secret: current.privateKey, currentPem: current.publicKey }],
    ["wrong secret", { ...publicKeys, secret: keyPair().privateKey }],
    ["unreadable secret", { ...publicKeys, secret: "invalid-secret-that-must-stay-private" }],
    [
      "invalid public key",
      { ...publicKeys, currentPem: current.privateKey, secret: current.privateKey },
    ],
    ["missing app digest", { ...publicKeys, secret: current.privateKey, appDigest: "" }],
  ])("refuses to publish with %s", (_reason, settings) => {
    const result = run(settings);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Could not sign the release/);
    if (settings.secret) expect(result.stdout + result.stderr).not.toContain(settings.secret);
    expect(result.bytes).toBeUndefined();
  });
});
