# A1517-1: hide dishes nobody has checked while the till hides an allergen

**Ask (owner, 2026-11-11, "As recommended").** With an allergen filter on, hide dishes whose
allergens nobody entered. Keep today's presentation when no allergen exclusion is active.
Source: [decision 1](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11).

**What a person can do when it lands.** A server at the till taps Filter, picks "Hide dishes that
contain" Nuts, and sees only dishes whose allergens someone has entered and that do not declare nuts, or, for a dish
declared only on its variants, that have at least one variant without nuts. A soup nobody has checked no longer stays on the grid.

**Out of scope.** Extras and options (decision 2, A1517-2, designed separately); variants' own
declarations for a dish that has its own declaration (the filter reads only the dish's, as today;
A1517-2 settles variants with extras); any tile warning
or "Not reviewed" label (October decision 6: no unchecked-tile warnings).

## Task 1 — the filter rule (one implementer, test first)

Files: `apps/till/src/menu-filter.ts`, `apps/till/src/menu-filter.test.ts`.

- In `visibleProducts`, an exclusion is ACTIVE when its value is `"all"` or a non-empty kinds list;
  one function, `isActiveExclusion`, answers that for both `visibleProducts` and
  `activeFilterCount`, so the badge and the hiding rule agree. When at least one exclusion is
  active:
  - a dish whose own `allergens` is not `null` is judged by its own declaration, as today;
  - a dish whose own `allergens` is `null` is judged by its variants: it stays only when at least
    one variant has a non-null `allergens` that passes every active exclusion, by the same
    per-declaration test (`passesExclusions`) the dish's own declaration uses. So a dish whose
    variants are all `null` too is hidden, and so is one whose every reviewed variant declares an
    excluded allergen. A variant's `allergens` is its own declaration, else the dish's
    (`variant-fallback.ts:109`, copied by `apps/till/src/api/client.ts:474`), so for such a dish it
    is the variant's own.

  When none is active (no exclusions, or only empty kinds lists), nothing changes: an unreviewed
  dish stays, and an unchanged input array is returned as itself.
- A product whose `allergens` is `{}` (checked, declares nothing) stays, as today.
- Diet filters are unchanged: they already read the diet profile, not the allergen declaration.

Tests, failing first:

- Change the two A738 cases that pin today's rule to the new one (spec decision 1 changes them):
  - `menu-filter.test.ts` "A738 intersects included diets and excludes selected allergen kinds":
    `["almond", "unreviewed-allergens"]` becomes `["almond"]`.
  - "A738 excludes declared %s while retaining reviewed-empty and unreviewed snapshots":
    `[clear, unknown]` becomes `[clear]`, and the title says it hides unreviewed snapshots.
- Add: an unreviewed dish stays when the only exclusion is an empty kinds list
  (`exclude: { gluten: [] }`), and with no exclusion at all.
- Add, all under an active exclusion, for dishes with `allergens: null`: one with a reviewed
  variant stays and one whose variants are all `null` too is hidden; one whose only reviewed
  variant declares the excluded allergen is hidden; one with a variant declaring nuts and another
  declaring `{}` stays when nuts are excluded; one whose variant declares walnuts stays when only
  almonds are excluded, and one whose variant declares almonds is hidden.
- Search results and section emptiness follow from the same function
  (`screens/till-counter-screen.ts:342`), so unreviewed dishes also leave search while filtering;
  that matches the decision and needs no extra code.
- Deletion controls: drop the new `null` check and confirm the two changed cases fail; count a
  reviewed variant without testing its declaration and confirm the excluded-variant cases fail;
  restore.

Then run `menu-filter.test.ts` and `till-app.test.ts` (its non-empty `exclude:` case near
line 15750); `pnpm --filter @waitron/till typecheck`.

## Task 2 — guide (EN and ES)

`apps/server/src/guide/en/products.md` and its Spanish twin, in a paragraph of its own after the publish-warning paragraph ("Before you publish now or schedule a
menu…"), not in the Products-list paragraph above it, which is about the dashboard's own Allergens
filter: naming the till's **Filter**, it tells the manager that while someone at the till hides an
allergen, dishes whose allergens nobody has entered, on the dish or on any of its variants, are
hidden too, and that entering the allergens and publishing the menu again lets such a dish show
(the till reads allergens from the published menu: `applyLiveFields` in
`packages/catalogue/src/menu-document.ts` puts back only availability, course and category). This
changes what a manager does (it is why a dish vanished from a filtered till). Run
`apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

## Backlog

Delete point 1's first half from `docs/backlog/catalogue.md` → A1517 (the "still shows dishes
nobody has checked" sentence; the extras sentence stays for A1517-2, joined by the variants of a dish that has its own
declaration), and narrow the
`docs/backlog.md` A1517 line to what is still open.

## Changed test checks (for the PR)

The two A738 cases above, with before/after and decision 1 as the reason.
