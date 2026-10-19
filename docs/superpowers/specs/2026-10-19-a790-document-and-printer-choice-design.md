# A790: choose a document, then its printer

**DESIGN PROPOSAL, 2026-10-19. Not approved for build.** You should be able to print an
existing sale without guessing whether “A4” names a document or a destination. Choose what
you want, see the permitted printers by name, then explicitly confirm the destination.

This proposal separates the owner's settled answers from four recommendations. Only the
first owner question below is ready to send once the parent's board and review are ready.
Decisions B–D remain **unapproved and queued**;
an answer to A alone does not authorize implementation. Static mockups accompany the proposal. A fresh builder check found no additional blocking
questions beyond A–D and the explicit persistence agreement; those decisions remain open. Agree the complete
design before planning or building. No implementation, tests or hardware experiments ran
in this design task.

## The one owner question to send first

**A. For a sale that already has a full invoice, should “Receipt” print that same full
invoice in the compact receipt layout, with its customer details and existing invoice
number, through the receipt-printer list, while “Invoice” uses the invoice-printer list
(including receipt-paper printers), as recommended below?**

Accompany this question with board A described in the [mockup brief](../../backlog/mockups/a790-document-and-printer-choice/README.md).
Do not send questions B–D alongside it. After A is answered, revise the affected examples
and boards, then take B, C and D in that order. No recommendation here is an owner answer.

## Settled: the owner's Q1–Q6

Authority: the owner's answers to A661 Q1–Q6, recorded on 2026-10-17 around 18:40
and transcribed below. The four outstanding design topics are A–D in this proposal.

| Answer | Required behavior                                                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1     | Always name the printer, including A4: “Print on {printer}”, “Print a copy on {printer}”, “Send to {printer} again”. Spanish: “Imprimir en {printer}”, “Imprimir una copia en {printer}”, “Volver a enviar a {printer}”.                                        |
| Q2     | Once a customer requests a printed full invoice at payment, ask where to print it. Offer the device profile's invoice list, both receipt-paper and A4 printers. Put the device's own eligible choice first, otherwise the eligible profile default. Keep email. |
| Q3     | One print/reprint entry point in the till sale view and dashboard Orders. Choose receipt or invoice first, then use that document's profile list. The precise meaning for an already full-invoice sale, dashboard context and skips still need agreement.       |
| Q4     | A portable belt printer on the invoice list can print invoices for anyone permitted to use that list. Do not introduce an exclusive holder check for the invoice role.                                                                                          |
| Q5     | Keep the accepted A4 identification convention and add “· A4” to the Devices table's Invoice printer value.                                                                                                                                                     |
| Q6     | Keep the Printers tab's “A4 printers” wording.                                                                                                                                                                                                                  |

These answers do not authorize public full-invoice issuance or a new kind of fiscal document.

## A. Receipt versus invoice on an already full-invoice sale

**Recommended default, unapproved:** “Receipt” means the compact rendering of the **existing
full invoice**, using the receipt role. “Invoice” means delivery of that existing full
invoice using the invoice role, with layout determined by its destination. A receipt-paper
invoice printer still prints the full-invoice compact layout. Paper size never changes the
sale's recorded invoice type. Both paths retain the customer, invoice number, date, amounts
and fiscal reference already recorded; neither creates another fiscal document, number,
sale or fiscal record.

Example: table 12 paid €86.40 under full invoice `F/1042`, addressed to Mar Azul SL. The
Counter profile lists **Bar receipt** for receipts and **Office · A4**, then **Terrace belt**
for invoices. You open Print/reprint and choose:

- **Receipt**, described as “Compact full invoice”, then Bar receipt. The paper shows
  `F/1042` and Mar Azul SL, including its recorded customer details.
- **Invoice**, described as “Full invoice on an invoice printer”, then Office · A4 or
  Terrace belt. Office lays it out on pages; Terrace belt uses the compact full-invoice
  layout. This can produce the same layout as Receipt when a printer appears on both lists.

The server decides original versus copy across **both** paths and email. If the original
email has completed, both paper choices offer a copy of `F/1042`. If nothing has completed,
the eligible request is an original, subject to the existing delivery rules. The chooser
does not offer an “Original” switch.

