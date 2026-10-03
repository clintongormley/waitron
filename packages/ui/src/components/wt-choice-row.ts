import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

/**
 * One choice in a list of choices: a heading, a short description and an arrow, the whole row one
 * button, or one link when its `href` is not empty. It fires the native `click`, as `wt-button` does. Only
 * the last `wt-choice-row` in its parent draws a bottom border, and the first and last take the
 * rounded corners, so rows adjacent in one parent read as one box; a hidden row still counts as
 * first or last.
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

      .row {
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
        text-decoration: none;
        cursor: pointer;
      }

      /* The box's corners are drawn on the row's button or link, not on a clipping parent, so nothing
         clips a hovered row's background or the focus ring. */
      :host(:first-of-type) .row {
        border-top-left-radius: var(--wt-radius-lg);
        border-top-right-radius: var(--wt-radius-lg);
      }

      :host(:last-of-type) .row {
        border-bottom-width: 1px;
        border-bottom-left-radius: var(--wt-radius-lg);
        border-bottom-right-radius: var(--wt-radius-lg);
      }

      .row:hover {
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

      :host(:empty) [part="description"] {
        display: none;
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

  @property() href = "";

  override render(): TemplateResult {
    const content = html`<span class="text">
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
      </svg>`;
    return this.href
      ? html`<a class="row" href=${this.href}>${content}</a>`
      : html`<button class="row" type="button">${content}</button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-choice-row": WtChoiceRow;
  }
}
