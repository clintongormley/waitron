import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";

/**
 * The shape `forge.pki.Certificate#setExtensions` actually accepts. The installed `@types/node-forge`
 * (1.3.14) types that parameter as `any[]` and exports no `CertificateExtension` — so this is this
 * file's own, narrower stand-in for the four extension shapes `mintMtlsMaterial` constructs below.
 */
interface CertExtension {
  name: string;
  cA?: boolean;
  keyCertSign?: boolean;
  digitalSignature?: boolean;
  keyEncipherment?: boolean;
  serverAuth?: boolean;
  clientAuth?: boolean;
  altNames?: Array<{ type: number; value?: string; ip?: string }>;
}

export interface MtlsMaterial {
  caPem: string;
  serverKeyPem: string;
  serverCertPem: string;
  /** DER-encoded PKCS#12, the same shape the vault stores base64 of. */
  clientPfx: Buffer;
  clientPassphrase: string;
  clientCn: string;
}

function keypair(): forge.pki.rsa.KeyPair {
  return forge.pki.rsa.generateKeyPair(2048);
}

function certificate(
  subjectCn: string,
  subjectKeys: forge.pki.rsa.KeyPair,
  issuer: { cn: string; key: forge.pki.rsa.PrivateKey },
  extensions: CertExtension[],
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = subjectKeys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(2026, 0, 1);
  cert.validity.notAfter = new Date(2030, 0, 1);
  cert.setSubject([{ name: "commonName", value: subjectCn }]);
  cert.setIssuer([{ name: "commonName", value: issuer.cn }]);
  cert.setExtensions(extensions);
  cert.sign(issuer.key, forge.md.sha256.create());
  return cert;
}

/**
 * A private CA, a `localhost` server certificate and a client certificate exported as PKCS#12 —
 * everything a real client-certificate handshake needs, minted in-process.
 *
 * node-forge rather than shelling out to `openssl`: the suite must not depend on a binary being
 * installed on a CI image, and it must produce PKCS#12 (the shape the vault actually stores),
 * which `node:crypto` can read but not create.
 */
export function mintMtlsMaterial(): MtlsMaterial {
  const caKeys = keypair();
  const caCert = certificate(
    "waitron-test-ca",
    caKeys,
    { cn: "waitron-test-ca", key: caKeys.privateKey },
    [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true },
    ],
  );

  const serverKeys = keypair();
  const serverCert = certificate(
    "localhost",
    serverKeys,
    { cn: "waitron-test-ca", key: caKeys.privateKey },
    [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      // type 2 is dNSName, type 7 is iPAddress — both, so the test can dial either.
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  );

  const clientCn = "waitron-test-client";
  const clientKeys = keypair();
  const clientCert = certificate(
    clientCn,
    clientKeys,
    { cn: "waitron-test-ca", key: caKeys.privateKey },
    [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true },
      { name: "extKeyUsage", clientAuth: true },
    ],
  );

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
   * How many requests this server's HANDLER has actually run. Node only invokes it once a TLS
   * connection — including the mutual-auth check — has completed, so this is the server-side
   * signal that a "refused" attempt never got that far: a caller expecting a rejected connection
   * asserts this count did NOT move, rather than trusting a client-side error's mere existence
   * (which a wrong CA, a moved origin, or a broken fixture cert would produce just as reliably,
   * for a reason that has nothing to do with the server refusing anything).
   */
  requests: () => number;
  close: () => Promise<void>;
}

/**
 * An HTTPS server that REQUIRES and VERIFIES a client certificate — `requestCert` alone would
 * accept an unauthenticated connection and prove nothing, so `rejectUnauthorized` is the half that
 * makes this a test of mTLS rather than of TLS.
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
    const peer = (req.socket as import("node:tls").TLSSocket).getPeerCertificate();
    // `@types/node` types `CN` as `string | string[]` — an X.509 subject may repeat an RDN — so a
    // single-valued CN (the only shape this fixture ever mints) is unwrapped from that array case.
    const cn = peer.subject?.CN;
    lastCn = Array.isArray(cn) ? (cn[0] ?? null) : (cn ?? null);
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    res.end(respondWith);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    // `127.0.0.1`, matching the bound address — NOT `localhost`. `localhost` resolves to `::1`
    // first on a dual-stack host, so a client dialling it would reach an address nothing is
    // listening on and fail to connect, which in THIS suite would read as a failed mTLS handshake
    // rather than the DNS-ordering accident it is. The minted server certificate carries both a
    // `localhost` dNSName and a `127.0.0.1` iPAddress SAN (see `certificate()` above), so naming
    // the IP costs no validity.
    origin: `https://127.0.0.1:${port}`,
    sawClientCn: () => lastCn,
    requests: () => requestCount,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
