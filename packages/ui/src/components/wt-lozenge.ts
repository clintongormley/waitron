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
    // A real <slot>, not `${this.textContent}`: Lit only re-runs render() when a reactive property
    // changes, and a list that reuses this element by index (e.g. the products modal's category
    // list) can swap in a different category whose colour happens to match the previous one — only
    // 24 palette colours, so collisions are common. `color` would then be unchanged, render() would
    // never re-fire, and a captured `this.textContent` snapshot would go stale while the slotted
    // light-DOM content (owned by the caller, not by this element's own render cycle) stays correct.
    return html`<span class=${colored ? "" : "none"} style=${style}><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-lozenge": WtLozenge;
  }
}
