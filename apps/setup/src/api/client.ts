/**
 * The browser-side face of the setup box's HTTP API — one thin `fetch` wrapper per `/setup-api`
 * route (`apps/server/src/setup-api.ts`). The wizard views built on top of it never touch `fetch`,
 * URLs, or error-envelope shapes directly: they call a typed method and get back a typed payload, or
 * a rejected {@link ApiError}.
 *
 * The interfaces below are LOCAL copies of the server's JSON shapes, deliberately NOT imported from
 * `@waitron/provisioning` (which carries `VenueRequest`) or any server barrel. A runtime import from
 * those packages would drag their barrels — and through them `@waitron/db` and Node builtins — into
 * the browser bundle. The duplicated field lists are the price of keeping the wizard bundle free of
 * server code, exactly as `apps/till/src/api/client.ts` and `apps/dashboard/src/api/client.ts` do it.
 *
 * The one deliberate DIVERGENCE from those two clients is in {@link SetupApi} `#request`: it surfaces
 * the error envelope's `params` alongside `code`, because the wizard drives per-field inline
 * validation off `setup.request_invalid`'s `params.field` (`apps/server/src/setup-api.ts` —
 * `invalidRequest`). The till/dashboard clients drop `params` because nothing there reads it.
 */

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = typeof fetch;

/**
 * `GET /setup-api/status` — the unprovisioned box's boot info (`apps/server/src/setup-api.ts`, the
 * `/setup-api/status` handler). `provisioned` is always `false` here (a provisioned box never mounts
 * these routes); `environment` is the box's stamped deployment environment, which the wizard reads to
 * warn loudly before provisioning a real `production` venue; `needs` lists the outstanding setup
 * steps (today only `"venue"`).
 */
export interface SetupStatus {
  provisioned: boolean;
  environment: "production" | "preproduction";
  needs: string[];
}

/**
 * The first operator's credentials, collected on the admin step. Sent PLAINTEXT — the server hashes
 * `pin`/`password` with `hashPin`/`hashPassword` at the request boundary
 * (`apps/server/src/setup-api.ts`) into the stored `pinHash`/`passwordHash`; the browser never hashes.
 */
export interface AdminDraft {
  displayName: string;
  pin: string;
  password: string;
}

/**
 * The venue's location + fiscal-point details. Field names match the server's `parseVenue` /
 * `VenueRequest` exactly (`apps/server/src/setup-api.ts`,
 * `packages/provisioning/src/venue-plan.ts`). `fiscalTerritory` is `"ES-common"` — the only regime
 * implemented today. `invoiceLocales` is a non-empty `string[]` (`planVenue` rejects 0 or more than
 * 2). `addressLine2` is the one NULLABLE field (`asNullableString`); the rest are required strings.
 * `dayCutover` is `"HH:MM"` or `"HH:MM:SS"`.
 */
export interface LocationDraft {
  name: string;
  fiscalTerritory: "ES-common";
  invoiceLocales: string[];
  operationDescription: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  province: string;
  timeZone: string;
  dayCutover: string;
}

/**
 * The AEAT certificate, collected only for a live ES-common venue. `pfxBase64` is the PFX bundle as
 * canonical base64 (the browser reads the uploaded file to base64); `certKind` is the credential type
 * (`isCertKind`-checked server-side, `packages/.../aeat-credential.ts`). OPTIONAL on the request — the
 * key is OMITTED entirely (never sent as `null`) when no certificate is supplied.
 */
export interface AeatCertDraft {
  pfxBase64: string;
  passphrase: string;
  certKind: "sello" | "representante";
}

/**
 * The `POST /setup-api/provision` request body (`apps/server/src/setup-api.ts` — the provision
 * handler; verified against `parseVenue`/`parseCert`). `mode` forks demo (stamps preproduction) vs
 * live (stamps production). `seriesCode` must differ from `rectificativeSeriesCode` (`planVenue`).
 * `aeatCert` is present only for a live ES-common venue and is OMITTED otherwise.
 */
export interface ProvisionBody {
  mode: "demo" | "live";
  venue: {
    country: string;
    taxId: string;
    legalName: string;
    location: LocationDraft;
    tillName: string;
    seriesCode: string;
    rectificativeSeriesCode: string;
    admin: AdminDraft;
  };
  aeatCert?: AeatCertDraft;
}

/**
 * `POST /setup-api/provision` success (`apps/server/src/setup-api.ts` — the 200 the handler flushes
 * before restarting). The box SIGTERMs on the next tick and comes back in trading mode, so this is the
 * last response the wizard ever gets from the setup API.
 */
export interface ProvisionResult {
  provisioned: true;
  tenantId: string;
  restarting: true;
}

