import {
  mountSetupCloudSignIn,
  recordSetupCloudPublication,
  setupCloudSignInAvailable,
  setupCloudBinding,
  type SetupCloudSignIn,
} from "./setup-cloud-sign-in.js";
import type { PreparedSetupAdmin } from "./cloud-sign-in.js";
import { saveSmtpSettings } from "./mail-settings.js";
import {
  mountRecoveryPreparationApi,
  type PrepareRecovery,
  type StageRecovery,
  type DiscardStagedRecovery,
} from "./setup-recovery-preparation-api.js";
import { mountSetupFirstFiscalApi, type FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupCoordinator, FirstSetupHold } from "@waitron/provisioning";
import type { Context, Hono } from "hono";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import type { ArchiveUpload, ReceiveArchive } from "./setup-archive-upload.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import {
  validateVenueFields,
  venueFiscalSelection,
  parseInitialVenueInput,
} from "@waitron/provisioning";
import { ALL_MODULES } from "@waitron/composition";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  receiptLanguageRules,
  resolveCountryDemoIdentity,
  resolveFiscalJurisdiction,
} from "@waitron/country";
import { getVenueSetupCountryPack, resolveInstalledCountryLocale } from "@waitron/country-packs";
import { registeredAddressRefusal } from "./registered-address-check.js";
import {
  hashPassword,
  hashPin,
  MIN_PASSWORD_LENGTH,
  MIN_PIN_LENGTH,
  normalizeAndValidateEmail,
} from "@waitron/identity";
import {
  AppError,
  FALLBACK_LOCALE,
  SUPPORTED_LOCALE_CODES,
  isAppError,
  isUnset,
} from "@waitron/shared";
import { withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { DeploymentEnvironment } from "./config.js";
import type { ProvisionRequest } from "./provision.js";
import type { AdoptHooks } from "./adopt.js";
import type { TradingConfig } from "./trading-config.js";
import { codeOf, createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import { resolveLoginLocale } from "./login-locale.js";
import { isLoopbackHost } from "./primary-url.js";
import type { BoxJoinAttempt, JoinedBox } from "./box-join-attempt.js";
import { JOIN_STATUS } from "./box-join-api.js";
import { requestAddress } from "./request-from-box.js";
import { mountSetupSpa } from "./setup-spa.js";
import type { Logger } from "./logger.js";
import {
  isUnfinishedAdopt,
  type ActiveSetupOperation,
  type SetupOperationPhase,
  type SetupOperationStore,
} from "./setup-operation.js";
import type { ArchiveRequest } from "./restore-request.js";
import { parseRecoveryEntryContext, type RecoveryEntryContext } from "./recovery-entry.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import {
  parseRecoveryOperationInput,
  type RecoveryOperationInput,
} from "./recovery-module-operation.js";
import type { createCloudRecoveryClient } from "./cloud-recovery.js";
import type { ConfigurationPreview } from "./configuration-import.js";
import type { FiscalContribution } from "@waitron/fiscal";
import type { FiscalReadinessResult } from "./fiscal-readiness.js";
import { mountSetupEmailTest } from "./setup-email-api.js";
import { parseEmailSettings } from "./email-settings-api.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { makePreparationRecoveryPack } from "./backup-recovery-pack-output.js";
import type { RecoveryDocumentEvidence } from "./recovery-document-evidence.js";
import { labelContactUrl } from "./box-name.js";
import { isSecure } from "./encrypted-connection.js";
import { sentFromThisOrigin } from "./own-page.js";
import type { sendSmtpTestMessage } from "./smtp-test-message.js";
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
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryEntryContext;
}

function recoveryCredentials(
  recoveryOperationPath: string | undefined,
  operation: unknown,
  secret: unknown,
  context?: unknown,
): {
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryEntryContext;
} {
  if (operation === undefined && secret === undefined && context === undefined) {
    if (isUnset(recoveryOperationPath)) invalidRequest("recoveryOperation");
    return {};
  }
  const parsed = parseRecoveryOperationInput(operation);
  if (
    parsed === null ||
    parsed.binding.action !== "restore" ||
    Buffer.byteLength(JSON.stringify(parsed)) > 131072
  )
    invalidRequest("recoveryOperation");
  if (typeof secret !== "string" || secret.trim().length === 0 || Buffer.byteLength(secret) > 4096)
    invalidRequest("nodeRecoverySecret");
  const selected = context === undefined ? undefined : parseRecoveryEntryContext(context);
  if (selected === null) invalidRequest("recoveryContext");
  return {
    recoveryOperation: parsed,
    nodeRecoverySecret: secret,
    ...(selected === undefined ? {} : { recoveryContext: selected }),
  };
}

/**
 * Everything setup mode needs for an unprovisioned box. Its routes are UNAUTHENTICATED, like
 * `/health`, because no venue is bound yet.
 */
