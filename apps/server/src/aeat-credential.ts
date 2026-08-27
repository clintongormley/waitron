import { putCredential, type KeyRing } from "@waitron/credentials";
import { withTenant, type Database } from "@waitron/db";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";

/**
 * Which AEAT certificate kind the blob is. Not stored as a prod/test flag — that is the deployment
 * ENVIRONMENT — but as the identity type that picks the AEAT SOAP host family (`SOAP_ENDPOINTS`
 * vs `SOAP_ENDPOINTS_SELLO`). Validated by the reader; the vault only records the string.
 */
export type CertKind = "sello" | "representante";

export interface AeatCert {
  /** The PFX/PKCS#12 certificate bundle, base64-encoded. Opaque to the vault. */
  pfxBase64: string;
  /** The passphrase protecting the PFX. */
  passphrase: string;
  certKind: CertKind;
}

const CERT_KINDS: readonly CertKind[] = ["sello", "representante"];

// A non-empty base64 string: one or more base64-alphabet characters, then at most two `=` padding.
// The leading `+` (not `*`) is what rejects the empty string. `Buffer.from(x, "base64")` cannot
// stand in for this — it is deliberately lax, silently dropping any non-alphabet byte, so it would
// accept `""` and `"not base64!"` alike. Validating the SHAPE explicitly is what lets the empty and
// garbage cases fail with OUR code here rather than sealing a blob the drain later cannot decode.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function isBase64(value: string): boolean {
  return BASE64_RE.test(value);
}

/**
 * Seal a LIVE ES-common venue's AEAT certificate into the `fiscal.aeat` vault purpose for `tenantId`.
 *
 * `certKind` and `pfxBase64` are validated HERE, before the write, and rejected with
 * `setup.request_invalid` (naming the offending field, never its value). Two of the three fields
 * warrant a check this side of `putCredential`:
 *  - `certKind`: `validatePayload` accepts any non-empty string, so a `"bogus"` value would seal
 *    cleanly and only fail far downstream when the drain tried to pick a SOAP host from it.
 *  - `pfxBase64`: `validatePayload` rejects only the empty string (as `credentials.invalid_field`);
 *    a non-empty but non-base64 blob would seal and fail at decode time. Both belong to the setup
 *    request's shape, so they surface a setup-request code, not a vault-internal one.
 * `passphrase` needs no check here — `putCredential`'s `validatePayload` rejects an empty one, and a
 * passphrase has no shape beyond "a non-empty string".
 *
 * The seal runs under `withTenant`: `tenant_credentials` is FORCE-RLS, so `putCredential` must
 * execute with `app.tenant_id` set (the row's WITH CHECK is `tenant_id = current_tenant_id()`), and
 * the tenant must already exist (the seal runs AFTER `applyVenue` mints it — the FK is `restrict`).
 */
export async function sealAeatCredential(
  db: Database,
  ring: KeyRing,
  tenantId: string,
  cert: AeatCert,
): Promise<void> {
  if (!CERT_KINDS.includes(cert.certKind)) {
    throw new AppError("setup.request_invalid", { field: "certKind" });
  }
  if (!isBase64(cert.pfxBase64)) {
    throw new AppError("setup.request_invalid", { field: "pfxBase64" });
  }

  const tenant = brandTenantId(tenantId);
  await withTenant(db, tenant, (tx) =>
    putCredential(tx, ring, {
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
