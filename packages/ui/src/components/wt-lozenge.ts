import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { readableTextColor, isHexColor } from "../category-color.js";

/**
 * A pill for a category. With a colour it fills that background and sets the text to black or white
 * for contrast; the colour is data, applied inline (the one no-hardcoded-chrome exemption). With no
 * colour it is a neutral outlined chip whose chrome reads tokens.
 */
@customElement("wt-lozenge")
export class WtLozenge extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        min-width: 0;
      }
      span {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding: 0 var(--wt-space-3);
        border-radius: var(--wt-radius-full);
        border: 1px solid transparent;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        line-height: calc(var(--wt-tap-min) / 1.6);
      }
      span.none {
        background: var(--wt-color-surface);
        border-color: var(--wt-color-border);
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-normal);
      }
    `,
  ];

  @property() color = "";

  override render() {
    const colored = isHexColor(this.color);
    const style = colored ? `background:${this.color};color:${readableTextColor(this.color)}` : "";
    // Not a <slot>: a <slot>'s assigned light-DOM nodes are never DOM descendants of the slot
    // itself, so a consumer (or a test) reading .textContent off the rendered chip would always
    // see "" despite the label rendering correctly on screen. Binding the host's own text here
    // keeps the label a real text-node child of the shadow <span>.
    return html`<span class=${colored ? "" : "none"} style=${style}>${this.textContent}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-lozenge": WtLozenge;
  }
}
