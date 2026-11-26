import { LitElement, css, html } from "lit";
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
    return html`<slot name="header"></slot>
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
