import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { styleMap } from "lit/directives/style-map.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "./strings.js";
import { closedHatch, periodColourStyles } from "./period-colour-styles.js";
import {
  ColumnStroke,
  CopyChooser,
  OverflowFade,
  columnMenu,
  hourLines,
  isDeleteKey,
  paintGridStyles,
  placePopover,
  timeRuler,
} from "./paint-grid-parts.js";
import { clockAt, stepSpan } from "../day-paint.js";
import type { CalendarColour } from "../hours-types.js";
import {
  changeBlockPeriod,
  copyDay,
  deleteBlock,
  paintStretch,
  samePaint,
  type Paint,
} from "../paint-model.js";
import { closuresInHours } from "../zone-own-hours.js";

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

const DAY = 1440;

@customElement("paint-grid")
export class PaintGrid extends LitElement {
  static override styles = [
    periodColourStyles,
    paintGridStyles,
    css`
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
        --period-fill: ${closedHatch};
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
      .all-closed.behind {
        pointer-events: none;
      }
      .underlay {
        isolation: isolate;
        background: transparent;
        pointer-events: none;
      }
      /* Its own background: the faded fill under it would leave any text colour unreadable on some palette colour. */
      .underlay > span {
        border-radius: var(--wt-radius-sm);
        padding-inline: var(--wt-space-1);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-normal);
      }
      .underlay b {
        font-weight: var(--wt-font-weight-bold);
      }
      .underlay .when {
        font-weight: var(--wt-font-weight-normal);
        white-space: nowrap;
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
  /** Columns drawn closed all day, hiding their underlay and paint, which stay in `days`; nothing
   *  paints there. */
  @property({ attribute: false }) closedAllDay: ReadonlySet<string> = new Set();
  /** Per column, the blocks Closed paint must lie inside: every day the grid emits has its Closed
   *  blocks cut to these (closuresInHours), other blocks untouched. A column the map does not name,
   *  or no map, is not bounded. */
  @property({ attribute: false }) closedWithin: ReadonlyMap<string, readonly Paint[]> | undefined =
    undefined;
  /** Per column, a label for a full-day Closed block drawn BEHIND the column's paint, as the
   *  underlay is: unlike `closedAllDay`, the column's paint stays drawn on top and strokes still run
   *  (`closedWithin` cuts them). */
  @property({ attribute: false }) closedBehind: ReadonlyMap<string, string> = new Map();
  /** Shows the week only: nothing paints, and no block or day offers a menu. */
  @property({ type: Boolean }) readOnly = false;
  /** What the days belong to. When it changes, a stroke, menu or chooser begun on the old days
   *  is dropped, or its release would land on the new ones. */
  @property() target = "";

  @state() private selected: { key: string; startsAt: string } | null = null;
  @query(".menu") private menu!: HTMLElement;
  readonly #fade = new OverflowFade(this);
  readonly #stroke = new ColumnStroke(this, {
    cutover: () => this.cutover,
    canStart: (key) => !this.readOnly && this.chosen !== undefined && !this.closedAllDay.has(key),
    canRelease: () => this.chosen !== undefined,
    released: (stretch) => {
      const paint: Paint = {
        periodId: this.chosen!,
        startsAt: clockAt(stretch.start, this.cutover),
        endsAt: clockAt(stretch.end, this.cutover),
      };
      if (this.#outside(stretch.key, [paint])) return;
      // Only the kept pieces of a Closed stroke paint, so the parts cut away leave the day alone.
      const pieces =
        paint.periodId === null && this.closedWithin?.has(stretch.key)
          ? this.#cut(stretch.key, [paint])
          : [paint];
      this.#emit(
        stretch.key,
        pieces.reduce<Paint[]>(
          (day, piece) => paintStretch(day, piece, this.cutover, this.closedErases),
          [...this.#day(stretch.key)],
        ),
      );
    },
  });
  readonly #chooser = new CopyChooser(this, {
    columns: () => this.columns,
    trigger: (key) =>
      this.renderRoot.querySelector<HTMLElement>(`.heading[data-column="${key}"] wt-row-actions`),
    copy: (from, to) => {
      const copied = copyDay(this.days, from, to);
      // A bounded target is cut even when it already holds the copied paint; `#emit` drops a cut
      // day that is unchanged.
      const changed = to.filter(
        (key) => this.closedWithin?.has(key) || !samePaint(copied.get(key)!, this.#day(key)),
      );
      for (const key of changed) this.#emit(key, copied.get(key)!);
      // After every change: a painter clears its notice on each change.
      for (const key of changed) this.#outside(key, copied.get(key)!);
    },
  });

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("days") && this.selected !== null && this.#selectedIndex() < 0)
      this.#closeMenu();
    if ((changes.has("readOnly") && this.readOnly) || (changes.has("target") && this.hasUpdated)) {
      this.#stroke.stop();
      this.#closeMenu();
      this.#chooser.close(false);
    }
  }

  #day(key: string): readonly Paint[] {
    return this.days.get(key) ?? [];
  }
  #selectedIndex(): number {
    const selected = this.selected;
    if (selected === null) return -1;
    return this.#day(selected.key).findIndex(({ startsAt }) => startsAt === selected.startsAt);
  }
  /** The Closed blocks of `day` cut to the column's `closedWithin`; uncut when it names none. */
  #cut(key: string, day: readonly Paint[]): Paint[] {
    const closed = day.filter(({ periodId }) => periodId === null);
    const within = this.closedWithin?.get(key);
    if (within === undefined) return closed;
    return closuresInHours(
      within.filter(({ periodId }) => periodId !== null),
      closed,
      { dayCutover: this.cutover, endMinute: DAY },
    ).map((range) => ({ periodId: null, ...range }));
  }
  /** Sends `paint-outside` for the column when `day` holds Closed blocks and its hours cut them
   *  all away. */
  #outside(key: string, day: readonly Paint[]): boolean {
    if (!day.some(({ periodId }) => periodId === null) || this.#cut(key, day).length > 0)
      return false;
    this.dispatchEvent(
      new CustomEvent<{ key: string }>("paint-outside", {
        detail: { key },
        bubbles: true,
        composed: true,
      }),
    );
    return true;
  }
  #emit(key: string, painted: Paint[]): void {
    let day = painted;
    if (this.closedWithin?.has(key)) {
      day = [
        ...painted.filter(({ periodId }) => periodId !== null),
        ...this.#cut(key, painted),
      ].sort((a, b) => stepSpan(a, this.cutover)[0] - stepSpan(b, this.cutover)[0]);
      if (samePaint(day, this.#day(key))) return;
    }
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

  async #select(key: string, startsAt: string, trigger: HTMLElement): Promise<void> {
    if (this.#stroke.takeDraggedClick()) return;
    this.selected = { key, startsAt };
    await this.updateComplete;
    placePopover(this.menu, trigger, false);
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
    const block = this.#day(selected.key)[index]!;
    const [from] = stepSpan(block, this.cutover);
    const covering = day.find((paint) => {
      const [start, end] = stepSpan(paint, this.cutover);
      return start <= from && from < end;
    });
    if (this.#outside(selected.key, [{ ...block, periodId }])) {
      void this.#focusAfter(selected.key, selected.startsAt);
      return;
    }
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

  #clear(key: string): void {
    if (this.#day(key).length > 0) this.#emit(key, []);
  }

  #position(start: number, end: number) {
    return styleMap({ top: `${(start / DAY) * 100}%`, height: `${((end - start) / DAY) * 100}%` });
  }
  #block(column: PaintColumn, paint: Paint, index: number) {
    const [start, end] = stepSpan(paint, this.cutover);
    const name = this.#name(paint.periodId);
    if (this.readOnly)
      return html`<div
        class=${paint.periodId === null ? "block closed" : "block"}
        data-index=${index}
        data-starts=${paint.startsAt}
        data-colour=${this.#colour(paint.periodId) ?? nothing}
        style=${this.#position(start, end)}
      >
        <span>${name}</span> ${paint.startsAt}–${paint.endsAt}
      </div>`;
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
      <span
        ><b>${this.#name(paint.periodId)}</b>
        <span class="when">${paint.startsAt}–${paint.endsAt}</span></span
      >
    </div>`;
  }
  #preview(column: PaintColumn) {
    const stretch = this.#stroke.preview;
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

  override render() {
    // With no button inside, a read-only grid's scrolling region takes the focus itself.
    return html`<div
        class="scroll"
        role="region"
        aria-label=${t("paint.grid")}
        tabindex=${ifDefined(this.readOnly ? "0" : undefined)}
        @scroll=${() => this.#fade.refresh()}
      >
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
                }${
                  this.readOnly
                    ? nothing
                    : html`<slot name=${`column-menu-${column.key}`}
                        >${columnMenu(column.label, {
                          copy: () => void this.#chooser.open(column.key),
                          clear: () => this.#clear(column.key),
                        })}</slot
                      >`
                }<slot name=${`column-head-${column.key}`}></slot>
              </div>`,
          )}
          ${timeRuler(this.cutover)}
          ${this.columns.map((column) => {
            const shut = this.closedAllDay.has(column.key);
            const day = shut ? [] : this.#day(column.key);
            return html`<div
              class="day"
              role="group"
              aria-label=${column.label}
              aria-describedby=${ifDefined(
                this.columnErrors.has(column.key) ? `column-error-${column.key}` : undefined,
              )}
              data-column=${column.key}
              tabindex="-1"
              @lostpointercapture=${this.#stroke.abort}
              @pointerdown=${(event: PointerEvent) => this.#stroke.start(event, column.key)}
              @keydown=${() => this.#stroke.forgetDrag()}
            >
              ${hourLines(this.cutover)}
              ${shut ? nothing : (this.underlay.get(column.key) ?? []).map((paint) => this.#underlay(paint))}
              ${
                !shut && this.closedBehind.has(column.key)
                  ? html`<div class="all-closed behind">${this.closedBehind.get(column.key)}</div>`
                  : shut || (this.closedErases && day.length === 0)
                    ? html`<div class="all-closed">${t("paint.closed_all_day")}</div>`
                    : nothing
              }
              ${day.map((paint, index) => this.#block(column, paint, index))}
              ${this.#preview(column)}
            </div>`;
          })}
        </div>
      </div>
      ${this.#menu()} ${this.#chooser.render()}`;
  }
}

declare global {
  interface HTMLElementEventMap {
    "paint-change": CustomEvent<PaintChange>;
    "paint-outside": CustomEvent<{ key: string }>;
  }
  interface HTMLElementTagNameMap {
    "paint-grid": PaintGrid;
  }
}
