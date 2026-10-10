# A425 — the till's top bar in priority order, "Transfers" for short

Source: lane B queue item A425 (owner, 2026-10-08 ~15:05, on A395's #1435 open point): "maybe it's a
question of putting the highest priority items to the left, so they stand the best chance of
remaining on the top [bar]. transfers will be less used. also we don't need the full 'departmental
transfers' name, just 'transfers' is enough".

Light review path (no migration, no risk trigger), one pull request, branch
`feat/service-till-bar-priority`.

## Decisions this plan makes that the item does not

1. **Priority, highest first** (the watcher's list, adopted as written): operator name + Log out,
   Find a bill, Pass (`expo`), Kitchen (`station`), My schedule, Allergens, Profile, Equipment,
   Transfers; the Waitron name leaves first. So `LEAVE_ORDER` in
   `apps/till/src/widgets/tab-shell.ts` becomes, first to leave first: `transfers`, `equipment`,
   `profile`, `allergens`, `schedule`, `station`, `expo`, `find-bill`, `operator`.
2. **The bar's left-to-right order of the leaving items is the priority order**: Find a bill, Pass,
   Kitchen, My schedule, Allergens, Profile, Equipment, then the transfer count and its button
   together. The rightmost of them leaves first. Inside More the items keep that same order.
3. **The operator's name + Log out keep their place** after the language chooser, before More
   (they are identity chrome, not one of the items in the run; they still leave last). The tabs and
   the language chooser never leave, as in #1435.
4. **The short name.** The bar's button reads "Transfers" / "Traspasos" through a NEW key
   `department_transfer.short`, because `department_transfer.title` is also the transfers dialog's
   heading (`apps/till/src/widgets/department-transfers.ts`), which keeps the full name. The
   visible count beside it, `department_transfer.open`, is used only by the shell, so its value is
   shortened in place: "Transfers ({count} pending)" / "Traspasos (pendientes: {count})". The hidden
   status region and the More menu read the same key, so they shorten too.
5. **More's spoken name follows the short name**: `shell.more_transfers` / `_one` become "More, {n}
   transfers pending" / "More, 1 transfer pending" and "Más, traspasos pendientes: {n}" / "Más,
   traspasos pendientes: 1", so the bar and More's name use one word for the same thing.
6. **Consequences the owner should see in the FYI** (not separate decisions, but say them in the
   PR): transfers now leave FIRST, so above phone width More exists only once the transfers are in
   it — a bar with More AND the transfers still on it no longer occurs; the pending count is then
   read from the badge on More and the one status region outside it (as #1435 built for that
   case). On a phone the count moves from the top of More to just above the operator's name.
   Operator name + Log out keep their trailing place (decision 3), which departs from a literal
   reading of "left to right in priority order".

## Changed test checks (the plan review traced these; the implementer confirms each by running)

Each keeps what it proves; only what the new order makes impossible goes, and is named in the PR.

- `tab-shell.test.ts` `leaveOrder`, `menuActions`, the phone menu order, the "leaves the wide header
  as it was" session order, the "keeps More in the bar's order" `barOrder`: new order only.
- `tab-shell.test.ts` "keeps the visible count as the status while the transfers are on the bar"
  (1280): the state "More present, transfers on the bar" no longer exists. Keep the case's point —
  while the transfers are on the bar the visible count is the ONLY status region, in `.session`,
  visible, with the count text — at a width where the transfers are on the bar (ROOMY_WIDTH, More
  absent: assert More is absent instead of "More named 'More', unbadged").
- `tab-shell.test.ts` "keeps an open More open … transfers %s": the `[1280, "on the bar"]` row is
  impossible now (More open means the transfers are in it); drop that row, keep the `in More` row.
- `tab-shell.test.ts` "badges More …" (700): its literal "More, 2 department transfers pending"
  becomes decision 5's wording.
- `till-app-boot-and-counter.test.ts` "shows the pending count accessibly" (~line 3885): the literal
  pending strings become decision 4's; at 1280 the visible count may now sit in a closed More, so
  open More whenever the count is inside it (today only at 390), then assert as before.
- Any case that needs More present at 1280 (`tab-shell.a11y.test.ts` ~line 118, the app's one-row
  case at 1024/1280, and others) — check by running; if the shorter label lets the whole bar fit at
  1280 with `full`, narrow that case's width to one where More exists and say so.
- The narrowing walk (`tab-shell.test.ts` "moves items into More in a fixed order") steps by 40 from
  1600 and never lands on 1024: the new 1024/800 case also asserts that what is in More is the
  start of the new leaving order.

## Task 1 — tests first, then the order and the label (one implementer)

Files: `apps/till/src/widgets/tab-shell.ts`, `apps/till/src/widgets/tab-shell.test.ts`,
`apps/till/src/i18n/strings.ts`.

1. **Failing test first (Chromium).** In `tab-shell.test.ts`, "above phone width": with the `full`
   fixture, at 1024 and 800 px, in en-GB and es-ES, Find a bill, Kitchen and Pass are on the bar
   (on screen, not inside More) while the transfers button is in More. Before running it, write in
   the test's commit message what the failing run prints today (expected: at least one of
   `.find-bill` / `.station` / `.expo` found inside More while `[data-open-transfers]` is on the
   bar, at 800 px at least). Run it and confirm it fails for that reason.
2. **A second failing case:** the bar's button reads "Transfers" in en-GB and "Traspasos" in es-ES,
   and the transfers dialog heading key still reads "Department transfers" /
   "Traspasos entre departamentos" (assert `t("department_transfer.title")` unchanged and the
   button's text equal to `t("department_transfer.short")`, with literal expected strings in both
   locales so the case cannot pass on a wrong translation).
3. **Implement**: reorder `LEAVE_ORDER` (decision 1); reorder `#items` so the transfers count and
   button render LAST and the rest in decision 2's order; add `department_transfer.short` to both
   catalogues and use it for the bar's button; shorten `department_transfer.open` in both
   catalogues (decision 4); shorten `shell.more_transfers` / `_one` (decision 5). Both new tests pass.
4. **Changed test checks**: make exactly the changes in "Changed test checks" above, and list
   each in the PR; no other assertion is loosened. Search the file for any other place that names the old order (e.g. comments such as "Profile
   would come third in the leaving order" near the "item earlier in the leaving order appears"
   case) and bring it in line, keeping what that case proves (pick an item that still comes
   earlier in the new order than what More holds, and say so in the PR).
5. **Prove by deletion**: put the old `LEAVE_ORDER` back alone and see the new 1024/800 case fail;
   put the old label back alone and see the label case fail; restore.
6. Run `pnpm --filter @waitron/till exec vitest run src/widgets/tab-shell.test.ts
   src/widgets/tab-shell.a11y.test.ts src/i18n` and `pnpm --filter @waitron/till exec vitest run
   src/till-app-boot-and-counter.test.ts src/dropdown-icons.test.ts`; also grep `apps/till/src` for
   other tests asserting "Department transfers" text on the bar and run them. Read the `Tests` count
   of every run. Then `pnpm --filter @waitron/till typecheck`, `pnpm exec prettier --check` on the
   changed files and `pnpm exec eslint` on them.

## Task 2 — docs and the look (the driver)

- `docs/developers/design-system.md`, the till tab-shell paragraph: the new order, and the bar's
  items in priority order with the rightmost leaving first.
- `docs/backlog.md` and `docs/backlog/till.md`: delete A395's "items leave strictly in that order, a
  wide item can take narrower ones with it" open point (A425 answers it by priority order instead),
  and update the A395 DONE bullet's order sentence to point at A425's order.
- LOOK: EN/ES, both themes, 390/800/1024/1280 px, with pending transfers; compare with
  `~/waitron-campaign/a395-shots/`. Screenshots to `~/waitron-campaign-b/a425-shots/`.
