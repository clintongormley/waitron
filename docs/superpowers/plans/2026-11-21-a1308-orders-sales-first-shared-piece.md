# A1308 first shared piece — seed a bill venue without mounting till routes

Two server suites can exercise a provisioned bill venue without importing the till routes.
The watcher put this fixture split first on 23 November at 17:42 in Lane H's questions log,
followed by small moves that lanes C, E and L can rebase across. This revises the 21 November
plan, which paired the split with the first move that takes these two suites.
[Build order](2026-11-08-a1308-build-order.md#batch-2--area-slices)

## First pull request

On `1d21cbb08c`, extract the data setup to `apps/server/src/testing/bill-venue-seed.ts`.
Export `BillVenueSeed`, `BillVenueSeedOptions = { apply?: typeof applyVenue; identity?: SoftwareIdentity }`
and `seedBillVenue(db: Database, options?: BillVenueSeedOptions): Promise<BillVenueSeed>`.
Move the existing data fields, historical provisioning, published offers, fake reader pool and
three device sign-ins. Keep the current `correctiveSeriesCode` and #4088's
`setTipsForTest(db, true)` in the seed. The seed still uses server enrolment, session and menu
helpers. Keep `bill-venue`, `serve-line`, `cancel-line`, `order-writer-fixture` and
`grouped-counter-order` imports out of it.

Keep `provisionBillVenue` in `testing/bill-venue.ts`. Extend `BillVenueSeed` with the existing
`app`, `appAt` and `appWith` mounts and their options. Keep `appDatabases`, `send` and the
request-body helpers there. Use the seed's locale for the mounts. This is a fixture-only pull
request. Package ownership, production changes and the remaining server imports belong to later
plans. Expected size is zero production lines, +270/−230 test support and +20/−10 tests.

## Checks

In `order-preview.test.ts` and `working-order.customer-fallback.test.ts`, add a hoisted
`vi.mock("./till-api.js", …)` whose factory throws `Error("till must not load")`.
See both fail with that cause on the old fixture. Switch them to the seed and keep the guards,
`useVenueDb` setup and existing preview, pricing, fiscal and receipt assertions. The fixture's
HTTP callers keep their checks in `receipt-device-evidence.test.ts`,
`till-api.disk-full-gate.test.ts` and `bill-payments.card.test.ts`. The five files passed
80 tests on the base via `pnpm --filter @waitron/server exec vitest run src/<file> …`.

Run those five files, server `typecheck` and root `scripts/workspace-cycles.test.ts` again.
Run the unchanged queue gates in their packages. Fiscal runs `write-path.e2e.test.ts` and
`inmutabilidad.test.ts`, server runs `till-api.sell-published.test.ts` including Review Focus 1
and 2, and till runs `till-app-menu-refresh.test.ts`.

### Expected protection-list difference

Run `pnpm protection-list list` before and after from `apps/server` and compare. Expect `EQUAL`
for both compositions, all phases and both databases. [Slice rules](2026-11-08-a1308-slice-rules.md#3-the-protection-list-predicted-then-checked)

## Proposed pull requests after the fixture split

The current scan counts 105 production candidates (38,804 lines), 148 suites (136,846 lines) and
five helpers (1,445 lines). Direct relative imports reach 182 outside modules, 89 from production.
Of the selected suites, 67 import the bill fixture. The scan flags 44 suite candidates by
following imports through test helpers. Each still needs its full dependencies checked.
[CI assessment and sizing method](2026-11-22-a1308-orders-sales-ci-assessment.md)

| Candidate PR | Size to check when planning |
| --- | --- |
| First independent package and CI wiring with `receipt-dates`, `receipt-logo`, `receipt-money` and `receipt-table` | Four sources (311 moved lines) and four suites (587 moved lines), plus package and CI wiring |
| Orders error declarations | One source (2,148 lines), with 61 production and 36 test importers |
| Trading context and till boundary | Six sources, with 44 production and 31 test importers |
| Floor and kitchen boundary | Seven sources, with 18 production and 33 test importers |
| Device and document boundary | Five sources, with 12 production and 18 test importers |
| Card and refund boundary | Four sources, with six production and three test importers |

The last five rows size the current contact points, with each actual edit sized separately
before clearance. Split further where a change would exceed three hours. In the first move,
qualify assets and source guards, root shard wiring, package-only and server-only CI selection,
and independent `98/98/98/95` coverage. Keep boot, till mounts and their integration tests in
the server. [Earlier boundary decisions](2026-11-17-a1308-orders-sales-package-move.md)
