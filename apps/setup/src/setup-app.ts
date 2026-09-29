import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { baseStyles } from "@waitron/ui";
import waitronLockup from "../../../packages/ui/brand/waitron-lockup.svg?raw";
import "./screens/role-screen.js";
import "./screens/connection-screen.js";
import "./screens/connect-screen.js";
import "./screens/restore-screen.js";
import "./screens/restore-bucket-screen.js";
import "./screens/cloud-restore-screen.js";
import "./screens/live-source-screen.js";
import "./screens/configuration-preview-screen.js";
import "./screens/fiscal-test-screen.js";
import "./screens/mode-screen.js";
import "./screens/admin-screen.js";
import "./screens/venue-screen.js";
import "./screens/cert-screen.js";
import "./screens/review-screen.js";
import "./screens/provisioning-screen.js";
import "./screens/reset-screen.js";
import "./screens/done-screen.js";
import "./widgets/language-chooser.js";
import type {
  AdoptBody,
  ApiError,
  ConfigurationPreview,
  ProvisionBody,
  ResetCredential,
  SetupApi,
  CloudRecoveryView,
  VenueDefaults,
} from "./api/client.js";
import type {
  BucketRestoreRequestDetail,
  ConfigurationRequestDetail,
  RestoreRequestDetail,
} from "./events.js";
import type { ConnectField } from "./screens/connect-screen.js";
import type { BucketField, RestoredVenue } from "./screens/restore-bucket-screen.js";
import type { RestoreField } from "./screens/restore-screen.js";
import type { ResetField, ResetScreenOutcome } from "./screens/reset-screen.js";
import { SERVER_FIELDS } from "./server-fields.js";
import { LocaleChangeController } from "./i18n/locale-controller.js";
import { matchBrowserLocale } from "./i18n/match-browser-locale.js";
import type { StringKey } from "./i18n/strings.js";
import { currentLocale, format, setLocale, t } from "./i18n/t.js";

/** The wizard's screens, shown one at a time from in-memory state, never a URL route. */
export type Screen =
  | "connection"
  | "role"
  | "connect"
  | "restore"
  | "restore-bucket"
  | "cloud-restore"
  | "live-source"
  | "configuration-preview"
  | "fiscal-test"
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

const VENUE_ERROR_MESSAGES: Record<string, StringKey> = {
  "provisioning.territory_country_mismatch": "shell.venue_error.territory_country_mismatch",
  "provisioning.invalid_locales": "shell.venue_error.invalid_locales",
  "provisioning.duplicate_series_code": "shell.venue_error.duplicate_series_code",
  "fiscal.regime_not_implemented": "shell.venue_error.regime_not_implemented",
};

const ADOPT_ERROR_MESSAGES: Record<string, StringKey> = {
  "mirror.bundle_fetch_failed": "shell.adopt.bundle_fetch_failed",
  "setup.request_invalid": "shell.adopt.request_invalid",
  "setup.not_ready": "shell.not_ready",
};

const RESET_ERROR_MESSAGES: Record<string, StringKey> = {
  "setup.request_invalid": "shell.reset.request_invalid",
  "setup.not_ready": "shell.not_ready",
};

