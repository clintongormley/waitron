import { request } from "node:https";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { mintMtlsMaterial, startMtlsServer, type MtlsMaterial } from "./mtls.js";

// Three RSA-2048 keypairs in pure JavaScript: minted once for the file.
const material = mintMtlsMaterial();

function get(
  origin: string,
  client: Pick<MtlsMaterial, "clientPfx" | "clientPassphrase"> | undefined,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      `${origin}/`,
      {
        ca: material.caPem,
        ...(client ? { pfx: client.clientPfx, passphrase: client.clientPassphrase } : {}),
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("mintMtlsMaterial", () => {
  it("mints a CA-signed server certificate and a PKCS#12 client bundle chained to the same CA", () => {
    const ca = forge.pki.certificateFromPem(material.caPem);
    const server = forge.pki.certificateFromPem(material.serverCertPem);
    expect(ca.verify(server)).toBe(true);
    expect(server.subject.getField("CN").value).toBe("localhost");
    expect(server.serialNumber).toBe("01");
    expect(server.validity.notBefore).toEqual(new Date(2026, 0, 1));
    expect(server.validity.notAfter).toEqual(new Date(2030, 0, 1));

    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(material.clientPfx.toString("binary")),
      material.clientPassphrase,
    );
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const client = bags[0]?.cert;
    expect(client?.subject.getField("CN").value).toBe(material.clientCn);
    expect(client && ca.verify(client)).toBe(true);
    expect(client?.getExtension("extKeyUsage")).toMatchObject({ clientAuth: true });
  });
});

describe("startMtlsServer", () => {
  it("serves a client presenting the minted certificate and records its CN", async () => {
    const server = await startMtlsServer(material, "<ok/>");
    try {
      expect(server.origin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
      expect(server.sawClientCn()).toBeNull();
      await expect(get(server.origin, material)).resolves.toEqual({ status: 200, body: "<ok/>" });
      expect(server.sawClientCn()).toBe(material.clientCn);
      expect(server.requests()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("refuses a client with no certificate before its handler runs", async () => {
    const server = await startMtlsServer(material, "<ok/>");
    try {
      await expect(get(server.origin, undefined)).rejects.toThrow();
      expect(server.requests()).toBe(0);
      expect(server.sawClientCn()).toBeNull();
    } finally {
      await server.close();
    }
  });
});
