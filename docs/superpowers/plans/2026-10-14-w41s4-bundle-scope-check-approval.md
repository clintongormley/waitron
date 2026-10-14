# W41s-4: include the new fiscal bundle consumer in existing scope checks

The paper-custodian build uses `scripts/bundle-node.mjs`, as required for Node bundles.
`packages/fiscal-verifactu/package.json:13` therefore adds a real consumer of that script.
The first normal push hook failed the unchanged root consumer guard and the English-vocabulary
guard. The composition fixture query now lives in a module-owned test helper, with the same
identity and empty-row comparisons. `ROOT_SCOPE_CONSUMERS` now includes the actual fiscal build.

The corrected map exposes three old package-selection pins in `scripts/changed-packages.test.mjs`.
The feature retains those pins pending this exact approval. No release code, guard logic or
coverage bar is changed by the proposal.

## Exact A proposal

| Original source | Exact addition and retained behavior |
| --- | --- |
| `changed-packages.test.mjs:198–209`, synthetic consumers fixture | Add `member("@waitron/fiscal-verifactu", "packages/fiscal-verifactu")` after credentials. Retain every other member. Remove only “four” from the test title at213. |
| `changed-packages.test.mjs:214–223`, bundle script selection | Add `"@waitron/fiscal-verifactu"` after credentials in the exact package array. Keep kind `packages`, root `true`, every existing member and order. |
| `changed-packages.test.mjs:285–296`, bundle script plus database change | Add `"@waitron/fiscal-verifactu"` after db in the exact package array. Keep kind, every prior member and order. |
| `changed-packages.test.mjs:732–735`, actual CLI output | Add `@waitron/fiscal-verifactu` after credentials in the exact package string. Keep code=true, scope=packages, root=true, deploy=true, every existing package and exact newlines. |

A approves only those additions/title wording. B retains the old pins and requires revisiting
how this package builds its required Node bundle before publication. No other assertion, fiscal
check, hash/record, guard logic, coverage setting or shipped migration is covered.

## Qualification

An independent temporary clone with frozen offline dependencies and the complete candidate
applied this exact source. The four relevant root suites passed 1,771 cases. Deleting the new
consumer mapping failed four comparisons in the real-tree guard and scope suite; restored,
all123 cases in those two suites passed. The parent was removed.
The actual custodian bundle also builds and loads, returning exit2 and its exact empty-argument
refusal. The first smoke probe incorrectly expected usage wording; it was corrected without
changing release code.

Lane E retains the exact proposed source and SHA-256 in `receipts/w41s4-scope-proposal.json`
and `receipts/w41s4-proposed-changed-packages.test.mjs`, with install/green/control/restored logs.
Both FULL reviews are already complete; this is a hook-discovered configuration/test-pin fix,
not a reason to repeat them. The normal hook/current-head CI/locked landing remain.

## Owner answer, 2026-10-14

The owner selected A, exactly all four rows. The retained proposed source is applied without
changing any other guard expression. The earlier paragraphs record the request before approval.
