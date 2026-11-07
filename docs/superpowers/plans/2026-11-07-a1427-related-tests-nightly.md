# A1427 related tests and nightly coverage implementation plan

> **Execution:** Driver implements inline using `superpowers:executing-plans`. Read the TDD skill before code. No separate spec or execution-choice question.

**Goal:** Reduce PR and landing tests with Vitest selection; retain nightly full coverage and publish verified images.

**Approval:** Owner, 2026-11-07: “y, but high priority, just after getting CI to use hetzner at full scale”. Owner approved later inline implementation and explicitly authorised root `CLAUDE.md` updates at 18:25. **Do not build before D599 full-scale readiness, Claude’s `~/workspace/tools/claude-seat.sh review-branch` read and watcher read** (RUNNER scope check 6). Browser/heavy runner extension remains outside A1427.

**Architecture:** Keep pnpm’s package/dependent closure from `scripts/changed-packages.mjs`. Add Vitest-based test selection inside existing jobs. Use `ci.yml` for scheduled/manual full verification, retaining existing coverage merge jobs. No new dependencies, import graph, ledger, receipt system or approval protocol.

## Evidence and limits

Read against Waitron `fe36c187205d43d3d96a87455499f969d377664b`. Cloud’s D571 plan and PR938 at `ff1087b18819777b6c2d85aff15c695a7c59c4dd` concern package readers (`scripts/ci-package-revisions.mjs`, `ci-package-readers.mjs`), not Vitest related tests. Transfer conservative fallback and immutable inputs only.

Read-only `createVitest` / `getRelevantTestSpecifications` probes, installed Vitest 4.1.12, cache disabled:

- Shared `time-zone.ts`: four files selected; nonexistent input, unrelated Markdown and empty related array: zero; listing with `shard=1/2`: all 63 files.
- Server, filtered to `boot-failure.test.ts`: both shared `engine-failure.ts` and `time-zone.ts` select it. Barrel traversal is broad; this is not a savings measurement.
- Module `venue-service-slot.test.ts`: all/runtime source select one; type-only `module.ts` selects zero.
- `parseCLI`: `related … --run` sets an array and defaults `passWithNoTests=true`; `list --related …` parses a string. Use the API, not that listing spelling. Installed `cli-api.B0Pz1_R7.js:11551–11600` handles related discovery; `:3687` applies sharding later.

All proposed behavior below is **unverified** until its named implementation-time controls and hosted qualifications pass. Missing-file probes did not simulate deletion; browser discovery, dynamic imports and actual shard execution remain unverified.

## Tasks

For each code task: write the failing behavioral test, run it and check the intended failure, implement minimally, rerun green, then commit with `git commit -s`. Preserve application assertions.

- [ ] **1. Fix immutable ranges.** Modify `scripts/ci-diff-paths.sh`, `scripts/ci-main-recovery.test.mjs` and `ci.yml` changes. PR: fetch event base/head SHAs, compute their merge-base, diff that SHA to event head. Main: event head’s first parent to head; never last-push tips, moving refs or recent-run baselines. Require event/checkouts to agree. Transport NUL paths in required `ci-changed-paths` artifact, with `--no-renames`; names incompatible with the newline classifier, missing history, unusual topology or unreadable diff force full verification. Remove the global main override (`ci.yml:279`). Test force-push/rebase, multi-commit PR, parent/head landing, rename/deletion and failed/partial diff. Keep hook behavior.

- [ ] **2. Select and execute.** Add `scripts/ci-related-tests.mjs` and `.test.mjs`; integrate existing package jobs/light bins. Inputs: package directory, absolute changed paths, run mode, existing exclusions and shard index/count. Use each installed package config and Vitest API; preserve project identities. Existing manifests provide commands; retain fiscal custodian build and UI tarball consumer. Non-import inputs (migrations, fixtures/assets, manifests, lockfile, setup/config), deleted/renamed inputs, unsupported discovery or ambiguity run full affected packages/dependents. Shared config and `.github/` run all; root-script readers retain `ROOT_SCOPE_CONSUMERS`, unknown readers widen globally. Adapt CI classification without narrowing the hook.

  Probe disposable fixtures for cross-package runtime/type-only/static-dynamic imports, filesystem inputs, changed tests, browser/mixed projects, setup changes and transform failures. Zero related files falls back to full package; zero full inventory fails except existing `PACKAGES_WITHOUT_TESTS`. Cap active shards at selected unique-file count, use the configured sequencer (server duration packing), and report excess fixed matrix legs explicitly idle. Prove one-file/empty selections and exact project/shard union without duplicates or omissions; never use file-only listing as shard allocation.

