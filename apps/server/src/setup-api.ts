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
import { getVenueSetupCountryPack, resolveInstalledCountryLocale } from "@waitron/country-packs";
import { hashPassword, hashPin, normalizeAndValidateEmail } from "@waitron/identity";
import { AppError, FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES, isAppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { DeploymentEnvironment } from "./config.js";
import type { ProvisionRequest } from "./provision.js";
import type { AdoptCredential, AdoptRequest } from "./adopt.js";
import type { TradingConfig } from "./trading-config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import { resolveLoginLocale } from "./login-locale.js";
import { assertSafePrimaryUrl } from "./primary-url.js";
import { mountSpa } from "./spa-api.js";
import type { Logger } from "./logger.js";
import type {
  ActiveSetupOperation,
  SetupOperationPhase,
  SetupOperationStore,
} from "./setup-operation.js";
import type { ArchiveRestoreRequest } from "./restore-request.js";
import type { createCloudRecoveryClient } from "./cloud-recovery.js";
import type { ConfigurationPreview } from "./configuration-import.js";
import type { FiscalContribution } from "@waitron/fiscal";
import type { FiscalReadinessResult } from "./fiscal-readiness.js";
import "./errors.js";

/** What the owner sends to rebuild this box from their bucket. */
export interface BucketRestoreInput {
  /** The recovery kit's text, as downloaded or pasted. */
  kit: string;
  environment: DeploymentEnvironment;
  /** The owner says the old server is switched off for good. */
  oldBoxGone: boolean;
  /** The tax id of the restored copy the owner confirmed; null until they have seen one. */
  venueConfirmed: string | null;
}

/**
 * Everything setup mode needs for an unprovisioned box. Its routes are UNAUTHENTICATED, like
 * `/health`, because no venue is bound yet.
 */
export interface SetupDeps {
  environment: DeploymentEnvironment;
  /** Keeps a developer Live walkthrough on preproduction transports after restart. */
  devMode?: boolean;
  /** Plaintext admin secrets never reach it — the provision route hashes them at the boundary. */
  provision?: (req: ProvisionRequest) => Promise<VenueResult>;
  /** Reconstructs the one venue committed by this persisted request after a process interruption. */
  recoverProvision?: (req: ProvisionRequest) => Promise<VenueResult>;
  /** Adds the installed sample restaurant after a Demo venue is minted. Prepare and Live never call
   * it. */
  seedDemo?: (result: VenueResult, req: ProvisionRequest) => Promise<void>;
  /** Fetches the primary's bundle SERVER-SIDE, so the admin credential never touches a
   * browser→primary hop. The returned `breakGlassSecret` is surfaced ONCE in the connect response
   * and never logged. */
  adopt?: (req: AdoptRequest) => Promise<{ breakGlassSecret: string }>;
  /** Used to seal the fiscal regime's provisioning secret through its `provisioningSecret.seal`
   * seat. */
  db?: Database;
  ring?: KeyRing;
  /** Provision path only. */
  establishIdentity?: (nodeId: string) => Promise<void>;
  /** Mints the venue's term-0 membership document after `establishIdentity` seals the identity key.
   * Provision path only. */
  seedMembership?: (nodeId: string) => Promise<void>;
  /** Persists `trading.env` so the next boot enters trading mode. */
  persistTrading?: (cfg: TradingConfig) => Promise<void>;
  /** Called on the next tick, so the wizard sees the success response before the box goes down. */
  requestRestart?: () => void;
  /** The built setup-wizard SPA directory, or `undefined` to serve the inline
   * `SETUP_PLACEHOLDER_HTML` shell instead. */
  setupAppDir?: string;
  /** Persistent first-boot serialization and progress, shared by provision, adoption and recovery. */
  operations?: SetupOperationStore;
  /** Stages an encrypted cold-recovery artifact for the entrypoint to restore after restart.
   * `oldBoxGone` is the operator's answer to whether the server the backup came from is switched
   * off for good; it is checked while staging and is not part of the staged request. */
  stageRestore?: (
    request: ArchiveRestoreRequest,
    options: { oldBoxGone: boolean },
  ) => Promise<void>;
  /** Checks the owner's bucket and stages a rebuild from it for the entrypoint to write after
   * restart. Rejects with the refusal, having staged nothing. */
  stageBucketRestore?: (input: BucketRestoreInput) => Promise<void>;
  /** Fresh replacement's private Cloud snapshot recovery client. */
  cloudRecovery?: Omit<
    ReturnType<typeof createCloudRecoveryClient>,
    "replacementIdentity" | "replacementApproval"
  >;
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
 * Served when no built wizard is configured, so a browser pointed at an unprovisioned box gets a
 * clear "needs setup" page rather than a blank 404.
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
      <h1>This Waitron server needs setup</h1>
      <p>No venue is bound to this server yet. Finish setup to start trading.</p>
    </main>
  </body>
</html>
`;

/** The placeholder's meaning changes the moment the box is provisioned (the setup routes stop being
 * mounted), so it must be revalidated, never pinned. */
const REVALIDATE_CACHE_CONTROL = "no-cache";
/** Bounds memory consumed by one unauthenticated setup upload. */
export const MAX_RESTORE_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_CONFIGURATION_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Every AppError code the provision route can THROW inside its error boundary, and its HTTP status.
 * Codes that default to 400 are enumerated anyway so this map is the surface's whole 4xx contract.
 */
const PROVISION_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "setup.provisioning_secret_required": 400,
  "setup.fiscal_test_required": 409,
  // A present-but-malformed `admin.email` (see `parseVenue`).
  "person.email_invalid": 400,
  "setup.already_provisioned": 409,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
  "deployment.already_stamped": 409,
  // A `provision-only` module (fiscal) is disabled in `modules.json`.
  "module.provision_only_disabled": 409,
};

// The tag is a log label for a non-`AppError` fault, never a wire code: the client sees
// `server.internal`.
const runProvision = createErrorBoundary(PROVISION_STATUS, "setup.provision_failed");

/**
 * The adopt route's contract. `mirror.bundle_fetch_failed` is 502, not a client fault: the request
 * was well-formed, but the mirror's upstream — the primary it was pointed at — failed.
 */
const ADOPT_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "mirror.primary_url_invalid": 400,
  "mirror.bundle_fetch_failed": 502,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
};

const runAdopt = createErrorBoundary(ADOPT_STATUS, "setup.adopt_failed");
/**
 * The refusals every restore route (archive, Cloud and bucket) meets from the same validation, so
 * each code answers one status on all three: a copy or key that cannot be opened is 422; an
 * environment or schema conflict, or an old server that may still be selling, is 409.
 */
const ARCHIVE_RESTORE_STATUS: Record<string, ContentfulStatusCode> = {
  ...PROVISION_STATUS,
  "recovery.passphrase_invalid": 422,
  "backup.artifact_invalid": 422,
  "backup.archive_invalid": 422,
  "restore.environment_mismatch": 409,
  "restore.schema_too_new": 409,
  "provisioning.database_ahead": 409,
  "restore.stream_source_live": 409,
  "restore.stream_source_unchecked": 409,
};

/** A kit is short text; this refuses a mistaken paste of something else before it is parsed. */
const MAX_KIT_BYTES = 64 * 1024;

/**
 * The bucket rebuild's own refusals, beside the shared ones. The bucket or Litestream failing is
 * this box's upstream failing (502, as `mirror.bundle_fetch_failed` is for adopt); a pointer the kit
 * cannot open is 422; an unconfirmed venue is 409.
 */
const BUCKET_RESTORE_STATUS: Record<string, ContentfulStatusCode> = {
  ...ARCHIVE_RESTORE_STATUS,
  "backup.stream_kit_invalid": 400,
  "restore.stream_pointer_missing": 422,
  "restore.stream_pointer_unverified": 422,
  "backup.stream_pointer_invalid": 422,
  "restore.stream_integrity_failed": 422,
  "restore.stream_state_missing": 422,
  "restore.stream_venue_unconfirmed": 409,
  "backup.stream_request_failed": 502,
  "backup.stream_restore_failed": 502,
  "restore.stream_disk_full": 507,
};

const runRestore = createErrorBoundary(ARCHIVE_RESTORE_STATUS, "setup.restore_failed");
const runBucketRestore = createErrorBoundary(BUCKET_RESTORE_STATUS, "setup.restore_failed");
const runConfiguration = createErrorBoundary(PROVISION_STATUS, "setup.configuration_import_failed");

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

/**
 * A person's real name. An ABSENT field reads as `null`, unlike `asNullableString`, which only
 * accepts an explicit null. A present one is TRIMMED, and a value with nothing left after trimming is
 * refused rather than stored: the column's check refuses an empty string, and identity's own write
 * boundary normalizes a name the same way (`requiredText`, packages/identity/src/staff.ts).
 */
function asOptionalName(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalidRequest(field);
  const trimmed = value.trim();
  if (trimmed === "") invalidRequest(field);
  return trimmed;
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
 */
function parseVenue(venueRaw: unknown, acceptLanguage: string | undefined): VenueRequest {
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

  // The admin's fallback locale is derived from the province as STORED, the same value
  // `readVenueLocale` reads back off the row at boot.
  const province = area?.name ?? provinceInput;

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
      province,
      timeZone: area?.timeZone ?? country.defaultTimeZone,
      dayCutover: asString(loc.dayCutover, "location.dayCutover"),
    },
    tillName: asString(v.tillName, "tillName"),
    seriesCode: asString(v.seriesCode, "seriesCode"),
    rectificativeSeriesCode: asString(v.rectificativeSeriesCode, "rectificativeSeriesCode"),
    admin: {
      displayName: asString(admin.displayName, "admin.displayName"),
      firstNames: asOptionalName(admin.firstNames, "admin.firstNames"),
      lastNames: asOptionalName(admin.lastNames, "admin.lastNames"),
      // The DISPLAY language, not the fiscal `location.invoiceLocales`. Never null: the till after a
      // PIN sign-in and account emails have no browser header to fall back to. See
      // docs/superpowers/specs/2026-09-13-onboarding-flow-corrections-design.md.
      locale: resolveLoginLocale(
        acceptLanguage,
        resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
          area: province,
          country: country.countryCode,
          fallback: FALLBACK_LOCALE,
        }),
      ),
      pinHash: hashPin(asString(admin.pin, "admin.pin")),
      passwordHash: hashPassword(asString(admin.password, "admin.password")),
      // NOT hashed: the email is not a secret, and the dashboard login resolves it.
      email: normalizeAndValidateEmail(asString(admin.email, "admin.email")),
    },
  };
}

function parseProvisionPayload(
  parsed: unknown,
  devMode: boolean,
  acceptLanguage: string | undefined,
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

  const venue = parseVenue(body.venue, acceptLanguage);
  const environment: DeploymentEnvironment =
    mode === "live" && !devMode ? "production" : "preproduction";
  const selection = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  if (selection.contribution === undefined) invalidRequest("location.fiscalTerritory");
  const contribution = selection.contribution;
  // The regime's own rules on the typed fields, run before `provision` mints the chain so a refusal
  // leaves nothing behind and the operator fixes the field in the wizard rather than at the till.
  contribution.venueFields?.validate({
    legalName: venue.legalName,
    seriesCode: venue.seriesCode,
    rectificativeSeriesCode: venue.rectificativeSeriesCode,
    operationDescription: venue.location.operationDescription,
  });
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

/** A structured error response mirroring the error boundary's `{ error: { code, params } }` shape,
 * for a refusal a handler returns rather than throws. */
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
 * Mount the UNAUTHENTICATED setup-mode routes — the whole surface the box exposes while no venue is
 * bound. `GET /setup-api/status`'s shape is a contract the wizard reads: `provisioned` is always
 * `false`, because a provisioned box never mounts these routes. The adopt route's restart does NOT
 * reach a working mirror — see `apps/server/src/finish-adoption.ts`'s `PendingAdoption` header.
 *
 * Must be called after `/health` is registered: the root catch-all mounted last answers only paths
 * nothing else claimed.
 */
export function mountSetup(app: Hono, deps: SetupDeps, log: Logger): void {
  // Once at mount, not per request: the box's mode is not otherwise visible in the request log.
  log("info", "setup.mode_active", { environment: deps.environment });

  app.get("/setup-api/venue-defaults", (c) =>
    c.json(
      Object.fromEntries(
        ALL_MODULES.flatMap(({ fiscal }) =>
          fiscal?.venueFields?.defaults === undefined
            ? []
            : [
                [
                  fiscal.id,
                  { operationDescription: fiscal.venueFields.defaults.operationDescription },
                ],
              ],
        ),
      ),
    ),
  );

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

  // The one-shot setup latch, one per mount and so one per booted process. Every setup POST except
  // cloud recovery's start and start-again checks it, so a start of one latches out a concurrent
  // start of another. `applyVenue` mints a FRESH SIF/hash chain on every run and `provisionVenue`'s
  // tenant-exists check is not atomic with it, so two concurrent provisions could each start a
  // second, unrecoverable chain (CLAUDE.md §5); the latch prevents the concurrent case, the
  // tenant-exists check backstops a sequential re-POST.
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
        const parsed = await readRawJsonBody<unknown>(c);
        const payload = parseProvisionPayload(
          parsed,
          deps.devMode === true,
          c.req.header("Accept-Language"),
        );
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

  app.post("/setup-api/provision", async (c) => {
    // Deps gate — before the latch, so an unwired box never engages it. Captured as consts so
    // TypeScript narrows them for the async closure below.
    const provision = deps.provision;
    const recoverProvision = deps.recoverProvision;
    const seedDemo = deps.seedDemo;
    const establishIdentity = deps.establishIdentity;
    const seedMembership = deps.seedMembership;
    const db = deps.db;
    const ring = deps.ring;
    const persistTrading = deps.persistTrading;
    const requestRestart = deps.requestRestart;
    if (
      provision === undefined ||
      (deps.operations !== undefined && recoverProvision === undefined) ||
      seedDemo === undefined ||
      establishIdentity === undefined ||
      seedMembership === undefined ||
      db === undefined ||
      ring === undefined ||
      persistTrading === undefined ||
      requestRestart === undefined
    ) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // SYNCHRONOUS before ANY `await`, so this check+set completes before a second near-simultaneous
    // POST's handler begins. Reset whenever the request does not end in a success answer (below),
    // so the lock does not refuse a retry; left set after a success answer, which schedules a
    // restart unless it is the replay of a completed operation.
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const execute = async (operation?: ActiveSetupOperation): Promise<Response> => {
      // An unparseable or `null` body is refused as field "body"; any other read failure is
      // rethrown, not masked as a client fault.
      const parsed: unknown = await readRawJsonBody<unknown>(c);
      const payload = parseProvisionPayload(
        parsed,
        deps.devMode === true,
        c.req.header("Accept-Language"),
      );
      const { mode, request, contribution, secret, secretExpected: expected, rawSecret } = payload;
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

      if (!setupPhaseReached(operation, "identity_established")) {
        await establishIdentity(result.nodeId);
        await operation?.advance("identity_established");
      }

      if (!setupPhaseReached(operation, "membership_seeded")) {
        await seedMembership(result.nodeId);
        await operation?.advance("membership_seeded");
      }

      // Reaches the regime only through the `seal` seat, so this file imports no regime package.
      if (!setupPhaseReached(operation, "secret_sealed")) {
        if (expected) await secret!.seal({ db, ring }, rawSecret);
        await operation?.advance("secret_sealed");
      }

      if (!setupPhaseReached(operation, "publishing")) {
        await persistTrading({
          tillId: result.tillId,
          nodeId: result.nodeId,
          seriesId: result.seriesIds[0],
          locationId: result.locationId,
          environment,
          ...(deps.devMode === true ? { developmentMode: true } : {}),
          onboardingIntent: mode,
        });
        await deps.clearConfiguration?.();
        await operation?.advance("publishing");
      }

      const response = c.json({ provisioned: true, restarting: true }, 200);
      setTimeout(() => requestRestart(), 0);
      return response;
    };
    return runProvision(c, log, async () => {
      let succeeded = false;
      try {
        const requestHash = createHash("sha256")
          .update(await c.req.raw.clone().text())
          .digest("hex");
        const response =
          deps.operations === undefined
            ? await execute()
            : await deps.operations.run("provision", requestHash, async (operation) => {
                if (operation.phase === "complete") {
                  return c.json(operation.data as { provisioned: true; restarting: true });
                }
                const response = await execute(operation);
                if (response.ok) {
                  await operation.complete(
                    (await response.clone().json()) as Record<string, unknown>,
                  );
                }
                return response;
              });
        succeeded = response.ok;
        return response;
      } finally {
        if (!succeeded) provisioning = false;
      }
    });
  });

  app.post("/setup-api/adopt", async (c) => {
    const adopt = deps.adopt;
    const requestRestart = deps.requestRestart;
    if (adopt === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // SYNCHRONOUS before ANY `await`, as in provision.
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    // Its own boundary, so a refusal is returned, not thrown; the outer one checks `response.ok`.
    // A returned refusal keeps the recorded operation: open defect in docs/backlog.md (A42).
    const execute = () =>
      runAdopt(c, log, async () => {
        // The credential is validated PER FIELD at the mirror's own boundary, so a wrong-shape body
        // is a clean 400 rather than forwarded to fail at the primary as a 502. The password and
        // TOTP are never logged: `asString` names the field, never its value.
        const body = await readJsonBody<{ primaryUrl?: unknown; credential?: unknown }>(c);
        const primaryUrl = asString(body.primaryUrl, "primaryUrl");
        // SSRF guard: this route is UNAUTHENTICATED, so without it anyone who can reach a box in
        // setup could point `primaryUrl` at a metadata endpoint or an internal host and have the
        // box POST its admin credential there. Refused before `adopt` fetches anything.
        assertSafePrimaryUrl(primaryUrl);
        const cred = asObject(body.credential, "credential");
        const credential: AdoptCredential = {
          personId: asString(cred.personId, "credential.personId"),
          password: asString(cred.password, "credential.password"),
          totp: cred.totp === undefined ? undefined : asString(cred.totp, "credential.totp"),
        };

        const { breakGlassSecret } = await adopt({ primaryUrl, credential });

        // The operator's only chance to record the offline promote fallback. It is NEVER logged.
        const response = c.json({ adopted: true, breakGlassSecret, restarting: true }, 200);
        setTimeout(() => requestRestart(), 0);
        return response;
      });
    return runAdopt(c, log, async () => {
      let succeeded = false;
      try {
        const requestHash = createHash("sha256")
          .update(await c.req.raw.clone().text())
          .digest("hex");
        const response =
          deps.operations === undefined
            ? await execute()
            : await deps.operations.run("adopt", requestHash, async (operation) => {
                if (operation.phase === "complete") {
                  return c.json(operation.data as { adopted: true; restarting: true });
                }
                const response = await execute();
                if (response.ok) {
                  await operation.complete({ adopted: true, restarting: true });
                }
                return response;
              });
        succeeded = response.ok;
        return response;
      } finally {
        if (!succeeded) provisioning = false;
      }
    });
  });

  app.post("/setup-api/cloud-recovery/start", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.start(), 200));
  });
  app.get("/setup-api/cloud-recovery/status", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.status(), 200));
  });
  app.post("/setup-api/cloud-recovery/start-again", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.startAgain(), 200));
  });
  app.post("/setup-api/cloud-recovery/restore", async (c) => {
    if (!deps.cloudRecovery || !deps.stageRestore || !deps.requestRestart)
      return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging)
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{ pointId?: unknown; oldBoxGone?: unknown }>(c);
        if (
          typeof body.pointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.pointId)
        )
          invalidRequest("pointId");
        if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean") {
          invalidRequest("oldBoxGone");
        }
        const pointId = body.pointId;
        const oldBoxGone = body.oldBoxGone === true;
        const binding = await deps.cloudRecovery!.binding();
        if (binding.pointId !== pointId) throw new AppError("setup.operation_conflict", {});
        const execute = async () => {
          await deps.cloudRecovery!.restore(
            (request) => deps.stageRestore!(request, { oldBoxGone }),
            pointId,
          );
          const response = c.json({ restoreStaged: true, restarting: true }, 202);
          setTimeout(() => deps.requestRestart!(), 0);
          return response;
        };
        if (!deps.operations) return await execute();
        const requestHash = createHash("sha256")
          .update("cloud-recovery:")
          .update(binding.requestId)
          .update(":")
          .update(pointId)
          .update(oldBoxGone ? ":confirmed" : "")
          .digest("hex");
        return await deps.operations.run("restore", requestHash, async (operation) => {
          if (operation.phase === "complete") {
            setTimeout(() => deps.requestRestart!(), 0);
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
        const oldBoxGone = c.req.header("x-waitron-old-box-gone") === "1";
        const artifact = new Uint8Array(await c.req.arrayBuffer());
        if (artifact.byteLength === 0 || artifact.byteLength > MAX_RESTORE_UPLOAD_BYTES) {
          invalidRequest("artifact");
        }
        const requestHash = createHash("sha256")
          .update(rawEnvironment)
          .update(oldBoxGone ? "\0confirmed\0" : "\0")
          .update(recoveryKey)
          .update("\0")
          .update(artifact)
          .digest("hex");
        const execute = async (): Promise<Response> => {
          await stageRestore(
            { artifact, recoveryKey, environment: rawEnvironment },
            { oldBoxGone },
          );
          const response = c.json({ restoreStaged: true, restarting: true }, 202);
          setTimeout(() => requestRestart(), 0);
          return response;
        };
        // Awaited, so a refused staging reaches the catch below and releases the latch.
        if (deps.operations === undefined) return await execute();
        return await deps.operations.run("restore", requestHash, async (operation) => {
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

  app.post("/setup-api/restore-bucket", async (c) => {
    const stage = deps.stageBucketRestore;
    const requestRestart = deps.requestRestart;
    if (stage === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runBucketRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{
          kit?: unknown;
          environment?: unknown;
          oldBoxGone?: unknown;
          venueConfirmed?: unknown;
        }>(c);
        const kit = asString(body.kit, "kit");
        if (Buffer.byteLength(kit) > MAX_KIT_BYTES) invalidRequest("kit");
        const environment = body.environment;
        if (environment !== "production" && environment !== "preproduction") {
          invalidRequest("environment");
        }
        if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean") {
          invalidRequest("oldBoxGone");
        }
        if (body.venueConfirmed !== undefined && typeof body.venueConfirmed !== "string") {
          invalidRequest("venueConfirmed");
        }
        const input: BucketRestoreInput = {
          kit,
          environment,
          oldBoxGone: body.oldBoxGone === true,
          venueConfirmed: typeof body.venueConfirmed === "string" ? body.venueConfirmed : null,
        };
        const requestHash = createHash("sha256")
          .update(
            JSON.stringify(["bucket", environment, input.oldBoxGone, input.venueConfirmed, kit]),
          )
          .digest("hex");
        const execute = async (): Promise<Response> => {
          await stage(input);
          const response = c.json({ restoreStaged: true, restarting: true }, 202);
          setTimeout(() => requestRestart(), 0);
          return response;
        };
        if (deps.operations === undefined) return await execute();
        return await deps.operations.run("restore", requestHash, async (operation) => {
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
    return runConfiguration(c, log, async () => {
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

  // Setup has no URL routes. Registered after the API handlers, this redirects missing browser
  // navigation while preserving missing assets and API responses.
  if (deps.setupAppDir !== undefined) {
    app.use("*", async (c, next) => {
      await next();
      const segments = c.req.path.split("/").filter(Boolean);
      const first = segments[0] ?? "";
      if (
        c.req.method === "GET" &&
        c.res.status === 404 &&
        (c.req.header("Accept") ?? "").includes("text/html") &&
        first !== "assets" &&
        first !== "api" &&
        !first.endsWith("-api") &&
        !segments.some((segment) => segment.includes("."))
      )
        c.res = c.redirect("/", 302);
    });
    mountSpa(app, { root: deps.setupAppDir, basePath: "" }, log);
  } else {
    app.get("*", (c) =>
      c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
    );
  }
}
