import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// Side-effect imports register the screen custom elements this shell only names as tags below.
import "./screens/role-screen.js";
import "./screens/connect-screen.js";
import "./screens/mode-screen.js";
import "./screens/admin-screen.js";
import "./screens/venue-screen.js";
import "./screens/cert-screen.js";
import "./screens/review-screen.js";
import "./screens/provisioning-screen.js";
import "./screens/done-screen.js";
import type { AdoptBody, ApiError, ProvisionBody, SetupApi } from "./api/client.js";

/**
 * The wizard's screens, shown one at a time (in-memory state, never a URL route — the same
 * `@state`-driven machine `apps/dashboard/src/dashboard-app.ts` runs). The FIRST screen is `role`
 * (primary | mirror), which forks the rest of the flow (spec §8, C2b):
 *
 * - `role` = **primary** → the existing provisioning flow, unchanged: `mode` (demo/live) → `admin`
 *   (first operator) → `venue` (tenant + location + series) → `cert` (AEAT, live ES-common only) →
 *   `review` (confirm + POST) → `provisioning` (in flight) → `done` (restarting). The venue step
 *   routes to `cert` only for a live ES-common venue, otherwise straight to `review`.
 * - `role` = **mirror** → `connect` (connect-to-primary), which reuses the shared `provisioning` /
 *   `done` terminal screens. The `connect` screen itself is built in Task 13; the name is in the
 *   union here so the shell can already route to it.
 */
export type Screen =
  "role" | "connect" | "mode" | "admin" | "venue" | "cert" | "review" | "provisioning" | "done";

/**
 * A recursively-optional view of `T`: every field, at every depth, may be absent — an array is left
 * whole (its element type is not turned partial, so `invoiceLocales` stays `string[]`). The wizard's
 * request-draft accumulates a screen at a time, so at any moment only the fields collected so far are
 * present; the `review` step asserts completeness before {@link SetupApi.provision}.
 */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** A plain (non-array) object — the only thing {@link deepMerge} recurses INTO; everything else the
 * patch replaces wholesale (so an array like `invoiceLocales` is swapped, never element-merged). */
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
 * Turn the accumulated {@link SetupApp.draft} into the full `POST /setup-api/provision` body. Every
 * collecting screen has already client-validated its own fields before contributing them, so by the
 * `review` step the draft is complete and this only NARROWS the `DeepPartial` to a `ProvisionBody`.
 *
 * The one thing it does actively is the `aeatCert` gate, which is a FISCAL guard, not a tidiness one.
 * The cert is included ONLY for a LIVE provision that actually carries a PFX; otherwise the key is
 * DROPPED entirely (never sent as `null` or empty). Gating on `mode` — not just on "a PFX was read" —
 * is load-bearing: an operator can go live → cert (fill the PFX) → Back → mode → switch to Demo →
 * Provision, and the demo path skips the cert screen but the draft still holds the cert. Without the
 * mode gate, `assembleBody` would POST that stale certificate onto a DEMO/preproduction tenant and the
 * server would seal a real AEAT signing certificate into it — unrepairable (CLAUDE.md §5). The server
 * also distinguishes "no certificate" from "malformed" by the key's ABSENCE (`body.aeatCert ===
 * undefined ? … : parseCert(...)`, `apps/server/src/setup-api.ts`) and answers a live ES-common venue
 * with no cert `setup.aeat_cert_required` (which the shell routes back to `cert`).
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

/**
 * Plain-English messages for the venue-data refusals `planVenue` (and the fiscal modules) throw
 * (`packages/provisioning/src/venue-plan.ts`). The server's error boundary PROPAGATES these codes at
 * HTTP 400 unchanged (`apps/server/src/error-boundary.ts`), so they reach the wizard verbatim and the
 * shell routes them BACK to the `venue` form to be corrected. Any other `provisioning.*`/`fiscal.*`
 * code falls back to a generic message that names the code (see {@link SetupApp.#mapProvisionError}).
 */
const VENUE_ERROR_MESSAGES: Record<string, string> = {
  "provisioning.territory_country_mismatch": "The country must match the fiscal territory.",
  "provisioning.invalid_locales": "Choose 1 or 2 invoice locales.",
  "provisioning.duplicate_series_code":
    "The series code and rectificative series code must differ.",
  "fiscal.regime_not_implemented": "That fiscal territory isn't supported yet.",
};

/**
 * Plain-English messages for the adopt failures the shell routes BACK to the `connect` screen (C2b).
 * `mirror.bundle_fetch_failed` is the mirror's own 502 when it can't reach or authenticate to the
 * primary; `setup.request_invalid` is the shared per-field guard; `setup.not_ready` is the deps gate.
 * Every other code — `server.internal`, an unrecognised code, or a code-LESS rejection (a network
 * drop mid-adopt) — falls back to the generic message (see {@link SetupApp.#mapAdoptError}). The two
 * fiscal double-setup 409s are NOT here: they are TERMINAL and route to the `provisioning` screen's
 * reload action instead, never back to the retryable form.
 */
const ADOPT_ERROR_MESSAGES: Record<string, string> = {
  "mirror.bundle_fetch_failed":
    "Couldn't reach the primary box or the login was refused. Check the address and login, then try again.",
  "setup.request_invalid":
    "The box rejected the details. Check the address and login, then try again.",
  "setup.not_ready": "The box isn't ready yet. Wait a moment, then try again.",
};

/** The generic connect-form banner for a code the map above doesn't name (or a code-less rejection). */
const ADOPT_GENERIC_ERROR =
  "Couldn't connect to the primary. Check the address and login, then try again.";

/**
 * The setup wizard's ROOT element — the shell that turns the screens into a working app, mirroring
 * `apps/dashboard/src/dashboard-app.ts`.
 *
 * It owns the two things the whole flow shares: the injected {@link SetupApi}, and the accumulated
 * request {@link SetupApp.draft} that each screen contributes a slice of (via a bubbling `setup-patch`
 * event the shell deep-merges) and the `review` step finally POSTs. Most nav is a plain `setup-goto`
 * event that flips {@link SetupApp.screen} — no server call, no history entry. The one CONDITIONAL
 * transition, venue→`cert`/`review`, is a screen-agnostic `setup-advance` the shell resolves against
 * the merged draft ({@link SetupApp.#onAdvance}), so the venue screen need not read `mode` to route.
 *
 * On boot it reads `GET /setup-api/status` ({@link SetupApp.#boot}) to learn the box's `environment`,
 * so the wizard can warn before provisioning a real `production` venue. That read is fully wrapped: a
 * failure must never stop the shell from rendering (the `apps/till` `#boot` unhandled-rejection
 * defect, `docs/backlog.md`), so the wizard simply comes up with no environment known.
 */
