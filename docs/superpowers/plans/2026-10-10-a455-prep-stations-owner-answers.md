# A455 — Prep stations: the owner's answers 29, 33 and 35 on slice 4 Part A

Queue item A455 (lane B). Slice 4 Part A (#1489, main 0f0a6fc0e) landed on the defaults of
decisions 29, 33 and 35 in `docs/superpowers/plans/2026-10-08-a366-slice-4-prep-stations.md`; the
owner had overridden all three on 2026-10-09 ~16:35 (lane B `questions.md`, "OWNER ANSWERS … to
A366-4A's new decisions 29–37"). This plan builds the overrides. Decision 32 needs nothing (owner:
no old tester links exist).

Owner's words:

- **29 — "Save, but flag it."** Only a period line being ADDED, or whose station CHANGES, is
  checked against the period's menus (as built). BUT a stored period line whose period's menus no
  longer offer the row's products is MARKED in the routing grid and editor (e.g. "⚠ not on
  Breakfast menus"). Keep the wording short. Decision 31 stands: an import skips the menu check, so
  an imported stale line shows this flag.
- **33 — "no note."** A cell that falls through to the default station, or says No preparation,
  does NOT say how an extra is made. Drop the note.
- **35 — "hide the page."** A person without configuration rights is NOT offered the Prep stations
  page at all. Check what the page's read route then refuses for them, and that no nav entry or
  alert link leads them to a dead page.

Standing owner rule: product text as concise as possible where the meaning can be inferred.

## Decisions this plan makes (defaults build; the owner may override)

1. **Who counts as "without configuration rights".** The page's `requiresPermission` stays
   `venue_service.manage`; only its `readPermission: "venue.view"` goes
   (`packages/venue-service/src/dashboard/index.ts`, screen `prep-stations`). A supervisor (holds
   `venue.view`, not `venue_service.manage`) is no longer offered the page. Opening hours and Hours
   keep their read-only offering — the owner's answer named this page only.
2. **The read-only overview route goes.** `GET /management-api/venue-service/stations/overview`
   (`packages/venue-service/src/routes.ts`) exists only for the read-only page (its one caller is
   `PrepStationsApi.load` when `readOnly`, `routing-client.ts`). With the page hidden it has no
   caller, so it is removed with its tests, and the client's `overview` getter and `readOnly`
   constructor flag go. A request to it then answers 404, like any unknown path. This removes a
   read a supervisor had; it is a permissions-adjacent change, so the branch takes the FULL review
   path. `GET /management-api/stations` and `GET /management-api/watchers` keep their `venue.view`
   reads (other screens and the till use them) — say so in the PR, do not change them.
3. **The flag is computed on the server**, in `routingModel` (`routing-store.ts`), with the same
   reach the save check uses (`rowProductIds` + `periodProductIds`), so the flag and the save rule
   share one reach (variants by their parent's id, a category row by its whole subtree). The
   editor's list of periods to OFFER keeps its existing browser-side copy (`#productsOfRow`,
   `routing-grid.ts`), which this item does not change. Each stored period line in the model's `cells[].periods`
   gains `notOffered: true` when its period's menus (customer + staff-only) reach none of the row's
   active products. A line whose period offers at least one is unmarked (the key is absent). The
   "Any other time" choice is never flagged. A row with no active products at all (an empty
   category) flags every period line it stores — say so in the PR.
4. **Only the cell that stores a line shows its flag.** A child row that inherits a period line
   shows that line muted, as today, without a flag; the flag belongs to the stored line on its
   own cell.
5. **Wording.** One mark per flagged line, listing that line's flagged periods:
   EN `Not on {periods} menus` ("Not on Breakfast menus", "Not on Breakfast, Brunch menus");
   ES `No está en los menús de {periods}`. Drawn in the grid's existing warning style (the
   `.warning` rule `routing-grid.ts` already uses for a disabled station), under the line it
   belongs to, and read as part of the cell button's accessible name the way period lines are
   (`#labelWithNote`). The line's flagged period names are built with the grid model's existing
   `periodsText` (`routing-grid-model.ts`), so two periods sharing a name are told apart the same
   way the line itself tells them apart. A "⚠" glyph is added only if the dashboard already has a warning icon or
   glyph convention for such marks (grep `packages/ui` and the dashboard first); otherwise the
   warning colour carries it. In the cell editor (`routing-cell-editor.ts`), a stored line whose
   periods are flagged shows the same text as a warning-coloured note under the line until the
   person changes that line's periods or station. It is NEVER a field `.error`, never feeds the
   editor's `marked` state or the bottom `prep.fix_fields` message, and Save's state is unaffected
   (a cell holding only a flagged line opens quiet and saves unchanged once edited elsewhere).
