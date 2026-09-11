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
