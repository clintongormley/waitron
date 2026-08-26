import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

let kp: forge.pki.rsa.KeyPair;
beforeAll(() => {
  kp = forge.pki.rsa.generateKeyPair(2048);
});
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const newDir = async () => {
  const d = await mkdtemp(join(tmpdir(), "boxsecrets-"));
  dirs.push(d);
  return d;
};

const deps = (stateDir: string) => ({
  stateDir,
  hostnames: ["waitron.local", "localhost"],
  now: () => new Date("2026-08-26T00:00:00Z"),
  mint: (o: Parameters<typeof mintSelfSignedServerCert>[0]) =>
    mintSelfSignedServerCert({ ...o, keypair: () => kp }),
  makeKeyRing: () => ({ key: "A".repeat(43) + "=", version: 1 }), // shape only; boot uses the real one
  makeToken: () => "deadbeef".repeat(8),
  listIpv4: () => ["192.168.1.50"],
});

describe("ensureBoxSecrets", () => {
  it("materialises the cert + secrets on first call and returns the TLS paths", async () => {
    const d = await newDir();
    const tls = await ensureBoxSecrets(deps(d));
    expect(tls.certFile).toBe(join(d, "tls", "server.crt"));
    expect(tls.keyFile).toBe(join(d, "tls", "server.key"));
    expect(tls.caCertFile).toBe(join(d, "tls", "ca.crt"));
    // secrets.env holds all three names
    const env = await readFile(join(d, "secrets.env"), "utf8");
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY=/m);
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY_VERSION=1$/m);
    expect(env).toMatch(/^WAITRON_SYNC_NODE_TOKEN=deadbeef/m);
  });

  it("writes private keys and the secrets file 0600", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    for (const f of ["tls/server.key", "tls/ca.key", "secrets.env"]) {
      const mode = (await stat(join(d, f))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("is idempotent: a second call reuses the exact same bytes and regenerates nothing", async () => {
    const d = await newDir();
    // The default deps are deterministic (shared keypair, fixed clock, fixed secrets), so a
    // REGENERATED cert/secrets file would be byte-identical anyway — byte-equality alone would pass
    // even with the presence guards removed and so would not test them. Spy on every factory so the
    // real tell of "never regenerates" is checkable: with the guards in place each is invoked once
    // across two boots; drop a guard and the second boot bumps its count to 2 and this fails.
    const base = deps(d);
    const spied = {
      ...base,
      mint: vi.fn(base.mint),
      makeKeyRing: vi.fn(base.makeKeyRing),
      makeToken: vi.fn(base.makeToken),
      listIpv4: vi.fn(base.listIpv4),
    };
    await ensureBoxSecrets(spied);
    const before = await readFile(join(d, "tls", "server.crt"), "utf8");
    const beforeEnv = await readFile(join(d, "secrets.env"), "utf8");
    await ensureBoxSecrets(spied); // second boot
    expect(await readFile(join(d, "tls", "server.crt"), "utf8")).toBe(before);
    expect(await readFile(join(d, "secrets.env"), "utf8")).toBe(beforeEnv);
    // The second boot touched neither the minter nor the secret factories.
    expect(spied.mint).toHaveBeenCalledTimes(1);
    expect(spied.listIpv4).toHaveBeenCalledTimes(1);
    expect(spied.makeKeyRing).toHaveBeenCalledTimes(1);
    expect(spied.makeToken).toHaveBeenCalledTimes(1);
  });

  it("puts 127.0.0.1 and the detected LAN IP into the leaf SANs", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    const { X509Certificate } = await import("node:crypto");
    const cert = new X509Certificate(await readFile(join(d, "tls", "server.crt"), "utf8"));
    expect(cert.subjectAltName).toContain("127.0.0.1");
    expect(cert.subjectAltName).toContain("192.168.1.50");
    expect(cert.subjectAltName).toContain("DNS:waitron.local");
  });

  // Every case above injects mint/makeKeyRing/makeToken/listIpv4, which leaves the REAL default
  // branches (mintSelfSignedServerCert, generateKeyRing, randomBytes token, defaultListIpv4)
  // unexercised. Task 4's boot test — which would drive them — does not exist yet, so this one
  // case runs ensureBoxSecrets with ONLY the required deps, exercising real keygen/entropy/os in a
  // single fresh temp dir and asserting the four PEMs + a well-formed secrets.env land.
  it("uses the real minter, key ring, token and IPv4 detection with no injectables", async () => {
    const d = await newDir();
    const tls = await ensureBoxSecrets({
      stateDir: d,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date("2026-08-26T00:00:00Z"),
    });
    // The real cert parses as an X509 certificate and the CA + private keys are present.
    const { X509Certificate } = await import("node:crypto");
    const serverCrt = await readFile(tls.certFile, "utf8");
    expect(() => new X509Certificate(serverCrt)).not.toThrow();
    expect(await readFile(tls.caCertFile, "utf8")).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(await readFile(tls.keyFile, "utf8")).toMatch(/-----BEGIN RSA PRIVATE KEY-----/);
    expect(await readFile(join(d, "tls", "ca.key"), "utf8")).toMatch(
      /-----BEGIN RSA PRIVATE KEY-----/,
    );
    // The real key ring is base64 of 32 bytes (44 chars, one '=' pad); the token is 32 bytes of hex.
    const env = await readFile(join(d, "secrets.env"), "utf8");
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY=[A-Za-z0-9+/]{43}=$/m);
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY_VERSION=1$/m);
    expect(env).toMatch(/^WAITRON_SYNC_NODE_TOKEN=[0-9a-f]{64}$/m);
    // The real leaf always carries 127.0.0.1 even if the box has no non-internal IPv4.
    const cert = new X509Certificate(serverCrt);
    expect(cert.subjectAltName).toContain("127.0.0.1");
  });
});
