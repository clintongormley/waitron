# A1308 orders and sales package move: decision for the watcher

**State:** no implementation is cleared. Watcher requested this plan on 2026-11-17 at 17:58; a separate Sol-high writer drafted it, the driver checked it, and Claude’s first read found the scope decision below. No owner approval of this design is claimed. **Base:** `d47b99294b` (os1 #3670). **Who lands an eventual relocation-only move:** the lane; fiscal/behaviour changes stop it.

**Requested result:** before os2, put [os1’s listed area files and tests](2026-11-08-a1308-os1-order-numbers.md#area-files-for-the-package-move) into one `@waitron/orders-sales` package, with independent CI selection. Keep functions, signatures, assertions, tables, transactions and behaviour unchanged; add no framework. [Build order, Batch 2](2026-11-08-a1308-build-order.md#batch-2--area-slices) models ~860 seconds saved per PR, not a measured result. [Slice rules](2026-11-08-a1308-slice-rules.md) apply.

## Measured source boundary and choice

The driver’s static TypeScript import inventory finds **77 host modules imported by area production, 157 including tests/support**. The per-module importer counts, type-only/value distinction, direct back-edges and source lists are retained in Lane H’s `receipts/orders-sales-package-plan/boundary-inventory.{md,json}` and supplied to Claude. This is source evidence, not an executed module graph.

- `bill-payments-api.ts:22–28` imports till helpers/types; `till-api.ts:213` imports its mount back. `working-order.ts:142–154` calls parties; `parties.ts:39–47` calls order creation/payments/drafts back. Kitchen has similar back-edges.
- `errors.ts` augments the shared registry and imports area types. Area production references 124 host-declared codes as literals, directly constructs 121 of them, and has one dynamic AppError construction. A full move must settle registry ownership, preserving the rule that throwing files import their registry.
- `testing/bill-venue.ts:49` mounts the full till; 62 selected area tests use that helper directly. `bill-payments-loop.test.ts:29` uses boot. Shared support/fixture splits would exceed an import-only move.

| Route | What it buys and costs |
| --- | --- |
| Leaf-only move | The closed set of relative imports is just **13 production files / 932 lines and five sibling tests / 610 lines**, before asset/coverage qualification. Most requested files stay in the server. |
| Support extraction, then full move | Requires concrete shared-helper/registry/fixture designs and separately sized slices; neither is provided or authorised here. Previous effort ranges were unmeasured guesses and are withdrawn. |
| **Defer the move until after os11, before os12** | os1:211–213 provides this later position conditionally. No package CI saving during os2–os11; their changes remain in the existing server package. **Recommended**, given the small leaf set. Watcher must clear changing the sequence. |

## Full-move inventory and later acceptance

| Relocation at this base, before fixture exceptions | Files | Lines added / removed |
| --- | ---: | ---: |
| Production | 103 | +38,528 / −38,528 |
| Tests | 141 | +131,095 / −131,095 |
| Six named support files | 6 | +1,558 / −1,558 |

Keep the host’s **68 `boot.*` (including boot.test.ts), six `boot-*`, and 44 `till-api.*` (including till-api.test.ts)** suites there. The seven additional retained suites are `orders-invoice-deliveries{,.issue-clock}`, `till-sale-integrated{,.db}`, `till-sale-reconciliation`, `till-sale-tender-block`, and `unpaid-invoice-delivery` (all `.test.ts`). `draft-recall`/`draft-source` were retired in `a9e8f379b7`; do not recreate them. Invoice/receipt print and delivery files matched by os1 move once; dv11–dv14/dv17 edit them in their resulting package.

Before any full move is cleared, its executable plan must settle:

- [ ] Exact shared homes, explicit package exports and handwritten production/test/support sizes, separately from mechanical imports, moved lines, binaries and generated lockfile changes; slices each fit the three-hour rule.
- [ ] Preserve server Vitest setup and real mounts/fixtures, font/golden paths, subprocess roots and working directories. Reuse the duration sequencer; port manifests, duration keys, scope/CI shard and merge wiring, and existing source-guard path lists. No new registry framework or weakened checks.
- [ ] Qualify moved tests alone against moved-source coverage. Below **98/98/98/95** stops the move; no new excludes. Package coverage cannot be promised from today’s combined server run.
- [ ] Name retained host checks for later slices: `till-api.{drafts,groups,move-bill,receipt,reprint,bill-actions,fiscal-sale-paths,presented-bill-zone}` and affected bill-venue cases. Package-only PR CI omits host dependents; run affected host checks locally under slice rules §4. Some modelled saving is removed test execution, not faster tests. Deferral avoids this split during os2–os11.
- [ ] Keep behavioural assertions and the queue’s unedited fiscal/menu gates. **Expected protection-list difference: none**, both compositions, all phases/databases. No sale-path read changes. Two contract-trigger Claude run-it reads, one fixes read, normal push hook and current-head CI precede landing.

**Later areas can reuse:** inventory back-edges first; keep HTTP glue at the host as adjustments does; account for host suites leaving package-only PR CI, per-package coverage and registry ownership. No move tooling or measured saving exists yet. This decision page does not replace the executable move plan once the watcher settles its scope and timing.
