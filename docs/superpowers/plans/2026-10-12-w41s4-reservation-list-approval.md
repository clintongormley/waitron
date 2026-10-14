# W41s-4: dormant reservation table-list additions

You approved reserving a spare box's fiscal identity at join and activating it at takeover.
The signed reservation must survive adoption and restart without creating an active SIF or
invoice series. The branch now retains that proof and its complete series bases in the
module-owned `fiscal_reservations` table. Its append-only triggers refuse updates and deletes
of retained join evidence. The current outside register still determines whether takeover is
authorised; this local copy does not establish outside continuity.

Two exact lists need the new table name. Earlier approval covered `fiscal_allocations`, not
this separate dormant ledger. Queue.md's W41s gate requires approval of exact existing fiscal
checks, and its standing test-change rule requires approval of root guards. Neither file has
been changed for this request.

Recommended **A:** approve precisely these additions:

- In `scripts/append-only-triggers.test.ts`, `EXPECTED`, insert
  `  "fiscal_reservations",` immediately after `  "fiscal_allocations",`.
- In `packages/fiscal-verifactu/src/schema-ownership.test.ts`, `OWNED`, insert
  `  "fiscal_reservations",` immediately after `  "fiscal_allocations",`.

Every existing list entry, comparison, refusal, positive control and foreign-key check stays.
The earlier counter-retirement approval remains separate. No threshold, exclusion, migration
check or fiscal record assertion is included in this request.

Alternative **B:** pause this storage choice and revise how you retain dormant reservations
before connecting the host paths. Do not weaken the two lists or classify the reservation as
writable merely to pass them.

The executed receipts are under Lane E's local `receipts/w41s4-dormant-*` files:

- The initial eleven dormant tests failed because the establishment API was absent.
- The already-active SIF and series controls each resolved instead of refusing before the guard
  was added. The caller-mutation test stored changed signature payload before the snapshot fix.
- The final focused run passed five files and 123 tests, including unchanged write-path and
  immutability suites.
- The seven-file root run passed 132 cases and failed one: the exact append-only list has the
  additional `fiscal_reservations` name. The populated migration-upgrade case passed in that run.
- The package coverage command failed its exact schema-ownership list on the same additional
  name. That failed run supplies no passing package coverage result.

The whole W41s-4 branch is still incomplete and has no PR. This checkpoint does not authorise
publishing an interim activation path. After approval, apply the two additions, verify them and
finish takeover binding, authenticated host input, SIF text typing, counter retirement and all
setup, seed, restore, adoption and promotion consumers before the full branch review and CI.

**2026-10-12 20:55 decision and application:** the owner approved A exactly as proposed above.
Both list failures were reproduced before adding the two names. The root suite passed 56 cases
and the fiscal ownership suite passed four after those additions. No other existing assertion
changed for this approval. Task 4's host and representation changes remain unfinished.