6. **The extras note goes everywhere it is drawn**: grid cells, the default cell (including its
   read-only form when `canMakeDefault` is false), and the accessible names. Strings
   `routing.extra_default` and `routing.extra_no_preparation` are deleted (EN and ES);
   `routing.cell_label_note` stays because period lines use it. The routing behaviour the note
   described (`chooseExtraMaker`) is unchanged.

## Global constraints

- Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-service-prep-stations-owner-answers`,
  branch `feat/service-prep-stations-owner-answers`. Commit with `git commit -s`. Never
  `--no-verify`.
- Test first: write or change the test, run it, watch it fail for the right reason, then the code.
- A test check that changes because the owner's answer changes what it checks is allowed (owner
  2026-10-05): list every changed or deleted check in the task's report, with the reason.
- No migration. No change to fiscal code, `kitchen-print.ts`, or how routing decides a station.
- Concise text (owner rule). Every new string in EN and ES (`packages/venue-service/src/dashboard/strings.ts`).
- House rules: `/Users/clintongormley/workspace/repos/waitron/CLAUDE.md` (claims need receipts;
  `useVenueDb` for database tests; browser tests run in real Chromium).
- Focused commands (run from the worktree):
  - `pnpm --filter @waitron/venue-service exec vitest run <file>`
  - `pnpm --filter @waitron/dashboard exec vitest run <file>`
  - `pnpm --filter @waitron/venue-service exec tsc --noEmit -p .` and the dashboard's equivalent
    (check each package's `typecheck` script for the exact command).
  - `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/live-subscriptions.test.ts`
    from the root when a route or string set changes.
- Overlap: lane D's A366-4B (slice 4 Part B rewrites `routingModel`'s station times and the
  screen's Today column: `routing-store.ts`, `prep-stations-screen.ts`) and the open #1490
  (A366-6B: `strings.ts`, `client.ts`); whoever lands second rebases.

## Task 1 — Server: the routing model marks stale stored period lines (decision 3)

Files: `packages/venue-service/src/routing-store.ts`, `packages/venue-service/src/routing-types.ts`,
`packages/venue-service/src/routing-store.test.ts` (or the suite that already tests
`routingModel`'s `cells[].periods` — grep), and the routes test if `GET
/management-api/venue-service/routing` has a shape pin.

- Type: the model's period line becomes `PeriodLine & { notOffered?: true }` on
  `RoutingModelCell.periods` only (the write input `PeriodLine` is unchanged).
- Compute in `routingModel` without a query per cell: read the active products ONCE, reuse the
  folder tree the model's snapshot already holds (`rules.parentOf`) and the periods' `productIds`
  the model already reads (`readRoutingPeriods`), work out each distinct row's products once (not
  once per cell), then test each stored line in memory. Refactor `rowProductIds` so
  the save check and the model share one function over pre-read inputs (the save check may keep
  reading its own inputs); do not duplicate the reach logic.
- Tests first (real database through `useVenueDb`, as the existing suite does):
  - a product row's line for a period whose menu offers the product → no `notOffered`;
  - the same line after the product leaves that period's menus (remove it from the menu section)
    → `notOffered: true`, and saving the cell unchanged still succeeds (decision 29 as built);
  - a staff-only menu of the period still offering it → unmarked;
  - a category row: offered when any active product in the category's subtree is on the period's
    menus, flagged when none is;
  - a variant on the menu counts for its parent's row;
  - decision 31: extend the EXISTING imported-stale-line case in
    `apps/server/src/configuration-transfer.test.ts` (around `:3890-4010`, the period "Comidas de
    periodos" on an empty menu) so that after the import the target venue's `routingModel` has
    `notOffered: true` on the imported line (venue-service cannot import `apps/server`);
  - the "Any other time" target carries no flag (only `periods[]` entries can).
- Prove the check by deletion: force the flag off and watch the flagged cases fail; restore.
- Then run `routing-store.test.ts` and `routes.test.ts` IN FULL: they compare whole cells with
  `toEqual` (`routing-store.test.ts:555`, `routes.test.ts:2951`). Other readers of the model type
  (`apps/dashboard/src/widgets/folder-made-at.ts`, `catalogue-browser.ts`) take an optional key
  unchanged — typecheck the dashboard to confirm.

## Task 2a — Dashboard: the grid shows the flag (decisions 4, 5)

Files: `packages/venue-service/src/dashboard/routing-grid-model.ts` (`cellPeriodLines`, which
merges periods sharing a station into one line and names them with `periodsText`),
`routing-grid-model.test.ts`, `routing-grid.ts`, `strings.ts`, `routing-client.ts` (type only, if
the model type is re-declared there), `routing-grid.test.ts`, `routing-grid.a11y.test.ts`.

- Model: each line `cellPeriodLines` returns carries `flaggedPeriods` (the line's periods whose
  stored entry has `notOffered`, in the line's order; empty for an inherited line), and the mark
  text is built from them with `periodsText`.
- Grid: under a cell's OWN period line with flagged periods, a mark `Not on {periods} menus` in
  the warning style, included in the cell button's accessible name after that line. An inherited
  line shown in a child cell carries no mark.
- Tests first in real Chromium: the mark text in EN and ES; absent for an offered line and for an
  inherited line; two flagged periods in one line; the accessible name; the a11y suite covers a
  cell with a flag in both themes (axe).

## Task 2b — Dashboard: the cell editor shows the flag; the look (decision 5)

Files: `routing-cell-editor.ts`, `strings.ts` (reuse 2a's string), `routing-cell-editor.test.ts`,
`routing-cell-editor.a11y.test.ts`, `routing-cell-editor.save-state.test.ts` if Save's state is
pinned there.

- A stored line with flagged periods shows the mark as a warning-coloured note under the line
  until the person edits that line (periods or station). Never a field `.error`, never in
  `marked`/`prep.fix_fields`; a save refusal for that line still shows as today.
- Tests first: the note shows for a stored flagged line and not for an offered one; it clears when
  that line's periods or station change; a cell holding only a flagged line opens with Save quiet
  and, after an unrelated edit, saves (the request is sent); axe in both themes with the note.
- LOOK: EN and ES, light and dark, 1280 and 390 wide — a grid with one flagged line and the editor
  open on it. Screenshots in `~/waitron-campaign-b/a455-shots/`.

## Task 3 — Dashboard: the extras note goes (decision 6)

Files: `routing-grid.ts` (also its now-dead `.cell .note` style rule), `strings.ts`,
`routing-grid.test.ts` (the "how extras are made" block AND the period-line case near `:993-997`
that pins the note),
`routing-grid.a11y.test.ts` if it names the note, and any other test that pins the note's text or
an accessible name ending in it (`grep -rn "follows its dish\|sigue a su plato\|extra-note"
packages apps`).

- Replace the "how extras are made" block with cases that pin the absence: an empty Every zone
  cell, a No preparation cell (own and inherited), and the All categories × Every zone cell
  (editable and `canMakeDefault: false`) show no extras note, and their accessible names end at
  the station state (e.g. `Bread, Every zone: Kitchen, inherited`). Watch them fail first.
- Remove `#extraNoteText`, `#extraNote` and their call sites; delete the two strings (EN, ES).
  Keep `#labelWithNote` (period lines use it).
