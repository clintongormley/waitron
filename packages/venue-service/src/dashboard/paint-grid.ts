import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { styleMap } from "lit/directives/style-map.js";
import { capturePointer, releasePointer } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { t } from "./strings.js";
import { periodColourStyles } from "./period-colour-styles.js";
import { clockAt, stepSpan } from "../day-paint.js";
import type { CalendarColour } from "../hours-types.js";
import {
  changeBlockPeriod,
  copyDay,
  deleteBlock,
  paintStretch,
  stepAt,
  type Paint,
} from "../paint-model.js";

export interface PaintColumn {
  key: string;
  label: string;
}
export interface PaintPeriod {
  id: string;
  name: string;
  colour: CalendarColour;
}
export interface PaintChange {
  key: string;
  day: Paint[];
}
interface Gesture {
  pointerId: number;
  key: string;
  column: HTMLElement;
  anchor: number;
}
interface Stretch {
  key: string;
  start: number;
  end: number;
}

const DAY = 1440;
const ROWS = 96;
/** The most an autoscroll moves in one frame, in pixels. */
const MAX_SCROLL_STEP = 12;
/** How long a drag rests inside an edge band before it scrolls, so a short stroke near an edge
 *  paints only what was dragged. */
const BAND_DWELL_MS = 350;

/** Delete or Backspace with no Cmd, Ctrl or Alt held. */
function isDeleteKey(event: KeyboardEvent): boolean {
  return (
    (event.key === "Delete" || event.key === "Backspace") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}
function samePaint(a: readonly Paint[], b: readonly Paint[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (paint, i) =>
        paint.periodId === b[i]!.periodId &&
        paint.startsAt === b[i]!.startsAt &&
        paint.endsAt === b[i]!.endsAt,
    )
  );
}

function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

