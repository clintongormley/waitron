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

      /* Only here may a word break: beside the mark and action an unbreakable run is what moves them
         down, and the age phrase stays whole at every width where it fits. */
      :host([stacked]) .title {
        grid-column: 1 / -1;
        overflow-wrap: anywhere;
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

  #words?: MutationObserver;
  #watching = false;
  /** The width of the `.width` box when the title was last measured. */
  #width = -1;

  private static waiting = new Set<WtCourseHeading>();
  private static frame = 0;
  private static widths?: ResizeObserver;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#words = new MutationObserver(() => WtCourseHeading.layLater(this));
    this.#words.observe(this, { childList: true, subtree: true, characterData: true });
    // Lit does not update a reconnected element, so a heading put back in the page resumes here.
    if (this.hasUpdated) this.#watch();
  }

  override disconnectedCallback(): void {
    if (this.#watching) WtCourseHeading.widths!.unobserve(this.#widthBox());
    this.#watching = false;
    WtCourseHeading.waiting.delete(this);
    this.#words?.disconnect();
    this.#words = undefined;
    this.#width = -1;
    super.disconnectedCallback();
  }

  protected override updated(): void {
    this.#watch();
  }

  #widthBox(): Element {
    return this.renderRoot.querySelector(".width")!;
  }

  #watch(): void {
    if (!this.#watching) {
      // Watches a zero-height box, so stacking, which changes only the height, never re-triggers it.
      WtCourseHeading.widths ??= new ResizeObserver((entries) => {
        const due = new Set<WtCourseHeading>();
        for (const entry of entries) {
          const heading = (entry.target.getRootNode() as ShadowRoot).host as WtCourseHeading;
          if (entry.contentRect.width !== heading.#width) due.add(heading);
        }
        WtCourseHeading.layAll(due);
      });
      WtCourseHeading.widths.observe(this.#widthBox());
      this.#watching = true;
    }
    WtCourseHeading.layLater(this);
  }

  /** Every change before the next frame is laid out in that frame, at once. */
  private static layLater(heading: WtCourseHeading): void {
    WtCourseHeading.waiting.add(heading);
    WtCourseHeading.frame ||= requestAnimationFrame(() => {
      WtCourseHeading.frame = 0;
      WtCourseHeading.layAll(WtCourseHeading.waiting);
    });
  }

  /** Beside the mark and the action the title may take two lines; one that needs a third, or whose
   * unbreakable words are wider than the room left, moves them under it. Every heading is unstacked
   * before any is measured and restacked after all are, so no measurement waits for the page to be
   * laid out again after another heading's change. */
  private static layAll(headings: Iterable<WtCourseHeading>): void {
    const due = [...headings].filter((heading) => heading.isConnected && heading.hasUpdated);
    for (const heading of due) WtCourseHeading.waiting.delete(heading);
    const titles = due.map((heading) => {
      heading.removeAttribute("stacked");
      if (heading.mark !== "sent" && !heading.hasEnd) return undefined;
      return heading.renderRoot.querySelector<HTMLElement>(".title")!;
    });
    const stacked = due.map((heading, at) => {
      heading.#width = heading.#widthBox().getBoundingClientRect().width;
      const title = titles[at];
      return title !== undefined && needsRoom(title);
    });
    due.forEach((heading, at) => heading.toggleAttribute("stacked", stacked[at]));
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

/** Whether the slotted text under `title` takes more than two lines, by the tops of its text boxes,
 * or is drawn past the title's box anywhere, as words that cannot break are. */
function needsRoom(title: HTMLElement): boolean {
  const slot = title.querySelector("slot")!;
  const right = title.getBoundingClientRect().right;
  let lettering: Lettering | undefined;
  const letteringOf = () => {
    if (lettering === undefined) {
      const style = getComputedStyle(title);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      lettering = { font, letterSpacing: style.letterSpacing };
    }
    return lettering;
  };
  const tops: number[] = [];
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
        if (box.right - blankAfter(text as Text, box, right, letteringOf) > right + 0.5)
          return true;
        if (!tops.some((top) => Math.abs(top - box.top) < 2)) tops.push(box.top);
        if (tops.length > 2) return true;
      }
    }
  }
  return false;
}

type Lettering = { font: string; letterSpacing: string };

let pen: CanvasRenderingContext2D | null | undefined;

/** The blank after the ink of the last letter on `line`: its letter-spacing and side bearing, which
 * may stand past the title's right edge without drawing anything there. */
function blankAfter(text: Text, line: DOMRect, right: number, lettering: () => Lettering): number {
  if (line.right <= right) return 0;
  pen ??= document.createElement("canvas").getContext("2d");
  const letter = document.createRange();
  for (let at = text.length - 1; at >= 0 && pen; at--) {
    if (/\s/.test(text.data[at]!)) continue;
    letter.setStart(text, at);
    letter.setEnd(text, at + 1);
    if (Math.abs(letter.getBoundingClientRect().top - line.top) >= 2) continue;
    const { font, letterSpacing } = lettering();
    pen.font = font;
    pen.letterSpacing = letterSpacing;
    const drawn = pen.measureText(text.data[at]!.toUpperCase());
    return Math.max(0, drawn.width - drawn.actualBoundingBoxRight);
  }
  return 0;
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-course-heading": WtCourseHeading;
  }
}
