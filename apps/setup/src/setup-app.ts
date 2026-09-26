import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
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
import type { RestoredVenue } from "./screens/restore-bucket-screen.js";
import type { ResetScreenOutcome } from "./screens/reset-screen.js";
import { SERVER_FIELDS } from "./server-fields.js";

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

const VENUE_ERROR_MESSAGES: Record<string, string> = {
  "provisioning.territory_country_mismatch": "The country must match the fiscal territory.",
  "provisioning.invalid_locales": "Choose 1 or 2 invoice locales.",
  "provisioning.duplicate_series_code":
    "The series code and rectificative series code must differ.",
  "fiscal.regime_not_implemented": "That fiscal territory isn't supported yet.",
};

const NOT_READY_MESSAGE = "The server isn't ready yet. Wait a moment, then try again.";

const ADOPT_ERROR_MESSAGES: Record<string, string> = {
  "mirror.bundle_fetch_failed":
    "Couldn't reach the primary server or the login was refused. Check the address and login, then try again.",
  "setup.request_invalid":
    "The server rejected the details. Check the address and login, then try again.",
  "setup.not_ready": NOT_READY_MESSAGE,
};

const OPERATION_CONFLICT_MESSAGE =
  "This server has saved setup work for a different request. Resume the original setup or contact support.";
const ALREADY_STAMPED_MESSAGE =
  "A previous setup attempt left this server partly set up, for a different environment. Contact support to reset this server, then start setup again.";
const ADOPT_INCOMPLETE_MESSAGE =
  "A previous attempt to join this server to a restaurant stopped partway and left it partly set up. It cannot be finished. You can reset this server with the admin person ID and password you used to connect it, then start setup again.";

const RESET_ERROR_MESSAGES: Record<string, string> = {
  "setup.request_invalid":
    "The server rejected the details. Check the admin person ID and password, then try again.",
  "setup.not_ready": NOT_READY_MESSAGE,
};

const RESET_GENERIC_ERROR = "The server could not be reset. Check the connection and try again.";

function describeThrottle(params: Record<string, unknown> | undefined): string {
  const seconds = params?.retryAfterSeconds;
  if (typeof seconds !== "number") return "Too many attempts. Wait a few minutes, then try again.";
  return `Too many attempts. Wait ${seconds} ${seconds === 1 ? "second" : "seconds"}, then try again.`;
}

const KIT_DAMAGED =
  "This recovery kit is incomplete or damaged, perhaps cut short when it was copied. Upload the kit file as it was saved, or paste the whole kit.";
const KEY_DOES_NOT_OPEN =
  "The recovery key in this kit does not open the latest copy. If the recovery key was changed, use the newest kit.";
const NEWER_SOFTWARE =
  "The copy in the bucket was made by newer Waitron software than this server has. Update this server, then try again.";

/** The owner's words for each refusal a rebuild from the bucket can meet whose params add nothing. */
const BUCKET_ERROR_MESSAGES: Record<string, string> = {
  "backup.stream_kit_invalid":
    "This is not a Waitron recovery kit. Upload the kit file, or paste the whole kit.",
  "restore.stream_pointer_missing": "The bucket in this kit holds no copy of this restaurant.",
  "restore.stream_pointer_unverified":
    "The copy in the bucket was not written by the server this kit belongs to. Check that the kit is this restaurant's newest. Nothing was changed.",
  "backup.stream_pointer_invalid":
    "The bucket's record of its newest copy is damaged, so it cannot be rebuilt from. Nothing was changed.",
  "restore.stream_integrity_failed":
    "The copy read from the bucket is damaged. Nothing on this server was changed.",
  "restore.stream_state_missing":
    "The copy in the bucket does not hold the old server's locked settings, so it cannot be rebuilt from.",
  // One sentence for all three, as the command line gives (`DECRYPT_PHASE_CODES`,
  // apps/server/src/restore-command.ts).
  "recovery.passphrase_invalid": KEY_DOES_NOT_OPEN,
  "backup.artifact_invalid": KEY_DOES_NOT_OPEN,
  "backup.archive_invalid": KEY_DOES_NOT_OPEN,
  "backup.stream_restore_failed":
    "The copy could not be downloaded from the bucket. Check this server's internet connection and that the bucket still exists, then try again.",
  "backup.stream_request_failed":
    "The bucket did not answer, or refused the key in this kit. Check this server's internet connection and that the bucket and its key still exist, then try again.",
  "restore.stream_disk_full":
    "This server's disk filled while the copy was downloading. Nothing on this server was changed. Free some space and try again.",
  "restore.environment_mismatch":
    "The copy comes from the other environment. Choose the environment it came from.",
  "provisioning.database_ahead": NEWER_SOFTWARE,
  "restore.schema_too_new": NEWER_SOFTWARE,
  "setup.already_provisioning":
    "Setup is already in progress on this server. Wait for it to finish, then reload this page.",
  "setup.not_ready": NOT_READY_MESSAGE,
  "setup.operation_conflict": OPERATION_CONFLICT_MESSAGE,
  "setup.request_invalid":
    "The server rejected the details. Check the kit and the environment, then try again.",
};

