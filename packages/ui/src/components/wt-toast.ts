import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-icon.js";

export type WtToastTone = "info" | "error";

/**
 * A brief notice. Both live regions are always in the document, so a screen reader announces the
 * message when it appears. Positioning belongs to the consumer. The consuming app registers the
 * `close` icon.
 */
@customElement("wt-toast")
export class WtToast extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .toast {
        display: flex;
        align-items: stretch;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-inline-start-width: var(--wt-space-1);
        border-inline-start-color: var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
      :host([tone="error"]) .toast {
        border-inline-start-color: var(--wt-color-danger);
      }
      button {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-sm);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .message {
        flex: 1 1 auto;
        padding: 0 var(--wt-space-2);
        text-align: start;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ reflect: true }) tone: WtToastTone = "info";
  @property() message = "";
  @property({ attribute: "close-label" }) closeLabel = "";
  @property({ type: Number }) duration = 8000;

  #timer: ReturnType<typeof setTimeout> | undefined;

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("open") || changed.has("message") || changed.has("duration")) this.#restart();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#timer);
    super.disconnectedCallback();
  }

  #restart(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.open && this.duration > 0)
      this.#timer = setTimeout(() => this.#close(), this.duration);
  }

  readonly #pause = (): void => {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  };

  readonly #resume = (): void => {
    if (!this.matches(":focus-within")) this.#restart();
  };

  #close(): void {
    if (!this.open) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true, detail: {} }));
  }

  #onMessage(event: MouseEvent): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-activate", { bubbles: true, composed: true, detail: {} }),
    );
    this.#close();
  }

  #onClose(event: MouseEvent): void {
    event.stopPropagation();
    this.#close();
  }

  override render() {
    const toast = this.open
      ? html`<div
          class="toast"
          part="toast"
          @mouseenter=${this.#pause}
          @mouseleave=${this.#resume}
          @focusin=${this.#pause}
          @focusout=${this.#resume}
        >
          <button class="message" type="button" @click=${this.#onMessage}>${this.message}</button>
          <button class="close" type="button" aria-label=${this.closeLabel} @click=${this.#onClose}>
            <wt-icon name="close"></wt-icon>
          </button>
        </div>`
      : nothing;
    return html`<div role="status">${this.tone === "error" ? nothing : toast}</div>
      <div role="alert">${this.tone === "error" ? toast : nothing}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-toast": WtToast;
  }
}
