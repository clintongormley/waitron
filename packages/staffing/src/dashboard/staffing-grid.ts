import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { styleMap } from "lit/directives/style-map.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import {
  ColumnStroke,
  CopyChooser,
  OverflowFade,
  clockAt,
  columnMenu,
  hourLines,
  isDeleteKey,
  paintGridStyles,
  periodColourStyles,
  placePopover,
  timeRuler,
  type Stretch,
} from "@waitron/venue-service/painter";
import {
  MAX_BLOCK_MINUTES,
  addBlock,
  changeBlock,
  copyDay,
  deleteBlock,
  laneLayout,
  resizeBlock,
} from "../block-model.js";
import { blockSpan, type StaffingBlock } from "../slots.js";
import type { StaffRole, StaffingGuideRange } from "../staffing-types.js";
import { t } from "./strings.js";

export interface StaffingColumn {
  key: string;
  label: string;
}
export interface StaffingChange {
  key: string;
  /** null: the day follows the season. */
  blocks: StaffingBlock[] | null;
}

const DAY = 1440;
const MAX_HEADCOUNT = 50;

/** A range's span; one saved before a changeover change can cross it, and is drawn up to it. */
function spanOf(
  block: Pick<StaffingBlock, "startsAt" | "endsAt">,
  cutover: string,
): { start: number; end: number } {
  const span = blockSpan(block, cutover);
  return span.end > span.start ? span : { start: span.start, end: DAY };
}

function sameBlocks(
  a: readonly StaffingBlock[] | null,
  b: readonly StaffingBlock[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.length === b.length &&
    a.every(
      (block, i) =>
        block.staffRoleId === b[i]!.staffRoleId &&
        block.headcount === b[i]!.headcount &&
        block.startsAt === b[i]!.startsAt &&
        block.endsAt === b[i]!.endsAt,
    )
  );
}

/** One area's staffing over several days: a drag down a column adds a block of the chosen staff
 *  role, a block's top or bottom edge resizes it, and a click opens its menu. */
@customElement("staffing-grid")
export class StaffingGrid extends LitElement {
  static override styles = [
    periodColourStyles,
    paintGridStyles,
    css`
      .block,
      .preview {
        --lane-width: calc((100% - 2 * var(--wt-space-1)) / var(--lanes));
        position: absolute;
        z-index: 1;
        inset-inline-start: calc(var(--wt-space-1) + var(--lane) * var(--lane-width));
        width: calc(var(--lane-width) - var(--wt-space-1) / 2);
        box-sizing: border-box;
        border: 0;
        border-radius: var(--wt-radius-sm);
        padding: 0 var(--wt-space-1);
        text-align: start;
        font: inherit;
        font-size: var(--wt-font-size-sm);
        overflow: hidden;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      .block[data-colour],
      .preview[data-colour] {
        background: var(--period-fill);
        color: var(--period-on-fill);
      }
      .block {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        border: 1px solid var(--wt-color-border);
      }
      .block[data-colour] {
        border-color: transparent;
      }
      button.block {
        cursor: pointer;
      }
      button.block:focus-visible,
      button.block[aria-expanded="true"] {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
        z-index: 2;
      }
      .block .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .edge {
        position: absolute;
        inset-inline: 0;
        block-size: var(--wt-space-2);
        cursor: ns-resize;
      }
      .edge[data-edge="start"] {
        inset-block-start: 0;
      }
      .edge[data-edge="end"] {
        inset-block-end: 0;
      }
      .preview {
        border: 2px dashed var(--wt-color-text);
        pointer-events: none;
        z-index: 3;
      }
      .guide {
        position: absolute;
        inset-inline: 0;
        box-sizing: border-box;
        border-block: 1px dashed var(--wt-color-primary);
        pointer-events: none;
      }
      .guide::before {
        content: "";
        position: absolute;
        inset: 0;
        background: var(--wt-color-primary);
        opacity: calc(var(--wt-opacity-disabled) / 4);
      }
      .follows {
        position: absolute;
        inset-block-start: 0;
        inset-inline: 0;
        padding: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        pointer-events: none;
      }
      .menu .how-many {
        padding-block: var(--wt-space-1);
      }
    `,
  ];

