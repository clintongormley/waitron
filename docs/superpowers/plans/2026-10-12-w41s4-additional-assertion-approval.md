# W41s-4: additional fiscal assertion changes for owner approval

Task 4 replaces locally minted installation numbers with externally supplied text identities.
The owner's 2026-10-12 14:40 approval names particular assertions in four files. The remaining
checks below also pin the numeric representation or the allocator being retired. They have not
been changed. Queue.md requires approval of the exact existing fiscal assertions; approval of
the implementation plan does not waive that rule.

This inventory names the files and lines at branch commit
`7166cee0ab28a56d0f93a0953ace8f04f000c760`. It supplements the earlier approved list rather than
replacing it. The proposed names `S000001`, `P000042` and `P000043` are explicit external
allocations, not new defaults or values minted by the box.

## Proposed additional changes

| Existing check | Proposed replacement and retained behaviour |
| --- | --- |
| `packages/fiscal-verifactu/src/reserved-sif.test.ts:54–55`, first and second reservation return `1` and `2` | Use two independently consumed allocations and assert their exact supplied identities and distinctness. Keep supplied-identity persistence, the empty new chain and duplicate-identity refusal. |
| `packages/fiscal-verifactu/src/chain.concurrency.test.ts:182`, concurrent registrations equal `[1 … WRITERS]` | Assert the exact set of independently supplied identities for all callers. Keep the distinct-count assertion at line 183 and every chain-order assertion elsewhere in the file. |
| `packages/fiscal-verifactu/src/restore.sold-node.test.ts:42`, restored installation is at least `installationFloor(NOW)` | Assert the exact supplied recovery identity and inequality with the old identity. Keep the retained record, new SIF reference, empty head and returned series checks. |
| `packages/fiscal-verifactu/src/engine-clock-and-floor.test.ts:54,60,64,66`, the counter becomes or stays `500`, or starts at `42` | Replace the retired floor cases with checks that supplied identities are independent of the clock and cannot be reused. Keep the clock-stamp, sequence and acknowledgement cases in this file. |
| `packages/fiscal-verifactu/src/reserved-series.test.ts:19–22`, derived codes equal `A-42` and `R-42` | Assert `A-P000042` and `R-P000042` for exactly that supplied identity, keeping both purposes. |
| `packages/fiscal-verifactu/src/reserved-series.test.ts:34–36,38`, registered numeric suffixes are stripped | Use supplied registered text suffixes, including repeated suffixes. Keep the unmodified base and human `FA-2026` checks at lines 33 and 37; the repeated-suffix case still checks removal of every registered trailing suffix. |
| `packages/fiscal-verifactu/src/reserved-series.test.ts:64–68,86–89`, whole-shape examples contain registered `FA-2-2` and `FA-1` suffixes | Port these examples to the supplied identity while preserving same-purpose collapse, first-seen order and different-purpose disambiguation. The direct numeric checks at lines 51 and 81 were already approved; these whole-shape examples were not separately listed. |
| `packages/fiscal-verifactu/src/provisioning.test.ts:54,123–124`, report contains `installation 1`, series are `FA-2`/`RF-2` | Assert the report contains the exact supplied identity and both series use it. Keep the rectificative-purpose check. These supplement the approved checks at lines 52, 69, 122 and 131. |
| `apps/server/src/mirror-bundle.test.ts:163` and `apps/server/src/mirror-bundle-api.test.ts:667`, reserved identity is greater than zero | Assert the exact externally supplied text identity and its allocation/approval evidence. Keep taxpayer, software, complete-purpose series and endorsement assertions. |
| `apps/server/src/mirror-bundle-api.test.ts:623,802,812,846,928,1048,1074`, counter stays unchanged, moves, or increases by one | Replace counter snapshots with allocation/reservation evidence. Rejected requests still cannot create a local identity; a successful reservation returns the exact externally consumed identity; the chart-race case retains the outside consumption even when activation fails. Keep every response code, membership and chart-term assertion. |
| `apps/server/src/provision-till.test.ts:82`, live row has installation `1` | Assert the same whole row with the exact supplied setup identity, retaining taxpayer and software fields. |
| `apps/server/src/reserved-identity.test.ts:89`, established identity is `7` | Assert the exact external identity from the submitted validated allocation, retaining series ownership and establishment checks. |
| `apps/server/src/restore.test.ts:847,859–863`, registered identity is `1` and the rectificative base is `FA-1` | Use the supplied registration identity. Keep the different-purpose base intact and assert every returned series exactly; the fixture's registered suffix must be different from the human base it protects. |
| `apps/server/src/restore-fiscal-e2e.test.ts:345,348–350,467,514`, old installation is `1`, fresh installation meets the clock floor and a rolled-back counter stays `2` | Assert exact old and externally supplied fresh identities; replace the counter rollback assertion with the absence of partial local activation. Retain the full old-record comparison, chain sequence, append-only refusal, retirement count, artifact rollback and failed-restore checks. |
| `apps/server/src/stream-loop.e2e.test.ts:643–645`, bucket rebuild's installation meets the clock floor | Assert the exact supplied recovery identity and its difference from the old one. Keep all stream, rebuilt-record, chain and retirement assertions. |
| `packages/provisioning/src/venue-apply.test.ts:232`, setup installation is at least `1` | Assert the exact supplied initial allocation. Keep the taxpayer, complete-purpose series, seed reports and idempotent repeated application checks. |

