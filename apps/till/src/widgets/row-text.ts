import { type TemplateResult, css, html, nothing } from "lit";

/** A row's second line: its parts joined by " · ", or nothing when it has none. */
export function rowMore(
  parts: readonly (TemplateResult | string)[],
): TemplateResult | typeof nothing {
  return parts.length === 0
    ? nothing
    : html`<span class="row-more"
        >${parts.map((part, i) => (i === 0 ? part : html` · ${part}`))}</span
      >`;
}

/** The text cells an order row draws — quantity, name, second line and price — shared by the new
 * dishes' rows and the sent ones. Each row's own sheet lays the cells out. */
export const rowTextStyles = css`
  .row-qty {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
  }
  .row-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row-name {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-medium);
  }
  .row-more {
    display: block;
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
    color: var(--wt-color-text-muted);
  }
  .row-price {
    margin-inline-start: var(--wt-space-2);
    font-size: var(--wt-font-size-md);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
`;

export const OPEN_BORDER = css`2px`;

/** An opened order row's box, new or sent: the declarations for the rule that opens it. */
export const openRowBox = css`
  margin: var(--wt-space-1) var(--wt-space-2);
  border: ${OPEN_BORDER} solid var(--wt-color-primary);
  border-radius: var(--wt-radius-md);
  background: var(--wt-color-surface);
  box-shadow: none;
`;

/** An opened row's outlined buttons, new or sent: the declarations for their rule. */
export const openRowAction = css`
  box-sizing: border-box;
  height: var(--wt-tap-min);
  margin: 0;
  padding: 0 var(--wt-space-3);
  border: 1px solid var(--wt-color-border);
  border-radius: var(--wt-radius-md);
  background: var(--wt-color-surface);
  color: var(--wt-color-text);
  font: inherit;
  font-size: var(--wt-font-size-md);
  font-weight: var(--wt-font-weight-bold);
  cursor: pointer;
`;
