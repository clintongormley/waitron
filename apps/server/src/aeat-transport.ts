import { Agent, fetch as undiciFetch } from "undici";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO, createClient } from "@waitron/verifactu";
import type { VerifactuClient } from "@waitron/verifactu";
import type { AeatEnvironment } from "./config.js";
import { readCredential } from "./credentials.js";
import "./errors.js";

/** The two FNMT certificate kinds this host routes on. `CertKind` is derived FROM this array (not
 * the other way round) so the type and the runtime membership check can never drift apart — a
 * third kind added to one is a type error or a dead branch in the other, never a silent gap. */
const CERT_KINDS = ["sello", "representante"] as const;

/** Which FNMT certificate a tenant submits with. It selects the AEAT HOST, not merely a header. */
export type CertKind = (typeof CERT_KINDS)[number];

function isCertKind(value: string): value is CertKind {
  // Cast to a plain string array: `readonly ["sello", "representante"]` only accepts a `CertKind`
  // as `.includes`'s argument, but `value` here is exactly the un-narrowed caller input this
  // function exists to check.
  return (CERT_KINDS as readonly string[]).includes(value);
}

export interface CertMaterial {
  /** DER-encoded PKCS#12, as `node:tls`' `pfx` option wants it. */
  pfx: Buffer;
  passphrase: string;
  certKind: CertKind;
}

/**
 * Validates the decrypted payload at the READ site and throws `server.credential_unusable` when a
 * declared field is absent or unusable — including a `pfxBase64` that is PRESENT but decodes to
 * nothing usable, not merely one that is missing or the empty string.
 *
 * This is the read-side half of `rotate`'s coupling to `PURPOSES` (server design §5.1). Reads do not
 * validate, so a row sealed before `certKind` joined the registry decrypts to a payload missing it;
 * defaulting would send a sello certificate to the non-sello host and fail every submission for that
 * tenant with nothing anywhere explaining why. Validating HERE rather than in the store is
 * deliberate: the store would take the whole vault offline, while this costs one tenant one pass and
 * says so.
 */
export function certMaterialFrom(
  payload: Record<string, string | undefined>,
  ref: { tenantId: string; purpose: string },
): CertMaterial {
  const certKind = payload.certKind;
  if (certKind === undefined || !isCertKind(certKind)) {
    throw new AppError("server.credential_unusable", { ...ref, field: "certKind" });
  }
  const pfxBase64 = payload.pfxBase64;
  if (pfxBase64 === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "pfxBase64" });
  }
  // Decoded BEFORE it is checked, not after: `Buffer.from("!!!!", "base64")` is zero bytes despite
  // a non-empty, non-base64 input, so checking only the encoded string's emptiness would let that
  // case through. It would then surface much later as `configSecureContext`'s raw "not enough
  // data" — not an `AppError`, and not this tenant's `certMaterialFrom` failure at all — which is
  // exactly the "nothing anywhere explaining why" outcome this function exists to prevent.
  const pfx = Buffer.from(pfxBase64, "base64");
  if (pfx.length === 0) {
    throw new AppError("server.credential_unusable", { ...ref, field: "pfxBase64" });
  }
  const passphrase = payload.passphrase;
  if (passphrase === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "passphrase" });
  }
  return { pfx, passphrase, certKind };
}

export async function readCertMaterial(
  db: Database,
  ring: KeyRing,
  tenantId: TenantId,
): Promise<CertMaterial> {
  const payload = await readCredential(db, ring, tenantId, "fiscal.aeat");
  return certMaterialFrom(payload, { tenantId, purpose: "fiscal.aeat" });
}

/**
 * A sello de entidad certificate submits to a DIFFERENT HOST — `www10`/`prewww10` rather than
 * `www1`/`prewww1`. That is why the certificate's kind is provisioned data and not something this
 * host could infer without reading X.509 policy OIDs.
 */
export function aeatEndpointFor(aeatEnv: AeatEnvironment): (certKind: CertKind) => string {
  return (certKind) =>
    certKind === "sello" ? SOAP_ENDPOINTS_SELLO[aeatEnv] : SOAP_ENDPOINTS[aeatEnv];
}

/**
 * A `fetch` carrying this tenant's client certificate. `packages/verifactu` injects `fetch` for
 * exactly this reason — mTLS configuration is a deployment concern and the library keeps none of it.
 *
 * `ca` is for a private trust root: the test's own CA, and any deployment that terminates through
 * one. Omitted, Node's default store applies — but `material.pfx`'s own bundled certificates ALSO
 * act as extra trust anchors when verifying the peer (confirmed in `aeat-transport.test.ts`'s "ca
 * omitted" case): a PFX that ships its issuing CA alongside the leaf, as a real FNMT export commonly
 * does, still verifies without this parameter. `ca` matters for a PFX that does not bundle its
 * issuer, not universally.
 */
export function mtlsFetch(material: CertMaterial, ca?: string): typeof globalThis.fetch {
  const dispatcher = new Agent({
    connect: {
      pfx: material.pfx,
      passphrase: material.passphrase,
      ...(ca === undefined ? {} : { ca }),
    },
  });
  return ((input, init) =>
    undiciFetch(
      input as string,
      { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>) as typeof globalThis.fetch;
}

export interface TransportDeps {
  db: Database;
  ring: KeyRing;
  endpointFor: (certKind: CertKind) => string;
  fetchFor: (material: CertMaterial) => typeof globalThis.fetch;
}

/**
 * `DrainDeps.resolveClient`, wired to the vault. One client per tenant per pass, built only for
 * tenants the sweep actually has work for.
 */
export function aeatClientResolver(
  deps: TransportDeps,
): (tenantId: TenantId) => Promise<VerifactuClient> {
  return async (tenantId) => {
    const material = await readCertMaterial(deps.db, deps.ring, tenantId);
    return createClient({
      endpoint: deps.endpointFor(material.certKind),
      fetch: deps.fetchFor(material),
    });
  };
}
