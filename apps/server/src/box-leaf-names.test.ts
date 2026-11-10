import { mkdtemp, rm } from "node:fs/promises";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureLeaf } from "./box-secrets.js";
import {
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import { handshake, tlsFile, writeTlsSet } from "./testing/box-tls.js";

const OWN_NAME = "box-7f3a.waitron.local";
const HOSTNAMES = [OWN_NAME, "waitron.local", "localhost"];
const ADDRESS = "192.168.10.20";

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
    const san = new X509Certificate(await tlsFile(stateDir, "server.crt")).subjectAltName ?? "";
    expect(san).toContain(`IP Address:${ADDRESS}`);
    expect(await tlsFile(stateDir, "ca.crt")).toBe(own.caCertPem);
  });

  it("reissues a leaf that names every host but lacks a current permitted address", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1"]));

    expect(await ensure(stateDir)).toBe("reissued");

    const san = new X509Certificate(await tlsFile(stateDir, "server.crt")).subjectAltName ?? "";
    expect(san).toContain(`IP Address:${ADDRESS}`);
  });

  it("a leaf already naming every name and address under this authority is left alone", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]));
    const cert = await tlsFile(stateDir, "server.crt");
    const key = await tlsFile(stateDir, "server.key");

    expect(await ensure(stateDir)).toBe("kept");

    expect(await tlsFile(stateDir, "server.crt")).toBe(cert);
    expect(await tlsFile(stateDir, "server.key")).toBe(key);
  });

  it("an address outside the permitted ranges does not make it reissue", async () => {
    const stateDir = await box(leafFrom(own, HOSTNAMES, ["127.0.0.1", ADDRESS]));
    const cert = await tlsFile(stateDir, "server.crt");

    const result = await ensureLeaf({
      stateDir,
      hostnames: HOSTNAMES,
      listIpv4: () => [ADDRESS, "8.8.8.8"],
      now: () => new Date(),
    });

    expect(result).toBe("kept");
    expect(await tlsFile(stateDir, "server.crt")).toBe(cert);
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

    const cert = new X509Certificate(await tlsFile(stateDir, "server.crt"));
    expect(cert.checkPrivateKey(createPrivateKey(await tlsFile(stateDir, "server.key")))).toBe(
      true,
    );
    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).toBe("verified");
  });

  it("a failed reissue rejects and keeps the old leaf", async () => {
    const stateDir = await box(leafFrom(own, ["localhost"], ["127.0.0.1"]));
    const cert = await tlsFile(stateDir, "server.crt");
    const key = await tlsFile(stateDir, "server.key");
    await rm(join(stateDir, "tls", "ca.key"));

    await expect(ensure(stateDir)).rejects.toMatchObject({ code: "ENOENT" });

    expect(await tlsFile(stateDir, "server.crt")).toBe(cert);
    expect(await tlsFile(stateDir, "server.key")).toBe(key);
  });

  it("does nothing on a box with no minted leaf", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-leaf-names-none-"));
    dirs.push(stateDir);

    expect(await ensure(stateDir)).toBe("kept");
  });
});
