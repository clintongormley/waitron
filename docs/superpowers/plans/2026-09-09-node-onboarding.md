# Implement node onboarding

Date: 2026-09-09. [Design](../specs/2026-09-09-node-onboarding-design.md).
Execution model: Sol at high effort, per owner instruction. Planning does not authorize sending
fiscal samples, live payments or email to outside recipients during this session.

Deliver the whole four-choice flow in bounded slices. Use failing tests first for each feature or
bugfix, observe the expected failure, then implement. The file map below comes from source reads;
it is not a claim that these paths have been executed in this planning session.

## Existing paths to reuse

| Area | Entry points | Work to establish |
| --- | --- | --- |
| Chooser/API | `apps/setup/src/setup-app.ts`, `screens/mode-screen.ts`, `api/client.ts`; `apps/server/src/setup-api.ts` | Current request accepts demo/live; add intent, progress and resumable operations. |
| Provisioning | `apps/server/src/provision.ts`; `packages/provisioning/src/venue-apply.ts` | Fresh production database, transactional configuration import, restart-safe completion. |
| Module boundaries | `packages/module/src/module.ts`; `packages/fiscal/src/contribution.ts`; `packages/composition` | Configuration transfer contribution and regime-owned fiscal checks. |
| Demo/dev | `apps/server/scripts/dev-setup.ts`, `dev-onboard.ts`, `demo-seed/`; root scripts | Reusable installed demo seed, two managed targets and complete bootstrap role shape. |
| Payment/email | `apps/server/src/boot.ts:291`, `stripe-account.ts`, `account-email.ts` | Trace provider construction and credential gates; SMTP currently branches on devMode at `boot.ts:1651`. |
| Certificates | `apps/server/src/box-secrets.ts`, `box-env.ts`; `~/workspace/tools/wa-wt` | Persistent dev trust with fresh onboarding state; coordinate launcher change in its owning repository. |
| Recovery | `apps/server/src/adopt.ts`, `finish-adoption.ts`, `restore.ts`, `restore-command.ts` | UI adapters and progress over existing membership/restore behavior. |
| Packaging | `deploy/compose.yml`, `deploy/prepare.sh`, `deploy/Dockerfile`, `docker-compose.yml` | Installed Mailpit, suitable connection/inbox addresses, bootstrap and test-database lifecycle. |

## 1. Establish mode and operation boundaries

Trace every consumer of `mode`, `devMode`, `WAITRON_ENV`, deployment stamps, credential environment
checks and fiscal drains, including README/runbook descriptions. Document the exact field map in
the implementation commit. Keep fiscal environment values unchanged.

Introduce persisted onboarding intent and operation progress with explicit activation state.
Choose storage within the existing provisioning/platform ownership; if a new core table is needed,
state why in the commit and classify it. Provision/adopt/restore/import must share mutual exclusion
that survives process restart. Validate transitions on the server and recover after committed steps
without minting a second node, installation or invoice series. No live routes before activation.

First tests: Demo and Prepare cannot submit or use live credentials even when supplied; public Demo
does not enable developer identity overrides; production cannot use test providers. Concurrent setup
requests and restart after database commit must not double-provision. Use real PostgreSQL for
concurrency and deployment-role checks, with fault injection between database and file writes.

## 2. Make both development targets reproducible

Build on dev-setup/dev-onboard and extract shared bootstrap steps. Run schema creation as migrator
with the existing replication bootstrap; do not copy dev-onboard's direct migration assumptions
without exercising the resulting ownership/publications. Give each target its own application
state and environment identity while retaining the shared development CA separately.

Extend `wa-wt` and its tests in its owning tools repository to choose/reset demo or onboarding.
Keep `COMPOSE_PROJECT_NAME=waitron`; prohibit implicit copying of a trading environment into setup.
Do not reset the owner's shared development stack to validate this work without coordinating its
use. First run launcher tests against its isolated fixtures and boot integration tests in disposable
containers. Later perform the managed live smoke when the shared stack is available.

First tests: two database resets preserve the CA fingerprint but remove old trading/enrolment state;
demo reaches a seeded till; onboarding reaches the actual chooser; switching targets does not create
a second compose database service. A dev Go live walkthrough cannot contact real external services.

## 3. Deliver Demo and Prepare end to end

Extract a runtime-safe demo seed from scripts, removing developer test-fixture dependencies from
the installed path. Retain the existing seed's behavioral assertions. Demo and dev demo share
content generation; developer-only shortcuts remain separate. Prepare creates essential structure
and administrator credentials without sample menu/staff/sales.

Add a payment simulator behind the payment-provider contract and explicit provider test setup.
Reuse existing wrong-environment credential refusal. Add SMTP precedence, packaged Mailpit and an
authenticated inbox link with a browser-reachable address. Persist mode indicators and simulated
receipt wording across restart. Update setup forms and supported locales to the shared UI contract.

