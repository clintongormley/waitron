import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import type { ProvisionRequest } from "./provision.js";
import type { AdoptRequest } from "./adopt.js";
import { validateAeatCert } from "./aeat-credential.js";
import type { AeatCert, CertKind } from "./aeat-credential.js";
import type { TradingConfig } from "./trading-config.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { mountSpa } from "./spa-api.js";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * Everything setup mode needs to report on — and to PROVISION — an unprovisioned box. The
 * `environment` alone is enough for the read-only `/setup-api/status` surface (slice 1b): no `db`, no
 * session key, no tenant, because a box in setup mode has no venue bound yet, and those routes are
 * UNAUTHENTICATED like `/health` — they only announce that the box needs setting up.
 *
 * Everything below `environment` is the slice-2b provisioning surface and is OPTIONAL, so the
 * slice-1b `mountSetup(app, { environment }, log)` call sites still compile and the setup surface
 * still mounts without it. Boot supplies the real bindings; a `POST /setup-api/provision` that
 * arrives before they are wired is answered `503 setup.not_ready` rather than crashing.
 */
export interface SetupDeps {
  /** The deployment environment (`production` / `preproduction`) this box booted under, echoed by
   * `/setup-api/status` so slice 2's wizard can warn before it provisions a real production venue. */
  environment: DeploymentEnvironment;
  /** `provisionVenue({ ownerDb })` bound in boot: stamps the environment then mints the venue,
   * returning the five ids the trading boot needs. Plaintext admin secrets never reach it — the
   * provision route hashes them at the boundary. */
  provision?: (req: ProvisionRequest) => Promise<VenueResult>;
  /** `adoptFromPrimary({ ownerDb, ring, fetchBundle, persistTrading, … })` bound in boot: the
   * mirror-side sibling of `provision`. Fetches the primary's bundle SERVER-SIDE (so the admin
   * credential never touches a browser→primary hop), adopts the venue into this box's own database,
   * seals the sync token, and persists `trading.env` — returning the adopted `tenantId`. OPTIONAL for
   * the same reason `provision` is: a `POST /setup-api/adopt` that arrives before it is wired is
   * answered `503 setup.not_ready`. */
  adopt?: (req: AdoptRequest) => Promise<{ tenantId: string }>;
  /** `sealAeatCredential(db, ring, …)` bound in boot: seals the AEAT cert into the tenant's
   * `fiscal.aeat` vault purpose. Needed only when a LIVE ES-common provision supplies a certificate. */
  sealAeat?: (tenantId: string, cert: AeatCert) => Promise<void>;
  /** `writeTradingEnv(stateDir, …)` bound in boot: persists `<stateDir>/trading.env` so the next boot
   * enters trading mode. */
  persistTrading?: (cfg: TradingConfig) => Promise<void>;
  /** The app/target DB connection string persisted into `trading.env`'s `DATABASE_URL`. */
  databaseUrl?: string;
  /** The migrator DB connection string persisted into `trading.env`'s `WAITRON_MIGRATIONS_DATABASE_URL`. */
  migrationsDatabaseUrl?: string;
  /** The restart trigger (default at boot: SIGTERM → graceful shutdown → supervisor restart). Called
   * on the next tick AFTER the 200 flushes, so the wizard sees success before the box goes down. */
  requestRestart?: () => void;
  /** The built setup-wizard SPA directory to serve as the setup surface's root catch-all (slice 2c),
   * or `undefined` to serve the inline `SETUP_PLACEHOLDER_HTML` shell instead (dev/tests, and any box
   * whose wizard bundle was not built into the image). When set, `mountSpa` answers every unclaimed
   * path with the built wizard's `index.html` + assets; boot has already `assertBuiltApp`-checked the
   * dir holds an `index.html`, so a mis-built dir fails the boot loudly rather than 404ing here. From
   * `config.setupAppDir` (`WAITRON_SETUP_APP_DIR`). */
  setupAppDir?: string;
}

