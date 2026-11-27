import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-icon.js";

export type WtCourseHeadingMark = "" | "sent";

/** The page passes the mark's word in its own language as `markLabel`. */
@customElement("wt-course-heading")
export class WtCourseHeading extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* The title gets the room first: the action wraps under it before the title is squeezed. */
      :host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) var(--wt-space-4) var(--wt-course-heading-padding-bottom);
        background: var(--wt-color-bg);
      }

      [role="heading"] {
        display: flex;
        flex: 1 1 auto;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
      }

      /* The mark moves under the title only when the title would keep less than half the width, or
         less than --wt-course-heading-title-min-width. */
      .title {
        flex: 1 1 max(50%, var(--wt-course-heading-title-min-width));
      }

      .mark {
        display: inline-flex;
        flex: none;
        margin-inline-start: auto;
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

      .end {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: var(--wt-space-2);
        margin-inline-start: auto;
      }

      .end[hidden] {
        display: none;
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

  /** An empty end box would still take the host's gap, so it is hidden until something is slotted. */
  @state() private hasEnd = false;

  override render() {
    const level =
      Number.isInteger(this.level) && this.level >= 1 && this.level <= 6 ? this.level : 3;
    return html`
      <div role="heading" aria-level=${level}>
        <span class="title"><slot></slot></span>
        ${
          this.mark === "sent"
            ? html`<span part="mark" class="mark"
                ><wt-icon name="check" size="sm" aria-hidden="true"></wt-icon
                ><span>${this.markLabel}</span></span
              >`
            : nothing
        }
      </div>
      <div class="end" ?hidden=${!this.hasEnd}>
        <slot
          name="end"
          @slotchange=${(event: Event) => {
            this.hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
          }}
        ></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-course-heading": WtCourseHeading;
  }
}
