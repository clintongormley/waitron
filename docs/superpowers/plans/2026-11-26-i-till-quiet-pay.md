# Quiet Pay (PRs 15, 15b and 15c)

## PR 15. Table Pay

Staff open Pay from the table bill in a full-screen modal on a phone or till. Match q1, with stacked ways and the amount block from ah 2, in [spec §§7.2, 7.11, 12 and 14](../specs/2026-11-26-till-handheld-redesign-design.md). Measure against the approved `html/ah-{light,dark}.html`, `q-{light,dark}.html` and `base.css`. Note the temporary full-screen layout on wide tills in the picture comparison. Compose the five pieces from [PR 15a](2026-11-26-i-till-pay-primitives.md) once they land. Lane I builds them all (watcher, 21:53). Use the bar's shared back icon and put the card and contactless icons with Pay, reusing registered icons if they match. Counter and docking follow in PR 15b (21:18).

Use the shared `wt-dialog` full-screen option and `wt-full-screen-panel`. Name the modal through its existing `ariaLabel`. Put refusal text and recovery links in the panel's footer above the actions. Back and Escape use the existing close and draft checks. Give the shared `wt-amount-block` the muted label, formatted amount and breakdown. Check keyboard inset, focus, fixed footer, one visible refusal and close through the Pay tests.

`widgets/quiet-pay.ts` composes the five controls for `bill-pay-dialog.ts`. Staff reach it from the table bill’s Pay entry points or from Pay in parts on the current presented-bill dialog. Keep the opening amount and small staff tip link. Charge opens the existing allocation confirmation, with guest count and own receipt. Keep the server's `confirmAllocation` check. Cash and Other card machine open their existing entry fields. The equipment button opens the current controls. The table bill row still offers Full invoice. The saved-invoice summary in q2 and the presented bill’s whole-payment opening follow in one slice under the watcher’s 23:10 clearance.

Widget suites cover the opening layout, tip and tender choices. App suites preserve checks on exact amounts, changes, refusals, retry, pending payments and charging the reader picked through NFC. Update EN/ES guides, design system and backlog. Keep split rows 16–21b marked O. Budget up to about 570 added product lines for PR 15 and 350–500 added test lines. Count the two pure moves separately. Report the measured diff before opening the PR.

## PRs 15b and 15c

15b opens the same panel from Counter's tender Pay, keeps the recipient-before-Pay rule over the simplified-invoice limit, and docks it in the wide order column as frame m describes, once Lane N's wide order shell is on main. The caller wires the bar's Back through the existing dialog close check when modal, or through the existing draft leave check and return focus when docked. 15c uses the read-only quote and moves the checked amount and required receipt and guest inputs onto Pay before direct Charge or Cash. Keep draft, kitchen, late-send/PIN and exact resend checks. Size and review each separately before its build.

For each PR, put 390 px light and dark captures beside the approved frames, in addition to the phone and till matrix. The watcher gets Lane P's Impeccable finish review before the owner sees the pictures. Lane I lands after the watcher records the owner's picture OK and current-head CI passes. Each branch gets two Claude run-it reviews. Stop and re-ask if a change touches receipt or invoice issuance or filing.
