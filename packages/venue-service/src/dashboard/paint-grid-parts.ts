import { css, html, nothing, type ReactiveController, type ReactiveControllerHost } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { capturePointer, releasePointer } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { t } from "./strings.js";
import { clockAt } from "../day-paint.js";
import { stepMinuteAt } from "../paint-model.js";

/** A grid host: a Lit element whose shadow root draws the `.scroll`, `.heading` and `.day`
 *  parts these pieces look up. */
export type PaintGridHost = ReactiveControllerHost &
  HTMLElement & {
    readonly renderRoot: HTMLElement | DocumentFragment;
    readonly hasUpdated: boolean;
  };

/** A stroke down one column, in minutes from the changeover. */
export interface Stretch {
  key: string;
  start: number;
  end: number;
}

const DAY = 1440;
/** Quarter-hour rows in a day. */
export const ROWS = 96;
/** The most an autoscroll moves in one frame, in pixels. */
const MAX_SCROLL_STEP = 12;
/** How long a drag rests still inside an edge band before it scrolls, so a short or slow stroke
 *  near an edge paints only what was dragged. */
const BAND_DWELL_MS = 350;

function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** The minutes from the changeover at which each clock hour falls. */
export function hourMarks(cutover: string): number[] {
  const first = (60 - (clockMinutes(cutover) % 60)) % 60;
  return Array.from({ length: Math.ceil((DAY - first) / 60) }, (_, i) => first + i * 60);
}

/** The pinned time column, one label per clock hour. */
export function timeRuler(cutover: string) {
  return html`<div class="times" aria-hidden="true">
    ${hourMarks(cutover).map(
      (minute) =>
        html`<span class="hour" style=${styleMap({ top: `${(minute / DAY) * 100}%` })}
          >${clockAt(minute, cutover)}</span
        >`,
    )}
  </div>`;
}

/** A day column's hour lines. */
export function hourLines(cutover: string) {
  return hourMarks(cutover).map(
    (minute) =>
      html`<div class="line" style=${styleMap({ top: `${(minute / DAY) * 100}%` })}></div>`,
  );
}

