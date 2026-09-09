import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "@waitron/composition";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  resolveFiscalJurisdiction,
} from "@waitron/country";
import { getVenueSetupCountryPack } from "@waitron/country-packs";
import { hashPassword, hashPin, normalizeAndValidateEmail } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { DeploymentEnvironment } from "./config.js";
import type { ProvisionRequest } from "./provision.js";
import type { AdoptCredential, AdoptRequest } from "./adopt.js";
import type { TradingConfig } from "./trading-config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { assertSafePrimaryUrl } from "./primary-url.js";
import { mountSpa } from "./spa-api.js";
import type { Logger } from "./logger.js";
import type {
  ActiveSetupOperation,
  SetupOperationPhase,
  SetupOperationStore,
} from "./setup-operation.js";
import type { RestoreRequest } from "./restore-request.js";
import type { ConfigurationPreview } from "./configuration-import.js";
import type { FiscalContribution } from "@waitron/fiscal";
import type { FiscalReadinessResult } from "./fiscal-readiness.js";
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
  /** Keeps a developer Live walkthrough on preproduction transports after restart. */
  devMode?: boolean;
  /** `provisionVenue({ ownerDb, moduleConfig, database, stateDir })` bound in boot: resolves the fiscal
   * slot from the request's territory (`venueModuleConfig`), refuses a foreign/existing tenant, stamps
   * the environment, mints the venue, and persists the resolved `modules.json` — returning the five ids
   * the trading boot needs. Plaintext admin secrets never reach it — the provision route hashes them at
   * the boundary. */
  provision?: (req: ProvisionRequest) => Promise<VenueResult>;
  /** Reconstructs the one venue committed by this persisted request after a process interruption. */
  recoverProvision?: (req: ProvisionRequest) => Promise<VenueResult>;
  /** Adds the installed sample restaurant after a Demo venue is minted. Prepare and Live never call
   * it. Boot binds the runtime seed; keeping it injected lets the route prove the mode fork without
   * touching external files or a database in its orchestration tests. */
  seedDemo?: (result: VenueResult, req: ProvisionRequest) => Promise<void>;
  /** `adoptFromPrimary({ ownerDb, ring, fetchBundle, persistTrading, … })` bound in boot: the
   * mirror-side sibling of `provision`. Fetches the primary's bundle SERVER-SIDE (so the admin
   * credential never touches a browser→primary hop), adopts the venue into this box's own database,
   * seals the sync token, and persists `trading.env` — returning the adopted `tenantId`. OPTIONAL for
   * the same reason `provision` is: a `POST /setup-api/adopt` that arrives before it is wired is
   * answered `503 setup.not_ready`. Returns the adopted `tenantId` plus the freshly minted
   * `breakGlassSecret` — the offline promote fallback, surfaced ONCE in the connect response below and
   * never logged (the mirror-bundle sync-token discipline). */
  adopt?: (req: AdoptRequest) => Promise<{ tenantId: string; breakGlassSecret: string }>;
  /** The owner DB connection and vault key ring, injected by boot (which already holds both). Used to
   * seal the fiscal regime's provision-time secret through the fiscal contribution's
   * `provisioningSecret.seal` seat — so BOOT imports no regime package. Needed only when the resolved
   * regime demands a secret for this environment (Veri*Factu: a production provision's AEAT cert). */
  db?: Database;
  ring?: KeyRing;
  /** Establishes the node's membership identity after provisionVenue mints it (design §4): generates a
   * keypair, seals the private key, stamps nodes.public_key. Bound in boot to
   * `establishNodeIdentity({ ownerDb, ring }, …)`. Optional like the other provision deps so an unwired
   * box refuses via the deps gate rather than half-provisioning. Provision path only — a mirror seals none. */
  establishIdentity?: (tenantId: string, nodeId: string) => Promise<void>;
  /** `seedTermZeroMembership({ db, ring }, …)` bound in boot: mints the venue's term-0 membership
   * document right after `establishIdentity` seals the identity key. A fresh primary signs its own
   * single-node org chart (design §6 R1), so a document exists before any promotion needs to bump one.
   * Optional like the other provision deps so an unwired box refuses via the deps gate. Provision path
   * only — a mirror inherits the primary's document at adoption and refreshes it at boot via the
   * membership reconciliation fetch (`GET /management-api/membership` → `persistNodeMembershipIfNewer`),
   * NOT the `packages/sync` replication lane (`node_membership` is not enrolled there), and mints
   * none. */
  seedMembership?: (tenantId: string, nodeId: string) => Promise<void>;
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
  /** Persistent first-boot serialization and progress, shared by provision, adoption and recovery. */
  operations?: SetupOperationStore;
  /** Stages an encrypted cold-recovery artifact for the entrypoint to restore after restart. */
  stageRestore?: (request: RestoreRequest) => Promise<void>;
  /** Validates and stages a prepared configuration archive before live provisioning. */
  stageConfiguration?: (artifact: Uint8Array, passphrase: string) => Promise<ConfigurationPreview>;
  /** Removes any staged archive after the selected venue and its configuration are durable. */
  clearConfiguration?: () => Promise<void>;
  /** Runs one explicit preproduction submission for the intended live fiscal inputs. */
  runFiscalTest?: (input: {
    request: ProvisionRequest;
    contribution: FiscalContribution;
    secret: unknown;
  }) => Promise<FiscalReadinessResult>;
  /** Refuses first production activation unless matching accepted server evidence exists. */
  assertFiscalReady?: (input: {
    request: ProvisionRequest;
    contribution: FiscalContribution;
    secret: unknown;
  }) => Promise<void>;
}