Alternatives and consequences:

| Alternative                                                              | Consequence                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offer only “Full invoice”, then its permitted printers                   | Clearest content model, but removes Q3's receipt-list route for an F1 sale. Requires an explicit amendment to Q3.                                                                   |
| Treat “Receipt” as a new payment acknowledgement without invoice details | A separate new document definition and layout would need design. It cannot masquerade as a simplified invoice or replace delivery of the full invoice. Outside this build proposal. |
| Treat receipt versus invoice as receipt paper versus A4                  | Conflicts with Q2's explicit inclusion of receipt-paper invoice printers. Do not use this interpretation.                                                                           |

Keep the two choices only if the owner accepts the overlapping content and different routing.
This is the first decision because it determines every later board and the server's offers.

## B. Dashboard Orders without a device profile

**Recommended default, unapproved:** display an explicit **Printer profile** context in the
chooser. Suggest the sale device's **current** non-retired profile only while that device
is active and still at the sale's location. Label it as current, not “profile at sale”.
If that suggestion cannot be made, require a profile choice. Offer non-retired profiles
that allow printing and have applicable equipment at the sale's location. Treat profiles
as reusable across locations and filter their equipment by the sale. Selecting one uses
its lists, not a device login or identity. Source-read, unverified: the profile schema at
`packages/db/src/schema/device-profiles.ts:33` has no location column.

Example: on your home laptop you open `F/1042` from the Harbour location. The original
device Counter 1 currently uses Counter. The dialog says **Harbour · Counter (current
profile of Counter 1)**. Invoice lists Office · A4 and Terrace belt. A printer at the
Hillside location never appears, even if the dashboard is currently viewing Hillside.
If Counter 1 was deleted, you choose an applicable profile before choosing a printer.
Keep Counter 1 as the historical device label. Source-read, unverified:
`packages/db/src/schema/sales.ts:72` stores a device reference, not its profile snapshot.

Put the selected profile's eligible default first, then its stored list order. There is
no dashboard device choice. Do not remember this as a venue-wide preference or change
any device's saved choice. Show **Change profile** so a manager can deliberately use
another applicable list; the profile selection controls equipment, while the management
session controls authorization to the sale.

For the **Receipt** role, retain a device holder context for portable printers. Recommend
excluding them from this device-free dashboard route, with an explanation when this leaves
no receipt destination. The same belt printer remains eligible under **Invoice**, per Q4.
The dashboard must not take a belt printer away from a device. This restriction is part of
unapproved B, not a settled owner decision.

| Alternative                                                            | Consequence                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Always use the sale device's current profile, with no profile selector | Fewer choices, but historical sales can lose all print access when their device is retired, deleted or moved.                                                |
| Keep every active printer at the sale's location                       | Simple management recovery, but bypasses profile lists. This is an explicit dashboard exception to Q3 requiring approval, not an inferred manager privilege. |
| Configure a dedicated dashboard print profile                          | Predictable and independent of historical devices, but adds a setting and an operator setup task.                                                            |

If the browser also has a valid device identity, retain that device's action restrictions
and intersect them with the selected context; choosing a profile must not bypass a refusal.
Never acquire a device session on behalf of the sale's original device.

## C. Small screens, defaults and single-printer skips

**Recommended default, unapproved:** use one shared dialog with sequential content rather
than nested dialogs. On a 390px phone, opening **Print/reprint…** first shows the sale
number and the two available document choices. Choosing one replaces the body with its
printer choices and a document summary. Back returns to the document choice without
printing. On a wider till, keep the same order in one column. The dashboard adds B's
visible profile context before listing destinations.

Example: Ana opens `F/1042` on a handheld. She chooses Invoice, sees Office · A4 marked
Default above Terrace belt, selects Terrace belt and presses **Print a copy on Terrace
belt**. Choosing a row only selects it. If Terrace belt is the only eligible printer,
replace the picker with its visible name and summary, but retain that final print press.
If she chose Receipt instead, Bar receipt is the single destination and the button says
**Print a copy on Bar receipt**. Never print merely because a list finished loading.

