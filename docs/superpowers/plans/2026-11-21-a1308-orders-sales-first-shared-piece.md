# A1308 orders and sales — PR order and first shared piece

Move four receipt helpers and their suites to `@waitron/orders-sales` first. CI can then select
the package on its own. Keep forwarding re-exports at the four server paths so themes, alerts,
sales reports, drawer tickets, boot and other callers keep their imports. Run the moved suites
with package coverage and check both package-only and server-only CI selection. Preserve the
server's focused receipt and logo checks. The watcher cleared this order at 19:07 on 23 November
after Claude's plan read. At 19:20 the watcher cleared keeping `previewLogoAddress` and
`drawLibraryLogo` in the server, where the receipt preview and themes routes exercise them.
Move the logo cache, raster and preview drawing with the other helpers.
[Build order](2026-11-08-a1308-build-order.md#batch-2--area-slices)

## Parked bill fixture design

Redo this design in the plan for the first moved suite that will use it. Give the seed its final
package home in that PR.

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

### Checks for the future bill fixture split

In `order-preview.test.ts` and `working-order.customer-fallback.test.ts`, add a hoisted
`vi.mock("./till-api.js", …)` whose factory throws `Error("till must not load")`.
See both fail with that cause on the old fixture. Switch to the seed and keep the `useVenueDb`
setup and existing preview, pricing, fiscal and receipt assertions. Keep each guard until its
suite leaves the server, when the independent package run takes over. Keep the HTTP checks in
`receipt-device-evidence.test.ts`,
`till-api.disk-full-gate.test.ts` and `bill-payments.card.test.ts`. The five files passed
80 tests on the base via `pnpm --filter @waitron/server exec vitest run src/<file> …`.

Run those five focused files, server `typecheck` and root `scripts/workspace-cycles.test.ts`.
PR CI must run the selected server suites for the fixture's other callers.

## Checks for every slice

Lane H's queue requires the unchanged fiscal and menu gates for each slice. Run `write-path.e2e.test.ts`,
`inmutabilidad.test.ts`, `till-api.sell-published.test.ts` (Review Focus 1 and 2) and
`till-app-menu-refresh.test.ts` in their packages to satisfy that rule.

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

| Candidate PR | Added and removed lines |
| --- | --- |
| Independent package and CI wiring with `receipt-dates`, `receipt-logo`, `receipt-money` and `receipt-table` | Relocate +311/−311 production and +587/−587 test lines. About 28 other files import these helpers and keep their server paths. Allow about +250/−50 for package setup, CI wiring and forwarding exports. Count generated changes separately. |
| Orders error declarations | Size after listing the order and sale codes with their referenced parameter types in the 2,148-line registry. Move only orders codes. Keep `apps/server/src/errors.ts` at its current path and have it pull in the package codes. Callers keep importing `./errors.js`. |
| Trading context and till boundary | Six source files. Size after tracing which types can move together and which route callers need to keep the server entry points. |
| Floor and kitchen boundary | Seven source files. Size after identifying the smallest change that breaks the imports in both directions through `parties.ts` and `kitchen-print.ts`. |
| Device and document boundary | Five source files. Size after tracing which settings reads and document dispatches can use existing package exports. |
| Card and refund boundary | Four source files. Size after tracing which provider and refund calls need the server to supply its running provider pool. |
| Move order preview with the bill seed | Preview +56/−56 production and +151/−151 test lines, plus about +270/−230 support and +20/−10 tests for the split. Size seed imports and any required extraction from the 9,836-line `working-order.ts` before committing to this PR. Customer fallback adds +327/−327 test lines and also needs `till-sale.ts` (636 lines). |

The open boundary rows each need an exact plan and line budget before build. The broader move
after those shared pieces, including `working-order.ts`, gets its own plan.
Split where a change would exceed three hours. For the first move, qualify assets and source
guards, root shard wiring, package-only and server-only selection, and independent
`98/98/98/95` coverage. Keep boot, till mounts and their integration tests in the server.
[Earlier boundary decisions](2026-11-17-a1308-orders-sales-package-move.md)
