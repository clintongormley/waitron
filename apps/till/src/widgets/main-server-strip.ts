import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

/** The red strip a till shows while the venue's main server has been silent too long. */
@customElement("till-main-server-strip")
export class TillMainServerStrip extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }
      .words {
        flex: 1 1 auto;
      }
    `,
  ];

  @property({ type: Boolean }) spareAnswering = false;
  @property({ type: Boolean }) showSwitch = false;
  @property({ type: Boolean }) refused = false;

  override render() {
    const switchable = this.spareAnswering && this.showSwitch;
    return html`<div class="strip" role="alert" data-main-server-strip>
      <span class="words"
        >${t(
          switchable && this.refused
            ? "server.main_still_answering"
            : this.spareAnswering
              ? "server.main_silent"
              : "server.none_answering",
        )}</span
      >
      ${
        switchable
          ? html`<wt-button
              variant="secondary"
              data-switch-to-spare
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("switch-to-spare", { bubbles: true, composed: true }),
                )}
              >${t("server.switch_to_spare")}</wt-button
            >`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-main-server-strip": TillMainServerStrip;
  }
}