At payment the document is already Full invoice, per Q2. Do not ask Receipt versus Invoice
again. Keep recipient entry and delivery choice within the existing draft flow. Selecting
**Print** reveals only the invoice list, with the device's eligible explicit choice first,
otherwise the eligible default, then remaining printers in profile order. Show “· A4” in
picker rows; final buttons use the actual printer name, per Q1. Email keeps its own address
field and validation. There is no hidden switch back to the receipt role.

A delivery choice saved before payment is staging, not a queued job or a print completion.
Show it in the final payment summary as **Full invoice · Print on Office**, for example.
The explicit payment confirmation authorizes that staged delivery; choosing a printer or
saving recipient details does not print immediately. Later print/reprint requests always
require their own named print confirmation.

Skip a document picker only when exactly one document is available, as recommended in D.
Skip a printer picker only when exactly one **eligible** destination remains; show its
name. With multiple printers, preselect the eligible device choice/default. Without either,
leave the selection empty rather than silently promoting another printer to default.
Zero destinations shows a specific explanation and no enabled print action. Loading and
failed reads have distinct messages and a read retry, never “No printers” as a substitute.

| Alternative                                                    | Consequence                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Show document and printer fields together at phone width       | Fewer transitions, but a document change can invalidate a printer below it. Clear it explicitly and keep the final confirmation. |
| Keep every one-option picker                                   | Most consistent structure, at the cost of unnecessary taps.                                                                      |
| Print immediately on the only printer, or upon selecting a row | Fewer taps but removes destination confirmation and makes asynchronous list changes actionable. Not recommended.                 |

Use existing `wt-dialog`, field primitives and `wt-form-actions`, semantic field names and
declared `--wt-*` tokens. Keep Back/Cancel and the final action visible while the body
scrolls, allow long printer names to wrap, return focus to the opener, and preserve keyboard
navigation. No new primitive is proposed. Follow the existing draft-leave contract for
staged recipient/delivery edits. A command such as Print becomes active once its choices
are valid; it is not an unchanged Save form. See `docs/developers/design-system.md:2208`
and `docs/developers/conventions-ui.md:58`.

## D. Simplified sale reprints

**Recommended default, unapproved:** offer **Receipt only** for a sale recorded as a
simplified invoice (F2). Skip the document picker and state “Receipt · Simplified invoice
S/318” above the receipt-printer list. Preserve the offered receipt-language choice where
that surface already supports it; default to the sale's recorded language. Keep the sale's
recorded receipt facts, including its saved guests count. Do not add invoice issuance,
customer details, substitution, an A4 option or email to this reprint action.

Example: Luis reopens the €14.50 counter sale `S/318`, recorded as F2 in Spanish for one
guest. Print/reprint goes straight to Receipt, with Bar receipt first and Patio receipt
second. He chooses Patio receipt, retains Spanish and presses **Print a copy on Patio
receipt**. The copy keeps `S/318`, €14.50 and the stored guest count. The action does not
turn the sale into a full invoice. On the dashboard, B's profile context still applies.

| Alternative                                              | Consequence                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Show the document picker with only Receipt enabled       | Teaches the common flow but adds a tap; disabled Invoice needs a clear explanation.           |
| Offer “Invoice” as another label for the same F2         | Suggests an F1 is available when it is not; reject this wording.                              |
| Offer a separate full-invoice issuance/substitution flow | A different fiscal feature with its own gate and design. It must not be triggered by reprint. |

Keep payment slips, tender-refund receipts, kitchen tickets and drawer actions separate.
Historical transaction receipts without an ordinary working-order route need explicit
coverage through their sale-id path, not a fabricated order id. Retain their current
document identity; this proposal does not define a new print format for credit notes.

## Builder contract, conditional on complete approval

These are proposed implementation requirements, not claims that the current system already
meets them. Do not implement individual Q1/Q5 patches under cover of this design task.

### Server offers and authorization

- Compute offers for the particular sale/order, document and authenticated context on the
  server. Recompute inside the transaction that reserves the delivery/job. Check the
  device's active session and current profile/action/zone on till writes, plus the person's
  existing authorization. A selected id, a UI capability or a past offer is not permission.
  For an already committed request replay, recheck session and sale visibility and return
  its accepted history without generating work, even if its destination is now withdrawn.
