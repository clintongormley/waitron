import { css, html, nothing, type TemplateResult } from "lit";
import type { FloorChip } from "./floor.js";
import { registerIcons } from "./components/wt-icon.js";

registerIcons({
  "floor-timer":
    "M6 .5h4v2H6zM8 3a6 6 0 1 1 0 12A6 6 0 0 1 8 3zM8 5a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM7 5.5h2v4H7z",
  "floor-out":
    "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM8 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM3.05 4.46l1.41-1.41 8.49 8.49-1.41 1.41z",
  "floor-bill":
    "M3 1h10v14l-2-1.5-1.5 1.5-1.5-1.5-1.5 1.5-1.5-1.5L3 15zM5 4v1.5h6V4zM5 7v1.5h6V7zM5 10v1.5h4V10z",
  "floor-ready":
    "M8 4a4.5 4.5 0 1 1 0 9A4.5 4.5 0 0 1 8 4zM8 5.75a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 1 0 0-5.5zM1 2.5h.6v3.5h.4V2.5h.6v3.5h.4V2.5h.6v4.5L2.6 8v6.5H1.4V8L1 7zM13 2.5c1.6.8 2.2 3 2.2 5.5h-.7v6.5H13z",
  "floor-step": "M2 11.5a6 6 0 0 1 12 0zM1 12.5h14v2H1zM7 3.5h2V5H7z",
  "floor-unsent":
    "M2 14l.71-3.54 4.95-4.95 2.83 2.83-4.95 4.95zM8.22 4.95l1.56-1.56 2.83 2.83-1.56 1.56z",
  "floor-clear": "M7 1h2v8H7zM4 8.5h8l1.5 6.5h-11zM6 11v4h1v-4zM9 11v4h1v-4z",
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
