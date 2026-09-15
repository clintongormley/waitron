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
  #hovered = false;

  /** Opens the toast and restarts its countdown, even when it is already open with the same
   * message: a repeated notice changes no property, so nothing else would restart it. */
  show(): void {
    this.open = true;
    this.#schedule();
  }

  override updated(changed: PropertyValues<this>): void {
    // Closing removes the hovered element without a mouseleave, so the flag would stay set.
    if (!this.open) this.#hovered = false;
    if (changed.has("open") || changed.has("message") || changed.has("duration")) this.#schedule();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#timer);
    super.disconnectedCallback();
  }

  /** The one place a countdown starts: never while the pointer or keyboard focus is on it. */
  #schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.open || this.duration <= 0 || this.#hovered || this.matches(":focus-within")) return;
    this.#timer = setTimeout(() => this.#close(), this.duration);
  }

  readonly #onPointerEnter = (): void => {
    this.#hovered = true;
    this.#schedule();
  };

  readonly #onPointerLeave = (): void => {
    this.#hovered = false;
    this.#schedule();
  };

  // During focusin :focus-within already matches, so this pauses; during focusout it no longer does.
  readonly #onFocusChange = (): void => this.#schedule();

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
          @mouseenter=${this.#onPointerEnter}
          @mouseleave=${this.#onPointerLeave}
          @focusin=${this.#onFocusChange}
          @focusout=${this.#onFocusChange}
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
