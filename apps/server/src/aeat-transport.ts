import { Agent, fetch as undiciFetch } from "undici";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO, createClient } from "@waitron/verifactu";
import type { VerifactuClient } from "@waitron/verifactu";
import type { DeploymentEnvironment } from "./config.js";
import { readCredential } from "./credentials.js";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import "./errors.js";

/** The two FNMT certificate kinds this host routes on. `CertKind` is derived FROM this array (not
 * the other way round) so the type and the runtime membership check can never drift apart — a
 * third kind added to one is a type error or a dead branch in the other, never a silent gap. */
const CERT_KINDS = ["sello", "representante"] as const;

/** Which FNMT certificate a tenant submits with. It selects the AEAT HOST, not merely a header. */
export type CertKind = (typeof CERT_KINDS)[number];

/** The single runtime membership check for `CertKind`, derived from the same `CERT_KINDS` array the
 * type is — exported so `aeat-credential.ts`'s cert validation checks membership against THIS list
 * rather than redeclaring its own. */
export function isCertKind(value: string): value is CertKind {
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
export function aeatEndpointFor(
  environment: DeploymentEnvironment,
): (certKind: CertKind) => string {
  return (certKind) =>
    certKind === "sello" ? SOAP_ENDPOINTS_SELLO[environment] : SOAP_ENDPOINTS[environment];
}

/** A tenant's mTLS `fetch` and the handle that releases the connection pool behind it. */
export interface TenantTransport {
  fetch: typeof globalThis.fetch;
  /** Graceful: `Agent.close()`, not `.destroy()`. Nothing is in flight by the time this runs — the
   * sweep has returned — so there is nothing to abort, and `destroy()` would tear down a socket
   * mid-response if that assumption ever stopped holding. */
  close: () => Promise<void>;
}

/**
 * A `fetch` carrying this tenant's client certificate, and the `Agent` it is bound to. One `Agent`
 * per call — its TLS material is per-tenant client-certificate config, an `Agent`-level setting, not
 * a per-request one — so the caller owns its lifetime via the returned `close`. `packages/verifactu`
 * injects `fetch` for exactly this reason — mTLS configuration is a deployment concern and the
 * library keeps none of it.
 *
 * `ca` is for a private trust root: the test's own CA, and any deployment that terminates through
 * one. Omitted, Node's default store applies — but `material.pfx`'s own bundled certificates ALSO
 * act as extra trust anchors when verifying the peer (confirmed in `aeat-transport.test.ts`'s "ca
 * omitted" case): a PFX that ships its issuing CA alongside the leaf, as a real FNMT export commonly
 * does, still verifies without this parameter. `ca` matters for a PFX that does not bundle its
 * issuer, not universally.
 */
export function mtlsFetch(material: CertMaterial, ca?: string): TenantTransport {
  const dispatcher = new Agent({
    connect: {
      pfx: material.pfx,
      passphrase: material.passphrase,
      ...(ca === undefined ? {} : { ca }),
    },
  });
  return {
    fetch: ((input, init) =>
      undiciFetch(
        input as string,
        { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
      ) as unknown as Promise<Response>) as typeof globalThis.fetch,
    close: () => dispatcher.close(),
  };
}

export interface TransportDeps {
  db: Database;
  ring: KeyRing;
  endpointFor: (certKind: CertKind) => string;
  fetchFor: (material: CertMaterial) => TenantTransport;
}

export interface ClientResolver {
  /** `DrainDeps.resolveClient`, unchanged in shape — `@waitron/fiscal` still knows nothing about
   * mTLS, and this change must not be the one that teaches it. */
  resolve: (tenantId: TenantId) => Promise<VerifactuClient>;
  /** Releases every transport this resolver built, and NEVER throws — neither for a transport whose
   * own `close()` rejects, nor for a `Logger` that throws while reporting one. Both are caught
   * per transport (below), so one bad `Agent` can never stop the rest from being released. */
  closeAll: () => Promise<void>;
}

/**
 * `DrainDeps.resolveClient`, wired to the vault, plus the handle that releases what it built.
 * One client — and one connection pool — per tenant per pass, built only for tenants the sweep
 * actually has work for, and closed when that pass ends.
 *
 * Constructed PER PASS by `boot.ts` rather than once at boot: the set of transports to close is
 * then scoped by construction, with no residue between passes to reset and no way for one pass's
 * `closeAll` to reach another's.
 */
export function aeatClientResolver(deps: TransportDeps, log?: Logger): ClientResolver {
  // The tenant travels WITH its transport, not just the bare `TenantTransport` `resolve` used to
  // push: `closeAll`'s own failure log otherwise has no way to say WHICH tenant's Agent failed to
  // close — see its own comment below.
  const open: { tenantId: TenantId; transport: TenantTransport }[] = [];
  return {
    resolve: async (tenantId) => {
      const material = await readCertMaterial(deps.db, deps.ring, tenantId);
      const transport = deps.fetchFor(material);
      open.push({ tenantId, transport });
      return createClient({
        endpoint: deps.endpointFor(material.certKind),
        fetch: transport.fetch,
      });
    },
    closeAll: async () => {
      // Released CONCURRENTLY, not one at a time: this runs on `boot.ts`'s `finally`, on the
      // critical path of every `drain` pass, and `pass.ts`'s own `durationMs` doc comment calls
      // that field "how long this duty took" — N serial TLS-pool teardowns would inflate it for no
      // reason nothing here depends on. `open.splice(0)` still runs exactly once, up front, so the
      // list is emptied before any `close()` settles either way.
      await Promise.allSettled(
        open.splice(0).map(({ tenantId, transport }) =>
          // `Promise.resolve().then(() => transport.close())`, not `transport.close().catch(...)`
          // directly (F2 of the 2026-07-27 pre-merge review): `TenantTransport.close` is typed
          // `() => Promise<void>`, but that is a promise about the return type, not about how the
          // call behaves — a `close()` that throws BEFORE returning (undici's real `Agent.close()`
          // cannot, but `fetchFor` is an injected seam a test or a future implementation is free to
          // violate) would propagate synchronously out of this `.map` callback, past `.catch`
          // entirely, before `Promise.allSettled` is ever reached. That would reject `closeAll`
          // itself — into `boot.ts`'s `finally`, replacing `drain`'s own return value or its error —
          // and abandon every transport queued after the throwing one, even though `open.splice(0)`
          // above already emptied the list with no handle left to reach them. Deferring the call
          // into a `.then` turns a synchronous throw into an ordinary rejection, which the same
          // `.catch` below already handles.
          Promise.resolve()
            .then(() => transport.close())
            .catch((error: unknown) => {
              // The log call is guarded in TURN, which the rest of this package does not bother doing
              // for its own catches (`loop.ts`, `pass.ts`) — and the difference is real rather than
              // fussiness. Those run in ordinary catch blocks, where a throwing `Logger` surfaces as
              // itself. This one runs inside `boot.ts`'s `finally`, where a throw does not surface at
              // all: it REPLACES the sweep's own return value or error, silently discarding the very
              // finding the cleanup was cleaning up after, and abandoning the transports not yet
              // closed. That is what makes `closeAll`'s "never throws" an unconditional guarantee
              // rather than one with a caveat — and, now, one that holds per-transport regardless of
              // how many others in this same `Promise.allSettled` are failing at the same time.
              try {
                // `tenantId` and a `message` that survives a non-`AppError` are both required to make
                // this line actionable — `codeOf` alone flattens a plain socket-layer `Error` (which
                // is all `Agent.close()` can ever throw) to the bare string `"unknown"`, and nothing
                // else here says WHICH tenant's mTLS pool failed to release. Unlike
                // `server.shutdown_failed`'s own `errorCode`-only convention (errors.ts's own doc
                // comment on why `pg`'s driver messages can carry a connection string), an `Agent`
                // close failure is a socket-layer error with no such secret to leak.
                log?.("warn", "transport.close_failed", {
                  tenantId,
                  errorCode: codeOf(error),
                  message: error instanceof Error ? error.message : String(error),
                });
              } catch {
                // Nothing left to report the failure with. Releasing the remaining transports is the
                // job that still matters, so this settles rather than rejecting a second time.
              }
            }),
        ),
      );
    },
  };
}
