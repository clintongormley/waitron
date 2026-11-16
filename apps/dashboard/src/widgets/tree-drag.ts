import {
  holdPageCursor,
  pointerElementsAt,
  releasePageCursor,
} from "@waitron/ui/src/reorder-table.js";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-icon.js";

/** What follows the pointer during a drag of a tree table's row. */
export interface DragGhost {
  label: string;
  image: string | null;
  folder: boolean;
}

export type DropGap = { key: string; side: "before" | "after"; row?: HTMLElement | null };

/** For a host whose `wt-data-table` draws the rows being dragged. */
export const treeDragStyles = css`
  wt-data-table::part(dragging) {
    opacity: var(--wt-opacity-disabled);
  }
  wt-data-table::part(drop-target) {
    border-inline-start: var(--wt-selected-ring);
  }
  /* Painted on every cell, not the row: the pinned cell paints its own background over the row's. */
  wt-data-table::part(drop-into) {
    background: var(--wt-color-surface-lifted);
    box-shadow:
      inset 0 var(--wt-field-line-width-active) 0 var(--wt-color-primary),
      inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
  }
  /* A shadow has no logical offset: this draws the right-hand edge. */
  wt-data-table::part(drop-into-end) {
    box-shadow:
      inset 0 var(--wt-field-line-width-active) 0 var(--wt-color-primary),
      inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary),
      inset calc(-1 * var(--wt-field-line-width-active)) 0 0 var(--wt-color-primary);
  }
  wt-data-table::part(drop-gap-before) {
    padding-block-start: calc(var(--wt-space-3) + var(--wt-tap-min));
    border-block-start: var(--wt-field-line-width-active) dashed var(--wt-color-primary);
  }
  wt-data-table::part(drop-gap-after) {
    padding-block-end: calc(var(--wt-space-3) + var(--wt-tap-min));
    border-block-end: var(--wt-field-line-width-active) dashed var(--wt-color-primary);
  }
  /* Placed by a transform from the pointer's own coordinates, which are physical. */
  .drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    margin: var(--wt-space-3) 0 0 var(--wt-space-3);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface-lifted);
    color: var(--wt-color-text);
    box-shadow: var(--wt-shadow-2);
    pointer-events: none;
  }
  .drag-ghost img,
  .ghost-thumb {
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
    border-radius: var(--wt-radius-md);
    object-fit: cover;
    background: var(--wt-color-surface);
  }
`;

export function dragGhost(ghost: DragGhost | null) {
  if (!ghost) return nothing;
  return html`<div class="drag-ghost" data-test="drag-ghost" aria-hidden="true">
    ${
      ghost.image
        ? html`<img src=${liveMediaImage(ghost.image, "square")} alt="" draggable="false" />`
        : ghost.folder
          ? html`<wt-icon name="folder" size="lg"></wt-icon>`
          : html`<span class="ghost-thumb"></span>`
    }<span>${ghost.label}</span>
  </div>`;
}

export function placeDragGhost(root: ParentNode, point: { x: number; y: number }): void {
  root
    .querySelector<HTMLElement>(".drag-ghost")
    ?.style.setProperty("transform", `translate(${point.x}px, ${point.y}px)`);
}

const MARKS = [
  "dragging",
  "drop-target",
  "drop-into",
  "drop-into-end",
  "drop-gap-before",
  "drop-gap-after",
];

/** The table re-renders rows in place, so marks are cleared and set again by key, never kept. */
export function clearDragMarks(root: ShadowRoot): void {
  for (const row of root.querySelectorAll('[part~="dragging"]'))
    row.removeAttribute("aria-disabled");
  for (const name of MARKS)
    for (const element of root.querySelectorAll(`[part~="${name}"]`)) element.part.remove(name);
}