const SETUP_PHASES: readonly SetupOperationPhase[] = [
  "started",
  "venue_committed",
  "content_seeded",
  "identity_established",
  "membership_seeded",
  "secret_sealed",
  "publishing",
  "complete",
];

function setupPhaseReached(
  operation: ActiveSetupOperation | undefined,
  phase: SetupOperationPhase,
): boolean {
  return (
    operation !== undefined && SETUP_PHASES.indexOf(operation.phase) >= SETUP_PHASES.indexOf(phase)
  );
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
/** Bounds memory consumed by one unauthenticated setup upload. */
export const MAX_RESTORE_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_CONFIGURATION_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Every AppError code the provision route can THROW inside its error boundary, and its HTTP status.
 * Request-shape faults (`setup.request_invalid`, `setup.provisioning_secret_required`) default to 400 but are
 * enumerated anyway so this map is the surface's whole 4xx contract (the house style `me-api.ts`'s
 * `STATUS` follows). The 409s are provisioning refusals raised by `provisionVenue`:
 * `setup.already_provisioned` (the box already holds this tenant) and `deployment.already_stamped`
 * (a preproduction box cannot become production) — the fiscal double-provision pair — plus
 * `module.provision_only_disabled` (a `provision-only` module, fiscal, is disabled in `modules.json`,
 * so the box must not mint a fiscal chain — SP-1b's fiscal gate, step 0 of `provisionVenue`). All
 * three are a request that conflicts with the box's current state/config, hence 409.
 * `setup.not_ready`/`setup.already_provisioning` are NOT here — they are returned directly, before or
 * outside the boundary, never thrown into it.
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
  "setup.provisioning_secret_required": 400,
  "setup.fiscal_test_required": 409,
  // A present-but-malformed `admin.email` fails identity's `isValidEmail` screen (see `parseVenue`).
  // The domain-named code identity raises for the same write-boundary check; defaults to 400 anyway,
  // enumerated so this map stays the surface's whole 4xx contract.
  "person.email_invalid": 400,
  "setup.already_provisioned": 409,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
  "deployment.already_stamped": 409,
  // SP-1b fiscal gate: provisioning refused because a `provision-only` module (fiscal) is disabled in
  // `modules.json`. A conflict with the box's config, like the two refusals above — 409, not 400.
  // Under default-on this never fires (no UI disables fiscal); enumerated so the map stays the whole
  // 4xx contract. The setup wizard has no bespoke banner for it (its `default` case handles it) — a
  // fiscal-less venue is not reachable through the wizard until SP-3.
  "module.provision_only_disabled": 409,
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
 * and `mirror.primary_url_invalid` (a `primaryUrl` the SSRF guard refused) are both CLIENT faults that
 * default to 400 anyway but are enumerated so this map is the surface's whole contract. `setup.not_ready`/
 * `setup.already_provisioning` are NOT here — like provision's, they are returned directly, outside the
 * boundary. A non-`AppError` fault is answered an opaque `server.internal` 500 under the log tag below.
 */
const ADOPT_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  // A `primaryUrl` the SSRF guard refused — a CLIENT fault, so 400 (defaults to 400 too, enumerated so
  // this map is the surface's whole contract, like `setup.request_invalid`). Distinct from the 502 below:
  // that is a well-formed request whose UPSTREAM primary failed, this is a malformed request.
  "mirror.primary_url_invalid": 400,
  "mirror.bundle_fetch_failed": 502,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
};

