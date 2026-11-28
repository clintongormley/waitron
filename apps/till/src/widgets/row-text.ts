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