/** Delete or Backspace with no Cmd, Ctrl or Alt held. */
export function isDeleteKey(event: KeyboardEvent): boolean {
  return (
    (event.key === "Delete" || event.key === "Backspace") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

export interface ColumnMenuItem {
  label: string;
  select: () => void;
}

/** A column heading's ⋮ menu: "Copy to…", Clear, then the host's own items. */
export function columnMenu(
  label: string,
  actions: { copy: () => void; clear: () => void },
  extra: readonly ColumnMenuItem[] = [],
) {
  return html`<wt-row-actions
    icon="kebab"
    align="end"
    label=${t("paint.day_options").replace("{day}", label)}
    ><wt-button variant="secondary" align="start" @click=${actions.copy}
      >${t("paint.copy_to")}</wt-button
    ><wt-button variant="secondary" align="start" @click=${actions.clear}
      >${t("paint.clear")}</wt-button
    >${extra.map(
      (item) =>
        html`<wt-button variant="secondary" align="start" @click=${item.select}
          >${item.label}</wt-button
        >`,
    )}</wt-row-actions
  >`;
}

const POPOVER_MARGIN = 8;

/** Opens `popup` below `trigger`, lined up with its start or end edge, kept on screen; with
 *  `flipAbove`, it sits above `trigger` instead when only there it fits without covering it. */
export function placePopover(
  popup: HTMLElement,
  trigger: HTMLElement,
  alignEnd: boolean,
  flipAbove = false,
): void {
  if (!popup.matches(":popover-open")) popup.showPopover({ source: trigger });
  const anchor = trigger.getBoundingClientRect();
  const box = popup.getBoundingClientRect();
  const left = alignEnd ? anchor.right - box.width : anchor.left;
  const above = anchor.top - box.height;
  const top =
    flipAbove &&
    anchor.bottom + box.height > innerHeight - POPOVER_MARGIN &&
    above >= POPOVER_MARGIN
      ? above
      : Math.max(
          POPOVER_MARGIN,
          Math.min(anchor.bottom, innerHeight - box.height - POPOVER_MARGIN),
        );
  popup.style.left = `${Math.max(POPOVER_MARGIN, Math.min(left, innerWidth - box.width - POPOVER_MARGIN))}px`;
  popup.style.top = `${top}px`;
}

/** Keeps `data-overflow` on the host naming the sides that have columns scrolled out of sight;
 *  the host calls `refresh()` from its `.scroll`'s scroll event. */
export class OverflowFade implements ReactiveController {
  readonly #host: PaintGridHost;
  readonly #sizes = new ResizeObserver(() => this.refresh());

  constructor(host: PaintGridHost) {
    this.#host = host;
    host.addController(this);
  }
  hostConnected(): void {
    if (this.#host.hasUpdated) this.#observe();
  }
  hostUpdated(): void {
    if (!this.#host.hasUpdated) this.#observe();
  }
  hostDisconnected(): void {
    this.#sizes.disconnect();
  }
  #observe(): void {
    for (const part of this.#host.renderRoot.querySelectorAll(".scroll, .layout"))
      this.#sizes.observe(part);
  }
  refresh(): void {
    const scroll = this.#host.renderRoot.querySelector<HTMLElement>(".scroll");
    if (scroll === null) return;
    const start = scroll.scrollLeft >= 1;
    const end = scroll.scrollWidth - scroll.clientWidth - scroll.scrollLeft >= 1;
    const overflow = start && end ? "both" : start ? "start" : end ? "end" : undefined;
    const dataset = this.#host.dataset;
    if (overflow === undefined) delete dataset.overflow;
    else if (dataset.overflow !== overflow) dataset.overflow = overflow;
  }
}

export interface ColumnStrokeOptions {
  cutover: () => string;
  /** Whether a primary-button press on this column begins a stroke. */
  canStart: (key: string) => boolean;
  /** Whether a stroke released now is kept. */
  canRelease: () => boolean;
  /** A kept stroke, already ended. */
  released: (stretch: Stretch) => void;
}

interface Gesture {
  pointerId: number;
  key: string;
  column: HTMLElement;
  /** The fixed end of the stretch. */
  anchor: number;
  /** The minute the press holds; the stroke covers nothing while the pointer is back on it. */
  origin: number;
  /** Pixels added to the pointer's height, so the press point reads as `origin`. */
  shift: number;
}

/** A pointer stroke down a `.day` column, scrolling the `.scroll` box when it rests in an hour-deep
 *  band at its top or bottom edge. The host draws `preview` and passes `start` the column's
 *  `pointerdown` and `abort` its `lostpointercapture`. */
export class ColumnStroke implements ReactiveController {
  readonly #host: PaintGridHost;
  readonly #options: ColumnStrokeOptions;
  #preview: Stretch | null = null;
  #gesture: Gesture | null = null;
  #dragged = false;
  #pointerY = 0;
  #frame: number | null = null;
  /** The edge band the pointer is in (-1 top, 1 bottom, 0 neither), where it last moved to and the
   *  frame time it has rested there since; `-Infinity` once it has scrolled or been past that edge,
   *  so moving on inside the band keeps scrolling. */
  #edge: { side: number; since: number | null; y: number } = { side: 0, since: null, y: 0 };

  constructor(host: PaintGridHost, options: ColumnStrokeOptions) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }
  hostDisconnected(): void {
    this.stop();
  }

  /** The stretch the stroke covers now, or null when it covers none. */
  get preview(): Stretch | null {
    return this.#preview;
  }
  #setPreview(preview: Stretch | null): void {
    if (preview === this.#preview) return;
    this.#preview = preview;
    this.#host.requestUpdate();
  }

  /** True once for the click that ends a kept stroke, which the host then ignores. */
  takeDraggedClick(): boolean {
    const dragged = this.#dragged;
    this.#dragged = false;
    return dragged;
  }
  /** A key press means the next click is not the end of a stroke. */
  forgetDrag(): void {
    this.#dragged = false;
  }

  #minuteAtY(clientY: number, column: HTMLElement): number {
    const box = column.getBoundingClientRect();
    return stepMinuteAt(clientY - box.top, box.height / ROWS, this.#options.cutover());
  }

  /** Begins a stroke from `anchor`, in minutes from the changeover — a block's far edge, to resize
   *  it from the near one — or from the minute under the pointer. With `held`, the press holds that
   *  minute — the near edge — and moves it by as far as the pointer moves. False when no stroke
   *  began. */
  start(event: PointerEvent, key: string, anchor?: number, held?: number): boolean {
    this.#dragged = false;
    if (event.button !== 0 || this.#gesture !== null || !this.#options.canStart(key)) return false;
    const column = event.currentTarget as HTMLElement;
    const box = column.getBoundingClientRect();
    const shift = held === undefined ? 0 : (held / DAY) * box.height + box.top - event.clientY;
    const origin = held ?? this.#minuteAtY(event.clientY, column);
    this.#gesture = {
      pointerId: event.pointerId,
      key,
      column,
      anchor: anchor ?? origin,
      origin,
      shift,
    };
    window.addEventListener("pointermove", this.#move);
    window.addEventListener("pointerup", this.#release);
    window.addEventListener("pointercancel", this.abort);
    return true;
  }
  #move = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    this.#pointerY = event.clientY;
    this.#stretchTo(event.clientY);
    const side = Math.sign(this.#edgeDepth().depth);
    const edge = this.#edge;
    if (side !== edge.side || (edge.since !== -Infinity && event.clientY !== edge.y))
      this.#edge = { side, since: null, y: event.clientY };
    if (side !== 0 && this.#frame === null) this.#frame = requestAnimationFrame(this.#autoscroll);
  };
  #stretchTo(clientY: number): void {
    const gesture = this.#gesture!;
    const minute = this.#minuteAtY(clientY + gesture.shift, gesture.column);
    // Captured only once it moves: a captured click lands on the column, not the block clicked.
    if (minute !== gesture.origin) capturePointer(gesture.column, gesture.pointerId);
    const start = Math.min(gesture.anchor, minute);
    const end = Math.max(gesture.anchor, minute);
    const preview = this.#preview;
    if (minute === gesture.origin || minute === gesture.anchor) this.#setPreview(null);
    else if (preview?.key !== gesture.key || preview.start !== start || preview.end !== end)
      this.#setPreview({ key: gesture.key, start, end });
  }
  /** How far, in pixels, the pointer is past the inner line of an edge band: negative at the top
   *  (below the column headings), positive at the bottom, 0 between. Each band is an hour of rows
   *  deep, so a grid that runs to the edge of the screen can still scroll. */
  #edgeDepth(): { depth: number; band: number } {
    const root = this.#host.renderRoot;
    const scroll = root.querySelector<HTMLElement>(".scroll");
    const day = root.querySelector<HTMLElement>(".day");
    if (scroll === null || day === null) return { depth: 0, band: 0 };
    const band = day.getBoundingClientRect().height / 24;
    const top =
      (root.querySelector<HTMLElement>(".heading")?.getBoundingClientRect().bottom ??
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
      this.#edge.since = -Infinity;
      const step = Math.max(1, Math.round((MAX_SCROLL_STEP * Math.min(into, band)) / band));
      this.#host.renderRoot.querySelector<HTMLElement>(".scroll")!.scrollTop += side * step;
      this.#stretchTo(this.#pointerY);
    }
    this.#frame = requestAnimationFrame(this.#autoscroll);
  };
  #release = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    this.#move(event);
    const stretch = this.#preview;
    this.stop();
    if (stretch === null || !this.#options.canRelease()) return;
    // The click a drag ends with comes in the same task as its pointerup; a later one is a real click.
    this.#dragged = true;
    setTimeout(() => {
      this.#dragged = false;
    });
    this.#options.released(stretch);
  };
  abort = (event: PointerEvent): void => {
    if (event.pointerId === this.#gesture?.pointerId) this.stop();
  };
  /** Ends any stroke without keeping it. */
  stop(): void {
    window.removeEventListener("pointermove", this.#move);
    window.removeEventListener("pointerup", this.#release);
    window.removeEventListener("pointercancel", this.abort);
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#edge = { side: 0, since: null, y: 0 };
    const gesture = this.#gesture;
    this.#gesture = null;
    this.#setPreview(null);
    if (gesture !== null) releasePointer(gesture.column, gesture.pointerId);
  }
}

export interface CopyChooserOptions {
  columns: () => readonly { key: string; label: string }[];
  /** The control the chooser opens beside and gives the focus back to. */
  trigger: (key: string) => HTMLElement | null;
  /** The ticked columns, in column order; the chooser has already closed. */
  copy: (from: string, to: string[]) => void;
}

/** The "Copy {day} to" chooser: ticks the other columns and reports them to its host, which
 *  draws `render()` and is asked to redraw as the ticks change. */
export class CopyChooser {
  readonly #host: PaintGridHost;
  readonly #options: CopyChooserOptions;
  #copying: { key: string; ticked: ReadonlySet<string> } | null = null;

  constructor(host: PaintGridHost, options: CopyChooserOptions) {
    this.#host = host;
    this.#options = options;
  }

  /** The column being copied while the chooser is open. */
  get from(): string | undefined {
    return this.#copying?.key;
  }
  #set(copying: { key: string; ticked: ReadonlySet<string> } | null): void {
    if (copying === null && this.#copying === null) return;
    this.#copying = copying;
    this.#host.requestUpdate();
  }
  get #popup(): HTMLElement | null {
    return this.#host.renderRoot.querySelector<HTMLElement>(".chooser");
  }

  async open(key: string): Promise<void> {
    this.#set({ key, ticked: new Set() });
    await this.#host.updateComplete;
    const popup = this.#popup!;
    placePopover(popup, this.#options.trigger(key)!, true);
    popup.querySelector<HTMLElement>('input[type="checkbox"]')?.focus();
  }
  close(refocus: boolean): void {
    const key = this.#copying?.key;
    if (this.#popup?.matches(":popover-open")) this.#popup.hidePopover();
    this.#set(null);
    if (refocus && key !== undefined) this.#options.trigger(key)?.focus();
  }
  #tick(key: string, checked: boolean): void {
    const copying = this.#copying;
    if (copying === null) return;
    const ticked = new Set(copying.ticked);
    if (checked) ticked.add(key);
    else ticked.delete(key);
    this.#set({ key: copying.key, ticked });
  }
  #copy(): void {
    const copying = this.#copying;
    if (copying === null || copying.ticked.size === 0) return;
    const to = this.#options
      .columns()
      .map(({ key }) => key)
      .filter((key) => copying.ticked.has(key));
    this.close(true);
    this.#options.copy(copying.key, to);
  }
  #onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || this.#copying === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  }

  render() {
    const copying = this.#copying;
    const columns = this.#options.columns();
    const from = columns.find(({ key }) => key === copying?.key);
    const heading = t("paint.copy_day_to").replace("{day}", from?.label ?? "");
    const ready = (copying?.ticked.size ?? 0) > 0;
    return html`<div
      class="chooser"
      id="copy-chooser"
      popover
      role="dialog"
      aria-label=${heading}
      @keydown=${(event: KeyboardEvent) => this.#onKeydown(event)}
      @toggle=${(event: ToggleEvent) => {
        if (event.newState === "closed") this.#set(null);
      }}
    >
      ${
        copying === null || from === undefined
          ? nothing
          : html`<h2>${heading}</h2>
              ${columns
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
                <wt-button variant="secondary" @click=${() => this.close(true)}
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
}

/** The grid's frame: the scroll box with its overflow fade, the column layout, the sticky
 *  headings, the time ruler, the day columns and their hour lines, and the popover menu and
 *  copy chooser. A host may stretch the days to a taller `--paint-grid-fill`. */
export const paintGridStyles = css`
  :host {
    display: block;
    color: var(--wt-color-text);
    font-family: var(--wt-font-family);
  }
  .scroll {
    --times-width: calc(var(--wt-space-6) * 2);
    /* The pinned time column, with the box's border before it, is never faded. */
    --fade-from: calc(var(--times-width) + 1px);
    --fade-start: 0px;
    --fade-end: 0px;
    box-sizing: border-box;
    overflow: auto;
    max-block-size: 100%;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-bg);
  }
  :host([data-overflow="start"]) .scroll,
  :host([data-overflow="both"]) .scroll {
    --fade-start: calc(var(--wt-space-6) * 2);
  }
  :host([data-overflow="end"]) .scroll,
  :host([data-overflow="both"]) .scroll {
    --fade-end: calc(var(--wt-space-6) * 2);
  }
  /* Fades the edge that has columns beyond it. A mask reads only alpha, and the background token
     is opaque in every theme. */
  :host([data-overflow]) .scroll {
    mask-image: linear-gradient(
      to right,
      var(--wt-color-bg) var(--fade-from),
      transparent var(--fade-from),
      var(--wt-color-bg) calc(var(--fade-from) + var(--fade-start)),
      var(--wt-color-bg) calc(100% - var(--fade-end)),
      transparent 100%
    );
  }
  .layout {
    display: grid;
    /* As wide as its columns, not the scroll box, so the pinned time column has room to stay. */
    width: max-content;
    min-width: 100%;
    grid-template-columns: var(--times-width) var(--column-tracks);
  }
  .heading {
    position: sticky;
    top: 0;
    z-index: 3;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    align-content: center;
    column-gap: var(--wt-space-1);
    white-space: nowrap;
    min-block-size: var(--wt-tap-min);
    background: var(--wt-color-surface);
    padding: 0 var(--wt-space-2);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    border-block-end: 1px solid var(--wt-color-border);
  }
  .heading ::slotted([slot^="column-head-"]) {
    grid-column: 1 / -1;
    padding-block-end: var(--wt-space-1);
    font-weight: var(--wt-font-weight-normal);
    color: var(--wt-color-text);
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
    height: max(calc(var(--wt-space-1) * 1.25 * ${ROWS}), var(--paint-grid-fill, 0px));
  }
  .times {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--wt-color-bg);
    border-inline-end: 1px solid var(--wt-color-border);
  }
  /* Each label hangs just under its hour line, as a block's label does, so the changeover's
     label at the very top is spaced like the rest. */
  .hour {
    position: absolute;
    inset-inline-start: var(--wt-space-1);
    padding-block-start: calc(var(--wt-space-1) / 2);
    font-size: var(--wt-font-size-sm);
    line-height: 1;
    color: var(--wt-color-text-muted);
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
`;
