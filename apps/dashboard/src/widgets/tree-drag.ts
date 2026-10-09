import { css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-icon.js";

/** What follows the pointer during a drag of a tree table's row. */
export interface DragGhost {
  label: string;
  image: string | null;
  folder: boolean;
}

export type DropGap = { key: string; side: "before" | "after" };

/** For a host whose `wt-data-table` draws the rows being dragged. */
export const treeDragStyles = css`
  wt-data-table::part(dragging) {
    opacity: var(--wt-opacity-disabled);
  }
  wt-data-table::part(drop-target) {
    border-inline-start: var(--wt-selected-ring);
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
        ? html`<img src=${`/media/${ghost.image}`} alt="" draggable="false" />`
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

const MARKS = ["dragging", "drop-target", "drop-gap-before", "drop-gap-after"];

/** The table re-renders rows in place, so marks are cleared and set again by key, never kept. */
export function clearDragMarks(root: ShadowRoot): void {
  for (const row of root.querySelectorAll('[part~="dragging"]'))
    row.removeAttribute("aria-disabled");
  for (const name of MARKS)
    for (const element of root.querySelectorAll(`[part~="${name}"]`)) element.part.remove(name);
}

export function shownRow(root: ShadowRoot, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
}

export function markDragging(row: HTMLElement | null): void {
  row?.part.add("dragging");
  // Faded text needs no contrast only as part of an inactive control, which the row is until the drop.
  row?.setAttribute("aria-disabled", "true");
}

export function markGap(root: ShadowRoot, gap: DropGap): void {
  for (const cell of root.querySelectorAll(`tr[data-row-key="${CSS.escape(gap.key)}"] > td`))
    cell.part.add(gap.side === "before" ? "drop-gap-before" : "drop-gap-after");
}

/** The last row drawn inside the row's branch, or the row itself when nothing under it is drawn. */
export function lastShownRow(root: ShadowRoot, key: string): string {
  let last = key;
  let level: number | null = null;
  for (const row of root.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")) {
    const rowLevel = Number(row.getAttribute("aria-level"));
    if (level === null) {
      if (row.dataset.rowKey === key) level = rowLevel;
      continue;
    }
    if (rowLevel <= level) break;
    last = row.dataset.rowKey!;
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