export function shownRow(
  root: ShadowRoot,
  key: string,
  point?: { x: number; y: number },
): HTMLElement | null {
  const rows = [...root.querySelectorAll<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`)];
  return (
    (point &&
      rows.find((row) => {
        const box = row.getBoundingClientRect();
        return (
          point.y >= box.top && point.y <= box.bottom && point.x >= box.left && point.x <= box.right
        );
      })) ||
    rows[0] ||
    null
  );
}

export function markDragging(row: HTMLElement | null): void {
  row?.part.add("dragging");
  // Faded text needs no contrast only as part of an inactive control, which the row is until the drop.
  row?.setAttribute("aria-disabled", "true");
}

export function markInto(row: HTMLElement | null): void {
  const cells = [...(row?.querySelectorAll<HTMLElement>(":scope > td") ?? [])];
  cells[0]?.part.add("drop-target");
  for (const cell of cells) cell.part.add("drop-into");
  cells.at(-1)?.part.add("drop-into-end");
}

export function markGap(root: ShadowRoot, gap: DropGap): void {
  const cells = gap.row
    ? gap.row.querySelectorAll(":scope > td")
    : root.querySelectorAll(`tr[data-row-key="${CSS.escape(gap.key)}"] > td`);
  for (const cell of cells)
    cell.part.add(gap.side === "before" ? "drop-gap-before" : "drop-gap-after");
}

/** The last row drawn inside the row's branch, or the row itself when nothing under it is drawn. */
export function lastShownRow(
  root: ShadowRoot,
  key: string,
  point?: { x: number; y: number },
): HTMLElement | null {
  let last = shownRow(root, key, point);
  if (!last) return null;
  const level = Number(last.getAttribute("aria-level"));
  for (
    let row = last.nextElementSibling;
    row instanceof HTMLElement;
    row = row.nextElementSibling
  ) {
    if (!row.matches("tr[data-row-key]") || Number(row.getAttribute("aria-level")) <= level) break;
    last = row;
  }
  return last;
}

const blockClick = (event: MouseEvent): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
  document.removeEventListener("click", blockClick, true);
};

/** A released drag still sends a click, which must not activate the row it ends on. After Esc the
 * release comes later, so the block lasts until it. */
export function blockClickAfterDrag(untilRelease: boolean): void {
  document.addEventListener("click", blockClick, true);
  const lift = () => setTimeout(() => document.removeEventListener("click", blockClick, true), 0);
  if (untilRelease) document.addEventListener("pointerup", lift, { once: true, capture: true });
  else lift();
}

interface PointerSnapshot<D, T> {
  data: D;
  over: string | undefined;
  point: { x: number; y: number };
  target: T | undefined;
  changed: boolean;
  starting: boolean;
}

export class TreePointerDrag<D, T> {
  state: {
    pointerId: number;
    key: string;
    x: number;
    y: number;
    active: boolean;
    data?: D;
  } | null = null;
  point = { x: 0, y: 0 };
  target: T | undefined;
  #over: string | undefined;

  constructor(
    private readonly hooks: {
      activate(key: string): D | undefined;
      targetFor(data: D, over: string, point: { x: number; y: number }): T | undefined;
      sameTarget(a: T | undefined, b: T | undefined): boolean;
      moved(snapshot: PointerSnapshot<D, T>): void;
      ended(wasActive: boolean): void;
      drop(data: D, target: T): void;
    },
  ) {}

  start(event: PointerEvent, key: string): boolean {
    if (this.state || event.button !== 0 || (event.pointerType === "mouse" && event.ctrlKey))
      return false;
    this.state = {
      pointerId: event.pointerId,
      key,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    document.addEventListener("pointermove", this.#move);
    document.addEventListener("pointerup", this.#end);
    document.addEventListener("pointercancel", this.#end);
    document.addEventListener("keydown", this.#key, true);
    return true;
  }

  readonly #move = (event: PointerEvent): void => {
    const drag = this.state;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    event.preventDefault();
    this.point = { x: event.clientX, y: event.clientY };
    const starting = !drag.active;
    if (starting) {
      const data = this.hooks.activate(drag.key);
      if (data === undefined) {
        this.finish();
        return;
      }
      drag.data = data;
      drag.active = true;
      holdPageCursor();
    }
    this.#track(starting);
  };

  repaint(): void {
    if (this.state?.active) this.#track(false);
  }

  #track(starting: boolean): void {
    this.#over = pointerElementsAt(this.point.x, this.point.y).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.matches("tr[data-row-key]"),
    )?.dataset.rowKey;
    this.#refresh(starting);
  }

  revalidate(): void {
    if (this.state?.active) this.#refresh(false);
  }

  #currentTarget(): T | undefined {
    return this.#over === undefined
      ? undefined
      : this.hooks.targetFor(this.state!.data!, this.#over, this.point);
  }

  #refresh(starting: boolean): void {
    const target = this.#currentTarget();
    const changed = !this.hooks.sameTarget(target, this.target);
    this.target = target;
    this.hooks.moved({
      data: this.state!.data!,
      over: this.#over,
      point: this.point,
      target,
      changed,
      starting,
    });
  }

  readonly #end = (event: PointerEvent): void => {
    const drag = this.state;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const target = drag.active && this.target !== undefined ? this.#currentTarget() : undefined;
    const data = drag.data;
    const active = this.finish();
    if (!active || event.type !== "pointerup") return;
    blockClickAfterDrag(false);
    if (target !== undefined) this.hooks.drop(data!, target);
  };

  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.state?.active) return;
    event.preventDefault();
    event.stopPropagation();
    this.finish();
    blockClickAfterDrag(true);
  };

  finish(): boolean {
    const active = this.state?.active ?? false;
    document.removeEventListener("pointermove", this.#move);
    document.removeEventListener("pointerup", this.#end);
    document.removeEventListener("pointercancel", this.#end);
    document.removeEventListener("keydown", this.#key, true);
    this.state = null;
    this.target = undefined;
    this.#over = undefined;
    if (active) releasePageCursor();
    this.hooks.ended(active);
    return active;
  }
}