- List every changed or deleted check in the report.

## Task 4 — The page is hidden from people without configuration rights (decisions 1, 2)

Files: `packages/venue-service/src/dashboard/index.ts`, `prep-stations-screen.ts`,
`routing-client.ts`, `packages/venue-service/src/routes.ts` and their tests
(`index.test.ts`, `prep-stations-screen.test.ts`, `prep-stations-overview.a11y.test.ts`,
`routing-client.test.ts`, `routes.test.ts` "read-only station overview"),
`apps/dashboard/src/dashboard-app.test.ts` (the cases reading `/stations/overview`, near its
`:3782` and `:3841`) and `apps/dashboard/src/dashboard-app.settings-panels.test.ts` if it pins the
page's read-only offering.

- Tests first:
  - dashboard: a session holding `venue.view` but not `venue_service.manage` sees no Prep stations
    nav entry, and `/manage/prep-stations` (and `/manage/printing-rules`, which
    `#applyRequestedScreen` redirects there) lands on the screen `#permittedScreen` falls back to;
    a manager still gets the page with every tab.
  - alerts: NO CHANGE. `stationOutputAlertSource` raises them only for `venue_service.manage`
    (`apps/server/src/alert-sources.ts:335`), and both the bell and the Alerts screen hide the
    "Go to" link through `screenTargetOf(alert, canOpen)` (`alert-format.ts`, `alerts-bell.ts`,
    `alerts-screen.ts`). Name the existing cases that pin both in the report.
  - Products "Made at" link: NO CHANGE. Product links come from `/management-api/products/made-at`
    (needs `person.manage`, `catalogue-api.ts`) and folder links from the routing read (needs
    `venue_service.manage`); only managers hold either, and they hold `venue_service.manage`.
  - the printing-bookmark redirect row for a supervisor in `dashboard-app.test.ts` (near `:3767`,
    `"/manage/prep-stations/view/stations"`) becomes the fallback screen (`/manage/overview`), and
    its stub's overview path (near `:3782`) goes — a changed check, list it.
  - server: `GET /management-api/venue-service/stations/overview` answers 404 for a manager and a
    supervisor (route gone). Replace the "read-only station overview" block; keep its assertion
    that a supervisor gets 403 from `GET /management-api/venue-service/routing`.
