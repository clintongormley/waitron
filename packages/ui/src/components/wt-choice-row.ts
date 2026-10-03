import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

/**
 * One choice in a list of choices: a heading, a short description and an arrow, the whole row one
 * button. It fires the native `click`, as `wt-button` does. Only the last `wt-choice-row` in its
 * parent draws a bottom border, and the first and last take the rounded corners, so rows adjacent
 * in one parent read as one box; a hidden row still counts as first or last.
 */
@customElement("wt-choice-row")
export class WtChoiceRow extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      button {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-bottom-width: 0;
        border-radius: 0;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      /* The box's corners are drawn on the buttons, not on a clipping parent, so nothing clips a
         hovered row's background or the focus ring. */
      :host(:first-of-type) button {
        border-top-left-radius: var(--wt-radius-lg);
        border-top-right-radius: var(--wt-radius-lg);
      }

      :host(:last-of-type) button {
        border-bottom-width: 1px;
        border-bottom-left-radius: var(--wt-radius-lg);
        border-bottom-right-radius: var(--wt-radius-lg);
      }

      button:hover {
        background: var(--wt-color-surface-lifted);
      }

      .text {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      [part="heading"] {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }

      [part="description"] {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      [part="arrow"] {
        flex: none;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property() heading = "";

  override render() {
    return html`<button type="button">
      <span class="text">
        <span part="heading">${this.heading}</span>
        <span part="description"><slot></slot></span>
      </span>
      <svg part="arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M6 3.5 10.5 8 6 12.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path>
      </svg>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-choice-row": WtChoiceRow;
  }
}
