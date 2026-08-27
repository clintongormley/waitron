import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// Side-effect import registers the <wt-card> element this shell names as a tag below.
import "@waitron/ui/src/components/wt-card.js";
import type { ProvisionBody, SetupApi } from "./api/client.js";

/**
 * The wizard's screens, shown one at a time (in-memory state, never a URL route — the same
 * `@state`-driven machine `apps/dashboard/src/dashboard-app.ts` runs): `mode` (demo/live) → `admin`
 * (first operator) → `venue` (tenant + location + series) → `cert` (AEAT, live ES-common only) →
 * `review` (confirm + POST) → `provisioning` (in flight) → `done` (restarting). Only `mode` renders
 * richly in this task; the collecting screens arrive in later tasks of slice 2c and are stubs here.
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
   */
  #onGoto(event: CustomEvent<{ screen: Screen }>): void {
    event.stopPropagation();
    this.screen = event.detail.screen;
  }

  override render(): TemplateResult {
    // The screens (later tasks) emit these two composed events UP to the shell; wiring them on the
    // container now means a screen dropped in later needs no shell change to talk back.
    return html`<div
      class="wizard"
      @setup-patch=${(e: CustomEvent<{ patch: DeepPartial<ProvisionBody> }>) => this.#onPatch(e)}
      @setup-goto=${(e: CustomEvent<{ screen: Screen }>) => this.#onGoto(e)}
    >
      ${this.#renderScreen()}
    </div>`;
  }

  /**
   * The mounted screen for the current {@link SetupApp.screen}. Only `mode` renders its real
   * placeholder card in this task; the collecting screens (`admin`/`venue`/`cert`/`review`/
   * `provisioning`/`done`) arrive in later tasks of slice 2c and render a labelled stub for now, so
   * the machine and its nav are exercisable end to end.
   */
  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "admin":
        return html`<p data-test="screen-admin">admin</p>`;
      case "venue":
        return html`<p data-test="screen-venue">venue</p>`;
      case "cert":
        return html`<p data-test="screen-cert">cert</p>`;
      case "review":
        return html`<p data-test="screen-review">review</p>`;
      case "provisioning":
        return html`<p data-test="screen-provisioning">provisioning</p>`;
      case "done":
        return html`<p data-test="screen-done">done</p>`;
      default:
        return html`<wt-card data-test="screen-mode">
          <h1>Set up this Waitron box</h1>
          ${this.environment ? html`<p data-test="environment">${this.environment}</p>` : nothing}
        </wt-card>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-app": SetupApp;
  }
}