First tests: installed Demo seed completes once across a retry; Prepare has no sample records;
simulated success/decline traverse the real order/payment state handling without external charges;
test credentials cannot activate live payments. Mailpit receives a recovery message and the box's
authenticated inbox route opens it; configured SMTP wins and unauthenticated inbox access fails.
Boot the packaged application to verify the seed and Mailpit are actually present.

## 4. Define and implement configuration transfer

Inventory all current module tables, exported fields, foreign keys and media references. Commit a
compact transfer matrix with the implementation. Do not derive copying from replication `state`:
account-action tokens are one concrete counterexample. Add module contributions in dependency order;
every module explicitly supports transfer or declares no configuration, and unsupported content
fails before production provisioning. Keep the descriptor list in composition.

Implement authenticated export to an encrypted, versioned archive and setup upload/preview. Validate
schema/module versions, size limits, archive paths, media digests, field allowlists and references.
Export a consistent database snapshot and matching immutable media. Allocate an ID map and import
under the venue transaction; use the operation state from slice 1 to resume file/secret publication.
Create the production administrator's credentials and activation tasks for imported staff. Import
hardware definitions with explicit reconnect status rather than carrying device/provider tokens.

First tests: populate the source with configuration AND sales, refunds, fiscal history, open orders,
bookings, clock records, account tokens and secrets. Import into a fresh production target; compare
the expected configuration and assert excluded records/fields are absent, references resolve and
production identity/series are fresh. Perform a first target sale and check numbering/chain start.
Verify source remains unchanged, cross-tenant export is refused, corrupted/unsupported archives
write nothing, and an injected import failure rolls back the venue. Prove the exclusion guard by
temporarily attempting to export a forbidden token and observing the expected test failure.

## 5. Add fiscal readiness and Go live activation

Extend the fiscal contribution with test/readiness capabilities; the no-filing regime returns not
applicable. Add a separate, retained preproduction test database using a provisioner with explicit
role ownership. Test with intended fiscal identity and certificate through the real fiscal backend
and submission adapter; never loosen the normal preparation drain or production environment checks.

Persist evidence server-side and bind it to the target operation and relevant inputs. Require accepted
record status, handle rejection/uncertain timeout with bounded retry and preserve record identity on
retry. The preparation export cannot manufacture accepted evidence. Add supported non-filing
production checks and accurately label their limits. Initial activation checks credentials and
readiness; existing trading, adoption and cold restore do not depend on sandbox availability.

First tests: accepted, rejected and uncertain responses; changed identity/cert/config/version;
forged evidence; restart; no-filing regime; empty-production flow; zero production test records and
zero unsolicited draining of practice history. An external outage after activation must not block
a sale. Existing `apps/server/src/aeat.preprod.test.ts` exercises a query, not accepted submission:
retain that distinction. Use transport fakes by default; record a separately authorized, bounded
real AEAT test before claiming acceptance against its service.

## 6. Finish mirror and restore onboarding

Mount the **Join or recover** subchooser and complete forms around adoption and cold restore.
Retain existing environment checks, membership rules, failed-primary isolation and module restore
hooks. Show recovery material before restart and require acknowledgement of its receipt. Add
bounded artifact upload/staging, validated restore preview, progress, failure recovery and cleanup.
Keep secrets out of logs and browser storage. Never use restore for preparation-to-production copy.

First tests: mirror inherits environment and refuses sales before promotion; backup restores through
the real orchestrator with fresh-target and environment refusal; interrupted restore never exposes
partially published identity. Exercise fiscal restore behavior with the existing real-PG suite.
Verify UI flows after reload and during restart, including errors and keyboard/accessibility checks.

## 7. Validate the complete installed journey and update receipts

Run focused checks during each slice, then each touched package's unfiltered `typecheck` and
`test:coverage`. Cross-module contract/schema lists also need the relevant root guards. Run the
whole repository gate once near branch completion:

```sh
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

Before heavy tests inspect memory pressure and competing processes; run browser packages on the
host with measured headroom. Use `TESTCONTAINERS_RYUK_DISABLED=true` locally and retain logs/live
database evidence for stalls. Exercise the installed image on disposable resources through all
choices, including a prepared export containing practice sales, a fresh production first sale with
fake external transports, an added mirror and a restored backup. Report simulated and real-service
checks separately. Verify production activation cannot be reached by a browser-only mode
change or imported readiness assertion.

Audit prose across the complete changed path set, including `.github/instructions`, README/runbooks,

> **2026-09-12:** `.github/instructions/waitron.instructions.md` was deleted (nothing read it after
> Copilot's review was switched off on 2026-09-06). Its rules now live in
> `docs/developers/conventions-ui.md`, `conventions-data.md` and `testing-guide.md`; sweep those
> instead. The original is still readable with
> `git show f5941462:.github/instructions/waitron.instructions.md`.

backlog and historical pointers. Record the Prepare compliance question before release; do not call
the feature legally cleared on the strength of tests. Update the backlog with completed slices and
remaining release evidence. Announce readiness for `finish-branch`; do not merge without the owner's
`land-branch` instruction.
