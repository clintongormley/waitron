# W41s-1b: successor probe handoff

You still need AEAT evidence before changing Waitron's holds after a conflict or an unsent
cancellation. [Verifactu PR #140](https://github.com/waitron-io/verifactu/pull/140) prepares the
probes. It awaits owner review; no live request has run and no legal conclusion follows from
the local checks.

The candidate is `65b38d707d74ea31dd3dd608c6142529533bb84d`. Its
[CI run](https://github.com/waitron-io/verifactu/actions/runs/38233640031) passed the script tests,
the library coverage suite and package checks. Its
[Documentation run](https://github.com/waitron-io/verifactu/actions/runs/38233640044) also passed.
The normal push hook ran, and both Claude run-it reviews completed. No fiscal-library source
or existing main assertion changed.

## Run after the owner-reviewed library merge

The library's `live-aeat.yml` job has a `refs/heads/main` condition. Keep it. Once the owner has
reviewed and authorised that merge, use the existing preproduction environment:

```sh
gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=conflict-successors
gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=held-cancellation-successors
```

Retain each exact run ID, head SHA, command, plan output and individual response beside its sent
serial, date, hash and predecessor. An incomplete run is not evidence that a successor was
accepted. Preserve the failed prerequisite or missing line and investigate before another run.
Do not use an unchanged rerun to erase that result.

## What the two modes measure

`conflict-successors` first sends an accepted control chain. It then sends a changed invoice
under an accepted invoice's key, requires the individual 3000 refusal, and sends a successor
linked to the changed hash. A separate chain sends that conflicting record and a successor in
one batch, replays the exact successor, then sends its next record. If the service answered the
sibling, the replay is labelled `simulated-client-lost-response`. If the service omitted the
reply, it is labelled `missing-service-reply`; that omission remains recorded.

`held-cancellation-successors` first sends an accepted invoice, its cancellation and a linked
successor as a control. Its test chain requires the intended 1161 refusal of the original.
It then keeps the cancellation unsent and sends a successor linked to that cancellation's
hash. This matches the hold in `haltOpenChainClaims` in Waitron's drain rather than testing a
cancellation already submitted to AEAT.

Publish the actual results as a separate dated receipt in the approved design's §7.1. Keep
protocol observations separate from adviser answers. The two local fake-service runs qualify
probe construction and handling; they do not establish either live result or a lawful remedy.
