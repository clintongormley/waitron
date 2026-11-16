# Paid elsewhere and retained lines: implementation plan

Authority: watcher-fed PAID-ELSEWHERE-FRESH, questions.md 2026-11-16 21:21. Sol-high draft, Claude read, driver corrections; build awaits watcher. No owner design approval claimed.

Finish line: Move dishes opens with current paid choices; a refused move refreshes the table amount. If reproduced, vanished-bill kept lines join the replacement's review, with no automatic save or send.

Files: `apps/till/src/till-app.ts` owns reads/candidates; `screens/till-table-order-screen.ts` owns opening. Reuse screen:5935's cancelable callback and currentness checks. Exclude polling, channels, layout, wording, eligibility, server and new kept-line models; also Join-table takeovers and A1349/A1289.

1. A1288, failing tests before fixes

- In `apps/till/src/till-app-move-dishes.test.ts`, change payment facts, open via the menu, assert the paid native checkbox disabled before periodic refresh. Hold balance response to prove opening waits; reject it to require closed panel, retry and existing `table.reread_failed` wording.
- Keep :430's fixture unpaid through opening, paid afterwards; preserve assertions. Add visible `[data-party-outstanding]` assertion to :250, preserving :265's no-lines-read assertion and no write retry.
- In `apps/till/src/screens/till-table-order-screen.move-dishes.test.ts`, test callback wait/cancellation after Back or bill change. Screen owns lifecycle; app owns paid facts/amounts; no duplicated refresh-guard test.
- In the two production files, defer opening through the existing callback pattern. Read bills first, then await the single balance promise already launched by `#loadPartyBills`; expose its completion/success to this caller without changing other callers' timing or duplicating GET. Trace `ReadBills`/balance-result consumers. Failed/superseded reads offer no ticks; ready checks connectivity, opening, API/session/visit/bill.
- Route `#onBillMoneyRefusal` through existing `#rereadAmounts(billId, visit, undefined, false)` at app:13359. This also benefits Merge's shared-handler path. Its separate payments-received branch and line-write paths are outside this move-refresh fix.

2. A1267, one browser app case in `apps/till/src/till-app-parties.test.ts` beside :4265

- Keep Bill 1's dish through failed save/editor takeover; switch to Bill 2, add another unsaved dish, merge Bill 2 away through existing fixture. Expect both exact sets in Bill 1's review. Record red: Bill 1's review lacks incoming dish.
- If reproduced, combine within `RetainedDraftCandidate` in `#carryCandidate`. Keep destination lines first; append incoming lines, re-placing them with existing `placeFor` against destination groups/kept lines while preserving courses and quantities. A required new representation, unresolved line-identity collision or required vanished-group placement goes to the watcher before building.
- Continue through repeated reads, Update the order and later save. Assert exact lines/placement, destination saved contents preserved once, bill-gone sentence plus review without draft-refusal banner, and no automatic save/send through a defined settled endpoint. Trace all `#leftBillDrafts` consumers (:13903/:13914/:14877). If not reproduced, retire the point with the scenario and command, without a speculative fix.

Verification and size

Run cases red/green, then all changed files with `pnpm --filter @waitron/till exec vitest run` and named paths. Reuse helpers; no `till-app-drafts.test.ts` change. Prove the no-auto-write assertion by a deliberate forbidden write in a disposable copy. LOOK at the three states in EN/ES, both themes and phone/desktop per RUNNER; watcher may accept Claude's proposed reduced LOOK. Images stay local.

No guide change expected: EN/ES `table-service.md#bill-switcher` and `#move-dishes` describe unchanged actions. Delete A1267/A1288, bundle and index from `docs/backlog/till.md` and `docs/backlog.md`, including A803's :3219/:3221 references. Estimates added/removed: production +60–105/−10–25; tests/support +140–210/−0–20; docs including plan +30–40/−35–50. No generated files. Two-seat concurrency review, hook/current-head CI, authorised land-branch; H13 applies.