const CLOUD_NEWER_SOFTWARE =
  "This snapshot was made by newer Waitron software than this server has. Update this server, then try again.";
const CLOUD_UNOPENABLE =
  "This snapshot could not be opened. It is damaged, or the recovery key Waitron Cloud holds for it does not open it.";

/**
 * Cloud restore refusals that pressing Restore again cannot fix. The recovery key comes from the
 * Cloud grant, not from the owner, and the environment is always preproduction
 * (`createCloudRecoveryClient`, apps/server/src/cloud-recovery.ts), so the owner can correct
 * neither here.
 */
const CLOUD_ERROR_MESSAGES: Record<string, string> = {
  "restore.schema_too_new": CLOUD_NEWER_SOFTWARE,
  "recovery.passphrase_invalid": CLOUD_UNOPENABLE,
  "backup.artifact_invalid": CLOUD_UNOPENABLE,
  "backup.archive_invalid": CLOUD_UNOPENABLE,
  "restore.environment_mismatch":
    "This snapshot is not from a preparation or demo venue, and Cloud recovery restores only those.",
};

/** The sentence for a bucket refusal the screen does not answer with a question of its own. */
function describeBucketRefusal(code: unknown, params: Record<string, unknown> | undefined): string {
  if (typeof code !== "string")
    return "The copy could not be restored. Check the connection and try again.";
  if (
    code === "backup.stream_kit_invalid" &&
    (params?.reason === "encoding" || params?.reason === "shape")
  )
    return KIT_DAMAGED;
  if (code === "restore.stream_pointer_unverified" && params?.reason === "venue_mismatch")
    return "The bucket's record of its newest copy names a different restaurant from this kit. Nothing was changed.";
  if (code === "restore.stream_venue_unconfirmed")
    return "The copy in the bucket names no business tax id, so it cannot be confirmed or restored.";
  return BUCKET_ERROR_MESSAGES[code] ?? `The copy could not be restored. (${code})`;
}

/** The restored copy's names, when the refusal carries all three and a tax id to confirm. */
function venueToConfirm(params: Record<string, unknown> | undefined): RestoredVenue | undefined {
  const { legalName, taxId, locationName } = params ?? {};
  if (typeof legalName !== "string" || typeof taxId !== "string") return undefined;
  if (typeof locationName !== "string" || taxId === "") return undefined;
  return { legalName, taxId, locationName };
}

const ADOPT_GENERIC_ERROR =
  "Couldn't connect to the primary. Check the address and login, then try again.";