  /** Kept stable between renders: the copy chooser reads them while it is open. */
  @property({ attribute: false }) columns: readonly StaffingColumn[] = [];
  /** A null day follows the season; painting on it starts from an empty day. */
  @property({ attribute: false }) days: ReadonlyMap<string, readonly StaffingBlock[] | null> =
    new Map();
  /** Drawn faintly behind each column's blocks. */
  @property({ attribute: false }) guides: ReadonlyMap<string, readonly StaffingGuideRange[]> =
    new Map();
  @property({ attribute: false }) staffRoles: readonly StaffRole[] = [];
  /** The staff role a drag adds; with none, a drag adds nothing. */
  @property({ attribute: false }) chosen: string | undefined = undefined;
  /** How many people a drag's block needs, 1 to 50. */
  @property({ type: Number }) headcount = 1;
  @property() cutover = "06:00";
  /** Shows the days only: nothing paints, and no block or day offers a menu. */
  @property({ type: Boolean }) readOnly = false;
  /** What the days belong to. When it changes, a stroke, menu or chooser begun on the old days
   *  is dropped, or its release would land on the new ones. */
  @property() target = "";
  /** A refused save's message per column key: the heading is marked and the day described by it. */
  @property({ attribute: false }) columnErrors: ReadonlyMap<string, string> = new Map();
  /** Adds "Follow the season" to each column's ⋮. */
  @property({ type: Boolean }) followable = false;

