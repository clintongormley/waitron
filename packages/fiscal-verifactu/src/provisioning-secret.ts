import { putCredential, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { isCertKind, type CertKind } from "./aeat-transport.js";
import "./errors.js";

export interface AeatCert {
  /** The PFX/PKCS#12 certificate bundle, base64-encoded. Opaque to the vault. */
  pfxBase64: string;
  /** The passphrase protecting the PFX. */
  passphrase: string;
  certKind: CertKind;
}

// Canonical, padded base64. `Buffer.from(x, "base64")` cannot stand in for this: it silently drops
// non-alphabet bytes, so a bogus blob would seal cleanly and fail only at AEAT-submit time. The
// pattern also matches the empty string, hence the length check beside it.
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isBase64(value: string): boolean {
  return value.length > 0 && BASE64_RE.test(value);
}

/** Throws `setup.request_invalid` naming the offending field, NEVER its value. */
export function validateAeatCert(cert: {
  certKind: string;
  pfxBase64: string;
  passphrase: string;
}): void {
  if (!isCertKind(cert.certKind)) {
    throw new AppError("setup.request_invalid", { field: "certKind" });
  }
  if (!isBase64(cert.pfxBase64)) {
    throw new AppError("setup.request_invalid", { field: "pfxBase64" });
  }
  if (cert.passphrase.length === 0) {
    throw new AppError("setup.request_invalid", { field: "passphrase" });
  }
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("setup.request_invalid", { field });
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("setup.request_invalid", { field });
  }
  return value;
}

/**
 * The one validator both the host's pre-provision guard (`FISCAL_SLOT.provisioningSecret.validate`)
 * and `sealAeatSecret` run: the SIF mint cannot be undone, so a malformed blob must be refused
 * before anything is minted. Errors name the field, never its value — that value is the secret.
 */
export function parseAeatCert(raw: unknown): AeatCert {
  const cert = asObject(raw, "aeatCert");
  const parsed: AeatCert = {
    pfxBase64: asString(cert.pfxBase64, "pfxBase64"),
    passphrase: asString(cert.passphrase, "passphrase"),
    certKind: asString(cert.certKind, "certKind") as CertKind,
  };
  validateAeatCert(parsed);
  return parsed;
}

/**
 * Seal a venue's AEAT certificate into the `fiscal.aeat` vault purpose. Validated again here
 * because a caller may skip the host's `validate` seat, and `putCredential` accepts any non-empty
 * `certKind` and `pfxBase64`.
 */
export async function sealAeatSecret(
  deps: { db: Database; ring: KeyRing },
  raw: unknown,
): Promise<void> {
  const cert = parseAeatCert(raw);

  await withTransaction(deps.db, (tx) =>
    putCredential(tx, deps.ring, {
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: cert.pfxBase64,
        passphrase: cert.passphrase,
        certKind: cert.certKind,
      },
    }),
  );
}
