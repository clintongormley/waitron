import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-button.js";
import "./wt-icon.js";

@customElement("wt-top-bar")
export class WtTopBar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
        align-items: center;
        gap: var(--wt-space-1);
        min-block-size: calc(var(--wt-tap-min) + var(--wt-space-3));
        padding-inline: var(--wt-space-1);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
        background: var(--wt-color-surface);
      }

      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        text-align: center;
      }

      .subtitle {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }

      wt-button {
        min-inline-size: 0;
        max-inline-size: 100%;
        --wt-action-padding: 0;
        --wt-action-text: var(--wt-color-primary-text);
        --wt-action-font-size: var(--wt-font-size-md);
        --wt-button-justify: start;
        --wt-action-gap: var(--wt-space-1);
      }

      .back-label,
      .title,
      .subtitle {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      .title {
        display: block;
      }

      wt-icon {
        color: var(--wt-color-primary-text);
      }

      .action {
        justify-self: end;
      }
    `,
  ];

  @property() heading = "";
  @property() subtitle = "";
  @property({ attribute: "back-label" }) backLabel = "";

  private back(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("wt-back", { bubbles: true, composed: true, detail: {} }));
  }

  override render() {
    return html`<header>
      <div>
        ${
          this.backLabel === ""
            ? nothing
            : html`<wt-button variant="ghost" @click=${this.back}
                ><wt-icon name="chevron-left"></wt-icon
                ><span class="back-label">${this.backLabel}</span></wt-button
              >`
        }
      </div>
      <h2>
        <span class="title"><slot name="title">${this.heading}</slot></span>
        ${this.subtitle === "" ? nothing : html`<span class="subtitle">${this.subtitle}</span>`}
      </h2>
      <div class="action"><slot name="action"></slot></div>
    </header>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-top-bar": WtTopBar;
  }
}
