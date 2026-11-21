# Lane D · Data table follow-ups

The watcher assigned DATA-TABLE-ODDS on 21 November at 22:03. Lane D's queue asks for “the four entries in that bundle, as their Details say. Anything an entry leaves for the owner to decide is NOT built: list it under WATCHER-NEEDED with a recommendation.” Claude reviewed the plan. The watcher cleared the documentation changes below at 23:55 on 21 November 2026.

**W83 · Filters placement.** Keep the fixed 768 px breakpoint. Record the limit in `docs/backlog/menu.md` and link to it from `docs/developers/design-system.md`. Run the existing 767/768 Chromium case in `packages/ui/src/components/wt-data-table.test.ts`. In a disposable checkout, raise `--wt-tap-min` from 44 px to 48 px, observe the wide-rows assertion fail, restore 44 px and observe it pass. Keep the failing log. The check catches a change large enough to put the rows into their narrow layout.

**W92 · Old test observation.** Remove the unnamed local pixel and drag failures from the backlog. Keep the A292 appearance question.

**C45 · Report columns.** Move the decision to keep fixed columns in the plain report tables to Decisions and deliberate limits in `docs/backlog/dashboard.md`. Preserve the recorded chooser exceptions.

**Owner choices.** W85e phone layout and A292 sold-out styling remain open. Carry both entries forward and retitle and recount the bundle in `docs/backlog/menu.md` and the `docs/backlog.md` index.

One documentation branch. Zero production and test changes. Expect about 40 lines of documentation.
