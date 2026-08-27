import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// Side-effect imports register the screen custom elements this shell only names as tags below.
import "./screens/mode-screen.js";
import "./screens/admin-screen.js";
import "./screens/venue-screen.js";
import "./screens/cert-screen.js";
import "./screens/review-screen.js";
import "./screens/provisioning-screen.js";
import "./screens/done-screen.js";
import type { ApiError, ProvisionBody, SetupApi } from "./api/client.js";

/**
 * The wizard's screens, shown one at a time (in-memory state, never a URL route — the same
 * `@state`-driven machine `apps/dashboard/src/dashboard-app.ts` runs): `mode` (demo/live) → `admin`
 * (first operator) → `venue` (tenant + location + series) → `cert` (AEAT, live ES-common only) →
 * `review` (confirm + POST) → `provisioning` (in flight) → `done` (restarting). All seven are real
 * screens; the venue step routes to `cert` only for a live ES-common venue, otherwise straight to
 * `review`.
 */
export type Screen = "mode" | "admin" | "venue" | "cert" | "review" | "provisioning" | "done";

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
 * The setup wizard's ROOT element — the shell that turns the screens into a working app, mirroring
 * `apps/dashboard/src/dashboard-app.ts`.
 *
 * It owns the two things the whole flow shares: the injected {@link SetupApi}, and the accumulated
 * request {@link SetupApp.draft} that each screen contributes a slice of (via a bubbling `setup-patch`
 * event the shell deep-merges) and the `review` step finally POSTs. Nav is a plain `setup-goto` event
 * that flips {@link SetupApp.screen} — no server call, no history entry.
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

  /** Which screen is showing. Defaults to `mode`, the wizard's first step. */
  @state() private screen: Screen = "mode";

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
   * The mapped failure message shown ON the `provisioning` screen for the codes that stay there (the
   * two fiscal 409s, `already_provisioning`, `not_ready`, `provision_failed`). `undefined` while a
   * POST is in flight (the screen then shows the in-flight state) or before one is attempted.
   */
  @state() private provisionMessage?: string;

  /** Whether {@link SetupApp.provisionMessage} may be retried — never for the fiscal double-provision
   * refusals (re-POSTing an already-set-up box is meaningless and unrecoverable, CLAUDE.md §5). */
  @state() private provisionCanRetry = false;

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
    this.screen = event.detail.screen;
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
   * - `setup.already_provisioning` → an in-progress notice, no retry (a concurrent provision is running).
   * - `setup.already_provisioned` / `deployment.already_stamped` → "already set up", NO retry: these
   *   are the fiscal double-provision refusals and re-POSTing is unrecoverable (CLAUDE.md §5).
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
        return;
      case "setup.already_provisioned":
      case "deployment.already_stamped":
        this.provisionMessage = "This box is already set up.";
        this.provisionCanRetry = false;
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

  override render(): TemplateResult {
    // The screens emit these composed events UP to the shell: `setup-patch` (merge a slice into the
    // draft), `setup-goto` (flip the visible screen), and `provision-requested` (review's Provision
    // and the provisioning screen's retry both fire it). Wiring them on the container means each screen
    // talks back without the shell knowing which one is mounted.
    return html`<div
      class="wizard"
      @setup-patch=${(e: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>) => this.#onPatch(e)}
      @setup-goto=${(e: CustomEvent<{ screen: Screen }>) => this.#onGoto(e)}
      @provision-requested=${(e: CustomEvent) => void this.#onProvisionRequested(e)}
    >
      ${this.#renderScreen()}
    </div>`;
  }

  /**
   * The mounted screen for the current {@link SetupApp.screen} — all seven are real screens, each
   * carrying the `data-test="screen-*"` hook on its own host so the shell's screen-switching tests
   * stay uniform.
   *
   * `mode` reads `environment` (to warn on a production box); `admin`, `venue`, `cert` and `review`
   * read the accumulated `draft` (to seed their fields / summarise it, so stepping Back is
   * non-destructive); `venue` and `review` also take a routed-back server error (`venueError` /
   * `reviewError`); `provisioning` takes the mapped message + retry flag; `done` takes the `api` to
   * poll during the restart. All are passed as properties, since neither an api nor a draft object can
   * travel as an attribute.
   */
  #renderScreen(): TemplateResult {
    switch (this.screen) {
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
        ></setup-provisioning-screen>`;
      case "done":
        return html`<setup-done-screen
          data-test="screen-done"
          .api=${this.api}
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
