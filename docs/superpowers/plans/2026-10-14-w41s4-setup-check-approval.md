# W41s-4: two setup checks outside the approved list

The default fiscal setup now receives a supplied text identity and opens its complete allocated
series set. Two existing checks in `packages/provisioning/src/venue-apply.test.ts` need a decision
before this transition can finish. Neither proposed change has been applied in the feature tree.
The earlier numeric, return-field and refusal-code approvals remain in force.

## What failed

The command `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts`
passed 41 cases and failed these two with the real prepared hooks:

1. The complete `result.seeded` comparison at line 233 still matches the fiscal report with
   `/^SIF .* \(installation \d+\)$/`. The actual report contains the supplied `S000001` and
   `A-S000001, FF-S000001, R-S000001`. The 12 October approval named the installation row at
   line 232 and said to retain seed reports; it did not name this report matcher.
2. The “never returns a phantom series id” case at lines 606–637 supplies two purposes using
   the same code `A` and expects one series. The new paper-block signer refuses that allocation
   with `Invalid paper block`. This is a fixture error before the original comparison can run.
   The allocated fiscal path requires a complete, distinct series set. The generic provisioning
   path still has its `ON CONFLICT` handling and needs this regression check.

The lane retains the command output as `receipts/w41s4-venue-apply-transition.log`. This run
does not qualify the remaining host inputs or the whole Task 4 transition.

## Recommended A

Approve exactly these two changes:

| Existing check or fixture | Replacement and retained checks |
| --- | --- |
| The fiscal report matcher inside `result.seeded` at line 244 | Match a UUID SIF reference, exactly `installation S000001`, and exactly the complete `A-S000001, FF-S000001, R-S000001` list. Keep the complete seeded-module comparison and every other report value. |
| The dependencies for the colliding-series call at line 631 | Run this case through the real generic `applyVenue` with a test module named `fiscal-verifactu` whose seed has no series-ownership contribution. Keep the plan's values, both existing one-series assertions, and the real database. Prove that always returning the rejected insert's id makes the unchanged assertion fail. |

The second change keeps the original generic regression rather than asking the allocated fiscal
path to accept an incomplete allocation. This approval does not cover any other assertion,
fixture value, error code, root guard, coverage limit, shipped migration, golden hash or immutable
record. List both changes under “Changed test checks” in the eventual pull request.

## Alternative B

Keep these checks and revise the setup transition before changing them. There is no proposal to
print a fabricated numeric installation or accept an incomplete signed allocation to satisfy them.

Until the answer, keep this branch unpublished. Host consumer ports, final regeneration after
rebase, the complete upgrade checks, both full reviews, the push hook and current-head CI remain.


## Disposable qualification

An independent local clone with its own frozen dependency install passed all 43 venue-application
cases with only the two proposed changes. Removing the generic insert-result guard made the
unchanged phantom-series assertion fail with two returned ids instead of one. Restoring it passed
all 43 again. The feature tree still retains its original report matcher and colliding-plan fixture.
The lane retains the install, proposed-pass, deletion-control and restored-pass outputs under
`receipts/w41s4-setup-*`. This is qualification of the proposal, not a whole-branch review.
