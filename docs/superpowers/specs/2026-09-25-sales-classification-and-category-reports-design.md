# Sales classification and category reports

**Status:** owner decisions of 2026-09-25, after outside review; not built. It sits beside
[the menus spec](2026-09-20-menus-categories-and-home-layouts-design.md). §10 of that spec
separates reporting categories, menu sections and labels, and this document specifies the reporting
side.

Facts about the code are from reading `main` on 2026-09-25. They are not measurements. Each fact
names its file, so it can be re-checked before building.

## 1. What this is for

- Reports by category should show both:
  - what happened, as it was classified at the time;
  - how the owner classifies things now.
- A category renamed, moved or deleted next year must not change last year's historical report. It
  should change the current-classification report, because that report is meant to follow today's
  set-up.
- Some facts about a sale can never be recovered once it has been recorded. What was sold, from
  which menu, and under which categories must therefore be recorded from the start, even before any
  category report exists.

## 2. The two classifications

### 2.1 Reporting categories: a strict tree

- Each reporting category has at most one parent. Cycles are refused.
- Each product has at most one **main reporting category**. The existing column
  `products.category_id` holds it, and the existing parent is `category_details.parent_id`.
- A product with none is reported under a fixed **Uncategorised** bucket. That bucket is not a
  category row, so it cannot be renamed, moved or deleted.
- A variant's main reporting category is its own if it has one, otherwise its parent's. That is the
  variant fallback rule the one-product model already applies to inherited fields.
- The rule "a product's primary category must be one of its category memberships"
  (`replaceProductCategories`, `packages/catalogue/src/categories.ts`) goes. So does the product's
  many-to-many membership (`product_categories`). Its flexible role passes to labels (§2.2); its
  menu-organising role passes to menu sections.
- **Moving** a reporting category (a new parent) or a product (a new main category) is allowed. It
  changes the current-classification report and future snapshots, and never a recorded one.
- **Deleting** a reporting category asks where its products and child categories go. The default is
  its parent; a top-level category defaults to Uncategorised for its products, and to the top level
  for its children. It never silently strands a product. Recorded snapshots keep the deleted
  category's id and name.

### 2.2 Labels: flat tags

- A **label** has a name. A product can carry any number of labels, for example "Happy hour
  drinks" or "Alcoholic". Labels do not nest.
- A variant's labels are its parent's. A variant carries none of its own in the first release.
- **How labels relate to reporting categories:**
  - they are independent;
  - a label never implies a reporting category, and a reporting category never implies a label;
  - a label total may cut across reporting categories and overlap other labels.
  Reports say so (§5).
- Labels will also be conditions for kitchen routing rules (menus spec §10.5). Menu sections are
  not labels. A section and a label may share a name, but not membership.

## 3. What each sale line records

**What today's `sale_lines` records** (`packages/db/src/schema/sales.ts:151-208`):
- frozen names, quantity, net unit price, VAT rate, and a net `line_total`;
- a category NAME as free text;
- for an extra, a `parent_line_id`.

It records no product id, no menu, and no gross amount. The only link back is
`sales.working_order_id`. There is no per-line link, and the working-order side is mutable.

From this change on, **every sale line also records:**

| Field | Content |
| --- | --- |
| `product_id` | The product actually sold: the variant on a variant line, the picked product on an extras line. |
| `parent_product_id` | The variant's parent product; null otherwise. |
| `menu_id`, `menu_version_id` | Provenance: the menu and published version the line was sold from, once published menus exist (menus plan); null for a line sold without one. It answers "sold from the Happy Hour menu", which classification cannot answer. |
| `line_gross` | The line's VAT-inclusive total in cents, the per-line gross `priceRows` already computes (`packages/catalogue/src/pricing.ts:141-188`). |
| `classification` | A JSON snapshot, below. |

```json
{
  "reporting": [{"id":"…","name":"Drinks"},{"id":"…","name":"Alcoholic drinks"},{"id":"…","name":"Cocktails"}],
  "labels":    [{"id":"…","name":"Happy hour drinks"}]
}
```

- **`reporting`** is the product's main reporting chain at that moment, from the root to the leaf,
  with each category's name as it was. It is `[]` when the product is Uncategorised.
- **`labels`** holds the product's labels at that moment, sorted by id, with no repeats.
- **Validation at recording time:**
  - every id names a row that exists;
  - every name is non-empty;
  - the chain contains no repeated id;
  - the leaf of the chain is the product's main reporting category.
- **What a snapshot never contains:** menu sections, a menu's top-level list and home layouts. Those
  are menu arrangement (menus spec §10.1).
- **Timing:** the snapshot is taken when the sale line is recorded, which is when its sale is filed.
  A held order's lines are classified at payment, not when they were added.
- **Storage:** JSON is the first-release storage. Measure the real report queries before adding
  rows indexed by category or a cache.
- **Extras lines** are classified, in the snapshot, by their OWN product's reporting chain and
  labels.
  - The existing free-text `category` column keeps copying the dish's category, as it does today
    (`pricing.ts:303`). It is left alone so every pre-existing column stays byte-identical.
  - `parent_line_id` still ties an extra to its dish.
  - So a report can offer "extras rolled into their dish" as a view, while the default counts each
    line under its own product.
