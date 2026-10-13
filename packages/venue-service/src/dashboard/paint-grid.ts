import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "./strings.js";
import { clockAt, stepSpan } from "../day-paint.js";
import type { CalendarColour } from "../hours-types.js";
import {
  changeBlockPeriod,
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
  anchor: number;
}
interface Stretch {
  key: string;
  start: number;
  end: number;
}

const DAY = 1440;
const ROWS = 96;

function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

@customElement("paint-grid")
export class PaintGrid extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--wt-color-text);
      font-family: var(--wt-font-family);
    }
    .scroll {
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
      padding: var(--wt-space-1) var(--wt-space-2);
      font-size: var(--wt-font-size-sm);
      font-weight: var(--wt-font-weight-bold);
      border-block-end: 1px solid var(--wt-color-border);
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
      outline: 2px solid var(--wt-color-focus);
      outline-offset: 1px;
      z-index: 2;
    }
    .block span {
      font-weight: var(--wt-font-weight-bold);
    }
    .block[data-colour="red"] {
      --period-fill: var(--wt-color-palette-red);
      color: var(--wt-color-on-palette-red);
    }
    .block[data-colour="amber"] {
      --period-fill: var(--wt-color-palette-amber);
      color: var(--wt-color-on-palette-amber);
    }
    .block[data-colour="grey"] {
      --period-fill: var(--wt-color-palette-grey);
      color: var(--wt-color-on-palette-grey);
    }
    .block[data-colour="blue"] {
      --period-fill: var(--wt-color-palette-blue);
      color: var(--wt-color-on-palette-blue);
    }
    .block[data-colour="green"] {
      --period-fill: var(--wt-color-palette-green);
      color: var(--wt-color-on-palette-green);
    }
    .block[data-colour="purple"] {
      --period-fill: var(--wt-color-palette-purple);
      color: var(--wt-color-on-palette-purple);
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
    .menu {
      position: fixed;
      margin: 0;
      padding: var(--wt-space-2);
      border: 1px solid var(--wt-color-border);
      border-radius: var(--wt-radius-md);
      background: var(--wt-color-surface);
      color: var(--wt-color-text);
      box-shadow: var(--wt-shadow-2);
    }
    .menu:popover-open {
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
  `;

  @property({ attribute: false }) columns: readonly PaintColumn[] = [];
  @property({ attribute: false }) days: ReadonlyMap<string, readonly Paint[]> = new Map();
  @property({ attribute: false }) underlay: ReadonlyMap<string, readonly Paint[]> = new Map();
  @property({ attribute: false }) periods: readonly PaintPeriod[] = [];
  /** The paint chip: a period id, `null` for Closed, `undefined` for nothing chosen. */
  @property({ attribute: false }) chosen: string | null | undefined = undefined;
  @property() cutover = "06:00";
  @property({ type: Boolean }) closedErases = true;
  /** What a selected block may change to; every period and Closed when unset. */
  @property({ attribute: false }) paintable: readonly (string | null)[] | undefined = undefined;

  @state() private preview: Stretch | null = null;
  @state() private selected: { key: string; index: number } | null = null;
  @query(".menu") private menu!: HTMLElement;
  #gesture: Gesture | null = null;
  #dragged = false;

  override disconnectedCallback(): void {
    this.#stop();
    super.disconnectedCallback();
  }

  #day(key: string): readonly Paint[] {
    return this.days.get(key) ?? [];
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
  #offsetMinute(event: PointerEvent, key: string): number {
    const day = this.renderRoot.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
    const box = day.getBoundingClientRect();
    return this.#minuteAt(event.clientY - box.top, box.height);
  }

  #start(event: PointerEvent, key: string): void {
    if (event.button !== 0 || this.chosen === undefined || this.#gesture !== null) return;
    this.#dragged = false;
    this.#gesture = { pointerId: event.pointerId, key, anchor: this.#offsetMinute(event, key) };
    window.addEventListener("pointermove", this.#move);
    window.addEventListener("pointerup", this.#release);
    window.addEventListener("pointercancel", this.#abort);
  }
  #move = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    const minute = this.#offsetMinute(event, gesture.key);
    this.preview =
      minute === gesture.anchor
        ? null
        : {
            key: gesture.key,
            start: Math.min(gesture.anchor, minute),
            end: Math.max(gesture.anchor, minute),
          };
  };
  #release = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    this.#move(event);
    const stretch = this.preview;
    this.#stop();
    if (stretch === null || this.chosen === undefined) return;
    this.#dragged = true;
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
    this.#gesture = null;
    this.preview = null;
  }

  async #select(key: string, index: number, trigger: HTMLElement): Promise<void> {
    if (this.#dragged) {
      this.#dragged = false;
      return;
    }
    this.selected = { key, index };
    await this.updateComplete;
    if (!this.menu.matches(":popover-open")) this.menu.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const popup = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popup.width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
    this.menu.querySelector<HTMLElement>("wt-button:not([disabled])")?.focus();
  }
  #closeMenu(): void {
    if (this.menu.matches(":popover-open")) this.menu.hidePopover();
    this.selected = null;
  }
  #change(periodId: string | null): void {
    const selected = this.selected;
    if (selected === null) return;
    this.#closeMenu();
    this.#emit(
      selected.key,
      changeBlockPeriod(
        this.#day(selected.key),
        selected.index,
        periodId,
        this.cutover,
        this.closedErases,
      ),
    );
  }
  #delete(): void {
    const selected = this.selected;
    if (selected === null) return;
    this.#closeMenu();
    this.#emit(selected.key, deleteBlock(this.#day(selected.key), selected.index));
  }

  #position(start: number, end: number) {
    return styleMap({ top: `${(start / DAY) * 100}%`, height: `${((end - start) / DAY) * 100}%` });
  }
  #block(column: PaintColumn, paint: Paint, index: number) {
    const [start, end] = stepSpan(paint, this.cutover);
    const name = this.#name(paint.periodId);
    const expanded = this.selected?.key === column.key && this.selected.index === index;
    return html`<button
      type="button"
      class=${paint.periodId === null ? "block closed" : "block"}
      data-index=${index}
      data-colour=${this.#colour(paint.periodId) ?? nothing}
      aria-label=${`${column.label}, ${name} ${paint.startsAt}–${paint.endsAt}`}
      aria-haspopup="true"
      aria-expanded=${expanded ? "true" : "false"}
      style=${this.#position(start, end)}
      @click=${(event: Event) =>
        void this.#select(column.key, index, event.currentTarget as HTMLElement)}
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
      role="status"
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
    const paint = selected === null ? undefined : this.#day(selected.key)[selected.index];
    const choices = this.paintable ?? [...this.periods.map(({ id }) => id), null];
    return html`<div
      class="menu"
      popover
      role="group"
      aria-label=${
        paint === undefined
          ? t("paint.change_to")
          : `${this.#name(paint.periodId)} ${paint.startsAt}–${paint.endsAt}`
      }
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
              html`<div class="heading" data-column=${column.key}>
                <span>${column.label}</span><slot name=${`column-menu-${column.key}`}></slot>
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
              data-column=${column.key}
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
      ${this.#menu()}`;
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
