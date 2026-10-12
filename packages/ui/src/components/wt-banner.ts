import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-button.js";

/** A full-width strip with one message and, when given an action label, one action. */
@customElement("wt-banner")
export class WtBanner extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border-block-end: 1px solid var(--wt-color-border);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-primary);
      }

      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .message {
        flex: 1 1 auto;
        margin: 0;
      }
    `,
  ];

  @property() message = "";
  @property({ attribute: "action-label" }) actionLabel = "";

  @state() private shown = false;
  #frame = 0;

  /** The message goes in only after the empty region has been through a rendered frame, so it
   * arrives as a change to a live region already on the page rather than together with it. */
  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "status");
    this.shown = false;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.shown = true;
      });
    });
  }

  override disconnectedCallback(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    super.disconnectedCallback();
  }

  readonly #onAction = (event: Event): void => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-banner-action", { bubbles: true, composed: true, detail: {} }),
    );
  };

  override render(): TemplateResult {
    return html`<div class="bar">
      <p class="message">${this.shown ? this.message : nothing}</p>
      ${
        this.actionLabel === ""
          ? nothing
          : html`<wt-button variant="primary" @click=${this.#onAction}
              >${this.actionLabel}</wt-button
            >`
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-banner": WtBanner;
  }
}
