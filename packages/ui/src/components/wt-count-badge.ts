import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtCountBadgeTone = "neutral" | "warning" | "error" | "notice";

/** A count pill. Renders nothing at zero and caps its text at "99+". It has no accessible name of
 * its own: the control it decorates must say the count. With `publish-width` it keeps
 * `--count-badge-width` on its parent element at its drawn width, so a parent it is drawn over can
 * keep its content clear of it whatever the count, font and text size. */
@customElement("wt-count-badge")
export class WtCountBadge extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
      }
      span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-5);
        padding: 0 var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        line-height: var(--wt-space-5);
      }
      :host([tone="warning"]) span {
        border-color: transparent;
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
      }
      :host([tone="error"]) span {
        border-color: transparent;
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }
      :host([tone="notice"]) span {
        border-color: transparent;
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
    `,
  ];

  @property({ type: Number }) count = 0;
  @property({ reflect: true }) tone: WtCountBadgeTone = "neutral";
  @property({ type: Boolean, attribute: "publish-width" }) publishWidth = false;

  #widthObserver?: ResizeObserver;
  #publishedOn?: HTMLElement;

  override connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated) this.#syncPublishing();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#stopPublishing();
  }

  protected override updated(changed: PropertyValues<this>) {
    if (changed.has("publishWidth")) this.#syncPublishing();
  }

  #syncPublishing() {
    if (!this.publishWidth) return this.#stopPublishing();
    const parent = this.parentElement;
    if (this.#widthObserver || !parent) return;
    this.#publishedOn = parent;
    this.#widthObserver = new ResizeObserver(([entry]) => {
      parent.style.setProperty("--count-badge-width", `${entry!.borderBoxSize[0]!.inlineSize}px`);
    });
    this.#widthObserver.observe(this);
  }

  #stopPublishing() {
    this.#widthObserver?.disconnect();
    this.#publishedOn?.style.removeProperty("--count-badge-width");
    this.#widthObserver = this.#publishedOn = undefined;
  }

  override render() {
    if (!(this.count > 0)) return nothing;
    return html`<span part="badge">${this.count > 99 ? "99+" : String(this.count)}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-count-badge": WtCountBadge;
  }
}