/**
 * The field a refusal is about, when the screen that sent the request shows it: named by the code
 * itself, or by `setup.request_invalid`'s `params.field` (the server's path for the field).
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

const RESTORE_FIELD_CODES: Record<string, RestoreField> = {
  "recovery.passphrase_invalid": "recoveryKey",
  "restore.environment_mismatch": "environment",
};

const RESTORE_FIELD_PATHS: Record<string, RestoreField> = {
  artifact: "artifact",
  recoveryKey: "recoveryKey",
  environment: "environment",
};

const BUCKET_FIELD_CODES: Record<string, BucketField> = {
  "backup.stream_kit_invalid": "kit",
  "restore.environment_mismatch": "environment",
};

const BUCKET_FIELD_PATHS: Record<string, BucketField> = { kit: "kit", environment: "environment" };

function describeThrottle(params: Record<string, unknown> | undefined): Message {
  const seconds = params?.retryAfterSeconds;
  if (typeof seconds !== "number") return say("shell.throttle");
  return seconds === 1
    ? say("shell.throttle_wait_one")
    : sayWith("shell.throttle_wait", { seconds });
}

/** The owner's words for each refusal a rebuild from the bucket can meet whose params add nothing. */
const BUCKET_ERROR_MESSAGES: Record<string, StringKey> = {
  "backup.stream_kit_invalid": "shell.bucket.kit_invalid",
  "restore.stream_pointer_missing": "shell.bucket.pointer_missing",
  "restore.stream_pointer_unverified": "shell.bucket.pointer_unverified",
  "backup.stream_pointer_invalid": "shell.bucket.pointer_invalid",
  "restore.stream_integrity_failed": "shell.bucket.integrity_failed",
  "restore.stream_state_missing": "shell.bucket.state_missing",
  // One sentence for all three, as the command line gives (`DECRYPT_PHASE_CODES`,
  // apps/server/src/restore-command.ts).
  "recovery.passphrase_invalid": "shell.bucket.key_does_not_open",
  "backup.artifact_invalid": "shell.bucket.key_does_not_open",
  "backup.archive_invalid": "shell.bucket.key_does_not_open",
  "backup.stream_restore_failed": "shell.bucket.restore_failed",
  "backup.stream_request_failed": "shell.bucket.request_failed",
  "restore.stream_disk_full": "shell.bucket.disk_full",
  "restore.environment_mismatch": "shell.bucket.environment_mismatch",
  "provisioning.database_ahead": "shell.bucket.newer_software",
  "restore.schema_too_new": "shell.bucket.newer_software",
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
  "restore.schema_too_new": "shell.cloud.newer_software",
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
  if (code === "restore.stream_venue_unconfirmed") return say("shell.bucket.venue_unconfirmed");
  const key = BUCKET_ERROR_MESSAGES[code];
  return key === undefined ? sayWith("shell.bucket.refused_code", { code }) : say(key);
}