@customElement("setup-app")
export class SetupApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .wizard {
        padding: var(--wt-space-4);
      }
    `,
  ];

  /** The HTTP face of the setup box. `main.ts` injects a real same-origin client; a test injects a
   * stub. Assigned as a property (`attribute: false`) — a `SetupApi` cannot travel through an
   * attribute string. */
  @property({ attribute: false }) api!: SetupApi;

  /** Which screen is showing. Defaults to `role`, the wizard's first step (primary | mirror). */
  @state() private screen: Screen = "role";

  /**
   * The box's stamped deployment environment, read from `GET /setup-api/status` on boot. `undefined`
   * until the read resolves (and if it fails) — the `mode`/`review` screens read it to warn loudly
   * before provisioning a real `production` venue.
   */
  @state() private environment?: "production" | "preproduction";

  /**
   * The accumulated provision request, built up a screen at a time. Seeded with the defaults every
   * ES deli shares — country `ES`, the ES-common fiscal territory, the Madrid time zone, and an es-ES
   * invoice locale — so a screen only has to collect what differs. A `DeepPartial` because most
   * fields are still absent until their screen is filled in; the `review` step validates completeness
   * before narrowing it to a full {@link ProvisionBody}.
   */
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

  /**
   * A `setup.request_invalid` the server threw at provision time, routed back to the `review` screen
   * as a banner naming the offending field. `undefined` normally; cleared before every new POST.
   */
  @state() private reviewError?: string;

  /**
   * A venue-data validation code the server threw at provision time (a `planVenue` / fiscal-module
   * refusal, `provisioning.*` / `fiscal.*`), routed back to the `venue` screen as a banner so the
   * operator can correct the offending detail. `undefined` normally; cleared before every new POST.
   */
  @state() private venueError?: string;

  /**
   * An adopt failure the server threw at connect time (C2b), routed back to the `connect` screen as a
   * banner so the operator can correct the primary address / admin login and re-submit. `undefined`
   * normally; cleared before every new adopt POST. The mirror path's analogue of `venueError`.
   */
  @state() private connectError?: string;

  /**
   * The mapped failure message shown ON the `provisioning` screen for the codes that stay there (the
   * two fiscal 409s, `already_provisioning`, `not_ready`, `provision_failed`). `undefined` while a
   * POST is in flight (the screen then shows the in-flight state) or before one is attempted.
   */
  @state() private provisionMessage?: string;

  /** Whether {@link SetupApp.provisionMessage} may be retried — never for the fiscal double-provision
   * refusals (re-POSTing an already-set-up box is meaningless and unrecoverable, CLAUDE.md §5). */
  @state() private provisionCanRetry = false;

  /**
   * The label for a reload action offered ON a TERMINAL provisioning failure — the box is already set
   * up (`already_provisioned` / `deployment.already_stamped` → "Reload to open the till", since the
   * provisioned box serves the till) or a provision is already running elsewhere (`already_provisioning`
   * → "Reload"). `undefined` for the in-flight and retryable states, which carry no reload (a retryable
   * failure keeps its `Try again`, never a reload). Mutually exclusive with {@link
   * SetupApp.provisionCanRetry}: a terminal 409 sets this and clears retry.
   */
  @state() private provisionReloadLabel?: string;

  override firstUpdated(): void {
    void this.#boot();
  }

  /**
   * Read the box's environment so the wizard can warn before a real production filing. Fully wrapped:
   * a failed/unreachable status read must not stop the shell rendering — the wizard comes up with no
   * environment known and the operator can still proceed (the `apps/till` `#boot` follow-up,
   * `docs/backlog.md`). The `isConnected` guard keeps a teardown mid-fetch from writing state onto a
   * detached element.
   */
  async #boot(): Promise<void> {
    try {
      const status = await this.api.getStatus();
      if (!this.isConnected) return;
      this.environment = status.environment;
    } catch {
      // Leave `environment` undefined — a failed status read is never a reason to block setup.
    }
  }

  /**
   * Merge a screen's emitted slice of the request into {@link SetupApp.draft}. `stopPropagation` keeps
   * the composed, bubbling `setup-patch` inside the shell (the house pattern — the shell is its final
   * consumer, so it must not leak past the shadow boundary).
   */
  #onPatch(event: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>): void {
    event.stopPropagation();
    this.draft = deepMerge(this.draft, event.detail.patch) as DeepPartial<ProvisionBody>;
  }

  /**
   * Resolve the first `role` screen's choice (spec §8, C2b). The role→next-screen conditional lives
   * HERE, in the shell, not in the role screen — the same altitude fix (m) that lifted venue→`cert`/
   * `review` out of a screen (backlog #149). A **primary** enters the existing provisioning flow at
   * `mode` (unchanged); a **mirror** goes to the connect-to-primary screen, which skips
   * `mode`/`admin`/`venue`/`cert`/`review` entirely (a mirror has no demo/live choice, seeds no
   * admin, and files nothing). Same boundary `stopPropagation` as {@link SetupApp.#onPatch}.
   */
  #onRole(event: CustomEvent<{ role: "primary" | "mirror" }>): void {
    event.stopPropagation();
    // A fresh role choice starts a clean flow — drop any stale adopt banner from an earlier attempt so
    // re-entering the connect screen doesn't show a rejection the operator has since navigated away from.
    this.connectError = undefined;
    this.screen = event.detail.role === "mirror" ? "connect" : "mode";
  }

  /**
   * Advance (or step back) to another screen — a plain local state change, no server call. Same
   * boundary `stopPropagation` as {@link SetupApp.#onPatch}.
   *
   * A user-initiated navigation clears any routed-back server banner (`venueError` / `reviewError`), so
   * a stale rejection message does not reappear when the operator later steps back onto that screen
   * after already correcting and advancing past it. This is safe because {@link
   * SetupApp.#mapProvisionError} routes by assigning `this.screen` DIRECTLY (never via a `setup-goto`
   * event), so its own error-showing routing does not pass through here and is not cleared.
   */
  #onGoto(event: CustomEvent<{ screen: Screen }>): void {
    event.stopPropagation();
    this.venueError = undefined;
    this.reviewError = undefined;
    this.connectError = undefined;
    this.screen = event.detail.screen;
  }

  /**
   * Resolve a screen-agnostic `setup-advance` (only the venue screen emits it today) against the merged
   * {@link SetupApp.draft}. The venue→`cert`/`review` decision lives HERE, not in the venue screen: the
   * shell owns the draft, so it — mirroring `apps/dashboard/src/dashboard-app.ts`'s conditional routing
   * — is where the conditional belongs. A live ES-common venue still needs the AEAT certificate
   * (`cert`); every other case (demo, or a non-ES-common territory) goes straight to `review`.
   *
   * Same boundary `stopPropagation` and stale-banner clear as {@link SetupApp.#onGoto}: advancing off
   * the venue form is a user-initiated navigation, so a routed-back `venueError` must not linger.
   * Guarded on `screen === "venue"` so a stray advance from anywhere else is inert.
   */
  #onAdvance(event: CustomEvent): void {
    event.stopPropagation();
    if (this.screen !== "venue") return;
    this.venueError = undefined;
    this.reviewError = undefined;
    this.screen =
      this.draft.mode === "live" && this.draft.venue?.location?.fiscalTerritory === "ES-common"
        ? "cert"
        : "review";
  }

  /**
   * Fire the provision — the review screen's `Provision`, and the provisioning screen's `Try again`,
   * both reach here through the shared composed `provision-requested`. Client validation already ran
   * on every collecting screen, so this assembles the body and POSTs it. Success takes the box down
   * for its restart, so `done` (not this screen) is where reconnection happens; a failure is mapped by
   * {@link SetupApp.#mapProvisionError} onto a message here or a route back to the owning step.
   *
   * The `isConnected` guards stop a teardown mid-request writing state onto a detached element, the
   * same discipline as {@link SetupApp.#boot}.
   */
  async #onProvisionRequested(event: CustomEvent): Promise<void> {
    event.stopPropagation();
    this.reviewError = undefined;
    this.venueError = undefined;
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
   * Map a rejected provision to the wizard's next state. Every code the provision route can surface
   * (map §4b, verified against `apps/server/src/setup-api.ts` + `error-boundary.ts` +
   * `packages/provisioning/src/venue-plan.ts`) is handled; a rejection carrying NO string `code` (a
   * bare `TypeError`/`SyntaxError` out of `#request` — see the coercion below) is treated as the
   * generic crash and routes to the retryable default too.
   *
   * - Any `provisioning.*` / `fiscal.*` code → a `planVenue` / fiscal-module refusal about the venue
   *   DATA, propagated at 400 by the error boundary (it does NOT rewrite the code —
   *   `setup.provision_failed` is only that boundary's log tag, never a wire code). Re-POSTing the same
   *   data would just fail again, so route BACK to the `venue` form with a banner; the fix is editing,
   *   not retrying in place.
   * - `setup.request_invalid` → back to `review` with a banner naming `params.field` (the field's own
   *   screen already validates the same rule, so this is a belt-and-suspenders path).
   * - `setup.aeat_cert_required` → back to `cert` to add the certificate.
   * - `setup.already_provisioning` → an in-progress notice, no retry (a concurrent provision is
   *   running); offers a plain "Reload" so the operator isn't stranded on a dead-end alert.
   * - `setup.already_provisioned` / `deployment.already_stamped` → "already set up", NO retry: these
   *   are the fiscal double-provision refusals and re-POSTing is unrecoverable (CLAUDE.md §5). Offers a
   *   "Reload to open the till" action instead, since the provisioned box serves the till.
   * - `setup.not_ready` → not-ready notice, retryable.
   * - `server.internal` (the real generic-crash code) and any unrecognised code → a generic failure,
   *   retryable in place.
   */
  #mapProvisionError(error: ApiError): void {
    // A rejection without a string `code` is real and reachable: `#request` has no try/catch, so a
    // network drop mid-provision rejects with a bare `TypeError` and a non-JSON error body (e.g. the
    // dev proxy's 502 HTML) rejects with a `SyntaxError` from `res.json()` — neither carries a `.code`.
    // Coerce those to the generic bucket so they route to the retryable default rather than throwing on
    // `undefined.startsWith` and escaping as an unhandled rejection that strands the operator on
    // "Provisioning…". A re-POST is safe: it either succeeds or returns the 409 already_provisioned.
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
        this.reviewError =
          field === undefined
            ? "The box rejected the details. Check your entries, then provision again."
            : `The box rejected the details (field: ${field}). Check your entries, then provision again.`;
        this.screen = "review";
        return;
      }
      case "setup.aeat_cert_required":
        this.screen = "cert";
        return;
      case "setup.already_provisioning":
        this.provisionMessage = "Setup is already in progress on this box.";
        this.provisionCanRetry = false;
        // A provision is running elsewhere — no re-POST, but a reload re-reads status so the operator
        // isn't stranded on a dead-end alert.
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.already_provisioned":
      case "deployment.already_stamped":
        this.provisionMessage = "This box is already set up.";
        this.provisionCanRetry = false;
        // The box is provisioned and serves the till at the origin root — reloading opens it.
        this.provisionReloadLabel = "Reload to open the till";
        return;
      case "setup.not_ready":
        this.provisionMessage = "The box isn't ready yet. Wait a moment, then try again.";
        this.provisionCanRetry = true;
        return;
      default:
        this.provisionMessage = "Provisioning failed. You can try again.";
        this.provisionCanRetry = true;
        return;
    }
  }

  /**
   * Fire the mirror-path adopt (C2b Task 13) — the connect screen's `Connect` reaches here through the
   * composed `adopt-requested`, which CARRIES the assembled {@link AdoptBody} in its detail (unlike
   * `provision-requested`, which the shell assembles from its draft). The credential is forwarded
   * VERBATIM to `SetupApi.adopt` — the structured `{ personId, password, totp? }` object, never
   * re-shaped and never persisted to the shell's draft (a mirror files nothing; the password is not
   * kept). Success takes the box down for its restart into mirror mode, so `done` is where the reload
   * happens; a failure is mapped by {@link SetupApp.#mapAdoptError}.
   *
   * The `isConnected` guards mirror {@link SetupApp.#onProvisionRequested}: a teardown mid-request must
   * not write state onto a detached element.
   */
  async #onAdoptRequested(event: CustomEvent<{ body: AdoptBody }>): Promise<void> {
    event.stopPropagation();
    this.connectError = undefined;
    this.provisionMessage = undefined;
    this.provisionCanRetry = false;
    this.provisionReloadLabel = undefined;
    this.screen = "provisioning";
    try {
      await this.api.adopt(event.detail.body);
      if (!this.isConnected) return;
      this.screen = "done";
    } catch (error) {
      if (!this.isConnected) return;
      this.#mapAdoptError(error as ApiError);
    }
  }

  /**
   * Map a rejected adopt to the wizard's next state (C2b). Two shapes:
   *
   * - The double-setup 409s (`setup.already_provisioned` / `deployment.already_stamped`) and the
   *   concurrent-setup 409 (`setup.already_provisioning`) are TERMINAL — re-submitting is meaningless
   *   or unrecoverable (CLAUDE.md §5), so they land on the `provisioning` screen with a reload action
   *   and NO retry, exactly as {@link SetupApp.#mapProvisionError} does. The reload for an
   *   already-set-up mirror opens the read-only DASHBOARD (a mirror serves no till). Of the three,
   *   only two are reachable from an adopt today: `deployment.already_stamped` (the adopt path stamps
   *   the environment — `adoptFromPrimary` → `stampDeployment`, `apps/server/src/adopt.ts`) and
   *   `setup.already_provisioning` (the shared concurrent-setup guard). `setup.already_provisioned` is
   *   thrown ONLY by `provisionVenue` (`apps/server/src/provision.ts:72`), which the adopt path never
   *   calls (`adoptFromPrimary` → `adoptVenue`, which never throws it — grepped 2026-08-29); its case
   *   below is DEFENSIVE parity with `#mapProvisionError`, not a live adopt outcome, and is kept so a
   *   future adopt throw of it maps sensibly rather than falling through to the generic banner.
   * - Everything else — `mirror.bundle_fetch_failed`, `setup.request_invalid`, `setup.not_ready`,
   *   `server.internal`, an unrecognised code, and a code-LESS rejection (a bare `TypeError`/
   *   `SyntaxError` out of `#request` on a network drop or non-JSON body) — routes BACK to the
   *   `connect` form with a banner. The connect form (not the `provisioning` screen, whose retry fires
   *   `provision-requested`) is the mirror path's retry surface, so a corrected re-submit re-fires
   *   `adopt-requested`. The code-less coercion mirrors `#mapProvisionError`: without it `code.startsWith`
   *   would throw on `undefined` and strand the operator (proven by deletion in the shell test).
   */
  #mapAdoptError(error: ApiError): void {
    const code =
      typeof (error as { code?: unknown }).code === "string" ? error.code : "server.internal";
    switch (code) {
      case "setup.already_provisioning":
        this.provisionMessage = "Setup is already in progress on this box.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload";
        return;
      case "setup.already_provisioned":
      case "deployment.already_stamped":
        this.provisionMessage = "This box is already set up.";
        this.provisionCanRetry = false;
        this.provisionReloadLabel = "Reload to open the dashboard";
        return;
      default:
        this.connectError = ADOPT_ERROR_MESSAGES[code] ?? ADOPT_GENERIC_ERROR;
        this.screen = "connect";
        return;
    }
  }

  override render(): TemplateResult {
    // The screens emit these composed events UP to the shell: `setup-role` (the first screen's
    // primary/mirror choice, routed here), `setup-patch` (merge a slice into the draft), `setup-goto`
    // (flip the visible screen), `setup-advance` (the venue screen's conditional next-step, resolved
    // here against the draft), and `provision-requested` (review's Provision and the provisioning
    // screen's retry both fire it). Wiring them on the container means each screen talks back without
    // the shell knowing which one is mounted.
    return html`<div
      class="wizard"
      @setup-role=${(e: CustomEvent<{ role: "primary" | "mirror" }>) => this.#onRole(e)}
      @setup-patch=${(e: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>) => this.#onPatch(e)}
      @setup-goto=${(e: CustomEvent<{ screen: Screen }>) => this.#onGoto(e)}
      @setup-advance=${(e: CustomEvent) => this.#onAdvance(e)}
      @provision-requested=${(e: CustomEvent) => void this.#onProvisionRequested(e)}
      @adopt-requested=${(e: CustomEvent<{ body: AdoptBody }>) => void this.#onAdoptRequested(e)}
    >
      ${this.#renderScreen()}
    </div>`;
  }

  /**
   * The mounted screen for the current {@link SetupApp.screen} — each real screen carries the
   * `data-test="screen-*"` hook on its own host so the shell's screen-switching tests stay uniform.
   * The `role` screen (the wizard's first step) is the `default`.
   *
   * `role` forks the flow (primary → `mode`, mirror → `connect`); `mode` reads `environment` (to warn
   * on a production box); `admin`, `venue`, `cert` and `review` read the accumulated `draft` (to seed
   * their fields / summarise it, so stepping Back is non-destructive); `venue` and `review` also take a
   * routed-back server error (`venueError` / `reviewError`); `provisioning` takes the mapped message +
   * retry flag + terminal reload label; `done` takes the `api` to poll during the restart. All are
   * passed as properties, since neither an api nor a draft object can travel as an attribute.
   */
  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "mode":
        return html`<setup-mode-screen
          data-test="screen-mode"
          .environment=${this.environment}
        ></setup-mode-screen>`;
      case "connect":
        // The mirror path's connect-to-primary form (C2b Task 13). It carries the assembled adopt body
        // up in `adopt-requested`; the shell routes a failed adopt back here via `connectError`.
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
          .errorMessage=${this.venueError}
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
        ></setup-done-screen>`;
      default:
        return html`<setup-role-screen data-test="screen-role"></setup-role-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-app": SetupApp;
  }
}
