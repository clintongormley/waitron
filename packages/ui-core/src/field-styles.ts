import { css, html, nothing, type TemplateResult } from "lit";
import { visuallyHiddenStyles } from "./base-styles.js";
import "./components/wt-icon.js";

export interface InheritedFieldValue {
  value: string;
  suffix?: string;
  inTable?: boolean;
}

export function inheritArrow(widthText?: string): TemplateResult {
  return html`<span class="inherit-cue" aria-hidden="true"
    ><wt-icon name="inherit" size="sm" aria-hidden="true"></wt-icon>${
      widthText ? html`<span class="inherit-width">${widthText}</span>` : nothing
    }</span
  >`;
}

export function inheritedDescription(id: string, value: string, suffix?: string): TemplateResult {
  return html`<span id=${id} class="hint">${value}${suffix ? ` ${suffix}` : ""}</span>`;
}

const ALWAYS_FLOAT = new Set(["date", "time", "datetime-local", "month", "week"]);

/** Whether a field's label rests large in the box or floats small at the top. Focus is CSS's job
 * (`:focus-within`), so it is not an input here. A date or time type always floats, because the
 * browser draws its own format text in an empty one. */
export function fieldLabelState(opts: {
  value: string;
  hint: string;
  placeholder: string;
  type?: string;
}): "rest" | "float" {
  if (opts.value !== "" || opts.hint !== "" || opts.placeholder !== "") return "float";
  return ALWAYS_FLOAT.has((opts.type ?? "").toLowerCase()) ? "float" : "rest";
}

/** The label a field primitive draws inside its box, pointing at the control `forId` names. */
export function fieldLabel(forId: string, label: string, required: boolean): TemplateResult {
  return html`<label class="field-label" for=${forId}
    ><span class="field-label-text">${label}</span>${
      required ? html`<span class="required" data-required aria-hidden="true">*</span>` : nothing
    }</label
  >`;
}

/** The filled field box shared by every field primitive: `.field[part=field]` holding a
 * `.field-label` and a `.field-control`, the `.row` that sets it beside a `help` slot, and the
 * `.error` and visually hidden `.hint` paragraphs under it. See design-system.md → Forms. */
