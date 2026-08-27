import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import type { ProvisionRequest } from "./provision.js";
import type { AeatCert, CertKind } from "./aeat-credential.js";
import type { TradingConfig } from "./trading-config.js";
import { createErrorBoundary } from "./error-boundary.js";
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
 */
const PROVISION_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "setup.aeat_cert_required": 400,
  "setup.already_provisioned": 409,
  "deployment.already_stamped": 409,
};

const runProvision = createErrorBoundary(PROVISION_STATUS, "setup.provision_failed");

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

/** Validate the OPTIONAL AEAT cert's SHAPE (present fields, right types). The `certKind` VALUE
 * (`sello`|`representante`) and the base64-ness of `pfxBase64` are validated by `sealAeatCredential`,
 * which throws the same `setup.request_invalid`; this only asserts the three fields are strings. */
function parseCert(certRaw: unknown): AeatCert {
  const cert = asObject(certRaw, "aeatCert");
  return {
    pfxBase64: asString(cert.pfxBase64, "pfxBase64"),
    passphrase: asString(cert.passphrase, "passphrase"),
    certKind: asString(cert.certKind, "certKind") as CertKind,
  };
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
 *   - a root catch-all `GET *` → the `SETUP_PLACEHOLDER_HTML` shell, `text/html`, `no-cache`.
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
        const aeatCert = body.aeatCert === undefined ? undefined : parseCert(body.aeatCert);

        // Demo/live fork: live stamps production, demo stamps preproduction (provisionVenue writes it).
        const environment: DeploymentEnvironment = mode === "live" ? "production" : "preproduction";

        // Cert-required gate (spec §10): a LIVE ES-common venue files to the real AEAT and must ship a
        // certificate. Checked BEFORE provision, so nothing is stamped or minted when it is missing.
        if (
          mode === "live" &&
          venue.location.fiscalTerritory === "ES-common" &&
          aeatCert === undefined
        ) {
          throw new AppError("setup.aeat_cert_required", {});
        }

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

  // Registered LAST and matching everything, so it answers only the paths `/setup-api/status` and
  // `/setup-api/provision` (above) and any earlier route (e.g. `/health`) did not claim.
  app.get("*", (c) =>
    c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
  );
}
