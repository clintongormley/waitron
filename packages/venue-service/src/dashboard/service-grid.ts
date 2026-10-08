import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { t } from "./strings.js";
import type { CalendarColour } from "../hours-types.js";
import type { ServiceRange } from "../service-day.js";

export interface GridPeriod {
  id: string;
  name: string;
  colour: CalendarColour;
}
export interface GridColumn {
  key: string;
  label: string;
  slots: readonly ServiceRange[];
  periods: readonly GridPeriod[];
  editable: boolean;
}

export interface GridRangeSelection {
  columnKey: string;
  startsAt: string;
  endsAt: string;
}
export interface GridBlockChange extends GridRangeSelection {
  index: number;
}
export interface GridBlockOpen {
  columnKey: string;
  index: number;
}
interface Selection {
  columnKey: string;
  start: number;
  end: number;
  index?: number;
}
interface Gesture {
  pointerId: number;
  column: GridColumn;
  anchor: number;
  min: number;
  max: number;
  index?: number;
}

const DAY = 1440;
const STEP = 15;
function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

@customElement("service-grid")
export class ServiceGrid extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--wt-color-text);
      font-family: var(--wt-font-family);
    }
    .scroll {
      overflow: auto;
      max-block-size: calc(var(--wt-space-6) * 20);
      border: 1px solid var(--wt-color-border);
      border-radius: var(--wt-radius-md);
      background: var(--wt-color-bg);
    }
    .layout {
      display: grid;
      grid-template-columns: calc(var(--wt-space-6) * 3) repeat(
          var(--columns),
          minmax(calc(var(--wt-space-6) * 5), 1fr)
        );
    }
    .heading {
      position: sticky;
      top: 0;
      z-index: 3;
      background: var(--wt-color-surface);
      padding: var(--wt-space-2);
      font-size: var(--wt-font-size-sm);
      font-weight: var(--wt-font-weight-bold);
      border-block-end: 1px solid var(--wt-color-border);
    }
    .times,
    .day {
      position: relative;
      height: calc(var(--wt-space-6) * 96);
    }
    .times {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--wt-color-bg);
    }
    .hour {
      position: absolute;
      inset-inline-start: var(--wt-space-1);
      font-size: var(--wt-font-size-sm);
      color: var(--wt-color-text-muted);
    }
    .hour:last-child {
      transform: translateY(-100%);
    }
    .day {
      border-inline-start: 1px solid var(--wt-color-border);
    }
    .step {
      position: absolute;
      inset-inline: 0;
      box-sizing: border-box;
      border: 0;
      border-block-start: 1px solid var(--wt-color-border);
      padding: 0;
      background: transparent;
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--wt-color-focus);
      outline-offset: -2px;
      z-index: 2;
    }
    .block {
      position: absolute;
      inset-inline: var(--wt-space-1);
      box-sizing: border-box;
      border: 0;
      border-radius: var(--wt-radius-sm);
      padding: var(--wt-space-1);
      text-align: start;
      font-size: var(--wt-font-size-sm);
      overflow: hidden;
    }
    .selection {
      position: absolute;
      inset-inline: var(--wt-space-1);
      box-sizing: border-box;
      border: 2px dashed var(--wt-color-primary);
      background: var(--wt-color-surface);
      color: var(--wt-color-text);
      padding: var(--wt-space-1);
      font-size: var(--wt-font-size-sm);
      pointer-events: none;
      z-index: 1;
    }
    .resize {
      position: absolute;
      inset-inline: var(--wt-space-1);
      transform: translateY(-100%);
      height: var(--wt-space-3);
      border: 0;
      border-block-end: 2px solid currentColor;
      background: transparent;
      cursor: ns-resize;
    }
    .day[data-editable] {
      touch-action: none;
    }
    .block span {
      display: block;
      overflow-wrap: anywhere;
    }
    .block[data-colour="red"] {
      background: var(--wt-color-palette-red);
      color: var(--wt-color-on-palette-red);
    }
    .block[data-colour="amber"] {
      background: var(--wt-color-palette-amber);
      color: var(--wt-color-on-palette-amber);
    }
    .block[data-colour="grey"] {
      background: var(--wt-color-palette-grey);
      color: var(--wt-color-on-palette-grey);
    }
    .block[data-colour="blue"] {
      background: var(--wt-color-palette-blue);
      color: var(--wt-color-on-palette-blue);
    }
    .block[data-colour="green"] {
      background: var(--wt-color-palette-green);
      color: var(--wt-color-on-palette-green);
    }
    .block[data-colour="purple"] {
      background: var(--wt-color-palette-purple);
      color: var(--wt-color-on-palette-purple);
    }
  `;

  @property({ attribute: false }) columns: GridColumn[] = [];
  @property() dayCutover = "06:00";
  @property({ type: Boolean }) readOnly = false;

  @state() private focusCell = { columnKey: "", minute: 0 };
  @state() private selection: Selection | null = null;
  #anchor: number | null = null;
  #gesture: Gesture | null = null;

  override disconnectedCallback(): void {
    this.#cancel();
    super.disconnectedCallback();
  }
  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("columns") || changes.has("dayCutover") || changes.has("readOnly")) {
      this.#cancel();
      if (
        !this.columns.some((column) => column.key === this.focusCell.columnKey && column.editable)
      )
        this.focusCell = {
          columnKey: this.columns.find((column) => column.editable)?.key ?? "",
          minute: this.#limits().min,
        };
      else if (changes.has("dayCutover"))
        this.focusCell = { ...this.focusCell, minute: this.#limits().min };
    }
  }
  #emit(name: string, detail: GridRangeSelection | GridBlockChange | GridBlockOpen): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #cancel(): void {
    window.removeEventListener("pointermove", this.#move);
    window.removeEventListener("pointerup", this.#release);
    window.removeEventListener("pointercancel", this.#abort);
    this.#gesture = null;
    this.selection = null;
    this.#anchor = null;
  }
  #abort = (event: PointerEvent): void => {
    if (event.pointerId === this.#gesture?.pointerId) this.#cancel();
  };
  #occupied(column: GridColumn, minute: number): number {
    return column.slots.findIndex(
      (slot) =>
        this.#minute(slot.startsAt) <= minute && minute < (this.#minute(slot.endsAt) || DAY),
    );
  }
  #gap(column: GridColumn, anchor: number): { min: number; max: number } {
    let { min, max } = this.#limits();
    for (const slot of column.slots) {
      const start = this.#minute(slot.startsAt);
      const end = this.#minute(slot.endsAt) || DAY;
      if (end <= anchor) min = Math.max(min, end);
      if (start > anchor) max = Math.min(max, start);
    }
    return { min, max };
  }
  #start(event: PointerEvent, column: GridColumn, anchor: number, index?: number): void {
    if (this.readOnly || !column.editable || event.button !== 0 || this.#gesture !== null) return;
    if (index === undefined && this.#occupied(column, anchor) >= 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.#cancel();
    const slot = index === undefined ? undefined : column.slots[index]!;
    const start = slot === undefined ? anchor : this.#minute(slot.startsAt);
    const gap = this.#gap(column, start);
    if (slot !== undefined) {
      gap.min = start + STEP;
      gap.max = Math.min(
        this.#limits().max,
        ...column.slots
          .filter((_, i) => i !== index)
          .map((other) => this.#minute(other.startsAt))
          .filter((minute) => minute > start),
      );
    }
    this.#gesture = {
      pointerId: event.pointerId,
      column,
      anchor: start,
      ...gap,
      ...(index === undefined ? {} : { index }),
    };
    this.selection = {
      columnKey: column.key,
      start,
      end: slot === undefined ? start + STEP : this.#minute(slot.endsAt) || DAY,
      ...(index === undefined ? {} : { index }),
    };
    this.#focus(column.key, start);
    window.addEventListener("pointermove", this.#move);
    window.addEventListener("pointerup", this.#release);
    window.addEventListener("pointercancel", this.#abort);
  }
  #move = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    const day = [...this.renderRoot.querySelectorAll<HTMLElement>(".day")].find(
      (el) => el.dataset.column === gesture.column.key,
    )!;
    const box = day.getBoundingClientRect();
    const offset = ((event.clientY - box.top) / box.height) * DAY;
    const target =
      Math.round((offset + minutes(this.dayCutover)) / STEP) * STEP - minutes(this.dayCutover);
    const minute = Math.max(gesture.min, Math.min(gesture.max, target));
    this.selection =
      gesture.index === undefined
        ? {
            columnKey: gesture.column.key,
            start: Math.min(gesture.anchor, minute),
            end: Math.max(gesture.anchor + (minute === gesture.anchor ? STEP : 0), minute),
          }
        : {
            columnKey: gesture.column.key,
            index: gesture.index,
            start: gesture.anchor,
            end: minute,
          };
  };
  #release = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    this.#move(event);
    const selected = this.selection!;
    this.#cancel();
    const detail = {
      columnKey: selected.columnKey,
      startsAt: this.#time(selected.start),
      endsAt: this.#time(selected.end),
    };
    if (gesture.index === undefined) this.#emit("grid-range-select", detail);
    else if (detail.endsAt !== gesture.column.slots[gesture.index]!.endsAt)
      this.#emit("grid-block-change", { ...detail, index: gesture.index });
  };
  #focus(columnKey: string, minute: number): void {
    const { min, max } = this.#limits();
    this.focusCell = { columnKey, minute: Math.max(min, Math.min(max - STEP, minute)) };
    void this.updateComplete.then(() => {
      const cell = [...this.renderRoot.querySelectorAll<HTMLElement>(".step")].find(
        (el) =>
          el.closest<HTMLElement>(".day")?.dataset.column === columnKey &&
          Number(el.dataset.minute) === this.focusCell.minute,
      );
      cell?.focus();
    });
  }
  #keydown(event: KeyboardEvent, column: GridColumn): void {
    if (this.readOnly || !column.editable) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#cancel();
      return;
    }
    const target = event.composedPath()[0] as HTMLElement;
    const cell = target.closest<HTMLElement>(".step");
    if (cell === null) return;
    const minute = Number(cell.dataset.minute);
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (this.selection !== null && this.selection.columnKey === column.key) {
        const selected = this.selection;
        this.#cancel();
        this.#emit("grid-range-select", {
          columnKey: column.key,
          startsAt: this.#time(selected.start),
          endsAt: this.#time(selected.end),
        });
      } else {
        const index = this.#occupied(column, minute);
        if (index >= 0) this.#emit("grid-block-open", { columnKey: column.key, index });
        else
          this.#emit("grid-range-select", {
            columnKey: column.key,
            startsAt: this.#time(minute),
            endsAt: this.#time(minute + STEP),
          });
      }
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      this.#cancel();
      const columns = this.columns.filter((col) => col.editable);
      const index = columns.indexOf(column) + (event.key === "ArrowRight" ? 1 : -1);
      this.#focus(columns[Math.max(0, Math.min(columns.length - 1, index))]!.key, minute);
    } else {
      const destination = minute + (event.key === "ArrowDown" ? STEP : -STEP);
      if (event.shiftKey) {
        const anchor = this.#anchor ?? minute;
        if (this.#occupied(column, anchor) >= 0) return;
        this.#anchor = anchor;
        const gap = this.#gap(column, anchor);
        const end = Math.max(gap.min, Math.min(gap.max, destination));
        this.selection = {
          columnKey: column.key,
          start: Math.min(anchor, end),
          end: Math.max(anchor + (anchor === end ? STEP : 0), end),
        };
        this.#focus(column.key, end);
      } else {
        this.#cancel();
        this.#focus(column.key, destination);
      }
    }
  }
  #open(event: Event, column: GridColumn, index: number): void {
    event.stopPropagation();
    if (this.readOnly || !column.editable) return;
    this.#cancel();
    this.#emit("grid-block-open", { columnKey: column.key, index });
  }

  #limits(): { min: number; max: number } {
    const remainder = minutes(this.dayCutover) % STEP;
    return { min: remainder === 0 ? 0 : STEP - remainder, max: DAY - remainder };
  }
  #minute(time: string): number {
    return (minutes(time) - minutes(this.dayCutover) + DAY) % DAY;
  }
  #time(minute: number): string {
    const clock = (minutes(this.dayCutover) + minute) % DAY;
    return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
  }
  #position(start: number, end: number) {
    return styleMap({ top: `${(start / DAY) * 100}%`, height: `${((end - start) / DAY) * 100}%` });
  }
  #cellLabel(column: GridColumn, minute: number): string {
    const slot = column.slots[this.#occupied(column, minute)];
    const period =
      slot === undefined ? undefined : column.periods.find(({ id }) => id === slot.periodId);
    return `${column.label}, ${this.#time(minute)}${slot === undefined ? "" : `, ${period!.name}, ${slot.startsAt}–${slot.endsAt}`}`;
  }
  #block(column: GridColumn, slot: ServiceRange, index: number) {
    const period = column.periods.find(({ id }) => id === slot.periodId)!;
    const start = this.#minute(slot.startsAt);
    const end =
      this.selection?.columnKey === column.key && this.selection.index === index
        ? this.selection.end
        : this.#minute(slot.endsAt) || DAY;
    const text = html`<span>${period.name}</span><span>${slot.startsAt}–${slot.endsAt}</span>`;
    return this.readOnly || !column.editable
      ? html`<div
          class="block"
          data-index=${index}
          data-colour=${period.colour}
          style=${this.#position(start, end)}
        >
          ${text}
        </div>`
      : html`<button
            type="button"
            class="block"
            tabindex="-1"
            data-index=${index}
            data-colour=${period.colour}
            style=${this.#position(start, end)}
            @click=${(event: Event) => this.#open(event, column, index)}
          >
            ${text}
          </button>
          <button
            type="button"
            class="resize"
            tabindex="-1"
            data-index=${index}
            aria-label=${`${column.label}, ${t("service.adjust_range").replace("{name}", period.name)}, ${slot.startsAt}–${slot.endsAt}`}
            style=${styleMap({ top: `${(end / DAY) * 100}%` })}
            @pointerdown=${(event: PointerEvent) => this.#start(event, column, start, index)}
            @click=${(event: MouseEvent) => {
              event.stopPropagation();
              if (event.detail === 0) this.#open(event, column, index);
            }}
          ></button>`;
  }
  override render() {
    const { min, max } = this.#limits();
    const boundaries = [
      ...new Set([
        0,
        ...Array.from({ length: Math.floor((max - min) / STEP) + 1 }, (_, i) => min + i * STEP),
        DAY,
      ]),
    ];
    const steps = boundaries.slice(0, -1);
    const hourStart = (60 - (minutes(this.dayCutover) % 60)) % 60;
    const hours = [
      ...new Set([
        0,
        ...Array.from({ length: Math.ceil((DAY - hourStart) / 60) }, (_, i) => hourStart + i * 60),
        DAY,
      ]),
    ];
    return html`<div
      class="scroll"
      role="region"
      aria-label=${t("service.grid")}
      tabindex=${this.readOnly || !this.columns.some((column) => column.editable) ? 0 : nothing}
    >
      <div class="layout" style=${styleMap({ "--columns": String(this.columns.length) })}>
        <div class="heading"></div>
        ${this.columns.map((column) => html`<div class="heading">${column.label}<slot name=${`header-${column.key}`}></slot></div>`)}
        <div class="times" aria-hidden="true">
          ${hours.map((minute) => html`<span class="hour" style=${styleMap({ top: `${(minute / DAY) * 100}%` })}>${this.#time(minute)}</span>`)}
        </div>
        ${this.columns.map(
          (column) =>
            html`<div
              class="day"
              role="group"
              aria-label=${column.label}
              data-column=${column.key}
              ?data-editable=${!this.readOnly && column.editable}
              @keydown=${(event: KeyboardEvent) => this.#keydown(event, column)}
            >
              ${steps.map((start, row) =>
                this.readOnly || !column.editable || start < min || start >= max
                  ? html`<div
                      class="step"
                      style=${this.#position(start, boundaries[row + 1]!)}
                    ></div>`
                  : html`<button
                      type="button"
                      class="step"
                      data-minute=${start}
                      tabindex=${column.key === this.focusCell.columnKey && start === this.focusCell.minute ? 0 : -1}
                      aria-label=${this.#cellLabel(column, start)}
                      style=${this.#position(start, boundaries[row + 1]!)}
                      @focus=${() => {
                        this.focusCell = { columnKey: column.key, minute: start };
                      }}
                      @pointerdown=${(event: PointerEvent) => this.#start(event, column, start)}
                    ></button>`,
              )}
              ${column.slots.map((slot, index) => this.#block(column, slot, index))}
              ${this.selection?.columnKey === column.key && this.selection.index === undefined ? html`<div class="selection" role="status" style=${this.#position(this.selection.start, this.selection.end)}>${this.#time(this.selection.start)}–${this.#time(this.selection.end)}</div>` : nothing}
            </div>`,
        )}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementEventMap {
    "grid-range-select": CustomEvent<GridRangeSelection>;
    "grid-block-change": CustomEvent<GridBlockChange>;
    "grid-block-open": CustomEvent<GridBlockOpen>;
  }
  interface HTMLElementTagNameMap {
    "service-grid": ServiceGrid;
  }
}
