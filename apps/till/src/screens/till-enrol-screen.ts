import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "../widgets/language-chooser.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { TillApi } from "../api/client.js";

const POLL_MS = 2_000;

/**
 * The device front door's JOIN screen, for a FRESH (unenrolled) browser; the dev chooser embeds it too.
 * It asks only for a name: the profile and the binding are chosen by an admin in the dashboard's accept
 * dialog, so this screen reads no catalogue.
 *
 * On approval it emits `enrolled` carrying `{ deviceId }` and never routes itself. The id is the join
 * response's `joinId`: accept carries the request's id onto the `devices` row
 * (`apps/server/src/join-requests.ts`). The detail carries no `name`/`formFactor` because this device is
 * never told its profile.
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
        max-width: var(--till-enrol-max-width, 24rem);
        margin-inline: auto;
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

  @property({ attribute: false }) api!: TillApi;

  @state() private phase: "name" | "waiting" | "refused" = "name";
  @state() private name = "";
  @state() private verificationNumber = "";
  @state() private joinId = "";
  @state() private errorCode = "";
  @state() private busy = false;
  @state() private attempted = false;
  #poll?: ReturnType<typeof setInterval>;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#poll !== undefined) clearInterval(this.#poll);
  }

  #onName(event: Event): void {
    this.name = (event as CustomEvent<{ value: string }>).detail.value;
    this.errorCode = "";
  }

  /** A refused knock returns to the `name` phase: the name is the only thing the operator can change. */
  async #join(): Promise<void> {
    if (this.busy) return;
    this.attempted = true;
    if (this.name === "") return;
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

  /** A transient failure keeps waiting: a knock the device abandons on a network blip cannot be
   * resumed. */
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
    const nameError = this.attempted && this.name === "" ? t("form.name_required") : "";
    return html`
      <h1 class="title">${t("device.join_name_title")}</h1>
      <p class="hint">${t("device.join_name_hint")}</p>
      ${
        this.errorCode === ""
          ? nothing
          : html`<p class="error" role="alert" data-error>${codeMessage(this.errorCode)}</p>`
      }
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${nameError === "" ? [] : [nameError]}
      ></wt-form-error-summary>
      <wt-input
        @keydown=${(e: KeyboardEvent) =>
          submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-submit]"))}
        data-name
        name="device-name"
        required
        .label=${t("device.join_name_label")}
        .value=${this.name}
        .error=${nameError}
        @wt-change=${(e: Event) => {
          e.stopPropagation();
          this.#onName(e);
        }}
      ></wt-input>
      <wt-form-actions>
        <slot name="actions-before" slot="cancel"></slot>
        <wt-button
          data-submit
          variant="primary"
          ?disabled=${this.busy}
          @click=${() => void this.#join()}
        >
          ${t("device.join_submit")}
        </wt-button>
      </wt-form-actions>
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
