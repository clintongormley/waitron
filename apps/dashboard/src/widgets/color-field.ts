import { css, html, nothing, type TemplateResult } from "lit";
import { CATEGORY_PALETTE } from "@waitron/ui";
import { t } from "../i18n/t.js";

const PALETTE_GROUP_SIZE = CATEGORY_PALETTE.length / 2;
const PALETTE_GROUPS = [
  CATEGORY_PALETTE.slice(0, PALETTE_GROUP_SIZE),
  CATEGORY_PALETTE.slice(PALETTE_GROUP_SIZE),
];

/** A host adds these to its own styles: the field renders into the host's shadow root. */
export const colorFieldStyles = css`
  fieldset.color {
    display: grid;
    gap: var(--wt-space-2);
    border: none;
    margin: 0;
    padding: 0;
  }
  fieldset.color legend {
    padding: 0;
    font: inherit;
  }
  .color-options {
    display: grid;
    justify-items: start;
    gap: var(--wt-space-2);
  }
  .swatches {
    /* Each half holds four complete hues. They sit together as an 8 × 3 matrix when there is
           room, then wrap as two 4 × 3 blocks without splitting any hue's three tones. */
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-2);
  }
  .swatch-group {
    display: grid;
    grid-template-rows: repeat(3, var(--wt-space-6));
    grid-auto-flow: column;
    grid-auto-columns: var(--wt-space-6);
    gap: var(--wt-space-2);
  }
  .swatch {
    width: var(--wt-space-6);
    height: var(--wt-space-6);
    padding: 0;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    cursor: pointer;
  }
  .swatch.on {
    outline: var(--wt-selected-ring);
    outline-offset: var(--wt-selected-ring-offset);
  }
  .swatch.none {
    width: auto;
    padding: 0 var(--wt-space-2);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font-size: var(--wt-font-size-sm);
  }
  .custom {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-2);
    font-size: var(--wt-font-size-sm);
  }
  .custom input[type="color"] {
    width: var(--wt-space-6);
    height: var(--wt-space-6);
    padding: 0;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    cursor: pointer;
  }
  .field-error {
    color: var(--wt-color-danger);
  }
`;

export interface ColorFieldOptions {
  /** A hex colour, or null for none. */
  color: string | null;
  busy: boolean;
  error: string;
  /** The custom colour input's `name`. */
  name: string;
  errorId: string;
  change: (color: string | null) => void;
}

/** The palette, a "no colour" choice and a custom colour picker, as one radio group. */
export function colorField(options: ColorFieldOptions): TemplateResult {
  const { color, busy, error, name, errorId, change } = options;
  const swatch = (value: string) =>
    html`<button
      type="button"
      class="swatch ${color === value ? "on" : ""}"
      style=${`background:${value}`}
      role="radio"
      aria-checked=${color === value}
      aria-label=${value}
      data-color=${value}
      .disabled=${busy}
      @click=${(event: Event) => {
        event.stopPropagation();
        change(value);
      }}
    ></button>`;
  return html`<fieldset class="color">
    <legend>${t("categories.color")}</legend>
    <div class="color-options" role="radiogroup" aria-label=${t("categories.color")}>
      <button
        type="button"
        class="swatch none ${color === null ? "on" : ""}"
        role="radio"
        aria-checked=${color === null}
        data-color=""
        .disabled=${busy}
        @click=${(event: Event) => {
          event.stopPropagation();
          change(null);
        }}
      >
        ${t("categories.color_none")}
      </button>
      <div class="swatches">
        ${PALETTE_GROUPS.map(
          (group) => html`<div class="swatch-group">${group.map((value) => swatch(value))}</div>`,
        )}
      </div>
    </div>
    <label class="custom"
      >${t("categories.color_custom")}
      <input
        type="color"
        name=${name}
        aria-invalid=${error ? "true" : "false"}
        aria-describedby=${errorId}
        .value=${color ?? "#000000"}
        .disabled=${busy}
        @input=${(event: Event) => {
          event.stopPropagation();
          change((event.target as HTMLInputElement).value);
        }}
    /></label>
    <span class="field-error" id=${errorId}>${error || nothing}</span>
  </fieldset>`;
}
