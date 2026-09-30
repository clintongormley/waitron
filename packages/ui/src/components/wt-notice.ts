import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

/**
 * An inline status message that goes by itself: after `duration` it fades out, hides itself and
 * sends `wt-notice-gone`. Under `prefers-reduced-motion` it hides at once, without the fade.
 */
@customElement("wt-notice")
export class WtNotice extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline;
      }
      :host([hidden]) {
        display: none;
      }
      .fading {
        animation: wt-notice-fade var(--wt-duration-fade) ease-in forwards;
      }
      @keyframes wt-notice-fade {
        to {
          opacity: 0;
        }
      }
    `,
  ];

  /** Milliseconds on screen before it fades; `0` keeps it. */
  @property({ type: Number }) duration = 4000;

  /** Overrides the `prefers-reduced-motion` query, which is read when the time is up. */
  @property({ attribute: false }) reducedMotion?: boolean;

  @state() private fading?: boolean;

  #timer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "status");
    this.#schedule();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#timer);
    super.disconnectedCallback();
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("duration")) this.#schedule();
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    this.fading = false;
    if (this.duration <= 0) return;
    this.#timer = setTimeout(() => this.#timeUp(), this.duration);
  }

  #timeUp(): void {
    const reduce =
      this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) this.#gone();
    else this.fading = true;
  }

  #gone(): void {
    this.hidden = true;
    this.dispatchEvent(
      new CustomEvent("wt-notice-gone", { bubbles: true, composed: true, detail: {} }),
    );
  }

  // A slotted element's own animation ending bubbles through here too.
  readonly #onAnimationEnd = (event: AnimationEvent): void => {
    if (event.target === event.currentTarget) this.#gone();
  };

  override render() {
    return html`<span
      class=${this.fading ? "fading" : nothing}
      @animationend=${this.#onAnimationEnd}
      ><slot></slot
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-notice": WtNotice;
  }
}
