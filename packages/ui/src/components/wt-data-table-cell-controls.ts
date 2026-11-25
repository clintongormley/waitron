import { css } from "lit";

export const cellControlStyles = css`
  th:has(.sort),
  [data-selection-cell] {
    cursor: pointer;
  }

  th wt-help-tooltip {
    cursor: auto;
  }

  /* Keep checkbox padding above the row's stretched activation button. */
  td[data-selection-cell] {
    position: relative;
    z-index: 1;
  }

  :host([dense-rows]) tbody td {
    --wt-table-cell-padding-block: calc(var(--wt-space-1) / 2);
    padding-block: var(--wt-table-cell-padding-block);
  }

  :host([dense-rows][narrow]) tbody td {
    --wt-table-cell-padding-block: calc(var(--wt-space-2) / 2);
  }
`;

const CELL_ACTION = ".sort, .row-controls > input[type=checkbox]";
const CELL_CONTROLS =
  "button, a, input, select, textarea, label, [role=button], wt-button, wt-row-actions, wt-help-tooltip";

function fromCellControl(event: Event, except?: Element | null): boolean {
  const path = event.composedPath();
  return path
    .slice(0, path.indexOf(event.currentTarget!))
    .some(
      (target) => target !== except && target instanceof Element && target.matches(CELL_CONTROLS),
    );
}

const controlPresses = new WeakSet<HTMLTableCellElement>();

// A press on a neighboring control can dispatch its click to the cell if the pointer slips.
export function rememberCellPress(event: PointerEvent): void {
  const cell = event.currentTarget as HTMLTableCellElement;
  if (fromCellControl(event, cell.querySelector(CELL_ACTION))) controlPresses.add(cell);
  else controlPresses.delete(cell);
}

export function forwardCellClick(event: MouseEvent): void {
  const cell = event.currentTarget as HTMLTableCellElement;
  if (event.detail > 0 && controlPresses.delete(cell)) return;
  if (fromCellControl(event)) return;
  const control = cell.querySelector<HTMLElement>(CELL_ACTION)!;
  event.stopPropagation();
  control.focus({ preventScroll: true });
  control.click();
}
