import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { ColorSchemeController } from "../color-scheme.js";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "../waitron-lockup.js";

/** The words in `label`, then Waitron's lockup in the drawing for the host's colour scheme. */
@customElement("wt-powered-by")
export class WtPoweredBy extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      img {
        display: block;
        inline-size: calc(var(--wt-space-6) * 2);
        block-size: auto;
      }
    `,
  ];

  @property() label = "";

  readonly #scheme = new ColorSchemeController(this);

  override render() {
    return html`<span part="label">${this.label}</span
      ><img
        part="lockup"
        src=${this.#scheme.dark ? WAITRON_LOCKUP_DARK_URL : WAITRON_LOCKUP_URL}
        alt="Waitron"
      />`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-powered-by": WtPoweredBy;
  }
}
