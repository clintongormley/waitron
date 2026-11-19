# ADVISER-NO-NONE. Every sale prints its ticket or emails it

Status: plan, for a fresh read and then the watcher. FISCAL item; the owner lands it. Written against
main `b2948b1917`.

**Size: larger than the "medium" estimate.** Production code is medium (about +190 lines across nine
files, no migration); the tests are large (about +650 new or rewritten lines), because the change
touches the till's window, a server job and the print outbox, and every till test that closes the
window today has to say what it now expects.

## What was decided

- Adviser meeting sheet, `docs/compliance/2026-11-19-adviser-meeting.md`, question 3, the owner's
  answer: "It is required to deliver a ticket. We must always print one unless we email it instead."
  Its summary: "The till's "None" choice cannot stay: a ticket is always printed unless it is emailed
  (question 3)."
- Owner, 18 November, relayed by the watcher (`~/waitron-campaign-l/questions.md`, "WATCHER
  2026-11-18 19:32", point 2): to "I recommend the sale completes and the ticket prints when the
  printer is back." the owner wrote "ok". With no working receipt printer and no email address the
  sale completes, the till says the ticket will print when the printer is back, and it then prints
  by itself, across a restart too.
- CLAUDE.md §5: nothing external may block a sale. A missing or broken printer never stops payment.

## What happens today

Statements below come from reading unless a command is named.

**The window after payment.** `apps/till/src/widgets/settlement-document-dialog.ts` offers Receipt
or Full invoice (lines 55-76), a Print button (94-100), email and delivery status
(`renderOriginalDelivery`, 103), the drawer, and a footer **None** button (113-121) that only closes
the window, as the window's own close does (35-38). Both send `settlement-close`, which the till
handles at `apps/till/src/till-app.ts:23398-23411` by starting a new sale or going back to the
table; nothing prints. Ran `pnpm --filter @waitron/till exec vitest run
src/widgets/settlement-document-dialog.test.ts`: 14 passed, including "None closes the choice"
with no print event (test file lines 16-39).

**Nothing prints the receipt by itself.** Every issuance calls `enqueueSaleReceipt`
(`apps/server/src/receipt-print.ts:267-287`), which queues only a pre-pay collection number and a
full invoice's A4 or email delivery chosen before payment (`reserveStagedInvoiceDelivery`,
`apps/server/src/invoice-choice-delivery.ts:68-99`). The receipt original is queued only when staff
press Print: `POST /api/sales/:id/receipt` (`apps/server/src/till-api.ts:2693-2715`) →
`printSaleReceipt` (`apps/server/src/till-sale.ts:1029-1055`) → `enqueueOriginalReceipt`
(`receipt-print.ts:550-597`), which returns `"exists"` when an original job exists (570) and
`"not_queued"` when the device resolves no switched-on receipt printer (590; resolution at 79-89).

**Every way a ticket is issued** (searched `#showTicket(` in `till-app.ts` and the server's callers
of `issueIfFullyPaid`, `issueWhenFullyPaid`, `issueUnpaidInvoice` and `enqueueSaleReceipt`):

| Path | Window shown? | Prints or emails today |
| --- | --- | --- |
| Counter sale paid at once: `till-app.ts:7348`, `8608`, card `7539`, a kitchen-note save that issues `8290` | Yes | Only on Print |
| Find a bill, pay: `9600` | Yes | Only on Print |
| Deferred close (company pays later): table `12167`, counter `12202` | Yes | Only on Print |
| Table bill paid: `20543`, `21612`, card resend `20784`, bill found paid `16729` | Yes | Only on Print |
| An edit that finishes paying a bill: `13487`, `14903`, `15163`, `16126`, `16583`, `16797`, `18881` | Yes | Only on Print |
| Full invoice with A4 or email chosen before payment (any path above) | Yes | Sent by itself at issue |
| Table recorded as left without paying: `apps/server/src/unpaid-departure.ts:128`; the till's `#onDepartureRecorded` (`till-app.ts:19744`) opens no window | No | Nothing |
| Split table, a loose bill already paid: `apps/server/src/till-api.ts:3279` | No | Nothing |
| Dashboard, a partial refund kept as payment: `apps/server/src/payments-api.ts:1601` | No | Nothing |
| Card payment recovered later: `apps/server/src/till-sale.ts:2074` (not traced to a screen) | Not checked | Nothing |
| Corrective invoice: `apps/server/src/invoice-corrections.ts:399-407` | Own flow | Prints only when asked |

