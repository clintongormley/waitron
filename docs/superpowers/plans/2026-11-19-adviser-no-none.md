# ADVISER-NO-NONE. Every sale prints its ticket or emails it

Status: plan, revised after a fresh-context read (five Important findings, all verified and taken),
for the watcher. FISCAL item; the owner lands it. Written against main `b2948b1917`.

**Size: larger than the "medium" estimate.** Production code is medium (about +200 lines across ten
files, no migration); the tests are large (about +580 new and +120 changed lines), because every till
test that closes the window today has to say what it now expects.

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
handles at `apps/till/src/till-app.ts:23398-23411`: a table goes back to the table; a counter sale
first asks to discard an unsaved basket (`#replaceBasket`, 2945-2961, which leaves the window open
if staff keep it) and then starts a new sale. Nothing prints. Ran `pnpm --filter @waitron/till exec
vitest run src/widgets/settlement-document-dialog.test.ts`: 14 passed, including "None closes the
choice" with no print event (test file lines 16-39).

**Nothing prints the receipt by itself.** Every issuance calls `enqueueSaleReceipt`
(`apps/server/src/receipt-print.ts:267-287`), which queues only a pre-pay collection number and a
full invoice's A4 or email delivery chosen before payment (`reserveStagedInvoiceDelivery`,
`apps/server/src/invoice-choice-delivery.ts:68-99`). The receipt original is queued only when staff
press Print: `POST /api/sales/:id/receipt`, whose `:id` is the order's id, not the sale's
(`apps/server/src/till-api.ts:2693-2715`) → `printSaleReceipt` (`apps/server/src/till-sale.ts:1029-1055`)
→ `enqueueOriginalReceipt` (`receipt-print.ts:550-597`). That returns `"exists"` when any original
job exists (570) and `"not_queued"` when the device resolves no receipt printer; a switched-off
printer counts as none (`readDevicePrinters`, 151).

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
222-231), about two minutes, then gives up. While a document waits to retry, later documents on the
same printer wait behind it (150-157; `runtime.retry.test.ts:126`). A full invoice's receipt sent
through its delivery record gives up after one failure (`apps/server/src/invoice-delivery.ts:512-520`);
that is the path Print uses for a full invoice, and #3704's Print the bill too.

**What staff can do with a print that has not printed.** "Retry original" and a resend need the job
to have given up (`packages/printing/src/outbox.ts:102-115`; route `till-api.ts:2490-2512`). Moving
it elsewhere needs it stuck, and a network printer always counts as reachable
(`apps/server/src/print-api.ts:540-546`, `apps/server/src/print-job-reprint.ts:41-57`). Email is
refused while a print waits or retries (`invoice-delivery.ts:116-139`) and not offered then
(`apps/server/src/invoice-delivery-status.ts:327-367`). Once a print is done, an email is a
«DUPLICADO» copy (`invoice-delivery.ts:142-150`); once an email original is sent, a print is a copy
(`receipt-print.ts:573-581`). Email and print both need the device's profile to allow receipts
(`till-api.ts:2592-2595`, `apps/till/src/screens/till-ticket-view.ts:747`).

## The design

**D1. Closing the window prints the original, unless it was emailed.** The footer button becomes
**Done** ("Listo"); "None" and the string `settlement.none` go. Done and the window's own close both
send the print request inside the close step, after any "discard the basket?" question is answered,
so keeping the basket keeps the window open and sends nothing. The till does not wait for the answer:
a slow or absent server never holds the next sale.

**D2. The server decides what is owed, in one function.** New `owesOriginal(tx, saleId)` in
`apps/server/src/owed-receipts.ts`: the sale is not a corrective (`sales.corrects_sale_id`) and not an
unpaid departure (`unpaid_departures.sale_id`); no original receipt print is done or still trying
(queued, printing, or failed with attempts left), whichever path made it, so a given-up print still
owes; and no original A4 or email delivery is queued, sending, sent or "may have arrived"
(`unknown`), so a failed email still owes. `POST /api/sales/:id/receipt` gains an optional body field
`ifOwed: true`; with it, the route queues the original only when owed and no original job exists, and
otherwise does nothing (no `invoice_delivery.active` refusal). It queues on the device's receipt
printer even when that printer is switched off (a new option on `readDevicePrinters`, used only here),
so the job waits until it is switched on. No new route, so the till route inventories stay as they are.

