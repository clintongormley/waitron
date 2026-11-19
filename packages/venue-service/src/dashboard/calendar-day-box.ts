import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import type { DayPoint } from "./day-picking.js";
import { flatParent, scrollTargets } from "./flat-tree.js";
import { format } from "./hours-view.js";
import { stationIcon } from "./station-icon.js";
import { placePopover } from "./painter.js";

export interface DayBoxRow {
  name: string;
  station?: boolean;
  text: string;
  additionalRanges?: readonly string[];
  spokenText?: string;
  /** Starts a section when the box uses sectioned rows. */
  strong?: boolean;
  inheritedFrom?: string;
}

/** Sends `calendar-day-box-close` when it closes; season actions use the named slot, other actions
 *  the default slot. */
@customElement("calendar-day-box")
export class CalendarDayBox extends LitElement {
  static override styles = [
    baseStyles,
    css`
      [popover] {
        position: fixed;
        inset: auto;
        left: 0;
        top: 0;
        margin: 0;
        box-sizing: border-box;
        width: max-content;
        max-width: min(var(--wt-modal-compact-width), calc(100vw - 2 * var(--wt-space-2)));
        max-height: calc(100vh - 2 * var(--wt-space-2));
        overflow: auto;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
        overflow-wrap: anywhere;
      }
      [popover].sectioned {
        width: var(--wt-modal-standard-width);
        max-width: min(var(--wt-modal-standard-width), calc(100vw - 2 * var(--wt-space-2)));
      }
      wt-icon {
        margin-inline-end: var(--wt-space-1);
        vertical-align: middle;
      }
      h2 {
        display: inline;
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      h2:focus {
        outline: none;
      }
      .name {
        margin-inline-start: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .season {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-1);
      }
      .season[hidden] {
        display: none;
      }
      .season .line {
        margin: 0;
      }
      .inherited {
        color: var(--wt-color-text-muted);
        font-style: italic;
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      .line,
      .message {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-danger);
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-1) var(--wt-space-3);
        margin: var(--wt-space-2) 0 0;
      }
      dl:has(dd > [aria-hidden="true"]) {
        grid-template-columns: fit-content(40%) 1fr;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dl.sectioned dt {
        color: var(--wt-color-text);
      }
      dt.heading {
        grid-column: 1 / -1;
      }
      dd[hidden] {
        display: none;
      }
      dt.strong {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }
      dd {
        margin: 0;
      }
      .range {
        display: inline-block;
        max-width: 100%;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-3);
      }
      .actions[hidden] {
        display: none;
      }
    `,
  ];

  @property() heading = "";
  @property() stationName = "";
  @property() name = "";
  @property() nameKind: "special" | "holiday" | "" = "";
  @property() line = "";
  @property({ type: Boolean }) linkedLine = false;
  @property({ attribute: false }) rows: readonly DayBoxRow[] = [];
  @property({ type: Boolean }) sectioned = false;
  @property() message = "";
  /** A failed read, drawn as an alert beside the rows it leaves shown, if any. */
  @property() error = "";

  @query("[popover]") private popup!: HTMLElement;
  @query("h2") private headingEl!: HTMLElement;

  @state() private hasActions = false;
  @state() private hasSeasonActions = false;

