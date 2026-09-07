import { putCredential, type KeyRing } from "@waitron/credentials";
import { withTenant, type Database } from "@waitron/db";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import { isCertKind, type CertKind } from "./aeat-transport.js";
import "./errors.js";

export interface AeatCert {
  /** The PFX/PKCS#12 certificate bundle, base64-encoded. Opaque to the vault. */
  pfxBase64: string;
  /** The passphrase protecting the PFX. */
  passphrase: string;
  certKind: CertKind;
}

// Canonical base64: whole 4-char groups of the base64 alphabet, then an OPTIONAL padded tail of
// exactly `xx==` or `xxx=`. Valid base64 of any byte string always has length % 4 with correct
// padding, so this rejects not just non-alphabet garbage (`"not base64!"`) but also malformed-length
// strings (`"QQ"`, `"QQQ"`) that a looser `[A-Za-z0-9+/]+={0,2}` would wave through. `Buffer.from(x,
// "base64")` cannot stand in for this — it is deliberately lax, silently dropping any non-alphabet
// byte — so validating the SHAPE here is what stops a bogus blob sealing cleanly and only failing
// far downstream at drain/AEAT-submit time.
//
// The pattern also matches the EMPTY string (the `*` with zero groups, tail absent), so the caller
// keeps an explicit non-empty check alongside it — `value.length > 0 && …`.
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isBase64(value: string): boolean {
  return value.length > 0 && BASE64_RE.test(value);
}

/**
 * Validate an AEAT cert's SHAPE fully — `certKind ∈ {sello, representante}`, a non-empty base64
 * `pfxBase64`, and a non-empty `passphrase` — throwing `setup.request_invalid` (naming the offending
 * field, NEVER its value) on the first fault. `certKind` membership is the shared `isCertKind`
 * (`aeat-transport.ts`), so the type and this runtime check cannot drift.
 */
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
 * Parse the opaque provisioning secret's SHAPE (present fields, right types) then its VALUES via
 * `validateAeatCert` — throwing `setup.request_invalid` naming the offending field (NEVER its value:
 * a PFX or passphrase is exactly the secret a caller can mis-send). This is the single validator both
 * the host's pre-provision guard (`FISCAL_SLOT.provisioningSecret.validate`) and `sealAeatSecret`
 * run: the mint is an UNREPAIRABLE fiscal write (CLAUDE.md §5), so a malformed blob must 400 with
 * nothing stamped or minted, not 400 AFTER the box has been permanently wedged.
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
 * Seal a LIVE ES-common venue's AEAT certificate into the `fiscal.aeat` vault purpose for `tenantId`.
 *
 * The opaque blob's SHAPE is validated HERE, before the write, via `parseAeatCert` — the SAME check
 * the host runs upfront through the `validate` seat, so a malformed `certKind`, `pfxBase64` or
 * `passphrase` is rejected with `setup.request_invalid` (naming the offending field, never its
 * value). Running it again here is deliberate DEFENSE-IN-DEPTH: on the provision path the blob has
 * already passed `validate`, but a direct caller that skipped it must still not seal a blob
 * `putCredential`'s own `validatePayload` would wave through — `validatePayload` accepts any
 * non-empty `certKind` (a `"bogus"` value only fails far downstream when the drain picks a SOAP host)
 * and any non-empty `pfxBase64` (a non-base64 blob only fails at decode time).
 *
 * The seal runs under `withTenant` (the write's own transaction), and the tenant must already exist
 * (the seal runs AFTER `applyVenue` mints it — the FK is `restrict`).
 */
export async function sealAeatSecret(
  deps: { db: Database; ring: KeyRing },
  tenantId: string,
  raw: unknown,
): Promise<void> {
  const cert = parseAeatCert(raw);

  const tenant = brandTenantId(tenantId);
  await withTenant(deps.db, tenant, (tx) =>
    putCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: cert.pfxBase64,
        passphrase: cert.passphrase,
        certKind: cert.certKind,
      },
    }),
  );
}
