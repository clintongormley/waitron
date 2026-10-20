import { css, html, nothing, type TemplateResult } from "lit";
import type { FloorChip } from "./floor.js";
import { registerIcons } from "./components/wt-icon.js";

registerIcons({
  "floor-timer":
    "M6 1h4v1.5H6zM8 3a6 6 0 1 1 0 12A6 6 0 0 1 8 3zM8 4.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM7.25 6h1.5v3.5h-1.5z",
  "floor-out":
    "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM8 3.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM3.7 4.76l1.06-1.06 7.54 7.54-1.06 1.06z",
  "floor-bill":
    "M3 1h10v14l-2-1.5-1.5 1.5-1.5-1.5-1.5 1.5-1.5-1.5L3 15zM5 4v1.5h6V4zM5 7v1.5h6V7zM5 10v1.5h4V10z",
  "floor-ready": "M2 11a6 6 0 0 1 12 0zM1 12h14v1.5H1zM7 3h2v1.5H7z",
  "floor-step": "M2 7h8V4l5 4-5 4V9H2z",
  "floor-unsent":
    "M7.25 10V4.6L5 6.85 3.95 5.8 8 1.75l4.05 4.05-1.05 1.05-2.25-2.25V10zM2 9h1.5v3.5h9V9H14v5H2z",
  "floor-clear":
    "M3.4 2.3 8 6.9l4.6-4.6 1.1 1.1L9.1 8l4.6 4.6-1.1 1.1L8 9.1l-4.6 4.6-1.1-1.1L6.9 8 2.3 3.4z",
  "floor-move": "M1 8l3.5-3.5V7h7V4.5L15 8l-3.5 3.5V9h-7v2.5z",
  "floor-held": "M4 3h3v10H4zM9 3h3v10H9z",
  "floor-fire": "M5 3v10l8-5z",
  "floor-check": "M2 8.6l1.4-1.4 3 3L12.6 4 14 5.4l-7.6 7.6z",
});

/** Every icon a floor cue can draw, each registered above. */
export const FLOOR_CUE_ICONS = [
  "floor-timer",
  "floor-out",
  "floor-bill",
  "floor-ready",
  "floor-step",
  "floor-unsent",
  "floor-clear",
  "floor-move",
  "floor-held",
  "floor-fire",
  "floor-check",
] as const;

export type FloorCueIcon = (typeof FLOOR_CUE_ICONS)[number];

/** Theme text on a neutral chip with its tone as the border, except `primary-filled`, which is the
 * primary/on-primary pair. */
export const floorChipStyles = css`
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-1);
    padding: var(--wt-space-1) var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface-raised);
    color: var(--wt-color-text);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }

  .chip.tone-success {
    border-color: var(--wt-color-success);
  }

  .chip.tone-primary {
    border-color: var(--wt-color-primary);
  }

  .chip.tone-warning {
    border-color: var(--wt-color-warning);
  }

  .chip.tone-danger {
    border-color: var(--wt-color-danger);
  }

  .chip wt-icon {
    flex: none;
    color: inherit;
  }

  .chip.tone-muted {
    border-color: var(--wt-color-text-muted);
  }

  .chip.tone-primary-filled {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
  }
`;

/** Each chip in the order given, styled by {@link floorChipStyles}. */
export function renderFloorChips(chips: readonly FloorChip[]): TemplateResult[] {
  return chips.map(
    (chip) =>
      html`<span class="chip tone-${chip.tone}" data-chip=${chip.key}
        >${chip.icon ? html`<wt-icon name=${chip.icon} size="sm"></wt-icon>` : nothing}${chip.text}</span
      >`,
  );
}