**How a queued receipt waits.** Print jobs sit in `print_jobs` (`packages/db/src/schema/print-jobs.ts`)
and are claimed by `claimPrintJobs` (`packages/printing/src/runtime.ts`). A USB or Bluetooth printer's
job is claimed only while the agent sees the device (117-120, 146), and a switched-off printer's not
at all (145), so those jobs stay queued and print when the printer returns, restart included. A
network printer's job is tried five times, waiting 5, 15, 30 and 60 seconds (runtime.ts:8-9,
222-231), about two minutes, then stays failed. A full invoice's receipt sent through its delivery
record ends after one failure (`apps/server/src/invoice-delivery.ts:512-520`).

**Email after a print.** While an original print waits or retries, an email is refused
(`invoice-delivery.ts:116-139`, `invoice_delivery.active`) and the till does not offer it
(`apps/server/src/invoice-delivery-status.ts:327-367`). Once the print is done, an email is a
«DUPLICADO» copy (`invoice-delivery.ts:142-150`); once an email original is sent, a print is a copy
(`receipt-print.ts:573-581`).

## The design

**D1. Closing the window prints the original, unless it was emailed.** The footer button becomes
**Done** ("Listo"); "None" and the string `settlement.none` go. Done and the window's own close both
ask the server to print the original "if owed". The till does not wait for the answer: it closes at
once, so a slow or absent server never holds the next sale.

**D2. The server decides what is owed, in one function.** New `owesOriginal(tx, saleId)` in
`apps/server/src/owed-receipts.ts`: the sale has a device, is not a corrective
(`sales.corrects_sale_id`), is not an unpaid departure (`unpaid_departures.sale_id`), has no
original receipt job in any state (the same test as `receipt-print.ts:565-570`), and has no original
A4 or email delivery that is queued, sending, sent or "may have arrived" (`unknown`). A failed email
does not count, so a closed window after a failed email prints. `POST /api/sales/:id/receipt` gains
an optional body field `ifOwed: true`; with it, the route queues the original only when owed and
otherwise does nothing. No new route, so the till route inventories stay as they are.

**D3. Automatic prints keep trying.** An owed original is queued through `enqueueOriginalReceipt`
with no person, so it is a plain job even for a full invoice (no delivery record; such a job is
already read as "an untracked receipt original", `invoice-delivery-status.ts:306-321`). In
`reportPrintJob` (`runtime.ts:217-238`), a failed original sale receipt (a document job with
`receipt_copy = 0` and a `sale_id`, issued in the last 24 hours) stops counting at four attempts and
waits 60 seconds before the next, so it is never given up. Kitchen, drawer, copy and slip jobs keep
today's five attempts. Every place that reads "failed with attempts left" as "still trying" then
tells the truth without change: email stays refused while it retries, the till shows the existing
"Printing failed. Automatic retry is pending." (`apps/till/src/i18n/strings.ts:467`, Spanish 2595),
and the printer's amber "not printing" notice appears after two minutes as today
(`apps/server/src/print-job-trouble.ts:17`). Pressing **Print on {printer}** for a full invoice
keeps today's delivery-tracked path.