Fixtures and input types also need the opaque allocation and approval. This request does not
authorise changing unrelated values or deleting behavioural assertions. Existing inequality,
uniqueness, rollback, purpose and historical-byte checks stay; new failing cases qualify the
replacement path before implementation.

## Two schema/public-surface pins

Removing the local allocator and adding the allocation audit table also affects these explicit
lists. Approval is requested only for these list entries, with all guard logic retained:

- `packages/fiscal-verifactu/src/index.test.ts:28`: replace the retired counter-table export pin
  with the allocation-ledger export pin and add a separate activation-function export check.
- `packages/fiscal-verifactu/src/schema-ownership.test.ts:13`: replace the retired counter entry
  with the owned allocation ledger. Keep the exact exported-table comparison, generated-table
  positive control, core-table exclusions and required foreign-key assertions.

The retained-row snapshots in `packages/provisioning/src/cli.venue-details.test.ts:90` and
`packages/provisioning/src/venue-apply.test.ts:815` name the counter table. Port those snapshot
inputs to the allocation ledger, keeping the existing before/after equality checks. No root
guard, coverage threshold, migration pass/fail logic or shipped migration is covered by this
request. Any further required guard change is a separate request.

## Evidence and decision

The existing numeric cases were run on the unchanged branch with:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reserved-sif.test.ts src/restore.sold-node.test.ts src/engine-clock-and-floor.test.ts src/chain.concurrency.test.ts src/index.test.ts src/schema-ownership.test.ts
```

Result: 6 files, 25 passing tests. This measures the existing checks, not the replacement
allocation path. The lane receipt is `receipts/w41s4-additional-assertion-baseline.log`.
The host baseline (`mirror-bundle`, `mirror-bundle-api`, `provision-till`, `reserved-identity`,
`restore`, `restore-fiscal-e2e`) passed 6 files and 128 tests. The separate `write-path.e2e`,
`inmutabilidad`, `provisioning` and `reserved-series` run passed 4 files and 41 tests. Both
logs are retained in the lane receipts. These runs exercise the existing numeric path;
they do not qualify external allocation activation.

Recommended **A**: approve these exact ports and list-entry changes, retaining every invariant
named above. Alternative **B**: retain the existing checks and revise Task 4 before changing
the representation. The earlier 14:40 approval remains valid either way.

Until the answer, keep the feature branch at a signed checkpoint. No schema or production
activation change is enabled by this inventory, and the branch is not ready to finish or land.