- Then remove: `readPermission` on the screen; the screen's `readOnly` property and every branch
  that reads it (grep `readOnly` in `prep-stations-screen.ts` — confirm nothing else sets it; the
  routing grid's own `canMakeDefault` handling is separate and stays); the `render(readOnly)`
  argument in `index.ts`; `PrepStationsApi.overview`, its `readOnly` constructor flag and the
  read-only branch of `load`; the server route; delete `prep-stations-overview.a11y.test.ts` (it
  tests only the read-only page).
- Run `scripts/live-subscriptions.test.ts` and `scripts/errors-reachable.test.ts` from the root.

## Task 5 — Documentation and backlog

- `docs/developers/design-system.md` (the routing grid paragraph, near "how extras are made"):
  drop the extras-note sentence; add the flag in one short sentence.
- `docs/backlog/service-periods.md` (near `:40`, "Its new decisions 29–37 wait for the owner"):
  say they are answered and built (A455), in one line.
- `docs/superpowers/plans/2026-10-08-a366-slice-4-prep-stations.md`: under decisions 29, 31, 32,
  33 and 35 add a dated one-line pointer (31: default stands; 32: nothing to build, no old links) — "Owner override 2026-10-09: … built in A455 (this plan's path)".
  Do not rewrite the decisions (historical docs get a dated pointer).
- `docs/backlog.md`: delete the entry "The dashboard's read-only Prep stations screen still shows
  only its Stations tab…" (the page is no longer offered read-only); move nothing else. If the
  matching detail file under `docs/backlog/` repeats it, delete it there too.
- Grep for other prose claiming supervisors see Prep stations read-only, or the extras note
  ("follows its dish" in dashboard docs, `stations/overview`, "read-only" near "Prep stations") in
  `docs/developers/`, `docs/user/` (if present) and package READMEs; fix current-state docs, leave
  dated specs/plans alone except for the pointer above.

## Review focus

- The flag and the save check use one reach; a variant and a category subtree are covered.
- No caller of the overview route or the read-only screen remains (grep, not reading).
- No route that other screens or the till read changed its permission.
- Every changed or deleted test check is listed with its reason.
