import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-icon.js";

export type WtCourseHeadingMark = "" | "sent";

/** The page passes the mark's word in its own language as `markLabel`. */
@customElement("wt-course-heading")
export class WtCourseHeading extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) var(--wt-space-4) var(--wt-course-heading-padding-bottom);
        background: var(--wt-color-bg);
      }

      [role="heading"] {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        min-width: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
      }

      .mark {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-tab-ready-tint);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        letter-spacing: normal;
        text-transform: none;
      }

      .mark wt-icon {
        color: var(--wt-color-success);
      }
    `,
  ];

  @property() mark: WtCourseHeadingMark = "";

  @property({ attribute: "mark-label" }) markLabel = "";

  @property({ type: Number }) level = 3;

  override render() {
    return html`
      <div role="heading" aria-level=${this.level}>
        <span><slot></slot></span>
        ${
          this.mark === "sent"
            ? html`<span part="mark" class="mark"
                ><wt-icon name="check" size="sm" aria-hidden="true"></wt-icon
                ><span>${this.markLabel}</span></span
              >`
            : nothing
        }
      </div>
      <slot name="end"></slot>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-course-heading": WtCourseHeading;
  }
}
