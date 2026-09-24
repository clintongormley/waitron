import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { readableTextColor, isHexColor } from "../category-color.js";

/** The category colour is data, so it is applied inline rather than from a token. */
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
        /* The older CSS property with the same effect has a hyphenated name whose first half is a
           literal colour keyword, which trips the no-hardcoded-chrome guard's regex (a hyphen
           counts as a word boundary there). This modern alias means the same thing without that
           collision. */
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
    // A <slot>, not `${this.textContent}`: an element reused for another category with the same colour
    // changes no reactive property, so render() would not re-run and a copied text would go stale.
    return html`<span class=${colored ? "" : "none"} style=${style}><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-lozenge": WtLozenge;
  }
}
