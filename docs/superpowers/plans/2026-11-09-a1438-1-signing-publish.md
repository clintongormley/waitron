# A1438-1: shared signing formats and private publication

**2026-11-10 status:** A1437-1's initial proof check landed as `049ddd9`; this plan's build condition is met. The watcher
cleared the as-built core and box use at about 1,550 changed lines, with a stop at 2,325, followed
by the publisher at about 500, with a stop at 750 (Lane K questions.md, 12:48).
The core is in PR #2743; the separate publisher implements the fixed matrix and authenticated
checks. Watcher 2026-11-09 23:28 moved credential execution into the final workflow step and
Cloud’s own-token install immediately after the first publication. Actual registry qualification
remains open until those operations run; local checks are not registry evidence.
The forecast and waiting state below are the original planning record.

**Authority:** Implements [parent §§3a,4,6a,6e](2026-11-09-a1438-code-shared-with-cloud.md). Watcher22:04 approved signing-first, private publication, one fixed matrix and no peers now. Owner22:22 asks to reuse UI's setup; this bounded amendment needs no new Claude plan read. The driver submits the revised forecast below before building. **Build waits for A1437-1 to land.**

**Build:** `@waitron/contract`, privately published as `@waitron-io/contract`, owns the existing `waitron-cloud-{pair,machine,access}-v1` formats. Preserve bytes, signatures, caps and clock rules; changed formats need a new name accepted by Cloud first. Leave Cloud edits/adoption, sign-in, messages, extra protocols, storage, roles, routes and keys out. No runtime or Waitron dependencies and no peers now; sign-in adds its peers when needed. UI keeps its Lit policy.

**Paths.** P=`packages/contract`, S=`apps/server/src`, R=`scripts/release`.

| Create or change | Responsibility |
| --- | --- |
| (a) New P/`src/index.ts`, P/`src/signing/{pairing-proof,installation-proof,access-lease}.ts` and matching `.test.ts` | Extract builders/checker/issuer contracts; port signing assertions into Vitest. |
| (b) New P/`{package.json,tsconfig.build.json}` | Source exports internally, Node ESM/types externally; plain TypeScript emit, package-script dist cleanup and LICENSE/LICENSE-GRANTS copy, `prepack`/`test:package`. Without this, archives expose source, stale output or missing types/notices. No bespoke build script. |
| (c) New P/`{tsconfig.json,vitest.config.ts}` | Package checks and coverage `98/98/98/95`, include `src/**/*.ts`; without these, package coverage discovery fails. |
| Keep `apps/server/test/{cloud-pairing-vector,cloud-installation-vector,billing-display-vector}.json` and their readers unchanged | They pin server adapters/application bodies. Package tests use independent literal format assertions. The parent’s three identical files are JSON fixtures; Lane K’s `vectors.json` receipt records direct byte equality with Cloud. |
| (a) `apps/server/package.json`, S/`{cloud-client,cloud-installation,cloud-backup}.ts`, S/`cloud-backup.test.ts` | Shared builders; retain `machinePayload` as the saved-state adapter for billing/translation. Replace backup’s hand-built array; preserve error codes/lifecycle assertions. |
| (b) `.github/workflows/publish-ui.yml`, R/`publish-ui-workflow.test.mjs` | Parameterise existing steps/fixtures for fixed UI+contract matrix; without this, contract never publishes through UI's checks. |
| (b) R/`prepare-ui{.mjs,.test.mjs}` | Optional `--package contract`, UI default; package-specific names/paths/README/peer policy, same preparation. Without it, contract is rejected or stamped as UI. |
| (b) `packages/ui-core/test/package-consumer.test.mjs`; new P/`test/{package-consumer.test.mjs,consumer/main.ts,consumer/tsconfig.json}` | Parameterise/export UI's existing tarball/check/install/types routine; P gets a tiny entry and Node fixture, not another harness. Without the Node check, browser execution misses Node signing/import failures. |
| (c) `eslint.config.js` | Reuse sibling-import boundary pattern; without it, relative imports evade the dependency-free manifest. |
| (c) `scripts/changed-scope{.mjs,.test.mjs}`, `.github/workflows/ci.yml`, `scripts/ci-workflow.test.mjs` | Light-A membership/light-B exclusion, preparation consumers UI+contract, contract membership output and conditional `test:package` in light A; without these, allocation duplicates/skips work or PRs miss installed-artifact checks. |
| (c) `packages/db/src/english-only.ts`, `scripts/english-only.test.ts` | Add both generic-package list entries; without them, the vocabulary guard never scans contract. |
| (d) P/README.md, `docs/developers/{shared-ui-preparation,ci-and-gates}.md`, this plan, `docs/backlog.md`, `pnpm-lock.yaml` | Checked publication state, remaining sign-in/messages work and generated dependency changes. |

**Reuse receipts:** R/`prepare-ui.mjs:55` qualifies metadata; `:161` invokes build/pack. UI's consumer `:89` checks archives, `:166` installs outside the workspace, `:187` checks types, `:194` selects browser bundling and `:223` launches Chromium; its `test/consumer/main.ts:44` uses the DOM. Parameterise/export `verifyPackage`; P's tiny entry supplies package name/preparation-script URL. Only the fixture needs NodeNext type checking/direct Node execution of three-format literal bytes and signature acceptance/refusal. Node types are test tooling, not a peer; browser tools/cases stay UI-only. **Plain TypeScript emit and shared-check feasibility remain unverified until executed.** Dynamic coverage/consumer/cycle guards need runs, not new lists.