- **Unchanged:** the existing free-text `category` column, and the order of `sale_lines`.
- **Fiscal:** the new columns are plain additions to an append-only table. The chain hash is built
  from the sale's header fields (`packages/core/src/record-sale.ts:269-283`), so the fiscal
  fingerprint does not change. The golden fingerprint test is the guard and passes unedited.

## 4. Reversals, corrections and substitutions

The rules follow what the existing reports already do (`packages/reporting/src/business-day.ts`).

- **A void** adds no rows today. It records a `sale_voids` row, and reports subtract the voided
  sale's lines on the day the void is made (`reversedSalesClause`; owner decision 2026-09-24). A
  category report does the same, using the voided lines' OWN recorded classification. So a reversal
  keeps the original classification by construction, even if the category moved in between.
- **A correction** (factura rectificativa, `recordCorrection`) writes a new sale with caller-supplied
  delta lines. Today nothing links a delta line to the line it corrects, and nothing calls
  `recordCorrection` from a route.
  - When corrections are wired to a route, a delta line that reverses or adjusts an original line
    MUST name that line and copy its identity and classification.
  - A delta line adding something new is classified when it is recorded.
  - Corrections count on the day they are issued, netting with their signed figures, as every
    existing report does.
- **A substitute invoice** (F3 canje) is excluded from category reports, as it is from every
  existing report. The simplified tickets it replaces keep their own lines.
- **Split bills** carve lines between orders before payment (`carveOffLines`,
  `apps/server/src/working-order.ts`). Each resulting sale's lines are classified when that sale is
  filed.

## 5. The two report modes

Every category report is labelled with its mode.

- **Categories at time of sale:**
  - reads only the recorded snapshots;
  - rolls each line's amount up EVERY step of that line's own recorded chain;
  - uses the recorded names.
  - **It never groups by the leaf id alone** before rolling up, because the same category can have
    had different parents in different periods. It never consults today's names or parents.
  - A label total sums the lines whose snapshot carries that label.
- **Current categories:**
  - classifies each recorded line by its `product_id`, using today's main reporting category, tree
    and labels;
  - intentionally changes when the classification changes;
  - puts lines recorded before this change (no `product_id`) under **Not recorded**.
  - Lines recorded before this change also have no `line_gross`. The report shows their net amount
    and marks the gross total for a period that includes them as incomplete. It never estimates a
    gross it cannot reconcile.
- **Amounts:**
  - each report shows gross (`line_gross`) and net (`line_total`);
  - on the till's sale paths, gross totals reconcile exactly to `sales.total`, because there the
    total is the sum of the per-line gross (`priceRows`). The correction and substitution builders
    compute their breakdown separately (`buildVatBreakdown`) and are not checked against their total
    today (`record-correction.ts:159`, `record-substitution.ts:180`), so the correction wiring
    (§4) must keep line gross and total in step;
  - net totals reconcile exactly to the VAT summary's bases, because a rate's base is the sum of the
    line bases.
  - Both use the existing inclusion rules: issued in the period, substitutes out, voids subtracted
    on their day, corrections netted.
- **Overlap:** a reporting-tree total adds up exactly. A label total may overlap other labels and
  cut across the tree, and the report says so beside those figures.

## 6. The Z report

The daily close (`packages/reporting/src/record-daily-close.ts`) stays as it is. It is frozen and
hash-chained (`daily-close-hash.ts`), and the repo treats it as an internal cash-control document
(`docs/compliance/asesor-questions.md` Q25(c)). **Category analysis is a separate report** for the
same business day, with an option to print it alongside the close.

## 7. Acceptance examples for the later build

1. **A category moved mid-period:** Cocktails moves from "Alcoholic drinks" to "Spirits" on the 15th.
   - The at-time-of-sale report for the month puts earlier Negronis under Alcoholic drinks and
     later ones under Spirits.
   - The current report puts all of them under Spirits.
2. **Renamed, then deleted:** "Soft drinks" is renamed "Softs", then deleted with its products
   reassigned to Drinks. The historical report still reads "Soft drinks" for older lines.
3. **A variant:** Coffee (main category Hot drinks) with a Double variant that sets no category.
   Both are recorded under Hot drinks, with `product_id` = the variant and `parent_product_id` =
   Coffee.
4. **An extra:** a burger with Extra cheese, whose main category is "Extras". The cheese line is
   classified under Extras and linked to the burger line. "Extras rolled into their dish" moves it
   under the burger's chain.
5. **A void the next day:** a sale on the 4th is voided on the 5th, after Cocktails moved on the
   evening of the 4th. The 5th's historical report subtracts it under the chain recorded on the 4th.
6. **Uncategorised:** a product with no main category is reported as Uncategorised, and the gross
   total still equals the sales total.
7. **Before this change:** lines recorded before the feature appear under "Not recorded" in the
   current mode, and under the free-text category (or "Not recorded") in the historical mode.
8. **Labels overlap:** a Negroni labelled "Happy hour drinks" and "Alcoholic" counts in both label
   totals, and the report marks label totals as overlapping.

## 8. Out of scope for the first release

- Elasticsearch or other cloud analytics.
- A classification cache.
- Nested labels.
- Per-variant labels.
- Automatic menu synchronisation.

The snapshot is JSON on purpose so a later export can map it directly.
