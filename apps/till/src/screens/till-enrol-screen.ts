import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "../widgets/language-chooser.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { TillApi } from "../api/client.js";

/** How often the waiting view asks whether an admin has answered. */
const POLL_MS = 2_000;

/**
 * The device front door's JOIN screen (device-join-and-accept §2) — the twin the boot decision renders
 * for a FRESH (unenrolled) browser and the dev chooser embeds. Three phases:
 *
 *  - **`name`** — one field, a name, and a button. There is nothing else to ask: the profile and the
 *    binding are chosen by an admin in the dashboard's accept dialog, so an unapproved device reads no
 *    catalogue and learns nothing about the venue.
 *  - **`waiting`** — the two-digit number {@link TillApi.join} returned, announced and shown large,
 *    while {@link TillApi.joinStatus} is polled on the pending cookie.
 *  - **`refused`** — the admin said no, the request lapsed, or it never existed (the server folds all
 *    three into `not_approved`); Try again knocks afresh, which is the recovery in every case.
 *
 * A refused KNOCK returns to `name` with a banner, because the name is the one thing the operator can
 * still change there. `device.pairing_closed` earns its own sentence through `i18n/codes.ts` — the
 * operator has a real next step (ask a manager to switch pairing on) — while every other code degrades
 * to that resolver's generic sentence, since a flood or a full venue leaves them only "try again".
 *
 * On approval the screen emits a composed, bubbling `enrolled` carrying `{ deviceId }`. It never routes
 * itself: the boot front door re-boots on that event (the httpOnly cookie the knock set is the source of
 * truth), and the dev chooser writes the id to this tab's `sessionStorage` — two parents, one event. The
 * id is the join response's `joinId`: accept carries the request's id onto the `devices` row
 * (`apps/server/src/join-requests.ts`), so the approved device's id is one the screen already holds. The
 * detail carries no `name`/`formFactor` because this device is never told its profile; a future parent
 * that needs one reads `GET /api/device/me` after the re-boot rather than widening this event.
 */
@customElement("till-enrol-screen")
export class TillEnrolScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* A narrow reading column so the field + button stack rather than span a device edge-to-edge. */
      .screen {
        display: flex;
        max-width: 24rem;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      /* The number is the whole point of the waiting view: an admin reads it off this screen and taps its
         twin in the dashboard, often at arm's length. */
      .number {
        margin: 0;
        font-size: 4rem;
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: 0.1em;
        text-align: center;
      }

      /* The refusal banner — the danger-on-surface pairing the lock/station screens use (a11y-safe in
         both themes), never behind muted text. */
      .error {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  /** The HTTP face of the till. Threaded from the parent (boot front door or the dev chooser); the join
   * path is unauthenticated — no session, and no device yet. */
  @property({ attribute: false }) api!: TillApi;

  /** `name` asks for a name; `waiting` shows the number and polls; `refused` offers Try again. */
  @state() private phase: "name" | "waiting" | "refused" = "name";
  /** The operator's chosen name, retained across a refusal so Try again knocks without retyping it. */
  @state() private name = "";
  /** The two digits an admin matches in the dashboard. */
  @state() private verificationNumber = "";
  /** The accepted device's id — the join response's `joinId`, carried onto the devices row at accept. */
  @state() private joinId = "";
  /** The code of the last refused KNOCK, or `""` for no banner. Rendered through `codeMessage`, so an
   * unmapped code degrades to a generic sentence rather than reaching an operator raw. */
  @state() private errorCode = "";
  /** Reentry guard: one in-flight knock at a time (a double-tap is a no-op). */
  @state() private busy = false;
  #poll?: ReturnType<typeof setInterval>;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A screen torn down mid-wait must not keep a timer alive against a dead component.
    if (this.#poll !== undefined) clearInterval(this.#poll);
  }

  /** Track the name field and clear a stale banner as the operator retypes. */
  #onName(event: Event): void {
    this.name = (event as CustomEvent<{ value: string }>).detail.value;
    this.errorCode = "";
  }

  /**
   * Knock at `POST /api/device/join`. On success the number goes up and the poll starts; a refusal
   * returns to the `name` phase with a banner — from `waiting` this cannot happen, but Try again on
   * `refused` re-enters here, and the name field is the only thing the operator can still change.
   */
  async #join(): Promise<void> {
    if (this.name === "" || this.busy) return;
    this.busy = true;
    this.errorCode = "";
    try {
      const { joinId, verificationNumber } = await this.api.join(this.name);
      if (!this.isConnected) return;
      this.joinId = joinId;
      this.verificationNumber = verificationNumber;
      this.phase = "waiting";
      this.#poll = setInterval(() => void this.#tick(), POLL_MS);
    } catch (cause) {
      if (!this.isConnected) return;
      this.errorCode = (cause as { code?: string }).code ?? "server.internal";
      this.phase = "name";
    } finally {
      this.busy = false;
    }
  }

  /** One poll of the pending cookie. A transient failure keeps waiting: the admin has not answered
   * either way, and a knock the device abandons on a network blip cannot be resumed. */
  async #tick(): Promise<void> {
    let status: string;
    try {
      ({ status } = await this.api.joinStatus());
    } catch {
      return;
    }
    if (!this.isConnected) return;
    if (status === "approved") {
      clearInterval(this.#poll);
      this.#poll = undefined;
      this.dispatchEvent(
        new CustomEvent("enrolled", {
          detail: { deviceId: this.joinId },
          bubbles: true,
          composed: true,
        }),
      );
    } else if (status === "not_approved") {
      clearInterval(this.#poll);
      this.#poll = undefined;
      this.phase = "refused";
    }
  }

  override render(): TemplateResult {
    return html`
      <section class="screen">
        ${
          this.phase === "waiting"
            ? this.#renderWaiting()
            : this.phase === "refused"
              ? this.#renderRefused()
              : this.#renderName()
        }
      </section>
      <till-language-chooser
        .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
      ></till-language-chooser>
    `;
  }

  #renderName(): TemplateResult {
    return html`
      <h1 class="title">${t("device.join_name_title")}</h1>
      <p class="hint">${t("device.join_name_hint")}</p>
      ${
        this.errorCode === ""
          ? nothing
          : html`<p class="error" role="alert" data-error>${codeMessage(this.errorCode)}</p>`
      }
      <wt-input
        @keydown=${(e: KeyboardEvent) =>
          submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-submit]"))}
        data-name
        .label=${t("device.join_name_label")}
        .value=${this.name}
        @wt-change=${(e: Event) => {
          e.stopPropagation();
          this.#onName(e);
        }}
      ></wt-input>
      <wt-button
        data-submit
        variant="primary"
        ?disabled=${this.name === "" || this.busy}
        @click=${() => void this.#join()}
      >
        ${t("device.join_submit")}
      </wt-button>
    `;
  }

  #renderWaiting(): TemplateResult {
    return html`
      <h1 class="title">${t("device.join_waiting_title")}</h1>
      <p class="hint">${t("device.join_waiting_hint")}</p>
      <p
        class="number"
        data-number
        role="status"
        aria-label=${t("device.join_number_label").replace("{number}", this.verificationNumber)}
      >
        ${this.verificationNumber}
      </p>
    `;
  }

  #renderRefused(): TemplateResult {
    return html`
      <h1 class="title">${t("device.join_refused_title")}</h1>
      <p class="hint">${t("device.join_refused_hint")}</p>
      <wt-button
        data-retry
        variant="primary"
        ?disabled=${this.busy}
        @click=${() => void this.#join()}
      >
        ${t("device.join_retry")}
      </wt-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-enrol-screen": TillEnrolScreen;
  }
}