export interface SetupDeps {
  installationOrigin?: "usb";
  cloudSignIn?: SetupCloudSignIn;
  environment: DeploymentEnvironment;
  sendEmailTest?: typeof sendSmtpTestMessage;
  /** Keeps a developer Live walkthrough on preproduction transports after restart. */
  devMode?: boolean;
  /** Plaintext admin secrets never reach it — the provision route hashes them at the boundary. */
  provision?: (
    req: ProvisionRequest,
    beforeTransaction?: () => Promise<void>,
  ) => Promise<VenueResult>;
  /** Reconstructs the one venue committed by this persisted request after a process interruption. */
  recoverProvision?: (req: ProvisionRequest) => Promise<VenueResult>;
  recoveryPackEvidence?: RecoveryDocumentEvidence;
  /** Adds the installed sample restaurant after a Demo venue is minted. Prepare and Live never call
   * it. */
  seedDemo?: (result: VenueResult, req: ProvisionRequest) => Promise<void>;
  /** Adopts the main box's bundle that the join attempt holds once approved. The returned
   * `breakGlassSecret` is surfaced ONCE in the Finish joining response and never logged. */
  adoptJoined?: (
    joined: JoinedBox,
    hooks: AdoptHooks,
  ) => Promise<{ breakGlassSecret: string; breakGlassKeyName?: string }>;
  joinAttempt?: BoxJoinAttempt;
  /** This box's configured origin; provision and Finish joining answer `labelContactUrl` of it,
   * which setup prints on the box's label. */
  advertisedOrigin?: string;
  /** Used to seal the fiscal regime's provisioning secret through its `provisioningSecret.seal`
   * seat. */
  db?: Database;
  node?: NodeDatabase;
  ring?: KeyRing;
  establishIdentity?: (nodeId: string) => Promise<void>;
  /** Mints the venue's term-0 membership document after `establishIdentity` seals the identity key.
   */
  seedMembership?: (nodeId: string) => Promise<void>;
  /** Persists `trading.env` so the next boot enters trading mode. */
  persistTrading?: (cfg: TradingConfig) => Promise<void>;
  /** Called on the next tick, so the wizard sees the success response before the box goes down. */
  requestRestart?: () => void;
  /** Notes the clock steps this process made whose note could not be written; throws while one
   * still cannot be. A finish that restarts into the full start calls it first, since the step
   * lives only in this process until it is noted. */
  writeClockSteps?: () => Promise<void>;
  initialiseErrorReports?: (environment: DeploymentEnvironment) => Promise<void>;
  /** The built setup-wizard SPA directory, or `undefined` to serve the inline
   * `SETUP_PLACEHOLDER_HTML` shell instead. */
  setupAppDir?: string;
  /** Persistent first-boot serialization and progress, shared by provision, adoption and recovery. */
  operations?: SetupOperationStore;
  firstFiscal?: FirstFiscalHost;
  firstSetup?: { coordinator: FirstSetupCoordinator; assertOtherAllowed(): Promise<void> };
  receiveArchive?: ReceiveArchive;
  stageRestore?: (request: ArchiveRequest, options: { oldBoxGone: boolean }) => Promise<void>;
  /** `WAITRON_RECOVERY_OPERATION_FILE` as the start reads it; a restore without recovery details
   * is refused when it is unset. */
  recoveryOperationPath?: string;
  prepareRecovery?: PrepareRecovery;
  stageRecovery?: StageRecovery;
  discardStagedRecovery?: DiscardStagedRecovery;
  clearStagedRecovery?: () => Promise<void>;
  /** Whether a request came from a browser on the box itself; tests replace it. */
  requestFromBox?: (c: Context) => boolean;
  previewRestore?: (request: ArchiveRequest) => Promise<RecoveryBackupPreview>;
  previewBucketRestore?: (
    input: Omit<BucketRestoreInput, "venueConfirmed">,
    signal?: AbortSignal,
  ) => Promise<RecoveryBackupPreview>;
  previewCloudRestore?: (pointId: string) => Promise<RecoveryBackupPreview>;
  /** Checks the owner's bucket and stages a rebuild from it for the entrypoint to write after
   * restart. Rejects with the refusal, having staged nothing. */
  stageBucketRestore?: (input: BucketRestoreInput, signal?: AbortSignal) => Promise<void>;
  /** Stages the reset of the adopt `operationId` for the entrypoint to carry out after restart. */
  stageReset?: (operationId: string) => Promise<void>;
  /** Fresh replacement's private Cloud snapshot recovery client. */
  cloudRecovery?: Omit<
    ReturnType<typeof createCloudRecoveryClient>,
    "replacementIdentity" | "replacementApproval" | "preview"
  >;
  /** Validates and stages a configuration export before live provisioning. */
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
export const SETUP_PLACEHOLDER_HTML = `<!doctype html>
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

/** The placeholder's meaning changes the moment the box is provisioned (the setup routes stop being
 * mounted), so it must be revalidated, never pinned. */
const REVALIDATE_CACHE_CONTROL = "no-cache";
export const MAX_RESTORE_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_CONFIGURATION_UPLOAD_BYTES = 64 * 1024 * 1024;

/** A finish saves the clock steps first (`runOperation`); a note this box cannot write is its own
 * fault, so 500. */
const CLOCK_STEP_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.clock_step_unsaved": 500,
};

/**
 * The status of AppError codes the provision, fiscal-test and configuration routes throw inside
 * their error boundaries. A code not listed gets the boundary's default 400.
 */
const PROVISION_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.configuration_outdated": 400,
  "setup.configuration_newer": 400,
  "setup.configuration_parts_differ": 400,
  "setup.configuration_unreadable": 422,
  "setup.request_invalid": 400,
  "setup.certificate_refused": 422,
  "setup.owner_required": 403,
  "setup.connection_insecure": 403,
  "setup.not_ready": 503,
  "setup.provisioning_secret_required": 400,
  "setup.fiscal_test_required": 409,
  // A present-but-malformed `admin.email` (see `parseVenue`).
  "person.email_invalid": 400,
  "cloud.request_unavailable": 409,
  "setup.already_provisioned": 409,
  "provisioning.foreign_taxpayer": 409,
  "provisioning.second_venue": 409,
  "provisioning.taxpayer_identity_mismatch": 409,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
  "deployment.already_stamped": 409,
  // A `provision-only` module (fiscal) is disabled in module settings.
  "module.provision_only_disabled": 409,
  // A configuration export with two categories in one place, or two Active products, sharing a
  // name; 409, as menu-api.ts answers it.
  "category.name_taken": 409,
  "product.name_taken": 409,
  "recovery.passphrase_invalid": 422,
  "backup.artifact_invalid": 422,
  "backup.archive_invalid": 422,
  "restore.manifest_invalid": 422,
  "restore.archive_resource_limit": 507,
  // An export's image metadata, or its language, the media module refuses; 400, as
  // packages/media/src/routes.ts answers both.
  "image.invalid_metadata": 400,
  "content.language_invalid": 400,
  ...CLOCK_STEP_STATUS,
};

// The tag is a log label for a non-`AppError` fault other than a full disk, never a wire code: the
// client sees `server.internal`.
const runProvision = createErrorBoundary(PROVISION_STATUS, "setup.provision_failed");

/**
 * The adopt route's contract. `mirror.bundle_fetch_failed` is 502, not a client fault: the main box
 * the join was pointed at failed. `mirror.vault_not_empty` and `mirror.vault_key_differs` are this
 * box's own refusals.
 * The two ring refusals, `credentials.key_invalid` and `credentials.key_ring_version_collision`,
 * are left unlisted (400, the setup screen's generic words): only a faulty main box raises them.
 */
const ADOPT_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "mirror.primary_url_invalid": 400,
  "mirror.bundle_fetch_failed": 502,
  "mirror.vault_not_empty": 409,
  "mirror.vault_key_differs": 409,
  "mirror.environment_mismatch": 409,
  // What this box's own start after joining would refuse.
  "server.config_missing": 409,
  "server.config_invalid": 409,
  "server.unreleased_build": 409,
  "provisioning.second_venue": 409,
  "provisioning.foreign_taxpayer": 409,
  "setup.connection_insecure": 403,
  "setup.owner_required": 403,
  "setup.not_ready": 503,
  "mirror.join_handle_invalid": 409,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
  "setup.adopt_incomplete": 409,
  "deployment.already_stamped": 409,
  ...CLOCK_STEP_STATUS,
};

const runAdopt = createErrorBoundary(ADOPT_STATUS, "setup.adopt_failed");
// Finish joining reads nothing from its body, so every resend counts as the same request.
const JOIN_ADOPT_REQUEST_HASH = createHash("sha256").update("adopt-joined").digest("hex");

const runJoin = createErrorBoundary(
  {
    ...JOIN_STATUS,
    "setup.request_invalid": 400,
    "setup.connection_insecure": 403,
    "setup.owner_required": 403,
    "mirror.primary_url_invalid": 400,
    "mirror.bundle_fetch_failed": 502,
    "setup.already_provisioning": 409,
    "setup.adopt_incomplete": 409,
    "mirror.join_waiting": 409,
    "mirror.join_in_use": 409,
  },
  "mirror.join_failed",
);

/** How long after its last state read the page holding a join's handle still counts as open. */
const JOIN_TAB_LIVE_MS = 15_000;

const RESET_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.connection_insecure": 403,
  "setup.owner_required": 403,
  "setup.reset_unavailable": 409,
  "setup.operation_conflict": 409,
};

const runReset = createErrorBoundary(RESET_STATUS, "setup.reset_failed");

const ARCHIVE_RESTORE_STATUS: Record<string, ContentfulStatusCode> = {
  ...PROVISION_STATUS,
  "restore.environment_mismatch": 409,
  "restore.schema_too_new": 409,
  "provisioning.database_ahead": 409,
  "restore.stream_source_live": 409,
  "restore.stream_source_unchecked": 409,
  "restore.archive_incomplete": 422,
  "restore.unexpected_entry": 422,
  "restore.unsafe_entry_path": 422,
  "restore.identity_incomplete": 422,
  // The 503 cloud-api.ts and cloud-locked-start.ts already give this code, not this file's 502.
  "cloud.unavailable": 503,
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

function parseSetupAdmin(
  input: unknown,
  held?: PreparedSetupAdmin,
  checkCredentials = held !== undefined,
): PreparedSetupAdmin {
  const admin = asObject(input, "admin");
  const displayName = asString(admin.displayName, "admin.displayName");
  const firstNames = asOptionalName(admin.firstNames, "admin.firstNames");
  const lastNames = asOptionalName(admin.lastNames, "admin.lastNames");
  const email = normalizeAndValidateEmail(asString(admin.email, "admin.email"));
  const pin = held && admin.pin === "" ? undefined : asString(admin.pin, "admin.pin");
  const password =
    held && admin.password === "" ? undefined : asString(admin.password, "admin.password");
  if (checkCredentials) {
    if (pin !== undefined && (pin.length < MIN_PIN_LENGTH || Buffer.byteLength(pin) > 1024))
      invalidRequest("admin.pin");
    if (
      password !== undefined &&
      (password.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(password) > 1024)
    )
      invalidRequest("admin.password");
  }
  return {
    displayName,
    firstNames,
    lastNames,
    email,
    pinHash: pin === undefined ? held!.pinHash : hashPin(pin),
    passwordHash: password === undefined ? held!.passwordHash : hashPassword(password),
  };
}

/**
 * Validate the request's venue fields and HASH the admin PIN + password at this
 * boundary into a `VenueRequest` — the plaintext secrets are read, hashed and discarded here, so they
 * never enter the plan or any action. The country pack repeats the browser's tax-id, postcode,
 * province and jurisdiction checks here and derives the persisted fiscal territory and time zone.
 */
function parseVenue(
  venueRaw: unknown,
  acceptLanguage: string | undefined,
  heldAdmin?: PreparedSetupAdmin,
): VenueRequest {
  const v = asObject(venueRaw, "venue");
  const countryInput = asString(v.country, "country");
  const taxIdInput = asString(v.taxId, "taxId");
  const fiscalTerritoryInput = asString(v.fiscalTerritory, "fiscalTerritory");
  const invoiceLocales = asStringArray(v.invoiceLocales, "invoiceLocales");
  const staffLanguage = v.staffLanguage;
  if (staffLanguage !== undefined && staffLanguage !== "en" && staffLanguage !== "es")
    invalidRequest("staffLanguage");
  const postalCodeInput = asString(v.postalCode, "postalCode");
  const provinceInput = asString(v.province, "province");
  const timeZoneInput = asString(v.timeZone, "timeZone");

  const country = getVenueSetupCountryPack(countryInput);
  if (country === undefined) invalidRequest("country");

  const taxId = country.taxIdentifier?.validate(taxIdInput);
  if (taxId?.valid === false) invalidRequest("taxId");
  const postalCode = country.postalCode?.validate(postalCodeInput);
  if (postalCode?.valid === false) invalidRequest("postalCode");

  const area = findAdministrativeArea(country, provinceInput);
  if (country.administrativeAreas.length > 0 && area === undefined) {
    invalidRequest("province");
  }
  if (country.administrativeAreas.length > 0) {
    const postalArea =
      postalCode?.valid === true
        ? findAdministrativeAreaByPostalCode(country, postalCode.normalized)
        : undefined;
    if (postalArea === undefined || postalArea.code !== area?.code) {
      invalidRequest("province");
    }
  }

  const jurisdiction = resolveFiscalJurisdiction(country, area?.code);
  if (jurisdiction === undefined || !jurisdiction.supported || jurisdiction.modules === undefined) {
    invalidRequest("fiscalTerritory");
  }
  if (fiscalTerritoryInput !== jurisdiction.id) invalidRequest("fiscalTerritory");
  if (timeZoneInput !== (area?.timeZone ?? country.defaultTimeZone)) {
    invalidRequest("timeZone");
  }
  // One receipt language, among the pack's, and the region's own where it fixes one.
  const receipt = receiptLanguageRules(country, area?.code);
  const [receiptLanguage] = invoiceLocales;
  if (
    invoiceLocales.length !== 1 ||
    !receipt.choices.includes(receiptLanguage!) ||
    (receipt.fixed !== undefined && receiptLanguage !== receipt.fixed.locale)
  ) {
    invalidRequest("invoiceLocales");
  }

  // The admin's fallback locale is derived from the province as STORED, the same value
  // `readVenueLocale` reads back off the row at boot.
  const province = area?.name ?? provinceInput;

  return {
    country: country.countryCode,
    taxId: taxId?.valid === true ? taxId.normalized : taxIdInput,
    legalName: asString(v.legalName, "legalName"),
    taxpayerDomicile:
      v.taxpayerDomicile === undefined
        ? null
        : asNullableString(v.taxpayerDomicile, "taxpayerDomicile"),
    name: asString(v.name, "name"),
    fiscalTerritory: jurisdiction.id,
    invoiceLocales,
    ...(staffLanguage === undefined ? {} : { staffLanguage }),
    addressLine1: asString(v.addressLine1, "addressLine1"),
    addressLine2: asNullableString(v.addressLine2, "addressLine2"),
    postalCode: postalCode?.valid === true ? postalCode.normalized : postalCodeInput,
    city: asString(v.city, "city"),
    province,
    timeZone: area?.timeZone ?? country.defaultTimeZone,
    dayCutover: asString(v.dayCutover, "dayCutover"),
    seriesCode: asString(v.seriesCode, "seriesCode"),
    fullSeriesCode: asString(v.fullSeriesCode, "fullSeriesCode"),
    correctiveSeriesCode: asString(v.correctiveSeriesCode, "correctiveSeriesCode"),
    ...(v.fullCorrectiveSeriesCode === undefined
      ? {}
      : {
          fullCorrectiveSeriesCode: asString(
            v.fullCorrectiveSeriesCode,
            "fullCorrectiveSeriesCode",
          ),
        }),
    admin: {
      ...parseSetupAdmin(v.admin, heldAdmin),
      // The DISPLAY language, not the fiscal `invoiceLocales`. Never null: the till after a
      // PIN sign-in and account emails have no browser header to fall back to.
      locale: resolveLoginLocale(
        acceptLanguage,
        resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
          area: province,
          country: country.countryCode,
          fallback: FALLBACK_LOCALE,
        }),
      ),
    },
  };
}

async function parseProvisionPayload(
  parsed: unknown,
  hostEnvironment: DeploymentEnvironment,
  devMode: boolean,
  acceptLanguage: string | undefined,
  heldAdmin?: PreparedSetupAdmin,
): Promise<{
  mode: "demo" | "prepare" | "live";
  request: ProvisionRequest;
  contribution: FiscalContribution;
  secret: FiscalContribution["provisioningSecret"];
  secretExpected: boolean;
  rawSecret: unknown;
  errorReportsEnabled: boolean;
}> {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    invalidRequest("body");
  }
  const body = parsed as Record<string, unknown>;
  const initialOperations =
    body.initialOperations === undefined
      ? undefined
      : parseInitialVenueInput(body.initialOperations);
  if (initialOperations === null) invalidRequest("initialOperations");
  const mode = body.mode;
  if (mode !== "demo" && mode !== "prepare" && mode !== "live") invalidRequest("mode");
  const errorReports = body.errorReportsEnabled;
  if (errorReports !== undefined && (mode === "demo" || typeof errorReports !== "boolean"))
    invalidRequest("errorReportsEnabled");
  if (body.configurationImport !== undefined && typeof body.configurationImport !== "boolean") {
    invalidRequest("configurationImport");
  }
  if (body.configurationImport === true && mode !== "live") invalidRequest("configurationImport");
  if (body.newTaxpayer !== undefined && typeof body.newTaxpayer !== "boolean") {
    invalidRequest("newTaxpayer");
  }
  if (body.newTaxpayer === true && body.configurationImport !== true) invalidRequest("newTaxpayer");

  const nameSource = body.demoVenueNameSource;
  if (
    nameSource !== undefined &&
    (mode !== "demo" || (nameSource !== "automatic" && nameSource !== "custom"))
  ) {
    invalidRequest("demoVenueNameSource");
  }
  const parsedVenue = parseVenue(body.venue, acceptLanguage, heldAdmin);
  const pack = getVenueSetupCountryPack(parsedVenue.country)!;
  const identity =
    nameSource === "automatic" ? resolveCountryDemoIdentity(pack, parsedVenue.province) : undefined;
  const venue =
    identity === undefined
      ? parsedVenue
      : {
          ...parsedVenue,
          name: identity.venueName,
        };
  if (
    mode !== "demo" &&
    (!venue.taxpayerDomicile?.trim() ||
      registeredAddressRefusal(venue.taxpayerDomicile, pack) !== undefined)
  ) {
    invalidRequest("taxpayerDomicile");
  }
  const environment: DeploymentEnvironment =
    mode === "live" && !devMode ? "production" : "preproduction";
  const selection = venueFiscalSelection(ALL_MODULES, venue.fiscalTerritory);
  if (selection.contribution === undefined) invalidRequest("fiscalTerritory");
  const contribution = selection.contribution;
  // The regime's own rules on the typed fields, run before `provision` mints the chain so a refusal
  // leaves nothing behind and the operator fixes the field in the wizard rather than at the till.
  validateVenueFields(contribution, venue);
  const secret = contribution.provisioningSecret;
  const secretExpected = secret?.required(environment) ?? false;
  const present = body.aeatCert !== undefined;
  if (secretExpected && !present) {
    throw new AppError("setup.provisioning_secret_required", { module: contribution.id });
  }
  if (!secretExpected && present) invalidRequest("aeatCert");
  if (secretExpected) await secret!.validate(body.aeatCert);
  return {
    mode,
    request: {
      environment,
      venue,
      configurationImport: mode === "live" && body.configurationImport === true,
      newTaxpayer: mode === "live" && body.newTaxpayer === true,
      ...(initialOperations === undefined
        ? throwawayMarker(mode, devMode, hostEnvironment)
        : { initialOperations }),
    },
    contribution,
    secret,
    secretExpected,
    rawSecret: body.aeatCert,
    errorReportsEnabled: errorReports === true,
  };
}

function throwawayMarker(
  mode: "demo" | "prepare" | "live",
  devMode: boolean,
  hostEnvironment: DeploymentEnvironment,
): Pick<ProvisionRequest, "initialAllocation"> {
  return mode !== "live" || devMode
    ? { initialAllocation: { kind: "throwaway", hostEnvironment } }
    : {};
}

/** A structured error response mirroring the error boundary's `{ error: { code, params } }` shape,
 * for a refusal a handler returns rather than throws. */
function directError(
  c: Context,
  log: Logger,
  code: "setup.not_ready" | "setup.already_provisioning" | "node.reset",
  httpStatus: ContentfulStatusCode,
  level: "warn" | "debug" = "warn",
): Response {
  log(level, code, {});
  return c.json({ error: { code, params: {} } }, httpStatus);
}

/**
 * Mount the UNAUTHENTICATED setup-mode routes — the whole surface the box exposes while no venue is
 * bound. `GET /setup-api/status`'s shape is a contract the wizard reads: `provisioned` is always
 * `false`, because a provisioned box never mounts these routes.
 *
 * Must be called after `/health` is registered: the root catch-all mounted last answers only paths
 * nothing else claimed.
 */
export function mountSetup(app: Hono, deps: SetupDeps, log: Logger): void {
  const holds = new WeakMap<Request, FirstSetupHold>();
  if (deps.firstFiscal !== undefined)
    mountSetupFirstFiscalApi(
      app,
      deps.firstFiscal,
      log,
      parseVenue,
      deps.devMode === true ? "preproduction" : "production",
      deps,
    );
  const cloudSignIn = deps.cloudSignIn;
  if (cloudSignIn && deps.environment === "preproduction") {
    mountSetupCloudSignIn(
      app,
      cloudSignIn,
      async () => {
        if (setupBusy() || (await deps.operations?.read()) != null)
          throw new AppError("setup.already_provisioning", {});
        await deps.firstSetup?.assertOtherAllowed();
      },
      (input, held) => parseSetupAdmin(input, held, true),
      log,
    );
  }
  if (deps.firstSetup !== undefined) {
    const firstSetup = deps.firstSetup;
    const boundary = createErrorBoundary(
      {
        "setup.attempt_conflict": 409,
        "setup.attempt_uncertain": 409,
        "setup.attempt_invalid": 409,
        "setup.start_again_incomplete": 409,
      },
      "setup.provision_failed",
    );
    app.use("/setup-api/*", async (c, next) => {
      if (c.req.method !== "POST" || c.req.path.startsWith("/setup-api/first-setup/"))
        return next();
      if (
        setupBusy() &&
        ["/setup-api/restore", "/setup-api/restore/preview", "/setup-api/recovery/stage"].includes(
          c.req.path,
        )
      )
        return directError(c, log, "setup.already_provisioning", 409);
      // These write nothing, so a main box that never answers them holds no other setup request
      // back.
      if (c.req.path === "/setup-api/join/start")
        return boundary(c, log, async () => {
          await firstSetup.assertOtherAllowed();
          await next();
          return c.res;
        });
      return boundary(c, log, () =>
        firstSetup.coordinator.run(async (hold) => {
          await firstSetup.assertOtherAllowed();
          holds.set(c.req.raw, hold);
          try {
            await next();
            return c.res;
          } finally {
            holds.delete(c.req.raw);
          }
        }),
      );
    });
  }
  const runOperation = async <T>(
    request: Request,
    kind: Parameters<SetupOperationStore["run"]>[0],
    hash: string,
    body: (operation: ActiveSetupOperation) => Promise<T>,
  ): Promise<T> => {
    await deps.writeClockSteps?.();
    return deps.operations!.run(kind, hash, body, holds.get(request));
  };
  // Once at mount, not per request: the box's mode is not otherwise visible in the request log.
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
        ...(deps.installationOrigin === undefined
          ? {}
          : { installationOrigin: deps.installationOrigin }),
        ...(deps.devMode === true ? { developmentMode: true } : {}),
        needs: ["venue"],
        ...(cloudSignIn &&
          deps.environment === "preproduction" &&
          (await setupCloudSignInAvailable(c, cloudSignIn, log)) && { cloudSignInAvailable: true }),
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
  // taxpayer-exists check is not atomic with it, so two concurrent provisions could each start a
  // second, unrecoverable chain (CLAUDE.md §5); the latch prevents the concurrent case, the
  // taxpayer-exists check backstops a sequential re-POST.
  let provisioning = false;
  let fiscalTesting = false;
  let configurationStaging = false;
  const emailTesting = mountSetupEmailTest(
    app,
    log,
    deps.sendEmailTest,
    () => provisioning || fiscalTesting || configurationStaging,
  );

  const setupBusy = () => provisioning || fiscalTesting || configurationStaging || emailTesting();

  mountRecoveryPreparationApi(app, deps, log, {
    uploadLimit: MAX_RESTORE_UPLOAD_BYTES,
    hold: (request) => holds.get(request),
    busy: setupBusy,
    setBusy: (value) => {
      provisioning = value;
    },
    run: createErrorBoundary(
      { ...BUCKET_RESTORE_STATUS, "setup.not_ready": 503, "restore.staged_copy_missing": 409 },
      "setup.restore_failed",
    ),
  });

  app.post("/setup-api/fiscal-test", async (c) => {
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    fiscalTesting = true;
    return runProvision(c, log, async () => {
      try {
        if (deps.runFiscalTest === undefined) return directError(c, log, "setup.not_ready", 503);
        const parsed = await readRawJsonBody<unknown>(c);
        const payload = await parseProvisionPayload(
          parsed,
          deps.environment,
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
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const execute = async (
      payload: Awaited<ReturnType<typeof parseProvisionPayload>>,
      rawEmail: unknown,
      rawStaffEmail: unknown,
      keyOutput:
        | {
            node: NodeDatabase;
            module: (typeof ALL_MODULES)[number];
            format: (secret: string) => string;
          }
        | undefined,
      operation?: ActiveSetupOperation,
    ): Promise<Response> => {
      if (deps.environment === "production" && payload.mode !== "live") {
        throw new AppError("setup.mode_not_allowed", { environment: "production" });
      }
      if (deps.installationOrigin === "usb" && payload.mode === "demo") {
        throw new AppError("setup.mode_not_allowed", { installationOrigin: "usb" });
      }
      const { mode, request, contribution, secret, secretExpected: expected, rawSecret } = payload;
      if (
        mode === "live" &&
        deps.firstFiscal !== undefined &&
        deps.firstFiscal.offerings(request.venue.fiscalTerritory).length > 0
      )
        throw new AppError("setup.owner_required", {});
      const { environment, venue } = request;
      if (payload.errorReportsEnabled && !deps.initialiseErrorReports)
        throw new AppError("setup.not_ready", {});
      if (rawStaffEmail !== undefined && typeof rawStaffEmail !== "boolean")
        invalidRequest("cloudStaffEmail");
      const staffEmail =
        rawStaffEmail === true &&
        mode === "prepare" &&
        deps.devMode !== true &&
        environment === "preproduction" &&
        !request.configurationImport;
      if (
        (mode === "prepare" || mode === "live") &&
        deps.devMode !== true &&
        !staffEmail &&
        rawEmail === undefined
      ) {
        throw new AppError("setup.email_required", { field: "email" });
      }
      if (mode === "demo" && rawEmail !== undefined) invalidRequest("email");
      const email =
        rawEmail === undefined ? undefined : parseEmailSettings(asObject(rawEmail, "email"));
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
          if (request.initialAllocation !== undefined) {
            log("info", "setup.throwaway_allocation", { mode });
          }
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

      if (!setupPhaseReached(operation, "secret_sealed")) {
        if (expected) await secret!.seal({ db, ring, nodeId: result.nodeId }, rawSecret);
        // The fiscal seat owns its transaction; resume repeats idempotent seals until both finish.
        if (email !== undefined) {
          await withTransaction(db, (tx) => saveSmtpSettings(tx, ring, email, null));
        }
        if (payload.errorReportsEnabled) await deps.initialiseErrorReports!(environment);
        await operation?.advance("secret_sealed");
      }

      let key: { secret: string; name: string; recoveryPackPdf?: string } | undefined;
      let cloudStaffEmailUnavailable = operation?.data.cloudStaffEmailUnavailable === true;
      if (!setupPhaseReached(operation, "publishing")) {
        if (keyOutput !== undefined) {
          const handles = { venue: db, node: keyOutput.node };
          const minted =
            deps.recoveryPackEvidence === undefined
              ? await mintBreakGlassKey(handles, result.nodeId)
              : await makePreparationRecoveryPack(
                  handles,
                  result.nodeId,
                  keyOutput.module,
                  resolveLoginLocale(
                    c.req.header("X-Waitron-Recovery-Pack-Locale"),
                    venue.admin.locale ?? FALLBACK_LOCALE,
                  ) === "es-ES"
                    ? "es"
                    : "en",
                  deps.recoveryPackEvidence,
                  log,
                );
          key = { ...minted, secret: keyOutput.format(minted.secret) };
        }
        const trading: TradingConfig = {
          nodeId: result.nodeId,
          environment,
          ...(deps.devMode === true ? { developmentMode: true } : {}),
          onboardingIntent: mode,
        };
        await persistTrading(trading);
        if (!request.configurationImport) {
          const enabled = await recordSetupCloudPublication(
            c,
            cloudSignIn,
            trading,
            log,
            staffEmail || undefined,
          );
          cloudStaffEmailUnavailable = staffEmail && enabled !== true;
        }
        await deps.clearConfiguration?.();
        await operation?.advance("publishing", { ...operation.data, cloudStaffEmailUnavailable });
      }

      const publicResult = {
        provisioned: true,
        restarting: true,
        ...labelContactUrl(deps.advertisedOrigin, result.nodeId),
        ...(cloudStaffEmailUnavailable && { cloudStaffEmailUnavailable: true }),
        ...(keyOutput === undefined ? {} : { breakGlassKeyInBackups: true }),
      };
      await operation?.complete(publicResult);
      if (key === undefined) return c.json(publicResult);
      c.header("Cache-Control", "no-store");
      return c.json({
        ...publicResult,
        breakGlassSecret: key.secret,
        breakGlassKeyName: key.name,
        ...(key.recoveryPackPdf === undefined ? {} : { recoveryPackPdf: key.recoveryPackPdf }),
      });
    };
    return runProvision(c, log, async () => {
      let succeeded = false;
      try {
        const requestHash = createHash("sha256").update(await c.req.raw.clone().text());
        const parsed = await readRawJsonBody<unknown>(c);
        const raw = parsed as {
          mode?: unknown;
          venue?: { admin?: { password?: unknown; pin?: unknown } };
        };
        const admin = raw?.venue?.admin;
        const usesHeldAdmin =
          raw?.mode === "prepare" && (admin?.password === "" || admin?.pin === "");
        const prepareBinding =
          raw?.mode === "prepare" && deps.environment === "preproduction"
            ? setupCloudBinding(c, cloudSignIn)
            : undefined;
        const binding = usesHeldAdmin ? prepareBinding : undefined;
        if (
          usesHeldAdmin &&
          !binding &&
          cloudSignIn &&
          deps.environment === "preproduction" &&
          c.req.header("X-Waitron-Setup-Cloud-Tab") !== undefined
        )
          throw new AppError("cloud.request_unavailable", {});
        if (binding) requestHash.update(binding.tab).update(binding.session);
        const hash = requestHash.digest("hex");
        const clearHeldAdmin = async () => {
          if (deps.environment === "preproduction")
            await cloudSignIn?.connection.clearSetupAdmin().catch((error: unknown) => {
              log("warn", "setup.cloud_admin_clear_failed", { errorCode: codeOf(error) });
            });
        };
        const existing = binding ? await deps.operations?.read() : undefined;
        if (
          existing?.kind === "provision" &&
          existing.requestHash === hash &&
          existing.phase === "complete"
        ) {
          await clearHeldAdmin();
          return c.json(existing.data as { provisioned: true; restarting: true });
        }
        const heldAdmin = binding
          ? await cloudSignIn!.connection.readSetupAdmin(binding, existing?.requestHash === hash)
          : undefined;
        const payload = await parseProvisionPayload(
          parsed,
          deps.environment,
          deps.devMode === true,
          c.req.header("Accept-Language"),
          heldAdmin,
        );
        const { email: rawEmail, cloudStaffEmail } = parsed as Record<string, unknown>;
        const recoveryModule =
          payload.mode === "prepare" && deps.environment !== "production"
            ? ALL_MODULES.find((module) => module.fiscal === payload.contribution)
            : undefined;
        const formatServerKey = recoveryModule?.backup?.formatServerKey;
        const node = deps.node;
        let keyOutput: Parameters<typeof execute>[3];
        if (recoveryModule !== undefined && formatServerKey !== undefined) {
          if (!isSecure(c)) throw new AppError("setup.connection_insecure", {});
          if (!sentFromThisOrigin(c)) throw new AppError("setup.owner_required", {});
          if (node === undefined) throw new AppError("setup.not_ready", {});
          keyOutput = { node, module: recoveryModule, format: formatServerKey };
        }
        const run = async (operation?: ActiveSetupOperation) => {
          if (operation?.phase === "complete")
            return c.json(operation.data as { provisioned: true; restarting: true });
          const result = await execute(payload, rawEmail, cloudStaffEmail, keyOutput, operation);
          await clearHeldAdmin();
          setTimeout(() => requestRestart(), 0);
          return result;
        };
        const response =
          deps.operations === undefined
            ? await run()
            : await runOperation(c.req.raw, "provision", hash, run);
        succeeded = response.ok;
        return response;
      } finally {
        if (!succeeded) provisioning = false;
      }
    });
  });

  // The handle keeps the code on the page that started the join. Only its hash is kept.
  let joinHolder: { handleHash: Buffer; readAt: number } | null = null;
  const handleHash = (handle: string) => createHash("sha256").update(handle).digest();
  const holderOf = (c: Context) => {
    const handle = c.req.header("x-waitron-join-handle");
    return joinHolder !== null &&
      handle !== undefined &&
      timingSafeEqual(handleHash(handle), joinHolder.handleHash)
      ? joinHolder
      : null;
  };
  const refuseJoinElsewhere = (c: Context) => {
    if (!isSecure(c) && !isLoopbackHost(requestAddress(c) ?? "")) {
      throw new AppError("setup.connection_insecure", {});
    }
    if (!sentFromThisOrigin(c)) throw new AppError("setup.owner_required", {});
  };
  /** A start, Yes or cancel without the handle waits until the holding page has stopped reading. */
  const refuseJoinInUse = (c: Context) => {
    if (
      holderOf(c) === null &&
      joinHolder !== null &&
      performance.now() - joinHolder.readAt < JOIN_TAB_LIVE_MS
    )
      throw new AppError("mirror.join_in_use", {});
  };

  app.get("/setup-api/join", (c) =>
    runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      const state = deps.joinAttempt?.current() ?? null;
      const holder = holderOf(c);
      if (holder !== null) {
        holder.readAt = performance.now();
        return c.json(state ?? { state: "none" });
      }
      if (!isUnset(c.req.header("x-waitron-join-handle"))) return c.json({ state: "replaced" });
      return c.json({ state: state === null ? "none" : "elsewhere" });
    }),
  );

  app.post("/setup-api/join/start", async (c) => {
    const joinAttempt = deps.joinAttempt;
    if (joinAttempt === undefined) return directError(c, log, "setup.not_ready", 503);
    return runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      const operation = await deps.operations?.read();
      if (operation?.kind === "adopt" && operation.phase !== "started")
        throw new AppError("setup.adopt_incomplete", {});
      if (operation != null) throw new AppError("setup.already_provisioning", {});
      const body = await readJsonBody<{ primaryUrl?: unknown }>(c);
      const primaryUrl = asString(body.primaryUrl, "primaryUrl");
      refuseJoinInUse(c);
      const previous = joinHolder;
      const handle = randomBytes(32).toString("base64url");
      // Live for as long as the start runs; its answer counts as the tab's first read.
      const holder = { handleHash: handleHash(handle), readAt: Number.POSITIVE_INFINITY };
      joinHolder = holder;
      const shown = await joinAttempt.start(primaryUrl).catch((error: unknown) => {
        joinHolder = previous;
        throw error;
      });
      holder.readAt = performance.now();
      return c.json({ ...shown, handle });
    });
  });

  app.post("/setup-api/join/cancel", async (c) => {
    const joinAttempt = deps.joinAttempt;
    if (joinAttempt === undefined) return directError(c, log, "setup.not_ready", 503);
    return runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      refuseJoinInUse(c);
      const ending = joinHolder;
      await joinAttempt.cancel();
      if (joinHolder === ending) joinHolder = null;
      return c.body(null, 204);
    });
  });

  app.post("/setup-api/join/confirm", async (c) => {
    const joinAttempt = deps.joinAttempt;
    if (joinAttempt === undefined) return directError(c, log, "setup.not_ready", 503);
    return runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      refuseJoinInUse(c);
      await joinAttempt.confirm();
      return c.body(null, 204);
    });
  });

  app.post("/setup-api/adopt", async (c) => {
    const adoptJoined = deps.adoptJoined;
    const joinAttempt = deps.joinAttempt;
    const requestRestart = deps.requestRestart;
    if (adoptJoined === undefined || joinAttempt === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // SYNCHRONOUS before ANY `await`, as in provision.
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const run = async (joined: JoinedBox, operation?: ActiveSetupOperation) => {
      const secret = await adoptJoined(joined, {
        // Past "started", the store keeps the record, so a different request cannot run over a
        // half-adopted node.
        beforeFirstWrite: async (environment) => {
          // What the next start takes as this box's environment if the join stops after its stamp
          // and WAITRON_ENV is unset (`withUnfinishedJoinEnvironment`).
          await operation?.advance("venue_committed", { environment });
        },
      });
      // The operator's only chance to record the offline promote fallback. It is NEVER logged.
      const contactUrl = labelContactUrl(deps.advertisedOrigin, joined.identity.nodeId);
      const response = c.json({ adopted: true, ...secret, restarting: true, ...contactUrl }, 200);
      setTimeout(() => requestRestart(), 0);
      return response;
    };
    return runAdopt(c, log, async () => {
      let succeeded = false;
      try {
        refuseJoinElsewhere(c);
        if (holderOf(c) === null) throw new AppError("mirror.join_handle_invalid", {});
        const joined = joinAttempt.joined();
        if (joined === null) throw new AppError("setup.request_invalid", { field: "join" });
        const response =
          deps.operations === undefined
            ? await run(joined)
            : await runOperation(c.req.raw, "adopt", JOIN_ADOPT_REQUEST_HASH, async (operation) => {
                if (operation.phase !== "started") {
                  throw new AppError("setup.adopt_incomplete", {});
                }
                const response = await run(joined, operation);
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

  // The wipe happens at the next start, under the venue lock, which refuses a box holding trading
  // settings, a taxpayer or an operational venue (`runStagedReset`).
  app.post("/setup-api/reset-incomplete-adopt", async (c) => {
    const stageReset = deps.stageReset;
    const requestRestart = deps.requestRestart;
    const operations = deps.operations;
    if (stageReset === undefined || requestRestart === undefined || operations === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runReset(c, log, async () => {
      let succeeded = false;
      try {
        refuseJoinElsewhere(c);
        const record = await operations.read();
        if (!isUnfinishedAdopt(record)) {
          throw new AppError("setup.reset_unavailable", {});
        }
        await stageReset(record.id);
        const response = c.json({ resetStaged: true, restarting: true }, 202);
        setTimeout(() => requestRestart(), 0);
        succeeded = true;
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
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{
          pointId?: unknown;
          oldBoxGone?: unknown;
          recoveryOperation?: unknown;
          nodeRecoverySecret?: unknown;
          recoveryContext?: unknown;
        }>(c);
        if (
          typeof body.pointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.pointId)
        )
          invalidRequest("pointId");
        if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean") {
          invalidRequest("oldBoxGone");
        }
        const credentials = recoveryCredentials(
          deps.recoveryOperationPath,
          body.recoveryOperation,
          body.nodeRecoverySecret,
          body.recoveryContext,
        );
        c.header("Cache-Control", "no-store");
        const pointId = body.pointId;
        const oldBoxGone = body.oldBoxGone === true;
        const binding = await deps.cloudRecovery!.binding();
        if (binding.pointId !== pointId) throw new AppError("setup.operation_conflict", {});
        const execute = async () => {
          await deps.cloudRecovery!.restore(
            (request) => deps.stageRestore!({ ...request, ...credentials }, { oldBoxGone }),
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
          .update("\0")
          .update(JSON.stringify(credentials))
          .digest("hex");
        return await runOperation(c.req.raw, "restore", requestHash, async (operation) => {
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

  app.post("/setup-api/restore-bucket/preview", async (c) => {
    const preview = deps.previewBucketRestore;
    if (preview === undefined) return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runBucketRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{
          kit?: unknown;
          environment?: unknown;
          oldBoxGone?: unknown;
        }>(c);
        const kit = asString(body.kit, "kit");
        if (Buffer.byteLength(kit) > MAX_KIT_BYTES) invalidRequest("kit");
        const environment = body.environment;
        if (environment !== "production" && environment !== "preproduction")
          invalidRequest("environment");
        if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean")
          invalidRequest("oldBoxGone");
        c.header("Cache-Control", "no-store");
        return c.json(
          await preview(
            { kit, environment, oldBoxGone: body.oldBoxGone === true },
            c.req.raw.signal,
          ),
          200,
        );
      } finally {
        provisioning = false;
      }
    });
  });
  app.post("/setup-api/cloud-recovery/preview", async (c) => {
    const preview = deps.previewCloudRestore;
    if (preview === undefined) return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{ pointId?: unknown }>(c);
        if (
          typeof body.pointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.pointId)
        )
          invalidRequest("pointId");
        c.header("Cache-Control", "no-store");
        return c.json(await preview(body.pointId), 200);
      } finally {
        provisioning = false;
      }
    });
  });

  app.post("/setup-api/restore/preview", async (c) => {
    const preview = deps.previewRestore;
    if (preview === undefined || deps.receiveArchive === undefined)
      return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runRestore(c, log, async () => {
      try {
        if (!c.req.header("content-type")?.toLowerCase().startsWith("application/octet-stream"))
          invalidRequest("artifact");
        const recoveryKey = asString(c.req.header("x-waitron-recovery-key"), "recoveryKey");
        const environment = c.req.header("x-waitron-restore-environment");
        if (environment !== "production" && environment !== "preproduction")
          invalidRequest("environment");
        const upload = await deps.receiveArchive!(c.req.raw);
        try {
          c.header("Cache-Control", "no-store");
          return c.json(
            await preview({
              kind: "archive-file",
              artifactPath: upload.artifactPath,
              recoveryKey,
              environment,
            }),
            200,
          );
        } finally {
          await upload.dispose();
        }
      } finally {
        provisioning = false;
      }
    });
  });

  app.post("/setup-api/restore", async (c) => {
    const stageRestore = deps.stageRestore;
    const requestRestart = deps.requestRestart;
    if (
      stageRestore === undefined ||
      requestRestart === undefined ||
      deps.receiveArchive === undefined
    ) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runRestore(c, log, async () => {
      let upload: ArchiveUpload | undefined;
      try {
        const multipart = c.req
          .header("content-type")
          ?.toLowerCase()
          .startsWith("multipart/form-data");
        if (
          !multipart &&
          !c.req.header("content-type")?.toLowerCase().startsWith("application/octet-stream")
        )
          invalidRequest("artifact");
        const headerKey = multipart
          ? undefined
          : asString(c.req.header("x-waitron-recovery-key"), "recoveryKey");
        const headerEnvironment = c.req.header("x-waitron-restore-environment");
        if (
          !multipart &&
          headerEnvironment !== "production" &&
          headerEnvironment !== "preproduction"
        )
          invalidRequest("environment");
        if (!multipart && isUnset(deps.recoveryOperationPath)) invalidRequest("recoveryOperation");
        upload = await deps.receiveArchive!(c.req.raw, {
          fields: [
            "recoveryKey",
            "environment",
            "oldBoxGone",
            "recoveryOperation",
            "nodeRecoverySecret",
            "recoveryContext",
          ],
        });
        const form = multipart ? upload.fields : undefined;
        if (form) {
          const answer = form.get("oldBoxGone");
          if (answer != null && answer !== "0" && answer !== "1") invalidRequest("oldBoxGone");
        }
        const recoveryKey =
          form === undefined ? headerKey! : asString(form.get("recoveryKey"), "recoveryKey");
        const rawEnvironment = form === undefined ? headerEnvironment : form.get("environment");
        if (rawEnvironment !== "production" && rawEnvironment !== "preproduction")
          invalidRequest("environment");
        const oldBoxGone =
          (form === undefined ? c.req.header("x-waitron-old-box-gone") : form.get("oldBoxGone")) ===
          "1";
        let suppliedOperation: unknown;
        const rawOperation = form?.get("recoveryOperation");
        if (rawOperation !== undefined && rawOperation !== null) {
          if (typeof rawOperation !== "string" || Buffer.byteLength(rawOperation) > 131072)
            invalidRequest("recoveryOperation");
          try {
            suppliedOperation = JSON.parse(rawOperation);
          } catch {
            invalidRequest("recoveryOperation");
          }
        }
        const credentials = recoveryCredentials(
          deps.recoveryOperationPath,
          suppliedOperation,
          form?.get("nodeRecoverySecret") ?? undefined,
          (() => {
            const raw = form?.get("recoveryContext");
            if (raw === undefined || raw === null) return undefined;
            if (typeof raw !== "string" || Buffer.byteLength(raw) > 2048)
              invalidRequest("recoveryContext");
            try {
              return JSON.parse(raw) as unknown;
            } catch {
              return invalidRequest("recoveryContext");
            }
          })(),
        );
        c.header("Cache-Control", "no-store");
        const hash = createHash("sha256")
          .update(rawEnvironment)
          .update(oldBoxGone ? "\0confirmed\0" : "\0")
          .update(recoveryKey)
          .update("\0");
        for await (const bytes of createReadStream(upload.artifactPath))
          hash.update(bytes as Buffer);
        const requestHash = hash.update("\0").update(JSON.stringify(credentials)).digest("hex");
        const execute = async (): Promise<Response> => {
          await stageRestore(
            {
              kind: "archive-file",
              artifactPath: upload!.artifactPath,
              signal: c.req.raw.signal,
              recoveryKey,
              environment: rawEnvironment,
              ...credentials,
            },
            { oldBoxGone },
          );
          // The restore is already recorded, so it must still answer and restart; the next start
          // that reaches the server's boot clears the staging folder.
          await deps.clearStagedRecovery?.().catch(() => {
            log("warn", "setup.staged_recovery_clear_failed", {});
          });
          const response = c.json({ restoreStaged: true, restarting: true }, 202);
          setTimeout(() => requestRestart(), 0);
          return response;
        };
        // Awaited, so a refused staging reaches the catch below and releases the latch.
        if (deps.operations === undefined) return await execute();
        return await runOperation(c.req.raw, "restore", requestHash, async (operation) => {
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
      } finally {
        await upload?.dispose();
      }
    });
  });

  app.post("/setup-api/restore-bucket", async (c) => {
    const stage = deps.stageBucketRestore;
    const requestRestart = deps.requestRestart;
    if (stage === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
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
          recoveryOperation?: unknown;
          nodeRecoverySecret?: unknown;
          recoveryContext?: unknown;
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
        const credentials = recoveryCredentials(
          deps.recoveryOperationPath,
          body.recoveryOperation,
          body.nodeRecoverySecret,
          body.recoveryContext,
        );
        c.header("Cache-Control", "no-store");
        const input: BucketRestoreInput = {
          ...credentials,
          kit,
          environment,
          oldBoxGone: body.oldBoxGone === true,
          venueConfirmed: typeof body.venueConfirmed === "string" ? body.venueConfirmed : null,
        };
        const requestHash = createHash("sha256")
          .update(
            JSON.stringify([
              "bucket",
              environment,
              input.oldBoxGone,
              input.venueConfirmed,
              kit,
              credentials,
            ]),
          )
          .digest("hex");
        const execute = async (): Promise<Response> => {
          await stage(input, c.req.raw.signal);
          const response = c.json({ restoreStaged: true, restarting: true }, 202);
          setTimeout(() => requestRestart(), 0);
          return response;
        };
        if (deps.operations === undefined) return await execute();
        return await runOperation(c.req.raw, "restore", requestHash, async (operation) => {
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
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
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

  app.all("/management-api/*", (c) => directError(c, log, "node.reset", 404, "debug"));
  app.all("/api/*", (c) => directError(c, log, "node.reset", 404, "debug"));

  if (deps.setupAppDir !== undefined) {
    mountSetupSpa(app, deps.setupAppDir, log);
  } else {
    app.get("*", (c) =>
      c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
    );
  }
}
