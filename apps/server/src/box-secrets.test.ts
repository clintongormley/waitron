import { execFileSync } from "node:child_process";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { ensureBoxSecrets, mintedBoxLeaf, reissueBoxLeaf } from "./box-secrets.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// `access` alone is wrapped so one test can inject a non-ENOENT failure for a single path; every
// other call forwards to the real implementation.
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
  listIpv4: () => ["192.168.1.50"],
});

describe("ensureBoxSecrets", () => {
  it("materialises the cert + secrets on first call and returns the TLS paths", async () => {
    const d = await newDir();
    const tls = await ensureBoxSecrets(deps(d));
    expect(tls.certFile).toBe(join(d, "tls", "server.crt"));
    expect(tls.keyFile).toBe(join(d, "tls", "server.key"));
    expect(tls.caCertFile).toBe(join(d, "tls", "ca.crt"));
    const env = await readFile(join(d, "secrets.env"), "utf8");
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY=/m);
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY_VERSION=1$/m);
  });

  it("writes all four PEMs and the secrets file 0600 (owner-only, uniform)", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    for (const f of [
      "tls/server.key",
      "tls/ca.key",
      "tls/server.crt",
      "tls/ca.crt",
      "secrets.env",
    ]) {
      const mode = (await stat(join(d, f))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("leaves no *.tmp files behind and creates the tls dir 0700", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    for (const dir of [d, join(d, "tls")]) {
      const names = await readdir(dir);
      expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    }
    // mode is masked by the umask, so assert it is no WIDER than 0o700 rather than exactly equal.
    const tlsMode = (await stat(join(d, "tls"))).mode & 0o777;
    expect(tlsMode & ~0o700).toBe(0);
  });

  it("is idempotent: a second call reuses the exact same bytes and regenerates nothing", async () => {
    const d = await newDir();
    // The injected key-ring factory is fixed, so a re-written secrets.env would be byte-identical:
    // byte-equality alone cannot tell reuse from regeneration. The factory call counts can.
    const base = deps(d);
    const spied = {
      ...base,
      mint: vi.fn(base.mint),
      makeKeyRing: vi.fn(base.makeKeyRing),
      listIpv4: vi.fn(base.listIpv4),
    };
    await ensureBoxSecrets(spied);
    const before = await readFile(join(d, "tls", "server.crt"), "utf8");
    const beforeEnv = await readFile(join(d, "secrets.env"), "utf8");
    await ensureBoxSecrets(spied); // second boot
    expect(await readFile(join(d, "tls", "server.crt"), "utf8")).toBe(before);
    expect(await readFile(join(d, "secrets.env"), "utf8")).toBe(beforeEnv);
    expect(spied.mint).toHaveBeenCalledTimes(1);
    expect(spied.listIpv4).toHaveBeenCalledTimes(1);
    expect(spied.makeKeyRing).toHaveBeenCalledTimes(1);
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
    await ensureBoxSecrets({ ...deps(d), listIpv4: () => ["127.0.0.1"] });
    const { X509Certificate } = await import("node:crypto");
    const cert = new X509Certificate(await readFile(join(d, "tls", "server.crt"), "utf8"));
    const san = cert.subjectAltName ?? "";
    // No other injected IP overlaps this substring (the dNSNames and 192.168.* are absent here), so a
    // plain count of the loopback address is exactly its SAN multiplicity.
    expect(san.split("127.0.0.1").length - 1).toBe(1);
  });

  it("drops candidate IP SANs outside the CA's permitted set, keeping loopback + a permitted LAN IP", async () => {
    const d = await newDir();
    // Left unfiltered, one out-of-set address fails the whole leaf against the CA's nameConstraints.
    await ensureBoxSecrets({
      ...deps(d),
      listIpv4: () => ["192.168.1.50", "100.64.1.2", "169.254.1.2"],
    });
    const { X509Certificate } = await import("node:crypto");
    const cert = new X509Certificate(await readFile(join(d, "tls", "server.crt"), "utf8"));
    const san = cert.subjectAltName ?? "";
    expect(san).toContain("127.0.0.1"); // loopback — inside 127.0.0.0/8
    expect(san).toContain("192.168.1.50"); // a permitted RFC1918 LAN IP is retained
    expect(san).not.toContain("100.64.1.2"); // CGNAT — outside the permitted subtrees
    expect(san).not.toContain("169.254.1.2"); // link-local — outside the permitted subtrees
    expect(san).toContain("DNS:waitron.local");
  });

  // Every other case injects mint/makeKeyRing/listIpv4; this one runs the real defaults.
  it("uses the real minter, key ring and IPv4 detection with no injectables", async () => {
    const d = await newDir();
    const tls = await ensureBoxSecrets({
      stateDir: d,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date("2026-08-26T00:00:00Z"),
    });
    const { X509Certificate } = await import("node:crypto");
    const serverCrt = await readFile(tls.certFile, "utf8");
    expect(() => new X509Certificate(serverCrt)).not.toThrow();
    expect(await readFile(tls.caCertFile, "utf8")).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(await readFile(tls.keyFile, "utf8")).toMatch(/-----BEGIN RSA PRIVATE KEY-----/);
    expect(await readFile(join(d, "tls", "ca.key"), "utf8")).toMatch(
      /-----BEGIN RSA PRIVATE KEY-----/,
    );
    // The real key ring is base64 of 32 bytes (44 chars, one '=' pad).
    const env = await readFile(join(d, "secrets.env"), "utf8");
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY=[A-Za-z0-9+/]{43}=$/m);
    expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY_VERSION=1$/m);
    // The real leaf always carries 127.0.0.1 even if the box has no non-internal IPv4.
    const cert = new X509Certificate(serverCrt);
    expect(cert.subjectAltName).toContain("127.0.0.1");
  });

  it("rethrows a non-ENOENT access error instead of treating the file as absent", async () => {
    const d = await newDir();
    // Read as "absent", a permission error on secrets.env would mint a new key ring over it and
    // orphan everything sealed under the old one.
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
    await expect(readFile(secretsFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("reissueBoxLeaf", () => {
  const reissue = (stateDir: string) =>
    reissueBoxLeaf({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date("2026-09-23T10:00:00Z"),
      listIpv4: () => ["192.168.1.77"],
    });
  const pairOf = async (stateDir: string) => ({
    cert: await readFile(join(stateDir, "tls", "server.crt"), "utf8"),
    key: await readFile(join(stateDir, "tls", "server.key"), "utf8"),
  });

  it("replaces the pair and leaves no working file behind", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    const before = await pairOf(d);
    await reissue(d);
    const after = await pairOf(d);
    expect(after.cert).not.toBe(before.cert);
    expect(new X509Certificate(after.cert).checkPrivateKey(createPrivateKey(after.key))).toBe(true);
    expect((await readdir(join(d, "tls"))).sort()).toEqual([
      "ca.crt",
      "ca.key",
      "server.crt",
      "server.key",
    ]);
  });

  // The listener reads both files and refuses a certificate whose key does not match, so a write
  // that fails part-way must leave the pair it found.
  it.each(["server.crt", "server.key"])(
    "keeps the old, matching pair when writing the new %s fails",
    async (blocked) => {
      const d = await newDir();
      await ensureBoxSecrets(deps(d));
      const before = await pairOf(d);
      // A directory where that file's working copy goes, so writing it fails.
      await mkdir(join(d, "tls", `${blocked}.tmp`));
      await expect(reissue(d)).rejects.toThrow();
      expect(await pairOf(d)).toEqual(before);
      const leftover = (await readdir(join(d, "tls"))).filter(
        (name) => name.endsWith(".tmp") && name !== `${blocked}.tmp`,
      );
      expect(leftover).toEqual([]);
    },
  );
});

describe("mintedBoxLeaf", () => {
  it("is undefined when the box has never minted a leaf", async () => {
    expect(mintedBoxLeaf(await newDir())).toBeUndefined();
  });

  it("is undefined when only one half of the pair is present (a half-written quartet)", async () => {
    // `server.key` is `ensureBoxSecrets`'s presence sentinel, written LAST, so a crash between the
    // renames can leave `server.crt` alone — the box must NOT try to serve that lone cert.
    const d = await newDir();
    await mkdir(join(d, "tls"));
    await writeFile(join(d, "tls", "server.crt"), "x");
    expect(mintedBoxLeaf(d)).toBeUndefined();
  });

  it("is the box's own leaf when the state volume holds both halves", async () => {
    const d = await newDir();
    await ensureBoxSecrets(deps(d));
    expect(mintedBoxLeaf(d)).toEqual({
      certFile: join(d, "tls", "server.crt"),
      keyFile: join(d, "tls", "server.key"),
    });
  });
});

function haveOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// node-forge's verifyCertificateChain does NOT enforce nameConstraints (lib/x509.js §"check names
// with permitted names tree" is a TODO), so openssl is the only local proof that the filtered leaf
// carries no SAN the CA refuses.
describe.runIf(haveOpenssl())("ensureBoxSecrets leaf verifies against its own CA (openssl)", () => {
  it("mints a leaf that verifies even when the interface list carries out-of-set addresses", async () => {
    const d = await newDir();
    await ensureBoxSecrets({
      ...deps(d),
      listIpv4: () => ["192.168.1.50", "100.64.1.2", "169.254.1.2"],
    });
    const out = execFileSync(
      "openssl",
      ["verify", "-CAfile", join(d, "tls", "ca.crt"), join(d, "tls", "server.crt")],
      { encoding: "utf8" },
    );
    expect(out).toMatch(/OK/);
  });
});