- [ ] **3. Separate coverage modes.** In `ci.yml`, scoped PR/main runs execute related or fallback suites without coverage; skip coverage uploads/downloads/merges together. Retain full root coverage, lint, types, bundle checks, heavy/specialized checks, shared mutation, stream binaries/full-disk setup and diagnostics/deadlines. Image smoke runs for image inputs or full verification; `image-nightly.yml` remains smoke-only. Stream’s explicit file set stays full whenever server is selected. Preserve fixed-matrix disposable routing, queue watchdog and hosted retry gates without extending D599.

  Schedule full verification at 02:00 UTC in `ci.yml`; `workflow_dispatch` always verifies fully. Nightly/manual/release tags bypass narrowing and reuse, run every package at **98/98/98/95**, with existing seven coverage merges and exact artifact counts. Keep unique main-push runs. Disable workflow use of `scripts/ci-reuse.mjs`: its full-parent premise (`:145–204`) no longer describes landings; retain helper behavioral assertions. Remove reuse outputs/skip consumers/summary claims. Adapt both aggregate checks (`ci.yml:3858`): scoped merge skips are intentional, full-mode selected merge skips fail; missing jobs/artifacts or failures still fail. Exercise both modes and missing-artifact controls.

- [ ] **4. Publish only verified source.** Adapt `ci.yml:4062`, `scripts/main-tag-guard.sh` and tests. Ordinary main never publishes. Successful scheduled or manual full verification on main publishes the event’s pinned SHA; branch dispatch verifies without publishing. Preserve full `v*` verification and version/immutable publication without moving `:main`. Build both immutable images first; serialize stable-tag promotion, then reread the guard immediately before promoting pinned digests. Require candidate ancestry on current main; never checkout newer source. Behind holds; unknown/diverged source fails. Test overlapping older/newer publications, advancing main, failed full gate, cancellation and both image tags; qualify the race on hosted runs.

- [ ] **5. Update policy and qualify.** Change only authorised CI-policy groups in `scripts/ci-workflow.test.mjs`: concurrency/publication (:1074/:1123), aggregate (:1307/:1570), shards (:2298/:2818), scope/main/image gates (:2666/:2687/:2792), reuse (:2996), stream/report wiring (:3184) and artifacts (:4644/:4924), to enforce the modes above. Change `ci-main-recovery.test.mjs` recent-baseline expectations and `main-tag-guard.test.mjs` promotion/divergence; add nightly wiring to `coverage-thresholds.test.ts` without lowering assertions. Routing/fallback guarantees and application tests remain intact.

  Update authorised `CLAUDE.md` §2, `docs/developers/ci-and-gates.md`, affected current workflow-guide claims, and only A1427’s `docs/backlog.md` entry (add if absent; remove on completed qualification). Add dated pointers to superseded history. Run focused `pnpm exec vitest run` over changed CI guards/helpers, including `changed-packages`, `changed-scope`, `root-scope-consumers`, duration sequencer and coverage-download guards. Use normal pre-push hook. Driver finishes/reviews/lands; retain exact-head real related and fallback PR results, main parent/head run, disposable/hosted fallback and nightly/manual full coverage plus image results. Replay watcher’s 40-PR sample with Vitest, report actual counts/timings. Failed nightly follows `~/waitron-campaign-shared/ci-failure-rule.md`, then manual full main rerun. Announce readiness for `finish-branch`; do not declare A1427 complete before qualification.