// `"setup.adopt_failed"` is the LOG TAG for the unexpected-crash branch, not a wire code (as with
// `runProvision` above): a non-`AppError` reaching the boundary is answered `server.internal`.
const runAdopt = createErrorBoundary(ADOPT_STATUS, "setup.adopt_failed");
const runRestore = createErrorBoundary(PROVISION_STATUS, "setup.restore_failed");

/** Throw the request-shape refusal for `field`, naming it but NEVER echoing its value (a PIN,
 * password or certificate secret is exactly the value a caller can mis-send). */
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
 * Validate the request's venue fields and HASH the admin PIN + password at this
 * boundary into a `VenueRequest` — the plaintext secrets are read, hashed and discarded here, so they
 * never enter the plan or any action. The country pack repeats the browser's tax-id, postcode,
 * province and jurisdiction checks here and derives the persisted fiscal territory and time zone.
 * A missing, mistyped or country-invalid field throws `setup.request_invalid` naming the field,
 * before any provisioning. The plan retains its country/territory and other domain guards as a
 * second boundary for non-setup callers.
 */
function parseVenue(venueRaw: unknown): VenueRequest {
  const v = asObject(venueRaw, "venue");
  const loc = asObject(v.location, "location");
  const admin = asObject(v.admin, "admin");
  const countryInput = asString(v.country, "country");
  const taxIdInput = asString(v.taxId, "taxId");
  const fiscalTerritoryInput = asString(loc.fiscalTerritory, "location.fiscalTerritory");
  const invoiceLocales = asStringArray(loc.invoiceLocales, "location.invoiceLocales");
  const postalCodeInput = asString(loc.postalCode, "location.postalCode");
  const provinceInput = asString(loc.province, "location.province");
  const timeZoneInput = asString(loc.timeZone, "location.timeZone");

  const country = getVenueSetupCountryPack(countryInput);
  if (country === undefined) invalidRequest("country");

  const taxId = country.taxIdentifier?.validate(taxIdInput);
  if (taxId?.valid === false) invalidRequest("taxId");
  const postalCode = country.postalCode?.validate(postalCodeInput);
  if (postalCode?.valid === false) invalidRequest("location.postalCode");

  const area = findAdministrativeArea(country, provinceInput);
  if (country.administrativeAreas.length > 0 && area === undefined) {
    invalidRequest("location.province");
  }
  if (country.administrativeAreas.length > 0) {
    const postalArea =
      postalCode?.valid === true
        ? findAdministrativeAreaByPostalCode(country, postalCode.normalized)
        : undefined;
    if (postalArea === undefined || postalArea.code !== area?.code) {
      invalidRequest("location.province");
    }
  }

  const jurisdiction = resolveFiscalJurisdiction(country, area?.code);
  if (jurisdiction === undefined || !jurisdiction.supported || jurisdiction.modules === undefined) {
    invalidRequest("location.fiscalTerritory");
  }
  if (fiscalTerritoryInput !== jurisdiction.id) invalidRequest("location.fiscalTerritory");
  if (timeZoneInput !== (area?.timeZone ?? country.defaultTimeZone)) {
    invalidRequest("location.timeZone");
  }
  if (invoiceLocales.some((locale) => !country.invoiceLocales.includes(locale))) {
    invalidRequest("location.invoiceLocales");
  }

  return {
    country: country.countryCode,
    taxId: taxId?.valid === true ? taxId.normalized : taxIdInput,
    legalName: asString(v.legalName, "legalName"),
    location: {
      name: asString(loc.name, "location.name"),
      fiscalTerritory: jurisdiction.id,
      invoiceLocales,
      operationDescription: asString(loc.operationDescription, "location.operationDescription"),
      addressLine1: asString(loc.addressLine1, "location.addressLine1"),
      addressLine2: asNullableString(loc.addressLine2, "location.addressLine2"),
      postalCode: postalCode?.valid === true ? postalCode.normalized : postalCodeInput,
      city: asString(loc.city, "location.city"),
      province: area?.name ?? provinceInput,
      timeZone: area?.timeZone ?? country.defaultTimeZone,
      dayCutover: asString(loc.dayCutover, "location.dayCutover"),
    },
    tillName: asString(v.tillName, "tillName"),
    seriesCode: asString(v.seriesCode, "seriesCode"),
    rectificativeSeriesCode: asString(v.rectificativeSeriesCode, "rectificativeSeriesCode"),
    admin: {
      displayName: asString(admin.displayName, "admin.displayName"),
      pinHash: hashPin(asString(admin.pin, "admin.pin")),
      passwordHash: hashPassword(asString(admin.password, "admin.password")),
      // The admin's REQUIRED dashboard-login email. Presence/shape screened by `asString`
      // (`setup.request_invalid`, like every sibling field), then NORMALIZED (trim + lowercase) and
      // format-validated by identity's own write-boundary rule `normalizeAndValidateEmail` — the SAME
      // helper `createPerson`/`setEmail` use, so the onboarding path cannot drift from the dashboard's
      // (a present-but-malformed value is `person.email_invalid`). NOT hashed: the email is not a
      // secret, so the normalized value reaches `provision` verbatim for the seeded `persons` row
      // (venue-apply.ts writes it) so the email-based dashboard login can resolve it.
      email: normalizeAndValidateEmail(asString(admin.email, "admin.email")),
    },
  };
}

