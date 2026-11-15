# The spare's wait loop

## PLAN FOR APPROVAL:

Lane I request: `~/waitron-campaign-i/queue.md`, watcher 2026-11-15 20:20, SPARE-WAIT-LOOP; source: `docs/backlog/replication-cloud.md:724–751` and linked details. Draft only:
the driver checks and commits it, Claude reviews it, then the watcher clears building; no owner design approval claimed.

**Finish line:** a waiting spare retries less often, stops digest reads promptly, bounds its integrity-check wait,
shows a copy-check failure reason, and logs unreadable cleanup folders. One PR for the five requested wait-loop behaviors; residual bundle work stays open.
Reuse `runDuty`, `HeldCopy`, `recordWait`, `monotonicNow`, `CopyFileChecks`, the integrity worker and existing test rigs.
No new records, protocols, process subsystem or framework; no fiscal identity, hash-chain, numbering, allocation, `alta`, `registerSif` or `restoreFiscal` changes. File SHA-256 calculation remains identical.

- [ ] **Retry and reasons.** Modify `apps/server/src/handover-destination-duty.ts` and `handover-fetch.test.ts`.
  Keep an in-memory retry deadline per operation/phase: successive waits use 5, 10, 20, 40, then 60 seconds.
  Gate peer requests, refetches, acceptance posts and repeated restart requests; keep local state reads on ticks/wakes.
  A wake cannot bypass an unchanged wait; a new operation/phase or completed progress resets it. A fetched-but-refused copy is not progress.
  Keep the existing 60-second minimum for retained-file comparisons. Do not clear a reason just because another download finished.
  Suppress repeated equivalent fault logs, including when writing the reason fails; still retry the write. Keep diagnostic errors in the log.
  Catch comparison throws specifically, store `handover.copy_check_failed`, retain the file and retry later;
  cancellation writes no failure reason. Acceptance failures stay outside that catch.
  Duty tests: “wait-loop: refetch and post delays grow and cap”, “wait-loop: wake preserves the deadline”,
  “wait-loop: phase progress resets retries”, “wait-loop: repeated faults log once even when the reason write fails”,
  and “wait-loop: a thrown comparison stores its reason and later recovers”. Preserve abandonment and no-overlap assertions.

- [ ] **Stop and deadline.** Modify `apps/server/src/handover-capture.ts`, `handover-compare.ts`, `handover-integrity.ts`.
  Add optional `signal?: AbortSignal` to `digestFileIfPresent` and its private digest helper; pass it to `createReadStream`.
  Both comparison digests use the duty signal; unsignalled capture/placement callers keep their behavior.
  Only controlled comparison gives `isCopyIntact` a combined stop/deadline signal: five minutes (`CompareOptions.integrityLimitMs?: number`).
  Reuse its five-second stop grace; clear timers/listeners and unref a worker still present after that grace.
  Timeout refuses with `handover.copy_check_failed` and sets `CopyFileChecks.integrityTimedOut?: true`:
  do not check or accept it again until process restart, even if a late worker result says it passed.
  Retain its file; cancellation rejects. This bounds the caller's wait, not SQLite execution or file closure; the termination limitation in `handover-integrity.ts`'s comment is not experimentally proved here.
  In `handover-capture.test.ts`, “wait-loop: abort closes an active digest” owns stream cancellation and unchanged unsignalled digests.
  In `handover-integrity.test.ts`, extend the existing stuck-worker cases to assert bounded rejection/unref, never guaranteed exit.
  In `handover-compare.test.ts`, “wait-loop: timeout never accepts or starts another check” owns deadline wiring, late success and cached-check safety;
  “wait-loop: both digests receive the stop signal” owns that wiring. Retain real dangling-row and sound-copy controls.
  `restore-stream.ts`, `upgrade-checks.ts` and `handover-emergency-check.ts` keep their unsignalled, unlimited checks.

- [ ] **Readable reason and folder refusal.** In `apps/setup/src/screens/handover-screen.ts` and
  `apps/setup/src/i18n/strings/handover.ts`, map `handover.copy_check_failed` to EN/ES wording: checking failed,
  takeover has not happened; restart this box if the message persists. Extend `handover-screen.test.ts`'s “says what a handover waiting on %s is waiting for” for rendered EN/ES text.
  Update `apps/server/src/guide/{en,es}/servers.md` with that action; look at the page in both themes and phone width. No general wording sweep.
  In `apps/server/src/handover-store.ts`, swallow only `ENOENT` from `destinationOperationFolders`; propagate other failures.
  `handover-store.test.ts`: “wait-loop: only a missing folder is empty”. In `handover-fetch.test.ts` and `handover-place-copy.test.ts`,
  “wait-loop: an unreadable folder is logged” proves each caller's logging and existing recovery behavior.

**Open scope:** leave chart-post unchanged: `handover-activation.ts` still receives an ambiguous boolean; diagnostics cannot finish that entry.
Leave crash-after-swap plus lost `accepted.db` open: `handover-place-copy.ts` recognises the live copy by digest; accepting changed bytes needs a separate recovery decision. Driver asks watcher once at clearance: “Leave these two entries open, as recommended?”
Also retain linked residuals for closed-folder retry scheduling, full-disk reason persistence and bucket-restore deadlines.
Delete only finished entries/detail bullets in `docs/backlog/replication-cloud.md`; retain residual text and update both `docs/backlog.md` index references without closing the bundle.

**Build/check:** observe new behavioral tests fail before implementation, then pass; keep assertions strict and reuse gates/clocks.
Run named files via `pnpm --filter @waitron/server exec vitest run src/<file>.test.ts`, plus unchanged `restore-stream.test.ts`, `boot.upgrade.test.ts`, `handover-emergency-check.test.ts`.
Run `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.test.ts`. No package-wide local run; normal hook and current-head CI follow during finish-branch.
Estimate added/removed lines: production 210/55; tests 330/55; test support 0/0; docs including plan 85/35: about 770 total. Target three hours to PR; watcher/outage waits excluded.