  @state() private selected: { key: string; index: number } | null = null;
  @query(".menu") private menu!: HTMLElement;
  /** The block edge the current stroke moves, else null for a stroke that adds. */
  #resizing: { key: string; index: number; edge: "start" | "end"; anchor: number } | null = null;
  readonly #fade = new OverflowFade(this);
  readonly #stroke = new ColumnStroke(this, {
    cutover: () => this.cutover,
    canStart: () => !this.readOnly && (this.#resizing !== null || this.chosen !== undefined),
    canRelease: () => this.#resizing !== null || this.chosen !== undefined,
    released: (stretch) => this.#released(stretch),
  });
  readonly #chooser = new CopyChooser(this, {
    columns: () => this.columns,
    trigger: (key) =>
      this.renderRoot.querySelector<HTMLElement>(`.heading[data-column="${key}"] wt-row-actions`),
    copy: (from, to) => {
      const copied = copyDay(this.days, from, to);
      for (const key of to) {
        const blocks = copied.get(key)!;
        if (!sameBlocks(blocks, this.#value(key))) this.#emit(key, blocks);
      }
    },
  });

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (
      changes.has("days") &&
      this.selected !== null &&
      this.#day(this.selected.key)[this.selected.index] === undefined
    )
      this.#closeMenu();
    if ((changes.has("readOnly") && this.readOnly) || (changes.has("target") && this.hasUpdated)) {
      this.#stroke.stop();
      this.#closeMenu();
      this.#chooser.close(false);
    }
  }

  #value(key: string): readonly StaffingBlock[] | null {
    const value = this.days.get(key);
    return value === undefined ? [] : value;
  }
  #day(key: string): readonly StaffingBlock[] {
    return this.#value(key) ?? [];
  }
  #emit(key: string, blocks: StaffingBlock[] | null): void {
    this.dispatchEvent(
      new CustomEvent<StaffingChange>("staffing-change", {
        detail: { key, blocks },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #role(staffRoleId: string): StaffRole | undefined {
    return this.staffRoles.find(({ id }) => id === staffRoleId);
  }
  #describe(block: StaffingBlock): string {
    return [
      this.#role(block.staffRoleId)?.name,
      `×${block.headcount}`,
      `${block.startsAt}–${block.endsAt}`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  #onPointerdown(event: PointerEvent, key: string): void {
    const edge = event
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.classList.contains("edge"),
      );
    const block = this.#day(key)[Number(edge?.dataset.index)];
    if (edge === undefined || block === undefined) {
      this.#resizing = null;
      this.#stroke.start(event, key);
      return;
    }
    const side = edge.dataset.edge === "start" ? "start" : "end";
    const span = spanOf(block, this.cutover);
    const anchor = side === "start" ? span.end : span.start;
    this.#resizing = { key, index: Number(edge.dataset.index), edge: side, anchor };
    this.#stroke.start(event, key, anchor);
  }
  /** The blocks a stretch leaves in its column. */
  #stretched(stretch: Stretch): StaffingBlock[] | null {
    const day = this.#day(stretch.key);
    const resizing = this.#resizing;
    if (resizing !== null) {
      if (day[resizing.index] === undefined) return null;
      const moved = stretch.start === resizing.anchor ? stretch.end : stretch.start;
      return resizeBlock(
        day,
        resizing.index,
        resizing.edge,
        clockAt(moved, this.cutover),
        this.cutover,
      );
    }
    return addBlock(day, {
      staffRoleId: this.chosen!,
      headcount: this.headcount,
      startsAt: clockAt(stretch.start, this.cutover),
      endsAt: clockAt(Math.min(stretch.end, stretch.start + MAX_BLOCK_MINUTES), this.cutover),
    });
  }
  #released(stretch: Stretch): void {
    const blocks = this.#stretched(stretch);
    this.#resizing = null;
    if (blocks !== null) this.#emit(stretch.key, blocks);
  }

  async #select(key: string, index: number, trigger: HTMLElement): Promise<void> {
    if (this.#stroke.takeDraggedClick()) return;
    this.selected = { key, index };
    await this.updateComplete;
    placePopover(this.menu, trigger, false);
    this.menu.querySelector<HTMLElement>("wt-button:not([disabled])")?.focus();
  }
  #closeMenu(): void {
    if (this.menu?.matches(":popover-open")) this.menu.hidePopover();
    this.selected = null;
  }
  /** Focuses the block at `index` once the host has redrawn, else the column. */
  async #focusAfter(key: string, index: number): Promise<void> {
    await this.updateComplete;
    const column = this.renderRoot.querySelector<HTMLElement>(`.day[data-column="${key}"]`);
    (column?.querySelector<HTMLElement>(`button.block[data-index="${index}"]`) ?? column)?.focus();
  }
  #onMenuKeydown(event: KeyboardEvent): void {
    const selected = this.selected;
    if (selected === null) return;
    const target = event.composedPath()[0];
    if (isDeleteKey(event) && !(target instanceof HTMLInputElement)) {
      event.preventDefault();
      this.#closeMenu();
      this.#deleteAt(selected.key, selected.index);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.#closeMenu();
    void this.#focusAfter(selected.key, selected.index);
  }
  #changeRole(staffRoleId: string): void {
    const selected = this.selected!;
    this.#closeMenu();
    this.#emit(selected.key, changeBlock(this.#day(selected.key), selected.index, { staffRoleId }));
    void this.#focusAfter(selected.key, selected.index);
  }
  #changeHeadcount(value: string): void {
    const selected = this.selected;
    const headcount = Number(value);
    if (selected === null || !/^\d+$/.test(value) || headcount < 1 || headcount > MAX_HEADCOUNT)
      return;
    const day = this.#day(selected.key);
    if (day[selected.index]?.headcount === headcount) return;
    this.#emit(selected.key, changeBlock(day, selected.index, { headcount }));
  }
  #deleteAt(key: string, index: number): void {
    const day = deleteBlock(this.#day(key), index);
    this.#emit(key, day);
    void this.#focusAfter(key, Math.min(index, day.length - 1));
  }
  #onBlockKeydown(event: KeyboardEvent, key: string, index: number): void {
    if (!isDeleteKey(event)) return;
    event.preventDefault();
    this.#closeMenu();
    this.#deleteAt(key, index);
  }

  #clear(key: string): void {
    if (this.#value(key)?.length !== 0) this.#emit(key, []);
  }
  #follow(key: string): void {
    if (this.#value(key) !== null) this.#emit(key, null);
  }

  #position(start: number, end: number, lane = 0, lanes = 1) {
    return styleMap({
      top: `${(start / DAY) * 100}%`,
      height: `${((end - start) / DAY) * 100}%`,
      "--lane": String(lane),
      "--lanes": String(lanes),
    });
  }
  #content(block: StaffingBlock) {
    return html`<span class="name">${this.#role(block.staffRoleId)?.name ?? ""}</span
      ><span>×${block.headcount}</span><span>${block.startsAt}–${block.endsAt}</span>`;
  }
  #block(
    column: StaffingColumn,
    block: StaffingBlock,
    index: number,
    place: { lane: number; lanes: number },
  ) {
    const { start, end } = spanOf(block, this.cutover);
    const style = this.#position(start, end, place.lane, place.lanes);
    const colour = this.#role(block.staffRoleId)?.colour;
    if (this.readOnly)
      return html`<div
        class="block"
        data-index=${index}
        data-colour=${colour ?? nothing}
        style=${style}
      >
        ${this.#content(block)}
      </div>`;
    const expanded = this.selected?.key === column.key && this.selected.index === index;
    return html`<button
      type="button"
      class="block"
      data-index=${index}
      data-colour=${colour ?? nothing}
      aria-label=${`${column.label}, ${this.#describe(block)}`}
      aria-haspopup="dialog"
      aria-controls="block-menu"
      aria-expanded=${expanded ? "true" : "false"}
      style=${style}
      @click=${(event: Event) =>
        void this.#select(column.key, index, event.currentTarget as HTMLElement)}
      @keydown=${(event: KeyboardEvent) => this.#onBlockKeydown(event, column.key, index)}
    >
      ${this.#content(block)}<span
        class="edge"
        data-edge="start"
        data-index=${index}
        aria-hidden="true"
      ></span
      ><span class="edge" data-edge="end" data-index=${index} aria-hidden="true"></span>
    </button>`;
  }
  #guide(range: StaffingGuideRange) {
    const { start, end } = spanOf(range, this.cutover);
    return html`<div
      class="guide"
      aria-hidden="true"
      style=${styleMap({ top: `${(start / DAY) * 100}%`, height: `${((end - start) / DAY) * 100}%` })}
    ></div>`;
  }
  #preview(column: StaffingColumn) {
    const stretch = this.#stroke.preview;
    if (stretch === null || stretch.key !== column.key) return nothing;
    const blocks = this.#stretched(stretch);
    const block = blocks?.[this.#resizing?.index ?? blocks.length - 1];
    if (block === undefined) return nothing;
    const { start, end } = spanOf(block, this.cutover);
    return html`<div
      class="preview"
      data-colour=${this.#role(block.staffRoleId)?.colour ?? nothing}
      style=${this.#position(start, end)}
    >
      ${this.#describe(block)}
    </div>`;
  }
  #menu() {
    const selected = this.selected;
    const block = selected === null ? undefined : this.#day(selected.key)[selected.index];
    return html`<div
      class="menu"
      id="block-menu"
      popover
      role="dialog"
      aria-label=${block === undefined ? t("staffing.grid.staff_role") : this.#describe(block)}
      @keydown=${(event: KeyboardEvent) => this.#onMenuKeydown(event)}
      @toggle=${(event: ToggleEvent) => {
        if (event.newState === "closed") this.selected = null;
      }}
    >
      ${
        block === undefined
          ? nothing
          : html`<p>${t("staffing.grid.staff_role")}</p>
              ${this.staffRoles.map(
                (role) =>
                  html`<wt-button
                    variant="secondary"
                    align="start"
                    ?disabled=${role.id === block.staffRoleId}
                    @click=${() => this.#changeRole(role.id)}
                    >${role.name}</wt-button
                  >`,
              )}
              <wt-number-stepper
                class="how-many"
                name="headcount"
                label=${t("staffing.grid.how_many")}
                min="1"
                max=${MAX_HEADCOUNT}
                .value=${String(block.headcount)}
                @wt-change=${(event: CustomEvent<{ value: string }>) =>
                  this.#changeHeadcount(event.detail.value)}
              ></wt-number-stepper>
              <wt-button
                variant="danger"
                align="start"
                @click=${() => {
                  this.#closeMenu();
                  this.#deleteAt(selected!.key, selected!.index);
                }}
                >${t("staffing.grid.delete")}</wt-button
              >`
      }
    </div>`;
  }

  override render() {
    // With no button inside, a read-only grid's scrolling region takes the focus itself.
    return html`<div
        class="scroll"
        role="region"
        aria-label=${t("staffing.grid.label")}
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
                    : columnMenu(
                        column.label,
                        {
                          copy: () => void this.#chooser.open(column.key),
                          clear: () => this.#clear(column.key),
                        },
                        this.followable
                          ? [
                              {
                                label: t("staffing.grid.follow_season"),
                                select: () => this.#follow(column.key),
                              },
                            ]
                          : [],
                      )
                }
              </div>`,
          )}
          ${timeRuler(this.cutover)}
          ${this.columns.map((column) => {
            const day = this.#day(column.key);
            const lanes = laneLayout(day, this.cutover);
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
              @pointerdown=${(event: PointerEvent) => this.#onPointerdown(event, column.key)}
              @keydown=${() => this.#stroke.forgetDrag()}
            >
              ${hourLines(this.cutover)}
              ${(this.guides.get(column.key) ?? []).map((range) => this.#guide(range))}
              ${
                this.#value(column.key) === null
                  ? html`<div class="follows">${t("staffing.grid.follows_season")}</div>`
                  : nothing
              }
              ${day.map((block, index) => this.#block(column, block, index, lanes[index]!))}
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
    "staffing-change": CustomEvent<StaffingChange>;
  }
  interface HTMLElementTagNameMap {
    "staffing-grid": StaffingGrid;
  }
}
