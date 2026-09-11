# Printer settings review

The finish-branch review used Claude Opus 5 with read-only repository tools against base
`c455ebaa7e7665fe6f3fe5d6f05e8bbc525b049e`, candidate `37033cab`, and took 371 seconds.
Codex verified the findings and made the corrections below. No second whole-branch review was
needed: the fixes preserve the design and API boundaries.

| Finding | Disposition and evidence |
| --- | --- |
| M1: removing open editors skips native close/focus restoration | Accepted. New browser tests first observed zero `wt-close` events on Cancel. Editors now close before their drafts are removed. A keyboard test then observed focus on `BODY` after editing through the row menu; the editor now remembers and restores its visible trigger. |
| M2: earlier printer designs describe deleted forms | Accepted. Added dated pointers to the current design, retaining the historical text. |
| M3: long receipt preview cannot scroll by keyboard | Accepted. A 100-line preview failed axe's `scrollable-region-focusable` rule. The modal body is now focusable; the same test passes axe and verifies PageDown changes `scrollTop`. |
| M4: printer Delete should gain agent-style confirmation | Rejected as a behavior change beyond this redesign. `git show c455ebaa:apps/dashboard/src/screens/printers-screen.ts` retains single-click printer deactivation and two-click agent revocation. Both existing assertions remain; “reactivates a cloud_poll printer…” verifies recovery through Edit. |
| M5: hostname and first-frame claims lack receipts | Partly accepted. The compose test now claims only to pin `network_mode: host`. The positioning concern was tested: moving positioning back to `toggle` made the existing first-frame test fail, with top 0 instead of 248; restoring synchronous positioning passes. |
| L1: stale comments | Accepted; corrected the state/mutation/error-registry/test descriptions. |
| L2: component/style conventions | Partly accepted: restored the cloud-field help tooltip, removed unused imports/styles, and gave the native active control a token-sized label target. Native named inputs remain because `wt-switch.ts` does not expose a semantic `name`, which the form contract requires. Table cell styles remain inline because cells render inside `wt-data-table`'s shadow root (`wt-data-table.ts`, `render`); replacing them with screen classes failed the landscape Add-button visibility assertion (right 614.47 beyond modal right 558.80). |
| L3: Close on inconsistent footer sides | Accepted; preview now uses the same `wt-form-actions` cancel slot. |
| L4: printing-rules accessibility coverage | Added loaded, empty and error-state checks in both themes. Kept them in the existing behavioral test file: they invoke the same axe helper and run under the same unfiltered package command. |
| L5: permission notes did not move with reads | Accepted; restored the permission relationship beside the moved reads. |
| L6: blank agent host renders an empty cell | Accepted. The new API test failed on a whitespace-padded hostname, then passed after trimming and normalizing blank reports to null. |
| L7: repeated host updates | Accepted; the update now requires the stored host to be distinct from the report. |
| L8: explicit default port duplicates the server default | Rejected as a present defect. This screen already uses 9100 for device identity and address display, and the server's discovery matching uses the same value; the existing discovery registration test pins the submitted connection. |
| L9: local registered state differs from the wire DTO | Clarified the local merge's purpose: retain a successful addition when refresh fails. The DTO still documents the wire response. “keeps a successfully added printer registered when refreshing discovery fails” verifies the local behavior. |
| L10: unused strings and missing Bluetooth pairing pointer | Accepted; restored the setup-page pointer and removed unused keys from both locales. |
| L11: lost styling and unused rules | Accepted; restored origin/empty/provenance treatments and removed unreachable rules. Table-cell styling follows the shadow-root constraint recorded under L2. |
| L12: preview test deep-imports printing | Accepted; uses the package barrel. |
| L13: timestamp parsing relies on Node accepting PostgreSQL text | No code change. The API test executes the aggregate and pins its ISO output, including a timezone offset in the source value. Portability to a different JavaScript runtime was not verified; this server runs on Node. |
| L14: duplicate modal and page error alerts | Accepted; while an editor is open, errors render inside its modal. |
| L15: viewport changes leak to later tests | Accepted; viewport-changing cases restore it in `finally`. |
| L16: modal close listener attached too late | Accepted; attached before changing `open`. |
| L17: plan lacks repeatable validation commands | Accepted; added the package and repository commands with their success criteria. |
| L18: edit draft carries routing/statistics fields | Accepted; construct only the editable hardware fields. |
| L19: screen invariants were removed with commentary | Accepted; retained a short server-permission and localized-error invariant. |
| L20: unrelated loading message shared with pairing | Accepted; tables have their own localized loading message. |

Verification after corrections: 122 focused dashboard tests, eight shared modal tests, fourteen
printer accessibility tests, and 93 server API/preview tests passed. The complete repository gate
passed before these review corrections; affected checks and the unfiltered dependent-package
pre-push coverage gate validate the final changes.

The reviewer did not execute tests or audit every generated snapshot line. Codex ran the actual
schema migrations through the repository gate. Physical Bluetooth/network discovery and printed
paper layout were not exercised by this review; this branch's preview explicitly reports its text-only
limitations. No finding requires a product decision before opening the pull request.
