# Server fixed-secret test setup

Separate Codex Sol/high draft for RUNNER, 16 November 2026. Driver checked the draft;
Claude review and watcher clearance are pending. The owner authorises implementation and landing
through the campaign queue; this plan has no separate owner approval.

**Ask:** “Other server test files still hash fixed PINs and passwords on every test”
(`docs/backlog/ci.md:1010–1019`): “Move the set-up ones over; leave any test that is about hashing.”
Deliver one measured, bounded PR using `fixturePinHash` and `fixturePasswordHash` from
`apps/server/src/testing/known-secret-hashes.ts`.

1. **Review, then measure before changing setup.** The driver reviews this draft, obtains
   Claude plan review through `~/workspace/tools/claude-seat.sh review-branch`, resolves its
   findings, then obtains watcher clearance before implementation. Before each file edit, compare current
   E/H branch changes and skip held files without reading another lane's queue. The
   16 November inventory holds `src/testing/handover-placed-copy.ts`
   on `feat/a1420-3-restore-waits`; leave that helper for the remainder.

2. **Establish the baseline.** All following paths are relative to `apps/server/`.
   Start with `src/management-api.accounts-and-receipt-config.test.ts` (47.9 s in the committed
   duration table), `src/till-api.deliveries.test.ts` (43.1 s), `src/print-api.test.ts` (38.3 s),
   and `src/attendance-till-api.test.ts` (9.0 s). Their setup repeatedly hashes respectively
   administrator/manager/staff secrets, venue/staff secrets, two people's PINs in `beforeEach`,
   and worker PINs in `beforeEach` and refund setup. Run each unchanged whole file three times,
   each in a fresh process: `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run <file>`.
   Include `src/backup-verification.installed.test.ts` (29.0 s) to sample shared-helper savings.
   Keep logs, baseline SHA, Node version, test counts, wall times and medians outside the commit;
   record the load average for each run, then repeat the same five-file sample three times
   on the final candidate. Only the backup-verification sample uses these shared helpers, so
   only it gets an optional helpers-only run. Logs go outside the checkout in
   `~/waitron-campaign-i/receipts/server-fixed-secrets-20261116/`; the PR reports medians,
   counts, SHAs and Node version. A passing exit without a test count is insufficient.
   Table timings select candidates; they do not establish savings.

3. **Convert shared setup first.** Replace only stored-secret construction in
   `scripts/testing/venue.ts`, `scripts/demo-seed/testing/provision-venue.ts`,
   `src/testing/veri-factu-join.ts` and `src/testing/backup-verification-fixture.ts`.
   Preserve supplied secrets, including `options.adminPin`, and helper interfaces. Then convert
   the sampled files and rank additional unheld files by per-test hash calls times the cases
   using that setup, with durations as context. The sample measures the saving; do not time
   every extension file. Include unheld `attendance-*` setup, including `attendance-disabled`.
   Stop as the whole diff approaches 1,000 added plus deleted lines; do not promise all search
   hits. Snapshot `git diff --name-only origin/main...<branch>` for each active E/H branch
   before editing and refresh before push; skip every held file, including shared helpers.

4. **Keep the behavioural checks.** Run the unchanged `src/testing/known-secret-hashes.test.ts`:
   it checks identical-string reuse, correct-secret acceptance, wrong-secret rejection and
   no cross-verification for both secret types. Exercise shared helpers through whole files
   `scripts/fingerprint-refusal.test.ts`, `scripts/demo-seed/seed-staff.test.ts`,
   `scripts/demo-seed/testing/provision-venue.test.ts`,
   `src/spare-join.fiscal.test.ts`, `src/handover-two-boxes.test.ts`,
   `src/backup-verification.permission.test.ts` and `src/backup-verification.installed.test.ts`,
   plus every converted test file. Preserve all assertions, actual sign-in verification,
   wrong-password refusals and hashing/derivation checks, including `watched-scrypt`. If a
   conversion breaks an assertion, revert that conversion, never the assertion. Check the
   non-test consumer `scripts/a1308/time-today-wake.ts` and its branch for shared-helper holds.
   Keep `vitest.config.ts` and its byte-equality, derived-key-cache and tab-person setup unchanged.
   Existing setup replacement needs no invented failing test; any necessary new behaviour
   requires a failing behavioural test first. Leave hashing-subject tests unchanged.

5. **Small salt follow-up if unheld.** Reuse `test/fixture-salt.ts`'s `sealFixtureArtifact`
   in `src/testing/staged-hour-restore.ts` and `staged-hour-crash.ts`; no helper or coverage
   changes. Keep existing crypto checks. Run one unchanged consumer per helper before and
   after (`src/device-after-offline-restore.test.ts`, `src/hour-restore-retired-inputs.test.ts`).
   If either helper or required consumer is held, leave that point explicitly in the bundle.

**Size and exclusions.** Production code: 0 lines. Existing test files: roughly 400–800 changed
lines if measurements justify extending the sample. Test support: about 20–35 lines. Documentation:
40–100 lines including this plan and narrowing the existing backlog entry. These are estimates,
not a reason to pad the diff. Add no caching framework, scanner, dependency, assertion rewrite
or hashing-check change. No migration, production behaviour or global hash mock changes.

**Finish line.** Local focused checks and retained before/after timings establish the useful
subset. The normal pre-push hook owns install, formatting, lint and scoped types; current-head
PR CI owns scoped package tests and root guards, with package coverage left to full CI.
No duration-table refresh is expected; use `scripts/test-durations.mjs` only if a shard exceeds
four minutes. Narrow the existing backlog entry to unconverted/held setup, or delete it if
exhausted. Update the bundle bullet/count and index together; if its title changes, fix every
link to the old anchor. Keep any remaining salt point precise.
Complete `finish-branch` and its required review for one PR with measured savings and unchanged
behavioural assertions; landing is already authorised by the campaign instruction.
