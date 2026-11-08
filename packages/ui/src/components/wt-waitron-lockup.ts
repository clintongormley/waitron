import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { baseStyles } from "../base-styles.js";
import lockupSource from "../../brand/waitron-lockup.svg?raw";

const lockupMarkup = lockupSource.slice(
  lockupSource.indexOf(">") + 1,
  lockupSource.lastIndexOf("</svg>"),
);
const lockupViewBox = /viewBox="([^"]+)"/.exec(lockupSource)![1]!;
const [, , lockupWidth, lockupHeight] = lockupViewBox.split(/\s+/);
/** Where the word's letters sit, in the drawing's units: the bottom of its "w". */
const WORD_BASELINE = 77.19;

/**
 * Waitron's lockup drawn inline, so it reads the theme it sits in: the cloche in
 * `--wt-color-primary`, the word in `--wt-color-text`. Size it by its width or its height; the
 * other follows the drawing's shape. Its baseline is the word's, so text beside it can line up by
 * baseline.
 * `label` names it; an empty `label` makes it decoration.
 */
@customElement("wt-waitron-lockup")
export class WtWaitronLockup extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* A grid takes its baseline from the bottom of the first row's first item, so an empty span
         filling a first row that ends where the word's letters sit gives the lockup that baseline. */
      :host {
        display: grid;
        grid-template-rows: ${unsafeCSS(`calc(100% * ${WORD_BASELINE} / ${lockupHeight})`)} 1fr;
        aspect-ratio: ${unsafeCSS(`${lockupWidth} / ${lockupHeight}`)};
      }

      .baseline {
        grid-area: 1 / 1;
      }

      svg {
        grid-area: 1 / 1 / 3 / 2;
        display: block;
        inline-size: 100%;
        block-size: 100%;
      }

      svg > g:first-of-type {
        fill: var(--wt-color-primary);
      }

      svg > g:last-of-type {
        fill: var(--wt-color-text);
      }
    `,
  ];

  @property() label = "Waitron";

  override render() {
    const named = this.label !== "";
    return html`<span class="baseline"></span
      ><svg
        part="lockup"
        xmlns="http://www.w3.org/2000/svg"
        viewBox=${lockupViewBox}
        role=${named ? "img" : nothing}
        aria-label=${named ? this.label : nothing}
        aria-hidden=${named ? nothing : "true"}
      >
        ${unsafeSVG(lockupMarkup)}
      </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-waitron-lockup": WtWaitronLockup;
  }
}
