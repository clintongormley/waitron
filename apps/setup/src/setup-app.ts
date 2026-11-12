import { SETUP_MODULES } from "@waitron/dashboard-modules/setup";
import { FirstSetupSession } from "./first-setup-session.js";
import { readWipeSummary, sendWipe, wipeRefusal, type WipeRefusal } from "./start-again-wipe.js";
import type {
  FirstSetupInspection,
  FirstSetupState,
  FirstSetupResolutionSnapshot,
  StartAgainSummary,
} from "./api/first-setup-types.js";
import "./screens/initial-setup-screen.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import {
  LeaveController,
  ThemeChoiceController,
  applyThemePick,
  THEME_SELECTED_EVENT,
  themeLabelsPerLocale,
  type DraftScope,
} from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DROPDOWN_ICONS, baseStyles, registerIcons } from "@waitron/ui";
import "./screens/role-screen.js";
import "./screens/connection-screen.js";
import "./screens/connect-screen.js";
import "./screens/restore-screen.js";
import "./screens/restore-bucket-screen.js";
import "./screens/cloud-restore-screen.js";
import { SetupLiveSourceScreen } from "./screens/live-source-screen.js";
import "./screens/configuration-preview-screen.js";
import "./screens/fiscal-test-screen.js";
import "./screens/email-screen.js";
import "./screens/mode-screen.js";
import "./screens/admin-screen.js";
import "./screens/venue-screen.js";
import "./screens/cert-screen.js";
import type { CertificateRefusal } from "./screens/cert-screen.js";
import "./screens/review-screen.js";
import "./screens/provisioning-screen.js";
import "./screens/reset-screen.js";
import "./screens/done-screen.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import "@waitron/ui/src/components/wt-theme-chooser.js";
import "./problem-report.js";
import "@waitron/ui/src/components/wt-waitron-lockup.js";
import type {
  RecoveryRestoreCredentials,
  EmailSettingsDraft,
  AdoptBody,
  ApiError,
  ConfigurationPreview,
  VenueDraft,
  ProvisionBody,
  ResetCredential,
  SetupApi,
  CloudRecoveryView,
} from "./api/client.js";
import { dispatchSetupGoto } from "./events.js";
import type {
  BucketRestoreRequestDetail,
  ConfigurationRequestDetail,
  RestoreRequestDetail,
} from "./events.js";
import type { CloudField, CloudRestoreConfirmation } from "./screens/cloud-restore-screen.js";
import type { ConnectField } from "./screens/connect-screen.js";
import type { BucketField, RestoredVenue } from "./screens/restore-bucket-screen.js";
import type { RestoreField } from "./screens/restore-screen.js";
import type { ResetField, ResetScreenOutcome } from "./screens/reset-screen.js";
import { VENUE_SERVER_FIELDS } from "./server-fields.js";
import { LocaleChangeController } from "./i18n/locale-controller.js";
import { matchBrowserLocale } from "./i18n/match-browser-locale.js";
import type { StringKey } from "./i18n/strings.js";
import { currentLocale, format, localTime, setLocale, t } from "./i18n/t.js";

const setupLocale = (): "en" | "es" => (currentLocale().startsWith("es") ? "es" : "en");

/** The wizard's screens, shown one at a time from in-memory state, never a URL route. */
export type Screen =
  | "first-owner"
  | "first-setup"
  | "connection"
  | "role"
  | "connect"
  | "restore"
  | "restore-bucket"
  | "cloud-restore"
  | "live-source"
  | "configuration-preview"
  | "fiscal-test"
  | "email"
  | "mode"
  | "admin"
  | "venue"
  | "cert"
  | "review"
  | "provisioning"
  | "reset"
  | "done";

/**
 * A recursively-optional view of `T`: every field, at every depth, may be absent — an array is left
 * whole (its element type is not turned partial, so `invoiceLocales` stays `string[]`). The wizard's
 * request-draft accumulates a screen at a time, so at any moment only the fields collected so far are
 * present.
 */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `patch` onto `base`, returning a NEW object (Lit reactivity needs a fresh reference).
 * Plain-object fields recurse; every other value (primitive, array, or a field absent from `base`)
 * is taken from the patch. An explicit `undefined` in the patch is skipped, so a screen re-emitting a
 * partial patch never deletes a sibling the base already holds.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = deepMerge(out[key], value);
  }
  return out;
}

function sameDraftValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameDraftValue(value, b[index]))
    );
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = (value: Record<string, unknown>) =>
    Object.keys(value).filter((key) => value[key] !== undefined);
  const aKeys = keys(a);
  const bKeys = keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(b, key) && sameDraftValue(a[key], b[key]))
  );
}

/**
 * Narrows the draft to the request body without checking it is complete. The certificate travels
 * only on a live provision that carries a PFX, and is otherwise left out rather than sent as `null`:
 * an operator can fill it in, go Back and switch to Demo, and the server refuses a certificate on a
 * provision that does not expect one (`setup.request_invalid`, field `aeatCert`).
 */
export function assembleBody(draft: DeepPartial<ProvisionBody>): ProvisionBody {
  const body = { ...draft } as ProvisionBody & { aeatCert?: ProvisionBody["aeatCert"] };
  const cert = draft.aeatCert;
  const includeCert =
    draft.mode === "live" &&
    cert !== undefined &&
    cert.pfxBase64 !== undefined &&
    cert.pfxBase64 !== "";
  if (!includeCert) {
    delete body.aeatCert;
  }
  if (draft.mode === "demo") delete body.email;
  if (draft.mode !== "demo") delete body.demoVenueNameSource;
  return body as ProvisionBody;
}

/** Text on screen is kept as a way to word it, so a language switch re-words it in place. */
type Message = () => string;

const say =
  (key: StringKey): Message =>
  () =>
    t(key);

const sayWith =
  (key: StringKey, params: Record<string, string | number>): Message =>
  () =>
    format(key, params);

/** The fields a new tax ID enters afresh rather than taking from the export. */
const TAXPAYER_FIELDS = [
  "taxId",
  "legalName",
  "taxpayerDomicile",
  "seriesCode",
  "fullSeriesCode",
  "rectificativeSeriesCode",
] as const;

const CLAIM_VENUE_FIELDS = [
  "name",
  "fiscalTerritory",
  "invoiceLocales",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "province",
  "timeZone",
  "dayCutover",
] as const satisfies readonly (keyof VenueDraft)[];
const claimVenueFieldsComplete: [
  Exclude<
    keyof VenueDraft,
    | (typeof CLAIM_VENUE_FIELDS)[number]
    | "country"
    | "taxId"
    | "legalName"
    | "taxpayerDomicile"
    | "seriesCode"
    | "fullSeriesCode"
    | "rectificativeSeriesCode"
    | "admin"
    | "staffLanguage"
  >,
] extends [never]
  ? true
  : never = true;
void claimVenueFieldsComplete;

const FIRST_SETUP_ERROR_MESSAGES: Record<string, StringKey> = {
  "setup.owner_required": "shell.first_setup.owner_required",
  "setup.attempt_conflict": "shell.first_setup.attempt_conflict",
  "setup.attempt_uncertain": "shell.first_setup.attempt_uncertain",
  "setup.attempt_invalid": "shell.first_setup.attempt_invalid",
  "setup.start_again_incomplete": "shell.first_setup.start_again_incomplete",
  "setup.workspace_unsupported": "shell.first_setup.workspace_unsupported",
};
/** An attempt in one of these cannot be carried on from the page: only Start again or Recover remain. */
const pastActivation = (state: FirstSetupState | undefined) =>
  state !== undefined && ["activation-started", "committed", "publication"].includes(state.status);
/** The box refuses activation to these, whatever key a page holds: only Start again remains. */
const notCarriedOn = (state: FirstSetupState | undefined) =>
  state?.status === "abandoned" || state?.status === "uncertain";
/** A held attempt the box still lets this page carry on: before activation, with nothing to recover. */
const carriesOn = (session: FirstSetupSession | undefined) =>
  session?.state !== undefined &&
  !session.recoveryRequired &&
  (session.state.status === "claimed" || session.state.status === "consumption-intent");
const statusReadUnusable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === "setup.attempt_conflict" || code === "setup.attempt_invalid";
};
const inspectsAttempt = (session: FirstSetupSession, statusRefused: boolean) =>
  ((statusRefused || session.recoveryRequired) && !session.state) ||
  pastActivation(session.state) ||
  notCarriedOn(session.state);
/** Activation's refusals: a stored series pick found taken is told apart by its reason. */
function firstSetupErrorKey(error: unknown): StringKey | undefined {
  const { code, params } = (error ?? {}) as { code?: unknown; params?: Record<string, unknown> };
  if (typeof code !== "string") return undefined;
  if (code === "sif.allocation_invalid" && params?.reason === "minute_in_use")
    return "shell.first_setup.series_minute_taken";
  return FIRST_SETUP_ERROR_MESSAGES[code];
}
/** The box refused the stop from this page or over this connection, which deletes nothing. */
const stopNotAccepted = (code: unknown) =>
  code === "setup.owner_required" || code === "setup.connection_insecure";
/** Whether the page may ask the box what Start again would delete; the box decides the rest. */
const wipeOffered = (inspection: FirstSetupInspection) =>
  (inspection.pair === "valid" || inspection.pair === "repairable") &&
  inspection.revision !== null &&
  inspection.ownerGeneration !== null;
/** Words for a setup request the box refused over a first setup this page does not hold. */
function firstSetupHeldWords(
  code: unknown,
  held:
    | "shell.provisioning.first_setup_held"
    | "shell.restore.first_setup_held"
    | "shell.reset.first_setup_held",
): Message | undefined {
  if (code === "setup.owner_required") return say("shell.setup_not_accepted");
  if (code === "setup.attempt_uncertain") return say(held);
  return undefined;
}
/** The restore and reset screens' words for a refusal their own buttons would only meet again. */
const restoreOrResetRefusalWords = (
  code: unknown,
  held: "shell.restore.first_setup_held" | "shell.reset.first_setup_held",
): Message | undefined =>
  firstSetupHeldWords(code, held) ??
  (code === "setup.attempt_conflict" ? say("shell.setup_conflict") : undefined);
const VENUE_ERROR_MESSAGES: Record<string, StringKey> = {
  "provisioning.territory_country_mismatch": "shell.venue_error.territory_country_mismatch",
  "provisioning.invalid_locales": "shell.venue_error.invalid_locales",
  "provisioning.duplicate_series_code": "shell.venue_error.duplicate_series_code",
  "fiscal.regime_not_implemented": "shell.venue_error.regime_not_implemented",
};

const ADOPT_ERROR_MESSAGES: Record<string, StringKey> = {
  ...FIRST_SETUP_ERROR_MESSAGES,
  "mirror.bundle_fetch_failed": "shell.adopt.bundle_fetch_failed",
  "mirror.vault_not_empty": "shell.adopt.vault_not_empty",
  // A fault in Waitron: the connect screen sends a certificate only from its own read, which the
  // server has already checked is one authority certificate.
  "mirror.primary_unconfirmed": "shell.adopt.primary_unconfirmed",
  "password.invalid": "shell.adopt.login_failed",
  "setup.request_invalid": "shell.adopt.request_invalid",
  "setup.not_ready": "shell.not_ready",
  "mirror.bucket_stream_active": "shell.adopt.bucket_stream_active",
  "mirror.standby_name_taken": "shell.adopt.standby_name_taken",
  "mirror.spare_already_joined": "shell.adopt.spare_already_joined",
  "mirror.standby_series_unsupported": "shell.adopt.standby_series_unsupported",
};

/** A join's refusal in words; the clocks refusal shows both servers' times in the wizard's language. */
function adoptErrorWords(code: string, params: Record<string, unknown> | undefined): Message {
  const { primaryAt, standbyAt } = params ?? {};
  if (
    code === "mirror.clocks_apart" &&
    typeof primaryAt === "string" &&
    typeof standbyAt === "string"
  )
    return () =>
      format("shell.adopt.clocks_apart", {
        primaryAt: localTime(primaryAt) ?? primaryAt,
        standbyAt: localTime(standbyAt) ?? standbyAt,
      });
  return say(ADOPT_ERROR_MESSAGES[code] ?? "shell.adopt.generic");
}

/**
 * The repair page's steps before activation, the claim included; activation keeps the first-setup
 * map. A full disk's words say a restart frees space only where the server says it does.
 */
function repairErrorKey(error: unknown): StringKey | undefined {
  const { code, params } = (error ?? {}) as { code?: string; params?: Record<string, unknown> };
  if (code === "storage.disk_full")
    return params?.restartDeletesLogs === true
      ? "shell.first_setup.disk_full"
      : "shell.first_setup.disk_full_restart_unknown";
  return code === undefined ? undefined : FIRST_SETUP_ERROR_MESSAGES[code];
}

