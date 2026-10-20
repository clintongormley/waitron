import { css, html, nothing, type TemplateResult } from "lit";
import type { FloorChip } from "./floor.js";
import { registerIcons } from "./components/wt-icon.js";

registerIcons({
  held: "M4 3h3v10H4zM9 3h3v10H9z",
  fire: "M5 3v10l8-5z",
});

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
