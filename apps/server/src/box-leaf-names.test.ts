import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer } from "node:tls";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureLeaf } from "./box-secrets.js";
import {
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";

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
  const tls = join(stateDir, "tls");
  await mkdir(tls, { mode: 0o700 });
  await writeFile(join(tls, "ca.crt"), own.caCertPem, { mode: 0o600 });
  await writeFile(join(tls, "ca.key"), own.caKeyPem, { mode: 0o600 });
  await writeFile(join(tls, "server.crt"), leaf.serverCertPem, { mode: 0o600 });
  await writeFile(join(tls, "server.key"), leaf.serverKeyPem, { mode: 0o600 });
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

const tlsFile = (stateDir: string, name: string) => readFile(join(stateDir, "tls", name), "utf8");

function ensure(stateDir: string) {
  return ensureLeaf({
    stateDir,
    hostnames: HOSTNAMES,
    listIpv4: () => [ADDRESS],
    now: () => new Date(),
  });
}

/** Serves the box's leaf and connects as a device pinning `caPem`, naming `servername`. */
async function handshake(stateDir: string, caPem: string, servername: string): Promise<string> {
  const server = createServer({
    cert: await tlsFile(stateDir, "server.crt"),
    key: await tlsFile(stateDir, "server.key"),
  });
  server.on("secureConnection", (socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<string>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port, servername, ca: caPem });
      socket.once("secureConnect", () => {
        socket.destroy();
        resolve("verified");
      });
      socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
