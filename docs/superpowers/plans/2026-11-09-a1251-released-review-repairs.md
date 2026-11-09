# A1251 released review repairs

**Authority:** Lane F `questions.md`, WATCHER 2026-11-09 15:13: batch #2143/#2077/#2068 after A790, one branch/PR. H1a permits planning while #2640 awaits CI. Parent obtains Claude’s plan read and watcher approval before building.

**Build:** Close the setup-test server after readiness refuses; catch Spanish referral/removal regressions independently; reserve guide reconfiguration advice for unusable archive settings. Read: `docs/backlog/ci.md:162–226` and `~/waitron-campaign-f/receipts/a1251/pr{2143,2077,2068}/triage.json`.

**Files and estimated changes:** additions and removals both count; estimates are not limits.

| Exact path | Work | Estimated + / − lines |
| --- | --- | --- |
| `apps/server/src/boot.setup-routes.test.ts` | Local cleanup and regression | +45–65 / −8–15 tests |
| `apps/dashboard/src/screens/box-status-screen.test.ts` | Independent Spanish semantics | +8–12 / −0 tests |
| `apps/dashboard/src/screens/backup-screen.test.ts` | Independent Spanish semantics | +8–14 / −0 tests |
| `apps/server/src/guide/en/backup-recovery.md` | Conditional reconfiguration paragraph | +4–6 / −4 docs |
| `apps/server/src/guide/es/backup-recovery.md` | Matching Spanish condition | +4–6 / −4 docs |
| `docs/backlog.md` | A1251 named entry only, if its summary needs updating | +0–2 / −0–2 docs |
| `docs/backlog/ci.md` | Remove completed repair text and update A1251 summary | +0–6 / −45–65 docs |
| `docs/superpowers/plans/2026-11-09-a1251-released-review-repairs.md` | This plan | +29 / −0 docs |

Totals: **runtime code 0; tests 69–106; docs 90–120 changed lines**, counting removals. Current fixture/test interfaces support these paths without API changes; no missing scope decision.

- [ ] **#2143, red then green.** Add “A1251 closes the setup server when listener readiness refuses”. With `extraPortCount: 1`, locally mock `awaitListening` to complete real readiness then reject distinctly. Assert rejection, unused callback and `beforeServerStarts()` not throwing; capture the server for fallback cleanup. Observe the running-server assertion fail first. Enclose readiness and TLS-client creation in server cleanup immediately after startup; nest TLS cleanup inside it. Pass, then restore the old boundary in a disposable checkout and require failure. This isolates readiness refusal, not natural `EADDRINUSE` or listener-error teardown.
- [ ] **Spanish controls.** Preserve catalogue/action mapping and all behavioral assertions, including refusal, corrected apply, no-write and locale restoration. Add short independent fragments, never whole-message snapshots. Exhausted cleanup must explain delayed deletion, no immediate space, stopping unchanged and keeping database/keys/backups; reject installer/support referrals and removal advice. Both archive-settings cases must require “sal sin aplicarlos para conservarlos” and reject support referrals. First prove failures against separate disposable faults: old installer referral, leave-choice removal, support substitution and advice to remove retained items. Restore current wording and pass.
- [ ] **Guides/backlog.** In both guides, condition reconfiguration on scheduled backups being off because saved settings cannot be used. Keep it separate from copy proof and unconfirmed-key advice; preserve IDs/links and read both passages together. Remove completed named repair text/links only. Retain multiple-listener/configured-port limits, IPP work, broader A1251 work and the separate inline-instruction mismatch.

**Focused verification:** `pnpm --filter @waitron/server exec vitest run src/boot.setup-routes.test.ts src/guide-content.test.ts`; dashboard Vitest with `pnpm --filter @waitron/dashboard exec vitest run`, separately selecting `src/screens/box-status-screen.test.ts -t 'exhausted cleanup'` and `src/screens/backup-screen.test.ts -t 'A1089 unreadable archive settings choices'`; `pnpm exec vitest run scripts/guide-links.test.ts`. Read counts; retain failing controls/restored passes. No full-package local suites.

**Leave out:** runtime/API/schema/error-code changes, catalogue edits, helper infrastructure, other findings and repeated historical reviews. **Finish:** three outcomes verified, backlog accurate, one whole-branch Claude run-it review after initial rebase before PR, normal hook and current-head CI passing; one PR ready to land, no merge.
