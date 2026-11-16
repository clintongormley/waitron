# Mutation nightly fix

Written by Codex. Claude plan review and watcher clearance are pending; implementation waits for both. Execute inline under RUNNER.md and `~/waitron-campaign-shared/ci-failure-rule.md`.

Request: `MUTATION-NIGHTLY-FIX` in `/Users/clintongormley/waitron-campaign-i/queue.md`. Deliver one PR restoring db's mutation dry run and addressing ui-core's shard imbalance, then verify a manual main run after landing.

## Evidence and approach

Driver receipts: `/Users/clintongormley/waitron-campaign-i/receipts/mutation-nightly-20261116/` and adjacent `mutation-nightly-20261116-failed.log` / `mutation-nightly-20261116-ui-core2.log`. `db-before.log` records exit 1 from the exact dry-run command below: walking up three directories from sandboxed `src/` produces `packages/db/packages/db/drizzle`.

Run 43808061319 has no recorded digest disagreement: `digest-mismatch: error` is the download action's policy input. db produces no reports; ui-core produces three of four because shard 2 hits its 25-minute limit at 641/678 mutants with 59 timeouts. Its dry run passes 983 tests. Increasing the byte-packed shard count to six still groups derive and colour together.

Reuse `CORE_MIGRATIONS.migrationsFolder` for the test's SQL root and existing cost-table support in `scripts/mutation-shard.mjs`. Prior full run 43559793352 supplies four reports in `receipts/mutation-nightly-20261116/ui-core-prior/`; candidate `ui-core-candidate-costs.json` separates derive, colour and contrast-rules across four shards. Generator coefficients were fitted to db: these are ranking estimates, not calibrated ui-core seconds or a promised runtime.

## Implementation and checks

- [ ] Before building, obtain Claude plan review with `~/workspace/tools/claude-seat.sh review-branch`; its brief quotes the queued request verbatim and asks whether this is the simplest requested result, what is extra, then whether it is correct and buildable. Address findings and obtain watcher clearance.
- [ ] Keep the existing failing classification test as the regression. In `packages/db/src/classification.test.ts`, replace the repository-root assumption with `migrationSqlFiles(CORE_MIGRATIONS.migrationsFolder, "")`; read returned paths relative to that same folder. Preserve every exact table, classification and append-only assertion. Change neither production schema nor shared reader API.
- [ ] Run `pnpm --filter @waitron/db exec vitest run src/classification.test.ts` and the reproduced command `pnpm --filter @waitron/db exec stryker run --dryRunOnly --mutate src/classification.ts --testFiles src/classification.test.ts --concurrency 1`. Require passing test counts and successful Stryker dry run; the driver's recorded failure supplies red evidence.
- [ ] First add a behavioral assertion in `scripts/mutation-shard.test.mjs`: actual ui-core selection occupies four nonempty shards, every selected file appears exactly once, and `src/theme/derive.ts` and `src/theme/colour.ts` occupy different shards. Run it without a cost table and observe the separation assertion fail. Preserve existing assertions and `HEAVY_FILES` shape.
- [ ] Generate `packages/ui-core/mutation-costs.json` using `node scripts/mutation-costs.mjs ui-core packages/ui-core/mutation-costs.json <four prior report paths>`, with unchanged coefficients. Run `pnpm exec vitest run scripts/mutation-costs.test.mjs scripts/mutation-shard.test.mjs`; require passing counts. Keep four shards, all targets, floors, timeouts and digest policy unchanged.
- [ ] Add the report provenance, regeneration command and model uncertainty to `docs/developers/ci-and-gates.md`. Reconcile only this repair in the existing CI backlog bundle/index, preserving unrelated entries. No CLAUDE.md, UI source or new framework changes.
- [ ] Run finish-branch with one Claude whole-branch review unless a genuine risk trigger emerges; address findings, retain normal hooks, sign off commits and await current-head CI. Land only under owner/runbook authorization via land-branch.
- [ ] After landing, run `gh workflow run mutation.yml --ref main -f packages=db,ui-core` and read its final shard and aggregate results before calling the nightly fixed. A timeout requires investigation, never a retry as the repair. At the CI-wait checkpoint, start cleared SERVER-TEST-LEVERS per H1a.

Expected size: production 0 lines; test about 15, configuration about 35, docs including this plan about 40; total about 90. Seek an outside opinion above 135 changed lines. Budget: at most three active hours, one PR.
