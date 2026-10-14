# W41s-4: the archive-from-bucket checks added on main

Rebasing Task 4 onto `c106c7e44371adc9ba370972346625529942e095` brought in
`apps/server/src/restore-command.archive.test.ts`, added by A538 task 5 in #1632.
Its original checks are retained on the feature. They import the retired installation counter
and clock floor, and expect numeric SIF values. They were absent from the earlier exact approval
lists. This request changes none of those earlier approvals.

## Exact proposal

Recommended **A**: approve the two rows below. **B**: keep these checks and revise the callers
before publishing the default switch. Lines refer to the unchanged main suite.

| Existing source/check | Proposed replacement and retained behavior |
| --- | --- |
| `restore-command.archive.test.ts:22–23,132–140,453`, retired counter fixture, numeric SIF `1`, and the old SIF assertion | Remove the counter import and insert. Store and assert historical SIF `"1"`. Add the source's preproduction stamp and a saved node recovery key before making the archive. Supply a genuinely signed P000042 restore allocation, bound to that key event and all FA/FF/RE purposes, through the real recovery runner and prepared hook. Keep every recorded sale, record, huella, chain, taxpayer, location, money and series fact unchanged. |
| `restore-command.archive.test.ts:451,456–458`, sorting by numeric installation and requiring the new installation to clear the clock floor | Order by registration time. Require exactly P000042, and additionally require that it differs from the old identity. Retain the two-SIF count, old revocation and new active checks; all six series rows with their original purposes and next-number assertions; byte-preserved fiscal rows; workforce chain and next sequence; source-live refusal; encryption-key selection; file cleanup and secret-free messages. |

The candidate retains the original before/after history comparisons and the complete series
array. The new identity is a literal supplied by signed evidence; the expected value is not
computed from the code being tested.

## Run receipts

An independently cloned, frozen offline-installed candidate applied this proposal and the
branch's other uncommitted work. The archive suite and the new asynchronous-target regression
passed 36 cases; the server type command passed. The candidate and its parent were removed.
Lane E retains the exact proposed source, its SHA-256 and command logs in
`receipts/w41s4-proposed-archive-restoration.test.ts`,
`receipts/w41s4-archive-proposal-candidate.json`,
`receipts/w41s4-archive-proposal-green.log` and `receipts/w41s4-archive-proposal-types.log`.
These runs qualify the proposal, not the still-unmodified archive suite on the feature.

The rebase also exposed an archive caller that did not await the now-asynchronous target resolver.
A new test observed exit 1 and a download refusal instead of a resolved target and exit 0.
Adding its missing await passed that case without editing any existing check. All six schema
and populated-upgrade guards passed 409 cases; the rebuilt fiscal migration passed the four
empty/populated/checked-orphan/unchecked-orphan controls. The protected fiscal pair stays unchanged.

Task 4 remains unpublished. On A, apply only the concrete proposal, run the original archive
suite and types on the feature, then both FULL Claude reviews, the normal push hook, current-head
CI and authorised landing. B requires revisiting the callers while retaining the checks.

## Owner answer and feature qualification, 2026-10-14

The owner selected A at 15:25, approving exactly both rows. The feature applied the retained
proposal and passed the original archive and asynchronous-target suites: 36 cases. Server types
and focused lint passed. The earlier paragraphs record the proposal before that answer.