**D4. A server job is the safety net.** New job `receipt.owed` (on the job runner, marked `stop` in
`apps/server/src/job-catalogue.ts`, registered in `apps/server/src/boot.ts` beside
`menuActivationJob` at 4499, running only on the primary). Every minute it takes sales issued between
5 minutes and 24 hours ago (using `sales_issued_idx`; `issued_at` is stored by `toISOString`,
`packages/core/src/record-sale.ts:297`) that `owesOriginal` accepts, on a device that is not deleted
and whose profile may print receipts (as `printsReceipts`, `invoice-corrections.ts:410`), and queues
each original on that device's receipt printer as resolved now. This covers a till that crashed or
lost its connection before closing, a device with no receipt printer or a switched-off one (it
prints the first pass after one is set or switched on), and the window-less paths in the table above.
Two prints racing (the till's close and the job) produce one job: both run in a write transaction and
the second sees the first's job (`"exists"`), as `receipt-print.test.ts:933` already shows for two
Print presses.

**D5. "No working receipt printer"**, case by case:

| Case | What holds the ticket | What prints it, restart included |
| --- | --- | --- |
| No receipt printer for the device, or it is switched off | Nothing is queued; the sale owes it (D2) | The job (D4), on the first pass after a printer is set or switched on, within 24 hours |
| USB or Bluetooth printer unplugged | The queued job | The agent, when it sees the printer again (today's behaviour) |
| Network printer off for an hour | The failed job, still retrying (D3) | The next retry after the printer is back, at most 60 seconds later |

**D6. Email after a print has been queued.** Before Done, staff can still email instead: nothing is
queued yet, so the email is the original. After Done, today's rules hold: while the print waits,
email is refused; once it printed, an email is a «DUPLICADO» copy. A full invoice keeps its type,
chosen before payment; if its original went by A4 or email, closing prints nothing; if it was to
print after paying, closing prints its receipt original.

**D7. No migration.** What is owed is worked out from existing rows; nothing new is stored.

## What the till says

| Shown when | English | Spanish |
| --- | --- | --- |
| Footer button | Done | Listo |
| The original is still owed | Closing prints the receipt unless you email it. | Al cerrar se imprime el recibo, salvo que lo envíes por correo electrónico. |
| …and the device has no receipt printer | This device has no receipt printer. The receipt will print by itself once one is set. | Este dispositivo no tiene impresora de recibos. El recibo se imprimirá solo cuando se configure una. |
| …and its printer is switched off | The receipt printer is not available. The receipt will print by itself when it is back. | La impresora de recibos no está disponible. El recibo se imprimirá solo cuando vuelva. |

The till knows "none" and "switched off" from `receiptEquipment.resolved` (null, or `available`
false: `apps/till/src/api/client.ts:1853-1860`). It cannot know a network printer is unreachable; that
case shows the first line and, after two minutes, the existing amber printer notice.

**Guide pages, English and Spanish:**
- `apps/server/src/guide/en/table-service.md:64-77` and `es/table-service.md:69-83` (Choose
  documents after paying): drop **None**; "Press **Done** or close the window to carry on. Unless you
  emailed it, the receipt prints when you close. If the printer is not ready, it prints by itself
  when it is back." Spanish to match.
- `en/table-service.md:117-119` and its Spanish twin: with **Receipt printer: print after paying**,
  the receipt prints when the window closes.
- `en/kitchen-service.md:17` ("or keep serving without one") and `es/kitchen-service.md:19` ("o
  continuar atendiendo sin entregarlo").

## Fiscal boundaries

No change to `registros_facturacion`, `computeHuella`, the chain, invoice numbering, series or the
alta builders, and no fiscal file is edited. Printing stays off the sale path: the sale's transaction
commits before the till asks to print, the job runs in its own transactions, and a print request that
fails or never arrives changes nothing about the sale.

## Open pull requests this touches

- **#3752** edits the same dialog (adds Payment slip next to `renderOriginalDelivery`), the same
  guide paragraph around "Choose **None**", and moves the original-job test into
  `hasOriginalReceiptJob` / `originalAttempted` in `receipt-print.ts`. If it lands first,
  `owesOriginal` reuses `hasOriginalReceiptJob`, and the guide edit is rebased onto its text.
- **#3704 / #3724** (Print the bill) print the original when the bill is printed (#3704's
  `meal-end.ts` calls `enqueueOriginalReceipt`), so such a bill is never owed and closing after its
  last payment prints nothing more. #3724 rewrites `table-service.md:117-119`; whichever lands
  second words that line.
- **#3828** makes an email the mail server accepted late count as delivered. If it lands first,
  `owesOriginal` must count that email as sent; Task 2 has a case for it either way.
- **#3803** touches `till-ticket-view.ts` and `till-app.ts`, not the window's footer or close; a
  textual rebase only.

## Tasks

Each starts with its failing test. Run single files with `pnpm --filter <pkg> exec vitest run
<file>`; never `pnpm test <file> -t`, which drops the name filter (CLAUDE.md §2). Every task's check
includes `pnpm exec prettier --check <changed files>`.

1. **Original receipts keep retrying** (`packages/printing`). Failing cases first in
   `src/runtime.retry.test.ts`: an original sale receipt failing ten times stays failed with four
   attempts, waits 60 seconds and is claimed again; one issued over 24 hours ago ends at five; a copy,
   a kitchen document and a drawer job still end at five. Then change `reportPrintJob`
   (`src/runtime.ts:217-238`). Add one case to `apps/server/src/print-job-trouble.test.ts`: a
   retrying original raises the two-minute notice and never "could not print · Reprint it".
   About +15 production, +120 test.
2. **What is owed, and the route flag** (`apps/server`). Failing cases in a new
   `src/owed-receipts.test.ts` (`useVenueDb`): owed with nothing sent; not owed with an original job
   in each state, an email or A4 original queued, sending, sent or unknown, a corrective, an unpaid
   departure, no device; owed after a failed email; a full invoice's automatic print has no delivery
   record. Cases in `src/till-api.receipt.test.ts`: `ifOwed` queues once, does nothing when not owed
   or when an email is queued (no `invoice_delivery.active` refusal), and refuses a non-boolean
   `ifOwed` with `management.request_invalid`. Then `owesOriginal` and `queueOwedOriginal` and the
   body parse at `till-api.ts:2693-2715`. About +60 production, +170 test.
3. **The safety-net job** (`apps/server`). Failing cases in `src/owed-receipts.test.ts`: a pass
   queues a 6-minute-old owed sale on its device's printer; skips one 4 minutes old or 25 hours old,
   a deleted device and a profile without `print-receipt`; with no printer it queues nothing, and
   after a printer is set the next pass queues it; a pass beside a till print leaves one job. Then
   the job, its catalogue line (`job-catalogue.test.ts` passes) and its boot registration. Run
   `src/job-catalogue.test.ts` and `src/boot.restricted-quiet.test.ts` too. About +60 production,
   +130 test.
4. **The window** (`apps/till`). Failing cases in `src/widgets/settlement-document-dialog.test.ts`:
   no **None**, a **Done** button that sends `settlement-close`; each hint above, shown only while the
   original is owed, in English and Spanish. Extend `settlement-document-dialog.a11y.test.ts` to the
   three hint states in both themes. Then the dialog and strings (remove `settlement.none`, add
   `settlement.done` and the three hints, EN and ES). About +35 production, +90 test.
5. **Closing prints** (`apps/till`). Failing cases in `src/till-app-settlement-documents.test.ts`:
   Done and the window's close each call `printReceipt(id, { ifOwed: true })` once and close without
   waiting; a failing call still closes; no call on a device without `print-receipt`; a counter sale
   and a table bill both covered. Add the option to `src/api/client.ts` with a `client.test.ts` case.
   Then the `settlement-close` handler (`till-app.ts:23398`). Update the tests that press
   `[data-settlement-none]` (`till-app-drafts.test.ts:9304`, `till-app-handheld-pay.test.ts:164,
   3602, 3794, 4142`, `settlement-document-dialog.a11y.test.ts:46`) and review each
   `printReceipt).not.toHaveBeenCalled()` that follows a close: keep it where no close happens
   (`settlement-document-dialog.unsaved.test.ts:57`, the element is removed, not closed), change it to
   the `ifOwed` call where the close is the point. About +25 production, +150 new and ~40 changed test.
   If this passes about 100 tool calls, split the existing-test updates into a 5b.
6. **Guide** (`apps/server`). The three edits above in English and Spanish, keeping the `{#id}`
   headings. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the
   root, `pnpm exec vitest run scripts/guide-links.test.ts`. About +12/−10 lines each language.
7. **Look at it.** Start the worktree's stack with `wa-wt demo <worktree-name>`, pay a counter sale
   on the till and open the window at phone width (390 px) in English and Spanish, light and dark,
   with a printer, with none, and with it switched off; screenshot with the workspace's Playwright
   Chromium into the working folder (never committed) and show the owner. Then `/finish-branch`.

## Open questions for the watcher

1. **A table recorded as left without paying.** The guests have gone. Recommended default: no
   automatic print (excluded in D2); staff can print it from Find a bill. A €0 departure leaves no
   departure row (`unpaid-departure.ts:142-151`), so its €0 ticket would print; accepted as harmless.
2. **How long a missing printer is waited for.** Recommended default: 24 hours from issue, then the
   ticket is no longer printed by itself. On the first start of this change, sales from the previous
   24 hours that never printed or emailed print once; the PR says so in its first lines.
3. **How long the safety net waits before printing for a till that never closed the window.**
   Recommended default: 5 minutes, long enough for staff typing an email address.
4. **A device whose profile may not print receipts.** Recommended default: its tickets are emailed
   or wait (D4 skips it), and its window shows the "no receipt printer" line. The alternative is to
   print on its receipt printer anyway.
5. **Email instead of a print that is still waiting** (printer down after Done). Recommended
   default: not in this item; email stays refused until the print finishes, as today. Allowing it
   would end the waiting print and send the email as the original: about +60 production and +150
   test, plus keeping that ended print out of the "Reprint it" notice.
