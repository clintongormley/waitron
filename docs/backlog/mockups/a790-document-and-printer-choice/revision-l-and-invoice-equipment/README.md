# A790 revision L and Invoice Equipment, 2026-10-19

**L is agreed. M is proposed only. A–L retain their precise answered scopes; the full
design, plan and build remain unapproved.** These boards illustrate the
[current precedence addendum](../../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md).
They supersede the prior L alternatives for this question, without rewriting historical assets.

## Read the three comparisons

**L, dashboard, agreed:** in the same normal shared browser, Ana's accepted/completed
Harbour F/1042 Receipt on Patio starts Luis's form on Patio while eligible. Bar is also
eligible. The next card shows Luis's explicit Bar selection and named final confirmation.
There is no Forget control. Selection alone leaves Patio remembered; server acceptance
replaces it. Cancel-before-submit/refusal leave it alone, and an unknown or late outcome
must reconcile under the same request identity. Harbour Invoice's Office · A4 and Hillside
Receipt's Hillside bar remain independent. Site-data clearing is outside this form, cancels
no pending print and must not discard its identity. No additional expiry or reset is proposed.
K still keeps a successful-empty form open with an explanation, quiet disabled Print,
explicit offers-only Refresh printers and Cancel. Loading/read failure/unknown submitted
print are separate. Refresh never prints or polls, reveals no inaccessible equipment and
cannot auto-select a restored printer mid-form.

**M, authenticated device, recommended proposal:** Ana's Harbour phone starts with Equipment
Invoice Office · A4. Her current profile permits both Office and Terrace belt for Invoice,
with A4 and receipt paper both eligible. She explicitly chooses Terrace in F/1042's expanded
inline Invoice row. The detail card shows a save in progress, explicitly not yet confirmed.
Only the subsequent successful-save example shows Equipment Invoice Terrace. The next
new Invoice form, F/1043, starts on Terrace while still eligible. A refused save is not saved; an unanswered save is not yet confirmed. The recommended shared setting applies at/after payment, only when the device
and person may change Equipment; it grants no permission. It is the same existing Invoice
setting, with no second invoice-history preference or new preference storage.

**M, alternative proposal:** choose Terrace only for F/1042, then give named final
confirmation. Equipment Invoice stays Office, and the next newly opened F/1043 Invoice
starts Office while eligible. Receipt stays **Bar receipt** in both alternatives.

Cards labelled **UI** show screen snapshots or explicitly cropped row details. Text outside
them is **design explanation**, not extra form controls. Sequential cards illustrate
separate moments, not simultaneous windows. The future form assumes a future recorded sale,
not a new issuance caused by choosing or saving. Named copy buttons assume the server has
designated those deliveries as copies; the server owns original/copy status. Choosing or
saving never prints. An accepted print establishes no physical-paper outcome. Cancel sits
left and the named final action right where actions are shown. Save timing, concurrency,
permissions, failures and late-identity handling remain builder/design work; do not infer
them from A796 Receipt or claim an atomic combined save+print. A successful write followed
by failed refresh remains a load failure. Once submitted, F/1042's fixed request context
cannot be rerouted by later Equipment settings.

## Boundaries retained

Initial device Invoice choice remains the eligible device setting, else eligible profile
Invoice default under Q2. Offers use the current profile's mixed-paper invoice list,
permissions, eligibility and sale location. Q4 permits a belt printer through that list
without an exclusive Invoice holder check. Portable Receipt holding remains a separate
open question. Phone Receipt's one Equipment setting and A796 Revision 4 remain unchanged.
Dashboard browser memory stays acceptance-triggered under F. M changes no dashboard setting.

A keeps identical recorded full-invoice/customer facts in both formats. B keeps all active
sale-venue dashboard printers including A4/portable under authorization/offers/Orders/device
restrictions, without profile selection, till identity or dashboard Equipment changes.
C keeps inline foldable Invoice; D keeps direct simplified Receipt with facts/language,
no F1 conversion/email. E/H/I keep browser memory shared across logins by venue/document
through ordinary reopening, with site-data clearing forgetting it. G/J govern only newly
opened fallback, never mid-form replacement or submitted rerouting. Q1–Q6 retain precise
scope under A–L, including named printer actions, Q2's email path, Q5's Devices **· A4**
and Q6's **A4 printers**. Do not reopen A–L or A796.

Keep sale/document/printer/language/context frozen under request identity; recheck current
authorization/location at reservation; reconcile unknown/late outcomes under the same
identity before fresh work. Retain successful-write versus failed-refresh, server original/
copy, shared F1 delivery guard and closed public F1 issuance. No payment/fiscal/drawer
effects. M, technical storage/errors/private lifecycles/concurrent-late intents/account
transitions, portable Receipt holding, wider steps, integration and full design/plan/build
remain open. A799 is not advanced.

Source reading only, not runtime verification: `packages/db/src/schema/devices.ts:50`
(`invoicePrinterId`) and `:55` (`invoicePagePrinterId`), plus
`apps/till/src/widgets/equipment-dialog.ts:50` (Invoice role and field). These readings
establish existing vocabulary, not that an inline selector performs the proposed update.

## Native SVG sources

| Language | Theme  | Phone, 390 × 1490                             | Desktop, 1280 × 850                            |
| -------- | ------ | --------------------------------------------- | ---------------------------------------------- |
| English  | Light  | [SVG](no-forget-and-invoice-en-light-390.svg) | [SVG](no-forget-and-invoice-en-light-1280.svg) |
| English  | Dark   | [SVG](no-forget-and-invoice-en-dark-390.svg)  | [SVG](no-forget-and-invoice-en-dark-1280.svg)  |
| Español  | Claro  | [SVG](no-forget-and-invoice-es-light-390.svg) | [SVG](no-forget-and-invoice-es-light-1280.svg) |
| Español  | Oscuro | [SVG](no-forget-and-invoice-es-dark-390.svg)  | [SVG](no-forget-and-invoice-es-dark-1280.svg)  |

The drawings use native SVG shapes and text, with no script, foreignObject or external
asset. Colors are static snapshots copied from the explicit light/dark token blocks in
`packages/ui-core/src/tokens/colors.css`, not a new palette. Spanish UI is translated;
example venue/printer names stay fixed. Phone drawings are at most 1500 px tall.

All eight final PNGs were rendered from these native SVGs inside an HTML wrapper in headless
Chromium and individually inspected. Native text bounds were checked inside every drawing.
These are static drawings, with no runtime, accessibility, legal or physical-output evidence.

## Rendered PNGs

| Language | Theme  | Phone                                         | Desktop                                        |
| -------- | ------ | --------------------------------------------- | ---------------------------------------------- |
| English  | Light  | [PNG](no-forget-and-invoice-en-light-390.png) | [PNG](no-forget-and-invoice-en-light-1280.png) |
| English  | Dark   | [PNG](no-forget-and-invoice-en-dark-390.png)  | [PNG](no-forget-and-invoice-en-dark-1280.png)  |
| Español  | Claro  | [PNG](no-forget-and-invoice-es-light-390.png) | [PNG](no-forget-and-invoice-es-light-1280.png) |
| Español  | Oscuro | [PNG](no-forget-and-invoice-es-dark-390.png)  | [PNG](no-forget-and-invoice-es-dark-1280.png)  |
