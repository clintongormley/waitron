import { X509Certificate } from "node:crypto";
import { createSecureContext, type PeerCertificate, TLSSocket } from "node:tls";

export type OpenRefusal = "passphrase_wrong" | "old_encryption" | "no_private_key" | "unreadable";

export interface CertificateDetails {
  organisation: string | null;
  taxId: string | null;
  issuer: string | null;
  validFrom: Date;
  validUntil: Date;
  fingerprint: string;
}

export type OpenResult =
  { ok: true; details: CertificateDetails } | { ok: false; reason: OpenRefusal };

/** Upper case, with spaces and hyphens removed. */
export function normaliseTaxId(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

type Names = Record<string, string | string[] | undefined> | undefined;

function first(names: Names, key: string): string | null {
  const value = names?.[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

// Measured 2026-10-18 on Node v26.11.1 / OpenSSL 4.0.3: a wrong passphrase throws with no code and
// "mac verify failure", an RC2-encrypted file `ERR_CRYPTO_UNSUPPORTED_OPERATION`, and a file with
// no key `ERR_CRYPTO_OPERATION_FAILED` "Unable to load private key from PFX data".
function refusal(error: unknown): OpenRefusal {
  const { code, message } = error as NodeJS.ErrnoException;
  if (code === "ERR_CRYPTO_UNSUPPORTED_OPERATION") return "old_encryption";
  if (code === "ERR_CRYPTO_OPERATION_FAILED" && /private key/i.test(message))
    return "no_private_key";
  if (code === undefined && /mac verify failure/.test(message)) return "passphrase_wrong";
  return "unreadable";
}

/**
 * Reads only the subject's O and organizationIdentifier and the issuer's CN and O: the subject's
 * CN and serialNumber name a person. Never throws: every failure is a refusal.
 */
export function openCertificateFile(pfx: Buffer, passphrase: string): OpenResult {
  try {
    const secureContext = createSecureContext({ pfx, passphrase });
    const socket = new TLSSocket(null as never, { secureContext });
    let peer: PeerCertificate;
    try {
      peer = socket.getCertificate() as PeerCertificate;
    } finally {
      socket.destroy();
    }
    const x509 = new X509Certificate(peer.raw);
    const identifier = first(peer.subject as Names, "organizationIdentifier");
    const issuerCn = first(peer.issuer as Names, "CN");
    const issuerO = first(peer.issuer as Names, "O");
    return {
      ok: true,
      details: {
        organisation: first(peer.subject as Names, "O"),
        taxId: identifier === null ? null : normaliseTaxId(identifier).replace(/^VAT[A-Z]{2}/, ""),
        issuer: issuerCn && issuerO ? `${issuerCn} (${issuerO})` : (issuerCn ?? issuerO),
        validFrom: x509.validFromDate,
        validUntil: x509.validToDate,
        fingerprint: x509.fingerprint256,
      },
    };
  } catch (error) {
    return { ok: false, reason: refusal(error) };
  }
}
