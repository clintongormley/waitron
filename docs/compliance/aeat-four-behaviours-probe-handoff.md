# Four AEAT test-service observations (A985)

## Completed run, 2026-10-22

The owner approved library PR #146. It merged as
`28a987963a69e3faa08814481b013d2982fa95b0`; package CI 39721481538 and Documentation
39721481488 passed before the single `four-behaviours` dispatch,
[run 39721604913](https://github.com/waitron-io/verifactu/actions/runs/39721604913).
Do not dispatch another run under A985.

The cancellation and its unchanged retry both returned `Correcto` and named the original invoice.
The following lookup returned `Anulado` with the cancellation's fingerprint. The €0.00 F2 returned
`Correcto`, as did its lookup. The corrupted fingerprint returned `AceptadoConErrores`/`2000`;
the lookup retained that warning and the supplied wrong fingerprint. The valid-fingerprint
control returned `Correcto`. The workflow failed because it predicted a duplicate response for
the cancellation retry. All six submissions and four lookups were collected; no rerun was sent.

Read the [dated findings and limits](verifactu-findings.md#19-cancellation-replay-zero-total-and-wrong-fingerprint-added-2026-10-22-a985)
and [full redacted evidence](../superpowers/specs/2026-10-22-aeat-four-behaviours-evidence.json).
The owner's fingerprint refuse-versus-file-and-flag choice remains open. No Waitron behaviour
changed, and the unobserved cancellation duplicate-response path remains open.

## Preparation record, before the run

The instructions below record the predictions and authorisation procedure used for this run.
Their pending language describes preparation, not work still to execute.

You need real test-service replies before treating four behaviours as established: cancellation
replay, the invoice identity in a cancellation reply, a zero-total simplified invoice, and a
corrupted fingerprint. The library's local fake cannot answer those questions.

The `four-behaviours` mode is prepared in [library PR #146](https://github.com/waitron-io/verifactu/pull/146),
head `3c145d95dd8659411a42a6db7f2a07fd49a445a5`, on branch
`feat/a985-four-aeat-behaviours`. It has not run against AEAT. The library PR requires the owner's
review and merge before dispatch, following A946's main-only workflow. Keep the open backlog
entries until the replies have been collected and interpreted.

## What the run sends

The mode prints its predictions before its first request. It sends six single-record submissions:

| Stage | Request | Prediction, not an observation |
| --- | --- | --- |
| `original` | Fresh simplified invoice for €1.21 | `Correcto` |
| `cancellation` | Fresh cancellation linked to that invoice | `Correcto`; reply names the original invoice |
| `cancellationRetry` | The same cancellation, unchanged | Duplicate `3000`, stored state `Anulada`; reply names the original invoice |
| `zero` | Fresh simplified invoice, base/tax/total all `0.00` | `Correcto` |
| `validHash` | Fresh €1.21 simplified invoice with its calculated fingerprint | `Correcto` |
| `wrongHash` | Fresh €1.21 simplified invoice with one fingerprint character changed | `AceptadoConErrores`, code `2000` |

Each new invoice uses its own synthetic installation and first-record chain. The cancellation
uses the original invoice's installation and links to its fingerprint. Generation happens after
the preceding submission's requested wait; the cancellation retry retains the earlier record.
The mode also looks up the cancelled invoice and the zero, valid-fingerprint and bad-fingerprint
invoices. It retains each parsed submission and lookup reply together with its raw SOAP text,
with configured identities redacted by the evidence serializer used by A946.

The offline tests run the serializer, parser and fake service, including the actual command-line
entry point. They check the unchanged cancellation, zero values, differing fingerprints, identity
redaction, requested waits, partial replies and exit status. The complete script suite passes 189 tests after the review corrections; seven deliberate guard
omissions each fail their intended assertions, and the restored suite passes. Those are local checks of the probe,
not observations of AEAT.

## Run after the library owner gate

Verify that the reviewed library head has been merged to `waitron-io/verifactu`'s `main` and that
its package and documentation checks passed. Then dispatch once:

```sh
gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=four-behaviours
```

Keep the workflow's `aeat-preproduction` environment and main-only condition. Do not add a
feature-branch deployment policy or use a production endpoint. Record the literal workflow run
ID and head SHA before reading its log.

An unexpected reply makes the workflow fail while retaining its evidence. A missing, extra or
mismatched reply line, refused initial control, failed wait or failed request leaves an incomplete
run. An unexpected or mismatched cancellation reply does not stop the independent zero and
fingerprint observations. If the original control is refused or cannot be matched, its two
cancellation stages are skipped and the independent invoice probes continue. Preserve either
result; do not rerun unchanged just to obtain a green workflow.

Collect the complete log and the `AEAT four-behaviours complete:` JSON line. Check every stage,
including partial stages, against its earlier per-stage log. Save redacted request records, parsed
replies and raw SOAP in `docs/superpowers/specs/2026-10-22-aeat-four-behaviours-evidence.json`.
Do not publish certificate material or configured identities.

Add a dated section to `verifactu-findings.md` with the run URL, exact returned statuses and error
codes, short quotations of AEAT's wording, and a provenance row. For cancellation replay, compare
the original, cancellation and retry invoice keys and the lookup's saved state and fingerprint.
For zero and corrupted-fingerprint invoices, report the submission and lookup separately. If a
reply prevents a question from being answered, leave that question open.

The fingerprint outcome does not authorise changing Waitron. Put the refuse-versus-file-and-flag
choice to the owner with the observed reply and a recommendation. Keep that policy question open
even if the test service accepts the record. These experiments establish no production-service
behaviour, legal conclusion or guarantee for every invoice shape.
