import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import {
  FLOOR_ASPECT,
  type FloorTable,
  GRID_STEP,
  type PlacementChange,
  type PlacementClear,
  ROTATION_STEP,
  type TableShape,
  clampPermille,
  sizeForCapacity,
  snapRotation,
  snapToGrid,
} from "../floor.js";
import "./wt-table-token.js";

/**
 * The user-facing copy the canvas needs. Threaded as a prop (the `@waitron/ui` convention — copy is
 * never hardcoded locale text), with English defaults so the component is usable and testable
 * standalone. A consumer app (the till, the dashboard) passes its own i18n; only the keys it overrides
 * change. `covers`/`toServe` also flow down into each `<wt-table-token>`.
 */
export interface FloorCanvasCopy {
  floor: string;
  table: string;
  covers: string;
  toServe: string;
  zone: string;
  rotate: string;
  remove: string;
  shapeRound: string;
  shapeSquare: string;
  shapeRect: string;
}

const DEFAULT_COPY: FloorCanvasCopy = {
  floor: "Floor plan",
  table: "Table",
  covers: "covers",
  toServe: "to serve",
  zone: "Zone",
  rotate: "Rotate",
  remove: "Remove from plan",
  shapeRound: "Round",
  shapeSquare: "Square",
  shapeRect: "Rect",
};

/** The three shapes the palette offers, paired with their copy key. */
const SHAPES: readonly TableShape[] = ["round", "square", "rect"];

/** How far an arrow-key nudge moves a table when grid snap is off (a fine adjustment, in permille). */
const NUDGE_STEP = 10;

interface DragState {
  table: FloorTable;
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * The shared spatial floor plan (FP-2). In VIEW mode it lays every placed table out on a fixed-aspect
 * (3:2) canvas at its `posX`/`posY` permille coordinates, each rendered with the shared
 * `<wt-table-token>` so the map and the till's list card can never drift; tapping a table asks the app
 * to open its tab (`open-table`). In EDIT mode (`.editable`) a table can be dragged (snapping to a 50‰
 * grid when `.gridSnap`), reshaped from a palette, rotated in 15° detents, re-homed to a zone, or
 * cleared from the plan; every gesture emits `placement-change` (or `placement-clear`). Tables stay
 * keyboard-reachable — each is a real `<button>`, and the arrow keys nudge the focused one.
 *
 * The component is CONTROLLED: it never mutates `.tables`, it only reports the intent. The parent owns
 * the data and re-feeds `.tables` after persisting a change.
 */
@customElement("wt-floor-canvas")
export class WtFloorCanvas extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .canvas {
        position: relative;
        width: 100%;
        aspect-ratio: ${FLOOR_ASPECT};
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        overflow: hidden;
        touch-action: none;
      }

