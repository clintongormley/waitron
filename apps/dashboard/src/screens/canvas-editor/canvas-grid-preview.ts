import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../../i18n/t.js";
import type { StringKey } from "../../i18n/strings.js";
import { EDITOR_ROW_HEIGHT, type CardInstance, type TabDef } from "./card-contracts.js";
import { cardPreview } from "./card-preview.js";

/**
 * The placeholder-tile grid, drawn at the till renderer's geometry (`apps/till/src/widgets/card-grid.ts`):
 * an inert `aria-hidden` thumbnail when `interactive` is false, the editor canvas when true. It emits
 * intents and never mutates the tab. rowSpan is visible only because the interactive grid pins
 * `grid-auto-rows` to {@link EDITOR_ROW_HEIGHT}; the thumbnail keeps content-sized rows.
 */

const DRAG_THRESHOLD_PX = 5;

/** `setPointerCapture` is best-effort: on a synthetic pointer (unit tests) it throws, and losing it
 * only means a real drag stops tracking once the pointer leaves the tile. */
function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* no active pointer (synthetic event) — the listeners on the element still fire */
  }
}
function releasePointer(el: Element, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    /* nothing captured */
  }
}

@customElement("canvas-grid-preview")
export class CanvasGridPreview extends LitElement {
  @property({ attribute: false }) tab: TabDef | null = null;
  @property({ type: Boolean }) interactive = false;
  @property({ type: Number }) selectedIndex = -1;

  @state() private draggingIndex: number | null = null;
  /** The pending insertion index, in the array WITHOUT the dragged card. */
  @state() private dropIndex: number | null = null;

