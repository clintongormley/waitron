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
      :host {
        display: block;
        position: relative;
        padding: var(--wt-space-3) var(--wt-space-4) var(--wt-course-heading-padding-bottom);
        background: var(--wt-color-bg);
      }

      /* Three columns, title / mark / action, shared with the heading through a subgrid so the mark
         (which belongs to the heading for assistive technology) sits beside the action. */
      .line {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
      }

      .line.mark-shown,
      .line.end-shown {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .line.mark-shown.end-shown {
        grid-template-columns: minmax(0, 1fr) auto auto;
      }

      [role="heading"] {
        display: grid;
        grid-column: 1 / -1;
        grid-row: 1;
        grid-template-columns: subgrid;
        align-items: center;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
      }

      .title {
        grid-column: 1;
        text-wrap: balance;
      }

      .mark {
        display: inline-flex;
        grid-column: 2;
        justify-self: end;
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
        grid-column: -2 / -1;
        grid-row: 1;
        justify-content: flex-end;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .end[hidden] {
        display: none;
      }

      /* Stacked: the title takes the first row whole, the mark and the action share the second. */
      :host([stacked]) [role="heading"] {
        grid-row: 1 / 3;
        grid-template-rows: subgrid;
      }

      :host([stacked]) .title {
        grid-column: 1 / -1;
      }

      :host([stacked]) .mark,
      :host([stacked]) .end {
        grid-row: 2;
      }

      .width {
        position: absolute;
        inset-inline: 0;
        top: 0;
        height: 0;
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

  /** An empty end box would still take a column and its gap, so it is hidden until something is
   * slotted. */
  @state() private hasEnd = false;

  #widths?: ResizeObserver;
  #words?: MutationObserver;
  #width = -1;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#words = new MutationObserver(() => this.#lay());
    this.#words.observe(this, { childList: true, subtree: true, characterData: true });
  }

  override disconnectedCallback(): void {
    this.#widths?.disconnect();
    this.#widths = undefined;
    this.#words?.disconnect();
    this.#words = undefined;
    this.#width = -1;
    super.disconnectedCallback();
  }

  protected override updated(): void {
    const width = this.renderRoot.querySelector(".width")!;
    if (this.#widths === undefined) {
      // Watches a zero-height box, so stacking, which changes only the height, never re-triggers it.
      this.#widths = new ResizeObserver(([entry]) => {
        if (entry!.contentRect.width === this.#width) return;
        this.#width = entry!.contentRect.width;
        this.#lay();
      });
      this.#widths.observe(width);
    }
    this.#lay();
  }

  /** Beside the mark and the action the title may take two lines; one that needs a third, or whose
   * unbreakable words are wider than the room left, moves them under it. */
  #lay(): void {
    const title = this.renderRoot.querySelector<HTMLElement>(".title");
    if (!title) return;
    if (this.mark !== "sent" && !this.hasEnd) {
      this.removeAttribute("stacked");
      return;
    }
    this.removeAttribute("stacked");
    const { lines, overflows } = measure(title);
    this.toggleAttribute("stacked", lines > 2 || overflows);
  }

  override render() {
    const level =
      Number.isInteger(this.level) && this.level >= 1 && this.level <= 6 ? this.level : 3;
    return html`
      <div class="width"></div>
      <div
        class=${`line${this.mark === "sent" ? " mark-shown" : ""}${this.hasEnd ? " end-shown" : ""}`}
      >
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
      </div>
    `;
  }
}

/** How many lines the slotted text under `title` takes, by the tops of its text boxes, and whether
 * any of it is drawn past the title's box, as words that cannot break are. */
function measure(title: HTMLElement): { lines: number; overflows: boolean } {
  const slot = title.querySelector("slot")!;
  const room = title.getBoundingClientRect();
  const tops: number[] = [];
  let overflows = false;
  const words = document.createRange();
  for (const node of slot.assignedNodes({ flatten: true })) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (
      let text = node.nodeType === Node.TEXT_NODE ? node : walker.nextNode();
      text;
      text = walker.nextNode()
    ) {
      words.selectNodeContents(text);
      for (const box of words.getClientRects()) {
        if (box.width === 0) continue;
        if (box.right > room.right + 0.5) overflows = true;
        if (!tops.some((top) => Math.abs(top - box.top) < 2)) tops.push(box.top);
      }
    }
  }
  return { lines: tops.length, overflows };
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-course-heading": WtCourseHeading;
  }
}
