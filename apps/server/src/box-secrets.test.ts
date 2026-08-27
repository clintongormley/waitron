import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// `access` alone is wrapped so one test can inject a non-ENOENT failure for a single path; every
// other export (and every OTHER call to `access`) forwards to the real node:fs/promises
// implementation, so the rest of this file's real-fs tests are unaffected. `vi.hoisted` is needed
// because `vi.mock` factories run in an isolated scope — this is the documented way to reach the
// mock function from a test body.
const { accessMock } = vi.hoisted(() => ({ accessMock: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  accessMock.mockImplementation(actual.access);
  return { ...actual, access: accessMock };
});

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

  it("leaves no *.tmp files behind and creates the tls dir 0700", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    // Every file is written temp-then-rename; a successful run must have renamed all of them, so no
    // orphan *.tmp may linger in the state dir or its tls subdir. A lingering one would mean a rename
    // was skipped — i.e. a reader could see a torn file, the whole point of the atomic write.
    for (const dir of [d, join(d, "tls")]) {
      const names = await readdir(dir);
      expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    }
    // The tls dir holds the private material, so it is created owner-only. mode is masked by the
    // test's umask (mode & ~umask), so assert it is no WIDER than 0o700 rather than exactly equal.
    const tlsMode = (await stat(join(d, "tls"))).mode & 0o777;
    expect(tlsMode & ~0o700).toBe(0);
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

  it("dedupes 127.0.0.1 when listIpv4 also reports it (the leaf carries it exactly once)", async () => {
    const d = await newDir();
    // listIpv4 overlaps the loopback address ensureBoxSecrets always prepends; its `new Set` must
    // collapse the two so the leaf does not carry 127.0.0.1 as a duplicate SAN.
    await ensureBoxSecrets({ ...deps(d), listIpv4: () => ["127.0.0.1"] });
    const { X509Certificate } = await import("node:crypto");
    const cert = new X509Certificate(await readFile(join(d, "tls", "server.crt"), "utf8"));
    const san = cert.subjectAltName ?? "";
    // No other injected IP overlaps this substring (the dNSNames and 192.168.* are absent here), so a
    // plain count of the loopback address is exactly its SAN multiplicity.
    expect(san.split("127.0.0.1").length - 1).toBe(1);
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

  it("rethrows a non-ENOENT access error instead of treating the file as absent", async () => {
    const d = await newDir();
    // secrets.env exists (holds the unrepairable vault master key); a permission/IO error probing it
    // must NOT be read as "absent" — that would make ensureBoxSecrets mint a brand new key ring over
    // it and orphan anything already sealed under the old one. Simulate that by making `access` reject
    // with EACCES for exactly the secrets.env path, real fs otherwise (restored in `finally`, so a
    // failing assertion still cannot leak the override into a later test).
    const secretsFile = join(d, "secrets.env");
    const eacces = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    }) as NodeJS.ErrnoException;
    const passthrough = accessMock.getMockImplementation()!;
    accessMock.mockImplementation(async (p: unknown, ...rest: unknown[]) => {
      if (p === secretsFile) throw eacces;
      return (passthrough as (...a: unknown[]) => unknown)(p, ...rest);
    });
    try {
      await expect(ensureBoxSecrets(deps(d))).rejects.toBe(eacces);
    } finally {
      accessMock.mockImplementation(passthrough);
    }
    // Proves it wasn't swallowed-and-regenerated: nothing was ever written for secrets.env.
    await expect(readFile(secretsFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