/**
 * The `POST /setup-api/adopt` request body — the MIRROR-side sibling of {@link ProvisionBody} (C2b).
 * A LOCAL copy of the server's shape (`apps/server/src/setup-api.ts` — the adopt handler's per-field
 * validation, and `AdoptCredential`/`AdoptRequest` in `apps/server/src/adopt.ts`), deliberately NOT
 * imported for the same bundle-hygiene reason as the shapes above.
 *
 * `credential` is a STRUCTURED OBJECT, not a string — Task 9 widened it so the mirror collects the
 * primary's login (`personId` + `password`, optional `totp`) as fields and sends the object directly.
 * The server validates each field at its own boundary and forwards them to the primary's management
 * login; the `password`/`totp` are never logged. `totp` is OMITTED when the operator leaves it blank.
 */
export interface AdoptBody {
  primaryUrl: string;
  credential: { personId: string; password: string; totp?: string };
}

/**
 * `POST /setup-api/adopt` success (`apps/server/src/setup-api.ts` — the 200 the adopt handler flushes
 * before restarting into mirror mode). Like {@link ProvisionResult}, this is the last response the
 * wizard gets: the box SIGTERMs on the next tick and comes back serving the read-only dashboard.
 */
export interface AdoptResult {
  adopted: true;
  tenantId: string;
  restarting: true;
}

/**
 * A rejected `#request`. `code` is the server's stable domain code from the `{ error: { code } }`
 * envelope (`apps/server/src/error-boundary.ts`); `params` carries its per-code detail — for
 * `setup.request_invalid` the `{ field }` the wizard marks invalid inline. Present because the wizard
 * needs `params.field`; the till/dashboard clients throw `{ code }` only.
 */
export interface ApiError {
  code: string;
  params?: Record<string, unknown>;
}

export class SetupApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin, so the browser fetches
   *   `/setup-api/...` from the origin serving the wizard).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  /** `GET /setup-api/status` — the box's environment + outstanding steps, read on boot. */
  getStatus(): Promise<SetupStatus> {
    return this.#request<SetupStatus>("/setup-api/status", "GET");
  }

  /**
   * `POST /setup-api/provision` — file the whole venue in one shot. On success the box restarts into
   * trading mode; any validation/state failure rejects with an {@link ApiError} the review step
   * surfaces (its `params.field` marks the offending field on `setup.request_invalid`).
   */
  provision(body: ProvisionBody): Promise<ProvisionResult> {
    return this.#request<ProvisionResult>("/setup-api/provision", "POST", body);
  }

  /**
   * `POST /setup-api/adopt` — the MIRROR-side sibling of {@link SetupApi.provision} (C2b Task 13). The
   * mirror fetches the primary's bundle server-side using the supplied admin `credential` (a nested
   * object, sent verbatim), adopts the venue into its own database, then restarts into mirror mode. On
   * success the box restarts (see {@link AdoptResult}); a failure rejects with an {@link ApiError} the
   * connect screen surfaces (`mirror.bundle_fetch_failed` when the primary is unreachable or the login
   * is refused, `setup.*` for the shared latch/deps/validation guards).
   */
  adopt(body: AdoptBody): Promise<AdoptResult> {
    return this.#request<AdoptResult>("/setup-api/adopt", "POST", body);
  }

  /**
   * The one request path both methods funnel through. `credentials: "include"` on every call — the
   * setup routes are unauthenticated (`apps/server/src/setup-api.ts`), so the cookie is irrelevant,
   * but keeping it is harmless and consistent with the till/dashboard clients. A `body` is
   * JSON-encoded and its `content-type` header set only when one is present, so a GET carries neither.
   *
   * A non-2xx becomes a rejected {@link ApiError} read from the server's `{ error: { code, params } }`
   * envelope — falling back to `server.internal` when the body names no code. Unlike the
   * till/dashboard clients this SURFACES `params`, so the wizard can drive per-field validation off
   * `setup.request_invalid`'s `{ field }`.
   *
   * A 2xx with an EMPTY body resolves to `undefined` rather than being JSON-parsed (avoids
   * `res.json()` throwing on an empty 200); both current routes send a body, so that branch is
   * defensive, mirroring the till/dashboard clients.
   *
   * `fetchImpl` is read into a local before the call so it is invoked as a free function, not as a
   * method of `this` (which would rebind a native `fetch`).
   */
  async #request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const fetchImpl = this.#fetchImpl;
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : {
            method,
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const res = await fetchImpl(this.#baseUrl + path, init);
    if (!res.ok) {
      const envelope = (await res.json()) as {
        error?: { code?: string; params?: Record<string, unknown> };
      };
      const error: ApiError = {
        code: envelope.error?.code ?? "server.internal",
        params: envelope.error?.params,
      };
      throw error;
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}
