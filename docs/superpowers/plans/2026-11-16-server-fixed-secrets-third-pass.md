# Server fixed-secret setup, third pass

Planning-only draft, 16 November 2026. Request: Lane I FIXED-SECRETS-3, started 18:07;
verbatim ask: `~/waitron-campaign-i/receipts/fixed-secrets-3-20261116/ask.md`.
Read with the second-pass plan and `docs/developers/testing-guide.md`.
The driver obtains Claude plan review and watcher clearance before building; neither is owner design approval.
No baselines or tests were run to write this plan.

**Finish line:** CI can reuse actual stored PIN/password hashes within each test file and one
archive salt per file, through existing helpers, with every behavioural assertion retained and
local before/after evidence for every retained conversion. No production behaviour changes.
Reuse `src/testing/known-secret-hashes.ts`, `test/fixture-salt.ts` and the existing
`src/testing/derived-key-cache-setup.ts` unchanged (paths below are under `apps/server/`).

**Selection:** read-only `~/waitron-campaign-i/receipts/fixed-secrets-3-20261116/holds.json`
currently holds `src/till-api.test.ts`, `src/me-api.test.ts`, `src/bill-payments-api.test.ts`:
skip all three, including their setup calls. Recheck holds before each edit; skip newly held paths.
Check helper consumers too; defer a helper if its conversion would affect a held consumer.

| Candidate file | Exact setup calls to replace; all arguments stay identical |
| --- | --- |
| `src/workforce-api.gate-sweep.test.ts` | `setupVenue`: admin `hashPin("1234")` / `hashPassword("dashPass123")` at 57–58; manager and clerk `hashPin("1234")` at 71, 76 → fixture equivalents. |
| `src/personal-data-export-api.workforce.test.ts` | `beforeEach`: Martha `hashPin("4821")` and colleague `hashPin("9137")` at 213, 219 → `fixturePinHash`. |
| `src/till-api.availability.test.ts` | `beforeEach`: Waiter `hashPin("5555")` at 82 → `fixturePinHash`; leave `loginWithPin` at 84 unchanged. |
| `src/device-zones-api.test.ts` | `fixture`: Viewer `hashPin("4321")` at 59 → `fixturePinHash`; leave both `loginWithPin` calls at 62, 65 unchanged. |
| `src/testing/handover-placed-copy.ts` | `setupBoxes`: admin `hashPassword(PASSWORD)` at 185 → `fixturePasswordHash(PASSWORD)`. |
| `src/testing/staged-hour-crash.ts` | `stagedHourCrash`: `encryptArtifact(packArchive(...), encryptionKey)` at 186 → `sealFixtureArtifact` with the same arguments, from `../../test/fixture-salt.js`. |

Import fixture hashes from `./testing/known-secret-hashes.js` in tests and
`./known-secret-hashes.js` in the handover helper. Replace only the now-unused hash/encryption
imports; preserve every other import. Leave all in-case login/hash subjects, verification calls,
secrets, hooks, crypto checks and assertions unchanged, including those in helper consumers.
Exclude restart/child-loading work, wider caching, new helpers/scanners/timing infrastructure,
new tests or assertions, production changes, coverage changes and duration-table refreshes.
An additional source path is justified only when necessary for this named behaviour, never another subject.

- [ ] **Measure then convert individually, after clearance.** For each direct candidate test,
  run `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run <src/file.test.ts>`
  three times sequentially in fresh processes before editing, then three times after.
  For each helper, use every direct consumer below as a separate full-file timing unit, three
  before and three after; do not time the helper as a test or substitute representative samples.
  Confirm the lists with `rg -n 'handover-placed-copy|placedSpareFixture' apps/server/src`
  and `rg -n 'staged-hour-crash|stagedHourCrash' apps/server/src`; inspect imports and runtime uses.
  Leave consumers unchanged and do not modify other lanes or run timing commands concurrently.
- [ ] **Handover helper consumer units:** `src/handover-dormant-setup.test.ts`,
  `src/boot.handover-chart-moved-on.test.ts`, `src/handover-emergency-followed.test.ts`,
  `src/handover-activation.test.ts`, `src/handover-activation-repair.test.ts`,
  `src/spare-join.fiscal.test.ts`, `src/handover-browser.e2e.test.ts`,
  `src/handover-emergency-declare.test.ts`. All use `placedSpareFixture` and its
  `setupBoxes`/`placeRealCopy`/`stoppedBeforePlacing`/`placeEmergencyCopy` paths.
- [ ] **Staged-hour helper consumer units:** `src/hour-restore-retired-inputs.test.ts`,
  `src/restore-missing-history.e2e.test.ts`, `src/restore-emergency-crash.e2e.test.ts`,
  `src/restore-placement-crash.e2e.test.ts`; each calls `stagedHourCrash`.
  `src/testing/restore-result-facts.ts` has a type-only reference, not a timing unit.
- [ ] Retain command, tree revision, full output, exit status, nonzero Tests counts and wall times
  outside the commit. Record `uptime`, `memory_pressure` and a process snapshot before/after
  each run to disclose host load. Report each unit's before/after median and min–max spread,
  including every helper consumer. Keep a converted file only where the measurements show real
  savings; revert inconclusive/slower conversions. Judge each helper from its complete consumer
  results, reporting individual results as well as the sum of medians. Do not invent a percentage
  threshold or claim these local observations establish causal CI speedup.
- [ ] **Verification ownership:** timed whole files supply unchanged route/domain checks;
  handover consumers supply placement, activation and sign-in checks; staged-hour consumers
  supply recovery/chain-continuity checks. Run unchanged `src/testing/known-secret-hashes.test.ts`
  with the server command above: it owns correct/wrong-secret, cross-secret and identical-string
  reuse checks. For salt reuse also run unchanged `src/testing/derived-key-cache.test.ts` and
  `pnpm --filter @waitron/provisioning exec vitest run src/artifact-cipher.test.ts`:
  these own real derivation, wrong-passphrase, tampering, supplied-salt and fresh-IV checks.
  Add no import-mirroring tests. If the campaign's fiscal-preservation invariant requires it for
  retained fiscal helpers, run unchanged `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/write-path.e2e.test.ts src/inmutabilidad.test.ts` (golden record and immutability); change no
  golden values. No whole server/workspace suite; the normal hook and current-head scoped CI finish validation.
- [ ] **Budget and delivery:** three hours of work to one PR, excluding waits. Assess the remaining
  six-run cost as baselines arrive, leaving time for editing, review and the hook. If the complete
  set cannot fit, propose the four direct tests plus staged-hour salt first, deferring the eight-consumer
  handover helper; this preserves hash and salt scopes. Narrow further through the watcher before build
  if necessary, never silently replace per-file timing with samples. Narrow `docs/backlog/ci.md`'s
  two entries to held/deferred/unconverted work; keep bundle/index wording in `docs/backlog.md`
  accurate and delete an entry only when no work remains. Inspect the diff for unchanged assertions,
  subjects and other imports; driver runs `finish-branch`, Claude review and current-head CI.

**Estimated physical additions + deletions:** production code 0; four existing test files 25–45;
two existing support files 10–20; docs 100–150 including this plan and backlog wording;
total 135–215 lines, estimates rather than targets. No new code, tests or support files.