**Interfaces and trust:** retain `pairingPayload`, `verifyPairingProof`, `encodeMachine`, `readMachineClaims`, `verifyMachine`, `createLeaseIssuer`, `verifyLease` and current types/action allowlist. Keep the box’s `readLease` and pinned-HTTPS origin/installation/venue/environment/key/`control` binding in S; no new structural-reader export. `verifyLease` uses caller-supplied trusted keys. `encodeMachine` only encodes on the adapter path, preserving its present arbitrary action string and absent-id representation. Operator trust configuration and business errors stay outside.

**Implement and verify — failing check first, minimal implementation, passing check, `git commit -s` per task:**

1. **Formats own validation.** Missing-export failure first; literal payload/signature assertions after extraction, preserving Cloud’s signed-field, action/origin/key, malformed encoding and identity cases. Pin ±60,000 ms acceptance/60,001 refusal, expired/future leases and 3,600,000 ms lifetime. Preserve distinct caps: pairing payload4096/key128/signature86; verifier payload12000/signature86→64bytes, strings4096/origin256/issuer-key256; box reader keeps its existing server checks. Delete signature verification and one cap in a disposable copy: intended assertions fail; restore/pass. Run P’s three named signing test files.
2. **Callers own transport and answers.** Add a literal backup payload assertion, green before and after the extraction; do not invent a structural red state for a refactor. Retain outgoing bytes, response binding, saved-state errors and backup outcomes; no builder spies or repeated format tables. Run S/`{cloud-client,cloud-installation,cloud-backup,cloud-billing,cloud-translation,cloud-tunnel-provision,translation-cloud-fixture}.test.ts`. Fail then fix contract’s light-A selection. Deleting light-B exclusion must fail exactly-once allocation; lint must reject alias/relative sibling imports and permit same-package imports.
3. **Publisher owns packaging.** Fail/fix contract manifest/empty-peer cases while retaining UI's Lit assertion. Keep source version `0.1.0`, published `0.2.<run number>`, contract `sideEffects:false`. Retain cleanliness/SHA/notices/exports/archive-contents/integrity/environment checks; reject runtime/optional/bundled dependencies and any contract peer. Fixed UI/contract matrix triggered by either package directory always publishes both, as approved22:04; no selector/history/new root or lockfile triggers. Pass matrix values through environment variables to parameterised existing shell fixtures. Preserve checks before upload, uncancelled publication, UI-only Chromium and upload-only secret. Shared consumer checks exact tarball, declarations/fixture/notices/provenance and dependency/peer absence using `CONTRACT_PACKAGE_{TARBALL,RELEASE_VERSION,SOURCE_COMMIT}`. Run from clean committed candidate; stubbed upload must propagate failures/restrict access.

**Commands:** `pnpm --filter <package> exec vitest run <named files above>`; root `pnpm exec vitest run` with R/`{prepare-ui,publish-ui-workflow}.test.mjs`, `scripts/{changed-scope,changed-packages,ci-workflow,root-scope-consumers}.test.mjs` and `scripts/{coverage-thresholds,english-only,workspace-cycles}.test.ts`. Run changed release fixtures under `GIT_DIR` with cleared git environment. Contract types/lint and both packages’ `test:package`; publisher retains coverage. CI owns whole package suites. Normal hook, FULL finish-branch (both Codex angles/Claude run-it), current-head CI.

## WATCHER-NEEDED

Submit this replacement for the earlier unsplit **1,240-line estimate** before building. Forecasts include moved lines on both sides, all tests/helpers/configuration and generated changes, mapped to the path categories above; they are not measurements.

| Owner's category | Added | Removed | Changed |
| --- | ---: | ---: | ---: |
| (a) Signing moved into P plus callers/assertions | 560 | 110 | 670 |
| (b) Publishing, shared consumer/fixture and release tests | 170 | 90 | 260 |
| (c) CI/lint/guard wiring and assertions | 65 | 10 | 75 |
| (d) Docs/lockfile | 65 | 10 | 75 |
| **Total** | **860** | **220** | **1,080** |

Remove the bespoke build script/independent consumer harness; reuse UI's publisher, preparation, archive/install/type checks. Publishing+wiring forecasts 335 changed lines versus 670 for signing/callers; total 160 below the earlier estimate. Allocation receipts: `scripts/changed-scope.mjs:294`, `.github/workflows/ci.yml:3639`, `scripts/ci-workflow.test.mjs:3450`; reuse the package-check pattern at `.github/workflows/ci.yml:1856` in light A. No further product decision is proposed; watcher22:45 approved this forecast. If qualification needs more machinery, report its failed check/revised split before expanding scope; watcher22:45 approves this split with a new stop at 1,300.

**Finish:** boxes use unchanged shared formats and the private publication route works. Before merge, the driver checks the existing UI publishing token’s new-package rights and Cloud’s existing read credential through an actual registry API/permission check; a dry run that never authenticates is not evidence. Report results to the watcher; a failed qualification goes to the owner. After authorised merge, the driver records release/SHA/integrity/private association and installs that version independently with that credential; otherwise the item remains open. Network publication/permissions stay unverified until executed; local tarball/stub passes alone do not finish the item.
