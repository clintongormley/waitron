import { type TemplateResult, css, html } from "lit";
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
 * A shared TOP-SELLERS TABLE used by both reporting screens: one row per product (staff name,
 * quantity, total), each followed by one indented row per variant sold under it, or a muted
 * empty-state line when there are none. A pure render FUNCTION (see {@link renderMetric}), so the
 * calling screen's own `table`/`th`/`td`/`.num`/`.muted` styles apply; a screen adds
 * {@link topSellersStyles} for the variant rows. A variant row's header repeats its product's name
 * in visually hidden text — "Wine by the glass, Wine 175" — so the nesting is not carried by the
 * indent alone. Names are the plain staff names a sales report shows — no locale lookup.
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
              <th scope="row" data-test="seller-name">${row.name}</th>
              <td class="num">${row.quantity}</td>
              <td class="num">${row.total}</td>
            </tr>
            ${row.variants.map(
              (variant, j) =>
                html`<tr data-test=${`seller-row-${i}-variant-${j}`}>
                  <th scope="row" class="seller-variant">
                    <span class="visually-hidden">${row.name}, </span
                    ><span data-test="variant-name">${variant.name}</span>
                  </th>
                  <td class="num">${variant.quantity}</td>
                  <td class="num">${variant.total}</td>
                </tr>`,
            )}`,
      )}
    </tbody>
  </table>`;
}

/** The variant rows' chrome for {@link renderTopSellers}: add it to a screen's `static styles`
 * beside the screen's own table rules. Tokens only, so it follows the venue's theme. */
export const topSellersStyles = css`
  th.seller-variant {
    padding-inline-start: calc(var(--wt-space-2) + var(--wt-space-4));
    font-weight: var(--wt-font-weight-normal);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