**D3. A server job starts a fresh round for an original that gave up.** The shared print runtime is
not changed: every job keeps five attempts. New job `receipt.owed` (on the job runner, marked `stop`
in `apps/server/src/job-catalogue.ts`, registered in `apps/server/src/boot.ts` beside
`menuActivationJob` at 4499, so it runs only on the primary). Every minute it takes original receipt
jobs for sales issued in the last 24 hours (via `sales_issued_idx`; `issued_at` is stored by
`toISOString`, `packages/core/src/record-sale.ts:297`) that are the newest of their sale's originals,
gave up on a delivery failure (not `printer.deleted`, `printer.unpaired` or `print_job.moved`),
were last tried over 10 minutes ago (`claimed_at`), and whose sale `owesOriginal` accepts. For each it
does what the till's "Retry original" does: `resendInvoicePrintJob` (`apps/server/src/invoice-print.ts:44`)
on the same printer, so the sale keeps one original and the resend names the first job. For an
automatic round it passes no person; a receipt delivery row already allows that
(`packages/db/src/schema/invoice-deliveries.ts:97`), and the function's person parameter widens to
allow `null`. It renders nothing itself, so it needs no device settings; if a later change makes it
lay out a receipt, it builds them as `payments-api.ts:1603` does (`{ ...deps.cfg, origin }` with the
sale's device).

This keeps today's ways out between rounds: for up to 10 minutes after each round, the print has
given up, so staff can Retry it, reprint it elsewhere or (as today) email it; the "could not print a
ticket · Reprint it" notice shows meanwhile. A round holds later documents on that printer only as
any failing document does today, and only those created after the round's own job, so kitchen tickets
on a shared printer are not held any longer than now. About one new job row per stuck sale every 12
minutes, for at most 24 hours.

**D4. "No working receipt printer"**, case by case:

| Case | What holds the ticket | What prints it, restart included |
| --- | --- | --- |
| Printer switched off | The job queued to it at Done (D2) | The agent, once it is switched on (no time limit) |
| USB or Bluetooth printer unplugged | The queued job | The agent, when it sees the printer again (no time limit) |
| Network printer off for an hour | The given-up job | The next fresh round after it is back, at most about 12 minutes later, within 24 hours |
| No receipt printer set for the device | Nothing | Nothing: the window says so before Done, and offers its printer choice and email (open question 1) |
| Printer deleted or unpaired after the job was queued | The ended job | Nothing automatic; staff reprint elsewhere, as today (open question 3) |

A late-night sale whose network printer is off overnight prints at the next morning's opening if that
is within 24 hours of the sale; a USB, Bluetooth or switched-off printer's ticket prints whenever the
printer returns.

**D5. Email after a print has been queued.** Before Done, staff can still email instead: nothing is
queued yet, so the email is the original. After Done, today's rules hold: while the print waits or
retries, email is refused; between rounds it is allowed as the original; once printed, an email is a
«DUPLICADO» copy. A full invoice keeps its type, chosen before payment: if its original went by A4 or
email, closing prints nothing; otherwise closing prints its receipt original.

**D6. Only sales a till closed are printed automatically.** The first print comes only from the
window's close; D3 only repeats prints that exist. Sales that never showed a window (unpaid
departure, split table's loose bills, a payment kept from the dashboard, a recovered card payment)
behave as today (open question 2). A till that crashes before closing leaves the ticket unprinted;
staff print it from Find a bill.

**D7. No migration.** What is owed is worked out from existing rows.

## What the till says

| Shown when | English | Spanish |
| --- | --- | --- |
| Footer button | Done | Listo |
| The original is still owed | Closing prints the receipt unless you email it. | Al cerrar se imprime el recibo, salvo que lo envíes por correo electrónico. |
| …and the printer is switched off | {printer} is switched off. The receipt will print when it is switched back on. | {printer} está desactivada. El recibo se imprimirá cuando vuelva a activarse. |
| …and the device has no receipt printer | This device has no receipt printer. Choose one above or email the receipt before closing. | Este dispositivo no tiene impresora de recibos. Elige una arriba o envía el recibo por correo antes de cerrar. |
| Profile may not print or email receipts | This device may not print or email receipts. Print it from Find a bill on a till that can. | Este dispositivo no puede imprimir ni enviar recibos. Imprímelo desde Buscar cuenta en una caja que pueda. |

The till knows "none" and "switched off" from `receiptEquipment.resolved` (null, or `available`
false: `apps/till/src/api/client.ts:1853-1860`), and the window already offers a printer choice saved
to the device (`renderInvoicePrinter`). It cannot know a network printer is unreachable; that case
shows the first line and, after two minutes, the existing amber printer notice. "Buscar cuenta" is
the till's own Spanish name for Find a bill (`apps/till/src/i18n/strings.ts:2777`).

**Guide pages, English and Spanish:**
- `apps/server/src/guide/en/table-service.md:64-77` and `es/table-service.md:69-83` (Choose
  documents after paying): drop **None**; "Press **Done** or close the window to carry on. Unless you
  emailed it, the receipt prints when you close. If the printer is not working, it prints by itself
  when it is back."
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
  guide paragraph around "Choose **None**", moves the original-job test into `hasOriginalReceiptJob`
  in `receipt-print.ts`, and adds tests that expect `[data-settlement-none]`
  (`till-app-settlement-documents.test.ts`). Tasks 3-5 update those tests if it lands first.
- **#3704 / #3724** (Print the bill) print the original through the tracked path when the bill is
  printed, so such a bill is not owed unless that print gives up, when D3 retries it. #3724 rewrites
  `table-service.md:117-119`; whichever lands second words that line.
- **#3828** makes an email the mail server accepted late count as delivered, and also changes
  `settlement-document-dialog.test.ts` and `till-ticket-view.ts`. If it lands first, `owesOriginal`
  counts that email as sent; Task 1 has a case for it either way.
- **#3803** touches `till-ticket-view.ts` and `till-app.ts`, not the window's footer or close; a
  textual rebase only.

## Tasks

Each starts with its failing test. Run single files with `pnpm --filter <pkg> exec vitest run
<file>`; never `pnpm test <file> -t`, which drops the name filter (CLAUDE.md §2). Every task's check
includes `pnpm exec prettier --check <changed files>`.

1. **What is owed, and the route flag** (`apps/server`). Failing cases in a new
   `src/owed-receipts.test.ts` (`useVenueDb`): owed with nothing sent; owed after a failed email and
   after a given-up original from either path (plain, and a full invoice's tracked one); not owed with
   an original done or still trying, an email or A4 original queued, sending, sent or unknown, a
   corrective or an unpaid departure. Cases in `src/till-api.receipt.test.ts`: `ifOwed` queues once
   (two requests together leave one job); does nothing when not owed or when an email is queued; queues
   to a switched-off printer, which prints once switched on; refuses a non-boolean `ifOwed` with
   `management.request_invalid`. Then `owesOriginal`, the `readDevicePrinters` option and the body
   parse. About +60 production, +170 test.
2. **Fresh rounds** (`apps/server`, plus one case in `packages/printing`). Failing cases in
   `src/owed-receipts.test.ts`: a given-up original last tried 11 minutes ago gets one resend on the
   same printer, marked as an original, naming the first job; none at 9 minutes, for a sale over 24
   hours old, a deleted or unpaired printer, a moved job, or a sale no longer owed; a full invoice's
   tracked original is resent with no person. In `packages/printing/src/runtime.retry.test.ts`: a
   kitchen job queued before a fresh round's job prints without waiting, and one queued during the
   round waits no longer than "holds later documents on the same printer" (line 126) allows today.
   Then the job, `resendInvoicePrintJob`'s `null` person, its catalogue line and boot registration.
   Also run `src/job-catalogue.test.ts` and `src/boot.restricted-quiet.test.ts`. About +75
   production, +170 test.
3. **The window** (`apps/till`). Failing cases in `src/widgets/settlement-document-dialog.test.ts`:
   no **None**, a **Done** button that sends `settlement-close`; each line above, shown only in its
   state, in English and Spanish. Extend `settlement-document-dialog.a11y.test.ts` to those states in
   both themes. Then the dialog and strings (remove `settlement.none`, add `settlement.done` and the
   four lines, EN and ES). About +35 production, +90 test.
4. **Closing prints** (`apps/till`), in two parts from the start.
   - **4a.** Failing cases in `src/till-app-settlement-documents.test.ts`: Done and the window's close
     each call `printReceipt(id, { ifOwed: true })` once and close without waiting; a failing call
     still closes; keeping the basket when asked sends nothing and keeps the window; no call on a
     device without `print-receipt`; a counter sale and a table bill both covered. Add the option to
     `src/api/client.ts` with a `client.test.ts` case. Then the `settlement-close` handler
     (`till-app.ts:23398`). About +25 production, +150 test.
   - **4b.** Update the existing tests that close the window: those pressing `[data-settlement-none]`
     (`till-app-drafts.test.ts:9304`, `till-app-handheld-pay.test.ts:164, 3602, 3794, 4142`) and those
     that close through `closeTicket` or `settlement-close` (`till-app.test.ts`, all 24 uses of
     `closeTicket`; `till-app-parties.test.ts:5499`; `till-app-bill-payments.test.ts:5528`;
     `till-app.invoice-printer-choice.test.ts:319, 463, 508`;
     `till-app.document-printer-choice.test.ts:214`). Review each
     `printReceipt).not.toHaveBeenCalled()` after a close: change it to expect the `ifOwed` call where
     the close is the point; keep it where nothing closes
     (`settlement-document-dialog.unsaved.test.ts:57` removes the element). Their fake APIs gain the
     option. About +120 changed test lines.
5. **Guide** (`apps/server`). The three edits above in English and Spanish, keeping the `{#id}`
   headings. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the
   root, `pnpm exec vitest run scripts/guide-links.test.ts`. About +12/−10 lines each language.
6. **Look at it.** Start the worktree's stack with `wa-wt demo <worktree-name>`, pay a counter sale
   on the till and open the window at phone width (390 px) in English and Spanish, light and dark,
   with a printer, with none, and with it switched off; screenshot with the workspace's Playwright
   Chromium into the working folder (never committed) and show the owner. Then `/finish-branch`.

**For the PR's first lines:** on its first start, D3 retries every original that gave up in the
previous 24 hours while its sale still owes one, including prints staff never retried. Harmless
before go-live (CLAUDE.md §3, any installation may be reset).

## Open questions for the watcher

1. **A device with no receipt printer set.** Recommended default: the sale completes and Done closes;
   the window first says the device has no receipt printer and offers its printer choice and email.
   A ticket closed that way is not printed later: nothing can hold a print with no printer, and a
   stored "owed" mark would need a migration. The owner's "prints when the printer is back" covers a
   printer that stops working, which D2-D4 handle.
2. **Sales that never showed a till window** (unpaid departure, split table's loose bills, a payment
   kept from the dashboard, a recovered card payment). Recommended default: unchanged, nothing prints
   by itself (D6). The data does not tell a dashboard payment from a till one (the dashboard issues
   with the payment's device, `payments-api.ts:1603`), so printing the others but not the dashboard's
   would need a new mark. For unpaid departures the guests have gone.
3. **A printer deleted or unpaired after its job was queued.** Recommended default: no automatic
   reprint (unpairing ends jobs on purpose, `packages/printing/src/runtime.ts:183-194`); the till
   already says the printer was deleted and offers reprinting elsewhere.
4. **A device whose profile may not print receipts.** Email needs the same permission
   (`till-api.ts:2595`, `till-ticket-view.ts:747`), so such a device can deliver no ticket at all.
   Recommended default: keep the permission as it is; the window says the device may not print or email
   receipts and points to Find a bill on a till that can. The alternative, letting the automatic print
   ignore the profile, changes what a profile permits and is a permissions change for the owner.
5. **Fresh-round timing.** Recommended default: a new round 10 minutes after the last attempt, for
   sales up to 24 hours old. The 24-hour limit applies only to rounds; a job waiting on an unplugged
   USB or Bluetooth printer, or a switched-off one, prints whenever the printer returns.