export const fieldStyles = css`
  .field {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-height: var(--wt-field-height);
    background: var(--wt-color-field-fill);
    border-start-start-radius: var(--wt-radius-md);
    border-start-end-radius: var(--wt-radius-md);
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width)) 0 var(--wt-color-field-line);
  }
  .field-label {
    position: absolute;
    inset-inline: var(--wt-space-3);
    top: var(--wt-space-2);
    display: flex;
    font-size: var(--wt-font-size-sm);
    color: var(--wt-color-text-muted);
  }
  /* The text takes the ellipsis so a required field's star, after it, is never the part cut. */
  .field-label-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .field-label .required {
    flex: none;
  }
  .field[data-label="rest"]:not(:focus-within):not(:has(:autofill)) .field-label {
    top: 50%;
    transform: translateY(-50%);
    font-size: inherit;
  }
  .field-control {
    width: 100%;
    min-width: var(--wt-tap-min);
    min-height: var(--wt-field-height);
    padding: calc(var(--wt-space-3) + var(--wt-font-size-sm)) var(--wt-space-3) var(--wt-space-2);
    border: 0;
    background: transparent;
    color: var(--wt-color-field-value);
    font: inherit;
    text-overflow: ellipsis;
  }
  input.field-control:not([type="file"]),
  textarea.field-control,
  button.field-control {
    font-size: var(--wt-text-control-font-size);
  }
  /* A button control shows no value while its label rests, so its chevron is centred beside the
     label; the padding adds up to the floated one's so the box keeps its height. */
  .field[data-label="rest"]:not([data-compact], :focus-within) button.field-control {
    padding-block: calc((var(--wt-space-3) + var(--wt-font-size-sm) + var(--wt-space-2)) / 2);
  }
  .field-control::placeholder {
    color: var(--wt-color-text-muted);
  }
  .field-control:placeholder-shown:has(+ .inherit-cue) {
    padding-inline-start: calc(var(--wt-space-3) + var(--wt-font-size-sm) + var(--wt-space-1));
  }
  .inherit-cue {
    display: none;
    position: absolute;
    inset-inline-start: var(--wt-space-3);
    inset-block: calc(var(--wt-space-3) + var(--wt-font-size-sm)) var(--wt-space-2);
    align-items: center;
    gap: var(--wt-space-1);
    color: var(--wt-color-text-muted);
    pointer-events: none;
  }
  .inherit-cue wt-icon {
    flex: none;
    color: inherit;
  }
  .field:where([data-compact]) .inherit-cue {
    inset-block: var(--wt-space-2);
  }
  .field-control:placeholder-shown + .inherit-cue {
    display: inline-flex;
  }
  .field-control:autofill {
    background-clip: text;
    -webkit-text-fill-color: var(--wt-color-field-value);
  }
  .field:focus-within {
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
  }
  .field:focus-within .field-label {
    color: var(--wt-color-field-label-focus);
  }
  .field[data-invalid],
  .field[data-invalid]:focus-within {
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-danger);
  }
  .field[data-invalid]:where(:has(.field-control:focus-visible)) {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
  .field[data-invalid] .field-label,
  .field[data-invalid]:focus-within .field-label {
    color: var(--wt-color-danger);
  }
  .field[data-disabled] {
    background: var(--wt-color-field-fill-disabled);
    box-shadow: none;
    cursor: not-allowed;
  }
  /* Drawn over the box rather than as its border, so a disabled field keeps the enabled height. */
  .field[data-disabled]::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    border-bottom: var(--wt-field-line-width) dashed var(--wt-color-field-line);
    pointer-events: none;
  }
  .field[data-disabled] .field-label {
    color: var(--wt-color-text-muted);
  }
  .field[data-disabled] .field-control {
    color: var(--wt-color-text-muted);
    cursor: not-allowed;
  }
  .field[data-disabled] .field-control:autofill {
    -webkit-text-fill-color: var(--wt-color-text-muted);
  }
  .field[data-compact] {
    min-height: var(--wt-tap-min);
  }
  .field[data-compact] .field-control {
    min-height: var(--wt-tap-min);
    padding-block: var(--wt-space-2);
  }
  .field-control:focus-visible {
    outline: none;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
  }
  .row > .field {
    flex: 1;
    min-width: 0;
  }
  .required,
  .error {
    color: var(--wt-color-danger);
  }
  .required {
    margin-inline-start: var(--wt-space-1);
  }
  .error {
    contain: inline-size;
    overflow-wrap: anywhere;
    margin: var(--wt-space-1) 0 0;
    font-size: var(--wt-font-size-sm);
  }
  .hint {
    ${visuallyHiddenStyles}
  }
  /* A contrast theme deletes box-shadows and repaints the danger colour, so the line is drawn over
     the box (a border would change its height) and thickened to mark an invalid field. */
  @media (forced-colors: active) {
    .field::after {
      content: "";
      position: absolute;
      inset-inline: 0;
      bottom: 0;
      border-bottom: var(--wt-field-line-width) solid CanvasText;
      pointer-events: none;
    }
    .field[data-invalid]::after {
      border-bottom-width: var(--wt-field-line-width-active);
    }
    .field:focus-within {
      outline: var(--wt-field-line-width-active) solid Highlight;
      outline-offset: calc(-1 * var(--wt-field-line-width-active));
    }
    /* Lifted above the focus outline's bottom band, which would otherwise cover it. */
    .field[data-invalid]:focus-within::after {
      bottom: var(--wt-field-line-width-active);
    }
    .field[data-disabled]::after {
      border-bottom: var(--wt-field-line-width) dashed GrayText;
    }
  }
`;

/** The boxed field box, `.field[data-boxed]`: a bordered box on the surface rather than a filled
 * one with a bottom line, and with `[data-highlight]` a thicker primary border on the lifted
 * surface. Add it after a primitive's own styles. See design-system.md → Forms. */
export const boxedFieldStyles = css`
  .field[data-boxed] {
    --wt-field-box-line: var(--wt-field-line-width);
    align-items: center;
    border: var(--wt-field-box-line) solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
  }
  .field[data-boxed],
  .field[data-boxed]:is(:focus-within, [data-open], [data-invalid], [data-disabled]) {
    box-shadow: none;
  }
  .field[data-boxed]::after {
    content: none;
  }
  /* The control and the label measure from the outer edge, so a thicker border moves neither. */
  .field[data-boxed] > .field-control {
    width: calc(100% + 2 * var(--wt-field-box-line));
    margin: calc(-1 * var(--wt-field-box-line));
  }
  .field[data-boxed] > .field-label {
    inset-inline-start: calc(
      var(--wt-space-3) + var(--wt-field-line-width) - var(--wt-field-box-line)
    );
    top: calc(var(--wt-space-2) + var(--wt-field-line-width) - var(--wt-field-box-line));
  }
  .field[data-boxed][data-highlight] {
    --wt-field-box-line: var(--wt-field-line-width-active);
    border-color: var(--wt-color-primary);
    background: var(--wt-color-surface-lifted);
  }
  .field[data-boxed]:focus-within {
    --wt-field-box-line: var(--wt-field-line-width-active);
    border-color: var(--wt-color-primary);
  }
  .field[data-boxed][data-invalid] {
    --wt-field-box-line: var(--wt-field-line-width-active);
    border-color: var(--wt-color-danger);
  }
  .field[data-boxed][data-disabled] {
    border-style: dashed;
    background: var(--wt-color-field-fill-disabled);
  }
`;
