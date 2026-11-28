import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-initials")
export class WtInitials extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-grid;
        flex: none;
      }
      span {
        display: grid;
        place-items: center;
        inline-size: var(--wt-tap-min);
        aspect-ratio: 1;
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-weight: var(--wt-font-weight-bold);
      }
      :host([size="lg"]) span {
        inline-size: calc(2 * var(--wt-space-6) + var(--wt-space-2));
        font-size: calc(var(--wt-font-size-xl) + var(--wt-space-1));
      }
      @media (forced-colors: active) {
        span {
          forced-color-adjust: none;
          background: CanvasText;
          color: Canvas;
        }
      }
    `,
  ];

  @property() name = "";
  @property() locale = "en";
  @property({ reflect: true }) size: "md" | "lg" = "md";

  override render() {
    const initials = this.name
      .trim()
      .split(/\s+/u, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toLocaleUpperCase(this.locale);
    return initials ? html`<span aria-hidden="true">${initials}</span>` : nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-initials": WtInitials;
  }
}
