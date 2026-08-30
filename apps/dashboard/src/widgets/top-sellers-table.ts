import { type TemplateResult, html } from "lit";
import { localizedName } from "../i18n/localized.js";
import type { TopSellerRow } from "../api/client.js";

/**
 * The localised STRINGS a screen supplies to {@link renderTopSellers}. Each screen passes its OWN
 * resolved i18n values — the overview through its `overview.*` keys, the sales screen through its
 * `sales.*` keys — so the two namespaces stay deliberately UN-unified (a wording change to one screen
 * never silently moves the other). `empty` is the no-rows message; `emptyTest` is the data-test hook
 * for that empty state (both screens use `"empty"` today).
 */
export interface TopSellersLabels {
  /** The product-name column header. */
  title: string;
  /** The quantity column header. */
  quantity: string;
  /** The total column header. */
  total: string;
  /** The message shown when there are no top sellers. */
  empty: string;
  /** The data-test attribute for the empty-state `<p>`. */
  emptyTest: string;
}

/**
 * A shared TOP-SELLERS TABLE — one row per product (name via the active locale, quantity, total) or a
 * muted empty-state line when there are none — used by both reporting screens. A pure render FUNCTION
 * (see {@link renderMetric}), so the calling screen's own `table`/`th`/`td`/`.num`/`.muted` styles
 * apply and each screen keeps its own table look. The table carries a stable `data-test="top-sellers-table"`
 * hook; the overview additionally wraps it in a `wt-card data-test="top-sellers"`. Product names resolve
 * through the shared {@link localizedName} helper.
 */
export function renderTopSellers(rows: TopSellerRow[], labels: TopSellersLabels): TemplateResult {
  if (rows.length === 0) {
    return html`<p class="muted" data-test=${labels.emptyTest}>${labels.empty}</p>`;
  }
  return html`<table data-test="top-sellers-table">
    <thead>
      <tr>
        <th scope="col">${labels.title}</th>
        <th scope="col" class="num">${labels.quantity}</th>
        <th scope="col" class="num">${labels.total}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(
        (row, i) =>
          html`<tr data-test=${`seller-row-${i}`}>
            <th scope="row" data-test="seller-name">${localizedName(row.descriptions)}</th>
            <td class="num">${row.quantity}</td>
            <td class="num">${row.total}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}
