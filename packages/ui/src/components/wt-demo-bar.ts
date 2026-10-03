import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export interface DemoBarLink {
  label: string;
  href: string;
  current?: boolean;
}

@customElement("wt-demo-bar")
export class WtDemoBar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border-bottom: 1px solid var(--wt-color-border);
      }

      nav {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-4);
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      strong {
        font-weight: var(--wt-font-weight-bold);
      }

      a,
      [aria-current] {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-text);
      }

      a:focus-visible {
        outline: 2px solid var(--wt-color-primary);
        outline-offset: 2px;
      }
    `,
  ];

  @property() modeLabel = "";
  @property() navigationLabel = "";
  @property({ attribute: false }) links: DemoBarLink[] = [];

  override render(): TemplateResult {
    return html`<nav aria-label=${this.navigationLabel}>
      <strong>${this.modeLabel}</strong>
      ${this.links.map((link) =>
        link.current
          ? html`<span aria-current="page">${link.label}</span>`
          : html`<a href=${link.href}>${link.label}</a>`,
      )}
    </nav>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-demo-bar": WtDemoBar;
  }
}
