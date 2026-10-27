# A739: approved payment and receipt flow

These eight static boards show the owner's approved 27 October flow: take payment, then choose
Receipt / Full invoice / None, with separate Print and Email actions. Each card reader has
**Prints its own slip automatically**, initially off. When off, payment offers **Print card slip**,
also initially off. When on, Waitron offers no extra card slip. Waitron does not control the
reader's printer. Cash and manual card have no payment slip.

Closing or losing the final choice means None. An unattended settling edit also means None.
There is no pending document task, timer or zone fallback; accepted slips and deliveries remain.
You can deliberately reprint later from the paid view or Orders. The four journeys remain:
Counter EUR30, three EUR10 payers, an edit reducing EUR30 to the EUR10 already paid, and a later
full-invoice request. The checked card box in the Counter journey illustrates an explicit request,
not its initial value.

F1 stays enabled in every environment after E/A948 lands, within that change's route scope;
A555 still owns the Counter limitation. These drawings' expanded Full invoice case starts with
an **issued F2**, so its replacement and delivery remain a target under A556. Existing F1
delivery uses the recorded invoice. No drawing authorizes new issuance, changes an immutable
receipt, takes another payment or opens a drawer.

Read the [authoritative addendum](../../../superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md)
and [implementation plan](../../../superpowers/plans/2026-10-27-a739-approved-payment-flow.md).
Earlier conflicting questions and native-control/pending-choice proposals remain in the historical
spec bodies; they do not describe these current boards.

| Language | Theme | Width | Native artwork           | Same-name PNG target     |
| -------- | ----- | ----- | ------------------------ | ------------------------ |
| English  | Light | 390   | [SVG](en-light-390.svg)  | [PNG](en-light-390.png)  |
| English  | Dark  | 390   | [SVG](en-dark-390.svg)   | [PNG](en-dark-390.png)   |
| Spanish  | Light | 390   | [SVG](es-light-390.svg)  | [PNG](es-light-390.png)  |
| Spanish  | Dark  | 390   | [SVG](es-dark-390.svg)   | [PNG](es-dark-390.png)   |
| English  | Light | 1280  | [SVG](en-light-1280.svg) | [PNG](en-light-1280.png) |
| English  | Dark  | 1280  | [SVG](en-dark-1280.svg)  | [PNG](en-dark-1280.png)  |
| Spanish  | Light | 1280  | [SVG](es-light-1280.svg) | [PNG](es-light-1280.png) |
| Spanish  | Dark  | 1280  | [SVG](es-dark-1280.svg)  | [PNG](es-dark-1280.png)  |

All eight PNGs were regenerated from the matching SVGs in headless Chromium on 27 October.
The driver inspected the reader-setting and settling-edit panels in both languages, themes and
widths. No text extends beyond the SVG's horizontal boundary in those renders. Phone boards stack
the screens; desktop boards use three columns.

The SVGs use native text, rectangles and paths, without embedded images, scripts or external
assets. Palette literals follow the existing token snapshots in `packages/ui-core/src/tokens/colors.css`.
The Receipt form shows a retained invalid email, inline error and one bottom correction message;
Print remains a separate action. The replacement-invoice delivery is disabled for A556.

These are design snapshots. They establish no running-product, accessibility-test, physical-print,
inbox-arrival or fiscal-verification result. Runtime transitions and failure recovery are checked
during implementation.
