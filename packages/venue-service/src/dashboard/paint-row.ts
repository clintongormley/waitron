import { css, html, nothing } from "lit";
import type { CalendarColour } from "../hours-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

/** A paint chip: a period, or `id: null` for Closed. */
export interface PaintPot {
  id: string | null;
  name: string;
  colour?: CalendarColour;
  /** Offers ✎ beside the chip. */
  edit?: () => void;
}

/** The row of paint chips above a painter's grid; the host also takes `periodColourStyles`. */
export const paintRowStyles = css`
  .paint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    border-block-start: 1px solid var(--wt-color-border);
    border-block-end: 1px solid var(--wt-color-border);
    padding-block: var(--wt-space-2);
  }
  .paint .label {
    color: var(--wt-color-text-muted);
  }
  .pots {
    display: contents;
  }
  /* On a phone the paint chips scroll sideways in one line, leaving the height to the grid. */
  @media (width < 720px) {
    .pots {
      display: flex;
      align-items: center;
      gap: var(--wt-space-2);
      flex: 1 1 100%;
      min-width: 0;
      overflow-x: auto;
      padding: var(--wt-field-line-width-active);
    }
    .pots > * {
      flex: none;
    }
    /* A scroller with nothing to focus in it cannot be scrolled by keyboard; nothing here acts. */
    .paint[data-disabled] .pots {
      overflow-x: clip;
    }
    .hint {
      margin-inline-start: 0;
    }
  }
  .paint[data-disabled] .pot,
  .paint[data-disabled] .new {
    opacity: var(--wt-opacity-disabled);
  }
  .paint[data-disabled] button {
    cursor: default;
  }
  .pot {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
  }
  .pot:has(button[aria-pressed="true"]) {
    outline: var(--wt-field-line-width-active) solid var(--wt-color-text);
  }
  .pot button,
  .new {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-2);
    min-height: var(--wt-tap-min);
    border: 0;
    background: none;
    color: var(--wt-color-text);
    padding: 0 var(--wt-space-3);
    font: inherit;
    cursor: pointer;
  }
  .pot button[aria-pressed="true"] {
    font-weight: var(--wt-font-weight-bold);
  }
  .pot button:focus-visible,
  .new:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
  .pot .edit {
    padding-inline: var(--wt-space-2);
    gap: var(--wt-space-1);
    color: var(--wt-color-primary-text);
  }
  .new {
    border: 1px dashed var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }
  .swatch {
    inline-size: var(--wt-space-3);
    block-size: var(--wt-space-3);
    border-radius: var(--wt-radius-sm);
    background: var(--period-fill);
  }
  .swatch.closed {
    background: repeating-linear-gradient(
      135deg,
      var(--wt-color-border) 0 var(--wt-space-1),
      transparent 0 calc(var(--wt-space-1) * 2)
    );
  }
  .hint {
    margin-inline-start: auto;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
`;

export function paintRow(options: {
  pots: readonly PaintPot[];
  chosen: string | null;
  choose: (id: string | null) => void;
  /** Offers "+ New period" after the chips. */
  newPeriod?: () => void;
  /** Nothing can be painted yet: every button is disabled and the chips are drawn quiet. */
  disabled?: boolean;
  slot?: string;
}) {
  const { pots, chosen, choose, newPeriod, disabled = false, slot } = options;
  return html`<div
    slot=${slot ?? nothing}
    class="paint"
    data-test="paint-row"
    ?data-disabled=${disabled}
  >
    <div class="pots">
      <span class="label">${t("painter.paint")}</span>
      ${pots.map(
        (pot) =>
          html`<span class="pot">
            <button
              type="button"
              data-test=${pot.id === null ? "paint-closed" : `paint-${pot.id}`}
              aria-pressed=${chosen === pot.id ? "true" : "false"}
              ?disabled=${disabled}
              @click=${() => choose(pot.id)}
            >
              <span
                class=${pot.id === null ? "swatch closed" : "swatch"}
                data-colour=${pot.colour ?? nothing}
              ></span
              >${pot.name}
            </button>
            ${
              pot.edit
                ? html`<button
                    type="button"
                    class="edit"
                    data-test=${`edit-${pot.id}`}
                    aria-label=${format("painter.edit_period", { name: pot.name })}
                    ?disabled=${disabled}
                    @click=${pot.edit}
                  >
                    <span aria-hidden="true">✎</span> ${t("painter.edit")}
                  </button>`
                : nothing
            }
          </span>`,
      )}
      ${
        newPeriod
          ? html`<button
              type="button"
              class="new"
              data-test="new-period"
              ?disabled=${disabled}
              @click=${newPeriod}
            >
              ${t("painter.new_period")}
            </button>`
          : nothing
      }
    </div>
    <span class="hint" data-test="hint">${t("painter.hint")}</span>
  </div>`;
}
