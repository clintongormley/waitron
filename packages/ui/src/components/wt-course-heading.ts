import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import "./wt-icon.js";

export type WtCourseHeadingMark = "" | "sent";

/** The page passes the mark's word in its own language as `markLabel`. */
@customElement("wt-course-heading")
export class WtCourseHeading extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
        padding: var(--wt-space-3) var(--wt-space-4) var(--wt-course-heading-padding-bottom);
        background: var(--wt-color-bg);
      }

      /* The title grows; the mark and the action form one end group that wraps under the title as a
         unit when it does not fit beside the title on one line. The row gap matches the top padding
         so an action whose tap area spills into that padding spills into the gap, not the title. */
      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3) var(--wt-space-2);
      }

      [role="heading"] {
        flex: 1 1 auto;
        min-width: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
        text-wrap: balance;
        overflow-wrap: break-word;
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
        text-transform: none;
      }

      .end {
        display: flex;
        flex: none;
        margin-inline-start: auto;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .end[hidden] {
        display: none;
      }

      .mark {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-tab-ready-tint);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }

      .mark wt-icon {
        color: var(--wt-color-success);
      }

      @media (forced-colors: active) {
        .mark {
          border: var(--wt-field-line-width) solid CanvasText;
          padding: calc(var(--wt-space-1) - var(--wt-field-line-width))
            calc(var(--wt-space-2) - var(--wt-field-line-width));
        }
      }
    `,
  ];

  @property() mark: WtCourseHeadingMark = "";

  @property({ attribute: "mark-label" }) markLabel = "";

  @property({ type: Number }) level = 3;

  /** An empty end group would still take its gap, so it is hidden until it holds something. */
  @state() private hasEnd = false;

  override render() {
    const level =
      Number.isInteger(this.level) && this.level >= 1 && this.level <= 6 ? this.level : 3;
    const marked = this.mark === "sent";
    // The mark is drawn in the end group, beside the action, but its word belongs to the heading
    // for assistive technology, so the heading carries it unseen and the drawn pill is hidden.
    return html`
      <div class="line">
        <div role="heading" aria-level=${level}>
          <slot></slot>${
            marked ? html`<span class="visually-hidden">${this.markLabel}</span>` : nothing
          }
        </div>
        <div class="end" ?hidden=${!marked && !this.hasEnd}>
          ${
            marked
              ? html`<span part="mark" class="mark" aria-hidden="true"
                  ><wt-icon name="check" size="sm" aria-hidden="true"></wt-icon
                  ><span>${this.markLabel}</span></span
                >`
              : nothing
          }
          <slot
            name="end"
            @slotchange=${(event: Event) => {
              this.hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
            }}
          ></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-course-heading": WtCourseHeading;
  }
}
