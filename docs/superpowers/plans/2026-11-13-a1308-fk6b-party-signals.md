# A1308 fk6b: keep party signals when parties combine

Base: `01ce97ef6027e8a48c9ca06802b26534e758bda4`. Execute inline; Lane E lands, not the owner. No fiscal changes.
Follow [A1308 slice rules](2026-11-08-a1308-slice-rules.md); no schema changes.

**Ask and authority.** The assigned ask is: “fk6b: when two parties combine, the survivor keeps a pending bill request and a party name from either side, with one case per signal.”
Watcher assignment: `/Users/clintongormley/waitron-campaign-e/questions.md`, **2026-11-13 06:12**; recorded in that lane's `queue.md`.
Owner answer: **2026-11-11 17:12**, `/Users/clintongormley/waitron-campaign-e/archive/questions-to-2026-11-11.md:223–228`: `Proposal 1 (bill request and name survive when parties combine): "yes".`
Proposal: `/Users/clintongormley/waitron-campaign-m/reports/r1.md:238–260`: “The combined party is "bill requested" if either was, from the earlier time. It keeps its own name, or takes the absorbed party's when it has none.” The owner authorised this behaviour, not this plan.

**Finish line:** Move guests and Join a table preserve the earliest pending bill request and the receiving name, falling back to the absorbed name, so staff keep seeing who is waiting.

**Reuse:** `apps/server/src/table-actions.ts:237–280`, `combineParties`' existing projection and survivor update. Both public paths already wrap it in `withMovedSlips` (`:197`). Keep their transaction and revisions.
Consumers: `apps/server/src/table-signals.ts:280` reads the request; `apps/server/src/kitchen-print.ts:1983` resolves the survivor's name for MOVED paper. Explicit renames use `apps/server/src/parties.ts:252`; do not call `setPartyName` here. Omit new slips protocols, helpers, abstractions, specs, screens, routes and migrations.

- [ ] Before code, read the TDD skill. From `apps/server`, run `pnpm protection-list list --out <empty absolute before-dir>` on the base; keep receipts outside the repository.
- [ ] Add two cases in `apps/server/src/party-table-actions.test.ts` under `combineParties`. Reuse `useVenueDb`, `setupPartyVenue`, `seat`, `tables`, `opts`, `act`, `partyRow`, `floorRow` and existing action fixtures. Use `requestBill`, `commandFor`, `randomUUID`, `nextMillisecond` for distinct request times; no new support.
  - **`keeps the earliest pending bill request when parties combine`**: A requests, B has none, C requests later. Move A onto B: assert B has A's exact time. Join C with B: assert C inherits that earlier time. Then seat D, request later again, move D onto C, and assert C keeps the earlier time. Assert the floor signal with `toContainEqual({ kind: "bill_requested", requestedAt })`. This catches both absorbed-first and survivor-first mistakes in the same case.
  - **`inherits a party name only when the survivor has none`**: A named, B unnamed, C differently named. Move A onto B: assert B inherits A's name. Join B with C: assert B keeps it. These two cases exercise both public paths without duplicating route tests.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts -t 'keeps the earliest pending bill request when parties combine|inherits a party name only when the survivor has none'`. Observe both RED for missing inheritance before implementing; record expected/received values.
- [ ] In `apps/server/src/table-actions.ts`, select `billRequestedAt` and `name` alongside guest count. Extend the existing survivor update: earliest non-null request, null only if both null; receiving name unless null, then absorbed name. Preserve guest counts and closure. Re-run the cases GREEN.
- [ ] In `docs/backlog/till.md:3149`, replace Task 10's request-dropping default in place with the owner's replacement rule and name precedence, dated **2026-11-11 17:12**; this already sits under **Decisions and deliberate limits**. Preserve other defaults. No guide edits: staff do nothing different (conventions-ui.md, "A guide says what to do"). Keep the existing kitchen ticket-name workflow; no extra name-change slips are in this slice, and note that scope in the PR.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/table-signals.test.ts src/party-name-paper.test.ts src/till-api.table-actions.test.ts`. Actions own inheritance; existing signal, paper and route suites check consumers. Read counts and failures. Full package tests and coverage stay with CI; no new full-suite local run.
- [ ] From `apps/server`, run `pnpm protection-list list --out <empty absolute after-dir>`, then `pnpm protection-list compare --old <before-dir> --new <after-dir> --report <absolute report-file>`. Read and attach the report; check scope and size.

**Assertions that change, by design:** none. Preserve existing receiving-name (`party-table-actions.test.ts:391`), bill, guest-count, allergy, revision and closure assertions. New cases must be observed RED first.

**Expected protection-list difference:** `EQUAL` everywhere: no schema changes, no `missing`, `extra` or `changed` objects. Any difference stops for the watcher.

**Size, added / removed:** production `+18 / -2`; tests `+100 / -0`; test support `+0 / -0`; docs including this plan `+45 / -1`: about 166 lines. Stop at 1.5× (249 lines) or material scope growth for the watcher, per RUNNER §0, overriding the older slice-rule size stop.

- [ ] Claude reviews the plan; watcher clears it before building, with no owner approval ceremony. After focused checks, announce ready for `finish-branch`; run its rebase, required Claude run-it review(s), fixes and fresh read. Sign off commits, keep the normal hook, require current-head CI. Lane E runs `land-branch`, verifies merge CI and cleans up. No per-slice bench.

**Plan review:** Claude read `3b65f27d68` on 2026-11-13; the request test now checks both time directions, guide edits are cut, and the existing backlog line is updated in place. The driver checked the quoted owner/watcher notes in their named lane files; the read-only reviewer could not open those paths outside the checkout. The watcher cleared this corrected plan on 2026-11-13 at 09:18 in the lane's `questions.md`.