  #drag: {
    pointerId: number;
    index: number;
    startX: number;
    startY: number;
    tiles: { index: number; cx: number; cy: number; height: number }[] | null;
  } | null = null;
  #resize: {
    pointerId: number;
    index: number;
    startX: number;
    startY: number;
    colStep: number;
    rowStep: number;
    startColSpan: number;
    startRowSpan: number;
    last: { colSpan: number; rowSpan: number };
  } | null = null;
  /** Set on pointerup after a real drag so the trailing synthetic `click` does not also select. */
  #suppressClick = false;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .grid {
        display: grid;
        gap: var(--wt-space-2);
        width: 100%;
      }
      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--wt-space-5);
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .tile {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        align-items: flex-start;
        justify-content: flex-start;
        padding: var(--wt-space-2);
        min-width: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        text-align: left;
      }
      button.tile {
        position: relative;
        font-family: inherit;
        cursor: pointer;
        touch-action: none;
      }
      button.tile.selected {
        outline: var(--wt-selected-ring);
        outline-offset: var(--wt-selected-ring-offset);
      }
      button.tile.dragging {
        opacity: 0.4;
      }
      button.tile.drop-before {
        box-shadow: inset var(--wt-space-1) 0 0 0 var(--wt-color-primary);
      }
      button.tile.drop-after {
        box-shadow: inset calc(-1 * var(--wt-space-1)) 0 0 0 var(--wt-color-primary);
      }
      .caption {
        display: flex;
        gap: var(--wt-space-2);
        align-items: baseline;
        width: 100%;
        min-width: 0;
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badge {
        margin-left: auto;
        color: var(--wt-color-text-muted);
      }
      /* The decorative silhouette fills the tile below the caption. pointer-events:none keeps every
         pointer gesture (drag/select) on the button beneath it, and the resize handle above it; the
         wrapper is aria-hidden so the screen reader announces only the caption. */
      .preview {
        flex: 1 1 auto;
        width: 100%;
        min-height: 0;
        overflow: hidden;
        pointer-events: none;
      }
      .cp {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-height: var(--wt-space-6);
      }
      /* Shared silhouette shapes — flat token-driven fills, no data. */
      .cp-cell,
      .cp-chip,
      .cp-ticket,
      .cp-order-line,
      .cp-header,
      .cp-table,
      .cp-expo-ticket,
      .cp-pay,
      .cp-toast,
      .cp-bell,
      .cp-amount,
      .cp-line-name,
      .cp-line-amount,
      .cp-column-ticket,
      .cp-expo-line {
        display: block;
        background: var(--wt-color-surface-raised);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      /* product-grid → a mini tile grid */
      .cp-product-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-auto-rows: 1fr;
        gap: var(--wt-space-1);
      }
      /* basket → sample order lines (name bar + amount bar) */
      .cp-basket {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--wt-space-1);
      }
      .cp-line {
        display: flex;
        gap: var(--wt-space-1);
        align-items: center;
        background: transparent;
        border: none;
        height: var(--wt-space-3);
      }
      .cp-line-name {
        flex: 1 1 auto;
        height: 100%;
      }
      .cp-line-amount {
        flex: 0 0 20%;
        height: 100%;
      }
      /* total → one big number */
      .cp-total {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cp-amount {
        width: 60%;
        height: var(--wt-space-5);
      }
      /* tender-pay → a couple of pay buttons (accent one) */
      .cp-tender-pay {
        display: flex;
        gap: var(--wt-space-1);
        align-items: stretch;
      }
      .cp-pay {
        flex: 1 1 0;
        min-height: var(--wt-space-5);
      }
      .cp-pay-primary {
        background: var(--wt-color-primary);
        border-color: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      /* held-orders → stacked chips */
      .cp-held-orders {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--wt-space-1);
      }
      .cp-chip {
        height: var(--wt-space-3);
        border-radius: var(--wt-radius-full);
      }
      /* prep-queue → a rail of ticket rows */
      .cp-prep-queue {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--wt-space-1);
      }
      .cp-ticket {
        height: var(--wt-space-4);
      }
      /* notifications → a bell + a toast line */
      .cp-notifications {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .cp-bell {
        flex: 0 0 auto;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-full);
      }
      .cp-toast {
        flex: 1 1 auto;
        height: var(--wt-space-3);
      }
      /* floor-plan / table-layout-editor → a few table shapes */
      .cp-floor-plan,
      .cp-table-layout-editor {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        gap: var(--wt-space-2);
      }
      .cp-table {
        position: relative;
        width: var(--wt-space-5);
        height: var(--wt-space-5);
      }
      .cp-table-round {
        border-radius: var(--wt-radius-full);
      }
      .cp-edit-handle {
        position: absolute;
        right: calc(-1 * var(--wt-space-1));
        bottom: calc(-1 * var(--wt-space-1));
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        background: var(--wt-color-primary);
        border-radius: var(--wt-radius-sm);
      }
      /* kds-board → status columns of ticket cards */
      .cp-kds-board {
        display: flex;
        gap: var(--wt-space-1);
        align-items: stretch;
      }
      .cp-column {
        flex: 1 1 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .cp-column-ticket {
        height: var(--wt-space-3);
      }
      /* expo → a row of order tickets */
      .cp-expo {
        display: flex;
        gap: var(--wt-space-1);
        align-items: stretch;
      }
      .cp-expo-ticket {
        flex: 1 1 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1);
      }
      .cp-expo-line {
        height: var(--wt-space-2);
      }
      /* table-order → a header row plus its ordered lines */
      .cp-table-order {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .cp-header {
        height: var(--wt-space-4);
      }
      .cp-order-line {
        height: var(--wt-space-2);
      }
      .resize-handle {
        position: absolute;
        right: 0;
        bottom: 0;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        cursor: nwse-resize;
        touch-action: none;
        border-right: 2px solid var(--wt-color-primary);
        border-bottom: 2px solid var(--wt-color-primary);
        border-bottom-right-radius: var(--wt-radius-md);
      }
    `,
  ];

  override render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === null) return nothing;
    if (tab.cards.length === 0) {
      return html`<div class="empty" data-test="empty-grid">${t("canvas_editor.empty_tab")}</div>`;
    }
    const mark = this.#dropMarker(tab);
    const autoRows = this.interactive ? `; grid-auto-rows: ${EDITOR_ROW_HEIGHT}px` : "";
    return html`<div
      class="grid"
      data-test="grid"
      style="grid-template-columns: repeat(${tab.columns}, 1fr)${autoRows}"
      aria-hidden=${this.interactive ? nothing : "true"}
    >
      ${tab.cards.map((card, index) => this.#tile(card, index, mark))}
    </div>`;
  }

  /** `before` the tile at `dropIndex`, or `after` the last non-dragged tile when the drop lands at the
   * very end. */
  #dropMarker(tab: TabDef): { index: number; side: "before" | "after" } | null {
    const drag = this.draggingIndex;
    const drop = this.dropIndex;
    if (drag === null || drop === null) return null;
    let count = 0;
    let lastNonDragged = -1;
    for (let i = 0; i < tab.cards.length; i++) {
      if (i === drag) continue;
      if (count === drop) return { index: i, side: "before" };
      lastNonDragged = i;
      count += 1;
    }
    return lastNonDragged === -1 ? null : { index: lastNonDragged, side: "after" };
  }

  #tile(
    card: CardInstance,
    index: number,
    mark: { index: number; side: "before" | "after" } | null,
  ): TemplateResult {
    // The cast is needed because the template literal widens to `string`.
    const name = t(`canvas_editor.card.${card.type}` as StringKey);
    const badge = `${card.colSpan}×${card.rowSpan}`;
    const style = `grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}`;
    // The silhouette is decorative (aria-hidden, pointer-events:none), so it never intercepts a pointer
    // gesture or leaks into the button's accessible name, which the caption supplies.
    const caption = html`<span class="caption"
      ><span class="name">${name}</span
      >${this.interactive ? html`<span class="badge">${badge}</span>` : nothing}</span
    >`;
    const preview = html`<div class="preview" data-test="preview-${index}" aria-hidden="true">
      ${cardPreview(card.type)}
    </div>`;
    const body = html`${caption}${preview}`;
    if (!this.interactive) {
      return html`<div class="tile" data-test="tile-${index}" style=${style}>${body}</div>`;
    }
    const selected = this.selectedIndex === index;
    const classes = [
      "tile",
      selected ? "selected" : "",
      this.draggingIndex === index ? "dragging" : "",
      mark?.index === index ? (mark.side === "before" ? "drop-before" : "drop-after") : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`<button
      type="button"
      class=${classes}
      data-test="tile-${index}"
      style=${style}
      aria-pressed=${selected ? "true" : "false"}
      @pointerdown=${(event: PointerEvent) => this.#onTilePointerDown(event, index)}
      @pointermove=${(event: PointerEvent) => this.#onTilePointerMove(event)}
      @pointerup=${(event: PointerEvent) => this.#onTilePointerUp(event)}
      @pointercancel=${(event: PointerEvent) => this.#onTilePointerCancel(event)}
      @click=${(event: MouseEvent) => this.#select(event, index)}
    >
      ${body}
      ${
        selected
          ? html`<span
              class="resize-handle"
              data-test="resize-handle"
              aria-hidden="true"
              @pointerdown=${(event: PointerEvent) => this.#onResizePointerDown(event, index)}
              @pointermove=${(event: PointerEvent) => this.#onResizePointerMove(event)}
              @pointerup=${(event: PointerEvent) => this.#onResizePointerUp(event)}
              @pointercancel=${(event: PointerEvent) => this.#onResizePointerCancel(event)}
              @click=${(event: MouseEvent) => event.stopPropagation()}
            ></span>`
          : nothing
      }
    </button>`;
  }

  // ── Drag-to-reorder ────────────────────────────────────────────────────────────────────────────

  #onTilePointerDown(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    // Start every gesture from clean state. A missed pointerup (possible when setPointerCapture didn't
    // take) would otherwise leave draggingIndex non-null, skip this gesture's measure block and wedge
    // dropIndex at 0.
    this.#suppressClick = false;
    this.draggingIndex = null;
    this.dropIndex = null;
    const tile = event.currentTarget as HTMLElement;
    capturePointer(tile, event.pointerId);
    this.#drag = {
      pointerId: event.pointerId,
      index,
      startX: event.clientX,
      startY: event.clientY,
      tiles: null,
    };
  }

  #onTilePointerMove(event: PointerEvent): void {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    if (this.draggingIndex === null) {
      const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (travelled < DRAG_THRESHOLD_PX) return;
      this.draggingIndex = drag.index;
      // Cache tile geometry ONCE: the dragged tile is only dimmed and the drop marker is an inset
      // box-shadow, so layout is static for the gesture. Assumes the grid is not scrolled mid-drag.
      drag.tiles = this.#measureTiles(drag.index);
    }
    this.dropIndex = this.#insertionIndex(event.clientX, event.clientY, drag.tiles ?? []);
  }

  #onTilePointerUp(event: PointerEvent): void {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const moved = this.draggingIndex !== null;
    const index = drag.index;
    const to = this.dropIndex;
    this.#endTileDrag(event.currentTarget as HTMLElement, event.pointerId);
    if (!moved) return;
    this.#suppressClick = true;
    if (to !== null && to !== index) {
      this.dispatchEvent(
        new CustomEvent<{ from: number; to: number }>("move-card", {
          detail: { from: index, to },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** A cancelled gesture is not a reorder: no `move-card`, and no `#suppressClick`, since no synthetic
   * click trails a `pointercancel`. */
  #onTilePointerCancel(event: PointerEvent): void {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    this.#endTileDrag(event.currentTarget as HTMLElement, event.pointerId);
  }

  #endTileDrag(tile: HTMLElement, pointerId: number): void {
    releasePointer(tile, pointerId);
    this.#drag = null;
    this.draggingIndex = null;
    this.dropIndex = null;
  }

  /** The dragged tile stays in flow, so DOM index still equals card index. */
  #measureTiles(dragIndex: number): { index: number; cx: number; cy: number; height: number }[] {
    const tiles = this.shadowRoot!.querySelectorAll<HTMLElement>("[data-test^=tile-]");
    const measured: { index: number; cx: number; cy: number; height: number }[] = [];
    tiles.forEach((tile, i) => {
      if (i === dragIndex) return;
      const r = tile.getBoundingClientRect();
      measured.push({
        index: i,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        height: r.height,
      });
    });
    return measured;
  }

  /** The count of non-dragged tiles whose centre precedes the pointer in flow order, over the geometry
   * cached at threshold-cross. */
  #insertionIndex(
    clientX: number,
    clientY: number,
    tiles: { cx: number; cy: number; height: number }[],
  ): number {
    let before = 0;
    for (const tile of tiles) {
      const sameRow = Math.abs(tile.cy - clientY) <= tile.height / 2;
      const precedes = tile.cy < clientY - tile.height / 2 || (sameRow && tile.cx < clientX);
      if (precedes) before += 1;
    }
    return before;
  }

  #select(event: MouseEvent, index: number): void {
    event.stopPropagation();
    if (this.#suppressClick) {
      this.#suppressClick = false;
      return;
    }
    this.dispatchEvent(
      new CustomEvent<{ index: number }>("select-card", {
        detail: { index },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ── Resize ─────────────────────────────────────────────────────────────────────────────────────

  #onResizePointerDown(event: PointerEvent, index: number): void {
    // Must not bubble to the tile — a resize is never a drag or a select.
    event.stopPropagation();
    if (event.button !== 0) return;
    const tab = this.tab;
    if (tab === null) return;
    const card = tab.cards[index];
    if (card === undefined) return;
    const grid = this.shadowRoot!.querySelector<HTMLElement>("[data-test=grid]")!;
    const rect = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const colGap = Number.parseFloat(cs.columnGap) || 0;
    const rowGap = Number.parseFloat(cs.rowGap) || 0;
    const colWidth = (rect.width - colGap * (tab.columns - 1)) / tab.columns;
    const handle = event.currentTarget as HTMLElement;
    capturePointer(handle, event.pointerId);
    this.#resize = {
      pointerId: event.pointerId,
      index,
      startX: event.clientX,
      startY: event.clientY,
      colStep: colWidth + colGap,
      rowStep: EDITOR_ROW_HEIGHT + rowGap,
      startColSpan: card.colSpan,
      startRowSpan: card.rowSpan,
      last: { colSpan: card.colSpan, rowSpan: card.rowSpan },
    };
  }

  #onResizePointerMove(event: PointerEvent): void {
    const resize = this.#resize;
    if (resize === null || event.pointerId !== resize.pointerId) return;
    const deltaCols = Math.round((event.clientX - resize.startX) / resize.colStep);
    const deltaRows = Math.round((event.clientY - resize.startY) / resize.rowStep);
    const colSpan = resize.startColSpan + deltaCols;
    const rowSpan = resize.startRowSpan + deltaRows;
    // Most pixels of travel do not cross a cell boundary, so skip a move that snaps to the same spans
    // as the last dispatch (or the start): the screen would rebuild the same draft for nothing.
    if (colSpan === resize.last.colSpan && rowSpan === resize.last.rowSpan) return;
    resize.last = { colSpan, rowSpan };
    // Emit the desired spans raw; the screen applies its existing 1..columns / ≥1 clamp.
    this.dispatchEvent(
      new CustomEvent<{ index: number; colSpan: number; rowSpan: number }>("resize-card", {
        detail: { index: resize.index, colSpan, rowSpan },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onResizePointerUp(event: PointerEvent): void {
    const resize = this.#resize;
    if (resize === null || event.pointerId !== resize.pointerId) return;
    this.#endResize(event.currentTarget as HTMLElement, event.pointerId);
  }

  /** Abandon the resize so a later stray `pointermove` on the handle cannot resume it. */
  #onResizePointerCancel(event: PointerEvent): void {
    const resize = this.#resize;
    if (resize === null || event.pointerId !== resize.pointerId) return;
    this.#endResize(event.currentTarget as HTMLElement, event.pointerId);
  }

  #endResize(handle: HTMLElement, pointerId: number): void {
    releasePointer(handle, pointerId);
    this.#resize = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "canvas-grid-preview": CanvasGridPreview;
  }
}
