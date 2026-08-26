import { X509Certificate } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { connect as tlsConnect } from "node:tls";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// One RSA-2048 keypair for the whole suite, injected into every mint so the suite pays keygen once
// rather than per-case. The two certs a mint returns differ by subject/extensions/issuer regardless
// of sharing a key, so this changes nothing the tests assert.
let sharedKeypair: forge.pki.rsa.KeyPair;
beforeAll(() => {
  sharedKeypair = forge.pki.rsa.generateKeyPair(2048);
});

const mint = (over: Record<string, unknown> = {}) =>
  mintSelfSignedServerCert({
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date("2026-08-26T00:00:00Z"),
    keypair: () => sharedKeypair,
    ...over,
  });

describe("mintSelfSignedServerCert", () => {
  it("mints a leaf carrying every requested hostname and IP as a SAN", () => {
    const { serverCertPem } = mint();
    const cert = new X509Certificate(serverCertPem);
    // subjectAltName is a comma-joined string like "DNS:waitron.local, DNS:localhost, IP Address:127.0.0.1"
    expect(cert.subjectAltName).toContain("DNS:waitron.local");
    expect(cert.subjectAltName).toContain("DNS:localhost");
    expect(cert.subjectAltName).toContain("127.0.0.1");
  });

  it("signs the leaf with the CA (leaf issuer == CA subject)", () => {
    const { caCertPem, serverCertPem } = mint();
    const ca = forge.pki.certificateFromPem(caCertPem);
    const leaf = forge.pki.certificateFromPem(serverCertPem);
    expect(leaf.issuer.getField("CN").value).toBe(ca.subject.getField("CN").value);
    // and the CA's public key actually verifies the leaf's signature:
    expect(ca.verify(leaf)).toBe(true);
  });

  it("sets the leaf subject CN to hostnames[0] and gives the CA and leaf distinct serials", () => {
    const { caCertPem, serverCertPem } = mint();
    const ca = forge.pki.certificateFromPem(caCertPem);
    const leaf = forge.pki.certificateFromPem(serverCertPem);
    // The CN the mint documents: the first requested hostname.
    expect(leaf.subject.getField("CN").value).toBe("waitron.local");
    // Distinct serials so the CA and its leaf are never conflated in a trust store.
    expect(leaf.serialNumber).not.toBe(ca.serialNumber);
  });

  it("sets a ~10-year validity window starting a day before `now`", () => {
    const now = new Date("2026-08-26T00:00:00Z");
    const { serverCertPem } = mint({ now });
    const leaf = forge.pki.certificateFromPem(serverCertPem);
    expect(leaf.validity.notBefore.getTime()).toBeLessThan(now.getTime());
    const years = (leaf.validity.notAfter.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(9);
  });

  it("throws when no hostname is given", () => {
    expect(() => mint({ hostnames: [] })).toThrow(/cert_hostnames_empty/);
  });

  // The default keypair factory — the real `forge.pki.rsa.generateKeyPair(2048)` branch that the
  // shared-keypair injection above never exercises. One real keygen (~300ms) so that default is
  // covered; assert the leaf it returns parses.
  it("generates a real keypair when none is injected", () => {
    const { serverCertPem } = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date("2026-08-26T00:00:00Z"),
    });
    const cert = new X509Certificate(serverCertPem);
    expect(cert.subjectAltName).toContain("DNS:waitron.local");
  });

  // The property that actually matters: the minted material completes a real TLS handshake
  // when the client trusts the CA, and fails when it does not.
  it("serves a TLS handshake a CA-trusting client accepts and an untrusting one rejects", async () => {
    const { caCertPem, serverCertPem, serverKeyPem } = mint();
    const server = createHttpsServer({ key: serverKeyPem, cert: serverCertPem }, (_req, res) =>
      res.end("ok"),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      // trusting the CA + dialing a SAN (127.0.0.1) → handshake authorized
      const okSocket = tlsConnect({
        port,
        host: "127.0.0.1",
        ca: caCertPem,
        servername: "localhost",
      });
      await new Promise<void>((res, rej) => {
        okSocket.on("secureConnect", res);
        okSocket.on("error", rej);
      });
      expect(okSocket.authorized).toBe(true);
      okSocket.destroy();
      // NOT trusting the CA → rejected
      const badSocket = tlsConnect({ port, host: "127.0.0.1", servername: "localhost" }); // no `ca`
      await new Promise<void>((res) => {
        badSocket.on("error", () => res());
        badSocket.on("secureConnect", () => res());
      });
      expect(badSocket.authorized).toBe(false);
      badSocket.destroy();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