- Retain dashboard management-session resolution and Orders visibility restrictions,
  including the restricted business-day scope. Printing remains under those rules; PDF
  export and email keep their `report.export` checks. A profile selector grants no new
  sale visibility, export or device permissions. Recheck any accompanying device identity.
- Offer receipt-role printers for Receipt; invoice-role printers for Invoice and printed
  full invoices at payment. Require active, non-deleted equipment at the **sale's location**,
  obtained from its server-side context. Before issuance use the order's actual location.
  Use that same location for printer eligibility, layout reads and queued work. Never use
  the dashboard filter, current till location or request-body location as a substitute.
- A till's portable receipt printer must already be held by that requesting device; show
  an unavailable reason otherwise and direct equipment changes to the existing equipment
  chooser. Do not silently take it over in a print dialog. Invoice-role holding stays
  ignored, including for a belt printer. Per-request printer choice changes no defaults.
- Preserve the server's shared F1 delivery state, original/copy designation, attempts and
  audit attribution across both document choices. Read and write through the same permitted
  list. Replace the current one-invoice-printer offer, and make the receipt choice use its
  permitted receipt list without becoming an escape from the F1 active-delivery check.
- The public full-invoice gate remains closed. Source-read, unverified findings below show `fullInvoices: false`
  and public F1 refusals. Payment designs describe the gated behavior for when separately
  authorized, not permission to enable it. Existing F1 delivery/reprint must not create
  or convert an invoice. Keep fiscal hashes, numbering, issuance and append-only invariants.
- Print/reprint enqueues only document work and associated delivery/audit/request state.
  No drawer payload, drawer job, drawer audit row, payment or settlement effect. The ordinary
  payment action retains its separate drawer policy.

### Requests, failures and changing equipment

Proposed request envelope: sale/order identity, document choice, printer id, language when
supported, request key, confirmed profile context and the F1 designation last shown. Derive
printer kind and location on the server. Treat the shown designation as a stale-offer check,
never an instruction to print an original. Return the accepted designation and job/attempt
id. Provide an authorized lookup by request key so uncertain clients can reconcile without
issuing another request. These are contract changes to agree, not existing API fields.

| Situation                                                                             | Proposed behavior                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double tap or response lost after commit                                              | Freeze the submitted sale, document, printer, language and context under one request key. Retrying that request returns the same reservation/job. A key reused for different intent is refused. A deliberate additional copy gets a new key only after another explicit print press. This is request deduplication, not a promise of exactly one piece of paper. |
| F1 delivery starts elsewhere while the chooser is open                                | The server's transaction refuses the conflicting request with the current delivery state. Preserve the chosen destination; show that another delivery is active and refresh. Never send through the receipt endpoint as a fallback.                                                                                                                              |
| Original becomes a copy before confirmation reaches the server                        | Return the current designation for review without creating work if it differs from the confirmed summary. Refresh the label and require another confirmation. No client-selected original/copy flag overrides delivery state.                                                                                                                                    |
| Printer disabled, deleted, moved, removed from the profile, or device/profile changed | Refuse new work against the stale selection. Clear only the invalid selection, explain beside it and reload offers. A changed profile invalidates dashboard context. An eligible newly offered default may be shown, but must be confirmed; never redirect the submitted request.                                                                                |
| Change after payment/capture has begun                                                | Do not roll back a sale/captured payment because a staged printer became unavailable. Keep the intended destination visible and record/show the failed or unavailable delivery. Offer recovery against the existing sale, with explicit confirmation; never silently print on another device.                                                                    |
| Change after a delivery has committed or been claimed                                 | Keep its recorded destination and existing deletion/disable handling. Removing a profile entry stops new requests/retries to it; it is not a cancellation of bytes already handed out. Show uncertainty when the old printer may still produce paper.                                                                                                            |
| Read fails, then succeeds after an action failed                                      | Keep read failure and action refusal separately. Read recovery clears only its own message. Preserve drafts and selection by id; do not reset them from a background refresh.                                                                                                                                                                                    |
| Old read/write resolves after Back, close/reopen, logout or another sale opens        | Bind completions to the dialog opening, sale, session, document and profile generation. Discard stale answers; an older request cannot overwrite a newer subscription snapshot, release a newer in-flight gate or update another sale's message.                                                                                                                 |
| Accepted write followed by failed status refresh                                      | Show the accepted destination and “Status unavailable”; do not label the print request failed or automatically resubmit it. Reconcile using its request key/attempt id. If the write itself is uncertain, show “Checking print request” and reconcile before offering a fresh request.                                                                           |

