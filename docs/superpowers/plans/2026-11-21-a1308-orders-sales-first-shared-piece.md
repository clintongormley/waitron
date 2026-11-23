# A1308 first shared piece — seed a bill venue without mounting till routes

The fixture split would let two server suites use a provisioned bill venue without importing till routes.
The watcher asked Lane H to recheck the split on 23 November at 17:42 in its questions log.
Claude recommends keeping the 21 November sequence for the fixture itself. Build the seed
with the first package suite that uses it, once the seed can go straight to its package home.
Start the package with independent receipt helpers. The watcher still has to clear this order.
[Build order](2026-11-08-a1308-build-order.md#batch-2--area-slices)

## Bill fixture when a package suite needs it

The split below was rechecked on `1d21cbb08c`. Settle its package home and server-only
imports in the plan for the first moved suite. Export `BillVenueSeed`, `BillVenueSeedOptions = { apply?: typeof applyVenue; identity?: SoftwareIdentity }`
and `seedBillVenue(db: Database, options?: BillVenueSeedOptions): Promise<BillVenueSeed>`.
Keep the fixture's `db`, `backend`, `clock`, `cfg`, `seriesId`, `card`, `pool`, cookies, device
and person IDs, `offerFor` and `zoneId`. Keep the adjustments permission registration before
provisioning, the historical plan and `correctiveSeriesCode`, published offers, fake reader pool,
three device sign-ins and #4088's `setTipsForTest(db, true)`. Today the seed would still use server
enrolment, session and menu helpers. Keep `bill-venue`, `serve-line`, `cancel-line`, `order-writer-fixture` and
`grouped-counter-order` imports out of it.

Keep `provisionBillVenue` in `testing/bill-venue.ts`. Extend `BillVenueSeed` with the existing
`app`, `appAt` and `appWith` mounts and their options. Keep `appDatabases`, `send` and the
request-body helpers there. Use `cfg.locale` for the mounts. The extraction alone is about
+270/−230 support and +20/−10 test lines. Add the move and import changes to that budget when
planning the PR.

## Checks

In `order-preview.test.ts` and `working-order.customer-fallback.test.ts`, add a hoisted
`vi.mock("./till-api.js", …)` whose factory throws `Error("till must not load")`.
See both fail with that cause on the old fixture. Switch to the seed and keep the `useVenueDb`
setup and existing preview, pricing, fiscal and receipt assertions. Keep each guard until its
suite leaves the server, when the independent package run takes over. Keep the HTTP checks in
`receipt-device-evidence.test.ts`,
`till-api.disk-full-gate.test.ts` and `bill-payments.card.test.ts`. The five files passed
80 tests on the base via `pnpm --filter @waitron/server exec vitest run src/<file> …`.

Run those five focused files, server `typecheck` and root `scripts/workspace-cycles.test.ts`.
PR CI must run the selected server suites for the fixture's other callers. Run the unchanged
queue gates in their packages. Fiscal runs `write-path.e2e.test.ts` and
`inmutabilidad.test.ts`, server runs `till-api.sell-published.test.ts` including Review Focus 1
and 2, and till runs `till-app-menu-refresh.test.ts`.

### Expected protection-list difference

From `apps/server`, run `pnpm protection-list list --out <absolute-dir>` before and after.
Run `pnpm protection-list compare --old <before> --new <after> --report <absolute-file>`.
Expect `EQUAL` for both compositions, all phases and both databases. [Slice rules](2026-11-08-a1308-slice-rules.md#3-the-protection-list-predicted-then-checked)

## Proposed pull requests

The current scan counts 105 production candidates (38,804 lines), 148 suites (136,846 lines) and
five helpers (1,445 lines). Direct relative imports reach 182 outside modules, 89 from production.
Of the selected suites, 67 import the bill fixture. The scan flags 44 suite candidates by
following imports through test helpers. Each still needs its full dependencies checked.
[CI assessment and sizing method](2026-11-22-a1308-orders-sales-ci-assessment.md)

| Candidate PR | Size to check when planning |
| --- | --- |
| First independent package and CI wiring with `receipt-dates`, `receipt-logo`, `receipt-money` and `receipt-table` | Four sources (311 moved lines) and four suites (587 moved lines), plus package and CI wiring |
| Orders error declarations through the existing server registry entry | One source (2,148 lines), with 61 production and 36 test importers to leave in place |
| Trading context and till boundary | Six sources, with 44 production and 31 test importers |
| Floor and kitchen boundary | Seven sources, with 18 production and 33 test importers |
| Device and document boundary | Five sources, with 12 production and 18 test importers |
| Card and refund boundary | Four sources, with six production and three test importers |
| Move order preview with the bill seed once its dependencies are available | 56 preview source and 151 suite lines, plus the fixture budget above. Both suites also need the 9,836-line working-order module. Customer fallback adds a 327-line suite and needs the 636-line till-sale module. |

The boundary rows give current footprint. Each needs an exact plan and line budget before build.
Split where a change would exceed three hours. For the first move, qualify assets and source
guards, root shard wiring, package-only and server-only selection, and independent
`98/98/98/95` coverage. Keep boot, till mounts and their integration tests in the server.
[Earlier boundary decisions](2026-11-17-a1308-orders-sales-package-move.md)
