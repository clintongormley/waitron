# Printer follow-ups review

Claude Opus 5 ran an isolated, twelve-command review against base
`6777d4909ab25b5d7fc4beefafd1ec90bb89e51e` and candidate `ff5d030a`, taking 156 seconds.
The candidate was an independent temporary clone with locked dependencies installed.

| Finding | Disposition and experiment |
| --- | --- |
| Routing-switch assertions read host state instead of the visible native input | Accepted. The helper now reads the inner checkbox. With the host-state update suppressed but the emitted change value retained, the corrected rejection test failed with `true` instead of `false`; the former host assertion passed on the same broken component. Restoring production code passes the two unfiltered printer/routing suites. Removing only the assignment also broke several write assertions in the driver's run, so the review's broader claim that this single-line mutation passed the whole suite was not reproduced. |
| Large QR symbols can consume most of the bitmap budget | Retained as a documented resource policy. The tests bound cumulative bitmap bytes, require an omission notice, retain QR text and verify subsequent text survives an omitted large symbol. No claim of full graphics fidelity is made after a bound is reached. |
| The block limit can truncate before the character limit | Clarified in the decoder header and design. The alternating text/cut test reaches the 2,048-block limit and requires `truncated`. |
| Model-1 QR commands stop interpretation | Retained and documented: the decoder supports the builder's model-2 commands. The claim that model selection lacks a length check is rejected: the existing `(fn === 0x41 && length !== 4)` guard precedes parameter reads; a malformed model-selection regression now exercises it. |
| Shadow-part styling was not verified by the reviewer | The driver added a computed `overflowWrap` assertion beside the existing portrait/landscape bounds checks. Changing the part selector to a nonexistent name failed with `normal` instead of `anywhere`; restoring it passes. |

The review did not run live re-add, preview browser rendering or tenant-isolation probes. Driver
coverage ran the complete UI, dashboard and server packages, including existing permission and
tenant tests. Browser tests cover visible recovery, table filters, USB/Bluetooth/TCP re-add,
paper colours in both themes, bitmap pixels, ordered blocks, paper-width choice and keyboard scroll.
These checks do not establish physical Bluetooth behavior or paper fidelity.

The full repository gate additionally found that an intentional failing browser test leaves a
`.test.ts` screenshot directory which the vocabulary scanner tried to read as a source file.
The new fixture first returned both that directory and its nested source; `sourceFilesIn` now
filters with `isFile()`, retaining the source. `pnpm exec vitest run scripts/english-only.test.ts`
passes with the actual screenshot directory still present.

## Review after rebasing onto #320

Main independently landed the same scanner fix and a stronger fixture. The rebase retained both
from main. A fresh isolated Opus 5 review of `bb4f3d05` → `b7a1d45b` took 197 seconds and found
no Critical or Important defect. Real-Postgres probes exercised deactivation, discovery, duplicate
creation and two concurrent reactivations: the duplicate returned 409, both reactivations returned
204, and the ID, name, ticket scope and delivered-job timestamp survived. Mutation probes made the
three transport re-add tests fail, and removing `data-keep-open` failed the delete-menu test against
main's shared row actions. The three affected dashboard suites passed 124 tests in that candidate.

| Minor finding | Disposition |
| --- | --- |
| Put the DateStyle receipt beside the aggregate | No additional comment: the API regression and this review record carry the experiment; the design already explains numeric milliseconds. |
| Base64 expands the decoded bitmap budget | The design explicitly names decoded bytes. This is not a total JSON response-size cap; text summaries and encoding add overhead. |
| Feed/block limits stop parsing while omitted images allow later text | Retained bounded-decoder policy, explicitly flagged by `truncated` and pinned by the limit tests. |
| Closing and reopening a row menu may leave Delete armed | Unverified by the reviewer; retained the existing agent-confirmation pattern for this slice. A consistent reset-on-dismiss policy across destructive row actions remains a follow-up. |
| Plain-text summary has no current widget consumer | Retained the explicitly specified text summary alongside visual blocks and its behavioral assertions. The widget uses the blocks. |

The driver swept current and historical prose and added the missing disabled-match pointer to the
central-provisioning design. The existing browser injection fixture includes HTML-looking text and
a `javascript:` QR value; the passing suite requires literal text, no anchors/scripts and generated
image data. The review did not exercise physical devices.

The first post-rebase push failed before eleven UI suites could load, reporting "Vitest failed to
find the current suite/runner". An unchanged complete UI coverage run passed, followed by the whole
push hook (245 seconds). Cause unconfirmed; the failed log is retained at
`/tmp/waitron-printer-rebase-push.log`. No cache deletion or source change was needed for those passes.