/** The restored copy's names, when the refusal carries all three and a tax id to confirm. */
function venueToConfirm(params: Record<string, unknown> | undefined): RestoredVenue | undefined {
  const { legalName, taxId, locationName } = params ?? {};
  if (typeof legalName !== "string" || typeof taxId !== "string") return undefined;
  if (typeof locationName !== "string" || taxId === "") return undefined;
  return { legalName, taxId, locationName };
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

/**
 * The wizard's root. It owns the injected {@link SetupApi} and the request {@link SetupApp.draft}
 * each screen contributes a slice of through `setup-patch`.
 */
@customElement("setup-app")
export class SetupApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      main {
        box-sizing: border-box;
        width: min(calc(var(--wt-space-6) * 22), calc(100% - 2 * var(--wt-modal-inline-margin)));
        /* The bottom margin clears the fixed language chooser, so the last action scrolls out from
           under it. */
        margin: var(--wt-space-5) auto
          calc(var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom));
        padding: var(--wt-space-5) var(--wt-modal-inline-padding);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface-raised);
      }

      .logo svg {
        display: block;
        width: calc(var(--wt-space-6) * 5);
        height: auto;
      }

      /* The brand file paints fixed light-theme ink, which an <img> could not change; inlined, its
         two groups (the waiter, then the word) follow the theme. */
      .logo svg > g:first-of-type {
        fill: var(--wt-color-primary);
      }

      .logo svg > g:last-of-type {
        fill: var(--wt-color-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: SetupApi;

  @property({ attribute: false }) browserLanguages: readonly string[] = navigator.languages;

  /** Held for the page's life only: a reload goes back to the browser's languages. */
  #localeChosen = false;

  constructor() {
    super();
    new LocaleChangeController(this, () => {
      document.documentElement.lang = currentLocale();
      document.title = t("shell.document_title");
      this.requestUpdate();
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.#localeChosen) setLocale(matchBrowserLocale(this.browserLanguages));
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
  @state() private venueDefaults: VenueDefaults = {};

  @state() private environment?: "production" | "preproduction";
  @state() private developmentMode = false;

  /** Seeded with the defaults every ES deli shares, so a screen only has to collect what differs. */
  @state() private draft: DeepPartial<ProvisionBody> = {
    venue: {
      country: "ES",
      location: {
        fiscalTerritory: "ES-common",
        timeZone: "Europe/Madrid",
        invoiceLocales: ["es-ES"],
      },
    },
  };

  @state() private reviewError?: Message;

  @state() private venueError?: Message;

  /**
   * Cleared everywhere {@link SetupApp.venueError} is: a mark surviving into the next attempt would
   * leave a field red on a value the operator has already corrected.
   */
  @state() private venueInvalidField?: string;

  @state() private connectError?: Message;
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
  @state() private bucketRestoreError?: Message;
  @state() private bucketInvalidField?: BucketField;
  @state() private bucketLiveSince?: string;
  @state() private bucketLiveUnknown = false;
  @state() private bucketVenue?: RestoredVenue;
  /** Held only in this tab's memory: the kit inside it is as sensitive as the recovery key. */
  @state() private bucketRequest?: BucketRestoreRequestDetail;
  /** Kept apart from the other outcomes because the done screen's copy depends on which path ran. */
  @state() private rebuilt = false;
  @state() private cloudRecoveryView?: CloudRecoveryView;
  @state() private cloudRecoveryError?: Message;
  @state() private cloudRecoveryBusy = false;
  /** Set from `restore.stream_source_live`/`restore.stream_source_unchecked` on the Cloud path. */
  @state() private cloudLiveSince?: string;
  @state() private cloudLiveUnknown = false;
  @state() private configurationError?: Message;
  @state() private configurationPreview?: ConfigurationPreview;
  @state() private fiscalTestStatus?: "accepted" | "rejected" | "uncertain";
  @state() private fiscalTestRunning = false;
  @state() private fiscalTestError?: Message;

  /**
   * The adopt response carries this once, so the done screen is the operator's only chance to see and
   * record it before the box restarts.
   */
  @state() private breakGlassSecret?: string;

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
    void this.#loadVenueDefaults();
  }

  async #loadVenueDefaults(): Promise<void> {
    try {
      const defaults = await this.api.getVenueDefaults();
      if (this.isConnected) this.venueDefaults = defaults;
    } catch {
      // Prepare and Live can still collect an explicit description when defaults cannot be read.
    }
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
      this.environment = status.environment;
      this.developmentMode = status.developmentMode === true;
      // Availability describes the box, not whether this browser has installed its CA.
      if (this.screen === "connection" && !discovery.caDownloadAvailable) this.screen = "mode";
    } catch (error) {
      this.#recordConnectionFailure(error, generation);
    }
  }

  #recordConnectionFailure(error: unknown, generation: number): void {
    if (!this.isConnected || generation !== this.#connectionGeneration) return;
    this.connectionFailure = describeConnectionFailure(error);
  }

  async #continueConnection(): Promise<void> {
    if (this.connectionChecking) return;
    const generation = ++this.#connectionGeneration;
    this.connectionChecking = true;
    this.connectionFailure = undefined;
    try {
      const status = await this.api.getStatus();
      if (!this.isConnected || generation !== this.#connectionGeneration) return;
      this.environment = status.environment;
      this.developmentMode = status.developmentMode === true;
      this.connectionAnswered = true;
      this.screen = "mode";
    } catch (error) {
      this.#recordConnectionFailure(error, generation);
    } finally {
      if (generation === this.#connectionGeneration) this.connectionChecking = false;
    }
  }

  #onPatch(event: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>): void {
    event.stopPropagation();
    const mode = event.detail.patch.mode;
    if (
      mode !== undefined &&
      this.draft.mode !== undefined &&
      mode !== this.draft.mode &&
      (mode === "demo" || this.draft.mode === "demo")
    ) {
      const venue = { ...this.draft.venue, location: { ...this.draft.venue?.location } };
      delete venue.taxId;
      delete venue.legalName;
      delete venue.tillName;
      delete venue.seriesCode;
      delete venue.rectificativeSeriesCode;
      delete venue.location.operationDescription;
      delete venue.location.dayCutover;
      delete venue.location.invoiceLocales;
      this.draft = { ...this.draft, venue };
      delete this.draft.configurationImport;
      this.fiscalTestStatus = undefined;
    }
    this.draft = deepMerge(this.draft, event.detail.patch) as DeepPartial<ProvisionBody>;
  }

  /**
   * Clears each screen's `*Error` message, so a stale refusal or failure does not reappear when the
   * operator later steps back onto its screen; outcomes that are not errors, such as the
   * provisioning message the reset screen's Back returns to, are kept. The refusal routing assigns
   * `this.screen` directly, not through `setup-goto`, so a refusal is not cleared on its way in.
   */
  #onGoto(event: CustomEvent<{ screen: Screen }>): void {
    event.stopPropagation();
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.reviewError = undefined;
    this.connectError = undefined;
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
    this.cloudLiveSince = undefined;
    this.cloudLiveUnknown = false;
    this.configurationError = undefined;
    this.fiscalTestError = undefined;
    this.resetCredentialsRejected = false;
    this.resetInvalidField = undefined;
    this.resetError = undefined;
    this.screen = event.detail.screen;
  }

  /** The venue→`cert`/`review` decision lives in the shell because the shell owns the merged draft. */
  #onAdvance(event: CustomEvent): void {
    event.stopPropagation();
    if (this.screen !== "venue") return;
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.reviewError = undefined;
    this.screen =
      this.draft.mode === "live" &&
      this.draft.venue?.location?.fiscalTerritory === "ES-common" &&
      !this.developmentMode
        ? "cert"
        : "review";
  }

  async #onProvisionRequested(event: CustomEvent): Promise<void> {
    event.stopPropagation();
    this.reviewError = undefined;
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.#clearProvisionOutcome();
    this.screen = "provisioning";
    try {
      await (this.#localeChosen
        ? this.api.provision(assembleBody(this.draft), currentLocale())
        : this.api.provision(assembleBody(this.draft)));
      if (!this.isConnected) return;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      this.#mapProvisionError(error as ApiError);
    }
  }

  /**
   * A venue-data refusal (`provisioning.*`, `fiscal.*`) would fail again on a re-POST of the same
   * data, so it routes back to the venue form rather than offering a retry.
   */
  #mapProvisionError(error: ApiError): void {
    // A network drop rejects with a bare `TypeError`, which carries no `code`.
    const code =
      typeof (error as { code?: unknown }).code === "string" ? error.code : "server.internal";
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
        if (field !== undefined && Object.hasOwn(SERVER_FIELDS, field)) {
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
    this.connectInvalidField = undefined;
    this.connectRequest = undefined;
    this.#clearProvisionOutcome();
    this.screen = "provisioning";
    try {
      const outcome = await this.api.adopt(event.detail.body);
      if (!this.isConnected) return;
      this.breakGlassSecret = outcome.breakGlassSecret;
      this.mirrorJoin = true;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      await this.#mapAdoptError(error as ApiError, event.detail.body);
    }
  }

  async #onRestoreRequested(event: CustomEvent<{ request: RestoreRequestDetail }>): Promise<void> {
    event.stopPropagation();
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
      );
      if (!this.isConnected) return;
      this.restoreRequest = undefined;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      const { code, params } = (error ?? {}) as {
        code?: unknown;
        params?: { lastChangeAt?: unknown };
      };
      this.restoreRequest = request;
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
          typeof code === "string"
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
      if (!this.isConnected) return;
      this.bucketRequest = undefined;
      this.rebuilt = true;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      const { code, params } = (error ?? {}) as {
        code?: unknown;
        params?: Record<string, unknown>;
      };
      this.bucketRequest = request;
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
        this.bucketRestoreError = describeBucketRefusal(code, params);
      }
      this.screen = "restore-bucket";
    }
  }

  async #onCloudRestoreAction(
    event: CustomEvent<{
      action: "start" | "status" | "start-again" | "restore";
      pointId?: string;
      oldBoxGone?: boolean;
    }>,
  ): Promise<void> {
    event.stopPropagation();
    if (this.cloudRecoveryBusy) return;
    this.cloudRecoveryBusy = true;
    this.cloudRecoveryError = undefined;
    try {
      const { action, pointId, oldBoxGone } = event.detail;
      if (action === "restore") {
        if (!pointId || pointId !== this.cloudRecoveryView?.point?.id) throw new Error();
        this.screen = "provisioning";
        await this.api.restoreFromCloud(pointId, oldBoxGone === true);
        if (this.isConnected) this.screen = "done";
      } else {
        const shown = this.cloudRecoveryView?.point?.id;
        this.cloudRecoveryView =
          action === "start"
            ? await this.api.startCloudRecovery()
            : action === "start-again"
              ? await this.api.startCloudRecoveryAgain()
              : await this.api.cloudRecoveryStatus();
        // The server answered the old-server question for the snapshot it was sent, not for another.
        if (this.cloudRecoveryView.point?.id !== shown) {
          this.cloudLiveSince = undefined;
          this.cloudLiveUnknown = false;
        }
      }
    } catch (error) {
      if (this.isConnected) {
        const { code, params } = (error ?? {}) as {
          code?: unknown;
          params?: { lastChangeAt?: unknown };
        };
        if (code === "restore.stream_source_live" && typeof params?.lastChangeAt === "string") {
          this.cloudLiveSince = params.lastChangeAt;
          this.cloudLiveUnknown = false;
        } else if (
          code === "restore.stream_source_live" ||
          code === "restore.stream_source_unchecked"
        ) {
          this.cloudLiveSince = undefined;
          this.cloudLiveUnknown = true;
        } else {
          this.cloudRecoveryError = say(
            (typeof code === "string" ? CLOUD_ERROR_MESSAGES[code] : undefined) ??
              "shell.cloud.unavailable",
          );
        }
        this.screen = "cloud-restore";
      }
    } finally {
      this.cloudRecoveryBusy = false;
    }
  }

  async #onConfigurationRequested(
    event: CustomEvent<{ request: ConfigurationRequestDetail }>,
  ): Promise<void> {
    event.stopPropagation();
    this.configurationError = undefined;
    try {
      const preview = await this.api.stageConfiguration(
        event.detail.request.artifact,
        event.detail.request.passphrase,
      );
      if (!this.isConnected) return;
      const location = Object.fromEntries(
        Object.entries(preview.venue.location).filter(([key]) => key !== "id"),
      ) as ProvisionBody["venue"]["location"];
      this.draft = deepMerge(this.draft, {
        configurationImport: true,
        venue: { ...preview.venue, location },
      }) as DeepPartial<ProvisionBody>;
      this.configurationPreview = preview;
      this.screen = "configuration-preview";
    } catch {
      if (!this.isConnected) return;
      this.configurationError = say("shell.configuration.could_not_open");
      this.screen = "live-source";
    }
  }

  async #onFiscalTestRequested(event: CustomEvent): Promise<void> {
    event.stopPropagation();
    this.fiscalTestRunning = true;
    this.fiscalTestError = undefined;
    try {
      const result = await this.api.runFiscalTest(assembleBody(this.draft));
      if (!this.isConnected) return;
      this.fiscalTestStatus = result.status === "not-applicable" ? "accepted" : result.status;
    } catch {
      if (!this.isConnected) return;
      this.fiscalTestError = say("shell.fiscal_test.could_not_run");
    } finally {
      if (this.isConnected) this.fiscalTestRunning = false;
    }
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
        this.connectError = say(ADOPT_ERROR_MESSAGES[code] ?? "shell.adopt.generic");
      }
      this.connectRequest = body;
      this.screen = "connect";
    }
  }

  /** Every flag the provisioning screen reads, so no answer outlives the request it answered. */
  #clearProvisionOutcome(): void {
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
    this.resetBusy = true;
    this.resetCredentialsRejected = false;
    this.resetInvalidField = undefined;
    this.resetError = undefined;
    try {
      await this.api.resetIncompleteAdopt(event.detail.credential);
      if (!this.isConnected) return;
      this.resetOutcome = { kind: "resetting", message: say("shell.reset.resetting") };
    } catch (error) {
      if (!this.isConnected) return;
      const { code, params } = (error ?? {}) as ApiError;
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
      if (this.isConnected) this.resetBusy = false;
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

  override render(): TemplateResult {
    // Listening on the container lets each screen talk back without the shell knowing which is mounted.
    return html`<main
      @setup-defaults-requested=${(event: CustomEvent) => {
        event.stopPropagation();
        void this.#loadVenueDefaults();
      }}
      @setup-patch=${(e: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>) => this.#onPatch(e)}
      @setup-goto=${(e: CustomEvent<{ screen: Screen }>) => this.#onGoto(e)}
      @setup-advance=${(e: CustomEvent) => this.#onAdvance(e)}
      @provision-requested=${(e: CustomEvent) => void this.#onProvisionRequested(e)}
      @adopt-requested=${(e: CustomEvent<{ body: AdoptBody }>) => void this.#onAdoptRequested(e)}
      @restore-requested=${(e: CustomEvent<{ request: RestoreRequestDetail }>) =>
        void this.#onRestoreRequested(e)}
      @bucket-restore-requested=${(e: CustomEvent<{ request: BucketRestoreRequestDetail }>) =>
        void this.#onBucketRestoreRequested(e)}
      @cloud-restore-action=${(e: CustomEvent<{ action: "start" | "status" | "start-again" | "restore"; pointId?: string; oldBoxGone?: boolean }>) => void this.#onCloudRestoreAction(e)}
      @configuration-requested=${(e: CustomEvent<{ request: ConfigurationRequestDetail }>) =>
        void this.#onConfigurationRequested(e)}
      @fiscal-test-requested=${(e: CustomEvent) => void this.#onFiscalTestRequested(e)}
      @reset-requested=${(e: CustomEvent<{ credential: ResetCredential }>) =>
        void this.#onResetRequested(e)}
    >
      <header>
        <div class="logo" data-test="setup-logo" role="img" aria-label="Waitron">
          ${unsafeHTML(waitronLockup)}
        </div>
      </header>
      ${this.#renderScreen()}
      <setup-language-chooser
        @locale-selected=${(e: CustomEvent<{ code: string }>) => this.#onLocaleSelected(e)}
      ></setup-language-chooser>
    </main>`;
  }

  #renderScreen(): TemplateResult {
    switch (this.screen) {
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
          .errorMessage=${this.restoreError?.()}
          .invalidField=${this.restoreInvalidField}
          .liveSince=${this.restoreLiveSince}
          .liveUnknown=${this.restoreLiveUnknown}
          .request=${this.restoreRequest}
        ></setup-restore-screen>`;
      case "restore-bucket":
        return html`<setup-restore-bucket-screen
          data-test="screen-restore-bucket"
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
          .view=${this.cloudRecoveryView}
          .errorMessage=${this.cloudRecoveryError?.()}
          .busy=${this.cloudRecoveryBusy}
          .liveSince=${this.cloudLiveSince}
          .liveUnknown=${this.cloudLiveUnknown}
        ></setup-cloud-restore-screen>`;
      case "live-source":
        return html`<setup-live-source-screen
          data-test="screen-live-source"
          .errorMessage=${this.configurationError?.()}
        ></setup-live-source-screen>`;
      case "configuration-preview":
        return html`<setup-configuration-preview-screen
          data-test="screen-configuration-preview"
          .preview=${this.configurationPreview}
        ></setup-configuration-preview-screen>`;
      case "fiscal-test":
        return html`<setup-fiscal-test-screen
          data-test="screen-fiscal-test"
          .status=${this.fiscalTestStatus}
          .running=${this.fiscalTestRunning}
          .errorMessage=${this.fiscalTestError?.()}
        ></setup-fiscal-test-screen>`;
      case "mode":
        return html`<setup-mode-screen
          data-test="screen-mode"
          .environment=${this.environment}
          .certificateNote=${!this.connectionAnswered}
        ></setup-mode-screen>`;
      case "connect":
        return html`<setup-connect-screen
          data-test="screen-connect"
          .errorMessage=${this.connectError?.()}
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
          .defaults=${this.venueDefaults}
          .errorMessage=${this.venueError?.()}
          .invalidField=${this.venueInvalidField}
        ></setup-venue-screen>`;
      case "cert":
        return html`<setup-cert-screen
          data-test="screen-cert"
          .draft=${this.draft}
        ></setup-cert-screen>`;
      case "review":
        return html`<setup-review-screen
          data-test="screen-review"
          .draft=${this.draft}
          .errorMessage=${this.reviewError?.()}
        ></setup-review-screen>`;
      case "provisioning":
        return html`<setup-provisioning-screen
          data-test="screen-provisioning"
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
          .mirrorJoin=${this.mirrorJoin}
          .onboardingIntent=${this.draft.mode}
          .rebuilt=${this.rebuilt}
        ></setup-done-screen>`;
      default:
        return html`<setup-mode-screen
          data-test="screen-mode"
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
