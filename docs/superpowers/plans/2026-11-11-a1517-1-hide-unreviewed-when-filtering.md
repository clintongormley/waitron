# A1517-1: hide dishes nobody has checked while the till hides an allergen

**Ask (owner, 2026-11-11, "As recommended").** With an allergen filter on, hide dishes whose
allergens nobody entered. Keep today's presentation when no allergen exclusion is active.
Source: [decision 1](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11).

**What a person can do when it lands.** A server at the till taps Filter, picks "Hide dishes that
contain" Nuts, and sees only dishes whose allergens someone has entered and that do not declare
nuts. A soup nobody has checked no longer stays on the grid.

**Out of scope.** Extras and options (decision 2, A1517-2, designed separately); variants' own
declarations (the filter reads the dish's own declaration today and still does); any tile warning
or "Not reviewed" label (October decision 6: no unchecked-tile warnings).

## Task 1 — the filter rule (one implementer, test first)

Files: `apps/till/src/menu-filter.ts`, `apps/till/src/menu-filter.test.ts`.

- In `visibleProducts`, an exclusion is ACTIVE when its value is `"all"` or a non-empty kinds list
  (the same test `activeFilterCount` uses). When at least one exclusion is active, a product is
  hidden when nobody entered its allergens: its own `allergens` is `null` AND none of its
  `variants` has a non-null `allergens`. A dish whose allergens were entered only on its variants
  reaches the till with `allergens: null` (`apps/till/src/api/client.ts:474`;
  `variant-fallback.ts:109`), and someone did enter them, so it stays (plan read, 2026-11-11). When none is active (no exclusions, or only empty kinds lists),
  nothing changes: an unreviewed dish stays, and an unchanged input array is returned as itself.
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
- Add: under an active exclusion, a dish with `allergens: null` whose variants declare their own
  stays; one whose variants are all `null` too is hidden.
- Search results and section emptiness follow from the same function
  (`screens/till-counter-screen.ts:342`), so unreviewed dishes also leave search while filtering;
  that matches the decision and needs no extra code.
- Deletion control: drop the new `null` check and confirm the two changed cases fail; restore.

Then run `menu-filter.test.ts` and `till-app.test.ts` (its non-empty `exclude:` case near
line 15750); `pnpm --filter @waitron/till typecheck`.

## Task 2 — guide (EN and ES)

`apps/server/src/guide/en/products.md` and its Spanish twin, in the publish-warning paragraph
("Before you publish now or schedule a menu…"), not the Products-list paragraph above it, which is
about the dashboard's own Allergens filter: one sentence, naming the till's **Filter**, telling the manager that while someone at the till hides an
allergen, dishes marked **Not reviewed** are hidden too, so review a dish for it to show. This
changes what a manager does (it is why a dish vanished from a filtered till). Run
`apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

## Backlog

Delete point 1's first half from `docs/backlog/catalogue.md` → A1517 (the "still shows dishes
nobody has checked" sentence; the extras sentence stays for A1517-2), and narrow the
`docs/backlog.md` A1517 line to what is still open.

## Changed test checks (for the PR)

The two A738 cases above, with before/after and decision 1 as the reason.
