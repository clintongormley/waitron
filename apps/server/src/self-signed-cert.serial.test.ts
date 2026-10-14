import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import forge from "node-forge";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mintSelfSignedServerCert, reissueServerLeaf } from "./self-signed-cert.js";

const forced = vi.hoisted(() => ({ bytes: undefined as Buffer | undefined }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: ((size: number) =>
      forced.bytes
        ? Buffer.from(forced.bytes)
        : actual.randomBytes(size)) as typeof actual.randomBytes,
  };
});

let sharedKeypair: forge.pki.rsa.KeyPair;
beforeAll(() => {
  sharedKeypair = forge.pki.rsa.generateKeyPair(2048);
});

afterEach(() => {
  forced.bytes = undefined;
});

const now = new Date("2026-08-26T00:00:00Z");
const hostnames = ["waitron.local"];
const ipAddresses = ["127.0.0.1"];

function expectLoadable(certPem: string, keyPem?: string): void {
  const cert = new X509Certificate(certPem);
  expect(BigInt(`0x${cert.serialNumber}`)).toBeGreaterThan(0n);
  if (keyPem) expect(() => createSecureContext({ key: keyPem, cert: certPem })).not.toThrow();
}

// Each draw starts with two zero bytes after the sign bit is cleared, which DER must not pad.
const paddedDraws: Array<[string, Buffer]> = [
  ["all zeros", Buffer.alloc(16)],
  ["0x80 then 0x00 0x00", Buffer.from([0x80, 0x00, 0x00, ...Array<number>(13).fill(0x11)])],
];
// A draw that never needed padding: the test must pass on it whatever the fix.
const plainDraws: Array<[string, Buffer]> = [["every byte 0x3f", Buffer.alloc(16, 0x3f)]];

describe("certificate serials", () => {
  it.each([...paddedDraws, ...plainDraws])(
    "mint gives a CA and leaf that OpenSSL loads when the draw is %s",
    (_label, draw) => {
      forced.bytes = draw;
      const material = mintSelfSignedServerCert({
        hostnames,
        ipAddresses,
        now,
        keypair: () => sharedKeypair,
      });
      expectLoadable(material.caCertPem);
      expectLoadable(material.serverCertPem, material.serverKeyPem);
    },
  );

  it.each([...paddedDraws, ...plainDraws])(
    "reissue gives a leaf that OpenSSL loads when the draw is %s",
    (_label, draw) => {
      const material = mintSelfSignedServerCert({
        hostnames,
        ipAddresses,
        now,
        keypair: () => sharedKeypair,
      });
      forced.bytes = draw;
      const leaf = reissueServerLeaf({
        caCertPem: material.caCertPem,
        caKeyPem: material.caKeyPem,
        hostnames,
        ipAddresses,
        now,
        keypair: () => sharedKeypair,
      });
      expectLoadable(leaf.serverCertPem, leaf.serverKeyPem);
    },
  );
});
