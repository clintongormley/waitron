# A1251 released review repairs

**Authority:** Lane F `questions.md`, WATCHER 2026-11-09 15:13: batch #2143/#2077/#2068 after A790, one branch/PR. H1a permits planning while #2640 awaits CI. Parent obtains Claude’s plan read and watcher approval before building.

**Build:** Close the setup-test server after readiness refuses; catch Spanish referral/removal regressions independently; reserve guide reconfiguration advice for unusable archive settings. Read: `docs/backlog/ci.md:162–226` and `~/waitron-campaign-f/receipts/a1251/pr{2143,2077,2068}/triage.json`.

**Files and estimated changes:** additions and removals both count; estimates are not limits.

| Exact path | Work | Estimated + / − lines |
| --- | --- | --- |
| `apps/server/src/boot.setup-routes.test.ts` | Local cleanup and regression | +80–95 / −45 tests |
| `apps/dashboard/src/screens/box-status-screen.test.ts` | Independent Spanish semantics | +8–12 / −0 tests |
| `apps/dashboard/src/screens/backup-screen.test.ts` | Independent Spanish semantics | +8–13 / −0 tests |
| `apps/server/src/guide/en/backup-recovery.md` | Conditional reconfiguration paragraph | +4–6 / −4 docs |
| `apps/server/src/guide/es/backup-recovery.md` | Matching Spanish condition | +4–6 / −4 docs |
| `docs/backlog.md` | A1251 named entry only, if its summary needs updating | +0–2 / −0–2 docs |
| `docs/backlog/ci.md` | Remove completed repair text and update A1251 summary | +0–6 / −45–65 docs |
| `docs/superpowers/plans/2026-11-09-a1251-released-review-repairs.md` | This plan | about +30 / −0 docs |

Totals: **runtime code 0; tests about 140–165; docs about 90–125 changed lines (total 230–290)**, counting removals. The existing helper needs one optional file-local `onStarted(server)` capture; no shared fixture API changes.

- [ ] **#2143, red then green.** Add “A1251 closes the setup server when listener readiness refuses” and optional file-local `onStarted(server)`. With `extraPortCount: 1`, spy on `awaitListening`: complete real readiness, then reject distinctly. Assert rejection, unused callback and `beforeServerStarts()` not throwing; capture the server for unconditional fallback close and restore the spy. Observe RED first. Enclose readiness and TLS-client creation in server cleanup immediately after startup; nest TLS cleanup inside it. Pass, then delete that cleanup boundary in a disposable checkout and require the same assertion to fail (RUNNER H4). This isolates readiness refusal, not natural `EADDRINUSE`.
- [ ] **Spanish controls.** Preserve catalogue/action mapping and every existing behavioral assertion. Add short independent fragments: exhausted cleanup explains delayed deletion, no immediate space, stopping unchanged and keeping database/keys/backups; the first archive-settings case checks leaving without applying. Each rejects referrals with `/instal|soporte|encargad|gerente/i`. No separate removal regex or duplicate catalogue-only assertion. Disposable faults remove the leave promise or restore the old referral; additive referral faults retain every required fragment so the rejection assertions execute. Require each intended failure, restore current wording and pass. No catalogue edit ships.
- [ ] **Guides/backlog.** In both guides, condition the existing paragraph on scheduled backups being off because saved settings cannot be used. Preserve headings/IDs/links and read both passages together. Delete completed named repair text only; move the shared multiple-listener/configured-port limit under the landing-port entry and give the separate inline-instruction mismatch its own heading. Retain IPP and broader A1251 work.

**Focused verification:** `pnpm --filter @waitron/server exec vitest run src/boot.setup-routes.test.ts src/guide-content.test.ts src/guide-backup-recovery.test.ts`; dashboard Vitest with `pnpm --filter @waitron/dashboard exec vitest run`, separately selecting `src/screens/box-status-screen.test.ts -t 'exhausted cleanup'` and `src/screens/backup-screen.test.ts -t 'A1089 unreadable archive settings choices'`; `pnpm exec vitest run scripts/guide-links.test.ts`. Read counts; retain failing controls/restored passes. No full-package local suites.

**Plan read:** Claude 298 seconds; concrete findings accepted. Retain one cleanup deletion control under RUNNER H4 despite its suggested removal. Own-lane approval/time above is quoted under RUNNER’s visibility exception; build still needs watcher approval.

**Leave out:** runtime/API/schema/error-code changes, catalogue edits, helper infrastructure, other findings and repeated historical reviews. **Finish:** three outcomes verified, backlog accurate, one whole-branch Claude run-it review after initial rebase before PR, normal hook and current-head CI passing; one PR ready to land, no merge.