F1 replacement of an unclaimed queued A4/email original is a distinct explicit action.
Retain its server check against the exact attempt and whether it has been claimed. If A's
receipt route offers multiple printers, replacement must name the chosen eligible receipt
destination and confirm it. Do not automatically cancel, switch or duplicate a sending or
uncertain attempt. Retry retains the original destination while it is still eligible;
choosing a different printer is a new, explicitly confirmed delivery governed by current
state. Keep late-success history even when a newer attempt exists.

The dashboard print queue's existing Resend is a separate permissioned recovery surface,
not another document chooser. Leave its current policy unchanged in A790, identify the
remaining policy difference in the handoff/backlog, and do not claim profile-wide enforcement
across that route. Expanding its policy needs a separate owner decision.

### Say what happened, not what the paper might have done

After acceptance say **“Print request queued for {printer}”**, with a status read. Receipt
printing has a document-job id; A4 has a delivery-attempt id, so the UI must not require a
`print_jobs` row for both. Distinguish queued, sending/printing, transport-reported completion,
failure, printer hold and unknown outcome. A queued job is not paper; transport completion
is not customer handover. Keep any existing explicit handover confirmation separate from
the initial Print press. Unknown/held work can still produce paper, so a retry must explain
that risk without promising that the first attempt printed nothing.

### Persistence and migration proposal only

Reuse profile lists, defaults and F1 delivery media. Do not rename stored `receipt` to mean
“simplified invoice”: it also carries full invoices printed on receipt paper. Stage a
printed full invoice with an **explicit printer id and kind**, regardless of paper, rather
than resolving an unqualified `receipt` choice again later. The existing JSON column is a
candidate home; this is a proposed type/payload change, not a verified migration-free claim.
Update its storage, validator, party-bill projection, both till client contracts, recipient
draft and issuance consumers together. Do not infer permission from a stored destination.

Source-read, unverified: F1 has request keys (`apps/server/src/invoice-delivery-actions.ts:33`);
the receipt-copy paths read here expose no equivalent key (`apps/server/src/orders-api.ts:281`,
`apps/server/src/transaction-receipt-api.ts:43`). Recommend a small **local print-request
record** if no suitable existing facility is established in builder review: node id plus
request key, canonical intent and resulting job/attempt id, written atomically with the
reservation/job/audit. It covers the full submitted intent for both document choices; keep
the F1 delivery request key as well. Store plain sale ids without a foreign key across local
and transferred data. Compare the full intent on replay. Retain request results while their
referenced work is retained; a later retention design must not turn an expired key into a
fresh request silently.
This is non-fiscal request state, never a new fiscal record. A schema addition would require
an agreed migration/classification and retention choice; do not retrofit request meanings
onto historical audit ids. The builder should bring the concrete storage choice back for
agreement before build, rather than assume “probably no migration”. No migration or
backwards-compatibility code is authorized here, and no fiscal invariant change is proposed.

## Source map: read, unverified

**Every current-behavior finding in this table is a source-read finding, unverified at
runtime.** The reviewed checkout was `71f9344efa21cb1bdf3b15b081cbc548d38de5b5`.
Line references locate the read code, not passing tests. The builder must recheck changed
consumers after A773-1 and other intervening work. No legal or physical-printer claims follow
from these readings.