@customElement("paint-grid")
export class PaintGrid extends LitElement {
  static override styles = [
    periodColourStyles,
    css`
      :host {
        display: block;
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
      }
      .scroll {
        box-sizing: border-box;
        overflow: auto;
        max-block-size: 100%;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-bg);
      }
      .layout {
        display: grid;
        grid-template-columns: calc(var(--wt-space-6) * 2) var(--column-tracks);
      }
      .heading {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-1);
        white-space: nowrap;
        background: var(--wt-color-surface);
        padding: 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        border-block-end: 1px solid var(--wt-color-border);
      }
      .heading[data-error] {
        color: var(--wt-color-danger);
        border-block-end: var(--wt-field-line-width-active) solid var(--wt-color-danger);
      }
      .column-error {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }
      .heading.corner {
        left: 0;
        z-index: 4;
      }
      .times,
      .day {
        position: relative;
        height: calc(var(--wt-space-1) * 1.25 * ${ROWS});
      }
      .times {
        position: sticky;
        left: 0;
        z-index: 2;
        background: var(--wt-color-bg);
        border-inline-end: 1px solid var(--wt-color-border);
      }
      .hour {
        position: absolute;
        inset-inline-start: var(--wt-space-1);
        transform: translateY(-50%);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .hour:first-child {
        transform: none;
      }
      .day {
        border-inline-start: 1px solid var(--wt-color-border);
        touch-action: none;
        user-select: none;
      }
      .day:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .line {
        position: absolute;
        inset-inline: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }
      .block,
      .all-closed,
      .preview {
        position: absolute;
        inset-inline: var(--wt-space-1);
        box-sizing: border-box;
        border: 0;
        border-radius: var(--wt-radius-sm);
        padding: 0 var(--wt-space-1);
        text-align: start;
        font: inherit;
        font-size: var(--wt-font-size-sm);
        overflow: hidden;
      }
      button.block {
        display: flex;
        flex-wrap: wrap;
        align-content: flex-start;
        column-gap: var(--wt-space-1);
        cursor: pointer;
      }
      button.block:focus-visible,
      button.block[aria-expanded="true"] {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
        z-index: 2;
      }
      .block span {
        font-weight: var(--wt-font-weight-bold);
      }
      .block[data-colour] {
        color: var(--period-on-fill);
      }
      .closed,
      .all-closed {
        --period-fill: repeating-linear-gradient(
          135deg,
          var(--wt-color-surface),
          var(--wt-color-surface) var(--wt-space-1),
          var(--wt-color-border) var(--wt-space-1),
          var(--wt-color-border) var(--wt-space-2)
        );
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
      }
      .block,
      .all-closed {
        background: var(--period-fill);
      }
      .all-closed {
        inset-block: 0;
        padding-block: var(--wt-space-1);
      }
      .underlay {
        isolation: isolate;
        background: transparent;
        color: var(--wt-color-text);
        pointer-events: none;
      }
      .underlay::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        background: var(--period-fill);
        opacity: var(--wt-opacity-disabled);
      }
      .preview {
        border: 2px dashed var(--wt-color-text);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        pointer-events: none;
        z-index: 3;
      }
      .preview[data-colour] {
        background: var(--period-fill);
      }
      .preview span {
        display: block;
      }
      .menu,
      .chooser {
        position: fixed;
        margin: 0;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
      .menu:popover-open,
      .chooser:popover-open {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .menu p {
        margin: 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .menu wt-button {
        width: 100%;
      }
      .chooser h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      .chooser label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      .chooser input[type="checkbox"] {
        accent-color: var(--wt-color-primary);
      }
      .chooser .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) columns: readonly PaintColumn[] = [];
  @property({ attribute: false }) days: ReadonlyMap<string, readonly Paint[]> = new Map();
  @property({ attribute: false }) underlay: ReadonlyMap<string, readonly Paint[]> = new Map();
  @property({ attribute: false }) periods: readonly PaintPeriod[] = [];
  /** The paint chip: a period id, `null` for Closed, `undefined` for nothing chosen. */
  @property({ attribute: false }) chosen: string | null | undefined = undefined;
  @property() cutover = "06:00";
  @property({ type: Boolean }) closedErases = true;
  /** A refused save's message per column key: the heading is marked and the day described by it. */
  @property({ attribute: false }) columnErrors: ReadonlyMap<string, string> = new Map();
  /** What a selected block may change to; every period and Closed when unset. */
  @property({ attribute: false }) paintable: readonly (string | null)[] | undefined = undefined;

  @state() private preview: Stretch | null = null;
  @state() private selected: { key: string; startsAt: string } | null = null;
  @state() private copying: { key: string; ticked: ReadonlySet<string> } | null = null;
  @query(".menu") private menu!: HTMLElement;
  @query(".chooser") private chooser!: HTMLElement;
  #gesture: Gesture | null = null;
  #dragged = false;
  #pointerY = 0;
  #frame: number | null = null;
  /** The edge band the pointer is in (-1 top, 1 bottom, 0 neither) and the frame time it entered;
   *  `-Infinity` once it has been past that edge, so coming back into the band keeps scrolling. */
  #edge: { side: number; since: number | null } = { side: 0, since: null };

  override disconnectedCallback(): void {
    this.#stop();
    super.disconnectedCallback();
  }
  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("days") && this.selected !== null && this.#selectedIndex() < 0)
      this.#closeMenu();
  }

  #day(key: string): readonly Paint[] {
    return this.days.get(key) ?? [];
  }
  #selectedIndex(): number {
    const selected = this.selected;
    if (selected === null) return -1;
    return this.#day(selected.key).findIndex(({ startsAt }) => startsAt === selected.startsAt);
  }
  #emit(key: string, day: Paint[]): void {
    this.dispatchEvent(
      new CustomEvent<PaintChange>("paint-change", {
        detail: { key, day },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #name(periodId: string | null): string {
    return periodId === null
      ? t("hours.closed")
      : (this.periods.find(({ id }) => id === periodId)?.name ?? "");
  }
  #colour(periodId: string | null): CalendarColour | undefined {
    return this.periods.find(({ id }) => id === periodId)?.colour;
  }

  /** Minutes from the changeover at a pointer offset. `stepAt` answers the changeover for both the
   *  top and the bottom row; the bottom half of the column reads it as the day's end. */
  #minuteAt(offset: number, height: number): number {
    const time = stepAt(offset, height / ROWS, this.cutover);
    const minute = (clockMinutes(time) - clockMinutes(this.cutover) + DAY) % DAY;
    return minute === 0 && offset > height / 2 ? DAY : minute;
  }
  #minuteAtY(clientY: number, key: string): number {
    const day = this.renderRoot.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
    const box = day.getBoundingClientRect();
    return this.#minuteAt(clientY - box.top, box.height);
  }

  #start(event: PointerEvent, key: string): void {
    this.#dragged = false;
    if (event.button !== 0 || this.chosen === undefined || this.#gesture !== null) return;
    const column = event.currentTarget as HTMLElement;
    this.#gesture = {
      pointerId: event.pointerId,
      key,
      column,
      anchor: this.#minuteAtY(event.clientY, key),
    };
    window.addEventListener("pointermove", this.#move);
    window.addEventListener("pointerup", this.#release);
    window.addEventListener("pointercancel", this.#abort);
  }
  #move = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    this.#pointerY = event.clientY;
    this.#stretchTo(event.clientY);
    const side = Math.sign(this.#edgeDepth().depth);
    if (side !== this.#edge.side) this.#edge = { side, since: null };
    if (side !== 0 && this.#frame === null) this.#frame = requestAnimationFrame(this.#autoscroll);
  };
  #stretchTo(clientY: number): void {
    const gesture = this.#gesture!;
    const minute = this.#minuteAtY(clientY, gesture.key);
    // Captured only once it moves: a captured click lands on the column, not the block clicked.
    if (minute !== gesture.anchor) capturePointer(gesture.column, gesture.pointerId);
    const start = Math.min(gesture.anchor, minute);
    const end = Math.max(gesture.anchor, minute);
    const preview = this.preview;
    if (minute === gesture.anchor) this.preview = null;
    else if (preview?.key !== gesture.key || preview.start !== start || preview.end !== end)
      this.preview = { key: gesture.key, start, end };
  }
  /** How far, in pixels, the pointer is past the inner line of an edge band: negative at the top
   *  (below the column headings), positive at the bottom, 0 between. Each band is an hour of rows
   *  deep, so a grid that runs to the edge of the screen can still scroll. */
  #edgeDepth(): { depth: number; band: number } {
    const scroll = this.renderRoot.querySelector<HTMLElement>(".scroll");
    const day = this.renderRoot.querySelector<HTMLElement>(".day");
    if (scroll === null || day === null) return { depth: 0, band: 0 };
    const band = day.getBoundingClientRect().height / 24;
    const top =
      (this.renderRoot.querySelector<HTMLElement>(".heading")?.getBoundingClientRect().bottom ??
        scroll.getBoundingClientRect().top) + band;
    const bottom = scroll.getBoundingClientRect().bottom - band;
    const depth =
      this.#pointerY < top ? this.#pointerY - top : Math.max(this.#pointerY - bottom, 0);
    return { depth, band };
  }
  #autoscroll = (now: number): void => {
    this.#frame = null;
    if (this.#gesture === null) return;
    const { depth, band } = this.#edgeDepth();
    const side = Math.sign(depth);
    if (side === 0) return;
    const into = Math.abs(depth);
    if (into > band) this.#edge.since = -Infinity;
    this.#edge.since ??= now;
    if (now - this.#edge.since >= BAND_DWELL_MS) {
      const step = Math.max(1, Math.round((MAX_SCROLL_STEP * Math.min(into, band)) / band));
      this.renderRoot.querySelector<HTMLElement>(".scroll")!.scrollTop += side * step;
      this.#stretchTo(this.#pointerY);
    }
    this.#frame = requestAnimationFrame(this.#autoscroll);
  };
  #release = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    this.#move(event);
    const stretch = this.preview;
    this.#stop();
    if (stretch === null || this.chosen === undefined) return;
    // The click a drag ends with comes in the same task as its pointerup; a later one is a real click.
    this.#dragged = true;
    setTimeout(() => {
      this.#dragged = false;
    });
    this.#emit(
      stretch.key,
      paintStretch(
        this.#day(stretch.key),
        {
          periodId: this.chosen,
          startsAt: clockAt(stretch.start, this.cutover),
          endsAt: clockAt(stretch.end, this.cutover),
        },
        this.cutover,
        this.closedErases,
      ),
    );
  };
  #abort = (event: PointerEvent): void => {
    if (event.pointerId === this.#gesture?.pointerId) this.#stop();
  };
  #stop(): void {
    window.removeEventListener("pointermove", this.#move);
    window.removeEventListener("pointerup", this.#release);
    window.removeEventListener("pointercancel", this.#abort);
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#edge = { side: 0, since: null };
    const gesture = this.#gesture;
    this.#gesture = null;
    this.preview = null;
    if (gesture !== null) releasePointer(gesture.column, gesture.pointerId);
  }

  async #select(key: string, startsAt: string, trigger: HTMLElement): Promise<void> {
    if (this.#dragged) {
      this.#dragged = false;
      return;
    }
    this.selected = { key, startsAt };
    await this.updateComplete;
    if (!this.menu.matches(":popover-open")) this.menu.showPopover({ source: trigger });
    const anchor = trigger.getBoundingClientRect();
    const popup = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popup.width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
    this.menu.querySelector<HTMLElement>("wt-button:not([disabled])")?.focus();
  }
  #closeMenu(): void {
    if (this.menu?.matches(":popover-open")) this.menu.hidePopover();
    this.selected = null;
  }
  /** Focuses the block starting at `startsAt` once the host has redrawn, else the column. */
  async #focusAfter(key: string, startsAt: string | undefined): Promise<void> {
    await this.updateComplete;
    const column = this.renderRoot.querySelector<HTMLElement>(`.day[data-column="${key}"]`);
    const target =
      startsAt === undefined
        ? null
        : (column?.querySelector<HTMLElement>(`button.block[data-starts="${startsAt}"]`) ?? null);
    (target ?? column)?.focus();
  }
  #onMenuKeydown(event: KeyboardEvent): void {
    const selected = this.selected;
    if (selected === null) return;
    const target = event.composedPath()[0];
    if (
      isDeleteKey(event) &&
      !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault();
      this.#delete();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.#closeMenu();
    void this.#focusAfter(selected.key, selected.startsAt);
  }
  #change(periodId: string | null): void {
    const selected = this.selected;
    const index = this.#selectedIndex();
    if (selected === null || index < 0) return;
    this.#closeMenu();
    const day = changeBlockPeriod(
      this.#day(selected.key),
      index,
      periodId,
      this.cutover,
      this.closedErases,
    );
    const [from] = stepSpan(this.#day(selected.key)[index]!, this.cutover);
    const covering = day.find((paint) => {
      const [start, end] = stepSpan(paint, this.cutover);
      return start <= from && from < end;
    });
    this.#emit(selected.key, day);
    void this.#focusAfter(selected.key, covering?.startsAt);
  }
  #delete(): void {
    const selected = this.selected;
    const index = this.#selectedIndex();
    if (selected === null || index < 0) return;
    this.#closeMenu();
    this.#deleteAt(selected.key, index);
  }
  #deleteAt(key: string, index: number): void {
    const day = deleteBlock(this.#day(key), index);
    this.#emit(key, day);
    void this.#focusAfter(key, (day[index] ?? day[index - 1])?.startsAt);
  }
  #onBlockKeydown(event: KeyboardEvent, key: string, startsAt: string): void {
    if (!isDeleteKey(event)) return;
    event.preventDefault();
    const index = this.#day(key).findIndex((paint) => paint.startsAt === startsAt);
    if (index < 0) return;
    this.#closeMenu();
    this.#deleteAt(key, index);
  }

  #columnMenu(key: string): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(
      `.heading[data-column="${key}"] wt-row-actions`,
    );
  }
  async #openChooser(key: string): Promise<void> {
    this.copying = { key, ticked: new Set() };
    await this.updateComplete;
    const trigger = this.#columnMenu(key)!;
    if (!this.chooser.matches(":popover-open")) this.chooser.showPopover({ source: trigger });
    const anchor = trigger.getBoundingClientRect();
    const popup = this.chooser.getBoundingClientRect();
    this.chooser.style.left = `${Math.max(8, Math.min(anchor.right - popup.width, innerWidth - popup.width - 8))}px`;
    this.chooser.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
    this.chooser.querySelector<HTMLElement>('input[type="checkbox"]')?.focus();
  }
  #closeChooser(refocus: boolean): void {
    const key = this.copying?.key;
    if (this.chooser?.matches(":popover-open")) this.chooser.hidePopover();
    this.copying = null;
    if (refocus && key !== undefined) this.#columnMenu(key)?.focus();
  }
  #tick(key: string, checked: boolean): void {
    const copying = this.copying;
    if (copying === null) return;
    const ticked = new Set(copying.ticked);
    if (checked) ticked.add(key);
    else ticked.delete(key);
    this.copying = { key: copying.key, ticked };
  }
  #copy(): void {
    const copying = this.copying;
    if (copying === null || copying.ticked.size === 0) return;
    const to = this.columns.map(({ key }) => key).filter((key) => copying.ticked.has(key));
    const copied = copyDay(this.days, copying.key, to);
    this.#closeChooser(true);
    for (const key of to)
      if (!samePaint(copied.get(key)!, this.#day(key))) this.#emit(key, copied.get(key)!);
  }
  #clear(key: string): void {
    if (this.#day(key).length > 0) this.#emit(key, []);
  }
  #onChooserKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || this.copying === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.#closeChooser(true);
  }

  #position(start: number, end: number) {
    return styleMap({ top: `${(start / DAY) * 100}%`, height: `${((end - start) / DAY) * 100}%` });
  }
  #block(column: PaintColumn, paint: Paint, index: number) {
    const [start, end] = stepSpan(paint, this.cutover);
    const name = this.#name(paint.periodId);
    const expanded = this.selected?.key === column.key && this.selected.startsAt === paint.startsAt;
    return html`<button
      type="button"
      class=${paint.periodId === null ? "block closed" : "block"}
      data-index=${index}
      data-starts=${paint.startsAt}
      data-colour=${this.#colour(paint.periodId) ?? nothing}
      aria-label=${`${column.label}, ${name} ${paint.startsAt}–${paint.endsAt}`}
      aria-haspopup="dialog"
      aria-controls="block-menu"
      aria-expanded=${expanded ? "true" : "false"}
      style=${this.#position(start, end)}
      @click=${(event: Event) =>
        void this.#select(column.key, paint.startsAt, event.currentTarget as HTMLElement)}
      @keydown=${(event: KeyboardEvent) => this.#onBlockKeydown(event, column.key, paint.startsAt)}
    >
      <span>${name}</span> ${paint.startsAt}–${paint.endsAt}
    </button>`;
  }
  #underlay(paint: Paint) {
    const [start, end] = stepSpan(paint, this.cutover);
    return html`<div
      class=${paint.periodId === null ? "block underlay closed" : "block underlay"}
      data-colour=${this.#colour(paint.periodId) ?? nothing}
      style=${this.#position(start, end)}
    >
      ${this.#name(paint.periodId)}
    </div>`;
  }
  #preview(column: PaintColumn) {
    const stretch = this.preview;
    if (stretch === null || stretch.key !== column.key || this.chosen === undefined) return nothing;
    const replaced = [
      ...new Set(
        this.#day(column.key)
          .filter((paint) => {
            const [start, end] = stepSpan(paint, this.cutover);
            return paint.periodId !== this.chosen && start < stretch.end && stretch.start < end;
          })
          .map((paint) => this.#name(paint.periodId)),
      ),
    ];
    const colour = this.#colour(this.chosen);
    return html`<div
      class=${colour === undefined ? "preview closed" : "preview block"}
      data-colour=${colour ?? nothing}
      style=${this.#position(stretch.start, stretch.end)}
    >
      <span
        >${`${this.#name(this.chosen)} ${clockAt(stretch.start, this.cutover)}–${clockAt(stretch.end, this.cutover)}`}</span
      >${
        replaced.length > 0
          ? html`<span>${t("paint.replaces").replace("{names}", replaced.join(", "))}</span>`
          : nothing
      }
    </div>`;
  }
  #menu() {
    const selected = this.selected;
    const paint = selected === null ? undefined : this.#day(selected.key)[this.#selectedIndex()];
    const choices = this.paintable ?? [...this.periods.map(({ id }) => id), null];
    return html`<div
      class="menu"
      id="block-menu"
      popover
      role="dialog"
      aria-label=${
        paint === undefined
          ? t("paint.change_to")
          : `${this.#name(paint.periodId)} ${paint.startsAt}–${paint.endsAt}`
      }
      @keydown=${(event: KeyboardEvent) => this.#onMenuKeydown(event)}
      @toggle=${(event: ToggleEvent) => {
        if (event.newState === "closed") this.selected = null;
      }}
    >
      ${
        paint === undefined
          ? nothing
          : html`<p>${t("paint.change_to")}</p>
              ${choices.map(
                (periodId) =>
                  html`<wt-button
                    variant="secondary"
                    align="start"
                    ?disabled=${periodId === paint.periodId}
                    @click=${() => this.#change(periodId)}
                    >${this.#name(periodId)}</wt-button
                  >`,
              )}
              <wt-button variant="danger" align="start" @click=${() => this.#delete()}
                >${t("paint.delete")}</wt-button
              >`
      }
    </div>`;
  }

  #chooser() {
    const copying = this.copying;
    const from = this.columns.find(({ key }) => key === copying?.key);
    const heading = t("paint.copy_day_to").replace("{day}", from?.label ?? "");
    const ready = (copying?.ticked.size ?? 0) > 0;
    return html`<div
      class="chooser"
      id="copy-chooser"
      popover
      role="dialog"
      aria-label=${heading}
      @keydown=${(event: KeyboardEvent) => this.#onChooserKeydown(event)}
      @toggle=${(event: ToggleEvent) => {
        if (event.newState === "closed") this.copying = null;
      }}
    >
      ${
        copying === null || from === undefined
          ? nothing
          : html`<h2>${heading}</h2>
              ${this.columns
                .filter(({ key }) => key !== copying.key)
                .map(
                  ({ key, label }) =>
                    html`<label
                      ><input
                        type="checkbox"
                        name=${`copyTo-${key}`}
                        .checked=${copying.ticked.has(key)}
                        @change=${(event: Event) =>
                          this.#tick(key, (event.target as HTMLInputElement).checked)}
                      />${label}</label
                    >`,
                )}
              <div class="actions">
                <wt-button variant="secondary" @click=${() => this.#closeChooser(true)}
                  >${t("hours.cancel")}</wt-button
                >
                <wt-button
                  variant=${ready ? "primary" : "secondary"}
                  ?disabled=${!ready}
                  @click=${() => this.#copy()}
                  >${t("paint.copy")}</wt-button
                >
              </div>`
      }
    </div>`;
  }

  override render() {
    const first = (60 - (clockMinutes(this.cutover) % 60)) % 60;
    const hours = Array.from({ length: Math.ceil((DAY - first) / 60) }, (_, i) => first + i * 60);
    return html`<div class="scroll" role="region" aria-label=${t("paint.grid")}>
        <div
          class="layout"
          style=${styleMap({
            "--column-tracks": `repeat(${this.columns.length}, minmax(calc(var(--wt-space-6) * 4), 1fr))`,
          })}
        >
          <div class="heading corner"></div>
          ${this.columns.map(
            (column) =>
              html`<div
                class="heading"
                data-column=${column.key}
                ?data-error=${this.columnErrors.has(column.key)}
              >
                <span>${column.label}</span>${
                  this.columnErrors.has(column.key)
                    ? html`<span class="column-error" id=${`column-error-${column.key}`}
                        >${this.columnErrors.get(column.key)}</span
                      >`
                    : nothing
                }
                ><slot name=${`column-menu-${column.key}`}
                  ><wt-row-actions
                    icon="kebab"
                    align="end"
                    label=${t("paint.day_options").replace("{day}", column.label)}
                    ><wt-button
                      variant="secondary"
                      align="start"
                      @click=${() => void this.#openChooser(column.key)}
                      >${t("paint.copy_to")}</wt-button
                    ><wt-button
                      variant="secondary"
                      align="start"
                      @click=${() => this.#clear(column.key)}
                      >${t("paint.clear")}</wt-button
                    ></wt-row-actions
                  ></slot
                >
              </div>`,
          )}
          <div class="times" aria-hidden="true">
            ${hours.map(
              (minute) =>
                html`<span class="hour" style=${styleMap({ top: `${(minute / DAY) * 100}%` })}
                  >${clockAt(minute, this.cutover)}</span
                >`,
            )}
          </div>
          ${this.columns.map((column) => {
            const day = this.#day(column.key);
            return html`<div
              class="day"
              role="group"
              aria-label=${column.label}
              aria-describedby=${ifDefined(
                this.columnErrors.has(column.key) ? `column-error-${column.key}` : undefined,
              )}
              data-column=${column.key}
              tabindex="-1"
              @lostpointercapture=${this.#abort}
              @pointerdown=${(event: PointerEvent) => this.#start(event, column.key)}
              @keydown=${() => {
                this.#dragged = false;
              }}
            >
              ${hours.map(
                (minute) =>
                  html`<div
                    class="line"
                    style=${styleMap({ top: `${(minute / DAY) * 100}%` })}
                  ></div>`,
              )}
              ${(this.underlay.get(column.key) ?? []).map((paint) => this.#underlay(paint))}
              ${
                this.closedErases && day.length === 0
                  ? html`<div class="all-closed">${t("paint.closed_all_day")}</div>`
                  : nothing
              }
              ${day.map((paint, index) => this.#block(column, paint, index))}
              ${this.#preview(column)}
            </div>`;
          })}
        </div>
      </div>
      ${this.#menu()} ${this.#chooser()}`;
  }
}

declare global {
  interface HTMLElementEventMap {
    "paint-change": CustomEvent<PaintChange>;
  }
  interface HTMLElementTagNameMap {
    "paint-grid": PaintGrid;
  }
}
