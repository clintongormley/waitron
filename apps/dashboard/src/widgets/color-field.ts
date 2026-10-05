import { css, html, nothing, type TemplateResult } from "lit";
import { CATEGORY_PALETTE, isHexColor } from "@waitron/ui";
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
    display: inline-grid;
    grid-template-columns: auto auto;
    align-items: center;
    column-gap: var(--wt-space-2);
    width: auto;
    height: auto;
    min-height: var(--wt-space-6);
    padding: var(--wt-space-1) var(--wt-space-2);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font-size: var(--wt-font-size-sm);
    text-align: start;
  }
  .swatch.none > :not(.chip) {
    grid-column: 1 / -1;
  }
  .swatch.none > .chip ~ :not(.chip) {
    grid-column: 2;
  }
  .chip {
    width: var(--wt-space-4);
    height: var(--wt-space-4);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
  }
  .note {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  /* Row named: a host's own label rule may stack its labels' contents. */
  .custom {
    display: inline-flex;
    flex-direction: row;
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
  .custom input[type="color"].on {
    outline: var(--wt-selected-ring);
    outline-offset: var(--wt-selected-ring-offset);
  }
  /* Separate rules, never one selector list: Chromium drops a whole list that names
     ::-moz-color-swatch. */
  .custom input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  .custom input[type="color"]::-webkit-color-swatch {
    border: none;
  }
  .custom input[type="color"]::-moz-color-swatch {
    border: none;
  }
  /* A native colour input always holds a colour (an empty value reads back as #000000), so with
     none chosen it would paint black. */
  .custom input[type="color"].empty {
    background: transparent;
  }
  .custom input[type="color"].empty::-webkit-color-swatch {
    visibility: hidden;
  }
  .custom input[type="color"].empty::-moz-color-swatch {
    visibility: hidden;
  }
  .field-error {
    color: var(--wt-color-danger);
  }
`;

export interface ColorFieldOptions {
  /** A hex colour, or null for none. */
  color: string | null;
  /** Given, the no-colour choice reads "Use category colour" and shows the category's colour in a
   * chip read as its description, or, for null, says as its second line that there is none. Absent,
   * it reads "No colour" and says nothing more. */
  categoryColor?: string | null;
  busy: boolean;
  error: string;
  /** The custom colour input's `name`. */
  name: string;
  errorId: string;
  change: (color: string | null) => void;
}

/**
 * A "no colour" choice and the palette as one radio group, and a custom colour input beside it.
 * The custom input's selection is shown by its ring alone: a colour input may take no role (ARIA in
 * HTML, `input type=color`), so it cannot join the radio group.
 */
export function colorField(options: ColorFieldOptions): TemplateResult {
  const { color, busy, error, name, errorId, change } = options;
  // Checked, because the chip paints it into a style attribute; anything else reads as no colour.
  const inherited =
    typeof options.categoryColor === "string" && !isHexColor(options.categoryColor)
      ? null
      : options.categoryColor;
  const labelId = `${name}-none-label`;
  const fallback =
    inherited === undefined
      ? null
      : inherited !== null
        ? {
            id: `${name}-none-value`,
            before: html`<span
              class="chip"
              aria-hidden="true"
              style=${`background:${inherited}`}
            ></span>`,
            after: html`<span id=${`${name}-none-value`} hidden>${inherited}</span>`,
          }
        : {
            id: `${name}-none-note`,
            before: nothing,
            after: html`<span class="note" id=${`${name}-none-note`}
              >${t("editor.color_category_none")}</span
            >`,
          };
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
    <legend>${t("editor.color")}</legend>
    <div class="color-options" role="radiogroup" aria-label=${t("editor.color")}>
      <button
        type="button"
        class="swatch none ${color === null ? "on" : ""}"
        role="radio"
        aria-checked=${color === null}
        aria-labelledby=${labelId}
        aria-describedby=${fallback?.id ?? nothing}
        data-color=""
        .disabled=${busy}
        @click=${(event: Event) => {
          event.stopPropagation();
          change(null);
        }}
      >
        ${fallback?.before ?? nothing}<span id=${labelId}
          >${inherited === undefined ? t("editor.color_none") : t("editor.color_use_category")}</span
        >${fallback?.after ?? nothing}
      </button>
      <div class="swatches">
        ${PALETTE_GROUPS.map(
          (group) => html`<div class="swatch-group">${group.map((value) => swatch(value))}</div>`,
        )}
      </div>
    </div>
    <label class="custom"
      >${t("editor.color_custom")}
      <input
        type="color"
        class=${
          color === null
            ? "empty"
            : (CATEGORY_PALETTE as readonly string[]).includes(color)
              ? ""
              : "on"
        }
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
