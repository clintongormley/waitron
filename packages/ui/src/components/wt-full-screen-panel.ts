import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { syncScrollTabStop } from "../scroll-tab-stop.js";

@customElement("wt-full-screen-panel")
export class WtFullScreenPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        block-size: 100%;
        background: var(--wt-color-bg);
      }

      :host([rising]) {
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        border-radius: var(--wt-radius-lg) var(--wt-radius-lg) 0 0;
        box-shadow: var(--wt-menu-sheet-shadow);
      }

      .handle {
        justify-self: center;
        width: var(--wt-menu-sheet-handle-width);
        height: var(--wt-menu-sheet-handle-height);
        margin-block: var(--wt-space-2) calc(var(--wt-space-1) / 2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-sunken);
      }

      @media (forced-colors: active) {
        :host([rising]) {
          border-block-start: var(--wt-field-line-width) solid CanvasText;
        }
      }

      @media (prefers-reduced-motion: no-preference) {
        :host([rising]) {
          transition: translate var(--wt-duration-move);
          translate: 0 0;
          @starting-style {
            translate: 0 var(--wt-space-4);
          }
        }
      }

      .body {
        overflow: auto;
        overscroll-behavior: contain;
      }

      .content {
        display: flow-root;
      }
    `,
  ];

  @property({ attribute: "body-label" }) bodyLabel = "";
  @property({ type: Boolean, reflect: true }) rising = false;
  @query(".body") private body!: HTMLElement;
  @query(".content") private content!: HTMLElement;

  private readonly resize = new ResizeObserver(() => this.syncBody());

  override connectedCallback(): void {
    super.connectedCallback();
    void this.updateComplete.then(() => {
      if (!this.isConnected) return;
      this.resize.observe(this.body);
      this.resize.observe(this.content);
    });
  }

  override disconnectedCallback(): void {
    this.resize.disconnect();
    super.disconnectedCallback();
  }

  override updated(): void {
    this.syncBody();
  }

  private syncBody(): void {
    syncScrollTabStop(this.body, "overflow", this.bodyLabel);
  }

  override render() {
    return html`${this.rising ? html`<div class="handle" data-handle aria-hidden="true"></div>` : nothing}
      <slot name="header"></slot>
      <div class="body" part="body">
        <div class="content"><slot></slot></div>
      </div>
      <slot name="footer"></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-full-screen-panel": WtFullScreenPanel;
  }
}
