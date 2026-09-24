import { Agent, fetch as undiciFetch } from "undici";
import { AppError, isAppError } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO, createClient } from "@waitron/verifactu";
import type { VerifactuClient } from "@waitron/verifactu";
import type { FiscalDutyLog } from "@waitron/fiscal";
import "./errors.js";

/** The two FNMT certificate kinds this host routes on. `CertKind` is derived from this array, so
 * the type and the runtime membership check cannot drift apart. */
const CERT_KINDS = ["sello", "representante"] as const;

/** Which FNMT certificate the venue submits with. It selects the AEAT HOST, not merely a header. */
export type CertKind = (typeof CERT_KINDS)[number];

export function isCertKind(value: string): value is CertKind {
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
 * Reads do not validate, so a row sealed before `certKind` joined the registry decrypts to a
 * payload missing it; defaulting would send a sello certificate to the non-sello host and fail
 * every submission with nothing explaining why. Validated HERE rather than in the store, which
 * would take the whole vault offline.
 */
export function certMaterialFrom(
  payload: Record<string, string | undefined>,
  ref: { purpose: string },
): CertMaterial {
  const certKind = payload.certKind;
  if (certKind === undefined || !isCertKind(certKind)) {
    throw new AppError("server.credential_unusable", { ...ref, field: "certKind" });
  }
  const pfxBase64 = payload.pfxBase64;
  if (pfxBase64 === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "pfxBase64" });
  }
  // Checked after decoding: `Buffer.from("!!!!", "base64")` is zero bytes despite a non-empty
  // input, which would otherwise surface much later as an unexplained TLS error.
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

export async function readCertMaterial(db: Database, ring: KeyRing): Promise<CertMaterial> {
  const payload = await withTransaction(db, (tx) =>
    getCredential(tx, ring, { purpose: "fiscal.aeat" }),
  );
  return certMaterialFrom(payload, { purpose: "fiscal.aeat" });
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

/** The venue's mTLS `fetch` and the handle that releases the connection pool behind it. */
export interface TenantTransport {
  fetch: typeof globalThis.fetch;
  /** Graceful: `Agent.close()`, not `.destroy()` — nothing is in flight once the sweep has
   * returned, and `destroy()` would tear down a socket mid-response if that stopped holding. */
  close: () => Promise<void>;
}

/**
 * A `fetch` carrying the venue's client certificate, and the `Agent` it is bound to. Client
 * certificates are an `Agent`-level setting, so one `Agent` per call, released by the returned
 * `close`.
 *
 * `ca` is for a private trust root. Omitted, Node's default store applies, and the certificates
 * bundled in `material.pfx` also act as trust anchors (the "ca omitted" case in
 * `aeat-transport.test.ts`).
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
  /** `DrainDeps.resolveClient`: `@waitron/fiscal` knows nothing about mTLS. */
  resolve: () => Promise<VerifactuClient>;
  /** Releases every transport this resolver built, and NEVER throws — neither for a transport whose
   * own `close()` rejects, nor for a logger that throws while reporting one. */
  closeAll: () => Promise<void>;
}

/**
 * `DrainDeps.resolveClient`, wired to the vault, plus the handle that releases what it built.
 * Built per pass by the drain seat (`./slot.ts`), so one pass's `closeAll` can never reach
 * another's transports. The certificate is read only when the sweep actually has work.
 */
export function aeatClientResolver(deps: TransportDeps, log?: FiscalDutyLog): ClientResolver {
  const open: TenantTransport[] = [];
  return {
    resolve: async () => {
      const material = await readCertMaterial(deps.db, deps.ring);
      const transport = deps.fetchFor(material);
      open.push(transport);
      return createClient({
        endpoint: deps.endpointFor(material.certKind),
        fetch: transport.fetch,
      });
    },
    closeAll: async () => {
      // Concurrently: this runs in the drain seat's `finally`, on the critical path of every pass.
      await Promise.allSettled(
        open.splice(0).map((transport) =>
          // Deferred into `.then` so a `close()` that throws synchronously becomes a rejection the
          // `.catch` handles, instead of escaping `.map` and abandoning the transports after it.
          Promise.resolve()
            .then(() => transport.close())
            .catch((error: unknown) => {
              try {
                // An `Agent` close failure is a socket-layer error with no secret in it, so its raw
                // `message` is safe to log.
                log?.("warn", "transport.close_failed", {
                  errorCode: isAppError(error) ? error.code : "unknown",
                  message: error instanceof Error ? error.message : String(error),
                });
              } catch {
                // Nothing left to report with.
              }
            }),
        ),
      );
    },
  };
}
