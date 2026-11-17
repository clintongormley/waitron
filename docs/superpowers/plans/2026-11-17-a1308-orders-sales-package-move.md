# A1308 orders and sales package move: decision draft

**Authority and state:** watcher request, Lane H questions.md, 2026-11-17 17:58. Written by a separate Sol-high invocation and checked by the driver; Claude review and watcher clearance remain. No owner approval of this design is claimed. **Base:** `d47b99294b` (os1 #3670).

**Finish line:** before os2, the files named in [os1’s Area files](2026-11-08-a1308-os1-order-numbers.md#area-files-for-the-package-move) and their tests live in one `@waitron/orders-sales` package; the server composes its exports and CI selects its tests independently. Reuse functions, signatures, assertions, Hono mounts, `useVenueDb`, error declarations and the duration sequencer. Change no behaviour, table, fiscal writer or transaction boundary. Add no module descriptor, registry or framework. [Build order, Batch 2](2026-11-08-a1308-build-order.md#batch-2--area-slices) supplies the request; its ~860 seconds per PR is a November 8 model, not a measured saving from this move. [Slice rules](2026-11-08-a1308-slice-rules.md) apply.

## Decision needed before build

A file move and import rewrite leaves these dependencies crossing back into the app. Putting `@waitron/server` in the new package’s dependencies, including test dependencies, creates a workspace cycle; relative imports into the app conceal that same dependency.

| Source at this base | Boundary to settle |
| --- | --- |
| `bill-payments-api.ts:22–28` reads runtime helpers and types from `till-api.ts`, which imports its mount at `:213`. | Relocate the existing parsers, collector and dependency types into shared support; retain HTTP composition at the host. |
| `working-order.ts:142–154` uses party functions; `parties.ts:39–47` calls order creation, payments and drafts back. `kitchen-print.ts:62–79` also reads area functions. | Name which existing floor/kitchen functions become shared. Moving whole parties/kitchen files expands os1’s explicitly excluded list. |
| `testing/order-venue.ts` uses `bill-venue`, which mounts the full till (`testing/bill-venue.ts:49`); `bill-payments-loop.test.ts:29` imports boot. | Keep full-host cases at the host or split their fixtures without replacing real mounts with fakes. This requires an exception to moving every named suite. |

Other support includes session/admission checks, `TradingContext`, errors, report helpers and shared PDF/font utilities. Trace those consumers before choosing shared homes; `server-kit` must not become a container for server composition. **Recommendation:** clear separately scoped support/boundary prerequisites, then the mechanical move. This draft does not yet specify those cuts well enough to build them. Ask the watcher to settle the expanded scope or defer the move; do not start os2 across this unanswered boundary.

## Files and size

Move os1’s four production groups to `packages/orders-sales/src/`, retaining basenames, and its six helpers under `src/testing/`. Tests match the listed globs or `<production-stem>.*.test.ts`. Keep the historical 27 boot and 22 till-api unassigned suites, and current host composition suites, in `apps/server`; those old counts are not today’s inventory. `draft-recall.ts`/`draft-source.ts` were retired in `a9e8f379b7`; do not recreate them. Seven related hyphenated/delivery suites outside these matches remain at the host with imports ported.

| Relocation at the base, before boundary exceptions | Files | Lines added / removed |
| --- | ---: | ---: |
| Production | 103 | +38,528 / −38,528 |
| Tests | 141 | +131,095 / −131,095 |
| Test support | 6 | +1,558 / −1,558 |

Counts come from expanding os1’s globs against `apps/server/src` and counting file lines; repeat before build. Estimated additional handwritten edits: production support 800–1,300 lines, tests/support 400–700, tooling/configuration/guards 600–1,000, plus mechanical import edits. These are gross changed-line estimates, not completed diffs. Generated lockfile importer changes are separate (roughly 100–250 lines); fonts/goldens are separate binary relocations. Estimated total 6–10 hours plus review/CI: **not one three-hour slice**. Each prerequisite needs its own concrete files, size and checks before clearance.

## Execution once the cuts are cleared

- [ ] Capture base protection lists and focused checks; preserve every behavioural assertion. Commit an idempotent `scripts/a1308/move-orders-sales.mjs` map, including incoming imports, mocks and source-path consumers; list handwritten edits separately.
- [ ] Add `packages/orders-sales/{package.json,tsconfig.json,vitest.config.ts,test-durations.json}` with explicit per-file exports; port `apps/server/package.json`, duration keys and lockfile. Reuse exact existing dependency ranges. Carry producer env, timeouts, byte-equality/derived-key-cache/tab-person setup and real venue fixtures into their cleared shared homes. Keep coverage `98/98/98/95`; exclude no reachable production code.
- [ ] Port font/golden readers, `apps/server/scripts/copy-migrations.mjs`, deployment source checks, `order-groups.test.ts`’s till URL and the host’s zone-process child’s imports/file-root pairs. Preserve shipped `/app/assets`, subprocess working directories and assertions.
- [ ] Wire `scripts/changed-scope.mjs`, `.github/workflows/ci.yml` and root-consumer/shard lists; transfer duration keys and use existing shard/merge conventions. Port source guards’ path entries: write-path, alerts, correctives, menu neutrality, English vocabulary, PostgreSQL residue and module seams. Preserve personal-log, errors, transaction and subscription enforcement. Update active move/backlog pointers; leave later os slices open. Historical plans get dated pointers.

**Checks by layer:** area suites retain ordering/draft/payment/refund/receipt assertions (`working-order`, `order-drafts.db`, `order-groups`, `bill-payments-api`, `bill-payments-loop`, `tender-refunds`, `receipt-document`, `receipt-ticket`, `invoice-raster-encode`, `orders-list.reads`). Host suites retain permission/person checks, clock refusal, real zone subprocesses and boot lifecycle (`till-api.profile-{actions,zones}`, `till-api.session-person`, `clock-unconfirmed-gate`, `zone-process-matrix*`, `till-sale-integrated*`, `boot.restricted-quiet`). Run touched root guards for cycles, scope/CI/coverage, source paths and deployment; typecheck all affected packages. Run the queue’s unchanged fiscal write-path/inmutabilidad, server sell-published and till menu-refresh gates. Use focused `pnpm --filter <owner> exec vitest run <files>` with nonzero Tests counts, never a whole local server suite solely to finish.

**Expected protection-list difference:** none in either composition, all three phases and both databases; compare base/branch lists from `apps/server` and stop on any difference. `Sale-path read changed: no; relocation/imports only`. Implementation gets two Claude run-it reads for its package contract, one fixes read, the normal push hook and current-head CI selecting both packages; full-run coverage keeps the same thresholds. No implementation validation is claimed by this document.

**Next areas copy:** the proven move/import map, explicit exports, shared-helper ownership, preserved test setup and paths, duration transfer, CI selection and source-guard ports. They do not copy an unresolved boundary or claim the modelled saving as measured.
