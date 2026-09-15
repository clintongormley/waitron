import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import forge from "node-forge";
import { certificate } from "../certificate.js";

export interface MtlsMaterial {
  caPem: string;
  serverKeyPem: string;
  serverCertPem: string;
  /** DER-encoded PKCS#12, the same shape the vault stores base64 of. */
  clientPfx: Buffer;
  clientPassphrase: string;
  clientCn: string;
}

const CA_CN = "waitron-test-ca";
const SERIAL = "01";
const VALIDITY = { notBefore: new Date(2026, 0, 1), notAfter: new Date(2030, 0, 1) };

function keypair(): forge.pki.rsa.KeyPair {
  return forge.pki.rsa.generateKeyPair(2048);
}

/**
 * A private CA, a server certificate for `localhost` and `127.0.0.1`, and a client certificate
 * exported as PKCS#12 — everything a real client-certificate handshake needs, minted in-process.
 *
 * node-forge rather than `openssl`: no binary need be installed, and `node:crypto` can read PKCS#12
 * but not create it.
 */
export function mintMtlsMaterial(): MtlsMaterial {
  const caKeys = keypair();
  const issuer = { cn: CA_CN, key: caKeys.privateKey };
  const caCert = certificate(CA_CN, caKeys, issuer, SERIAL, VALIDITY, [
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  ]);

  const serverKeys = keypair();
  const serverCert = certificate("localhost", serverKeys, issuer, SERIAL, VALIDITY, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
      ],
    },
  ]);

  const clientCn = "waitron-test-client";
  const clientKeys = keypair();
  const clientCert = certificate(clientCn, clientKeys, issuer, SERIAL, VALIDITY, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true },
    { name: "extKeyUsage", clientAuth: true },
  ]);

  const clientPassphrase = "pfx-passphrase";
  const p12 = forge.pkcs12.toPkcs12Asn1(
    clientKeys.privateKey,
    [clientCert, caCert],
    clientPassphrase,
  );
  const der = forge.asn1.toDer(p12).getBytes();

  return {
    caPem: forge.pki.certificateToPem(caCert),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(serverCert),
    clientPfx: Buffer.from(der, "binary"),
    clientPassphrase,
    clientCn,
  };
}

export interface MtlsServer {
  origin: string;
  /** The CN the last accepted connection presented, or null if no request has arrived. */
  sawClientCn: () => string | null;
  /**
   * How many requests the handler has run. Node runs it only after the TLS handshake, client
   * certificate check included, has completed — so a caller expecting a refused connection asserts
   * this did NOT move, rather than trusting a client-side error that a wrong CA or a broken fixture
   * would produce just as readily.
   */
  requests: () => number;
  close: () => Promise<void>;
}

/**
 * An HTTPS server that requires AND verifies a client certificate. `rejectUnauthorized` is Node's
 * default once `requestCert` is set; it is spelled out because with it `false` the server answers a
 * client that presents no certificate.
 */
export async function startMtlsServer(
  material: MtlsMaterial,
  respondWith: string,
): Promise<MtlsServer> {
  let lastCn: string | null = null;
  let requestCount = 0;
  const options: ServerOptions = {
    key: material.serverKeyPem,
    cert: material.serverCertPem,
    ca: material.caPem,
    requestCert: true,
    rejectUnauthorized: true,
  };
  const server = createServer(options, (req, res) => {
    requestCount += 1;
    const peer = (req.socket as TLSSocket).getPeerCertificate();
    // An X.509 subject may repeat an RDN, so `CN` is typed `string | string[]`.
    const cn = peer.subject?.CN;
    lastCn = Array.isArray(cn) ? (cn[0] ?? null) : (cn ?? null);
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    res.end(respondWith);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    // The bound IP, not `localhost`: on a dual-stack host `localhost` resolves to `::1` first, where
    // nothing listens. The server certificate carries a `127.0.0.1` iPAddress SAN.
    origin: `https://127.0.0.1:${port}`,
    sawClientCn: () => lastCn,
    requests: () => requestCount,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
