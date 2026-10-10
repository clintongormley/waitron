import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import {
  GRID_SQUARE_PX,
  type PlanPlacement,
  clampToGrid,
  gridExtent,
  rotatedRect,
  rotationFromAngle,
  showsName,
  snapToSquare,
} from "../floor-plan-geometry.js";
import { registerIcons } from "./wt-icon.js";

registerIcons({
  "floor-plan-rotate": "M8 3a5 5 0 1 0 4.33 2.5l1.3-.75A6.5 6.5 0 1 1 8 1.5V0l3 2.25L8 4.5z",
});

export interface PlanCanvasTable {
  key: string;
  label: string;
  fixed: boolean;
  placement: PlanPlacement;
  /** Why the last save could not remove this table; drawn beside it and read as its description. */
  refused?: string;
}

export interface FloorPlanCanvasCopy {
  label: string;
  fixed: string;
  /** "{name}" is replaced by the table's label. */
  rotate: string;
}

export interface TableSelect {
  key: string | null;
}

export interface TableMove {
  key: string;
  x: number;
  y: number;
}

export interface TableRotate {
  key: string;
  rotation: number;
}

const DEFAULT_COPY: FloorPlanCanvasCopy = {
  label: "Floor plan",
  fixed: "Fixed",
  rotate: "Rotate {name}",
};

const px = (squares: number): string => `${squares * GRID_SQUARE_PX}px`;

const ROTATE_KEY_STEP = 15;

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowRight: { dx: 1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowUp: { dx: 0, dy: -1 },
};

interface Drag {
  kind: "move" | "rotate";
  table: PlanCanvasTable;
  pointerId: number;
  startX: number;
  startY: number;
  /** For a turn: the pointer's angle round the table's centre when it was pressed. */
  startAngle: number;
}

interface Draft {
  key: string;
  placement: PlanPlacement;
}

/**
 * Controlled: it never changes `tables` or `selected`, only asks through `wt-table-select`; the
 * parent sets `selected`. Tables are drawn at the plan's true size, so a small one is smaller than
 * `--wt-tap-min`.
 */