function parseProvisionPayload(
  parsed: unknown,
  devMode: boolean,
): {
  mode: "demo" | "prepare" | "live";
  request: ProvisionRequest;
  contribution: FiscalContribution;
  secret: FiscalContribution["provisioningSecret"];
  secretExpected: boolean;
  rawSecret: unknown;
} {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    invalidRequest("body");
  }
  const body = parsed as Record<string, unknown>;
  const mode = body.mode;
  if (mode !== "demo" && mode !== "prepare" && mode !== "live") invalidRequest("mode");
  if (body.configurationImport !== undefined && typeof body.configurationImport !== "boolean") {
    invalidRequest("configurationImport");
  }
  if (body.configurationImport === true && mode !== "live") invalidRequest("configurationImport");

  const venue = parseVenue(body.venue);
  const environment: DeploymentEnvironment =
    mode === "live" && !devMode ? "production" : "preproduction";
  const selection = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  if (selection.contribution === undefined) invalidRequest("location.fiscalTerritory");
  const contribution = selection.contribution;
  const secret = contribution.provisioningSecret;
  const secretExpected = secret?.required(environment) ?? false;
  const present = body.aeatCert !== undefined;
  if (secretExpected && !present) {
    throw new AppError("setup.provisioning_secret_required", { module: contribution.id });
  }
  if (!secretExpected && present) invalidRequest("aeatCert");
  if (secretExpected) secret!.validate(body.aeatCert);
  return {
    mode,
    request: {
      environment,
      venue,
      configurationImport: mode === "live" && body.configurationImport === true,
    },
    contribution,
    secret,
    secretExpected,
    rawSecret: body.aeatCert,
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
 * exposes while no venue is bound (design: slice 1b/2b, plus C2b's adopt). The routes:
 *
 *   - `GET /setup-api/status` → a small, STABLE JSON fact sheet
 *     `{ provisioned: false, environment, needs: ["venue"] }`. Slice 2's wizard reads this to learn
 *     what the box still needs, so the shape is a contract: `provisioned` is always `false` here (a
 *     provisioned box never mounts these routes), and `needs` lists the outstanding steps — today
 *     only `"venue"`.
 *   - `POST /setup-api/provision` → the PRIMARY-box path (slice 2b): mints the venue on this box and
 *     restarts it into trading mode. Gated on `deps.provision` being wired (`503 setup.not_ready`).
 *   - `POST /setup-api/adopt` → the MIRROR-box path (C2b): fetches the primary's bundle server-side,
 *     adopts the venue into this box, and restarts into mirror mode. Gated on `deps.adopt` the same way.
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

  app.get("/setup-api/status", async (c) => {
    let operation: Awaited<ReturnType<SetupOperationStore["read"]>> | undefined;
    let operationBlocked = false;
    try {
      operation = await deps.operations?.read();
    } catch (error) {
      if (!isAppError(error) || error.code !== "setup.operation_conflict") throw error;
      operationBlocked = true;
      log("error", "setup.operation_conflict", {});
    }
    return c.json(
      {
        provisioned: false,
        environment: deps.environment,
        ...(deps.devMode === true ? { developmentMode: true } : {}),
        needs: ["venue"],
        ...(operationBlocked ? { operationBlocked: true } : {}),
        ...(operation === undefined || operation === null
          ? {}
          : {
              operation: {
                id: operation.id,
                kind: operation.kind,
                phase: operation.phase,
                updatedAt: operation.updatedAt,
              },
            }),
      },
      200,
    );
  });

  let provisioning = false;
  let fiscalTesting = false;
  let configurationStaging = false;

  app.post("/setup-api/fiscal-test", async (c) => {
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    fiscalTesting = true;
    return runProvision(c, log, async () => {
      try {
        if (deps.runFiscalTest === undefined) return directError(c, log, "setup.not_ready", 503);
        const parsed = await c.req.json().catch(() => null);
        const payload = parseProvisionPayload(parsed, deps.devMode === true);
        if (payload.mode !== "live" || payload.request.environment !== "production") {
          invalidRequest("mode");
        }
        return c.json(
          await deps.runFiscalTest({
            request: payload.request,
            contribution: payload.contribution,
            secret: payload.rawSecret,
          }),
        );
      } finally {
        fiscalTesting = false;
      }
    });
  });

  // The one-shot provisioning latch. CLOSURE-scoped (per `mountSetup`, i.e. per booted process — one
  // mount per boot), so it survives across requests to THIS box yet gives every test its own fresh
  // latch. It is SHARED with the adopt route below (a box is set up EITHER as a primary via provision
  // OR as a mirror via adopt, never both), so a start of either action latches out a concurrent start
  // of the other — the double-first-boot guard, expressed once. It is the inner ring of that guard:
  // `applyVenue` mints a FRESH SIF/hash chain on every run and `provisionVenue`'s tenant-exists check
  // is not atomic with `applyVenue`, so two concurrent provisions could each pass that check and start
  // a second, unrecoverable chain (CLAUDE.md §5). The single setup process + this latch prevent the
  // concurrent case; the tenant-exists check backstops a sequential re-POST.
  // POST /setup-api/provision — orchestrates the whole flow: onboarding intent → validate + hash →
  // provisioning-secret gate (validate upfront) → provisionVenue → seal the secret → persist trading
  // config → restart. Registered BEFORE the `GET *` catch-all below (Hono first-match wins).
  app.post("/setup-api/provision", async (c) => {
    // Deps gate — SYNCHRONOUS, before the latch, so an unwired box never engages it. Captured as
    // consts so TypeScript narrows them non-undefined for the async closure below.
    const provision = deps.provision;
    const recoverProvision = deps.recoverProvision;
    const seedDemo = deps.seedDemo;
    const establishIdentity = deps.establishIdentity;
    const seedMembership = deps.seedMembership;
    const db = deps.db;
    const ring = deps.ring;
    const persistTrading = deps.persistTrading;
    const requestRestart = deps.requestRestart;
    const databaseUrl = deps.databaseUrl;
    const migrationsDatabaseUrl = deps.migrationsDatabaseUrl;
    if (
      provision === undefined ||
      (deps.operations !== undefined && recoverProvision === undefined) ||
      seedDemo === undefined ||
      establishIdentity === undefined ||
      seedMembership === undefined ||
      db === undefined ||
      ring === undefined ||
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
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const requestHash = createHash("sha256")
      .update(await c.req.raw.clone().text())
      .digest("hex");
    const execute = async (operation?: ActiveSetupOperation): Promise<Response> => {
      try {
        // Parse defensively: `c.req.json()` throws on a malformed body and returns `null` for a
        // literal JSON `null` — both are a bad request, not a 500.
        const parsed: unknown = await c.req.json().catch(() => null);
        const payload = parseProvisionPayload(parsed, deps.devMode === true);
        const {
          mode,
          request,
          contribution,
          secret,
          secretExpected: expected,
          rawSecret,
        } = payload;
        const { environment, venue } = request;
        if (environment === "production") {
          if (deps.assertFiscalReady === undefined) {
            throw new AppError("setup.fiscal_test_required", { module: contribution.id });
          }
          await deps.assertFiscalReady({ request, contribution, secret: rawSecret });
        }
        let result: VenueResult;
        if (operation !== undefined && operation.phase !== "started") {
          result = operation.data.result as VenueResult;
        } else {
          try {
            result = await provision(request);
          } catch (error) {
            if (
              operation === undefined ||
              recoverProvision === undefined ||
              !isAppError(error) ||
              error.code !== "setup.already_provisioned"
            ) {
              throw error;
            }
            result = await recoverProvision(request);
          }
          await operation?.advance("venue_committed", { result });
        }

        if (!setupPhaseReached(operation, "content_seeded")) {
          if (mode === "demo") {
            await seedDemo(result, { environment, venue });
          }
          await operation?.advance("content_seeded");
        }

        // Establish this node's membership identity (design §4): after the tenant/node are minted (the
        // vault row is FK-restricted to the tenant) and before the trading config is persisted. A fresh
        // primary becomes its own sole trust anchor; boot reads it into membershipTrustSet.
        if (!setupPhaseReached(operation, "identity_established")) {
          await establishIdentity(result.tenantId, result.nodeId);
          await operation?.advance("identity_established");
        }

        // Seed the venue's term-0 membership document (design §6 R1): after the identity key exists,
        // before the trading config is persisted. The primary signs its own org chart; boot has
        // nothing to bump yet.
        if (!setupPhaseReached(operation, "membership_seeded")) {
          await seedMembership(result.tenantId, result.nodeId);
          await operation?.advance("membership_seeded");
        }

        // Seal the regime's provisioning secret AFTER provision mints the tenant (the vault row is
        // FK-restricted to it) and BEFORE the trading config is persisted. Reaches the regime only
        // through the `seal` seat, so this host imports no regime package.
        if (!setupPhaseReached(operation, "secret_sealed")) {
          if (expected) await secret!.seal({ db, ring }, result.tenantId, rawSecret);
          await operation?.advance("secret_sealed");
        }

        if (!setupPhaseReached(operation, "publishing")) {
          await persistTrading({
            tenantId: result.tenantId,
            tillId: result.tillId,
            nodeId: result.nodeId,
            seriesId: result.seriesIds[0],
            locationId: result.locationId,
            databaseUrl,
            migrationsDatabaseUrl,
            environment,
            ...(deps.devMode === true ? { developmentMode: true } : {}),
            onboardingIntent: mode,
          });
          await deps.clearConfiguration?.();
          await operation?.advance("publishing");
        }

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
    };
    return runProvision(c, log, async () => {
      if (deps.operations === undefined) return execute();
      return deps.operations.run("provision", requestHash, async (operation) => {
        if (operation.phase === "complete") {
          return c.json(
            operation.data as { provisioned: true; tenantId: string; restarting: true },
          );
        }
        const response = await execute(operation);
        if (response.ok) {
          await operation.complete((await response.clone().json()) as Record<string, unknown>);
        }
        return response;
      });
    });
  });

  // POST /setup-api/adopt — the MIRROR-side sibling of provision (C2b Task 9). Fetches the primary's
  // bundle server-side, adopts the venue into this box's own database, seals the token + persists
  // `trading.env`, then restarts into mirror mode. It REUSES provision's one-shot latch (the same
  // `provisioning` closure variable): a box is set up EITHER as a primary (provision) OR as a mirror
  // (adopt), never both, so a start of either action must latch out a concurrent start of the other —
  // the same "one unrecoverable first-boot action" guard, expressed once. Registered BEFORE the
  // `GET *` catch-all below (Hono first-match wins).
  app.post("/setup-api/adopt", async (c) => {
    // Deps gate — SYNCHRONOUS, before the latch, so an unwired box never engages it. Only `adopt` and
    // `requestRestart` are required for this route (the fetch/persist deps are captured inside the
    // `adopt` closure in boot). Captured as consts so TypeScript narrows them non-undefined below.
    const adopt = deps.adopt;
    const requestRestart = deps.requestRestart;
    if (adopt === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // One-shot latch — CRITICAL, SYNCHRONOUS before ANY `await` — shared with provision (above). The
    // loser is refused 409 here rather than starting a second adopt. Reset to false on ANY failure
    // (below) so a corrected retry works; LEFT true on success — the box is about to restart.
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const requestHash = createHash("sha256")
      .update(await c.req.raw.clone().text())
      .digest("hex");
    const execute = () =>
      runAdopt(c, log, async () => {
        try {
          // `readJsonBody` coerces an empty/malformed/`null` body to `{}` so a degenerate body falls
          // through to the field screen below (a 400) rather than an opaque 500. Validate the credential
          // PER FIELD here — the primary's login object (`personId`/`password` required, `totp` optional) —
          // so a wrong-shape body is refused at the mirror's OWN boundary as a clean `setup.request_invalid`
          // 400, never forwarded to fail the primary and surface as an opaque `mirror.bundle_fetch_failed`
          // 502. The password/TOTP is NEVER logged — `asString` echoes the field NAME only, never its value.
          const body = await readJsonBody<{ primaryUrl?: unknown; credential?: unknown }>(c);
          const primaryUrl = asString(body.primaryUrl, "primaryUrl");
          // SSRF guard — `/setup-api/adopt` is UNAUTHENTICATED, so an attacker who can reach a mirror in
          // setup could otherwise point `primaryUrl` at the cloud metadata endpoint or an internal host and
          // drive the box to POST its admin credential there. Refuse a scheme/host the policy disallows HERE,
          // before `adopt` runs `fetchBundle` — no fetch is attempted for a rejected URL. Throws
          // `mirror.primary_url_invalid` (400 via `ADOPT_STATUS`); the value is never echoed.
          assertSafePrimaryUrl(primaryUrl);
          const cred = asObject(body.credential, "credential");
          const credential: AdoptCredential = {
            personId: asString(cred.personId, "credential.personId"),
            password: asString(cred.password, "credential.password"),
            totp: cred.totp === undefined ? undefined : asString(cred.totp, "credential.totp"),
          };

          const { tenantId, breakGlassSecret } = await adopt({ primaryUrl, credential });

          // Surface the break-glass secret ONCE, here, in the connect response — the operator's only
          // chance to record the offline promote fallback. It is NEVER logged (mirroring the sync-token
          // discipline): no `log(...)` call on this success path carries it, and it is not put in the
          // `setup.adopt_failed` error branch either.
          const response = c.json(
            { adopted: true, tenantId, breakGlassSecret, restarting: true },
            200,
          );
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
    if (deps.operations === undefined) return execute();
    return deps.operations.run("adopt", requestHash, async (operation) => {
      if (operation.phase === "complete") {
        return c.json(operation.data as { adopted: true; tenantId: string; restarting: true });
      }
      const response = await execute();
      if (response.ok) {
        const result = (await response.clone().json()) as { tenantId: string };
        await operation.complete({ adopted: true, tenantId: result.tenantId, restarting: true });
      }
      return response;
    });
  });

  app.post("/setup-api/restore", async (c) => {
    const stageRestore = deps.stageRestore;
    const requestRestart = deps.requestRestart;
    if (stageRestore === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runRestore(c, log, async () => {
      try {
        if (!c.req.header("content-type")?.toLowerCase().startsWith("application/octet-stream")) {
          invalidRequest("artifact");
        }
        const declaredLength = Number(c.req.header("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_RESTORE_UPLOAD_BYTES) {
          invalidRequest("artifact");
        }
        const recoveryKey = asString(c.req.header("x-waitron-recovery-key"), "recoveryKey");
        const rawEnvironment = c.req.header("x-waitron-restore-environment");
        if (rawEnvironment !== "production" && rawEnvironment !== "preproduction") {
          invalidRequest("environment");
        }
        const artifact = new Uint8Array(await c.req.arrayBuffer());
        if (artifact.byteLength === 0 || artifact.byteLength > MAX_RESTORE_UPLOAD_BYTES) {
          invalidRequest("artifact");
        }
        const requestHash = createHash("sha256")
          .update(rawEnvironment)
          .update("\0")
          .update(recoveryKey)
          .update("\0")
          .update(artifact)
          .digest("hex");
        const execute = async (): Promise<Response> => {
          await stageRestore({ artifact, recoveryKey, environment: rawEnvironment });
          const response = c.json({ restoreStaged: true, restarting: true }, 202);
          setTimeout(() => requestRestart(), 0);
          return response;
        };
        if (deps.operations === undefined) return execute();
        return deps.operations.run("restore", requestHash, async (operation) => {
          if (operation.phase === "complete") {
            return c.json({ restoreStaged: true, restarting: true }, 202);
          }
          const response = await execute();
          await operation.complete({ restoreStaged: true, restarting: true });
          return response;
        });
      } catch (error) {
        provisioning = false;
        throw error;
      }
    });
  });

  app.post("/setup-api/configuration", async (c) => {
    const stage = deps.stageConfiguration;
    if (stage === undefined) return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    configurationStaging = true;
    return runRestore(c, log, async () => {
      try {
        if (!c.req.header("content-type")?.toLowerCase().startsWith("application/octet-stream")) {
          invalidRequest("artifact");
        }
        const passphrase = asString(c.req.header("x-waitron-export-passphrase"), "passphrase");
        const declaredLength = Number(c.req.header("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_CONFIGURATION_UPLOAD_BYTES) {
          invalidRequest("artifact");
        }
        const artifact = new Uint8Array(await c.req.arrayBuffer());
        if (artifact.byteLength === 0 || artifact.byteLength > MAX_CONFIGURATION_UPLOAD_BYTES) {
          invalidRequest("artifact");
        }
        return c.json(await stage(artifact, passphrase), 200);
      } finally {
        configurationStaging = false;
      }
    });
  });

  // The root catch-all, registered LAST and matching everything, so it answers only the paths
  // `/setup-api/status`, `/setup-api/provision` and `/setup-api/adopt` (above) and any earlier route
  // (e.g. `/health`, or the setup branch's discovery/CA/trust routes registered before this mount)
  // did not claim. When a built wizard dir is configured (slice 2c), serve it as that catch-all via
  // `mountSpa` — basePath "" = origin root, exactly like the till: the root "/" serves index.html and
  // real files under the dir serve their bytes, while a stray unmatched path 404s (mountSpa has no
  // SPA history fallback — the wizard is an in-memory-state SPA, so a reload only ever lands on "/").
  // Absent a configured dir serve the inline placeholder shell (dev, and any box whose wizard bundle
  // was not built in). Boot has already `assertBuiltApp`-checked a configured dir holds an
  // `index.html`, so `mountSpa` here never becomes a catch-all that 404s the root itself.
  if (deps.setupAppDir !== undefined) {
    mountSpa(app, { root: deps.setupAppDir, basePath: "" }, log);
  } else {
    app.get("*", (c) =>
      c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
    );
  }
}