const RESET_ERROR_MESSAGES: Record<string, StringKey> = {
  ...FIRST_SETUP_ERROR_MESSAGES,
  "setup.request_invalid": "shell.reset.request_invalid",
  "setup.not_ready": "shell.not_ready",
};

/**
 * The field a refusal is about: named by the code itself, or by `setup.request_invalid`'s
 * `params.field` (the server's path for the field).
 */
function refusedField<F extends string>(
  code: unknown,
  params: Record<string, unknown> | undefined,
  byCode: Readonly<Record<string, F>>,
  byPath: Readonly<Record<string, F>>,
): F | undefined {
  if (code === "setup.request_invalid") {
    const path = params?.field;
    return typeof path === "string" && Object.hasOwn(byPath, path) ? byPath[path] : undefined;
  }
  return typeof code === "string" && Object.hasOwn(byCode, code) ? byCode[code] : undefined;
}

const RESET_FIELD_PATHS: Record<string, ResetField> = {
  personId: "personId",
  password: "password",
};

const ADOPT_FIELD_CODES: Record<string, ConnectField> = {
  "mirror.primary_url_invalid": "primaryUrl",
};

const ADOPT_FIELD_PATHS: Record<string, ConnectField> = {
  primaryUrl: "primaryUrl",
  "credential.personId": "personId",
  "credential.password": "password",
  "credential.totp": "totp",
};

function withoutRecoveryCredentials<T extends Partial<RecoveryRestoreCredentials>>(request: T): T {
  const kept = { ...request };
  delete kept.nodeRecoverySecret;
  delete kept.recoveryOperation;
  delete kept.recoveryContext;
  return kept;
}

const RESTORE_FIELD_CODES: Record<string, RestoreField> = {
  "promotion.break_glass_invalid": "nodeRecoverySecret",
  "recovery.passphrase_invalid": "recoveryKey",
  "restore.environment_mismatch": "environment",
};

const RESTORE_FIELD_PATHS: Record<string, RestoreField> = {
  recoveryOperation: "recoveryOperation",
  nodeRecoverySecret: "nodeRecoverySecret",
  artifact: "artifact",
  recoveryKey: "recoveryKey",
  environment: "environment",
};

const BUCKET_FIELD_CODES: Record<string, BucketField> = {
  "promotion.break_glass_invalid": "nodeRecoverySecret",
  "backup.stream_kit_invalid": "kit",
  "restore.environment_mismatch": "environment",
};

const BUCKET_FIELD_PATHS: Record<string, BucketField> = {
  recoveryOperation: "recoveryOperation",
  nodeRecoverySecret: "nodeRecoverySecret",
  kit: "kit",
  environment: "environment",
  oldBoxGone: "oldBoxGone",
  venueConfirmed: "venueConfirmed",
};

const CLOUD_FIELD_PATHS: Record<string, CloudField> = {
  recoveryOperation: "recoveryOperation",
  nodeRecoverySecret: "nodeRecoverySecret",
  oldBoxGone: "oldBoxGone",
};

const RESTORE_FIELD_CHECKS: Record<RestoreField, StringKey> = {
  recoveryOperation: "restore.allocation_invalid",
  nodeRecoverySecret: "restore.allocation_key_missing",
  artifact: "restore.check.backup_file",
  recoveryKey: "restore.check.recovery_key",
  environment: "restore.check.environment",
};

const BUCKET_FIELD_CHECKS: Record<BucketField, StringKey> = {
  recoveryOperation: "restore.allocation_invalid",
  nodeRecoverySecret: "restore.allocation_key_missing",
  kit: "restore_bucket.check.kit",
  environment: "restore_bucket.check.environment",
  oldBoxGone: "restore_bucket.check.old_box",
  venueConfirmed: "restore_bucket.check.venue",
};

/** Keyed by the field the refusal names; `pointId` is not a field the screen shows. */
const CLOUD_FIELD_CHECKS: Record<CloudField | "pointId", StringKey> = {
  recoveryOperation: "restore.allocation_invalid",
  nodeRecoverySecret: "restore.allocation_key_missing",
  pointId: "cloud_restore.check.point",
  oldBoxGone: "cloud_restore.check.old_box",
};

function describeThrottle(params: Record<string, unknown> | undefined): Message {
  const seconds = params?.retryAfterSeconds;
  if (typeof seconds !== "number") return say("shell.throttle");
  return seconds === 1
    ? say("shell.throttle_wait_one")
    : sayWith("shell.throttle_wait", { seconds });
}

/** The owner's words for each refusal a rebuild from the bucket can meet whose params add nothing. */
const BUCKET_ERROR_MESSAGES: Record<string, StringKey> = {
  ...FIRST_SETUP_ERROR_MESSAGES,
  "backup.stream_kit_invalid": "shell.bucket.kit_invalid",
  "restore.stream_pointer_missing": "shell.bucket.pointer_missing",
  "restore.stream_pointer_unverified": "shell.bucket.pointer_unverified",
  "backup.stream_pointer_invalid": "shell.bucket.pointer_invalid",
  "restore.stream_integrity_failed": "shell.bucket.integrity_failed",
  "restore.stream_state_missing": "shell.bucket.state_missing",
  "restore.identity_unknown": "shell.bucket.identity_unknown",
  "restore.administrator_password_missing": "shell.restore.administrator_password_missing",
  // One sentence for all three, as the command line gives (`DECRYPT_PHASE_CODES`,
  // apps/server/src/restore-command.ts).
  "recovery.passphrase_invalid": "shell.bucket.key_does_not_open",
  "backup.artifact_invalid": "shell.bucket.key_does_not_open",
  "backup.archive_invalid": "shell.bucket.key_does_not_open",
  "backup.stream_restore_failed": "shell.bucket.restore_failed",
  "backup.stream_request_failed": "shell.bucket.request_failed",
  "restore.stream_disk_full": "shell.bucket.disk_full",
  "restore.environment_mismatch": "shell.bucket.environment_mismatch",
  "provisioning.database_ahead": "shell.bucket.other_version",
  "restore.schema_too_new": "shell.bucket.other_version",
  "setup.already_provisioning": "shell.bucket.already_provisioning",
  "setup.not_ready": "shell.not_ready",
  "setup.operation_conflict": "shell.operation_conflict",
  "setup.request_invalid": "shell.bucket.request_invalid",
};

/**
 * Cloud restore refusals that pressing Restore again cannot fix. The recovery key comes from the
 * Cloud grant, not from the owner, and the environment is always preproduction
 * (`createCloudRecoveryClient`, apps/server/src/cloud-recovery.ts), so the owner can correct
 * neither here.
 */
const CLOUD_ERROR_MESSAGES: Record<string, StringKey> = {
  ...FIRST_SETUP_ERROR_MESSAGES,
  "restore.schema_too_new": "shell.cloud.other_version",
  "restore.administrator_password_missing": "shell.restore.administrator_password_missing",
  "recovery.passphrase_invalid": "shell.cloud.unopenable",
  "backup.artifact_invalid": "shell.cloud.unopenable",
  "backup.archive_invalid": "shell.cloud.unopenable",
  "restore.environment_mismatch": "shell.cloud.environment_mismatch",
};

/** The sentence for a bucket refusal the screen does not answer with a question of its own. */
function describeBucketRefusal(
  code: unknown,
  params: Record<string, unknown> | undefined,
): Message {
  if (typeof code !== "string") return say("shell.bucket.no_answer");
  if (
    code === "backup.stream_kit_invalid" &&
    (params?.reason === "encoding" || params?.reason === "shape")
  )
    return say("shell.bucket.kit_damaged");
  if (code === "restore.stream_pointer_unverified" && params?.reason === "venue_mismatch")
    return say("shell.bucket.venue_mismatch");
  if (code === "restore.stream_pointer_unverified" && params?.reason === "key_or_access")
    return say("shell.bucket.key_or_access");
  if (code === "restore.stream_venue_unconfirmed") return say("shell.bucket.venue_unconfirmed");
  const key = BUCKET_ERROR_MESSAGES[code];
  return key === undefined ? sayWith("shell.bucket.refused_code", { code }) : say(key);
}

const CONFIGURATION_NAME_MESSAGES: Record<string, StringKey> = {
  "category.name_taken": "shell.configuration.category_name_taken",
  "product.name_taken": "shell.configuration.product_name_taken",
};

const isName = (value: unknown): value is string => typeof value === "string" && value !== "";

const PRIVACY_CONTACT_MESSAGES: Record<string, { invalid: StringKey; tooLong: StringKey }> = {
  privacyNoticeUrl: {
    invalid: "shell.configuration.privacy_notice_url_invalid",
    tooLong: "shell.configuration.privacy_notice_url_too_long",
  },
  privacyEmail: {
    invalid: "shell.configuration.privacy_email_invalid",
    tooLong: "shell.configuration.privacy_email_too_long",
  },
};

function describeConfigurationRefusal(error: unknown): Message {
  const { code, params } = (error ?? {}) as ApiError;
  if (code === "recovery.passphrase_invalid") return say("shell.configuration.passphrase_invalid");
  if (code === "setup.configuration_outdated") return say("shell.configuration.outdated");
  if (code === "setup.configuration_newer" || code === "setup.configuration_parts_differ") {
    return say("shell.configuration.newer");
  }
  if (code === "venue.detail_invalid" && typeof params?.field === "string") {
    const privacy = Object.hasOwn(PRIVACY_CONTACT_MESSAGES, params.field)
      ? PRIVACY_CONTACT_MESSAGES[params.field]
      : undefined;
    if (privacy !== undefined)
      return say(params.reason === "length" ? privacy.tooLong : privacy.invalid);
  }
  const key = typeof code === "string" ? CONFIGURATION_NAME_MESSAGES[code] : undefined;
  const name = params?.name;
  return key !== undefined && isName(name)
    ? sayWith(key, { name })
    : say("shell.configuration.could_not_open");
}

/** The restored copy's names, when the refusal carries all three and a tax id to confirm. */
function venueToConfirm(params: Record<string, unknown> | undefined): RestoredVenue | undefined {
  const { legalName, taxId, venueName } = params ?? {};
  if (typeof legalName !== "string" || typeof taxId !== "string") return undefined;
  if (typeof venueName !== "string" || taxId === "") return undefined;
  return { legalName, taxId, venueName };
}

/** Held as one value because the message and whether to offer a retry answer the same check. */
interface ConnectionFailure {
  message: Message;
  /** False when retrying is pointless, so the screen drops its Continue action entirely. */
  canRetry: boolean;
}

/**
 * `fetch` rejects when nothing answers, and `SetupApi` rejects with a `status` when the server did,
 * so a status means the box is alive. A 404 is read as "already set up", though a wrong base URL or
 * a proxy answering 404 would read the same.
 */
function describeConnectionFailure(error: unknown): ConnectionFailure {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) return { message: say("shell.connection.already_set_up"), canRetry: false };
  if (status !== undefined)
    return { message: say("shell.connection.server_problem"), canRetry: true };
  return { message: say("shell.connection.unreachable"), canRetry: true };
}

registerIcons(DROPDOWN_ICONS);

/**
 * The wizard's root. It owns the injected {@link SetupApi} and the request {@link SetupApp.draft}
 * each screen contributes a slice of through `setup-patch`.
 */
