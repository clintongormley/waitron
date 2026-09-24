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

export interface FloorCanvasCopy {
  floor: string;
  covers: string;
  toServe: string;
  reserved: string;
  zone: string;
  rotate: string;
  remove: string;
  /** The shape picker group's accessible name, not one shape's. */
  shape: string;
  shapeRound: string;
  shapeSquare: string;
  shapeRect: string;
}

const DEFAULT_COPY: FloorCanvasCopy = {
  floor: "Floor plan",
  covers: "covers",
  toServe: "to serve",
  reserved: "Reserved",
  zone: "Zone",
  rotate: "Rotate",
  remove: "Remove from plan",
  shape: "Shape",
  shapeRound: "Round",
  shapeSquare: "Square",
  shapeRect: "Rect",
};

const SHAPES: readonly TableShape[] = ["round", "square", "rect"];

/** Permille moved by one arrow-key nudge when grid snap is off. */
const NUDGE_STEP = 10;

interface DragState {
  table: FloorTable;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface TableHandlers {
  tap: (e: Event) => void;
  down: (e: PointerEvent) => void;
  key: (e: KeyboardEvent) => void;
}

/**
 * Controlled: it never mutates `.tables`, only reports each edit as `wt-placement-change` or
 * `wt-placement-clear`; the parent persists it and re-feeds `.tables`.
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

      .meta .covers {
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

  @property({ attribute: false }) tables: FloorTable[] = [];

  @property({ type: Boolean, reflect: true }) editable = false;

  @property({ type: Boolean }) gridSnap = false;

  @property({ attribute: false }) copy: Partial<FloorCanvasCopy> = {};

  @state() private selectedId: string | null = null;

  @state() private draft: { id: string; posX: number; posY: number } | null = null;

  @query(".canvas") private canvasEl!: HTMLElement;

  #drag: DragState | null = null;

  /**
   * Memoised per `this.tables` reference, so a drag writing `draft` on every pointermove does not make
   * Lit rebind every token's listeners each frame.
   */
  #tableHandlers = new Map<string, TableHandlers>();
  #handlersFor: readonly FloorTable[] | null = null;

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

  #handlersOf(t: FloorTable): TableHandlers {
    if (this.#handlersFor !== this.tables) {
      this.#tableHandlers.clear();
      for (const table of this.tables) {
        this.#tableHandlers.set(table.id, {
          tap: (e: Event) => this.#onTap(e, table),
          down: (e: PointerEvent) => this.#onPointerDown(e, table),
          key: (e: KeyboardEvent) => this.#onKeyDown(e, table),
        });
      }
      this.#handlersFor = this.tables;
    }
    return this.#tableHandlers.get(t.id)!;
  }

  #renderTable(t: FloorTable, copy: FloorCanvasCopy): TemplateResult {
    const pos = this.draft?.id === t.id ? this.draft : { posX: t.posX, posY: t.posY };
    const style = styleMap({
      left: `${pos.posX / 10}%`,
      top: `${pos.posY / 10}%`,
      transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    });
    const handlers = this.#handlersOf(t);
    // No aria-label: it would replace the name computed from the token's content, so a screen reader
    // would hear the table's label but not its total and badges.
    return html`
      <button
        type="button"
        class="table state-${t.state}"
        data-table=${t.id}
        data-size=${sizeForCapacity(t.capacity)}
        style=${style}
        @click=${handlers.tap}
        @pointerdown=${handlers.down}
        @keydown=${handlers.key}
      >
        <wt-table-token
          .table=${t}
          .labels=${{ covers: copy.covers, toServe: copy.toServe, reserved: copy.reserved }}
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
              ? html`<span class="covers">${t.capacity} ${copy.covers}</span>`
              : nothing
          }
        </div>
        <div class="palette" role="group" aria-label=${copy.shape}>
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

  /** Stops the native click so a consumer sees `wt-open-table` alone, not the composed click too. */
  #onTap(e: Event, t: FloorTable): void {
    e.stopPropagation();
    if (this.editable) {
      this.selectedId = t.id;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: t.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onPointerDown(e: PointerEvent, t: FloorTable): void {
    if (!this.editable) return;
    // Replacing a live drag's owner would leave the first pointer's pointerup unmatched.
    if (this.#drag !== null) return;
    e.preventDefault();
    this.#drag = {
      table: t,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    window.addEventListener("pointermove", this.#onPointerMove);
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("pointercancel", this.#onPointerCancel);
  }

  readonly #onPointerMove = (e: PointerEvent): void => {
    if (this.#drag === null || e.pointerId !== this.#drag.pointerId) return;
    this.#drag.moved = true;
    this.draft = { id: this.#drag.table.id, ...this.#pointerToPos(e.clientX, e.clientY) };
  };

  readonly #onPointerUp = (e: PointerEvent): void => {
    const drag = this.#drag;
    if (drag !== null && e.pointerId !== drag.pointerId) return;
    if (drag === null || !drag.moved) {
      this.#endDrag();
      return;
    }
    // `#pointerToPos` reads `#drag`, so read the position before tearing the gesture down.
    const raw = this.#pointerToPos(e.clientX, e.clientY);
    this.#endDrag();
    const posX = this.gridSnap ? clampPermille(snapToGrid(raw.posX)) : raw.posX;
    const posY = this.gridSnap ? clampPermille(snapToGrid(raw.posY)) : raw.posY;
    this.#emitPlacement({ ...this.#placementOf(drag.table), posX, posY });
  };

  readonly #onPointerCancel = (e: PointerEvent): void => {
    if (this.#drag !== null && e.pointerId !== this.#drag.pointerId) return;
    this.#endDrag();
  };

  #endDrag(): void {
    this.#drag = null;
    this.draft = null;
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerCancel);
  }

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
    const trimmed = value.trim();
    this.#emitPlacement({ ...this.#placementOf(t), zoneId: trimmed === "" ? null : trimmed });
  }

  #onDeactivate(t: FloorTable): void {
    const detail: PlacementClear = { tableId: t.id };
    this.dispatchEvent(
      new CustomEvent("wt-placement-clear", { detail, bubbles: true, composed: true }),
    );
  }

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
      new CustomEvent("wt-placement-change", { detail, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-canvas": WtFloorCanvas;
  }
}
