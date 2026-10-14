import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

@customElement("till-clock-in-screen")
export class TillClockInScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: calc(100dvh - var(--wt-tap-min) * 2);
        padding: var(--wt-space-4);
        gap: var(--wt-space-4);
      }
      .actions {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
      .message {
        margin: 0;
        text-align: center;
      }
    `,
  ];

  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) reading = false;
  @property({ type: Boolean }) canClockIn = true;
  @property() error = "";

  #emit(type: string): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }

  override render() {
    const ready = !this.reading && this.canClockIn;
    return html`
      ${this.error ? html`<p class="message" role="status">${this.error}</p>` : this.reading ? html`<p class="message" role="status">${t("clock.reading")}</p>` : nothing}
      <div class="actions">
        <wt-button
          data-clock-in
          size="lg"
          variant=${ready || this.busy ? "primary" : "secondary"}
          .loading=${this.busy}
          .disabled=${!ready || this.busy}
          @click=${() => this.#emit("clock-in")}
          >${t("clock.in")}</wt-button
        >
        <wt-button
          data-cancel
          size="lg"
          variant="secondary"
          .disabled=${this.busy}
          @click=${() => this.#emit("cancel-clock-in")}
          >${t("clock.cancel")}</wt-button
        >
      </div>
      ${this.error ? html`<wt-button data-retry variant="secondary" .disabled=${this.busy || this.reading} @click=${() => this.#emit("retry-clock-read")}>${t("clock.retry")}</wt-button>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-clock-in-screen": TillClockInScreen;
  }
}
