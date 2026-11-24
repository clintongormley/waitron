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
    padding-block: calc(var(--wt-space-1) / 2);
  }

  :host([dense-rows][narrow]) tbody td {
    padding-block: calc(var(--wt-space-2) / 2);
  }
`;

const CELL_CONTROLS =
  "button, a, input, select, textarea, label, [role=button], [role=switch], wt-button, wt-row-actions, wt-help-tooltip, wt-switch";

function fromCellControl(event: Event): boolean {
  const path = event.composedPath();
  return path
    .slice(0, path.indexOf(event.currentTarget!))
    .some((target) => target instanceof Element && target.matches(CELL_CONTROLS));
}

const controlPresses = new WeakMap<EventTarget, number>();

// A press on a control and release on cell padding can dispatch a click to the cell itself.
export const rememberCellPress = {
  capture: true,
  handleEvent(event: PointerEvent): void {
    const cell = event.currentTarget!;
    if (fromCellControl(event)) controlPresses.set(cell, event.pointerId);
    else controlPresses.delete(cell);
  },
};

export function forwardCellClick(event: MouseEvent): void {
  const cell = event.currentTarget as HTMLTableCellElement;
  if (event.detail > 0) {
    const fromPointer = controlPresses.get(cell);
    controlPresses.delete(cell);
    if (
      fromPointer !== undefined &&
      (!(event instanceof PointerEvent) || event.pointerId === fromPointer)
    )
      return;
  }
  if (fromCellControl(event)) return;
  const control = cell.querySelector<HTMLElement>(".sort, .row-controls > input[type=checkbox]")!;
  event.stopPropagation();
  control.focus({ preventScroll: true });
  control.click();
}
