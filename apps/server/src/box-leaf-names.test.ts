import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureLeaf } from "./box-secrets.js";
import {
  issueClientCert,
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import { handshake, tlsFile, writeTlsSet } from "./testing/box-tls.js";

const OWN_NAME = "box-7f3a.waitron.local";
const HOSTNAMES = [OWN_NAME, "waitron.local", "localhost"];
const ADDRESS = "192.168.10.20";
const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";

let own: SelfSignedMaterial;
let other: SelfSignedMaterial;
const dirs: string[] = [];

beforeAll(() => {
  const now = new Date();
  own = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now });
  other = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now });
});

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A box holding its own authority and the given leaf. */
async function box(leaf: { serverCertPem: string; serverKeyPem: string }): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-leaf-names-"));
  dirs.push(stateDir);
  await writeTlsSet(stateDir, { caCertPem: own.caCertPem, caKeyPem: own.caKeyPem, ...leaf });
  return stateDir;
}

function leafFrom(authority: SelfSignedMaterial, hostnames: string[], ipAddresses: string[]) {
  return reissueServerLeaf({
    caCertPem: authority.caCertPem,
    caKeyPem: authority.caKeyPem,
    hostnames,
    ipAddresses,
    now: new Date(),
  });
}

function ensure(stateDir: string) {
  return ensureLeaf({
    stateDir,
    hostnames: HOSTNAMES,
    listIpv4: () => [ADDRESS],
    now: () => new Date(),
  });
}

