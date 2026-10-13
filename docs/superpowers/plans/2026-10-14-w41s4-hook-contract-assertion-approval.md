# W41s-4: remaining hook-contract checks for approval

The approved standby flow reserves names at join and opens the SIF and series at
takeover. The prepared restore hook opens its own series in the activation
transaction. Existing tests also check where those series appear in the hook
result and which code rejects malformed reservation state. The earlier approval
lists name numeric values and several lifecycle checks, but omit the expressions
below. No expression in this table has been changed.

Source lines refer to `631644024a7537e125d2f1414c807962433ef795`. This request
supplements the approvals of 12 and 13 October; it does not replace them.

## Recommended A: approve these exact ports

Keep each comparison at least as strict. Check the complete supplied allocation
where a dormant reservation holds it, and the complete persisted active series
after activation. Add an explicit check that the former return field is absent
or empty, so the host cannot create the series a second time.

| Existing check | Proposed replacement and retained behavior |
| --- | --- |
| `packages/fiscal-verifactu/src/provisioning.test.ts:114–117`, reservation returns the derived `FA` and `RE` series | Assert `reservation.series` is absent and compare the signed reservation's complete series to the exact supplied `FA-P000042` and `RE-P000042`, including their purposes. Keep the live-base stripping and retired-series fixture. At takeover, compare the persisted active series to the same complete set. |
| `packages/fiscal-verifactu/src/provisioning.test.ts:123–124`, reservation returns `FA-2` and `RF-2`, with rectificative purpose | The numeric suffix port is already approved. Additionally approve moving these comparisons from the omitted `r.series` to the complete signed allocation, asserting absent returned series and no active standby rows, then checking the complete active set at takeover. Keep the separate rectificative-purpose assertion. |
| `packages/fiscal-verifactu/src/provisioning.test.ts:158`, eight malformed reservation cases answer `sif.reservation_invalid` | Give each case a valid, independently prepared establishment operation, so it reaches reservation-state validation. Port the malformed carrier fixtures to the signed carrier shape, retaining absent state, invalid shape, missing/empty/overlong scope and invalid identity classes. Assert `sif.allocation_invalid` with its specific cause instead of the former code. Keep the exact no-written-row assertion and add unchanged reservation/key checks. Missing authentication is tested separately; do not use it to satisfy these cases. |
| `packages/fiscal-verifactu/src/restore.test.ts:106–110,186–188`, restore returns replacement series for the host to open | Assert `outcome.series` is absent, then compare the persisted active series with every previously asserted code and purpose using the supplied recovery identity. Keep the retired-series filtering, retained records, sequence, fresh identity, report, rollback and chain verification. The active-code check at line 113 is already approved separately. |
| `packages/fiscal-verifactu/src/restore.sold-node.test.ts:48`, restore returns the new `GA` series | Assert absent returned series and compare the actual active series to exactly `GA-P000042`, including standard purpose. Keep the sold record, fresh identity, empty chain head and record-count assertions. Only the installation-value assertion at line 42 was approved previously. |
| `apps/server/src/mirror-bundle.test.ts:165–172,249–256` and `mirror-bundle-api.test.ts:670–682`, bundle returns active derived series and their purposes | Assert `reservedIdentity.series` is empty. Compare the signed fiscal carrier's complete allocation to the exact supplied `FA-P000042`, `FF-P000042`, `RF-P000042` with their standard, full and rectificative purposes. Keep taxpayer/software, complete carrier/evidence, extra seriesless module, endorsement/signature, membership, response and permission checks. Verify the same complete active set at takeover. The numeric identity and counter ports remain covered by their earlier approvals. |
| `apps/server/src/reserved-identity.test.ts:167,190`, missing fiscal state or a missing modules map answers `sif.reservation_invalid` | Supply a valid prepared establishment operation, but retain the missing carrier/map under test. Assert `sif.allocation_invalid` with `reservation_mismatch`. Keep both no-node assertions and add checks that the sealed key, reservation and active series were not written. Do not substitute a refusal from missing operation input. |

These ports do not authorize dropping an assertion, changing money, VAT,
permissions, a golden hash or an immutability check, editing a shipped migration,
or altering any root guard, coverage bar or migration pass/fail decision.

## Alternative B: keep the earlier hook contract

Keep these expressions and revise the prepared hooks and host integration before
switching the defaults. That needs a concrete design for returning series metadata
without causing the host to create active series again, and a decision about the
malformed-reservation code. No such redesign has been implemented.

## Executed evidence

The unchanged branch ran:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/provisioning.test.ts src/restore.test.ts src/restore.sold-node.test.ts src/allocated-lifecycle.test.ts src/allocated-standby.test.ts
pnpm --filter @waitron/server exec vitest run src/mirror-bundle.test.ts src/mirror-bundle-api.test.ts src/reserved-identity.test.ts
```

The first command passed 93 tests in five files; the second passed 40 tests in
three files. They exercise the old hooks and the explicitly selected prepared
hooks separately. They do not qualify the default switch.

An independent clone at the same commit installed dependencies with
`pnpm install --frozen-lockfile --offline`. Three fiscal and three real-host
contract controls then asserted the old return fields and malformed-state code
against the prepared hooks. All six failed at the intended assertions: restore
and reservation returned no series, the assembled bundle carried an empty series
array, and malformed establishment answered `sif.allocation_invalid`.

Only the disposable assertions were then changed to the proposed comparisons.
The controls check complete signed or active series and rollback after the same
malformed states. Their results and runnable probe files are retained locally
under `receipts/w41s4-contract-*` in Lane E. These are interface experiments,
not failing-feature-first evidence for a new implementation. The feature's
production code and existing tests were not changed for them.

Task 4 remains incomplete. Default-hook selection, text installation typing,
counter retirement, current-main migration regeneration and populated upgrade,
Cloud operator binding, both full reviews, the push hook and current-head CI
still precede publication.
