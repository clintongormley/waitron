# CI test leftovers

**Status:** Lane I draft. Claude plan review and watcher clearance are required before build; both remain pending. Red control and timings below must be observed during build.
**Smallest result:** One PR ends unfinished IPP polling calls during test teardown and reuses stored-secret hashes in exactly five server suites, preserving every assertion, deadline, real sign-in and verification call.
**Rules read:** `CLAUDE.md` and `docs/developers/{testing-guide,ci-and-gates,workflow-guide,writing-claims}.md`. Read the TDD skill before test edits; follow campaign scope.

**Ask, verbatim (watcher-fed CI-TEST-LEFTOVERS, Lane I queue, 2026-11-17 01:41):**
> two entries in `docs/backlog/ci.md`, one PR.
> 1. "IPP timing fixture completion after its wait fails": in `apps/print-agent/src/ipp-print.test.ts`, when a case's wait for the print outcome fails, the `printOverIpp` call it started is left running past the case. Show that first (a failing check, for example a case whose wait fails and whose call is still unsettled when the fake printer closes), then make the fixture abort that call and await it during teardown. Keep every existing assertion and deadline.
> 2. "Finish reusing fixed-secret hashes in remaining server test setup" (also the third line of "Bundle: apps/server's test speed…"): convert the stored-secret setup in the five named files (`src/till-api.test.ts`, `src/me-api.test.ts`, `src/bill-payments-api.test.ts`, `src/personal-data-export-api.workforce.test.ts`, `src/device-zones-api.test.ts`) to `fixturePinHash`/`fixturePasswordHash`, as #3558 did; keep real sign-in and verification calls and every assertion. One before/after timing of those five files.
> Delete both entries (and the bundle's matching line) when done.

**Exact files and responsibilities:**

- `apps/print-agent/src/ipp-print.test.ts`: own unfinished calls and test teardown; reuse `fakePrinter`, `until`, `afterEach` and reply-timer cleanup. Preserve current variants, assertions and deadlines.
- Under `apps/server/src/`, exactly `till-api.test.ts`, `me-api.test.ts`, `bill-payments-api.test.ts`, `personal-data-export-api.workforce.test.ts`, `device-zones-api.test.ts`: replace stored-secret setup, including parameterized seed/update helpers; retain secret values.
- Reuse unchanged `apps/server/src/testing/known-secret-hashes.ts` and its `.test.ts` sibling (#3558, `9058f2add4`); existing tests cover real verification, wrong-secret refusal and reuse.
- `docs/backlog/ci.md`: delete both entries and matching bundle bullet; correct the bundle count/summary. This plan is the only other doc.

**Build and verification responsibilities:**

- [ ] Before server edits, run this once; retain output, exit status, file/test counts, wall/CPU time, Node/pnpm versions and machine load. Never swap old files over edits.
  `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/me-api.test.ts src/bill-payments-api.test.ts src/personal-data-export-api.workforce.test.ts src/device-zones-api.test.ts`
- [ ] RED before fixture changes: establish accepted submission/polling, force and catch an outcome-wait failure, then assert the original call settled at the server-close boundary. Observe and retain failure because it remains unsettled; missing outcome logs alone prove nothing.
- [ ] GREEN: track asynchronously started polling promises and teardown controllers locally. Use existing `IppPrintOptions.signal`, combining caller signals without replacing their behavior. Submission is not signal-cancelled (`ipp-print.ts`); the control must reach polling.
- [ ] Register ownership at call start. In `afterEach`, abort unfinished calls and await their promises before restoring timers, clearing replies and closing servers. The regression must assert abort and settlement before closure, and pass while preserving the observed failed-wait path.
- [ ] Convert only stored-secret setup. Preserve real login/verification, `watched-scrypt` instrumentation, derivation-count/order assertions and every other assertion; no authentication mocks or cheaper hashing.
- [ ] Run `pnpm --filter @waitron/print-agent-app exec vitest run src/ipp-print.test.ts` red then green. Run `pnpm --filter @waitron/server exec vitest run src/testing/known-secret-hashes.test.ts` unchanged. Require nonzero test counts and no unhandled errors.
- [ ] Run the identical timed five-file command once after conversion, unchanged configuration/workers and coverage off. Require all five files/tests passing; report both measurements and their difference, with no CI extrapolation, repeats or speed threshold.
- [ ] Remove backlog text after verification. Driver owns signed-off commits, `finish-branch`, normal pre-push checks and current-head CI; no whole-workspace local run solely for finishing.

**Excluded:** Production changes; hashing-subject tests; wider recovery-key memo “Server test time levers left after A1297”; twice-booting restart tests; worker/config/shard changes; new framework, standalone support layer or invented edge cases.
**Changed-line estimate (additions + deletions):** production code 0; tests 80–135; fixture support 20–40 inside `ipp-print.test.ts` (standalone support 0); docs 40–65; total 140–240.
**Review trigger:** Return to Claude and watcher before scope growth or >1.5× the upper estimate (360 lines); obtain renewed clearance. Review/clearance is not owner approval.