/** Held as one value because the message and whether to offer a retry answer the same check. */
interface ConnectionFailure {
  message: string;
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
  if (status === 404)
    return { message: "This server is already set up. Reload to open it.", canRetry: false };
  if (status !== undefined)
    return { message: "This server reported a problem. Try again in a moment.", canRetry: true };
  return {
    message: "We could not reach the server. Check its power and your network connection.",
    canRetry: true,
  };
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
    `,
  ];

  @property({ attribute: false }) api!: SetupApi;

  /** Certificate setup precedes collecting credentials and business details. */
  @state() private screen: Screen = "connection";
  /** Cleared while a fresh check is in flight, so an answer never outlives the check it answered. */
  @state() private connectionFailure?: ConnectionFailure;
  @state() private connectionChecking = false;
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

  @state() private reviewError?: string;

  @state() private venueError?: string;

  /**
   * Cleared everywhere {@link SetupApp.venueError} is: a mark surviving into the next attempt would
   * leave a field red on a value the operator has already corrected.
   */
  @state() private venueInvalidField?: string;

  @state() private connectError?: string;
  @state() private restoreError?: string;
  /** Set from `restore.stream_source_live`/`restore.stream_source_unchecked` on the archive path. */
  @state() private restoreLiveSince?: string;
  @state() private restoreLiveUnknown = false;
  /** Handed back to the archive screen with a refusal, so the owner's entries are kept. */
  @state() private restoreRequest?: RestoreRequestDetail;
  @state() private bucketRestoreError?: string;
  @state() private bucketLiveSince?: string;
  @state() private bucketLiveUnknown = false;
  @state() private bucketVenue?: RestoredVenue;
  /** Held only in this tab's memory: the kit inside it is as sensitive as the recovery key. */
  @state() private bucketRequest?: BucketRestoreRequestDetail;
  /** Kept apart from the other outcomes because the done screen's copy depends on which path ran. */
  @state() private rebuilt = false;
  @state() private cloudRecoveryView?: CloudRecoveryView;
  @state() private cloudRecoveryError?: string;
  @state() private cloudRecoveryBusy = false;
  /** Set from `restore.stream_source_live`/`restore.stream_source_unchecked` on the Cloud path. */
  @state() private cloudLiveSince?: string;
  @state() private cloudLiveUnknown = false;
  @state() private configurationError?: string;
  @state() private configurationPreview?: ConfigurationPreview;
  @state() private fiscalTestStatus?: "accepted" | "rejected" | "uncertain";
  @state() private fiscalTestRunning = false;
  @state() private fiscalTestError?: string;

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
  @state() private provisionMessage?: string;

  @state() private provisionCanRetry = false;

  /** Set only on a terminal failure, which also clears {@link SetupApp.provisionCanRetry}. */
  @state() private provisionReloadLabel?: string;

  /** Set only for an adopt that stopped partway, the one state the reset screen can clear. */
  @state() private provisionCanReset = false;

  @state() private resetBusy = false;
  @state() private resetCredentialsRejected = false;
  @state() private resetError?: string;
  @state() private resetOutcome?: ResetScreenOutcome;

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
   * Clears the routed-back banners assigned below (not `fiscalTestError`), so a stale refusal does
   * not reappear when the operator later steps back onto its screen. The refusal routing assigns
   * `this.screen` directly, not through `setup-goto`, so a banner is not cleared on its way in.
   */
  #onGoto(event: CustomEvent<{ screen: Screen }>): void {
    event.stopPropagation();
    this.venueError = undefined;
    this.venueInvalidField = undefined;
    this.reviewError = undefined;
    this.connectError = undefined;
    this.restoreError = undefined;
    // An answer belongs to the copy it was given for; leaving the screen may mean another kit or file.
    this.restoreLiveSince = undefined;
    this.restoreLiveUnknown = false;
    this.restoreRequest = undefined;
    this.bucketRestoreError = undefined;
    this.bucketLiveSince = undefined;
    this.bucketLiveUnknown = false;
    this.bucketVenue = undefined;
    this.bucketRequest = undefined;
    this.cloudLiveSince = undefined;
    this.cloudLiveUnknown = false;
    this.configurationError = undefined;
    this.resetCredentialsRejected = false;
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
      await this.api.provision(assembleBody(this.draft));
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
      this.venueError =
        VENUE_ERROR_MESSAGES[code] ??
        `The venue details were rejected — please review and correct them. (${code})`;
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
            ? "The server rejected the details. Check your entries, then provision again."
            : `The server rejected the details (field: ${field}). Check your entries, then provision again.`;
        this.screen = "review";
        return;
      }
      case "person.email_invalid":
        this.reviewError = "The admin email address is invalid. Check it, then provision again.";
        this.screen = "review";
        return;
      case "setup.provisioning_secret_required":
        this.screen = "cert";
        return;
      case "setup.fiscal_test_required":
        this.fiscalTestStatus = undefined;
        this.fiscalTestError = "Run an accepted fiscal test before activating production.";
        this.screen = "fiscal-test";
        return;
      case "setup.already_provisioning":
        this.provisionMessage = "Setup is already in progress on this server.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.operation_conflict":
        this.provisionMessage = OPERATION_CONFLICT_MESSAGE;
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.already_provisioned":
        this.provisionMessage = "This server is already set up.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload to open the till";
        return;
      case "deployment.already_stamped":
        this.provisionMessage = ALREADY_STAMPED_MESSAGE;
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.not_ready":
        this.provisionMessage = NOT_READY_MESSAGE;
        this.provisionCanRetry = true;
        return;
      default:
        this.provisionMessage =
          "Provisioning failed. Check that the server is on and your device is connected to its network, then try again. If you see a certificate warning, use the certificate help below.";
        this.provisionCanRetry = true;
        return;
    }
  }

  /**
   * The adopt body goes straight to `SetupApi.adopt` and never into the draft, so the password is not
   * kept. A successful adopt leaves the box adoption-pending, not a working mirror: the
   * `PendingAdoption` header in `apps/server/src/finish-adoption.ts` says why.
   */
  async #onAdoptRequested(event: CustomEvent<{ body: AdoptBody }>): Promise<void> {
    event.stopPropagation();
    this.connectError = undefined;
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
      await this.#mapAdoptError(error as ApiError);
    }
  }

  async #onRestoreRequested(event: CustomEvent<{ request: RestoreRequestDetail }>): Promise<void> {
    event.stopPropagation();
    this.restoreError = undefined;
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
        this.restoreError =
          typeof code === "string"
            ? `The backup could not be staged. Check the file, key and environment. (${code})`
            : "The backup could not be staged. Check the connection and try again.";
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
          this.cloudRecoveryError =
            (typeof code === "string" ? CLOUD_ERROR_MESSAGES[code] : undefined) ??
            "Cloud recovery is unavailable. Check the connection or request expiry, then try again.";
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
      this.configurationError =
        "The configuration export could not be opened. Check the file and passphrase.";
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
      this.fiscalTestError = "The fiscal test could not run. Check the connection and try again.";
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
  async #mapAdoptError(error: ApiError): Promise<void> {
    const code =
      typeof (error as { code?: unknown }).code === "string" ? error.code : "server.internal";
    switch (code) {
      // Not read against the saved setup: an adopt still running on the server is past "started" too.
      case "setup.already_provisioning":
        this.provisionMessage = "Setup is already in progress on this server.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.already_provisioned":
        this.provisionMessage = "This server is already set up.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "deployment.already_stamped":
        this.provisionMessage = ALREADY_STAMPED_MESSAGE;
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
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
      this.provisionMessage = OPERATION_CONFLICT_MESSAGE;
      this.provisionCanRetry = false;
      this.provisionReloadLabel = "Reload";
    } else {
      this.connectError = ADOPT_ERROR_MESSAGES[code] ?? ADOPT_GENERIC_ERROR;
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
    this.provisionMessage = ADOPT_INCOMPLETE_MESSAGE;
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
    this.provisionCanReset = true;
  }

  /** Like the adopt body, the login goes straight to the API and is never kept. */
  async #onResetRequested(event: CustomEvent<{ credential: ResetCredential }>): Promise<void> {
    event.stopPropagation();
    if (this.resetBusy) return;
    this.resetBusy = true;
    this.resetCredentialsRejected = false;
    this.resetError = undefined;
    try {
      await this.api.resetIncompleteAdopt(event.detail.credential);
      if (!this.isConnected) return;
      this.resetOutcome = {
        kind: "resetting",
        message:
          "The server is resetting and will restart. Wait a minute, then reload this page to start setup again. If joining again says the previous join stopped partway, the reset did not run: contact support.",
      };
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
          this.resetOutcome = {
            kind: "refused",
            message:
              "There is no half-finished join to reset on this server. Reload to start setup again.",
          };
          break;
        case "setup.already_provisioning":
          this.resetOutcome = {
            kind: "refused",
            message: "Setup is already in progress on this server.",
          };
          break;
        case "setup.operation_conflict":
          this.resetOutcome = { kind: "refused", message: OPERATION_CONFLICT_MESSAGE };
          break;
        default:
          this.resetError =
            (typeof code === "string" ? RESET_ERROR_MESSAGES[code] : undefined) ??
            RESET_GENERIC_ERROR;
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
    return html`<wt-modal
      open
      .dismissible=${false}
      aria-label="Set up your server"
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
      ${this.#renderScreen()}
    </wt-modal>`;
  }

  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "connection":
        return html`<setup-connection-screen
          data-test="screen-connection"
          .errorMessage=${this.connectionFailure?.message}
          .checking=${this.connectionChecking}
          .setupUnavailable=${this.connectionFailure?.canRetry === false}
          @connection-continue=${() => void this.#continueConnection()}
        ></setup-connection-screen>`;
      case "role":
        return html`<setup-role-screen data-test="screen-role"></setup-role-screen>`;
      case "restore":
        return html`<setup-restore-screen
          data-test="screen-restore"
          .errorMessage=${this.restoreError}
          .liveSince=${this.restoreLiveSince}
          .liveUnknown=${this.restoreLiveUnknown}
          .request=${this.restoreRequest}
        ></setup-restore-screen>`;
      case "restore-bucket":
        return html`<setup-restore-bucket-screen
          data-test="screen-restore-bucket"
          .errorMessage=${this.bucketRestoreError}
          .liveSince=${this.bucketLiveSince}
          .liveUnknown=${this.bucketLiveUnknown}
          .venue=${this.bucketVenue}
          .request=${this.bucketRequest}
        ></setup-restore-bucket-screen>`;
      case "cloud-restore":
        return html`<setup-cloud-restore-screen
          data-test="screen-cloud-restore"
          .view=${this.cloudRecoveryView}
          .errorMessage=${this.cloudRecoveryError}
          .busy=${this.cloudRecoveryBusy}
          .liveSince=${this.cloudLiveSince}
          .liveUnknown=${this.cloudLiveUnknown}
        ></setup-cloud-restore-screen>`;
      case "live-source":
        return html`<setup-live-source-screen
          data-test="screen-live-source"
          .errorMessage=${this.configurationError}
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
          .errorMessage=${this.fiscalTestError}
        ></setup-fiscal-test-screen>`;
      case "mode":
        return html`<setup-mode-screen
          data-test="screen-mode"
          .environment=${this.environment}
        ></setup-mode-screen>`;
      case "connect":
        return html`<setup-connect-screen
          data-test="screen-connect"
          .errorMessage=${this.connectError}
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
          .errorMessage=${this.venueError}
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
          .errorMessage=${this.reviewError}
        ></setup-review-screen>`;
      case "provisioning":
        return html`<setup-provisioning-screen
          data-test="screen-provisioning"
          .message=${this.provisionMessage}
          .canRetry=${this.provisionCanRetry}
          .reloadLabel=${this.provisionReloadLabel}
          .canReset=${this.provisionCanReset}
        ></setup-provisioning-screen>`;
      case "reset":
        return html`<setup-reset-screen
          data-test="screen-reset"
          .busy=${this.resetBusy}
          .credentialsRejected=${this.resetCredentialsRejected}
          .errorMessage=${this.resetError}
          .outcome=${this.resetOutcome}
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
        ></setup-mode-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-app": SetupApp;
  }
}
