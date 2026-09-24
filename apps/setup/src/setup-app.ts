import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "./screens/role-screen.js";
import "./screens/connection-screen.js";
import "./screens/connect-screen.js";
import "./screens/restore-screen.js";
import "./screens/live-source-screen.js";
import "./screens/configuration-preview-screen.js";
import "./screens/fiscal-test-screen.js";
import "./screens/mode-screen.js";
import "./screens/admin-screen.js";
import "./screens/venue-screen.js";
import "./screens/cert-screen.js";
import "./screens/review-screen.js";
import "./screens/provisioning-screen.js";
import "./screens/done-screen.js";
import type {
  AdoptBody,
  ApiError,
  ConfigurationPreview,
  ProvisionBody,
  SetupApi,
  VenueDefaults,
} from "./api/client.js";
import type { ConfigurationRequestDetail, RestoreRequestDetail } from "./events.js";
import { SERVER_FIELDS } from "./server-fields.js";

/** The wizard's screens, shown one at a time from in-memory state, never a URL route. */
export type Screen =
  | "connection"
  | "role"
  | "connect"
  | "restore"
  | "live-source"
  | "configuration-preview"
  | "fiscal-test"
  | "mode"
  | "admin"
  | "venue"
  | "cert"
  | "review"
  | "provisioning"
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

const ADOPT_ERROR_MESSAGES: Record<string, string> = {
  "mirror.bundle_fetch_failed":
    "Couldn't reach the primary server or the login was refused. Check the address and login, then try again.",
  "setup.request_invalid":
    "The server rejected the details. Check the address and login, then try again.",
  "setup.not_ready": "The server isn't ready yet. Wait a moment, then try again.",
};

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
    this.configurationError = undefined;
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
    this.provisionMessage = undefined;
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
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
        this.provisionMessage =
          "This server has saved setup work for a different request. Resume the original setup or contact support.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.already_provisioned":
      case "deployment.already_stamped":
        this.provisionMessage = "This server is already set up.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload to open the till";
        return;
      case "setup.not_ready":
        this.provisionMessage = "The server isn't ready yet. Wait a moment, then try again.";
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
    this.provisionMessage = undefined;
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
    this.screen = "provisioning";
    try {
      const outcome = await this.api.adopt(event.detail.body);
      if (!this.isConnected) return;
      this.breakGlassSecret = outcome.breakGlassSecret;
      this.mirrorJoin = true;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      this.#mapAdoptError(error as ApiError);
    }
  }

  async #onRestoreRequested(event: CustomEvent<{ request: RestoreRequestDetail }>): Promise<void> {
    event.stopPropagation();
    this.restoreError = undefined;
    this.provisionMessage = undefined;
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
    this.screen = "provisioning";
    try {
      const request = event.detail.request;
      await this.api.restore(request.artifact, request.recoveryKey, request.environment);
      if (!this.isConnected) return;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      const code = (error as { code?: unknown }).code;
      this.restoreError =
        typeof code === "string"
          ? `The backup could not be staged. Check the file, key and environment. (${code})`
          : "The backup could not be staged. Check the connection and try again.";
      this.screen = "restore";
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
   * reloading one reopens this wizard. `setup.already_provisioned` is thrown only by the provision
   * path today and is mapped here for parity. Everything else routes back to the connect form, the
   * mirror path's retry surface.
   */
  #mapAdoptError(error: ApiError): void {
    const code =
      typeof (error as { code?: unknown }).code === "string" ? error.code : "server.internal";
    switch (code) {
      case "setup.already_provisioning":
        this.provisionMessage = "Setup is already in progress on this server.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.already_provisioned":
      case "deployment.already_stamped":
        this.provisionMessage = "This server is already set up.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      default:
        this.connectError = ADOPT_ERROR_MESSAGES[code] ?? ADOPT_GENERIC_ERROR;
        this.screen = "connect";
        return;
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
      @configuration-requested=${(e: CustomEvent<{ request: ConfigurationRequestDetail }>) =>
        void this.#onConfigurationRequested(e)}
      @fiscal-test-requested=${(e: CustomEvent) => void this.#onFiscalTestRequested(e)}
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
        ></setup-restore-screen>`;
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
        ></setup-provisioning-screen>`;
      case "done":
        return html`<setup-done-screen
          data-test="screen-done"
          .api=${this.api}
          .breakGlassSecret=${this.breakGlassSecret}
          .mirrorJoin=${this.mirrorJoin}
          .onboardingIntent=${this.draft.mode}
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
