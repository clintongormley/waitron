import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { floorPlanTableStyles } from "../floor-plan-table-styles.js";
import {
  GRID_SQUARE_PX,
  type PlanPlacement,
  type PlanCorner,
  type PlanRect,
  type PlanSide,
  bounds,
  clampToGrid,
  cornerSides,
  gridExtent,
  outward,
  type ResizeCursor,
  resizeCursor,
  resizeFrom,
  resizeFromCorner,
  rotatedRect,
  showsName,
  snapToSquare,
  stepInside,
} from "../floor-plan-geometry.js";
import { ROTATION_STEP, snapRotation } from "../floor.js";
import { Gestures, type GesturePoint } from "../gestures.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import { holdPageCursor, releasePageCursor } from "../reorder-table.js";
import { registerIcons } from "./wt-icon.js";

registerIcons({
  "floor-plan-rotate":
    "M3 3.25A9.75 9.75 0 0 1 12.75 13h-1.5A8.25 8.25 0 0 0 3 4.75zM3 1 0 4l3 3zM9 13l3 3 3-3z",
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
  /** The selected table's description: how the keys move and resize it. */
  keys?: string;
  /** Announced after a keyboard resize; "{width}" and "{height}" are replaced, in squares. */
  size?: string;
}

export interface TableSelect {
  key: string | null;
}

export interface TableMove {
  key: string;
  x: number;
  y: number;
}

/** `x` and `y`: where the table is after the turn, stepped in so it is no further past the plan's
 *  top or left edge than it was before the turn. */
export interface TableRotate {
  key: string;
  rotation: number;
  x: number;
  y: number;
}

export interface TableResize {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const SIDES: readonly PlanSide[] = ["top", "right", "bottom", "left"];

const CORNERS: readonly PlanCorner[] = ["top-left", "top-right", "bottom-right", "bottom-left"];

const isCorner = (handle: PlanSide | PlanCorner): handle is PlanCorner =>
  (CORNERS as readonly string[]).includes(handle);

/** A side shorter than this, in squares, draws no dot; its corners resize it. */
const SIDE_DOT_MIN_SQUARES = 4;

/** Judged from `t.placement`, never the draft: the canvas does not change `t.placement` during a
 *  drag, so a drag alone never makes a dot vanish under the pointer. */
function sidesWithDots(t: PlanCanvasTable): PlanSide[] {
  const { width, height } = t.placement;
  return SIDES.filter(
    (side) => (side === "top" || side === "bottom" ? width : height) >= SIDE_DOT_MIN_SQUARES,
  );
}

const DEFAULT_COPY: Required<FloorPlanCanvasCopy> = {
  label: "Floor plan",
  fixed: "Fixed",
  rotate: "Rotate {name}",
  keys: "Arrow keys move it. Shift and arrow keys resize it.",
  size: "{width} by {height}",
};

const px = (squares: number): string => `${squares * GRID_SQUARE_PX}px`;

/** How far to scroll so `start..end` lies inside `from..to`, keeping `start` when it cannot fit. */
function nearest(start: number, end: number, from: number, to: number): number {
  if (start < from) return start - from;
  if (end > to) return Math.min(end - to, start - from);
  return 0;
}

function sameBox(a: PlanPlacement, b: PlanPlacement): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Degrees clockwise from straight up, round the centre. */
function angleAround(centreX: number, centreY: number, clientX: number, clientY: number): number {
  return (Math.atan2(clientX - centreX, centreY - clientY) * 180) / Math.PI;
}

/** With Shift: the side each arrow key moves, and whether out (1) or in (-1). */
const RESIZE_KEYS: Record<string, { side: PlanSide; squares: number }> = {
  ArrowRight: { side: "right", squares: 1 },
  ArrowLeft: { side: "right", squares: -1 },
  ArrowDown: { side: "bottom", squares: 1 },
  ArrowUp: { side: "bottom", squares: -1 },
};

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowRight: { dx: 1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowUp: { dx: 0, dy: -1 },
};

type Grab = { kind: "move" | "rotate" } | { kind: "resize"; handle: PlanSide | PlanCorner };

type Drag = Grab & {
  table: PlanCanvasTable;
  pointerId: number;
  startX: number;
  startY: number;
  /** The table's centre on screen when it was pressed; it stays put while the drag lasts. */
  centreX: number;
  centreY: number;
  /** For a turn: the pointer's angle round the table's centre when it was pressed. */
  startAngle: number;
};

interface Draft {
  key: string;
  placement: PlanPlacement;
}

/**
 * Controlled: it never changes `tables` or `selected`, only asks through `wt-table-select`; the
 * parent sets `selected`. Tables keep their relative sizes, so a small one may be smaller than
 * `--wt-tap-min`.
 */
@customElement("wt-floor-plan-canvas")
export class WtFloorPlanCanvas extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    floorPlanTableStyles,
    css`
      :host {
        display: block;
      }

      .viewport {
        width: 100%;
        height: 100%;
        overflow: auto;
        touch-action: none;
        background-color: var(--wt-color-surface);
      }

      .grid {
        --wt-plan-control-scale: 1;
        position: relative;
        min-width: 100%;
        min-height: 100%;
        background-color: var(--wt-color-surface);
        background-origin: content-box;
        background-clip: content-box;
        background-image:
          linear-gradient(
            to right,
            var(--wt-color-border) calc(1px * var(--wt-plan-control-scale)),
            transparent calc(1px * var(--wt-plan-control-scale))
          ),
          linear-gradient(
            to bottom,
            var(--wt-color-border) calc(1px * var(--wt-plan-control-scale)),
            transparent calc(1px * var(--wt-plan-control-scale))
          );
      }

      .table {
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        cursor: pointer;
        touch-action: none;
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

      .frame {
        position: absolute;
        pointer-events: none;
      }

      .rotate-handle {
        position: absolute;
        left: 50%;
        bottom: calc(
          100% + (var(--wt-space-5) / 2 + var(--wt-space-1)) * var(--wt-plan-control-scale)
        );
        translate: -50% 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: calc(var(--wt-tap-min) * var(--wt-plan-control-scale));
        height: calc(var(--wt-tap-min) * var(--wt-plan-control-scale));
        margin: 0;
        padding: 0;
        border: none;
        background: none;
        color: var(--wt-color-text);
        cursor: grab;
        touch-action: none;
        pointer-events: auto;
      }

      .rotate-handle wt-icon {
        transform: scale(var(--wt-plan-control-scale));
      }

      .rotate-handle:focus-visible {
        outline: var(--wt-focus-ring);
      }

      .resize-handle,
      .resize-dot,
      .resize-corner-handle,
      .resize-corner {
        position: absolute;
      }

      /* Under the table's button, which takes a press where the two overlap, so a selected table
         of any size can still be dragged; a dot or corner is grabbed outside the table. */
      .resize-handle,
      .resize-corner-handle {
        width: calc(var(--wt-space-5) * var(--wt-plan-control-scale));
        height: calc(var(--wt-space-5) * var(--wt-plan-control-scale));
        margin: calc(var(--wt-space-5) * var(--wt-plan-control-scale) / -2) 0 0
          calc(var(--wt-space-5) * var(--wt-plan-control-scale) / -2);
        border-radius: var(--wt-radius-full);
        touch-action: none;
        pointer-events: auto;
      }

      .resize-dot,
      .resize-corner {
        width: calc(var(--wt-space-3) * var(--wt-plan-control-scale));
        height: calc(var(--wt-space-3) * var(--wt-plan-control-scale));
        margin: calc(var(--wt-space-3) * var(--wt-plan-control-scale) / -2) 0 0
          calc(var(--wt-space-3) * var(--wt-plan-control-scale) / -2);
      }

      .resize-dot {
        border: calc(var(--wt-space-1) * var(--wt-plan-control-scale) / 2) solid
          var(--wt-color-primary);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface);
      }

      .resize-dot[data-dragging] {
        background: var(--wt-color-primary);
      }

      .resize-corner {
        background: var(--wt-color-primary);
      }

      [data-side="top"] {
        top: 0;
        left: 50%;
      }

      [data-side="right"] {
        top: 50%;
        left: 100%;
      }

      [data-side="bottom"] {
        top: 100%;
        left: 50%;
      }

      [data-side="left"] {
        top: 50%;
        left: 0;
      }

      [data-corner="top-left"] {
        top: 0;
        left: 0;
      }

      [data-corner="top-right"] {
        top: 0;
        left: 100%;
      }

      [data-corner="bottom-right"] {
        top: 100%;
        left: 100%;
      }

      [data-corner="bottom-left"] {
        top: 100%;
        left: 0;
      }

      /* The drag listens on the window, so the pointer leaves the dot while the arrow should stay. */
      .viewport[data-resizing] * {
        cursor: inherit !important;
      }

      .size-badge {
        position: absolute;
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-text);
        color: var(--wt-color-bg);
        font-size: var(--wt-font-size-sm);
        text-wrap: nowrap;
        transform: translateX(-50%);
        pointer-events: none;
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  @property({ attribute: false }) tables: PlanCanvasTable[] = [];

  @property() selected: string | null = null;

  @property({ attribute: false }) copy: Partial<FloorPlanCanvasCopy> = {};

  /** Px at the canvas's bottom the parent draws over. The grid is drawn that much taller, so every
   *  table can be scrolled above it, and `reveal` keeps it clear. */
  @property({ type: Number }) bottomInset = 0;

  @state() private visible = { columns: 0, rows: 0 };

  @state() private draft: Draft | null = null;

  /** The table a keyboard resize last changed, until it loses focus. */
  @state() private keyResized: string | null = null;

  @state() private announcement = "";

  @state() private resizing: {
    key: string;
    handle: PlanSide | PlanCorner;
    cursor: ResizeCursor;
  } | null = null;

  @state() private zoom = 1;

  #gestures: Gestures | null = null;

  #scroll: { x: number; y: number } | null = null;

  #heldPan = { dx: 0, dy: 0 };

  #drag: Drag | null = null;

  #ignoreGridClick = false;

  /** Squares drawn left of and above the plan's (0, 0): `#margin`, plus the overhang of a turned
   *  table that arrives poking out past it, so its corners can be scrolled to. */
  #origin = { x: 0, y: 0 };

  /** Squares the grid is drawn, before `bottomInset`. */
  #size = { columns: 0, rows: 0 };

  /**
   * After a drag, the plan's layout before its drop and with it, and the box's size. Until the
   * tables show another layout or the box is resized, the room and the grid only grow, as during
   * the drag: less room at scroll 0, or a grid too short for its scroll, cannot be scrolled away,
   * so what was under the pointer would jump when it let go. After an arrow key's change (`key`),
   * the room shrinks only by what is scrolled, so no other table moves.
   */
  #hold: {
    before: string;
    after: string;
    visible: { columns: number; rows: number };
    key: boolean;
  } | null = null;

  /** Squares `#origin` changed by in this update, scrolled away in `updated` so nothing drawn moves
   *  where the scroll allows. */
  #shift = { x: 0, y: 0 };

  #drewTables = false;

  /** Squares kept above and left of the plan for a turn arrow. */
  #margin = 0;

  #observer = new ResizeObserver(([entry]) => {
    // The content box excludes scrollbars, and rounding down keeps the grid inside it, so the grid
    // never overflows only because a scrollbar appeared; min-width/min-height fill the remainder.
    const size = entry!.contentBoxSize[0]!;
    this.visible = {
      columns: Math.floor(size.inlineSize / GRID_SQUARE_PX),
      rows: Math.floor(size.blockSize / GRID_SQUARE_PX),
    };
  });

  get #copy(): Required<FloorPlanCanvasCopy> {
    return { ...DEFAULT_COPY, ...this.copy };
  }

  constructor() {
    super();
    this.addEventListener("pointerdown", this.#onViewPointerDown);
    this.addEventListener("wheel", this.#onWheel, { passive: false });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#gestures = new Gestures(this, {
      tap: this.#onTap,
      doubleTap: this.#onTap,
      holdStart: () => {
        this.#heldPan = { dx: 0, dy: 0 };
      },
      holdDrag: ({ dx, dy }) => {
        if (this.#drag === null)
          this.#moveView(1, 0, 0, dx - this.#heldPan.dx, dy - this.#heldPan.dy);
        this.#heldPan = { dx, dy };
      },
      pan: ({ dx, dy }) => {
        if (this.#drag === null) this.#moveView(1, 0, 0, dx, dy);
      },
      pinch: ({ ratio, x, y, dx, dy }) => {
        if (this.#drag !== null) return;
        const box = this.renderRoot.querySelector(".viewport")!.getBoundingClientRect();
        this.#moveView(ratio, x - box.left - dx, y - box.top - dy, dx, dy);
      },
    });
    void this.updateComplete.then(() => {
      if (this.isConnected) this.#observer.observe(this.renderRoot.querySelector(".viewport")!);
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
    this.#gestures!.disconnect();
    this.#gestures = null;
    this.#endDrag();
  }

  #placementOf(t: PlanCanvasTable): PlanPlacement {
    return this.draft?.key === t.key ? this.draft.placement : t.placement;
  }

  override willUpdate(changed: PropertyValues): void {
    const placements = this.tables.map((t) => this.#placementOf(t));
    const box = bounds(placements);
    const plan = gridExtent(placements, { columns: 0, rows: 0 });
    const hold = this.#holding(changed.has("tables"));
    // Not while a drag holds the room, so nothing drawn moves under the pointer.
    if (changed.has("zoom") || (hold !== "drag" && (!this.hasUpdated || changed.has("tables")))) {
      const host = getComputedStyle(this);
      // The arrow's furthest corner from the middle of the table's top side, which is never outside
      // the table's turned box, so a turn can point that distance along either axis.
      const tap = parseFloat(host.getPropertyValue("--wt-tap-min"));
      const reach = Math.hypot(
        parseFloat(host.getPropertyValue("--wt-space-5")) / 2 +
          parseFloat(host.getPropertyValue("--wt-space-1")) +
          tap,
        tap / 2,
      );
      this.#margin = Math.ceil((reach * Math.max(1, 1 / this.zoom)) / GRID_SQUARE_PX);
    }
    // Tolerates float error in a corner computed to land exactly on the edge.
    let x = this.#margin + (box === null ? 0 : Math.max(0, Math.ceil(-box.x - 1e-9)));
    let y = this.#margin + (box === null ? 0 : Math.max(0, Math.ceil(-box.y - 1e-9)));
    let columns: number;
    let rows: number;
    if (hold === "drag") {
      // Only grows, and the grid by as much again, so `updated` can scroll the growth away.
      x = Math.max(this.#origin.x, x);
      y = Math.max(this.#origin.y, y);
      columns = Math.max(this.#size.columns + x - this.#origin.x, x + plan.columns);
      rows = Math.max(this.#size.rows + y - this.#origin.y, y + plan.rows);
    } else {
      if (hold === "key") {
        const viewport = this.renderRoot.querySelector<HTMLElement>(".viewport")!;
        x = Math.max(
          x,
          this.#origin.x - Math.floor(viewport.scrollLeft / (GRID_SQUARE_PX * this.zoom)),
        );
        y = Math.max(
          y,
          this.#origin.y - Math.floor(viewport.scrollTop / (GRID_SQUARE_PX * this.zoom)),
        );
      }
      columns = Math.max(Math.floor(this.visible.columns / this.zoom), x + plan.columns);
      rows = Math.max(Math.floor(this.visible.rows / this.zoom), y + plan.rows);
    }
    // The first tables drawn take their room unscrolled, so their corners show from the start.
    if (this.#drewTables) {
      this.#shift = { x: x - this.#origin.x, y: y - this.#origin.y };
    }
    this.#drewTables ||= box !== null;
    this.#origin = { x, y };
    this.#size = { columns, rows };
  }

  /** `answered`: the tables were set in this update; set back to the layout before a change, they
   *  undo or refuse it. */
  #holding(answered: boolean): "drag" | "key" | null {
    if (this.#drag !== null) return "drag";
    if (this.#hold === null) return null;
    const { before, after, visible, key } = this.#hold;
    const now = this.#layout(null);
    const resized = visible.columns !== this.visible.columns || visible.rows !== this.visible.rows;
    const undone = answered && now === before && before !== after;
    if (resized || undone || (now !== before && now !== after)) {
      this.#hold = null;
      return null;
    }
    return key ? "key" : "drag";
  }

  #keyHold(change: Draft): void {
    const after = this.#layout(change);
    this.#hold = { before: this.#layout(null), after, visible: this.visible, key: true };
  }

  #layout(drop: Draft | null): string {
    return this.tables
      .map((t) => {
        const p = drop?.key === t.key ? drop.placement : t.placement;
        return `${t.key} ${p.x} ${p.y} ${p.width} ${p.height} ${p.rotation} ${p.shape}`;
      })
      .join("\n");
  }

  override render(): TemplateResult {
    const copy = this.#copy;
    const gridStyle = styleMap({
      width: px(this.#size.columns),
      height: `${this.#size.rows * GRID_SQUARE_PX + this.bottomInset / this.zoom}px`,
      backgroundSize: `${px(1)} ${px(1)}`,
      paddingLeft: px(this.#origin.x),
      paddingTop: px(this.#origin.y),
      zoom: String(this.zoom),
      "--wt-plan-control-scale": String(Math.max(1, 1 / this.zoom)),
      minWidth: `${100 / this.zoom}%`,
      minHeight: `${100 / this.zoom}%`,
    });
    return html`
      <div
        class="viewport"
        part="viewport"
        ?data-resizing=${this.resizing !== null}
        style=${styleMap({ cursor: this.resizing?.cursor })}
      >
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
      <span id="keys" hidden>${copy.keys}</span>
      <span class="visually-hidden" role="status">${this.announcement}</span>
    `;
  }

  #renderTable(t: PlanCanvasTable, copy: Required<FloorPlanCanvasCopy>): TemplateResult {
    const p = this.#placementOf(t);
    const style = this.#frameStyle(p);
    const selected = t.key === this.selected;
    const described = [
      ...(t.refused === undefined ? [] : [`reason-${t.key}`]),
      ...(selected ? ["keys"] : []),
    ];
    return html`
      ${selected ? this.#renderHitAreas(t, p) : nothing}
      <button
        type="button"
        class="table"
        part="table"
        data-key=${t.key}
        data-shape=${p.shape}
        aria-pressed=${t.key === this.selected ? "true" : "false"}
        aria-label=${t.fixed ? `${t.label}, ${copy.fixed}` : t.label}
        aria-describedby=${described.length === 0 ? nothing : described.join(" ")}
        ?data-refused=${t.refused !== undefined}
        style=${style}
        @click=${(e: Event) => this.#onTableClick(e, t.key)}
        @pointerdown=${(e: PointerEvent) => this.#onPointerDown(e, t, { kind: "move" })}
        @keydown=${(e: KeyboardEvent) => this.#onTableKey(e, t)}
        @blur=${() => this.#onTableBlur(t.key)}
      >
        ${showsName(p, GRID_SQUARE_PX) ? html`<span class="name">${t.label}</span>` : nothing}
        ${t.fixed ? html`<span class="fixed-marker" part="fixed-marker"></span>` : nothing}
      </button>
      ${t.refused === undefined ? nothing : this.#renderReason(t, p)}
      ${selected ? this.#renderHandles(t, p, copy) : nothing}
      ${this.#badged() === t.key ? this.#renderBadge(p) : nothing}
    `;
  }

  #frameStyle(p: PlanPlacement) {
    return styleMap({
      left: px(this.#origin.x + p.x),
      top: px(this.#origin.y + p.y),
      width: px(p.width),
      height: px(p.height),
      transform: `rotate(${p.rotation}deg)`,
    });
  }

  /** Outside the table's button, so a round table's clip never cuts it. Always below, past a
   *  selected table's bottom dot: the grid runs `gridExtent`'s margin past the lowest table. */
  #renderReason(t: PlanCanvasTable, p: PlanPlacement): TemplateResult {
    const box = this.#drawnBox(p);
    const dot =
      t.key === this.selected ? " + var(--wt-space-5) * var(--wt-plan-control-scale) / 2" : "";
    const style = styleMap({
      top: `calc(${px(box.y + box.height)}${dot} + var(--wt-space-1))`,
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

  /** The frame has the table's box and turn, so the arrow and the dots turn with the table. */
  #renderHandles(
    t: PlanCanvasTable,
    p: PlanPlacement,
    copy: Required<FloorPlanCanvasCopy>,
  ): TemplateResult {
    const dragged = this.resizing?.handle ?? null;
    return html`<div class="frame" style=${this.#frameStyle(p)}>
      <button
        type="button"
        class="rotate-handle"
        part="rotate-handle"
        aria-label=${copy.rotate.replace("{name}", () => t.label)}
        @click=${(e: Event) => e.stopPropagation()}
        @pointerdown=${(e: PointerEvent) => this.#onPointerDown(e, t, { kind: "rotate" })}
        @keydown=${(e: KeyboardEvent) => this.#onHandleKey(e, t)}
      >
        <wt-icon name="floor-plan-rotate" size="lg"></wt-icon>
      </button>
      ${sidesWithDots(t).map(
        (side) =>
          html`<div
            class="resize-dot"
            part="resize-dot"
            data-side=${side}
            ?data-dragging=${side === dragged}
            style=${styleMap({ cursor: resizeCursor(side, p.rotation) })}
          ></div>`,
      )}
      ${CORNERS.map(
        (corner) =>
          html`<div
            class="resize-corner"
            part="resize-corner"
            data-corner=${corner}
            style=${styleMap({ cursor: resizeCursor(corner, p.rotation) })}
          ></div>`,
      )}
    </div>`;
  }

  /** Drawn before the table's button, so the button is above them; the dots are drawn after it. */
  #renderHitAreas(t: PlanCanvasTable, p: PlanPlacement): TemplateResult {
    return html`<div class="frame" aria-hidden="true" style=${this.#frameStyle(p)}>
      ${sidesWithDots(t).map(
        (side) =>
          html`<div
            class="resize-handle"
            part="resize-handle"
            data-side=${side}
            style=${styleMap({ cursor: resizeCursor(side, p.rotation) })}
            @click=${(e: Event) => e.stopPropagation()}
            @pointerdown=${(e: PointerEvent) => this.#onPointerDown(e, t, { kind: "resize", handle: side })}
          ></div>`,
      )}
      ${CORNERS.map(
        (corner) =>
          html`<div
            class="resize-corner-handle"
            part="resize-corner-handle"
            data-corner=${corner}
            style=${styleMap({ cursor: resizeCursor(corner, p.rotation) })}
            @click=${(e: Event) => e.stopPropagation()}
            @pointerdown=${(e: PointerEvent) =>
              this.#onPointerDown(e, t, { kind: "resize", handle: corner })}
          ></div>`,
      )}
    </div>`;
  }

  /** Under the drawn box, where the reason goes; `updated` moves a reason below it. */
  #renderBadge(p: PlanPlacement): TemplateResult {
    const box = this.#drawnBox(p);
    const style = styleMap({
      left: px(box.x + box.width / 2),
      top: `calc(${px(box.y + box.height)} + var(--wt-space-5) * var(--wt-plan-control-scale) / 2 + var(--wt-space-1))`,
    });
    return html`<span class="size-badge" part="size-badge" aria-hidden="true" style=${style}
      >${p.width} × ${p.height}</span
    >`;
  }

  /** The table whose size badge shows: a dot drag's, else the selected table's after a keyboard
   *  resize. */
  #badged(): string | null {
    if (this.resizing !== null) return this.resizing.key;
    return this.keyResized === this.selected ? this.keyResized : null;
  }

  /** `p`'s turned box in squares from the drawn grid's corner. */
  #drawnBox(p: PlanPlacement): PlanRect {
    const box = rotatedRect(p);
    return { ...box, x: box.x + this.#origin.x, y: box.y + this.#origin.y };
  }

  /** Centres each reason under its table, held inside the grid: its width is known only once drawn. */
  override updated(): void {
    if (this.#scroll !== null) {
      const viewport = this.renderRoot.querySelector<HTMLElement>(".viewport")!;
      viewport.scrollLeft = this.#scroll.x;
      viewport.scrollTop = this.#scroll.y;
      this.#scroll = null;
    }
    if (this.#shift.x !== 0 || this.#shift.y !== 0) {
      const viewport = this.renderRoot.querySelector<HTMLElement>(".viewport")!;
      viewport.scrollLeft += this.#shift.x * GRID_SQUARE_PX * this.zoom;
      viewport.scrollTop += this.#shift.y * GRID_SQUARE_PX * this.zoom;
      this.#shift = { x: 0, y: 0 };
    }
    const reasons = this.renderRoot.querySelectorAll<HTMLElement>(".refused-reason");
    if (reasons.length === 0) return;
    const grid = this.renderRoot.querySelector<HTMLElement>(".grid")!.clientWidth;
    const badge = this.renderRoot.querySelector<HTMLElement>(".size-badge");
    const badged = this.#badged();
    for (const reason of reasons) {
      // The badge is drawn where the reason would be, and its height is known only once drawn.
      reason.style.translate =
        badge !== null && reason.dataset.key === badged
          ? `0 calc(${badge.offsetHeight}px + var(--wt-space-1))`
          : "";
      const width = reason.getBoundingClientRect().width / this.zoom;
      const centre = Number(reason.dataset.centre);
      const centred = centre - width / 2;
      const left = Math.min(Math.max(centred, 0), Math.max(grid - width, 0));
      const fits = left === centred;
      reason.style.left = `${fits ? centre : left}px`;
      reason.style.transform = fits ? "translateX(-50%)" : "";
    }
  }

  /**
   * Scrolls the canvas, never the page, so the drawn table `key` with its handle and reason sits in
   * the part of the canvas above `bottomInset` and inside the window's height; one taller than that
   * keeps its top.
   */
  reveal(key: string): void {
    const drawn = [...this.renderRoot.querySelectorAll<HTMLElement>("[data-key]")].filter(
      (node) => node.dataset.key === key,
    );
    if (!drawn.some((node) => node.classList.contains("table"))) return;
    const handle = key === this.selected ? this.renderRoot.querySelector(".rotate-handle") : null;
    const rects = [...drawn, ...(handle === null ? [] : [handle])].map((node) =>
      node.getBoundingClientRect(),
    );
    const viewport = this.renderRoot.querySelector<HTMLElement>(".viewport")!;
    const view = viewport.getBoundingClientRect();
    viewport.scrollTop += nearest(
      Math.min(...rects.map((r) => r.top)),
      Math.max(...rects.map((r) => r.bottom)),
      Math.max(view.top, 0),
      Math.min(view.bottom - this.bottomInset, window.innerHeight),
    );
    viewport.scrollLeft += nearest(
      Math.min(...rects.map((r) => r.left)),
      Math.max(...rects.map((r) => r.right)),
      view.left,
      view.right,
    );
  }

  #onTableKey(e: KeyboardEvent, t: PlanCanvasTable): void {
    if (e.shiftKey) {
      this.#onTableResizeKey(e, t);
      return;
    }
    const arrow = ARROWS[e.key];
    if (arrow === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const p = t.placement;
    const { x, y } = stepInside(
      { ...p, x: clampToGrid(p.x + arrow.dx), y: clampToGrid(p.y + arrow.dy) },
      p,
    );
    if (x === p.x && y === p.y) return;
    this.#keyHold({ key: t.key, placement: { ...t.placement, x, y } });
    this.#move(t.key, x, y);
  }

  #onTableResizeKey(e: KeyboardEvent, t: PlanCanvasTable): void {
    const resize = RESIZE_KEYS[e.key];
    if (resize === undefined || t.key !== this.selected) return;
    e.preventDefault();
    e.stopPropagation();
    const next = resizeFrom(t.placement, resize.side, resize.squares);
    if (sameBox(next, t.placement)) return;
    const { x, y, width, height } = next;
    this.#resize({ key: t.key, x, y, width, height });
    this.keyResized = t.key;
    this.announcement = this.#copy.size
      .replace("{width}", () => String(width))
      .replace("{height}", () => String(height));
  }

  #onTableBlur(key: string): void {
    if (this.keyResized === key) this.keyResized = null;
  }

  #onHandleKey(e: KeyboardEvent, t: PlanCanvasTable): void {
    const step =
      e.key === "ArrowRight" ? ROTATION_STEP : e.key === "ArrowLeft" ? -ROTATION_STEP : 0;
    if (step === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const placement = stepInside(
      { ...t.placement, rotation: snapRotation(t.placement.rotation + step) },
      t.placement,
    );
    this.#keyHold({ key: t.key, placement });
    this.#rotate(t.key, placement);
  }

  readonly #onViewPointerDown = (e: PointerEvent): void => {
    if (
      (e.pointerType === "touch" || e.pointerType === "pen") &&
      this.#drag !== null &&
      e.pointerId !== this.#drag.pointerId
    )
      this.#endDrag();
  };

  readonly #onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.#drag !== null) return;
    const viewport = this.renderRoot.querySelector<HTMLElement>(".viewport")!;
    const x = e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientWidth : 1);
    const y = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1);
    const box = viewport.getBoundingClientRect();
    this.#moveView(
      e.ctrlKey ? 2 ** (-y / 100) : 1,
      e.clientX - box.left,
      e.clientY - box.top,
      e.ctrlKey ? 0 : -x,
      e.ctrlKey ? 0 : -y,
    );
  };

  readonly #onTap = (at: GesturePoint): void => {
    if (at.pointerType !== "touch" && at.pointerType !== "pen") return;
    const target = at.target instanceof Element ? at.target.closest(".table") : null;
    if (target !== null) this.#select((target as HTMLElement).dataset.key!);
    else if (at.target instanceof Element && at.target.classList.contains("grid"))
      this.#select(null);
  };

  #moveView(ratio: number, mx: number, my: number, dx: number, dy: number): void {
    const viewport = this.renderRoot.querySelector<HTMLElement>(".viewport")!;
    const zoom = Math.min(4, Math.max(0.5, this.zoom * ratio));
    const change = zoom / this.zoom;
    const scroll = this.#scroll ?? { x: viewport.scrollLeft, y: viewport.scrollTop };
    this.#scroll = {
      x: Math.min(
        Math.max(0, this.#size.columns * GRID_SQUARE_PX * zoom - viewport.clientWidth),
        Math.max(0, (scroll.x + mx) * change - mx - dx),
      ),
      y: Math.min(
        Math.max(
          0,
          this.#size.rows * GRID_SQUARE_PX * zoom + this.bottomInset - viewport.clientHeight,
        ),
        Math.max(0, (scroll.y + my) * change - my - dy),
      ),
    };
    this.zoom = zoom;
    this.requestUpdate();
  }

  #onPointerDown(e: PointerEvent, t: PlanCanvasTable, grab: Grab): void {
    if (
      (e.pointerType === "touch" || e.pointerType === "pen") &&
      (t.key !== this.selected || this.#gestures!.active)
    )
      return;
    // Replacing a live drag's owner would leave the first pointer's pointerup unmatched.
    if (this.#drag !== null || e.button !== 0) return;
    // Cancelling the press also cancels the focus it would give, so give it back by hand.
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    const grid = this.renderRoot.querySelector(".grid")!.getBoundingClientRect();
    const p = t.placement;
    const centreX = grid.left + (this.#origin.x + p.x + p.width / 2) * GRID_SQUARE_PX * this.zoom;
    const centreY = grid.top + (this.#origin.y + p.y + p.height / 2) * GRID_SQUARE_PX * this.zoom;
    this.#drag = {
      ...grab,
      table: t,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      centreX,
      centreY,
      startAngle: angleAround(centreX, centreY, e.clientX, e.clientY),
    };
    window.addEventListener("pointermove", this.#onPointerMove);
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("pointercancel", this.#onPointerCancel);
    if (grab.kind === "resize") {
      const cursor = resizeCursor(grab.handle, p.rotation);
      this.resizing = { key: t.key, handle: grab.handle, cursor };
      holdPageCursor(cursor);
    }
  }

  // The window listeners below are attached only while `#drag` is set.
  readonly #onPointerMove = (e: PointerEvent): void => {
    const drag = this.#drag!;
    if (e.pointerId !== drag.pointerId) return;
    const p = drag.table.placement;
    const now = this.draft?.placement ?? p;
    if (drag.kind === "move") {
      const { x, y } = stepInside(
        {
          ...p,
          x: clampToGrid(p.x + snapToSquare((e.clientX - drag.startX) / this.zoom)),
          y: clampToGrid(p.y + snapToSquare((e.clientY - drag.startY) / this.zoom)),
        },
        p,
      );
      if (x !== now.x || y !== now.y) {
        this.draft = { key: drag.table.key, placement: { ...p, x, y } };
      }
      return;
    }
    if (drag.kind === "resize") {
      const along = (side: PlanSide) => {
        const out = outward(side, p.rotation);
        const moved = (e.clientX - drag.startX) * out.x + (e.clientY - drag.startY) * out.y;
        return snapToSquare(moved / this.zoom);
      };
      const { handle } = drag;
      let next: PlanPlacement;
      if (isCorner(handle)) {
        const { vertical, horizontal } = cornerSides(handle);
        next = resizeFromCorner(p, handle, along(horizontal), along(vertical));
      } else {
        next = resizeFrom(p, handle, along(handle));
      }
      if (!sameBox(next, now)) this.draft = { key: drag.table.key, placement: next };
      return;
    }
    const turn = angleAround(drag.centreX, drag.centreY, e.clientX, e.clientY) - drag.startAngle;
    const rotation = snapRotation(p.rotation + turn);
    if (rotation !== now.rotation) {
      this.draft = { key: drag.table.key, placement: stepInside({ ...p, rotation }, p) };
    }
  };

  readonly #onPointerUp = (e: PointerEvent): void => {
    const drag = this.#drag!;
    if (e.pointerId !== drag.pointerId) return;
    const from = drag.table.placement;
    const to = this.draft?.placement ?? from;
    const turned = drag.kind === "rotate" && to.rotation !== from.rotation;
    const moved = drag.kind === "move" && (to.x !== from.x || to.y !== from.y);
    const resized = drag.kind === "resize" && !sameBox(to, from);
    const drop = turned || moved || resized ? this.draft : null;
    this.#endDrag(drop);
    // A release away from where the press began sends its click to the grid, which would clear
    // the selection. That click comes in the same task as this pointerup. A tap's click goes to
    // the pressed button instead, which stops it.
    this.#ignoreGridClick = true;
    setTimeout(() => (this.#ignoreGridClick = false));
    if (turned) this.#rotate(drag.table.key, to);
    if (moved) this.#move(drag.table.key, to.x, to.y);
    if (resized)
      this.#resize({ key: drag.table.key, x: to.x, y: to.y, width: to.width, height: to.height });
  };

  readonly #onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.#drag!.pointerId) this.#endDrag();
  };

  #endDrag(drop: Draft | null = null): void {
    if (this.#drag !== null) {
      this.#hold = {
        before: this.#layout(null),
        after: this.#layout(drop),
        visible: this.visible,
        key: false,
      };
    }
    if (this.resizing !== null) releasePageCursor();
    this.#drag = null;
    this.resizing = null;
    this.draft = null;
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerCancel);
  }

  #move(key: string, x: number, y: number): void {
    const detail: TableMove = { key, x, y };
    this.dispatchEvent(new CustomEvent("wt-table-move", { detail, bubbles: true, composed: true }));
  }

  #resize(detail: TableResize): void {
    this.dispatchEvent(
      new CustomEvent("wt-table-resize", { detail, bubbles: true, composed: true }),
    );
  }

  #rotate(key: string, { rotation, x, y }: PlanPlacement): void {
    const detail: TableRotate = { key, rotation, x, y };
    this.dispatchEvent(
      new CustomEvent("wt-table-rotate", { detail, bubbles: true, composed: true }),
    );
  }

  #onTableClick(e: Event, key: string): void {
    e.stopPropagation();
    if (!(e instanceof PointerEvent && (e.pointerType === "touch" || e.pointerType === "pen")))
      this.#select(key);
  }

  readonly #onGridClick = (e: Event): void => {
    e.stopPropagation();
    if (
      !this.#ignoreGridClick &&
      !(e instanceof PointerEvent && (e.pointerType === "touch" || e.pointerType === "pen"))
    )
      this.#select(null);
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