  #anchor: HTMLElement | undefined;
  #point?: DayPoint;
  #returnTo?: HTMLElement;
  #focusWasInside = false;
  #scrollTargets: EventTarget[] = [];
  readonly #size = new ResizeObserver(() => {
    if (this.shown) this.#place();
  });

  /** The anchor owns clipping; a separate return target can own focus. */
  show(anchor: HTMLElement, point?: DayPoint, returnTo: HTMLElement = anchor): void {
    this.#returnTo = returnTo;
    this.#point = point;
    this.#anchor = anchor;
    const opening = !this.popup.matches(":popover-open");
    this.#place();
    this.#follow(anchor);
    if (opening) this.headingEl.focus();
  }

  #place(): void {
    placePopover(this.popup, this.#anchor!, false, true, this.#point);
  }

  #follow(anchor: HTMLElement): void {
    this.#stopFollowing();
    this.#scrollTargets = scrollTargets(anchor);
    for (const target of this.#scrollTargets)
      target.addEventListener("scroll", this.#onScroll, { capture: true, passive: true });
    window.addEventListener("resize", this.#onResize, { passive: true });
    this.#size.observe(this.popup);
  }

  #stopFollowing(): void {
    this.#size.disconnect();
    for (const target of this.#scrollTargets.splice(0))
      target.removeEventListener("scroll", this.#onScroll, { capture: true });
    window.removeEventListener("resize", this.#onResize);
  }

  // Held on screen, a box whose date has gone would sit beside some other day.
  readonly #onScroll = (): void => {
    if (this.#anchorInView()) this.#place();
    else this.hide();
  };

  readonly #onResize = this.#onScroll;

  #anchorInView(): boolean {
    const date = this.#anchor!.getBoundingClientRect();
    let top = Math.max(date.top, 0);
    let left = Math.max(date.left, 0);
    let bottom = Math.min(date.bottom, innerHeight);
    let right = Math.min(date.right, innerWidth);
    // The window bounds already stand for the root element's own scrolling.
    for (
      let at = flatParent(this.#anchor!);
      at !== null && at !== document.documentElement;
      at = flatParent(at)
    ) {
      const style = getComputedStyle(at);
      const clipsY = style.overflowY !== "visible";
      const clipsX = style.overflowX !== "visible";
      if (!clipsX && !clipsY) continue;
      const clip = at.getBoundingClientRect();
      if (clipsY) {
        top = Math.max(top, clip.top + at.clientTop);
        bottom = Math.min(bottom, clip.top + at.clientTop + at.clientHeight);
      }
      if (clipsX) {
        left = Math.max(left, clip.left + at.clientLeft);
        right = Math.min(right, clip.left + at.clientLeft + at.clientWidth);
      }
    }
    return top < bottom && left < right;
  }

  override disconnectedCallback(): void {
    this.#stopFollowing();
    super.disconnectedCallback();
  }

  get shown(): boolean {
    return this.popup.matches(":popover-open");
  }

  hide(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  }

  #beforeToggle(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    this.#stopFollowing();
    this.#focusWasInside =
      this.shadowRoot!.activeElement !== null ||
      this.contains((this.getRootNode() as Document | ShadowRoot).activeElement);
  }

  #toggle(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    if (this.#focusWasInside) this.#returnTo?.focus({ preventScroll: true });
    this.dispatchEvent(
      new CustomEvent("calendar-day-box-close", { bubbles: true, composed: true }),
    );
  }

  #sections(): DayBoxRow[][] {
    const sections: DayBoxRow[][] = [];
    for (const row of this.rows) {
      if (row.strong || !sections.length) sections.push([]);
      sections.at(-1)!.push(row);
    }
    return sections;
  }

  #rowText({ text, additionalRanges }: DayBoxRow) {
    const ranges = additionalRanges
      ? [text, ...additionalRanges]
      : this.sectioned
        ? text.split(" · ")
        : undefined;
    return (
      ranges?.map(
        (range, index) =>
          html`${index ? " " : nothing}<span class="range"
              >${range}${index < ranges.length - 1 ? "\u00a0·" : nothing}</span
            >`,
      ) ?? text
    );
  }

  #rows(rows: readonly DayBoxRow[]) {
    return html`<dl class=${this.sectioned ? "sectioned" : ""}>
      ${rows.map(
        (row) => html`
          <dt
            class=${`${row.strong ? "strong" : ""} ${this.sectioned && !row.text ? "heading" : ""}`}
          >
            ${row.station ? stationIcon() : nothing}${row.name}
          </dt>
          <dd
            ?hidden=${this.sectioned && !row.text}
            class=${row.inheritedFrom !== undefined ? "inherited" : ""}
          >
            ${
              row.spokenText === undefined
                ? this.#rowText(row)
                : html`<span aria-hidden="true">${this.#rowText(row)}</span
                    ><span class="visually-hidden">${row.spokenText}</span>`
            }${row.inheritedFrom !== undefined ? html`<span class="visually-hidden">, ${format("day.as_department", { name: row.inheritedFrom })}</span>` : nothing}
          </dd>
        `,
      )}
    </dl>`;
  }

  protected override render() {
    return html`<div
      popover="auto"
      class=${this.sectioned ? "sectioned" : ""}
      role="dialog"
      aria-labelledby="heading"
      @beforetoggle=${this.#beforeToggle}
      @toggle=${this.#toggle}
    >
      <h2 id="heading" tabindex="-1">
        ${this.heading}${this.stationName ? html` ${stationIcon()} ${this.stationName}` : nothing}
      </h2>
      ${
        this.name
          ? html`<span class="name" data-test="name" data-kind=${this.nameKind}>${this.name}</span>`
          : nothing
      }
      <div class="season" ?hidden=${!this.line && !this.hasSeasonActions}>
        ${this.line && !this.linkedLine ? html`<p class="line" data-test="line">${this.line}</p>` : nothing}
        <slot
          name="season-action"
          @slotchange=${(event: Event) => (this.hasSeasonActions = (event.target as HTMLSlotElement).assignedElements().length > 0)}
        ></slot>
      </div>
      ${this.error ? html`<p class="error" data-test="error" role="alert">${this.error}</p>` : nothing}
      ${
        this.message
          ? html`<p class="message" data-test="message" role="status">${this.message}</p>`
          : this.rows.length === 0
            ? nothing
            : this.sectioned
              ? this.#sections().map(
                  (rows) =>
                    html`<section aria-label=${rows[0]!.name}>${this.#rows(rows)}</section>`,
                )
              : this.#rows(this.rows)
      }
      <div class="actions" ?hidden=${!this.hasActions}>
        <slot
          @slotchange=${(event: Event) =>
            (this.hasActions = (event.target as HTMLSlotElement).assignedElements().length > 0)}
        ></slot>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "calendar-day-box": CalendarDayBox;
  }
}