describe("ensureLeaf", () => {
  it("a reissued leaf for box-7f3a.waitron.local verifies under the box's authority", async () => {
    const stateDir = await box(leafFrom(own, ["waitron.local", "localhost"], ["127.0.0.1"]));
    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).toBe("ERR_TLS_CERT_ALTNAME_INVALID");

    expect(await ensure(stateDir)).toBe("reissued");

    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).toBe("verified");
    const san = new X509Certificate(await tlsFile(stateDir, "server.pem")).subjectAltName ?? "";
    expect(san).toContain(`IP Address:${ADDRESS}`);
    expect(await tlsFile(stateDir, "ca.crt")).toBe(own.caCertPem);
  });

  it("reissues a leaf that names every host but lacks a current permitted address", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1"]));

    expect(await ensure(stateDir)).toBe("reissued");

    const san = new X509Certificate(await tlsFile(stateDir, "server.pem")).subjectAltName ?? "";
    expect(san).toContain(`IP Address:${ADDRESS}`);
  });

  it("a leaf already naming every name and address under this authority is left alone", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]));
    const cert = await tlsFile(stateDir, "server.pem");
    const key = await tlsFile(stateDir, "server.pem");

    expect(await ensure(stateDir)).toBe("kept");

    expect(await tlsFile(stateDir, "server.pem")).toBe(cert);
    expect(await tlsFile(stateDir, "server.pem")).toBe(key);
  });

  it("an address outside the permitted ranges does not make it reissue", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]));
    const cert = await tlsFile(stateDir, "server.pem");

    const result = await ensureLeaf({
      stateDir,
      hostnames: HOSTNAMES,
      listIpv4: () => [ADDRESS, "8.8.8.8"],
      now: () => new Date(),
    });

    expect(result).toBe("kept");
    expect(await tlsFile(stateDir, "server.pem")).toBe(cert);
  });

  it("a leaf with every name but another authority's signature is reissued", async () => {
    const stateDir = await box(leafFrom(other, HOSTNAMES, ["127.0.0.1", ADDRESS]));

    expect(await ensure(stateDir)).toBe("reissued");

    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).toBe("verified");
  });

  it("control: a leaf another authority signed is refused by a client pinning this one", async () => {
    const stateDir = await box(leafFrom(other, HOSTNAMES, ["127.0.0.1", ADDRESS]));

    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).toBe("CERT_SIGNATURE_FAILURE");
  });

  it("a leaf naming everything under this authority but paired with another key is reissued", async () => {
    const leaf = leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]);
    const stray = leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]);
    const stateDir = await box({
      serverCertPem: leaf.serverCertPem,
      serverKeyPem: stray.serverKeyPem,
    });

    expect(await ensure(stateDir)).toBe("reissued");

    const cert = new X509Certificate(await tlsFile(stateDir, "server.pem"));
    expect(cert.checkPrivateKey(createPrivateKey(await tlsFile(stateDir, "server.pem")))).toBe(
      true,
    );
    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).toBe("verified");
  });

  it("a failed reissue rejects and keeps the old leaf", async () => {
    const stateDir = await box(leafFrom(own, ["localhost"], ["127.0.0.1"]));
    const cert = await tlsFile(stateDir, "server.pem");
    const key = await tlsFile(stateDir, "server.pem");
    await rm(join(stateDir, "tls", "ca.key"));

    await expect(ensure(stateDir)).rejects.toMatchObject({ code: "ENOENT" });

    expect(await tlsFile(stateDir, "server.pem")).toBe(cert);
    expect(await tlsFile(stateDir, "server.pem")).toBe(key);
  });

  it("every start leaves a client certificate for this box's name under its authority", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]));

    await ensure(stateDir);

    const cert = new X509Certificate(await tlsFile(stateDir, "client.crt"));
    expect(cert.verify(new X509Certificate(own.caCertPem).publicKey)).toBe(true);
    expect(cert.checkPrivateKey(createPrivateKey(await tlsFile(stateDir, "client.key")))).toBe(
      true,
    );
    expect(cert.subjectAltName).toBe(`DNS:${OWN_NAME}`);
    expect(cert.keyUsage).toEqual([CLIENT_AUTH]);
    const first = await tlsFile(stateDir, "client.crt");

    await ensure(stateDir);
    expect(await tlsFile(stateDir, "client.crt")).toBe(first);

    const elsewhere = issueClientCert({
      caCertPem: other.caCertPem,
      caKeyPem: other.caKeyPem,
      hostname: OWN_NAME,
      now: new Date(),
    });
    await writeFile(join(stateDir, "tls", "client.crt"), elsewhere.clientCertPem);
    await writeFile(join(stateDir, "tls", "client.key"), elsewhere.clientKeyPem);

    await ensure(stateDir);

    const reissued = new X509Certificate(await tlsFile(stateDir, "client.crt"));
    expect(reissued.verify(new X509Certificate(own.caCertPem).publicKey)).toBe(true);
    expect(reissued.checkPrivateKey(createPrivateKey(await tlsFile(stateDir, "client.key")))).toBe(
      true,
    );
  });

  describe("issues the client certificate again when the one on disk", () => {
    const authority = () => new X509Certificate(own.caCertPem).publicKey;

    /** A box whose stored client pair is `cert` and `key`; returns the box once `ensureLeaf` ran. */
    async function ensuredWith(cert: string, key: string): Promise<string> {
      const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]));
      await writeFile(join(stateDir, "tls", "client.crt"), cert);
      await writeFile(join(stateDir, "tls", "client.key"), key);
      await ensure(stateDir);
      return stateDir;
    }

    async function expectCurrentClientPair(stateDir: string, replaced: string) {
      const pem = await tlsFile(stateDir, "client.crt");
      expect(pem).not.toBe(replaced);
      const cert = new X509Certificate(pem);
      expect(cert.verify(authority())).toBe(true);
      expect(cert.checkPrivateKey(createPrivateKey(await tlsFile(stateDir, "client.key")))).toBe(
        true,
      );
      expect(cert.subjectAltName).toBe(`DNS:${OWN_NAME}`);
      expect(cert.keyUsage).toEqual([CLIENT_AUTH]);
      expect(cert.validFromDate.getTime()).toBeLessThanOrEqual(Date.now());
      expect(cert.validToDate.getTime()).toBeGreaterThan(Date.now());
    }

    const issuedAt = (now: Date) =>
      issueClientCert({
        caCertPem: own.caCertPem,
        caKeyPem: own.caKeyPem,
        hostname: OWN_NAME,
        now,
      });

    it("has expired", async () => {
      const expired = issuedAt(new Date("2000-01-01T00:00:00Z"));
      expect(new X509Certificate(expired.clientCertPem).validToDate.getTime()).toBeLessThan(
        Date.now(),
      );
      const stateDir = await ensuredWith(expired.clientCertPem, expired.clientKeyPem);
      await expectCurrentClientPair(stateDir, expired.clientCertPem);
    });

    it("is not valid yet, minted before the clock was set back", async () => {
      const ahead = issuedAt(new Date(Date.now() + 3 * 86_400_000));
      const stateDir = await ensuredWith(ahead.clientCertPem, ahead.clientKeyPem);
      await expectCurrentClientPair(stateDir, ahead.clientCertPem);
    });

    it("is for serving only, not for a client", async () => {
      const leaf = leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]);
      expect(new X509Certificate(leaf.serverCertPem).keyUsage).not.toContain(CLIENT_AUTH);
      const stateDir = await ensuredWith(leaf.serverCertPem, leaf.serverKeyPem);
      await expectCurrentClientPair(stateDir, leaf.serverCertPem);
    });

    it("has a key that cannot be read", async () => {
      const current = issuedAt(new Date());
      const stateDir = await ensuredWith(current.clientCertPem, "not a key\n");
      await expectCurrentClientPair(stateDir, current.clientCertPem);
    });

    it("cannot be read itself", async () => {
      const current = issuedAt(new Date());
      const stateDir = await ensuredWith("not a certificate\n", current.clientKeyPem);
      await expectCurrentClientPair(stateDir, "not a certificate\n");
    });

    it("control: is current, for a client, and paired with its key, so it is kept", async () => {
      const current = issuedAt(new Date());
      const stateDir = await ensuredWith(current.clientCertPem, current.clientKeyPem);
      expect(await tlsFile(stateDir, "client.crt")).toBe(current.clientCertPem);
      expect(await tlsFile(stateDir, "client.key")).toBe(current.clientKeyPem);
    });
  });

  it("does nothing on a box with no minted leaf", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-leaf-names-none-"));
    dirs.push(stateDir);

    expect(await ensure(stateDir)).toBe("kept");
  });
});
