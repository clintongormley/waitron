# W41s-4: the remaining host checks and developer demo

The host pass now exercises supplied setup, re-registration, standby, promotion,
archive and bucket inputs. Three existing checks and the developer demo remain
open. The earlier approvals remain valid; this request changes none of their limits.

## Decision 1: the three remaining fiscal checks

Source lines refer to the host checkpoint prepared from `9f9c5e778`. Recommended
**A**: approve exactly the two rows below. **B**: retain the checks and revise
these callers before the default switch can be published.

| Existing check | Proposed replacement and retained behavior |
| --- | --- |
| `apps/server/src/venue-details.test.ts:643`, `contadores_instalacion` in the input to the two full-history snapshots | Replace that retired-table input with `fiscal_allocations` and `fiscal_reservations`. Give this describe a genuinely activated, independently signed allocation; check that its snapshot holds the complete activation row and that the counter table is absent. Keep every original refusal, money, history, series-number, foreign-key and before/after equality assertion. |
| `apps/server/src/boot.setup-routes.test.ts:1329`, new-taxpayer import keeps exactly `B`, `FB`, `RB` as active series | Check exactly `B-S000001`, `FB-S000001`, `RB-S000001`, from the supplied initial allocation. Keep the count, order, taxpayer refusal, complete issuer, address, language and imported-configuration assertions. |

The feature retains these original checks. They fail on the retired table and the
actual allocated codes. An independent installed checkout applied the proposals;
its three affected suites passed 140 cases, including the developer experiment
below. The snapshot fixture holds one complete activation row. Removing the activation table
from the captured table list failed both new capture assertions; restoring the
list passed both cases. This is stronger than an equality between empty ledgers.
No root guard, golden hash, immutability check or shipped migration changes.

## Decision 2: how the developer demo gets its allocation

`apps/server/scripts/dev-setup.ts:201` still calls the production seed with no
allocation input. The unedited developer suite fails `sif.allocation_invalid`;
its shared initialisation cannot finish. Its caller uses the built-in fictional
Spanish demo identity, and its production-refusal case checks that no `.env`, `venue.db` or
`modules.json` is created.

Recommended **A**: allow synthetic signed allocations for this developer demo,
restricted to preproduction and the built-in fictional identity. Implement an
explicit runtime boundary with those checks, and retain the existing production
refusal. Real taxpayer setup and fiscal readiness still require their supplied
outside allocations. Do not use a test helper as the release implementation.

**B**: require an outside allocation for the developer demo too. Add its input
port and update the development commands and their operator instructions before
publishing this default switch.

A disposable prototype selected the existing signed fixture for the developer
command. All 26 unedited developer cases passed. Removing the early production
refusal failed the existing untouched-directory assertion; restoring it passed.
This experiment establishes the input route and its guard, not a production-ready
simulation boundary or outside continuity. The prototype is not on the feature.

## Receipts and next steps

Lane E retains `w41s4-host-proposal-candidate.json`, the exact candidate hash and
frozen offline install, `w41s4-host-proposal-green.log`, the snapshot control pair
and the developer production-guard control pair. Commands used the real Vitest
server suites; no assertion in the original developer suite changed.

After the two answers: apply the approved check ports and the chosen developer
boundary, qualify the remaining host checks, then rebase and regenerate on current
main, run the populated upgrade and schema checks, check the Waitron-side Cloud
operator contract, complete both FULL reviews, the normal hook and current-head
CI. Task 4 remains incomplete and unpublished.