@customElement("setup-app")
export class SetupApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* Keeps the card's margins inside the wizard rather than collapsing into the page's. */
      :host {
        display: flow-root;
      }

      main {
        box-sizing: border-box;
        width: min(calc(var(--wt-space-6) * 22), calc(100% - 2 * var(--wt-modal-inline-margin)));
        margin: var(--wt-space-5) auto;
        padding: var(--wt-space-5) var(--wt-modal-inline-padding);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface-raised);
      }

      main > header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }

      .header-controls {
        margin-inline-start: auto;
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
      }

      @media (max-width: 40rem) {
        setup-problem-report {
          order: 1;
          flex-basis: 100%;
        }

        wt-language-chooser::part(name) {
          display: none;
        }

        wt-language-chooser::part(code) {
          display: inline;
        }
      }

      .missing-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
      }

      /* Keeps a wrapped row of the repair page's buttons, and a form's button row, off the row above. */
      section > wt-button,
      section > wt-form-actions {
        margin-block-end: var(--wt-space-1);
      }

      .logo {
        flex: 0 0 auto;
        width: calc(var(--wt-space-6) * 5);
      }
    `,
  ];

  @property({ attribute: false }) api!: SetupApi;

  @property({ attribute: false }) browserLanguages: readonly string[] = navigator.languages;

  /** Held for the page's life only: a reload goes back to the browser's languages. */
  #localeChosen = false;

  readonly #theme = new ThemeChoiceController(this);
  readonly #themeLabelsFor = themeLabelsPerLocale(() => ({
    theme: t("shell.theme.label"),
    light: t("shell.theme.light"),
    dark: t("shell.theme.dark"),
    device: t("shell.theme.device"),
  }));

  constructor() {
    super();
    this.addEventListener(THEME_SELECTED_EVENT, applyThemePick);
    new LocaleChangeController(this, () => {
      document.documentElement.lang = currentLocale();
      document.title = t("shell.document_title");
      this.requestUpdate();
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.#localeChosen) setLocale(matchBrowserLocale(this.browserLanguages));
    if (this.#rootBaseline) this.#registerRoot();
  }

  #onLocaleSelected(event: CustomEvent<{ code: string }>): void {
    this.#localeChosen = true;
    setLocale(event.detail.code);
  }

  /** Certificate setup precedes collecting credentials and business details. */
  @state() private screen: Screen = "connection";
  /** Cleared while a fresh check is in flight, so an answer never outlives the check it answered. */
  @state() private connectionFailure?: ConnectionFailure;
  @state() private connectionChecking = false;
  /** Set when Continue on the connection step got an answer; see connection-screen.ts for why the
   * wizard asks rather than checks. */
  @state() private connectionAnswered = false;
  #connectionGeneration = 0;

  @state() private installationOrigin?: "usb";
  @state() private environment?: "production" | "preproduction";
  @state() private developmentMode = false;

  /** Seeded with the defaults every ES deli shares, so a screen only has to collect what differs. */
  @state() private draft: DeepPartial<ProvisionBody> = {
    venue: {
      country: "ES",
      fiscalTerritory: "ES-common",
      timeZone: "Europe/Madrid",
      invoiceLocales: ["es-ES"],
    },
  };

  #rootBaseline?: DeepPartial<ProvisionBody>;
  #rootScope?: DraftScope<DeepPartial<ProvisionBody>>;
  #rootGeneration = 0;

  override disconnectedCallback(): void {
    ++this.#rootGeneration;
    ++this.#firstGeneration;
    void this.#firstSession?.dispose();
    this.#firstSession = undefined;
    this.firstOwnerBusy = false;
    this.firstInspection = undefined;
    this.firstRestartConfirm = false;
    this.firstRetireConfirmed = false;
    this.firstRestarting = false;
    this.firstStopped = false;
    this.#closeWipe();
    this.#afterWipe = undefined;
    this.firstWipeError = undefined;
    ++this.#cloudRecoveryAttempt;
    this.cloudRecoveryBusy = false;
    this.#rootScope?.dispose();
    this.#rootScope = undefined;
    super.disconnectedCallback();
  }

  #registerRoot(): void {
    if (this.#rootScope || !this.isConnected) return;
    this.#rootBaseline ??= structuredClone(this.draft);
    this.#rootScope = this.leave.coordinator.register({
      id: this,
      current: () => this.draft,
      snapshot: (draft) => structuredClone(draft),
      equal: (a, b) => sameDraftValue(assembleBody(a), assembleBody(b)),
      restore: (draft) => {
        this.draft = draft;
      },
    });
    this.#rootScope.commit(this.#rootBaseline);
  }

  @state() private reviewError?: Message;

  @state() private venueError?: Message;

  /**
   * Cleared everywhere {@link SetupApp.venueError} is: a mark surviving into the next attempt would
   * leave a field red on a value the operator has already corrected.
   */
  @state() private venueInvalidField?: string;

  @state() private connectError?: Message;
  @state() private connectErrorAboutLogin = false;
  @state() private connectInvalidField?: ConnectField;
  /** Held only in this tab's memory, to hand back to the connect form with a refusal. */
  @state() private connectRequest?: AdoptBody;
  @state() private restoreError?: Message;
  @state() private restoreInvalidField?: RestoreField;
  /** Set from `restore.stream_source_live`/`restore.stream_source_unchecked` on the archive path. */
  @state() private restoreLiveSince?: string;
  @state() private restoreLiveUnknown = false;
  /** Handed back to the archive screen with a refusal, so the owner's entries are kept. */
  @state() private restoreRequest?: RestoreRequestDetail;
  #archiveRestoreAttempt = 0;
  #bucketRestoreAttempt = 0;
  @state() private bucketRestoreError?: Message;
  @state() private bucketInvalidField?: BucketField;
  @state() private bucketLiveSince?: string;
  @state() private bucketLiveUnknown = false;
  @state() private bucketVenue?: RestoredVenue;
  /** Held only in this tab's memory: the kit inside it is as sensitive as the recovery key. */
  @state() private bucketRequest?: BucketRestoreRequestDetail;
  /** Kept apart from the other outcomes because the done screen's copy depends on which path ran. */
  @state() private rebuilt = false;
  @state() private openingHours?: { departmentId: string };
  @state() private cloudRecoveryView?: CloudRecoveryView;
  @state() private cloudRecoveryError?: Message;
  @state() private cloudInvalidField?: CloudField;
  @state() private cloudRecoveryBusy = false;
  @state() private cloudRetryConfirmation?: CloudRestoreConfirmation;
  #cloudRecoveryAttempt = 0;
  /** Set from `restore.stream_source_live`/`restore.stream_source_unchecked` on the Cloud path. */
  @state() private cloudLiveSince?: string;
  @state() private cloudLiveUnknown = false;
  @state() private configurationError?: { code?: string; message: Message };
  @state() private configurationPreview?: ConfigurationPreview;
  @state() private fiscalTestStatus?: "accepted" | "rejected" | "uncertain";
  @state() private fiscalTestRejections: { code: string | null; message: string | null }[] = [];
  @state() private fiscalTestRunning = false;
  @state() private fiscalTestError?: Message;
  @state() private certificateRefusal?: CertificateRefusal;
  #fiscalTestGeneration = 0;
  @state() private emailError?: Message;

  /**
   * The adopt response carries this once, so the done screen is the operator's only chance to see and
   * record it before the box restarts.
   */
  @state() private breakGlassSecret?: string;
  @state() private breakGlassKeyName?: string;

  /**
   * Kept apart from {@link SetupApp.breakGlassSecret}, which is also set only by an adopt, because
   * that is a value to display and this is a statement about which path ran.
   */
  @state() private mirrorJoin = false;

  /** `undefined` while a request is in flight, which the provisioning screen shows as such. */
  @state() private provisionMessage?: Message;

  @state() private provisionCanRetry = false;

  /** Set only on a terminal failure, which also clears {@link SetupApp.provisionCanRetry}. */
  @state() private provisionReloadLabel?: Message;

  /** Set only for an adopt that stopped partway, the one state the reset screen can clear. */
  @state() private provisionCanReset = false;

  @state() private resetBusy = false;
  @state() private resetCredentialsRejected = false;
  @state() private resetInvalidField?: ResetField;
  @state() private resetError?: Message;
  @state() private resetOutcome?: { kind: ResetScreenOutcome["kind"]; message: Message };

  override firstUpdated(): void {
    void this.#boot();
  }

  /** Late initial reads must not overwrite a newer user-initiated connection check. */
  async #boot(): Promise<void> {
    const generation = ++this.#connectionGeneration;
    try {
      const [status, discovery] = await Promise.all([
        this.api.getStatus(),
        this.api.getDiscovery(),
      ]);
      if (!this.isConnected || generation !== this.#connectionGeneration) return;
      this.installationOrigin = status.installationOrigin;
      this.environment = status.environment;
      this.developmentMode = status.developmentMode === true;
      const first = await this.api.firstSetupStatus();
      if (!this.isConnected || generation !== this.#connectionGeneration) return;
      if (first.claimed || first.conflict) {
        try {
          await this.#resumeFirstSession(
            () => this.isConnected && generation === this.#connectionGeneration,
          );
        } catch (error) {
          if (this.isConnected && generation === this.#connectionGeneration) {
            this.screen = "first-owner";
            this.firstOwnerError = this.#describeRepairError(error);
          }
          throw error;
        }
      } else if (this.screen === "connection" && !discovery.caDownloadAvailable)
        this.screen = "mode";
    } catch (error) {
      this.#recordConnectionFailure(error, generation);
    }
  }

  #recordConnectionFailure(error: unknown, generation: number): void {
    if (!this.isConnected || generation !== this.#connectionGeneration) return;
    const code = (error as { code?: string } | null)?.code;
    if (code !== undefined && FIRST_SETUP_ERROR_MESSAGES[code] !== undefined) {
      this.firstOwnerError = this.#describeFirstError(error);
      this.screen = "first-owner";
    } else this.connectionFailure = describeConnectionFailure(error);
  }

  async #continueConnection(): Promise<void> {
    if (this.connectionChecking) return;
    const generation = ++this.#connectionGeneration;
    this.connectionChecking = true;
    this.connectionFailure = undefined;
    try {
      const status = await this.api.getStatus();
      if (!this.isConnected || generation !== this.#connectionGeneration) return;
      this.installationOrigin = status.installationOrigin;
      this.environment = status.environment;
      this.developmentMode = status.developmentMode === true;
      const first = await this.api.firstSetupStatus();
      if (!this.isConnected || generation !== this.#connectionGeneration) return;
      this.connectionAnswered = true;
      if (first.claimed || first.conflict) {
        try {
          await this.#resumeFirstSession(
            () => this.isConnected && generation === this.#connectionGeneration,
          );
        } catch (error) {
          if (this.isConnected && generation === this.#connectionGeneration) {
            this.screen = "first-owner";
            this.firstOwnerError = this.#describeRepairError(error);
          }
          throw error;
        }
      } else this.screen = "mode";
    } catch (error) {
      this.#recordConnectionFailure(error, generation);
    } finally {
      if (generation === this.#connectionGeneration) this.connectionChecking = false;
    }
  }

  #onPatch(event: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>): void {
    event.stopPropagation();
    if (!this.isConnected) return;
    if (
      this.#firstSession?.state &&
      !this.#firstReplacing &&
      (event.detail.patch.venue !== undefined || event.detail.patch.mode !== undefined)
    ) {
      this.firstOwnerError = this.#frozenDetailsWords();
      this.screen = "first-owner";
      return;
    }
    this.#registerRoot();
    const mode = event.detail.patch.mode;
    if (
      mode !== undefined &&
      this.draft.mode !== undefined &&
      mode !== this.draft.mode &&
      (mode === "demo" || this.draft.mode === "demo")
    ) {
      const venue = { ...this.draft.venue };
      if (this.draft.mode === "demo" && this.draft.demoVenueNameSource === "automatic") {
        delete venue.name;
      }
      delete venue.taxId;
      delete venue.legalName;
      delete venue.seriesCode;
      delete venue.rectificativeSeriesCode;
      delete venue.dayCutover;
      delete venue.invoiceLocales;
      this.draft = { ...this.draft, venue };
      delete this.draft.demoVenueNameSource;
      delete this.draft.configurationImport;
      delete this.draft.newTaxpayer;
      this.#invalidateFiscalTest();
    }
    this.draft = deepMerge(this.draft, event.detail.patch) as DeepPartial<ProvisionBody>;
    this.#rootScope?.changed();
  }

  #pendingGoto?: { owner: HTMLElement; finished: Promise<unknown> };

  #requestModeChoice(
    mode: "demo" | "prepare" | "live" | undefined,
    proceed: () => void,
    signal: AbortSignal,
  ): void {
    const owner = this.shadowRoot?.querySelector("setup-mode-screen");
    if (!this.isConnected || this.screen !== "mode" || !owner) return;
    const generation = this.#rootGeneration;
    const abandonsRoot =
      mode === undefined ||
      (mode !== this.draft.mode && (mode === "demo" || this.draft.mode === "demo"));
    if (!this.leave.coordinator.isDirty([this])) {
      proceed();
      return;
    }
    void this.leave.coordinator
      .request({
        scopes: abandonsRoot ? [this] : [],
        reason: "navigation",
        signal,
        proceed: () => {},
      })
      .then((outcome) => {
        if (
          outcome !== "proceeded" ||
          signal.aborted ||
          !this.isConnected ||
          generation !== this.#rootGeneration ||
          this.screen !== "mode" ||
          !owner.isConnected
        )
          return;
        proceed();
      });
  }

  #requestStartEmpty(proceed: () => void, signal: AbortSignal): void {
    const owner = this.shadowRoot?.querySelector("setup-live-source-screen");
    if (!this.isConnected || this.screen !== "live-source" || !owner) return;
    const generation = this.#rootGeneration;
    const mode = this.draft.mode;
    if (!this.leave.coordinator.isDirty([this, owner])) {
      proceed();
      return;
    }
    void this.leave.coordinator
      .request({
        scopes: [this, owner],
        reason: "navigation",
        signal,
        proceed: () => {},
      })
      .then((outcome) => {
        if (
          outcome !== "proceeded" ||
          signal.aborted ||
          !this.isConnected ||
          generation !== this.#rootGeneration ||
          this.screen !== "live-source" ||
          !owner.isConnected
        )
          return;
        // Discarding the previous venue draft preserves the mode selected for this setup.
        if (mode !== undefined) this.draft = { ...this.draft, mode };
        proceed();
      });
  }

  #onGoto(event: CustomEvent<{ screen: Screen }>): void {
    event.stopPropagation();
    this.#navigateTo(event.detail.screen);
  }

  /** Goes to `destination` once the screen being left has settled any unsaved changes. */
  #navigateTo(destination: Screen): void {
    if (destination === this.screen) return;
    const origin = this.screen;
    const owner = this.shadowRoot?.querySelector<HTMLElement>(`[data-test=screen-${origin}]`);
    const navigate = () => {
      if (!this.isConnected || this.screen !== origin || (owner && !owner.isConnected)) return;
      const finished = this.leave.coordinator.request({
        scopes: owner ? [owner] : [],
        reason: "navigation",
        proceed: () => {
          if (!this.isConnected || this.screen !== origin || (owner && !owner.isConnected)) return;
          this.#goto(destination);
        },
      });
      if (owner && !this.#pendingGoto) {
        const pending = { owner, finished };
        this.#pendingGoto = pending;
        void finished.finally(() => {
          if (this.#pendingGoto === pending) this.#pendingGoto = undefined;
        });
      }
    };
    const previous = this.#pendingGoto;
    // A child commit aborts its question before the coordinator's async request settles.
    if (owner && previous?.owner === owner && !this.leave.coordinator.isDirty([owner])) {
      void previous.finished.then(navigate);
    } else navigate();
  }

  #goto(destination: Screen): void {
    ++this.#firstGeneration;
    this.firstOwnerBusy = false;
    const frozen = this.#firstSession?.state;
    if (
      frozen &&
      !this.#firstReplacing &&
      [
        "mode",
        "venue",
        "admin",
        "live-source",
        "role",
        "connect",
        "restore",
        "restore-bucket",
        "cloud-restore",
      ].includes(destination)
    ) {
      this.firstOwnerError = this.#frozenDetailsWords();
      destination = "first-owner";
    }
    if (this.#firstSession && destination === "review" && !this.firstReady)
      destination = "first-setup";
    ++this.#cloudRecoveryAttempt;
    this.cloudRecoveryBusy = false;
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.reviewError = undefined;
    this.connectError = undefined;
    this.connectErrorAboutLogin = false;
    this.connectInvalidField = undefined;
    this.connectRequest = undefined;
    this.restoreError = undefined;
    this.restoreInvalidField = undefined;
    // An answer belongs to the copy it was given for; leaving the screen may mean another kit or file.
    this.restoreLiveSince = undefined;
    this.restoreLiveUnknown = false;
    this.restoreRequest = undefined;
    this.bucketRestoreError = undefined;
    this.bucketInvalidField = undefined;
    this.bucketLiveSince = undefined;
    this.bucketLiveUnknown = false;
    this.bucketVenue = undefined;
    this.bucketRequest = undefined;
    this.cloudRecoveryError = undefined;
    this.cloudInvalidField = undefined;
    this.cloudLiveSince = undefined;
    this.cloudLiveUnknown = false;
    this.cloudRetryConfirmation = undefined;
    this.configurationError = undefined;
    this.fiscalTestError = undefined;
    this.certificateRefusal = undefined;
    this.emailError = undefined;
    this.resetBusy = false;
    this.resetOutcome = undefined;
    this.resetCredentialsRejected = false;
    this.resetInvalidField = undefined;
    this.resetError = undefined;
    this.screen = destination;
  }

  #onAdvance(event: CustomEvent): void {
    event.stopPropagation();
    if (this.screen !== "venue") return;
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.reviewError = undefined;
    if (this.draft.mode === "live" && !this.developmentMode) void this.#claimFirstSetup();
    else this.#afterFirstOwner();
  }

  #frozenDetailsWords(): Message {
    const words = carriesOn(this.#firstSession) ? "scopeCarryOn" : "scope";
    return () => initialOwnerStrings[setupLocale()][words];
  }

  #afterFirstOwner(): void {
    this.screen =
      this.draft.mode === "live" && !this.developmentMode
        ? this.draft.venue?.fiscalTerritory === "ES-common"
          ? "cert"
          : "email"
        : this.draft.mode === "prepare" && !this.developmentMode
          ? "email"
          : "review";
  }

  @state() private firstOwnerBusy = false;
  @state() private firstOwnerError?: Message;
  @state() private firstReady = false;
  @state() private firstOfferings: { module: string; version: string }[] = [];
  @state() private firstInspection?: FirstSetupInspection;
  @state() private firstRestartConfirm = false;
  @state() private firstRetireConfirmed = false;
  @state() private firstRestarting = false;
  /** Start again or Recover pressed on the ordinary server: the setup must be stopped first (D2). */
  @state() private firstStopConfirm = false;
  @state() private firstStopped = false;
  /** What Start again's confirmation shows; the send stops if the box's summary differs from it. */
  @state() private firstWipeSummary?: StartAgainSummary;
  /** Which button the person last pressed: it picks the words drawn; both send the same request. */
  @state() private firstWipeKind: "start-again" | "recover" = "start-again";
  /** Which wipe the box restarted for, so Reconnect opens that choice's first screen; a reload forgets it. */
  #afterWipe?: "start-again" | "recover";
  @state() private firstWipeError?: Message;
  /** The box's refusal of Start again, drawn in Start again's place until Reconnect reads the setup again. */
  @state() private firstStartAgainRefused?: WipeRefusal;
  #firstSession?: FirstSetupSession;
  #firstGeneration = 0;
  #firstReplacing = false;

  async #openFirstSession(): Promise<FirstSetupSession> {
    if (this.#firstSession) return this.#firstSession;
    const session = new FirstSetupSession(this.api);
    this.#firstSession = session;
    try {
      await session.open();
    } catch (error) {
      await session.dispose();
      if (this.#firstSession === session) this.#firstSession = undefined;
      throw error;
    }
    let inspect = false;
    try {
      await session.refresh();
    } catch (error) {
      if (session.state || !statusReadUnusable(error)) throw error;
      inspect = true;
    }
    if (inspect || session.recoveryRequired || session.state) this.#afterWipe = undefined;
    if (inspectsAttempt(session, inspect)) {
      const inspection = await this.api.inspectFirstSetupResolution();
      if (this.isConnected && this.#firstSession === session) this.firstInspection = inspection;
    }
    return session;
  }
  /** A tab whose saved key the box still accepts before activation carries on where it was (D3). */
  async #resumeFirstSession(current: () => boolean): Promise<void> {
    const session = await this.#openFirstSession();
    if (!current()) return;
    if (carriesOn(session)) await this.#carryOnFirstSession(current);
    else this.screen = "first-owner";
  }
  /** What a reload does for a held attempt the box still lets this page carry on, Reconnect included. */
  async #carryOnFirstSession(current: () => boolean): Promise<void> {
    const state = this.#firstSession!.state!;
    this.#acceptFirstIdentity();
    let offerings: { modules: { module: string; version: string }[] };
    try {
      offerings = await this.api.firstSetupOfferings(state.venue.fiscalTerritory);
    } catch (error) {
      if (!current()) return;
      const key = repairErrorKey(error);
      this.screen = "first-owner";
      this.firstOwnerError = key
        ? say(key)
        : () => initialOwnerStrings[setupLocale()].carryOnFailed;
      return;
    }
    if (!current()) return;
    this.firstOfferings = offerings.modules;
    this.#afterFirstOwner();
  }
  #acceptFirstIdentity(): void {
    const state = this.#firstSession!.state!;
    this.draft = {
      ...this.draft,
      mode: "live",
      venue: {
        ...structuredClone(state.venue),
        admin: {
          ...state.venue.admin,
          firstNames: state.venue.admin.firstNames ?? "",
          lastNames: state.venue.admin.lastNames ?? "",
        },
      },
    };
    this.#rootBaseline = structuredClone(this.draft);
    this.#rootScope?.commit(this.#rootBaseline);
    this.firstReady = false;
    this.#firstReplacing = false;
  }
  async #claimFirstSetup(): Promise<void> {
    if (this.firstOwnerBusy) return;
    const submitted = structuredClone(this.draft);
    const generation = ++this.#firstGeneration;
    const current = () => this.isConnected && generation === this.#firstGeneration;
    this.firstOwnerBusy = true;
    this.firstOwnerError = undefined;
    this.screen = "first-owner";
    try {
      const result = await this.api.firstSetupOfferings(submitted.venue!.fiscalTerritory!);
      if (!current()) return;
      this.firstOfferings = result.modules;
      if (!result.modules.length) {
        const previous = this.#firstSession;
        if (previous?.state) {
          if (
            !this.#firstReplacing ||
            previous.state.status !== "abandoned" ||
            previous.state.consumptionIntent
          )
            throw { code: "setup.attempt_conflict" };
          await previous.dispose();
          if (!current()) return;
          this.#firstSession = undefined;
          this.#firstReplacing = false;
        }
        this.#afterFirstOwner();
        return;
      }
      const session = await this.#openFirstSession();
      if (!current()) return;
      const venue = assembleBody(submitted).venue;
      const intent =
        submitted.configurationImport === true
          ? { configurationImport: true, newTaxpayer: submitted.newTaxpayer === true }
          : undefined;
      if (this.#firstReplacing) await session.replaceAbandoned(venue, currentLocale(), intent);
      else if (!session.state && !session.recoveryRequired)
        await session.claim(venue, currentLocale(), intent);
      else return;
      if (!current()) return;
      this.#acceptFirstIdentity();
      this.#afterFirstOwner();
    } catch (error) {
      if (current()) this.firstOwnerError = this.#describeRepairError(error);
    } finally {
      if (current()) this.firstOwnerBusy = false;
    }
  }
  #describeFirstError(error: unknown): Message {
    const key = firstSetupErrorKey(error);
    return key ? say(key) : () => initialOwnerStrings[setupLocale()].error;
  }
  #describeRepairError(error: unknown): Message {
    const key = repairErrorKey(error);
    return key ? say(key) : () => initialOwnerStrings[setupLocale()].error;
  }
  #firstResolutionSnapshot(): FirstSetupResolutionSnapshot {
    const inspection = this.firstInspection;
    if (!inspection || inspection.revision === null || inspection.ownerGeneration === null)
      throw { code: "setup.not_ready" };
    return {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision,
      ownerGeneration: inspection.ownerGeneration,
    };
  }
  #closeWipe(): void {
    this.firstStopConfirm = false;
    this.firstWipeSummary = undefined;
    this.firstRestartConfirm = false;
    this.firstRetireConfirmed = false;
  }
  /**
   * Start again or Recover from backup: the confirmation is drawn from what the box says now, never
   * from what the page read before.
   */
  async #openWipeConfirmation(kind: "start-again" | "recover"): Promise<void> {
    if (this.firstOwnerBusy) return;
    this.firstWipeKind = kind;
    const stop = this.#firstSession?.repairPage !== true;
    const generation = ++this.#firstGeneration;
    const current = () => this.isConnected && generation === this.#firstGeneration;
    this.firstOwnerBusy = true;
    this.firstWipeError = undefined;
    this.#closeWipe();
    try {
      const inspection = await this.api.inspectFirstSetupResolution();
      if (!current()) return;
      this.firstInspection = inspection;
      if (!wipeOffered(inspection)) return;
      if (stop) {
        this.firstStopConfirm = true;
        void this.#focusAfterUpdate("cancel-stop");
        return;
      }
      const summary = await readWipeSummary(this.api, this.#firstResolutionSnapshot());
      if (!current()) return;
      this.firstWipeSummary = summary;
      this.firstRestartConfirm = true;
      void this.#focusAfterUpdate("retire-confirmed");
    } catch (error) {
      if (!current()) return;
      this.#closeWipe();
      const refusal = wipeRefusal(error);
      if (refusal !== undefined) {
        this.firstStartAgainRefused = refusal;
        void this.#focusAfterUpdate("start-again-refused");
      } else {
        this.firstWipeError = stop
          ? this.#describeStopReadError(error)
          : this.#describeRepairError(error);
      }
    } finally {
      if (current()) this.firstOwnerBusy = false;
    }
  }
  /**
   * Start again's button is not drawn beside its confirmation or a refusal, so focus moves there —
   * unless the person has moved it out of this screen while the box answered.
   */
  async #focusAfterUpdate(name: string): Promise<void> {
    await this.updateComplete;
    const active = this.shadowRoot?.activeElement;
    const screen = this.shadowRoot?.querySelector('[data-test="screen-first-owner"]');
    if (active && !screen?.contains(active)) return;
    const el = this.shadowRoot?.querySelector<HTMLElement>(`[data-test="${name}"]`);
    (el?.shadowRoot?.querySelector<HTMLElement>("button") ?? el)?.focus();
  }
  async #sendWipeFirstSetup(): Promise<void> {
    const shown = this.firstWipeSummary;
    const inspection = this.firstInspection;
    if (this.firstOwnerBusy || !this.firstRetireConfirmed || !shown || !inspection) return;
    const generation = ++this.#firstGeneration;
    const current = () => this.isConnected && generation === this.#firstGeneration;
    this.firstOwnerBusy = true;
    this.firstWipeError = undefined;
    // Forgotten below only on a refusal the page names; after any other failure the box may have
    // deleted the setup with no answer reaching here.
    this.#afterWipe = this.firstWipeKind;
    try {
      await sendWipe(this.api, this.#firstResolutionSnapshot(), inspection.database, shown);
      if (!current()) return;
      this.#closeWipe();
      this.firstRestarting = true;
      await this.#firstSession?.dispose();
      this.#firstSession = undefined;
    } catch (error) {
      if (!current()) return;
      const code = (error as { code?: unknown })?.code;
      const refusal = wipeRefusal(error);
      if (refusal !== undefined || code === "setup.attempt_conflict") this.#afterWipe = undefined;
      // The summary showed no kept records, and an attempt conflict here means the summary or the
      // inspection changed after the page read them.
      if (refusal === "kept-records" || code === "setup.attempt_conflict") {
        this.#closeWipe();
        this.firstWipeError = () => initialOwnerStrings[setupLocale()].heldChanged;
        void this.#focusAfterUpdate(
          this.firstWipeKind === "recover" ? "recover-backup" : "start-again",
        );
      } else if (refusal !== undefined) {
        this.#closeWipe();
        this.firstStartAgainRefused = refusal;
        void this.#focusAfterUpdate("start-again-refused");
      } else this.firstWipeError = this.#describeRepairError(error);
    } finally {
      if (current()) this.firstOwnerBusy = false;
    }
  }
  async #stopFirstSetup(): Promise<void> {
    if (this.firstOwnerBusy || !this.firstStopConfirm) return;
    const generation = ++this.#firstGeneration;
    const current = () => this.isConnected && generation === this.#firstGeneration;
    this.firstOwnerBusy = true;
    this.firstWipeError = undefined;
    try {
      await this.api.stopFirstSetup(this.#firstResolutionSnapshot());
      if (!current()) return;
      this.#closeWipe();
      this.firstStopped = true;
      await this.#firstSession?.dispose();
      this.#firstSession = undefined;
    } catch (error) {
      if (!current()) return;
      this.#closeWipe();
      const code = (error as { code?: unknown })?.code;
      // The stop runs the checks the summary runs, so its refusals read as the summary's do, except
      // the refusal of this page or its connection, which says nothing about deleting.
      const refusal = stopNotAccepted(code) ? undefined : wipeRefusal(error);
      if (code === "setup.attempt_conflict") {
        this.firstWipeError = () => initialOwnerStrings[setupLocale()].heldChanged;
        void this.#focusAfterUpdate(
          this.firstWipeKind === "recover" ? "recover-backup" : "start-again",
        );
      } else if (refusal !== undefined) {
        this.firstStartAgainRefused = refusal;
        void this.#focusAfterUpdate("start-again-refused");
      } else this.firstWipeError = this.#describeStopError(error);
    } finally {
      if (current()) this.firstOwnerBusy = false;
    }
  }
  #describeStopError(error: unknown): Message {
    const strings = () => initialOwnerStrings[setupLocale()];
    if (stopNotAccepted((error as { code?: unknown } | null)?.code))
      return () => strings().stopNotAccepted;
    const key = repairErrorKey(error);
    return key ? say(key) : () => strings().stopUnanswered;
  }
  /** On the stop path the only request before the confirmation is the read, so no stop was sent. */
  #describeStopReadError(error: unknown): Message {
    const key = repairErrorKey(error);
    return key ? say(key) : () => initialOwnerStrings[setupLocale()].stopReadUnanswered;
  }
  #cancelWipe(): void {
    if (this.firstOwnerBusy) return;
    this.#closeWipe();
    this.firstWipeError = undefined;
  }
  async #reconnectFirstSetup(): Promise<void> {
    if (this.firstOwnerBusy) return;
    this.firstReady = false;
    this.screen = "first-owner";
    this.firstOwnerError = undefined;
    this.firstOwnerBusy = true;
    const generation = ++this.#firstGeneration;
    try {
      this.firstInspection = undefined;
      this.firstRestarting = false;
      this.firstStopped = false;
      this.#closeWipe();
      this.firstWipeError = undefined;
      this.firstStartAgainRefused = undefined;
      await this.#openFirstSession();
      const session = this.#firstSession!;
      let inspect = false;
      try {
        await session.refresh();
      } catch (error) {
        if (session.state || !statusReadUnusable(error)) throw error;
        inspect = true;
      }
      const unclaimed = !inspect && !session.state && !session.recoveryRequired;
      if (!unclaimed) this.#afterWipe = undefined;
      if (inspectsAttempt(session, inspect)) {
        const inspection = await this.api.inspectFirstSetupResolution();
        if (!this.isConnected || generation !== this.#firstGeneration) return;
        this.firstInspection = inspection;
      }
      if (!this.isConnected || generation !== this.#firstGeneration) return;
      if (carriesOn(session))
        await this.#carryOnFirstSession(
          () => this.isConnected && generation === this.#firstGeneration,
        );
      else if (unclaimed) {
        await session.dispose();
        if (!this.isConnected || generation !== this.#firstGeneration) return;
        this.#firstSession = undefined;
        this.screen =
          this.#afterWipe === "recover"
            ? "role"
            : this.#afterWipe === "start-again"
              ? "mode"
              : "venue";
        this.#afterWipe = undefined;
      }
    } catch (error) {
      if (this.isConnected && generation === this.#firstGeneration)
        this.firstOwnerError = this.#describeRepairError(error);
    } finally {
      if (this.isConnected && generation === this.#firstGeneration) this.firstOwnerBusy = false;
    }
  }
  async #abandonFirstSetup(): Promise<void> {
    if (this.firstOwnerBusy || !this.#firstSession?.state) return;
    this.firstOwnerBusy = true;
    const generation = ++this.#firstGeneration;
    try {
      await this.#firstSession.abandon();
    } catch (error) {
      if (this.isConnected && generation === this.#firstGeneration)
        this.firstOwnerError = this.#describeFirstError(error);
    } finally {
      if (this.isConnected && generation === this.#firstGeneration) {
        this.firstOwnerBusy = false;
        this.requestUpdate();
      }
    }
  }
  #replaceFirstSetup(): void {
    const state = this.#firstSession?.state;
    if (state?.status !== "abandoned" || state.consumptionIntent) return;
    this.#firstReplacing = true;
    this.firstOwnerError = undefined;
    this.draft = {
      mode: "live",
      venue: {
        ...structuredClone(state.venue),
        admin: {
          ...state.venue.admin,
          firstNames: state.venue.admin.firstNames ?? "",
          lastNames: state.venue.admin.lastNames ?? "",
        },
      },
    };
    this.screen = "admin";
  }

  async #onProvisionRequested(event: CustomEvent): Promise<void> {
    event.stopPropagation();
    if (this.#firstSession && (!this.firstReady || this.#firstSession.recoveryRequired)) {
      this.firstReady = false;
      this.screen = "first-owner";
      return;
    }
    this.reviewError = undefined;
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.#clearProvisionOutcome();
    this.#registerRoot();
    const submitted = structuredClone(this.draft);
    const generation = this.#rootGeneration;
    this.screen = "provisioning";
    try {
      const result = await (this.#firstSession
        ? this.#firstSession.provision(
            {
              mode: "live",
              aeatCert: assembleBody(submitted).aeatCert,
              email: submitted.email as ProvisionBody["email"],
            },
            currentLocale(),
          )
        : this.#localeChosen
          ? this.api.provision(assembleBody(submitted), currentLocale())
          : this.api.provision(assembleBody(submitted)));
      if (!this.isConnected || generation !== this.#rootGeneration) return;
      this.#rootBaseline = submitted;
      this.#rootScope?.commit(submitted);
      this.openingHours = result.openingHours;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected || generation !== this.#rootGeneration) return;
      if (this.#mapCertificateError(error)) return;
      if (this.#firstSession) {
        this.firstReady = false;
        this.firstOwnerError = this.#describeFirstError(error);
        this.screen = "first-owner";
      } else this.#mapProvisionError(error as ApiError);
    }
  }

  #mapFirstSetupError(error: unknown): boolean {
    const held = firstSetupHeldWords(
      (error as { code?: unknown } | null)?.code,
      "shell.provisioning.first_setup_held",
    );
    const key = firstSetupErrorKey(error);
    if (held === undefined && key === undefined) return false;
    this.#endAtReload(held ?? say(key!));
    return true;
  }

  #endAtReload(message: Message): void {
    this.#clearProvisionOutcome();
    this.provisionMessage = message;
    this.provisionReloadLabel = say("shell.reload");
    this.screen = "provisioning";
  }

  /**
   * A venue-data refusal (`provisioning.*`, `fiscal.*`) would fail again on a re-POST of the same
   * data, so it routes back to the venue form rather than offering a retry.
   */
  #mapProvisionError(error: ApiError): void {
    // A network drop rejects with a bare `TypeError`, which carries no `code`.
    const code =
      typeof (error as { code?: unknown }).code === "string" ? error.code : "server.internal";
    if (this.#mapFirstSetupError(error)) return;
    if (code.startsWith("provisioning.") || code.startsWith("fiscal.")) {
      const key = VENUE_ERROR_MESSAGES[code];
      this.venueError = key === undefined ? sayWith("shell.venue_error.other", { code }) : say(key);
      this.screen = "venue";
      return;
    }
    switch (code) {
      case "setup.request_invalid": {
        const field = typeof error.params?.field === "string" ? error.params.field : undefined;
        // The same list the venue form marks and explains from, so a path can never route back to a
        // form that has nothing to say about it.
        if (field !== undefined && Object.hasOwn(VENUE_SERVER_FIELDS, field)) {
          this.venueInvalidField = field;
          this.screen = "venue";
          return;
        }
        this.reviewError =
          field === undefined
            ? say("shell.review.request_invalid")
            : sayWith("shell.review.request_invalid_field", { field });
        this.screen = "review";
        return;
      }
      case "person.email_invalid":
        this.reviewError = say("shell.review.email_invalid");
        this.screen = "review";
        return;
      case "setup.email_required":
        this.emailError = say("email.required");
        this.screen = "email";
        return;
      case "setup.provisioning_secret_required":
        this.screen = "cert";
        return;
      case "setup.fiscal_test_required":
        this.fiscalTestStatus = undefined;
        this.fiscalTestError = say("shell.fiscal_test.required");
        this.screen = "fiscal-test";
        return;
      case "setup.already_provisioning":
        this.provisionMessage = say("shell.already_provisioning");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "setup.operation_conflict":
        this.provisionMessage = say("shell.operation_conflict");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "setup.already_provisioned":
        this.provisionMessage = say("shell.already_provisioned");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload_open_till");
        return;
      case "deployment.already_stamped":
        this.provisionMessage = say("shell.already_stamped");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "setup.mode_not_allowed":
      case "sif.throwaway_allocation_refused":
        this.provisionMessage = say(
          error.params?.installationOrigin === "usb"
            ? "shell.provision.usb_demo_refused"
            : "shell.provision.throwaway_refused",
        );
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "setup.not_ready":
        this.provisionMessage = say("shell.not_ready");
        this.provisionCanRetry = true;
        return;
      default:
        this.provisionMessage = say("shell.provision.failed");
        this.provisionCanRetry = true;
        return;
    }
  }

  /**
   * A successful adopt leaves the box adoption-pending, not a working mirror: the `PendingAdoption`
   * header in `apps/server/src/finish-adoption.ts` says why.
   */
  async #onAdoptRequested(event: CustomEvent<{ body: AdoptBody }>): Promise<void> {
    event.stopPropagation();
    this.connectError = undefined;
    this.connectErrorAboutLogin = false;
    this.connectInvalidField = undefined;
    this.connectRequest = undefined;
    this.#clearProvisionOutcome();
    this.screen = "provisioning";
    try {
      const outcome = await this.api.adopt(event.detail.body);
      if (!this.isConnected) return;
      this.breakGlassSecret = outcome.breakGlassSecret;
      this.breakGlassKeyName = outcome.breakGlassKeyName;
      this.mirrorJoin = true;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      await this.#mapAdoptError(error as ApiError, event.detail.body);
    }
  }

  async #onRestoreRequested(event: CustomEvent<{ request: RestoreRequestDetail }>): Promise<void> {
    event.stopPropagation();
    const attempt = ++this.#archiveRestoreAttempt;
    const generation = this.#rootGeneration;
    const current = () =>
      this.isConnected &&
      generation === this.#rootGeneration &&
      attempt === this.#archiveRestoreAttempt &&
      this.screen === "provisioning";
    this.restoreError = undefined;
    this.restoreInvalidField = undefined;
    this.#clearProvisionOutcome();
    this.screen = "provisioning";
    const request = event.detail.request;
    // The server answered the old-server question for the file it was sent, not for another.
    if (request.artifact !== this.restoreRequest?.artifact) {
      this.restoreLiveSince = undefined;
      this.restoreLiveUnknown = false;
    }
    try {
      await this.api.restore(
        request.artifact,
        request.recoveryKey,
        request.environment,
        request.oldBoxGone,
        ...(request.recoveryOperation !== undefined && request.nodeRecoverySecret !== undefined
          ? [
              {
                recoveryOperation: request.recoveryOperation,
                nodeRecoverySecret: request.nodeRecoverySecret,
                ...(request.recoveryContext === undefined
                  ? {}
                  : { recoveryContext: request.recoveryContext }),
              },
            ]
          : []),
      );
      if (!current()) return;
      this.restoreRequest = undefined;
      this.screen = "done";
    } catch (error) {
      if (!current()) return;
      const { code, params } = (error ?? {}) as {
        code?: unknown;
        params?: { lastChangeAt?: unknown };
      };
      const held = restoreOrResetRefusalWords(code, "shell.restore.first_setup_held");
      if (held !== undefined) {
        this.#endAtReload(held);
        return;
      }
      this.restoreRequest = withoutRecoveryCredentials(request);
      if (code === "restore.stream_source_live" && typeof params?.lastChangeAt === "string") {
        this.restoreLiveSince = params.lastChangeAt;
        this.restoreLiveUnknown = false;
      } else if (
        code === "restore.stream_source_live" ||
        code === "restore.stream_source_unchecked"
      ) {
        this.restoreLiveSince = undefined;
        this.restoreLiveUnknown = true;
      } else {
        this.restoreInvalidField = refusedField(
          code,
          params,
          RESTORE_FIELD_CODES,
          RESTORE_FIELD_PATHS,
        );
        this.restoreError =
          code === "restore.administrator_password_missing"
            ? say("shell.restore.administrator_password_missing")
            : code === "restore.environment_mismatch"
              ? say("shell.restore.environment_mismatch")
              : code === "restore.schema_too_new"
                ? say("shell.restore.other_version")
                : this.restoreInvalidField !== undefined
                  ? say(RESTORE_FIELD_CHECKS[this.restoreInvalidField])
                  : typeof code === "string"
                    ? sayWith("shell.restore.staging_failed_code", { code })
                    : say("shell.restore.staging_failed");
      }
      this.screen = "restore";
    }
  }

  async #onBucketRestoreRequested(
    event: CustomEvent<{ request: BucketRestoreRequestDetail }>,
  ): Promise<void> {
    event.stopPropagation();
    const attempt = ++this.#bucketRestoreAttempt;
    const generation = this.#rootGeneration;
    const current = () =>
      this.isConnected &&
      generation === this.#rootGeneration &&
      attempt === this.#bucketRestoreAttempt &&
      this.screen === "provisioning";
    const request = event.detail.request;
    // The server checked the old server and named the copy for the kit it was sent, not for another.
    if (request.kit !== this.bucketRequest?.kit) {
      this.bucketLiveSince = undefined;
      this.bucketLiveUnknown = false;
      this.bucketVenue = undefined;
    }
    this.bucketRestoreError = undefined;
    this.bucketInvalidField = undefined;
    this.#clearProvisionOutcome();
    this.screen = "provisioning";
    try {
      await this.api.restoreFromBucket(request);
      if (!current()) return;
      this.bucketRequest = undefined;
      this.rebuilt = true;
      this.screen = "done";
    } catch (error) {
      if (!current()) return;
      const { code, params } = (error ?? {}) as {
        code?: unknown;
        params?: Record<string, unknown>;
      };
      const held = restoreOrResetRefusalWords(code, "shell.restore.first_setup_held");
      if (held !== undefined) {
        this.#endAtReload(held);
        return;
      }
      this.bucketRequest = withoutRecoveryCredentials(request);
      const venue = venueToConfirm(params);
      if (code === "restore.stream_source_live" && typeof params?.lastChangeAt === "string") {
        this.bucketLiveSince = params.lastChangeAt;
        this.bucketLiveUnknown = false;
      } else if (
        code === "restore.stream_source_live" ||
        code === "restore.stream_source_unchecked"
      ) {
        this.bucketLiveSince = undefined;
        this.bucketLiveUnknown = true;
      } else if (code === "restore.stream_venue_unconfirmed" && venue !== undefined) {
        this.bucketVenue = venue;
      } else {
        this.bucketInvalidField = refusedField(
          code,
          params,
          BUCKET_FIELD_CODES,
          BUCKET_FIELD_PATHS,
        );
        // The kit's and environment's own refusals already say what is wrong with that field.
        this.bucketRestoreError =
          code === "setup.request_invalid" && this.bucketInvalidField !== undefined
            ? say(BUCKET_FIELD_CHECKS[this.bucketInvalidField])
            : describeBucketRefusal(code, params);
      }
      this.screen = "restore-bucket";
    }
  }

  async #onCloudRestoreAction(
    event: CustomEvent<{
      action: "start" | "status" | "start-again" | "restore";
      pointId?: string;
      oldBoxGone?: boolean;
      recoveryOperation?: RecoveryRestoreCredentials["recoveryOperation"];
      nodeRecoverySecret?: string;
      recoveryContext?: RecoveryRestoreCredentials["recoveryContext"];
    }>,
  ): Promise<void> {
    event.stopPropagation();
    if (this.cloudRecoveryBusy || !this.isConnected || this.screen !== "cloud-restore") return;
    const attempt = ++this.#cloudRecoveryAttempt;
    const generation = this.#rootGeneration;
    const owner = this.shadowRoot?.querySelector("setup-cloud-restore-screen");
    const confirmation = owner?.readConfirmation();
    let phase: Screen = "cloud-restore";
    const ownsBusy = () => attempt === this.#cloudRecoveryAttempt;
    const current = () =>
      this.isConnected &&
      generation === this.#rootGeneration &&
      ownsBusy() &&
      this.screen === phase &&
      (phase === "provisioning" || Boolean(owner?.isConnected));
    this.cloudRecoveryBusy = true;
    this.cloudRecoveryError = undefined;
    this.cloudInvalidField = undefined;
    this.cloudRetryConfirmation = undefined;
    try {
      const {
        action,
        pointId,
        oldBoxGone,
        recoveryOperation,
        nodeRecoverySecret,
        recoveryContext,
      } = event.detail;
      if (action === "restore") {
        if (!pointId || pointId !== this.cloudRecoveryView?.point?.id) throw new Error();
        phase = "provisioning";
        this.screen = phase;
        await this.api.restoreFromCloud(
          pointId,
          oldBoxGone === true,
          ...(recoveryOperation !== undefined && nodeRecoverySecret !== undefined
            ? [
                {
                  recoveryOperation,
                  nodeRecoverySecret,
                  ...(recoveryContext === undefined ? {} : { recoveryContext }),
                },
              ]
            : []),
        );
        if (current()) this.screen = "done";
      } else {
        const shown = this.cloudRecoveryView?.point?.id;
        const view =
          action === "start"
            ? await this.api.startCloudRecovery()
            : action === "start-again"
              ? await this.api.startCloudRecoveryAgain()
              : await this.api.cloudRecoveryStatus();
        if (!current()) return;
        this.cloudRecoveryView = view;
        // The server answered the old-server question for the snapshot it was sent, not for another.
        if (this.cloudRecoveryView.point?.id !== shown) {
          this.cloudLiveSince = undefined;
          this.cloudLiveUnknown = false;
        }
      }
    } catch (error) {
      if (current()) {
        const { code, params } = (error ?? {}) as {
          code?: unknown;
          params?: { lastChangeAt?: unknown };
        };
        const held = restoreOrResetRefusalWords(code, "shell.restore.first_setup_held");
        if (held !== undefined) {
          this.#endAtReload(held);
          return;
        }
        if (phase === "provisioning") this.cloudRetryConfirmation = confirmation;
        if (code === "restore.stream_source_live" && typeof params?.lastChangeAt === "string") {
          this.cloudLiveSince = params.lastChangeAt;
          this.cloudLiveUnknown = false;
        } else if (
          code === "restore.stream_source_live" ||
          code === "restore.stream_source_unchecked"
        ) {
          this.cloudLiveSince = undefined;
          this.cloudLiveUnknown = true;
        } else if (code === "promotion.break_glass_invalid") {
          this.cloudInvalidField = "nodeRecoverySecret";
          this.cloudRecoveryError = say(CLOUD_FIELD_CHECKS.nodeRecoverySecret);
        } else if (code === "setup.request_invalid") {
          this.cloudInvalidField = refusedField(code, params, {}, CLOUD_FIELD_PATHS);
          this.cloudRecoveryError = say(
            refusedField(code, params, {}, CLOUD_FIELD_CHECKS) ?? "shell.cloud.request_invalid",
          );
        } else {
          this.cloudRecoveryError = say(
            (typeof code === "string" ? CLOUD_ERROR_MESSAGES[code] : undefined) ??
              (event.detail.action === "restore"
                ? "shell.cloud.restore_unavailable"
                : "shell.cloud.unavailable"),
          );
        }
        this.screen = "cloud-restore";
      }
    } finally {
      if (ownsBusy()) this.cloudRecoveryBusy = false;
    }
  }

  async #onConfigurationRequested(
    event: CustomEvent<{ request: ConfigurationRequestDetail }>,
  ): Promise<void> {
    event.stopPropagation();
    if (!this.isConnected) return;
    const origin = event.composedPath()[0];
    const owner = origin instanceof SetupLiveSourceScreen ? origin : undefined;
    this.#registerRoot();
    const generation = this.#rootGeneration;
    this.configurationError = undefined;
    try {
      const preview = await this.api.stageConfiguration(
        event.detail.request.artifact,
        event.detail.request.passphrase,
      );
      if (!this.isConnected || generation !== this.#rootGeneration || (owner && !owner.isConnected))
        return;
      const exported = preview.venue;
      const venue: Partial<VenueDraft> = Object.fromEntries(
        (["country", ...TAXPAYER_FIELDS, ...CLAIM_VENUE_FIELDS] as const)
          .filter((key) => key in exported)
          .map((key) => [key, exported[key]]),
      );
      this.draft = deepMerge(this.draft, {
        configurationImport: true,
        venue,
      }) as DeepPartial<ProvisionBody>;
      delete this.draft.newTaxpayer;
      this.#rootScope?.changed();
      this.configurationPreview = preview;
      if (owner) {
        owner.acceptImport(event.detail.request);
        dispatchSetupGoto(owner, "configuration-preview");
      } else this.screen = "configuration-preview";
    } catch (error) {
      if (!this.isConnected || generation !== this.#rootGeneration || (owner && !owner.isConnected))
        return;
      this.configurationError = {
        code: (error as ApiError | null)?.code,
        message: describeConfigurationRefusal(error),
      };
      this.screen = "live-source";
    }
  }

  #onTaxpayerChosen(event: CustomEvent<{ newTaxpayer: boolean }>): void {
    event.stopPropagation();
    const preview = this.configurationPreview;
    if (!this.isConnected || !preview) return;
    this.#registerRoot();
    const venue: Record<string, unknown> = { ...this.draft.venue };
    for (const key of TAXPAYER_FIELDS) {
      if (event.detail.newTaxpayer) delete venue[key];
      else venue[key] = preview.venue[key];
    }
    const draft = { ...this.draft, venue } as DeepPartial<ProvisionBody>;
    if (event.detail.newTaxpayer) draft.newTaxpayer = true;
    else delete draft.newTaxpayer;
    this.draft = draft;
    this.#invalidateFiscalTest();
    this.#rootScope?.changed();
    this.#goto("admin");
  }

  /** A test still in flight was run on the draft before this change, so its answer is dropped. */
  #invalidateFiscalTest(): void {
    ++this.#fiscalTestGeneration;
    this.fiscalTestStatus = undefined;
    this.fiscalTestRunning = false;
  }

  async #onFiscalTestRequested(event: CustomEvent): Promise<void> {
    event.stopPropagation();
    this.#invalidateFiscalTest();
    const generation = this.#fiscalTestGeneration;
    const current = () => this.isConnected && generation === this.#fiscalTestGeneration;
    this.fiscalTestRejections = [];
    this.fiscalTestRunning = true;
    this.fiscalTestError = undefined;
    try {
      const result = await (this.#firstSession
        ? this.#firstSession.runFiscalTest({
            mode: "live",
            aeatCert: assembleBody(this.draft).aeatCert,
            email: this.draft.email as ProvisionBody["email"],
          })
        : this.api.runFiscalTest(assembleBody(this.draft)));
      if (!current()) return;
      this.fiscalTestStatus = result.status === "not-applicable" ? "accepted" : result.status;
      this.fiscalTestRejections = result.status === "rejected" ? (result.rejections ?? []) : [];
    } catch (error) {
      if (!current()) return;
      if (this.#mapCertificateError(error)) return;
      this.fiscalTestError = say("shell.fiscal_test.could_not_run");
    } finally {
      if (current()) this.fiscalTestRunning = false;
    }
  }

  #mapCertificateError(error: unknown): boolean {
    const { code, params } = (error ?? {}) as Partial<ApiError>;
    if (
      code !== "setup.certificate_refused" ||
      (params?.field !== "pfxBase64" && params?.field !== "passphrase")
    )
      return false;
    this.#invalidateFiscalTest();
    this.certificateRefusal = {
      field: params.field,
      reason: typeof params.reason === "string" ? params.reason : "unreadable",
    };
    this.screen = "cert";
    return true;
  }

  /**
   * The terminal refusals offer a bare "Reload": only a box still in setup mode answers an adopt, and
   * reloading one reopens this wizard. An adopt that stopped partway offers the reset screen
   * instead. `setup.already_provisioned` is thrown only by the provision path today and is mapped
   * here for parity. Any other code the server answered (the error carries
   * an HTTP `status`) reads the saved setup first, and an adopt saved past "started" and short of
   * "complete" gets the stopped-partway message. Otherwise `setup.operation_conflict` is terminal
   * too, and everything else routes back to the connect form, the mirror path's retry surface.
   */
  async #mapAdoptError(error: ApiError, body: AdoptBody): Promise<void> {
    const code =
      typeof (error as { code?: unknown }).code === "string" ? error.code : "server.internal";
    if (this.#mapFirstSetupError(error)) return;
    switch (code) {
      // Not read against the saved setup: an adopt still running on the server is past "started" too.
      case "setup.already_provisioning":
        this.provisionMessage = say("shell.already_provisioning");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "setup.already_provisioned":
        this.provisionMessage = say("shell.already_provisioned");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "deployment.already_stamped":
        this.provisionMessage = say("shell.already_stamped");
        this.provisionCanRetry = false;
        this.provisionReloadLabel = say("shell.reload");
        return;
      case "setup.adopt_incomplete":
        this.#offerReset();
        return;
    }
    // The server matches a resend by its exact body, and a one-time code changes it, so an adopt
    // that stopped partway can come back as a conflict or as the first failure itself. With no
    // answer from the server the adopt may still be running there, past "started" too.
    const stoppedPartway = error.status !== undefined && (await this.#savedAdoptStoppedPartway());
    if (!this.isConnected) return;
    if (stoppedPartway) {
      this.#offerReset();
    } else if (code === "setup.operation_conflict") {
      this.provisionMessage = say("shell.operation_conflict");
      this.provisionCanRetry = false;
      this.provisionReloadLabel = say("shell.reload");
    } else {
      this.connectInvalidField = refusedField(
        code,
        error.params,
        ADOPT_FIELD_CODES,
        ADOPT_FIELD_PATHS,
      );
      if (this.connectInvalidField === undefined) {
        this.connectError = adoptErrorWords(code, error.params);
        this.connectErrorAboutLogin = code === "password.invalid";
      }
      this.connectRequest = body;
      this.screen = "connect";
    }
  }

  /** Every flag the provisioning screen reads, so no answer outlives the request it answered. */
  #clearProvisionOutcome(): void {
    this.openingHours = undefined;
    this.provisionMessage = undefined;
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
    this.provisionCanReset = false;
  }

  #offerReset(): void {
    this.provisionMessage = say("shell.adopt.incomplete");
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
    this.provisionCanReset = true;
  }

  async #onResetRequested(event: CustomEvent<{ credential: ResetCredential }>): Promise<void> {
    event.stopPropagation();
    if (this.resetBusy) return;
    const owner = this.shadowRoot?.querySelector("setup-reset-screen");
    const generation = this.#rootGeneration;
    const ownsBusy = () =>
      this.isConnected &&
      this.screen === "reset" &&
      owner?.isConnected &&
      this.shadowRoot?.querySelector("setup-reset-screen") === owner;
    const current = () => ownsBusy() && generation === this.#rootGeneration;
    this.resetBusy = true;
    this.resetCredentialsRejected = false;
    this.resetInvalidField = undefined;
    this.resetError = undefined;
    try {
      await this.api.resetIncompleteAdopt(event.detail.credential);
      if (!current()) return;
      this.resetOutcome = { kind: "resetting", message: say("shell.reset.resetting") };
    } catch (error) {
      if (!current()) return;
      const { code, params } = (error ?? {}) as ApiError;
      const held = restoreOrResetRefusalWords(code, "shell.reset.first_setup_held");
      if (held !== undefined) {
        this.resetOutcome = { kind: "refused", message: held };
        return;
      }
      switch (code) {
        case "password.invalid":
          this.resetCredentialsRejected = true;
          break;
        case "password.throttled":
          this.resetError = describeThrottle(params);
          break;
        case "setup.reset_unavailable":
          this.resetOutcome = { kind: "refused", message: say("shell.reset.unavailable") };
          break;
        case "setup.already_provisioning":
          this.resetOutcome = { kind: "refused", message: say("shell.already_provisioning") };
          break;
        case "setup.operation_conflict":
          this.resetOutcome = { kind: "refused", message: say("shell.operation_conflict") };
          break;
        default:
          this.resetInvalidField = refusedField(code, params, {}, RESET_FIELD_PATHS);
          if (this.resetInvalidField !== undefined) break;
          this.resetError = say(
            (typeof code === "string" ? RESET_ERROR_MESSAGES[code] : undefined) ??
              "shell.reset.generic",
          );
      }
    } finally {
      if (ownsBusy()) this.resetBusy = false;
    }
  }

  async #savedAdoptStoppedPartway(): Promise<boolean> {
    try {
      const operation = (await this.api.getStatus()).operation;
      return (
        operation?.kind === "adopt" &&
        operation.phase !== "started" &&
        operation.phase !== "complete"
      );
    } catch {
      return false;
    }
  }

  private readonly leave = new LeaveController(this);

  private leaveConfirmation() {
    return this.leave.render({
      heading: t("unsaved.heading"),
      message: t("unsaved.message"),
      keepLabel: t("unsaved.keep"),
      discardLabel: t("unsaved.discard"),
    });
  }

  override render(): TemplateResult {
    // Listening on the container lets each screen talk back without the shell knowing which is mounted.
    return html`${this.leaveConfirmation()}
      <main
        @setup-patch=${(e: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>) => this.#onPatch(e)}
        @setup-goto=${(e: CustomEvent<{ screen: Screen }>) => this.#onGoto(e)}
        @setup-advance=${(e: CustomEvent) => this.#onAdvance(e)}
        @provision-requested=${(e: CustomEvent) => void this.#onProvisionRequested(e)}
        @adopt-requested=${(e: CustomEvent<{ body: AdoptBody }>) => void this.#onAdoptRequested(e)}
        @restore-requested=${(e: CustomEvent<{ request: RestoreRequestDetail }>) =>
          void this.#onRestoreRequested(e)}
        @bucket-restore-requested=${(e: CustomEvent<{ request: BucketRestoreRequestDetail }>) =>
          void this.#onBucketRestoreRequested(e)}
        @setup-conflict=${() => this.#endAtReload(say("shell.setup_conflict"))}
        @cloud-restore-action=${(e: CustomEvent<{ action: "start" | "status" | "start-again" | "restore"; pointId?: string; oldBoxGone?: boolean }>) => void this.#onCloudRestoreAction(e)}
        @configuration-requested=${(e: CustomEvent<{ request: ConfigurationRequestDetail }>) =>
          void this.#onConfigurationRequested(e)}
        @taxpayer-chosen=${(e: CustomEvent<{ newTaxpayer: boolean }>) => this.#onTaxpayerChosen(e)}
        @fiscal-test-requested=${(e: CustomEvent) => void this.#onFiscalTestRequested(e)}
        @reset-requested=${(e: CustomEvent<{ credential: ResetCredential }>) =>
          void this.#onResetRequested(e)}
      >
        <header>
          <wt-waitron-lockup class="logo" data-test="setup-logo"></wt-waitron-lockup>
          <setup-problem-report></setup-problem-report>
          <div class="header-controls">
            <wt-theme-chooser
              data-test="theme-chooser"
              .active=${this.#theme.choice}
              .labels=${this.#themeLabelsFor(currentLocale())}
            ></wt-theme-chooser>
            <wt-language-chooser
              .active=${currentLocale()}
              @wt-locale-selected=${(e: CustomEvent<{ code: string }>) => this.#onLocaleSelected(e)}
            ></wt-language-chooser>
          </div>
        </header>
        ${this.#renderScreen()}
      </main>`;
  }

  #renderFirstOwner(): TemplateResult {
    const t = initialOwnerStrings[setupLocale()];
    const restarting = this.firstRestarting || this.firstStopped;
    const state = this.#firstSession?.state;
    const missing = this.firstInspection?.database === "missing";
    const inspection =
      !state || missing || pastActivation(state) || notCarriedOn(state)
        ? this.firstInspection
        : undefined;
    const noLongerHeld =
      inspection !== undefined &&
      !restarting &&
      (this.#firstSession?.keyRefused === true || notCarriedOn(state));
    const summary = this.firstWipeSummary;
    const ask = missing ? summary : undefined;
    const confirmOpen = this.firstRestartConfirm && summary !== undefined;
    const refused = this.firstStartAgainRefused;
    const offered = inspection !== undefined && wipeOffered(inspection);
    const refusalWords = {
      "setup-finished": t.setupFinished,
      "kept-records": t.keptFault,
      "may-have-filed": t.wipeMayHaveFiled,
      unexpected: t.wipeUnexpected,
      "too-large": t.wipeTooLarge,
      unreadable: t.wipeUnreadable,
      fault: t.wipeFault,
      insecure: t.wipeInsecure,
      unavailable: t.wipeUnavailable,
    }[refused ?? "unavailable"];
    const terminal = pastActivation(state) || notCarriedOn(state) || state?.status === "complete";
    const heldError =
      (!terminal || this.#firstSession?.recoveryRequired) &&
      !missing &&
      !this.firstOwnerBusy &&
      !restarting &&
      state !== undefined
        ? this.firstOwnerError
        : undefined;
    const startAgain = html`<wt-button
      data-test="start-again"
      variant="secondary"
      ?disabled=${this.firstOwnerBusy || !offered}
      @click=${() => void this.#openWipeConfirmation("start-again")}
      >${t.startAgain}</wt-button
    >`;
    const noInvoiceFound = !missing && summary?.databaseUnreadable !== true;
    const recoverBackup = html`<wt-button
      data-test="recover-backup"
      variant="secondary"
      ?disabled=${this.firstOwnerBusy || !offered}
      @click=${() => void this.#openWipeConfirmation("recover")}
      >${t.recoverBackup}</wt-button
    >`;
    const cancelStartAgain = html`<wt-button
      slot="cancel"
      data-test="cancel-start-again"
      variant="secondary"
      ?disabled=${this.firstOwnerBusy}
      @click=${() => this.#cancelWipe()}
      >${t.cancel}</wt-button
    >`;
    const recovering = confirmOpen && this.firstWipeKind === "recover";
    const startAgainConfirm = !confirmOpen
      ? nothing
      : html`${
            summary.recoveryRecordDamaged === true
              ? html`<p data-test="recovery-record-damaged">${t.recoveryRecordDamaged}</p>`
              : nothing
          }${
            summary.databaseUnreadable === true
              ? html`<p data-test="setup-database-unreadable">${t.setupDatabaseUnreadable}</p>`
              : nothing
          }
          ${
            recovering
              ? html`<p data-test="recover-deletes">
                  ${noInvoiceFound ? `${t.recoverDeletes} ${t.noInvoiceSent} ${t.recoverThen}` : `${t.recoverDeletes} ${t.recoverThen}`}
                </p>`
              : html`<p data-test="start-again-deletes">
                  ${noInvoiceFound ? `${t.heldLost} ${t.noInvoiceSent}` : t.heldLost}
                </p>`
          }
          <label
            ><input
              data-test="retire-confirmed"
              name=${missing ? "missing-database-confirmed" : "retire-setup"}
              type="checkbox"
              .checked=${this.firstRetireConfirmed}
              ?disabled=${this.firstOwnerBusy}
              @change=${(event: Event) => {
                this.firstRetireConfirmed = (event.currentTarget as HTMLInputElement).checked;
              }}
            />${missing ? t.missingConfirm : recovering ? t.retireRecover : t.retireConfirmed}</label
          >
          <wt-form-actions .error=${this.firstWipeError?.() ?? ""}>
            ${cancelStartAgain}
            <wt-button
              data-test=${recovering ? "confirm-recover" : "confirm-start-again"}
              variant=${this.firstRetireConfirmed || this.firstOwnerBusy ? "danger" : "secondary"}
              ?disabled=${!this.firstRetireConfirmed || this.firstOwnerBusy}
              @click=${() => void this.#sendWipeFirstSetup()}
              >${recovering ? t.recoverBackup : t.startAgain}</wt-button
            >
          </wt-form-actions>`;
    const stopConfirm = html`<p data-test="stop-asks">${t.stopAsk}</p>
      <wt-form-actions .error=${this.firstWipeError?.() ?? ""}>
        <wt-button
          slot="cancel"
          data-test="cancel-stop"
          variant="secondary"
          ?disabled=${this.firstOwnerBusy}
          @click=${() => this.#cancelWipe()}
          >${t.cancel}</wt-button
        >
        <wt-button
          data-test="confirm-stop"
          variant="danger"
          ?disabled=${this.firstOwnerBusy}
          @click=${() => void this.#stopFirstSetup()}
          >${t.stopConfirm}</wt-button
        >
      </wt-form-actions>`;
    const wipeError =
      !confirmOpen && !this.firstOwnerBusy && this.firstWipeError
        ? html`<wt-form-actions .error=${this.firstWipeError()}></wt-form-actions>`
        : nothing;
    const refusal =
      refused !== undefined || (inspection !== undefined && !offered)
        ? html`<p data-test="start-again-refused" tabindex="-1">${refusalWords}</p>`
        : nothing;
    return html`<section data-test="screen-first-owner">
      <h1>${inspection && !restarting ? t.interrupted : t.heading}</h1>
      ${restarting ? html`<p role="status">${this.firstStopped ? t.stopped : t.restarting}</p>` : nothing}
      ${missing ? html`<p data-test="missing-database">${t.missingDatabase}</p>` : nothing}
      ${noLongerHeld ? html`<p data-test="owner-required">${say("shell.first_setup.owner_required")()}</p>` : nothing}
      ${this.firstOwnerBusy ? html`<p role="status">${t.waiting}</p>` : nothing}
      ${heldError ? html`<wt-form-actions .error=${heldError()}></wt-form-actions>` : nothing}
      ${
        inspection && !restarting
          ? this.firstStopConfirm
            ? stopConfirm
            : ask
              ? html`<p>${t.missingAsk}</p>
                  <ul data-test="missing-reached">
                    <li>
                      ${
                        ask.reached === "fiscal-started"
                          ? t.reachedFiscalStarted
                          : ask.reached === "fiscal-finished"
                            ? t.reachedFiscalFinished
                            : t.reachedNotStarted
                      }
                    </li>
                  </ul>
                  ${recovering ? nothing : html`<p>${t.missingBackup}</p>`}
                  <div class="missing-actions" data-test="missing-actions">
                    ${recovering ? nothing : recoverBackup}${confirmOpen ? nothing : startAgain}
                  </div>
                  ${startAgainConfirm} ${wipeError}`
              : html`${refused === undefined && !confirmOpen ? startAgain : nothing} ${refusal}
                ${startAgainConfirm}
                ${refused === undefined && !recovering ? recoverBackup : nothing} ${wipeError}`
          : nothing
      }
      ${state?.status === "abandoned" ? html`<p>${t.retired}</p>` : nothing}
      ${!missing && state?.consumptionIntent && terminal && state.status !== "complete" && !pastActivation(state) ? html`<p>${t.consumed}</p>` : nothing}
      ${!missing && state?.status === "complete" ? html`<p>${t.complete}</p>` : nothing}
      ${
        !heldError && !inspection && (!state || pastActivation(state)) && !this.firstOwnerBusy
          ? html`<wt-form-actions .error=${this.firstOwnerError?.() ?? t.error}></wt-form-actions>`
          : nothing
      }
      ${!missing && state?.status === "abandoned" && !state.consumptionIntent ? html`<wt-button data-test="replace-attempt" @click=${() => this.#replaceFirstSetup()}>${t.replace}</wt-button>` : nothing}
      ${!missing && state && !terminal ? html`<wt-button data-test="abandon-attempt" variant="ghost" ?disabled=${this.firstOwnerBusy} @click=${() => void this.#abandonFirstSetup()}>${t.abandon}</wt-button>` : nothing}
      <wt-button
        data-test="reconnect-first"
        variant="secondary"
        ?disabled=${this.firstOwnerBusy}
        @click=${() => void this.#reconnectFirstSetup()}
        >${t.reconnect}</wt-button
      >
      <p>
        <a
          data-test="secure-connection"
          href="/setup/connection"
          target="_blank"
          rel="noopener noreferrer"
          >${t.secureConnection}</a
        >
      </p>
    </section>`;
  }

  #renderScreen(): TemplateResult {
    const firstSession = this.#firstSession;
    switch (this.screen) {
      case "first-owner":
        return this.#renderFirstOwner();
      case "first-setup":
        return html`<setup-initial-setup-screen
          data-test="screen-first-setup"
          .session=${this.#firstSession}
          .offerings=${this.firstOfferings}
          .contributions=${SETUP_MODULES}
          .locale=${setupLocale()}
          @initial-reconnect=${() => void this.#reconnectFirstSetup()}
          @initial-change-details=${(event: Event) => {
            event.stopPropagation();
            this.#navigateTo("venue");
          }}
          @initial-setup-ready=${() => {
            this.firstReady = true;
            this.#goto("review");
          }}
        ></setup-initial-setup-screen>`;
      case "connection":
        return html`<setup-connection-screen
          data-test="screen-connection"
          .errorMessage=${this.connectionFailure?.message()}
          .checking=${this.connectionChecking}
          .setupUnavailable=${this.connectionFailure?.canRetry === false}
          @connection-continue=${() => void this.#continueConnection()}
        ></setup-connection-screen>`;
      case "role":
        return html`<setup-role-screen data-test="screen-role"></setup-role-screen>`;
      case "restore":
        return html`<setup-restore-screen
          data-test="screen-restore"
          .api=${this.api}
          .errorMessage=${this.restoreError?.()}
          .invalidField=${this.restoreInvalidField}
          .liveSince=${this.restoreLiveSince}
          .liveUnknown=${this.restoreLiveUnknown}
          .request=${this.restoreRequest}
        ></setup-restore-screen>`;
      case "restore-bucket":
        return html`<setup-restore-bucket-screen
          data-test="screen-restore-bucket"
          .api=${this.api}
          .errorMessage=${this.bucketRestoreError?.()}
          .invalidField=${this.bucketInvalidField}
          .liveSince=${this.bucketLiveSince}
          .liveUnknown=${this.bucketLiveUnknown}
          .venue=${this.bucketVenue}
          .request=${this.bucketRequest}
        ></setup-restore-bucket-screen>`;
      case "cloud-restore":
        return html`<setup-cloud-restore-screen
          data-test="screen-cloud-restore"
          .api=${this.api}
          .view=${this.cloudRecoveryView}
          .retryConfirmation=${this.cloudRetryConfirmation}
          .errorMessage=${this.cloudRecoveryError?.()}
          .invalidField=${this.cloudInvalidField}
          .busy=${this.cloudRecoveryBusy}
          .liveSince=${this.cloudLiveSince}
          .liveUnknown=${this.cloudLiveUnknown}
        ></setup-cloud-restore-screen>`;
      case "live-source":
        return html`<setup-live-source-screen
          data-test="screen-live-source"
          .errorMessage=${this.configurationError?.message()}
          .errorCode=${this.configurationError?.code}
          .beforeEmpty=${(proceed: () => void, signal: AbortSignal) => this.#requestStartEmpty(proceed, signal)}
        ></setup-live-source-screen>`;
      case "configuration-preview":
        return html`<setup-configuration-preview-screen
          data-test="screen-configuration-preview"
          .preview=${this.configurationPreview}
        ></setup-configuration-preview-screen>`;
      case "fiscal-test":
        return html`<setup-fiscal-test-screen
          data-test="screen-fiscal-test"
          .nextScreen=${this.draft.mode === "live" && !this.developmentMode ? "email" : "review"}
          .status=${this.fiscalTestStatus}
          .rejections=${this.fiscalTestRejections}
          .running=${this.fiscalTestRunning}
          .errorMessage=${this.fiscalTestError?.()}
        ></setup-fiscal-test-screen>`;
      case "email":
        return html`<setup-email-screen
          data-test="screen-email"
          .email=${this.draft.email}
          .mode=${this.draft.mode === "prepare" ? "prepare" : "live"}
          .adminEmail=${this.draft.venue?.admin?.email ?? ""}
          .api=${firstSession === undefined ? this.api : { runEmailTest: (email: EmailSettingsDraft) => firstSession.runEmailTest(email) }}
          .errorMessage=${this.emailError?.()}
          .backScreen=${this.draft.mode === "live" && this.draft.venue?.fiscalTerritory === "ES-common" && !this.developmentMode ? "fiscal-test" : "venue"}
        ></setup-email-screen>`;
      case "mode":
        return html`<setup-mode-screen
          data-test="screen-mode"
          .installationOrigin=${this.installationOrigin}
          .environment=${this.environment}
          .certificateNote=${!this.connectionAnswered}
          .beforeChoice=${(
            mode: "demo" | "prepare" | "live" | undefined,
            proceed: () => void,
            signal: AbortSignal,
          ) => this.#requestModeChoice(mode, proceed, signal)}
        ></setup-mode-screen>`;
      case "connect":
        return html`<setup-connect-screen
          data-test="screen-connect"
          .api=${this.api}
          .errorMessage=${this.connectError?.()}
          .errorAboutLogin=${this.connectErrorAboutLogin}
          .invalidField=${this.connectInvalidField}
          .request=${this.connectRequest}
        ></setup-connect-screen>`;
      case "admin":
        return html`<setup-admin-screen
          data-test="screen-admin"
          .draft=${this.draft}
        ></setup-admin-screen>`;
      case "venue":
        return html`<setup-venue-screen
          data-test="screen-venue"
          .draft=${this.draft}
          .errorMessage=${this.venueError?.()}
          .invalidField=${this.venueInvalidField}
        ></setup-venue-screen>`;
      case "cert":
        return html`<setup-cert-screen
          data-test="screen-cert"
          .draft=${this.draft}
          .refusal=${this.certificateRefusal}
        ></setup-cert-screen>`;
      case "review":
        return html`<setup-review-screen
          data-test="screen-review"
          .usesAllocation=${this.#firstSession !== undefined}
          .backScreen=${(this.draft.mode === "live" || this.draft.mode === "prepare") && !this.developmentMode ? "email" : "venue"}
          .draft=${this.draft}
          .errorMessage=${this.reviewError?.()}
        ></setup-review-screen>`;
      case "provisioning":
        return html`<setup-provisioning-screen
          data-test="screen-provisioning"
          .legalName=${this.draft.venue?.legalName}
          .onboardingIntent=${this.draft.mode}
          .message=${this.provisionMessage?.()}
          .canRetry=${this.provisionCanRetry}
          .reloadLabel=${this.provisionReloadLabel?.()}
          .canReset=${this.provisionCanReset}
        ></setup-provisioning-screen>`;
      case "reset":
        return html`<setup-reset-screen
          data-test="screen-reset"
          .busy=${this.resetBusy}
          .credentialsRejected=${this.resetCredentialsRejected}
          .invalidField=${this.resetInvalidField}
          .errorMessage=${this.resetError?.()}
          .outcome=${this.resetOutcome && { kind: this.resetOutcome.kind, message: this.resetOutcome.message() }}
        ></setup-reset-screen>`;
      case "done":
        return html`<setup-done-screen
          data-test="screen-done"
          .api=${this.api}
          .breakGlassSecret=${this.breakGlassSecret}
          .breakGlassKeyName=${this.breakGlassKeyName}
          .mirrorJoin=${this.mirrorJoin}
          .onboardingIntent=${this.draft.mode}
          .rebuilt=${this.rebuilt}
          .openingHours=${this.openingHours}
        ></setup-done-screen>`;
      default:
        return html`<setup-mode-screen
          data-test="screen-mode"
          .installationOrigin=${this.installationOrigin}
          .environment=${this.environment}
          .certificateNote=${!this.connectionAnswered}
        ></setup-mode-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-app": SetupApp;
  }
}
