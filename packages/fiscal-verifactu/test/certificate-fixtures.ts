import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import type { MtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import forge from "node-forge";

export interface CandidateOptions {
  /** `null` leaves the subject's O out; an array repeats it. */
  organisation?: string | string[] | null;
  /** `null` leaves the subject's organizationIdentifier (2.5.4.97) out; an array repeats it. */
  organizationIdentifier?: string | string[] | null;
  notBefore?: Date;
  notAfter?: Date;
  passphrase?: string;
  algorithm?: "aes256" | "3des";
  /** `false` writes the file with no private key. */
  withKey?: boolean;
  signedBy?: "authority" | "stranger";
  commonName?: string;
}

export interface Candidate {
  pfx: Buffer;
  passphrase: string;
  fingerprint: string;
}

export interface FixtureAuthority {
  caPem: string;
  serverKeyPem: string;
  serverCertPem: string;
  issue(options?: CandidateOptions): Candidate;
  /** The same issued certificate in a new file, so its fingerprint is unchanged. */
  repack(candidate: Candidate, algorithm: "aes256" | "3des"): Candidate;
}

interface Issued {
  cert: forge.pki.Certificate;
  chain: forge.pki.Certificate[];
  withKey: boolean;
  commonName: string;
}

interface Signer {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
}

type Attribute = { name?: string; type?: string; value: string; valueTagClass?: number };

// node:crypto rather than forge generates the keys: forge's pure-JavaScript RSA generation is the
// slow part of building a certificate.
function keyPair(): forge.pki.rsa.KeyPair {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const key = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;
  return { privateKey: key, publicKey: forge.pki.setRsaPublicKey(key.n, key.e) };
}

const CANDIDATE_KEYS = keyPair();
let serial = 1;

function utf8(attributes: Attribute[]): Attribute[] {
  return attributes.map((a) => ({ ...a, valueTagClass: forge.asn1.Type.UTF8 as number }));
}

function sign(
  subject: Attribute[],
  publicKey: forge.pki.PublicKey,
  issuer: Signer | null,
  ownKey: forge.pki.rsa.PrivateKey,
  validity: { notBefore: Date; notAfter: Date },
  extensions: object[],
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = (serial++).toString(16).padStart(2, "0");
  cert.validity.notBefore = validity.notBefore;
  cert.validity.notAfter = validity.notAfter;
  cert.setSubject(utf8(subject));
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : utf8(subject));
  cert.setExtensions(extensions);
  cert.sign(issuer ? issuer.key : ownKey, forge.md.sha256.create());
  return cert;
}

const AUTHORITY_VALIDITY = {
  notBefore: new Date("2025-01-01T00:00:00Z"),
  notAfter: new Date("2035-01-01T00:00:00Z"),
};
const CA_EXTENSIONS = [
  { name: "basicConstraints", cA: true },
  { name: "keyUsage", keyCertSign: true, digitalSignature: true },
];

/** The authority's own name. `null` leaves a part out; with both out the name is `C=ES` alone. */
export interface AuthorityName {
  commonName?: string | null;
  organisation?: string | null;
}

function certificateAuthority(commonName: string | null, organisation: string | null): Signer {
  const keys = keyPair();
  const name: Attribute[] = [];
  if (commonName !== null) name.push({ name: "commonName", value: commonName });
  if (organisation !== null) name.push({ name: "organizationName", value: organisation });
  if (name.length === 0) name.push({ name: "countryName", value: "ES" });
  const cert = sign(name, keys.publicKey, null, keys.privateKey, AUTHORITY_VALIDITY, CA_EXTENSIONS);
  return { cert, key: keys.privateKey };
}

function der(cert: forge.pki.Certificate): Buffer {
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
}

function pack(issued: Issued, passphrase: string, algorithm: "aes256" | "3des"): Buffer {
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    issued.withKey ? CANDIDATE_KEYS.privateKey : null,
    [issued.cert, ...issued.chain],
    passphrase,
    { algorithm },
  );
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

const issuedByCandidate = new WeakMap<Candidate, Issued>();

function issuedFor(candidate: Candidate): Issued {
  const issued = issuedByCandidate.get(candidate);
  if (!issued) throw new Error("candidate was not issued by a fixture authority");
  return issued;
}