      .table {
        position: absolute;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      :host([editable]) .table {
        cursor: grab;
      }

      .table[data-size="S"] {
        width: calc(var(--wt-tap-min) * 1.1);
      }

      .table[data-size="M"] {
        width: calc(var(--wt-tap-min) * 1.4);
      }

      .table[data-size="L"] {
        width: calc(var(--wt-tap-min) * 1.7);
      }

      .table[data-size="XL"] {
        width: calc(var(--wt-tap-min) * 2.1);
      }

      .inspector {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-3);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .meta {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .meta .name {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .meta .plazas {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .palette {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .zone {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .zone input {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      button.chip {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      button.chip[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        color: var(--wt-color-primary);
      }

      button.chip.deactivate {
        border-color: var(--wt-color-danger);
        color: var(--wt-color-danger);
      }
    `,
  ];

  /** The tables to lay out. The component never mutates this — it is controlled by the parent. */
  @property({ attribute: false }) tables: FloorTable[] = [];

  /** Edit mode: tables become draggable/selectable and the inspector appears. */
  @property({ type: Boolean, reflect: true }) editable = false;

  /** Snap drags and nudges to the {@link GRID_STEP} (50‰) grid. */
  @property({ type: Boolean }) gridSnap = false;

  /** Localisable copy (see {@link FloorCanvasCopy}); only overridden keys need supplying. */
  @property({ attribute: false }) copy: Partial<FloorCanvasCopy> = {};

  /** The id of the table shown in the inspector, if any. */
  @state() private selectedId: string | null = null;

  /** Live position of the table being dragged, so it tracks the pointer before the drop is committed. */
  @state() private draft: { id: string; posX: number; posY: number } | null = null;

  @query(".canvas") private canvasEl!: HTMLElement;

  #drag: DragState | null = null;

  get #copy(): FloorCanvasCopy {
    return { ...DEFAULT_COPY, ...this.copy };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#endDrag();
  }

  override render(): TemplateResult {
    const copy = this.#copy;
    const selected =
      this.editable && this.selectedId != null
        ? (this.tables.find((t) => t.id === this.selectedId) ?? null)
        : null;
    return html`
      <div class="canvas" role="group" aria-label=${copy.floor}>
        ${this.tables.map((t) => this.#renderTable(t, copy))}
      </div>
      ${selected ? this.#renderInspector(selected, copy) : nothing}
    `;
  }

  #renderTable(t: FloorTable, copy: FloorCanvasCopy): TemplateResult {
    const pos = this.draft?.id === t.id ? this.draft : { posX: t.posX, posY: t.posY };
    const style = styleMap({
      left: `${pos.posX / 10}%`,
      top: `${pos.posY / 10}%`,
      transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    });
    return html`
      <button
        class="table state-${t.state}"
        data-table=${t.id}
        data-size=${sizeForCapacity(t.capacity)}
        style=${style}
        aria-label=${`${copy.table} ${t.label}`}
        @click=${() => this.#onTap(t)}
        @pointerdown=${(e: PointerEvent) => this.#onPointerDown(e, t)}
        @keydown=${(e: KeyboardEvent) => this.#onKeyDown(e, t)}
      >
        <wt-table-token
          .table=${t}
          .labels=${{ covers: copy.covers, toServe: copy.toServe }}
        ></wt-table-token>
      </button>
    `;
  }

  #renderInspector(t: FloorTable, copy: FloorCanvasCopy): TemplateResult {
    return html`
      <div class="inspector">
        <div class="meta">
          <span class="name">${t.label}</span>
          ${
            t.capacity != null
              ? html`<span class="plazas">${t.capacity} ${copy.covers}</span>`
              : nothing
          }
        </div>
        <div class="palette" role="group" aria-label=${copy.shapeRound}>
          ${SHAPES.map(
            (shape) => html`
              <button
                type="button"
                class="chip"
                data-shape=${shape}
                aria-pressed=${(t.shape ?? "round") === shape}
                @click=${() => this.#onShape(t, shape)}
              >
                ${this.#shapeLabel(shape, copy)}
              </button>
            `,
          )}
        </div>
        <label class="zone">
          ${copy.zone}
          <input
            .value=${t.zoneId ?? ""}
            @change=${(e: Event) => this.#onZone(t, (e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="actions">
          <button type="button" class="chip rotate" @click=${() => this.#onRotate(t)}>
            ${copy.rotate}
          </button>
          <button type="button" class="chip deactivate" @click=${() => this.#onDeactivate(t)}>
            ${copy.remove}
          </button>
        </div>
      </div>
    `;
  }

  #shapeLabel(shape: TableShape, copy: FloorCanvasCopy): string {
    if (shape === "round") return copy.shapeRound;
    if (shape === "square") return copy.shapeSquare;
    return copy.shapeRect;
  }

  // --- interaction ---

  /** A plain tap: open the table (view) or select it for the inspector (edit). */
  #onTap(t: FloorTable): void {
    if (this.editable) {
      this.selectedId = t.id;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("open-table", {
        detail: { tableId: t.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onPointerDown(e: PointerEvent, t: FloorTable): void {
    if (!this.editable) return;
    e.preventDefault();
    this.#drag = { table: t, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener("pointermove", this.#onPointerMove);
    window.addEventListener("pointerup", this.#onPointerUp);
  }

  readonly #onPointerMove = (e: PointerEvent): void => {
    if (this.#drag === null) return;
    this.#drag.moved = true;
    this.draft = { id: this.#drag.table.id, ...this.#pointerToPos(e.clientX, e.clientY) };
  };

  readonly #onPointerUp = (e: PointerEvent): void => {
    const drag = this.#drag;
    if (drag === null || !drag.moved) {
      this.#endDrag();
      return;
    }
    // Read the final position while #drag is still live, THEN tear the gesture down.
    const raw = this.#pointerToPos(e.clientX, e.clientY);
    this.#endDrag();
    const posX = this.gridSnap ? clampPermille(snapToGrid(raw.posX)) : raw.posX;
    const posY = this.gridSnap ? clampPermille(snapToGrid(raw.posY)) : raw.posY;
    this.#emitPlacement({ ...this.#placementOf(drag.table), posX, posY });
  };

  #endDrag(): void {
    this.#drag = null;
    this.draft = null;
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
  }

  /** Maps a pointer position to permille coordinates via the drag's start offset. */
  #pointerToPos(clientX: number, clientY: number): { posX: number; posY: number } {
    const drag = this.#drag!;
    const rect = this.canvasEl.getBoundingClientRect();
    const dxFrac = (clientX - drag.startX) / rect.width;
    const dyFrac = (clientY - drag.startY) / rect.height;
    return {
      posX: clampPermille(Math.round(drag.table.posX + dxFrac * 1000)),
      posY: clampPermille(Math.round(drag.table.posY + dyFrac * 1000)),
    };
  }

  #onKeyDown(e: KeyboardEvent, t: FloorTable): void {
    if (!this.editable) return;
    const step = this.gridSnap ? GRID_STEP : NUDGE_STEP;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    this.selectedId = t.id;
    const nextX = clampPermille(t.posX + dx);
    const nextY = clampPermille(t.posY + dy);
    const posX = this.gridSnap ? clampPermille(snapToGrid(nextX)) : nextX;
    const posY = this.gridSnap ? clampPermille(snapToGrid(nextY)) : nextY;
    this.#emitPlacement({ ...this.#placementOf(t), posX, posY });
  }

  #onShape(t: FloorTable, shape: TableShape): void {
    this.#emitPlacement({ ...this.#placementOf(t), shape });
  }

  #onRotate(t: FloorTable): void {
    this.#emitPlacement({
      ...this.#placementOf(t),
      rotation: snapRotation((t.rotation ?? 0) + ROTATION_STEP),
    });
  }

  #onZone(t: FloorTable, value: string): void {
    this.#emitPlacement({ ...this.#placementOf(t), zoneId: value.trim() === "" ? null : value });
  }

  #onDeactivate(t: FloorTable): void {
    const detail: PlacementClear = { tableId: t.id };
    this.dispatchEvent(
      new CustomEvent("placement-clear", { detail, bubbles: true, composed: true }),
    );
  }

  /** The table's current full placement, the base every edit gesture overrides one field of. */
  #placementOf(t: FloorTable): PlacementChange {
    return {
      tableId: t.id,
      posX: t.posX,
      posY: t.posY,
      shape: t.shape ?? "round",
      rotation: t.rotation ?? 0,
      zoneId: t.zoneId ?? null,
    };
  }

  #emitPlacement(detail: PlacementChange): void {
    this.dispatchEvent(
      new CustomEvent("placement-change", { detail, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-canvas": WtFloorCanvas;
  }
}
