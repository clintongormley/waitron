import { css } from "lit";

export const cellControlStyles = css`
  th:has(.sort),
  [data-selection-cell] {
    cursor: pointer;
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

export function forwardCellClick(event: MouseEvent): void {
  const target = event.target;
  if (
    event.defaultPrevented ||
    !(target instanceof Element) ||
    target.closest(
      "button, a, input, select, textarea, label, wt-button, wt-row-actions, wt-help-tooltip",
    )
  )
    return;
  const cell = event.currentTarget as HTMLTableCellElement;
  const control = cell.querySelector<HTMLElement>(".sort, .row-controls > input[type=checkbox]")!;
  event.stopPropagation();
  control.focus({ preventScroll: true });
  control.click();
}
