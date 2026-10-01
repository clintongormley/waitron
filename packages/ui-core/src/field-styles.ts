import { css } from "lit";

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
  return ALWAYS_FLOAT.has(opts.type ?? "") ? "float" : "rest";
}

/** The filled field box shared by every field primitive: `.field[part=field]` holding a
 * `.field-label` and a `.field-control`. See design-system.md → Forms. */
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
    font-size: var(--wt-font-size-sm);
    color: var(--wt-color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .field[data-label="rest"]:not(:focus-within):not(:has(:autofill)) .field-label {
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--wt-field-label-rest-size);
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
  .field-control::placeholder {
    color: var(--wt-color-text-muted);
    font-style: italic;
  }
  .field:focus-within:not([data-open]) {
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
  }
  .field:focus-within:not([data-open]) .field-label {
    color: var(--wt-color-field-label-focus);
  }
  .field[data-invalid],
  .field[data-invalid]:focus-within {
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-danger);
  }
  .field[data-invalid] .field-label,
  .field[data-invalid]:focus-within .field-label {
    color: var(--wt-color-danger);
  }
  .field[data-disabled] {
    background: var(--wt-color-field-fill-disabled);
    box-shadow: none;
    border-bottom: var(--wt-field-line-width) dashed var(--wt-color-field-line);
    cursor: not-allowed;
  }
  .field[data-disabled] .field-control {
    color: var(--wt-color-text-muted);
    cursor: not-allowed;
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
`;