/**
 * The minimal shell an operator sees when the box boots unprovisioned. Deliberately a short inline
 * string, NOT a built front-end: the real setup wizard is a separate app (slice 2), and mounting a
 * catch-all that answers a bare 404 for every page load would be the §8 failure — the kind an
 * operator would only discover in the browser — that `spa-api.ts` warns against. This page always
 * renders, so a browser pointed at the box gets a clear "needs setup" message rather than a blank
 * 404. `no-cache` (below) keeps it from being pinned once the box is provisioned and the setup
 * routes stop being mounted.
 */
const SETUP_PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waitron — setup needed</title>
  </head>
  <body>
    <main>
      <h1>This Waitron box needs setup</h1>
      <p>No venue is bound to this box yet. Finish setup to start trading.</p>
    </main>
  </body>
</html>
`;

/** The placeholder's URL is stable but its meaning changes the moment the box is provisioned (the
 * setup routes stop being mounted), so it must be revalidated, never pinned — the same reasoning
 * `spa-api.ts` revalidates a non-hashed `index.html` under. */
const REVALIDATE_CACHE_CONTROL = "no-cache";

/**
 * Every AppError code the provision route can THROW inside its error boundary, and its HTTP status.
 * Request-shape faults (`setup.request_invalid`, `setup.aeat_cert_required`) default to 400 but are
 * enumerated anyway so this map is the surface's whole 4xx contract (the house style `me-api.ts`'s
 * `STATUS` follows). The two 409s are the fiscal double-provision refusals: `setup.already_provisioned`
 * (the box already holds this tenant) and `deployment.already_stamped` (a preproduction box cannot
 * become production), both raised by `provisionVenue`. `setup.not_ready`/`setup.already_provisioning`
 * are NOT here — they are returned directly, before or outside the boundary, never thrown into it.
 *
 * An UNEXPECTED fault (anything thrown inside the boundary that is NOT an `AppError`) is not in this
 * map and is NOT re-emitted: `createErrorBoundary` (error-boundary.ts) answers it with an opaque
 * `server.internal` 500 that carries no params, and logs it at `error` under the `tag` it was built
 * with. That tag — `setup.provision_failed`, the second argument to `createErrorBoundary` below — is a
 * LOG LABEL ONLY; it is never put on the wire, so on a crash the client sees `server.internal`, never
 * `setup.provision_failed`. Every code in THIS map, by contrast, is an `AppError` re-emitted verbatim
 * as `{ error: { code, params } }` at the status assigned here (or 400 when the map omits it).
 */
const PROVISION_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "setup.aeat_cert_required": 400,
  "setup.already_provisioned": 409,
  "deployment.already_stamped": 409,
};

// The `"setup.provision_failed"` here is the LOG TAG for the unexpected-crash branch, not a wire code
// (see the map's doc comment above and error-boundary.ts): a non-`AppError` is answered `server.internal`.
const runProvision = createErrorBoundary(PROVISION_STATUS, "setup.provision_failed");

/**
 * The adopt route's 4xx/5xx contract (the provision map's mirror-side sibling). `mirror.bundle_fetch_failed`
 * is the one code that is NOT a client fault: the operator's request is well-formed, but the mirror's
 * UPSTREAM — the primary it was pointed at — failed to serve or return a parseable bundle, so it maps to
 * HTTP 502 (the mirror is a gateway; its upstream failed), the status `mirror.bundle_fetch_failed`'s own
 * doc comment in errors.ts assigns it. `setup.request_invalid` (a missing/mistyped `primaryUrl`/`credential`)
 * defaults to 400 anyway but is enumerated so this map is the surface's whole contract. `setup.not_ready`/
 * `setup.already_provisioning` are NOT here — like provision's, they are returned directly, outside the
 * boundary. A non-`AppError` fault is answered an opaque `server.internal` 500 under the log tag below.
 */
const ADOPT_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "mirror.bundle_fetch_failed": 502,
};

// `"setup.adopt_failed"` is the LOG TAG for the unexpected-crash branch, not a wire code (as with
// `runProvision` above): a non-`AppError` reaching the boundary is answered `server.internal`.
const runAdopt = createErrorBoundary(ADOPT_STATUS, "setup.adopt_failed");

/** Throw the request-shape refusal for `field`, naming it but NEVER echoing its value (a PIN,
 * password, passphrase or PFX is exactly the secret a caller can mis-send). */
function invalidRequest(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidRequest(field);
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalidRequest(field);
  return value;
}

function asNullableString(value: unknown, field: string): string | null {
  return value === null ? null : asString(value, field);
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) invalidRequest(field);
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) invalidRequest(field);
  }
  return value as string[];
}

/**
 * Validate the request's venue fields (presence/shape) and HASH the admin PIN + password at this
 * boundary into a `VenueRequest` — the plaintext secrets are read, hashed and discarded here, so they
 * never enter the plan or any action (venue-plan.ts's admin note). A missing/mistyped field throws
 * `setup.request_invalid` naming the field, before any hashing or provisioning. Domain rules the plan
 * owns (locale cardinality, series-code equality, territory) are left to `planVenue` inside
 * `provisionVenue`; this screen is structural only.
 */
function parseVenue(venueRaw: unknown): VenueRequest {
  const v = asObject(venueRaw, "venue");
  const loc = asObject(v.location, "location");
  const admin = asObject(v.admin, "admin");
  return {
    country: asString(v.country, "country"),
    taxId: asString(v.taxId, "taxId"),
    legalName: asString(v.legalName, "legalName"),
    location: {
      name: asString(loc.name, "location.name"),
      fiscalTerritory: asString(loc.fiscalTerritory, "location.fiscalTerritory"),
      invoiceLocales: asStringArray(loc.invoiceLocales, "location.invoiceLocales"),
      operationDescription: asString(loc.operationDescription, "location.operationDescription"),
      addressLine1: asString(loc.addressLine1, "location.addressLine1"),
      addressLine2: asNullableString(loc.addressLine2, "location.addressLine2"),
      postalCode: asString(loc.postalCode, "location.postalCode"),
      city: asString(loc.city, "location.city"),
      province: asString(loc.province, "location.province"),
      timeZone: asString(loc.timeZone, "location.timeZone"),
      dayCutover: asString(loc.dayCutover, "location.dayCutover"),
    },
    tillName: asString(v.tillName, "tillName"),
    seriesCode: asString(v.seriesCode, "seriesCode"),
    rectificativeSeriesCode: asString(v.rectificativeSeriesCode, "rectificativeSeriesCode"),
    admin: {
      displayName: asString(admin.displayName, "admin.displayName"),
      pinHash: hashPin(asString(admin.pin, "admin.pin")),
      passwordHash: hashPassword(asString(admin.password, "admin.password")),
    },
  };
}

/** Validate the OPTIONAL AEAT cert. First the SHAPE (present fields, right types), then the VALUES
 * via `validateAeatCert` — the `certKind` (`sello`|`representante`) and the base64-ness of `pfxBase64`.
 * That value check happens HERE, before `provision`, so a malformed cert is a `400 setup.request_invalid`
 * with NOTHING stamped or minted; `sealAeatCredential` runs the same checks again as defense-in-depth,
 * but by the time it would fire the SIF/hash chain is already minted and unrepairable (CLAUDE.md §5). */
function parseCert(certRaw: unknown): AeatCert {
  const cert = asObject(certRaw, "aeatCert");
  const parsed: AeatCert = {
    pfxBase64: asString(cert.pfxBase64, "pfxBase64"),
    passphrase: asString(cert.passphrase, "passphrase"),
    certKind: asString(cert.certKind, "certKind") as CertKind,
  };
  validateAeatCert(parsed);
  return parsed;
}

/** A direct structured error response mirroring the error boundary's `{ error: { code, params } }`
 * shape, for the two refusals that are returned OUTSIDE the boundary (the latch and the deps gate). */
function directError(
  c: Context,
  log: Logger,
  code: "setup.not_ready" | "setup.already_provisioning",
  httpStatus: ContentfulStatusCode,
): Response {
  log("warn", code, {});
  return c.json({ error: { code, params: {} } }, httpStatus);
}

/**
 * Mount the UNAUTHENTICATED setup-mode routes on an existing Hono app — the whole surface the box
 * exposes while no venue is bound (design: slice 1b). Two routes:
 *
 *   - `GET /setup-api/status` → a small, STABLE JSON fact sheet
 *     `{ provisioned: false, environment, needs: ["venue"] }`. Slice 2's wizard reads this to learn
 *     what the box still needs, so the shape is a contract: `provisioned` is always `false` here (a
 *     provisioned box never mounts these routes), and `needs` lists the outstanding steps — today
 *     only `"venue"`.
 *   - a root catch-all `GET *` → either the built setup wizard (via `mountSpa`, when `deps.setupAppDir`
 *     is configured — slice 2c) or, absent that, the inline `SETUP_PLACEHOLDER_HTML` shell
 *     (`text/html`, `no-cache`). Either way it is registered LAST, so it only answers paths nothing
 *     else claimed.
 *
 * Must be called LAST, after `/health` and after `GET /setup-api/status` (Task 3 mounts it that way):
 * the catch-all only runs for a path nothing else claimed, so a route registered earlier — `/health`,
 * or the status route registered just above it here — wins its own path (a Hono handler that returns
 * without `next()` ends the chain, so an earlier terminal handler is never shadowed).
 */
export function mountSetup(app: Hono, deps: SetupDeps, log: Logger): void {
  // One line at mount so an operator scanning logs sees the box came up unprovisioned and why every
  // page is answering with the placeholder — the box's mode is not otherwise visible in the request
  // log. Fires once, not per request, so the catch-all below stays silent under browser load.
  log("info", "setup.mode_active", { environment: deps.environment });

  app.get("/setup-api/status", (c) =>
    c.json({ provisioned: false, environment: deps.environment, needs: ["venue"] }, 200),
  );

  // The one-shot provisioning latch. CLOSURE-scoped (per `mountSetup`, i.e. per booted process — one
  // mount per boot), so it survives across requests to THIS box yet gives every test its own fresh
  // latch. It is the inner ring of the double-provision guard: `applyVenue` mints a FRESH SIF/hash
  // chain on every run and `provisionVenue`'s tenant-exists check is not atomic with `applyVenue`, so
  // two concurrent provisions could each pass that check and start a second, unrecoverable chain
  // (CLAUDE.md §5). The single setup process + this latch prevent the concurrent case; the
  // tenant-exists check backstops a sequential re-POST.
  let provisioning = false;

  // POST /setup-api/provision — orchestrates the whole flow: demo/live fork → validate + hash →
  // cert-required gate → provisionVenue → seal AEAT cert → persist trading config → restart.
  // Registered BEFORE the `GET *` catch-all below (Hono first-match wins).
  app.post("/setup-api/provision", (c) => {
    // Deps gate — SYNCHRONOUS, before the latch, so an unwired box never engages it. Captured as
    // consts so TypeScript narrows them non-undefined for the async closure below.
    const provision = deps.provision;
    const sealAeat = deps.sealAeat;
    const persistTrading = deps.persistTrading;
    const requestRestart = deps.requestRestart;
    const databaseUrl = deps.databaseUrl;
    const migrationsDatabaseUrl = deps.migrationsDatabaseUrl;
    if (
      provision === undefined ||
      sealAeat === undefined ||
      persistTrading === undefined ||
      requestRestart === undefined ||
      databaseUrl === undefined ||
      migrationsDatabaseUrl === undefined
    ) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // One-shot latch — CRITICAL, and SYNCHRONOUS before ANY `await`. JS is single-threaded, so this
    // check+set completes before a second near-simultaneous POST's handler begins; the loser is
    // refused 409 here rather than being allowed to mint a second chain. Reset to false on ANY
    // failure (below) so a corrected retry works; LEFT true on success — the box is about to restart.
    if (provisioning) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runProvision(c, log, async () => {
      try {
        // Parse defensively: `c.req.json()` throws on a malformed body and returns `null` for a
        // literal JSON `null` — both are a bad request, not a 500.
        const parsed: unknown = await c.req.json().catch(() => null);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          invalidRequest("body");
        }
        const body = parsed as Record<string, unknown>;

        const mode = body.mode;
        if (mode !== "demo" && mode !== "live") invalidRequest("mode");

        const venue = parseVenue(body.venue);

        // Demo/live fork: live stamps production, demo stamps preproduction (provisionVenue writes it).
        const environment: DeploymentEnvironment = mode === "live" ? "production" : "preproduction";

        // The AEAT signing cert is meaningful IFF a LIVE ES-common venue files to the real AEAT — that
        // is exactly the condition the required-gate below (spec §10) demands it. Make the rule
        // SYMMETRIC, gating on PRESENCE (not the parsed value) BEFORE `parseCert`, both arms checked
        // BEFORE `provision` so nothing is stamped/minted/sealed on a bad request:
        //   - cert expected but MISSING → `setup.aeat_cert_required` (a live ES-common box must ship one);
        //   - cert NOT expected but PRESENT → `setup.request_invalid` naming `aeatCert`. The 2c client
        //     already gates the cert on live mode and never sends it otherwise, so this is
        //     defense-in-depth (CLAUDE.md §5): it stops a real AEAT signing cert being sealed into a
        //     preproduction tenant's vault by a hand-crafted demo body. Gating on presence means a
        //     MALFORMED cert on a non-expected request rejects cleanly with `{ field: "aeatCert" }` and
        //     no wasted `parseCert` validation — instead of `parseCert` naming a sub-field
        //     (`pfxBase64`/`passphrase`/`certKind`, or `aeatCert` for a non-object), which would leak
        //     which part of a cert we were never going to accept.
        const certExpected = mode === "live" && venue.location.fiscalTerritory === "ES-common";
        const certPresent = body.aeatCert !== undefined;
        if (certExpected && !certPresent) {
          throw new AppError("setup.aeat_cert_required", {});
        }
        if (!certExpected && certPresent) {
          invalidRequest("aeatCert");
        }
        // `certExpected` implies `certPresent` here (we threw otherwise), so `parseCert` — and its
        // value validation — runs ONLY on the expected path, where a malformed cert must still fail
        // with `parseCert`'s field detail: the offending sub-field (`pfxBase64`/`passphrase`/
        // `certKind`), or `aeatCert` when the whole value is not an object. Non-expected requests
        // never reach it.
        const aeatCert = certExpected ? parseCert(body.aeatCert) : undefined;

        const result = await provision({ environment, venue });

        // Seal the AEAT cert AFTER provision mints the tenant (the vault row is FK-restricted to it)
        // and BEFORE the trading config is persisted.
        if (aeatCert !== undefined) {
          await sealAeat(result.tenantId, aeatCert);
        }

        await persistTrading({
          tenantId: result.tenantId,
          tillId: result.tillId,
          nodeId: result.nodeId,
          seriesId: result.seriesIds[0],
          locationId: result.locationId,
          databaseUrl,
          migrationsDatabaseUrl,
          environment,
        });

        const response = c.json(
          { provisioned: true, tenantId: result.tenantId, restarting: true },
          200,
        );
        // Flush the 200 FIRST, then restart on the next tick so the wizard sees success before the box
        // goes down (`setTimeout`, not `queueMicrotask`, so the response promise resolves before it).
        setTimeout(() => requestRestart(), 0);
        return response;
      } catch (error) {
        // Reset on ANY failure so a corrected retry is accepted. On SUCCESS the function has already
        // returned above, so the latch stays true and no second provision can start before the box
        // restarts out of setup mode.
        provisioning = false;
        throw error;
      }
    });
  });

  // POST /setup-api/adopt — the MIRROR-side sibling of provision (C2b Task 9). Fetches the primary's
  // bundle server-side, adopts the venue into this box's own database, seals the token + persists
  // `trading.env`, then restarts into mirror mode. It REUSES provision's one-shot latch (the same
  // `provisioning` closure variable): a box is set up EITHER as a primary (provision) OR as a mirror
  // (adopt), never both, so a start of either action must latch out a concurrent start of the other —
  // the same "one unrecoverable first-boot action" guard, expressed once. Registered BEFORE the
  // `GET *` catch-all below (Hono first-match wins).
  app.post("/setup-api/adopt", (c) => {
    // Deps gate — SYNCHRONOUS, before the latch, so an unwired box never engages it. Only `adopt` and
    // `requestRestart` are load-bearing for this route (the fetch/persist deps are captured inside the
    // `adopt` closure in boot). Captured as consts so TypeScript narrows them non-undefined below.
    const adopt = deps.adopt;
    const requestRestart = deps.requestRestart;
    if (adopt === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // One-shot latch — CRITICAL, SYNCHRONOUS before ANY `await` — shared with provision (above). The
    // loser is refused 409 here rather than starting a second adopt. Reset to false on ANY failure
    // (below) so a corrected retry works; LEFT true on success — the box is about to restart.
    if (provisioning) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runAdopt(c, log, async () => {
      try {
        // `readJsonBody` coerces an empty/malformed/`null` body to `{}` so a degenerate body falls
        // through to the field screen below (a 400) rather than an opaque 500. The credential is NEVER
        // logged — `asString` echoes the field NAME only, never its value.
        const body = await readJsonBody<{ primaryUrl?: unknown; credential?: unknown }>(c);
        const primaryUrl = asString(body.primaryUrl, "primaryUrl");
        const credential = asString(body.credential, "credential");

        const { tenantId } = await adopt({ primaryUrl, credential });

        const response = c.json({ adopted: true, tenantId, restarting: true }, 200);
        // Flush the 200 FIRST, then restart on the next tick so the wizard sees success before the box
        // goes down (`setTimeout`, not `queueMicrotask`, so the response promise resolves before it) —
        // the same persist-then-restart transition provision uses.
        setTimeout(() => requestRestart(), 0);
        return response;
      } catch (error) {
        // Reset on ANY failure so a corrected retry is accepted. On SUCCESS the function has already
        // returned above, so the latch stays true and no second setup action can start before restart.
        provisioning = false;
        throw error;
      }
    });
  });

  // The root catch-all, registered LAST and matching everything, so it answers only the paths
  // `/setup-api/status` and `/setup-api/provision` (above) and any earlier route (e.g. `/health`, or
  // the setup branch's discovery/CA/trust routes registered before this mount) did not claim. When a
  // built wizard dir is configured (slice 2c), serve it as that catch-all via `mountSpa` — basePath
  // "" = origin root, exactly like the till: the root "/" serves index.html and real files under the
  // dir serve their bytes, while a stray unmatched path 404s (mountSpa has no SPA history fallback —
  // the wizard is an in-memory-state SPA, so a reload only ever lands on "/"). Absent a configured dir
  // serve the inline placeholder shell (dev, and any box whose wizard bundle was not built in). Boot
  // has already `assertBuiltApp`-checked a configured dir holds an `index.html`, so `mountSpa` here
  // never becomes a catch-all that 404s the root itself.
  if (deps.setupAppDir !== undefined) {
    mountSpa(app, { root: deps.setupAppDir, basePath: "" }, log);
  } else {
    app.get("*", (c) =>
      c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
    );
  }
}