@customElement("wt-floor-plan-canvas")
export class WtFloorPlanCanvas extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .viewport {
        width: 100%;
        height: 100%;
        overflow: auto;
      }

      .grid {
        position: relative;
        min-width: 100%;
        min-height: 100%;
        background-color: var(--wt-color-surface);
        background-image:
          linear-gradient(to right, var(--wt-color-border) 1px, transparent 1px),
          linear-gradient(to bottom, var(--wt-color-border) 1px, transparent 1px);
      }

      .table {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
        overflow: hidden;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        cursor: pointer;
        touch-action: none;
      }

      .table[data-shape="round"] {
        border-radius: 50%;
      }

      .table[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        box-shadow: inset 0 0 0 1px var(--wt-color-primary);
      }

      .table[data-refused] {
        outline: var(--wt-focus-ring);
        outline-color: var(--wt-color-danger);
      }

      .refused-reason {
        position: absolute;
        padding: 0 var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        text-wrap: nowrap;
        pointer-events: none;
      }

      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      .fixed-marker {
        position: absolute;
        top: 0;
        right: 0;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-bottom-left-radius: var(--wt-radius-sm);
        background: var(--wt-color-text-muted);
      }

      .rotate-handle {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        margin: 0;
        padding: 0;
        border: 1px solid var(--wt-color-primary);
        border-radius: 50%;
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-primary-text);
        cursor: grab;
        touch-action: none;
        transform: translateX(-50%);
      }

      /* A circle clips the corner, so the mark sits where the circle still covers it. */
      .table[data-shape="round"] .fixed-marker {
        top: 15%;
        right: 15%;
        border-radius: 50%;
      }
    `,
  ];

  @property({ attribute: false }) tables: PlanCanvasTable[] = [];

  @property() selected: string | null = null;

  @property({ attribute: false }) copy: Partial<FloorPlanCanvasCopy> = {};

  @state() private visible = { columns: 0, rows: 0 };

  @state() private draft: Draft | null = null;

  #drag: Drag | null = null;

  #ignoreGridClick = false;

  #room: number | null = null;

  #observer = new ResizeObserver(([entry]) => {
    // The content box excludes scrollbars, and rounding down keeps the grid inside it, so the grid
    // never overflows only because a scrollbar appeared; min-width/min-height fill the remainder.
    const size = entry!.contentBoxSize[0]!;
    this.visible = {
      columns: Math.floor(size.inlineSize / GRID_SQUARE_PX),
      rows: Math.floor(size.blockSize / GRID_SQUARE_PX),
    };
  });

  get #copy(): FloorPlanCanvasCopy {
    return { ...DEFAULT_COPY, ...this.copy };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.updateComplete.then(() => {
      if (this.isConnected) this.#observer.observe(this.renderRoot.querySelector(".viewport")!);
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
    this.#endDrag();
  }

  #placementOf(t: PlanCanvasTable): PlanPlacement {
    return this.draft?.key === t.key ? this.draft.placement : t.placement;
  }

  override render(): TemplateResult {
    const copy = this.#copy;
    const extent = gridExtent(
      this.tables.map((t) => this.#placementOf(t)),
      this.visible,
    );
    const gridStyle = styleMap({
      width: px(extent.columns),
      height: px(extent.rows),
      backgroundSize: `${px(1)} ${px(1)}`,
    });
    return html`
      <div class="viewport" part="viewport">
        <div
          class="grid"
          part="grid"
          role="group"
          aria-label=${copy.label}
          style=${gridStyle}
          @click=${this.#onGridClick}
        >
          ${repeat(
            this.tables,
            (t) => t.key,
            (t) => this.#renderTable(t, copy),
          )}
        </div>
      </div>
    `;
  }

  #renderTable(t: PlanCanvasTable, copy: FloorPlanCanvasCopy): TemplateResult {
    const p = this.#placementOf(t);
    const style = styleMap({
      left: px(p.x),
      top: px(p.y),
      width: px(p.width),
      height: px(p.height),
      transform: `rotate(${p.rotation}deg)`,
    });
    return html`
      <button
        type="button"
        class="table"
        part="table"
        data-key=${t.key}
        data-shape=${p.shape}
        aria-pressed=${t.key === this.selected ? "true" : "false"}
        aria-label=${t.fixed ? `${t.label}, ${copy.fixed}` : t.label}
        aria-describedby=${t.refused === undefined ? nothing : `reason-${t.key}`}
        ?data-refused=${t.refused !== undefined}
        style=${style}
        @click=${(e: Event) => this.#onTableClick(e, t.key)}
        @pointerdown=${(e: PointerEvent) => this.#onPointerDown(e, t, "move")}
        @keydown=${(e: KeyboardEvent) => this.#onTableKey(e, t)}
      >
        ${showsName(p, GRID_SQUARE_PX) ? html`<span class="name">${t.label}</span>` : nothing}
        ${t.fixed ? html`<span class="fixed-marker" part="fixed-marker"></span>` : nothing}
      </button>
      ${t.refused === undefined ? nothing : this.#renderReason(t, p)}
      ${t.key === this.selected ? this.#renderHandle(t, p, copy) : nothing}
    `;
  }

  /** Outside the table's button, so a round table's clip never cuts it. Always below, past the
   *  handle when that is below too: the grid runs `gridExtent`'s margin past the lowest table. */
  #renderReason(t: PlanCanvasTable, p: PlanPlacement): TemplateResult {
    const box = rotatedRect(p);
    const handleBelow = t.key === this.selected && !this.#handleAbove(t);
    const style = styleMap({
      top: handleBelow
        ? `calc(${px(box.y + box.height)} + var(--wt-tap-min) + 2 * var(--wt-space-1))`
        : `calc(${px(box.y + box.height)} + var(--wt-space-1))`,
    });
    return html`<span
      class="refused-reason"
      part="refused-reason"
      id="reason-${t.key}"
      data-key=${t.key}
      data-centre=${(box.x + box.width / 2) * GRID_SQUARE_PX}
      style=${style}
      >${t.refused}</span
    >`;
  }

  #renderHandle(t: PlanCanvasTable, p: PlanPlacement, copy: FloorPlanCanvasCopy): TemplateResult {
    const box = rotatedRect(p);
    const above = this.#handleAbove(t);
    const style = styleMap({
      left: px(box.x + box.width / 2),
      top: above
        ? `calc(${px(box.y)} - var(--wt-tap-min) - var(--wt-space-1))`
        : `calc(${px(box.y + box.height)} + var(--wt-space-1))`,
    });
    return html`
      <button
        type="button"
        class="rotate-handle"
        part="rotate-handle"
        aria-label=${copy.rotate.replace("{name}", t.label)}
        style=${style}
        @click=${(e: Event) => e.stopPropagation()}
        @pointerdown=${(e: PointerEvent) => this.#onPointerDown(e, t, "rotate")}
        @keydown=${(e: KeyboardEvent) => this.#onHandleKey(e, t)}
      >
        <wt-icon name="floor-plan-rotate" size="lg"></wt-icon>
      </button>
    `;
  }

  /** The side follows the table's saved place, so it does not jump while a drag is drawn. */
  #handleAbove(t: PlanCanvasTable): boolean {
    return rotatedRect(t.placement).y * GRID_SQUARE_PX >= this.#handleRoom();
  }

  /** The handle's size and its gap in px, read once rather than on every redraw of a drag. */
  #handleRoom(): number {
    if (this.#room === null) {
      const host = getComputedStyle(this);
      this.#room =
        parseFloat(host.getPropertyValue("--wt-tap-min")) +
        parseFloat(host.getPropertyValue("--wt-space-1"));
    }
    return this.#room;
  }

  /** Centres each reason under its table, held inside the grid: its width is known only once drawn. */
  override updated(): void {
    const reasons = this.renderRoot.querySelectorAll<HTMLElement>(".refused-reason");
    if (reasons.length === 0) return;
    const grid = this.renderRoot.querySelector<HTMLElement>(".grid")!.clientWidth;
    for (const reason of reasons) {
      const width = reason.getBoundingClientRect().width;
      const centred = Number(reason.dataset.centre) - width / 2;
      reason.style.left = `${Math.min(Math.max(centred, 0), Math.max(grid - width, 0))}px`;
    }
  }

  #onTableKey(e: KeyboardEvent, t: PlanCanvasTable): void {
    const arrow = ARROWS[e.key];
    if (arrow === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const x = clampToGrid(t.placement.x + arrow.dx);
    const y = clampToGrid(t.placement.y + arrow.dy);
    if (x !== t.placement.x || y !== t.placement.y) this.#move(t.key, x, y);
  }

  #onHandleKey(e: KeyboardEvent, t: PlanCanvasTable): void {
    const step =
      e.key === "ArrowRight" ? ROTATE_KEY_STEP : e.key === "ArrowLeft" ? -ROTATE_KEY_STEP : 0;
    if (step === 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.#rotate(t.key, rotationFromAngle(t.placement.rotation + step));
  }

  #onPointerDown(e: PointerEvent, t: PlanCanvasTable, kind: Drag["kind"]): void {
    // Replacing a live drag's owner would leave the first pointer's pointerup unmatched.
    if (this.#drag !== null || e.button !== 0) return;
    // Cancelling the press also cancels the focus it would give, so give it back by hand.
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    this.#drag = {
      kind,
      table: t,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startAngle: this.#angleAround(t.placement, e.clientX, e.clientY),
    };
    window.addEventListener("pointermove", this.#onPointerMove);
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("pointercancel", this.#onPointerCancel);
  }

  // The window listeners below are attached only while `#drag` is set.
  readonly #onPointerMove = (e: PointerEvent): void => {
    const drag = this.#drag!;
    if (e.pointerId !== drag.pointerId) return;
    const p = drag.table.placement;
    if (drag.kind === "move") {
      const x = clampToGrid(p.x + snapToSquare(e.clientX - drag.startX));
      const y = clampToGrid(p.y + snapToSquare(e.clientY - drag.startY));
      this.draft = { key: drag.table.key, placement: { ...p, x, y } };
      return;
    }
    const turn = this.#angleAround(p, e.clientX, e.clientY) - drag.startAngle;
    const rotation = rotationFromAngle(p.rotation + turn);
    this.draft = { key: drag.table.key, placement: { ...p, rotation } };
  };

  /** Degrees clockwise from straight up, round the table's centre. */
  #angleAround(p: PlanPlacement, clientX: number, clientY: number): number {
    const grid = this.renderRoot.querySelector(".grid")!.getBoundingClientRect();
    const dx = clientX - (grid.left + (p.x + p.width / 2) * GRID_SQUARE_PX);
    const dy = clientY - (grid.top + (p.y + p.height / 2) * GRID_SQUARE_PX);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  readonly #onPointerUp = (e: PointerEvent): void => {
    const drag = this.#drag!;
    if (e.pointerId !== drag.pointerId) return;
    const draft = this.draft;
    this.#endDrag();
    // A release away from where the press began sends its click to the grid, which would clear
    // the selection. That click comes in the same task as this pointerup. A tap's click goes to
    // the pressed button instead, which stops it.
    this.#ignoreGridClick = true;
    setTimeout(() => (this.#ignoreGridClick = false));
    if (draft === null) return;
    const from = drag.table.placement;
    const to = draft.placement;
    if (drag.kind === "rotate") {
      if (to.rotation === from.rotation) return;
      this.#rotate(draft.key, to.rotation);
    } else {
      if (to.x === from.x && to.y === from.y) return;
      this.#move(draft.key, to.x, to.y);
    }
  };

  readonly #onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.#drag!.pointerId) this.#endDrag();
  };

  #endDrag(): void {
    this.#drag = null;
    this.draft = null;
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerCancel);
  }

  #move(key: string, x: number, y: number): void {
    const detail: TableMove = { key, x, y };
    this.dispatchEvent(new CustomEvent("wt-table-move", { detail, bubbles: true, composed: true }));
  }

  #rotate(key: string, rotation: number): void {
    const detail: TableRotate = { key, rotation };
    this.dispatchEvent(
      new CustomEvent("wt-table-rotate", { detail, bubbles: true, composed: true }),
    );
  }

  #onTableClick(e: Event, key: string): void {
    e.stopPropagation();
    this.#select(key);
  }

  readonly #onGridClick = (e: Event): void => {
    e.stopPropagation();
    if (!this.#ignoreGridClick) this.#select(null);
  };

  #select(key: string | null): void {
    const detail: TableSelect = { key };
    this.dispatchEvent(
      new CustomEvent("wt-table-select", { detail, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-plan-canvas": WtFloorPlanCanvas;
  }
}
