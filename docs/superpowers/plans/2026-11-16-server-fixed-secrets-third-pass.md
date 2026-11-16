# Server fixed-secret setup, third pass

Source: Lane I FIXED-SECRETS-3 in `~/waitron-campaign-i/queue.md`, watcher17:52; timing narrowed by watcher18:47 on 16 November2026: “time it once — the whole affected set before and after, one run each”. Separate Sol/high draft checked by driver; this revision follows that instruction. Claude review and watcher clearance precede build; no owner design approval claimed.

Finish line: repeated setup reuses actual stored secret hashes and one archive salt per test file, using existing helpers, while the unchanged behavior/crypto checks pass. No production changes, new helper/cache/scanner, assertion edits, changed secrets, real sign-in/hash-subject changes, restart/child-loader work or duration-table refresh.

Read `docs/developers/testing-guide.md` and the second-pass plan. Reuse `apps/server/src/testing/known-secret-hashes.ts`, `apps/server/test/fixture-salt.ts` and the existing derived-key cache unchanged. All following source paths are under `apps/server/`.

| Edit only these setup sites | Existing replacement |
| --- | --- |
| `src/workforce-api.gate-sweep.test.ts`: setupVenue admin/manager/clerk stored hashes | fixturePinHash/fixturePasswordHash, same strings |
| `src/personal-data-export-api.workforce.test.ts`: beforeEach’s two stored PIN hashes | fixturePinHash, same strings |
| `src/till-api.availability.test.ts`: beforeEach’s stored PIN | fixturePinHash; keep loginWithPin |
| `src/device-zones-api.test.ts`: fixture’s stored PIN | fixturePinHash; keep both loginWithPin calls |
| `src/testing/handover-placed-copy.ts`: setupBoxes stored PASSWORD hash | fixturePasswordHash(PASSWORD) |
| `src/testing/staged-hour-crash.ts`: stagedHourCrash archive encryption | sealFixtureArtifact, same plaintext/passphrase |

- [ ] Refresh every open branch’s changed paths before editing; skip a named edited file if held. Current holds.json records till-api.test.ts, me-api.test.ts and bill-payments-api.test.ts on existing branches: leave all three alone. Do not broaden the skip to unrelated consumer files or wait merely for overlap. Preserve every other identity import and every existing assertion.
- [ ] Form the complete affected test set: the four direct tests above; handover helper consumers `src/handover-dormant-setup.test.ts`, `src/boot.handover-chart-moved-on.test.ts`, `src/handover-emergency-followed.test.ts`, `src/handover-activation.test.ts`, `src/handover-activation-repair.test.ts`, `src/spare-join.fiscal.test.ts`, `src/handover-browser.e2e.test.ts`, `src/handover-emergency-declare.test.ts`; salt helper consumers `src/hour-restore-retired-inputs.test.ts`, `src/restore-missing-history.e2e.test.ts`, `src/restore-emergency-crash.e2e.test.ts`, `src/restore-placement-crash.e2e.test.ts`. Confirm runtime callers with rg; type-only restore-result-facts is not a runtime unit.
- [ ] After clearance, run `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run <the complete selected test set>` ONCE before edits and ONCE after. Retain full output, exit/counts, per-file durations, revision, uptime/memory/process snapshot in campaign receipts. No per-file fresh-process repetitions or median framework. Report the whole-set result and individual figures as observations, without causal CI-speed claims; inconclusive evidence goes to the watcher before extra timing runs.
- [ ] Make only the six import/stored-value swaps above, keeping crypto checks and consumer tests unchanged. Read the actual before/after results; keep conversions with demonstrated savings and retain held/deferred parts in the backlog. If the one set comparison cannot settle that, ask the watcher rather than adding measurement rounds.
- [ ] The unchanged route/consumer cases own domain behavior; run `src/testing/known-secret-hashes.test.ts` for correct/wrong-secret and reuse, `src/testing/derived-key-cache.test.ts` plus `pnpm --filter @waitron/provisioning exec vitest run src/artifact-cipher.test.ts` for derivation, tampering and fresh-IV behavior. Run unchanged fiscal `src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts` for the fiscal helpers; edit no golden values. No whole server/workspace suite.
- [ ] Narrow the fixed-secret and remaining-salt entries in docs/backlog/ci.md and their docs/backlog.md index; preserve held/unconverted work. Inspect diff for unchanged assertions, secrets and subject calls. Driver completes finish-branch review/current-head CI and authorised land-branch as one PR, after the cancellation repair.

Estimate: production0; test changes25–45 physical lines, support10–20, docs50–100 including this plan; total85–165. These are estimates; growth beyond248 requires an outside opinion, not a ceiling. Three-hour-to-PR budget excludes waits. No baseline or implementation has run.