| Consumer traced                                 | Source-read finding (unverified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment choices, client and dialog              | `apps/server/src/till-api.ts:1935` resolves one invoice printer without sale context and returns it only when A4. `apps/till/src/api/client.ts:2202` describes that singleton; `apps/till/src/widgets/invoice-recipient-dialog.ts:134` offers receipt/A4/email, and line 159 serializes the choice. `apps/till/src/till-app.ts:4993` bounds the options read and line 5013 distinguishes openings.                                                                                                                                                                                                                                                      |
| Staging, storage, read-back and issuance        | `packages/db/src/schema/orders.ts:39` has receipt-without-destination, A4-id and email variants, stored at line 103. `apps/server/src/working-order.ts:3762` validates and saves it, resolving without the order's location at line 3769. `apps/server/src/parties.ts:43` projects it for bills, used at line 554; `apps/till/src/till-app.ts:11723` reopens that saved choice. `apps/server/src/invoice-choice-delivery.ts:26` validates; line 73 reserves A4/email, while receipt falls through. `apps/server/src/receipt-print.ts:273` consumes that result; `apps/server/src/working-order.ts:6192` also calls the reservation for unpaid issuance. |
| Till sale print UI and client request           | `apps/till/src/screens/till-ticket-view.ts:244` gives A4 generic labels; line 584 renders the delivery print action and line 932 a separate receipt-original action. `apps/till/src/till-app.ts:7506` sends the first offered printer; line 7562 makes a fresh request key per press and rereads status. `apps/till/src/api/client.ts:2728` posts the selected printer and request key; line 2779 posts the separate receipt action.                                                                                                                                                                                                                    |
| Till server authorization and offers            | `apps/server/src/till-api.ts:2308` offers the one resolved invoice printer at the sale location. Line 2334 checks session/device action, then calls the shared delivery writer through `zonedSale` (line 2290). Lines 2433 and 2456 guard separate receipt/reprint routes. `apps/server/src/device-session.ts:353` checks profile actions; line 368 reads an optional device, with null passing.                                                                                                                                                                                                                                                        |
| Profile lists, defaults and holding             | `packages/layouts/src/device-printers.ts:18` defines lists/defaults; line 104 replaces them and settles affected devices. `packages/layouts/src/device-equipment.ts:157` reads list membership; line 270 resolves choices/defaults, and line 26 excludes invoices/drawers from held roles. Line 370 validates an equipment change and line 414 handles portable receipt holding. `apps/server/src/device-equipment.ts:267` filters newly offered equipment by profile, device location and active state.                                                                                                                                                |
| Printer resolution                              | `apps/server/src/receipt-print.ts:115` resolves the device invoice choice/default with an optional location check; line 81 resolves receipt equipment and line 130 reads active role printers. These are resolved destinations, not the proposed full per-request lists.                                                                                                                                                                                                                                                                                                                                                                                |
| Dashboard menu, dialog and client               | `apps/dashboard/src/screens/orders-screen.ts:187` separates F2 receipt reprint from F1 invoice print; line 272 chooses the action. `apps/dashboard/src/widgets/order-reprint-dialog.ts:101` loads the receipt list, line 113 reads F1 offers and line 177 submits. `apps/dashboard/src/api/client.ts:3888` reads the generic receipt list; line 3898 posts an F1 print request.                                                                                                                                                                                                                                                                         |
| Dashboard server and scope                      | `apps/server/src/orders-api.ts:155` resolves the person and restricted Orders visibility; line 184 checks `report.export`. Line 252 reads receipt printers using configured till location; line 281 writes receipt copies. Line 297 writes F1 deliveries. `apps/server/src/orders-list.ts:709` offers active receipt and A4 printers at the sale location. `apps/server/src/orders-reprint.ts:23` instead checks configured till location, then queues and audits a copy at line 35.                                                                                                                                                                    |
| Existing invoice versus another fiscal document | `apps/server/src/receipt-print.ts:326` builds a copy and queues a document job; line 349 queues an F1 receipt and reserves its delivery. `apps/server/src/receipt-document.ts:143` chooses full/simplified layout, line 225 prints the full-invoice number and line 237 its recipient. `apps/server/src/invoice-document.ts:37` reads the recorded sale, line 47 applies its location and line 136 builds F1 data with the stored number at line 146. `apps/server/src/till-sale.ts:864` reads the existing ticket for receipt printing; `reprintSale` delegates at line 2239.                                                                          |
| Shared F1 reservations and races                | `apps/server/src/invoice-delivery-actions.ts:33` checks request replay; line 56 prints using offers and current designation. Line 199 conditionally replaces an unclaimed original. `apps/server/src/invoice-delivery.ts:107` refuses active work and line 143 derives original/copy from completion. `apps/server/src/invoice-delivery-status.ts:143` derives sale location through the node; line 225 detects withdrawn selected receipt printers; line 283 computes busy/available actions.                                                                                                                                                          |
| Jobs, agents, reports and handover              | `packages/printing/src/outbox.ts:16` accepts no caller request key and line 53 inserts the job. `apps/server/src/invoice-print.ts:58` claims receipt jobs with delivery claims; line 98 reports outcomes. `apps/server/src/invoice-page-print.ts:40` claims A4 deliveries; `apps/server/src/page-print-api.ts:222` reads the claimed sale's document and renders its designation. `apps/server/src/invoice-delivery.ts:291` authenticates reports and handles newer generations. `apps/server/src/receipt-print.ts:497` separately records handover after a done job.                                                                                   |
| Historical transaction and copy audit           | `apps/till/src/api/client.ts:3637` uses a sale id for transaction reprint. `apps/server/src/transaction-receipt-api.ts:43` checks session/action/zone, reads the transaction, resolves the receipt printer and writes its audit. `packages/db/src/schema/receipt-reprints.ts:7` records sale, job, person and time, without a request-intent field.                                                                                                                                                                                                                                                                                                     |
| Deletion and resend boundary                    | `apps/server/src/printer-delete.ts:173` ends affected work, removes lists/choices and retains a deleted printer identity. `apps/server/src/invoice-print.ts:123` distinguishes sending from queued work when ending receipt deliveries. `apps/server/src/device-delete.ts:175` disables and releases a device. `apps/server/src/print-api.ts:1481` uses `print.resend` through the gate at line 526, then `resendInvoicePrintJob` (`apps/server/src/invoice-print.ts:23`), without an Orders/profile offer callback.                                                                                                                                    |
| Profile history and A4 marker                   | `packages/db/src/schema/sales.ts:72` stores the device reference; `packages/db/src/schema/device-profiles.ts:33` defines reusable profiles with retirement at line 48. `apps/dashboard/src/screens/devices-screen.ts:288` formats resolved names/default marks without a kind marker.                                                                                                                                                                                                                                                                                                                                                                   |
| Public F1 gate                                  | `apps/server/src/till-setup.ts:108` returns false; `apps/till/src/till-app.ts:4978` checks it before opening recipient entry. `apps/server/src/till-sale.ts:507` refuses F1 requests, and `apps/server/src/working-order.ts:3675` refuses an order already saved as F1 at issuance. Payment callers include `apps/server/src/till-sale.ts:674`, line 1132 and line 2133.                                                                                                                                                                                                                                                                                |

Relevant backlog context read: `docs/backlog.md:3374` (A661 payment, location and resend
loose ends), `docs/backlog/printers.md:6` (failed automatic delivery visibility), line 196
(audit/job retention), line 603 (saved simplified guests), line 620 (email product decision)
and line 676 (two invoice-printer columns). These recorded claims were not independently
verified. The still-open location and resend issues remain in the backlog.

## Acceptance evidence owed after approval

No tests are claimed passed. The later builder's TDD work must exercise both client and
server behavior: distinct receipt/invoice lists, mixed A4/receipt invoice lists, defaults,
single/zero options, explicit confirmation and original/copy races; forged ids and restricted
sessions; another sale location; belt holding by role; deletion/retirement/rebinding during
reads and writes; lost responses, duplicate requests and successful-write/failed-refresh;
F2 and historical transaction copies; unchanged public F1 refusals; and no extra fiscal or
drawer writes. Use different printer names and different lists so a wrong consumer fails.

The accompanying vector boards show the four worked examples and proposed status states
in English/Spanish, at 390px/1280px, in both themes. They are static design aids, not
product screenshots or physical-printer evidence. The illustrated paper samples compare
document identity only; they do not approve a fiscal layout. Actual UI rendering, all
transition cases and physical paper remain separate future checks.
Until A–D, the persistence proposal, those boards and the complete design receive agreement,
the task stays design-only. No implementation plan, product change or migration is authorized by this proposal.