export function makeAuthority(name: AuthorityName = {}): FixtureAuthority {
  const authority = certificateAuthority(
    name.commonName === undefined ? "Waitron test FNMT" : name.commonName,
    name.organisation === undefined ? "Test FNMT" : name.organisation,
  );
  const stranger = certificateAuthority("Waitron stranger CA", "Stranger");

  const serverKeys = keyPair();
  const serverCert = sign(
    [{ name: "commonName", value: "127.0.0.1" }],
    serverKeys.publicKey,
    authority,
    serverKeys.privateKey,
    AUTHORITY_VALIDITY,
    [
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
    ],
  );

  function candidate(issued: Issued, passphrase: string, algorithm: "aes256" | "3des"): Candidate {
    const made: Candidate = {
      pfx: pack(issued, passphrase, algorithm),
      passphrase,
      fingerprint: new X509Certificate(der(issued.cert)).fingerprint256,
    };
    issuedByCandidate.set(made, issued);
    return made;
  }

  return {
    caPem: forge.pki.certificateToPem(authority.cert),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(serverCert),
    issue(options = {}) {
      const organisation = options.organisation === undefined ? "WAITRON SL" : options.organisation;
      const organizationIdentifier =
        options.organizationIdentifier === undefined
          ? "VATES-89890001K"
          : options.organizationIdentifier;
      const commonName = options.commonName ?? "12345678Z ANA GARCIA (R: 89890001K)";
      const subject: Attribute[] = [];
      for (const value of [organizationIdentifier ?? []].flat()) {
        subject.push({ type: "2.5.4.97", value });
      }
      for (const value of [organisation ?? []].flat()) {
        subject.push({ name: "organizationName", value });
      }
      subject.push({ name: "commonName", value: commonName });
      subject.push({ name: "serialNumber", value: "IDCES-12345678Z" });
      const signer = options.signedBy === "stranger" ? stranger : authority;
      const cert = sign(
        subject,
        CANDIDATE_KEYS.publicKey,
        signer,
        CANDIDATE_KEYS.privateKey,
        {
          notBefore: options.notBefore ?? new Date("2026-01-01T00:00:00Z"),
          notAfter: options.notAfter ?? new Date("2030-01-01T00:00:00Z"),
        },
        [
          { name: "basicConstraints", cA: false },
          { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
          { name: "extKeyUsage", clientAuth: true },
        ],
      );
      const issued: Issued = {
        cert,
        chain: [signer.cert],
        withKey: options.withKey ?? true,
        commonName,
      };
      return candidate(issued, options.passphrase ?? "cert-pass-9", options.algorithm ?? "aes256");
    },
    repack(original, algorithm) {
      return candidate(issuedFor(original), original.passphrase, algorithm);
    },
  };
}

/** The candidate as client material for `startMtlsServer` (`@waitron/server-kit`). */
export function mtlsMaterialFor(authority: FixtureAuthority, candidate: Candidate): MtlsMaterial {
  return {
    caPem: authority.caPem,
    serverKeyPem: authority.serverKeyPem,
    serverCertPem: authority.serverCertPem,
    clientPfx: candidate.pfx,
    clientPassphrase: candidate.passphrase,
    clientCn: issuedFor(candidate).commonName,
  };
}

export interface AnsweringServer {
  origin: string;
  /** How many requests reached the handler, which runs only after the client certificate checked. */
  requests(): number;
  sawClientCn(): string | null;
  close(): Promise<void>;
}

/** An HTTPS server that requires a client certificate the authority issued. */
export async function startAnsweringServer(
  authority: FixtureAuthority,
  answer: {
    status: number;
    body: string;
    maxVersion?: "TLSv1.2" | "TLSv1.3";
    hold?: Promise<void>;
    onRequest?: () => void;
  },
): Promise<AnsweringServer> {
  let lastCn: string | null = null;
  let requestCount = 0;
  const options: ServerOptions = {
    key: authority.serverKeyPem,
    cert: authority.serverCertPem,
    ca: authority.caPem,
    requestCert: true,
    rejectUnauthorized: true,
    ...(answer.maxVersion ? { maxVersion: answer.maxVersion } : {}),
  };
  const server = createServer(options, (req, res) => {
    requestCount += 1;
    const cn = (req.socket as TLSSocket).getPeerCertificate().subject?.CN;
    lastCn = Array.isArray(cn) ? (cn[0] ?? null) : (cn ?? null);
    answer.onRequest?.();
    (answer.hold ?? Promise.resolve()).then(
      () => {
        res.writeHead(answer.status, { "Content-Type": "text/xml; charset=utf-8" });
        res.end(answer.body);
      },
      (error: unknown) => res.destroy(error instanceof Error ? error : undefined),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `https://127.0.0.1:${port}`,
    requests: () => requestCount,
    sawClientCn: () => lastCn,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

// The two envelopes measured against `@waitron/verifactu` 0.2.1's `consultar` on 2026-10-18: the
// first resolved as `SinDatos`; the second, answered with status 500, threw a `soap` transport
// error with faultCode `env:Client`. `Test fault` is our own text, not AEAT's.
export const SIN_DATOS_BODY =
  '<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><tikR:RespuestaConsultaFactuSistemaFacturacion xmlns:tikR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd"><tikR:Cabecera><tik:IDVersion xmlns:tik="x">1.0</tik:IDVersion></tikR:Cabecera><tikR:PeriodoImputacion><tikR:Ejercicio>2026</tikR:Ejercicio><tikR:Periodo>10</tikR:Periodo></tikR:PeriodoImputacion><tikR:IndicadorPaginacion>N</tikR:IndicadorPaginacion><tikR:ResultadoConsulta>SinDatos</tikR:ResultadoConsulta></tikR:RespuestaConsultaFactuSistemaFacturacion></env:Body></env:Envelope>';

export const SOAP_FAULT_BODY =
  '<?xml version="1.0"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Test fault</faultstring></env:Fault></env:Body></env:Envelope>';
