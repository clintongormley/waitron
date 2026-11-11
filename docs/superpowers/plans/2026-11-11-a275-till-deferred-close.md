# A275 Task 7: staff close a whole bill as a deferred payment from the till's Pay window

**Status: proposed 2026-11-11, not yet reviewed.** Builds after the code-name rename PR (watcher
2026-11-11 14:20, option A) and after #2797 (Task 4) lands. Every `file:line` below was read at main
`8c530d8a65` and, for Task 4, at `origin/feat/a275-transfer-labels` `1c2ef289cd`. Only files and git
history were read; no test, app or screen was run for this plan.

**Outcome.** A waiter opens **Pay** on a table bill that has no payments yet, chooses **Close as
deferred payment**, checks the total and the invoice in a short confirmation window, and confirms.
The server issues the invoice (or reuses one already issued) and closes the bill for good; the till
then opens the usual "choose your documents" window so the customer gets their receipt or invoice.
A double tap, a lost reply or a reload never closes the bill twice or issues a second invoice.

"Deferred payment" here means: the customer pays later, outside Waitron (for example by bank
transfer); Waitron records no debt and no later receipt of the money.

## Authority

- Design approved by the owner 2026-10-22 15:55, "A275 looks fine"
  ([design §2–3](../specs/2026-10-22-a275-final-transfer-close-design.md#2-the-final-action)); H2 build
  scope "Yes" 2026-10-22 (lane L `queue.md`). This cuts the
  [master plan's Task 7](2026-10-22-a275-final-transfer-close.md#task-7-accepted-pay-integration-guides-and-visual-acceptance)
  to today's code.
- Owner 2026-10-21 02:40: whole bill only; "no awaiting-transfer balance, later money-received entry,
  partial receipts, reversals, receivables ledger/module or unpaid-debt list". So no amount, tip, part
  or bank fields.
- Owner 2026-11-11 13:49: "we're saying the payment should happen by bank transfer, but really it is
  deferred payment, not necessarily by transfer" and "Rename then land. \"Deferred payment\" / Pago
  aplazado". The till button is "Close as deferred payment" / «Cerrar como pago aplazado» (#2797's
  dated note in the design, line 3). The till's interface has English and Spanish only
  (`apps/till/src/i18n/strings.ts:3927–3932`), and Task 7 adds no printed word, so there are no
  Catalan, Galician or Basque drafts this time.
- Owner 2026-11-11 10:14: "Land; yes to 'closed'": the shared refusal "This bill is paid" becomes
  "This bill is closed" / «Esta cuenta ya está cerrada» rather than separate refusals.
- Owner 2026-11-11 14:20, option A: one mechanical PR renames every code name from transfer to
  deferred before Task 7. **Names assumed here:** device action `close-deferred`; routes
  `POST /api/working-orders/:id/close-deferred` and `GET …/deferred-closure`; codes
  `deferred_close.{ineligible,conflict,day_frozen}`; till client `closeDeferred` / `getDeferredClosure`
  in `api/deferred-close-types.ts` (`CloseDeferredRequest`, `CloseDeferredResult`); stored tender
  `deferred`. If the rename picks others, substitute them; nothing below depends on the spelling.
- Lane test rules (owner 2026-11-09): test each property once, where it is decided; run to a defined
  end point before asserting something did not happen; reuse existing test support; one-time deletion
  checks go in the PR, not in committed tests; no code or test for an event a venue cannot reach.

## What the code does today

| Fact | Where |
| --- | --- |
| Table **Pay** opens `till-bill-pay-dialog` for an open bill, `till-presented-pay-dialog` for a presented one (any device) | `apps/till/src/screens/till-table-order-screen.ts:5202–5221` (`#paySheetButton`); `till-app.ts:19082–19099` (`#onPayPresented`); renders `till-app.ts:11019–11078`, `:11080–11120` |
| Counter **Pay** stores the basket as a bill, then opens the same `till-bill-pay-dialog` (surface `counter`) | `till-app.ts:19346–19436` (`#onCounterBillPay`); design-system "Shared bill payment window", `docs/developers/design-system.md:6491–6503` |
| The Pay window: a "way" choice (amount, split, items, **Whole bill**, default) and a method choice; Close and Continue in the footer; it only emits events, the app sends | `widgets/bill-pay-dialog.ts:1554–1610` (`#form`), `:1738–1749`, `:1070–1072`; doc comment `:180–191` |
| A handheld with no cash or card action still gets Pay; the window says there is no method | `till-table-order-screen.ts:1412` (`canSettle` is never bound, so always true); `bill-pay-dialog.ts:1739–1743` |
| What the device profile allows is `this.capabilities` | `till-app.ts:3553`, set at `:10742`; action list `apps/till/src/layout.ts:40–56` |
| Before any bill payment the app saves the waiter's unsent dishes and reads the expected edit | `till-app.ts:19811–19821` (`#flushDraft`, `#draftSync.expectedEditFor`, `#counterExpectedEdit`) |
| A table bill row holds everything the close must repeat: revision, total, invoice type, recipient, staged delivery, receipt language, `hasPayments`, `invoiceNumber` | `api/client.ts:2147–2184` (`PartyBill`), server `apps/server/src/parties.ts:570–611` |
| A Counter order read holds revision, expected edit and language, but **not** invoice type or recipient | `api/client.ts:1383–1393` (`HeldOrder`) |
| The bill's language, or the venue's when none is stored | `widgets/receipt-language.ts:14–19` (`shownReceiptLanguage`), matching server `venue-locale.ts:128–145` |
| The party's expected edits, as Finish table sends them | `till-app.ts:17296–17318` (`#billComposition`), used at `:17548` |
| After a full payment: close Pay, set `this.result`, open the documents window (A739 cut 7b/8: Receipt, Full invoice, None, Email) | `till-app.ts:20064–20076` (`#showPaidTicket`), `:20462` (`#showTicket`), `:21711–21761`; filed ticket read `api/client.ts:3038` |
| Client calls exist, no screen calls them | `api/client.ts:3847–3866`; types `api/transfer-close-types.ts` (38 lines) |
| Server: a repeat under the same submission id, **or a new id on a bill already closed** with the same person, device and content, answers the stored result; anything else differing is refused | `apps/server/src/transfer-close.ts:348–379`; tests `transfer-close.replay.test.ts:216`, `:226`, `:264` |
| Server: with `partyFinish: null` the party stays open (`["revision"]`); with it, the party closes when ready | `transfer-close.ts:309–339` |
| Unanswered bill payments are kept in memory only, not in browser storage | `till-app.ts:3746` |

## Decisions, and what is cut from the master plan's Task 7

1. **The button lives in both Pay windows, the confirmation in one new window.** `till-bill-pay-dialog`
   shows **Close as deferred payment** under the Whole bill scope line while Whole bill is chosen;
   `till-presented-pay-dialog` shows it under "whole amount only". Each only emits an event. The app
   closes Pay and opens a new `till-deferred-close-dialog`, which shows the bill, the invoice (Simplified
   invoice, or Full invoice with the customer's name and tax number), the total and one sentence
   (question 2), with **Cancel** and **Issue invoice and close** (or **Close bill** when the bill
   already has an invoice number). The method radios are not touched: no tip, change or reader fields
   to hide.
2. **Shown only when it can work:** the profile has `close-deferred`, the surface is a table, the bill
   is open or presented, has no payments, owes more than zero and no payment is out or unanswered on
   it. One pure function decides this, so it is tested once.
3. **Cut: keeping the submission in browser storage across reloads** (master 7b). The server answers a
   new submission id on an already-closed bill with the stored result when the person, device and
   request match (`transfer-close.ts:368–379`, test `replay.test.ts:216`), and a reloaded till reads
   the bill as settled, which offers no Pay (`till-table-order-screen.ts:5191–5200`). The till keeps
   the submission id and exact request body in memory while the window is open, and resends them
   unchanged on retry, as bill payments do (`till-app.ts:3746`).
4. **Cut: the recovery read in the till and the party-blocker summary.** Task 7 does not call
   `getDeferredClosure`; it stays in the client (built and tested in Task 3). The till sends
   `partyFinish` (design §2: release the party when every check passes); when the party stays open the
   till simply stays on the table and **Finish table** explains its own refusals, as after a cash
   payment. Note: after a cash payment the till never finishes the table itself; after a deferred close
   it may. That is the approved design, stated here so the owner sees it.
5. **Cut: new dashboard guide pages** (`closed-by-transfer.md`). One section in the till guide names
   the profile switch and the accountant's file; no dashboard screen changes.
6. **Moved to A739's documents window:** delivery, copies and retry after a failed print (master
   7a/Task 4's 4d). After a successful close the till reads the filed ticket and opens the existing
   documents window; it sends no delivery of its own. An exact replay writing nothing more is tested
   on the server (`transfer-close.replay.test.ts:120`). Who is recorded as closing comes from the
   session (`transfer-close-api.test.ts:197–201`); the till adds nothing about the actor, so the
   "one person issues, another closes" case, if wanted, belongs in the server's suites, not here.
7. **Probably cut, to be checked by running first:** the refund offers Task 4 handed over. Reading
   today's code, both refund offers need a refundable tender (`till-app.ts:14528–14537`;
   `:17601–17648`), and the server lists none for a deferred tender
   (`apps/server/src/tender-refund-balance.ts:122`, tested at `tender-refund-balance.test.ts:214`).
   Step 7.1 confirms this with a throwaway test (not committed); if a refund is offered after all, the
   fix joins 7.1.
8. **Not touched:** the server's command, routes, fiscal code, Task 4's labels.

## Checkpoints (one PR, owner lands it; each dispatch well under 100 tool calls)

Run till browser tests only after `memory_pressure | grep free` shows more than 15% free. Read a
`Tests` count for every run. Typecheck: `pnpm --filter @waitron/till typecheck` (and
`@waitron/server` when 7.5 changes it).

**7.1 "This bill is closed" (owner 10:14).** `apps/till/src/i18n/codes.ts:494–497` →
"This bill is closed" / «Esta cuenta ya está cerrada»; under question 4, `strings.ts:69`, `:2048`
(`cancel_item.paid`, shown by `widgets/cancel-item-dialog.ts:484`) → the same words. Every consumer
uses the one string: server throws at `bill-actions.ts:93`, `table-actions.ts:488`,
`move-bill.ts:105`, `:183`, `parties.ts:274` (409 at `till-api.ts:645`); the till picks it at
`till-app.ts:15164`, `:15550`, `state/draft-sync.ts:498`, lists it at `till-app.ts:702`, `:740`,
`:751` and checks it at `:15533`, `:20531`. Only `i18n/codes.test.ts:308–309` pins the words: a
changed check, named in the PR. Guides: EN `table-service.md:135`, `:425`; ES `:142`, `:448–449`.
Command: `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/widgets/cancel-item-dialog.test.ts`.

**7.2 The confirmation window.** New `widgets/deferred-close-dialog.ts`, `.test.ts`, `.a11y.test.ts`;
EN/ES keys in `i18n/strings.ts`, reusing `invoice.full`, `label.total`, `action.cancel`. RED:
- "shows the total, a simplified invoice and the final-close sentence, with Issue invoice and close"
- "names the full-invoice customer, and says Close bill when the invoice is already issued"
- "sends one confirm however often it is tapped or Enter pressed while busy"
- "shows a refusal at the bottom and keeps the confirm usable" (request refusals never disable it)
- a11y: idle and refused, light and dark.

Trap: `i18n/strings.test.ts`'s "no aplazar" guard (#2797's version) exempts listed keys that must
**start** with «Pago aplazado»; «Cerrar como pago aplazado» does not. Widen it to "contains «pago
aplazado»" for the listed keys, keeping the snooze ban; a changed check, named in the PR, with
#2797's control («Cancelar aplazar» on snooze still fails) rerun once.
Command: `pnpm --filter @waitron/till exec vitest run src/widgets/deferred-close-dialog.test.ts src/widgets/deferred-close-dialog.a11y.test.ts src/i18n/strings.test.ts`.

**7.3 The entry points.** New `state/deferred-close.ts` (`deferredOffered`, `deferredCloseRequest`)
with `state/deferred-close.test.ts`; `deferredOffered` property and event in both Pay windows. RED:
- `deferred-close.test.ts`: "offers the close only with the device action, on a table bill that is
  open or presented, with no payments, owing more than zero" (one table of cases); "builds the
  request from the bill: revision, total, invoice choice, staged delivery, the venue's language when
  none is stored, and the party's expected edits".
- `bill-pay-dialog.test.ts`: "offers Close as deferred payment with Whole bill chosen and emits
  bill-pay-deferred"; "offers it on a handheld with no cash or card method".
- `presented-pay-dialog.test.ts`: "offers Close as deferred payment and emits presented-pay-deferred".

Command: `pnpm --filter @waitron/till exec vitest run src/state/deferred-close.test.ts src/widgets/bill-pay-dialog.test.ts src/widgets/presented-pay-dialog.test.ts`.

**7.4 The app sends it.** `till-app.ts`: a `deferredClosing` state beside `billPaying`
(`:3744`), its render beside `#renderBillPaying`, open on the two events, confirm → `#flushDraft` and
expected edit as at `:19811–19821` → `api.closeDeferred` → `getFiledTicket` → `#showTicket(…,
{ surface: "table", cashChange: null })`; cleared where `billPaying` is cleared on sign-out. New
`till-app-deferred-close.test.ts` on `apps/till/test/bill-pay-app.ts` (`stubApi`, `billOf`, `mesa`,
`openTable`). RED:
- "closes the bill and opens the documents window for its receipt" (asserts the body sent)
- "resends a lost answer with the same submission id and the same body"
- "shows a refusal in the code's words in the window and reads the bill again"
- "a failed receipt read after the close is a load failure; nothing is sent again"
- "drops the kept submission when the person signs out; the next person's close has a new id"
- "returns to the floor when the close finished the party; stays on the table when it did not"

One-time deletion checks for the PR: drop the busy guard (double-tap case fails); make a new id per
retry (lost-answer case fails); drop the capability check (7.3's offered case fails); skip the
session reset (sign-out case fails).
Command: `pnpm --filter @waitron/till exec vitest run src/till-app-deferred-close.test.ts`.

**7.5 "Paid" marks (question 3).** Default: the bill switcher (`screens/table-bill-controls.ts:9–19`)
shows **Deferred payment** instead of **Paid ✓** for such a bill, and the floor card and table sheet
(`screens/till-floor-screen.ts:3244`, `widgets/table-details-sheet.ts:31–35`, `:195`) show **Deferred
payment** instead of **Paid** for a fully closed party holding one. The server's bills read gains
`deferred: true` (`parties.ts:570–611`) and the floor read a party flag beside `hasOpenTab`
(`working-order.ts:9196`). RED: one server case per read; one till case per mark. Commands:
`pnpm --filter @waitron/server exec vitest run src/parties.test.ts` (or the suite that owns that read)
and the till's switcher and floor suites.

**7.6 Guides and docs.** EN and ES `apps/server/src/guide/{en,es}/table-service.md`: a section
`## Close a bill as a deferred payment {#deferred-payment}` / `## Cerrar una cuenta como pago aplazado
{#deferred-payment}` after `{#pay-window}`: when to use it, that it is final and Waitron records no
later payment, that a manager switches **Closes bills as deferred payments** on in **Device profiles**,
and that the accountant's list is **Sales & takings → Export deferred payments (CSV)**. No sentence on
cases the code handles itself. `apps/till/src/help-guide.ts:3–12` gains
`"table-service.deferred-payment"`; the confirmation window carries one help-mode badge to it with an
EN/ES bubble in `i18n/help-strings.ts`. Update `design-system.md:6491–6503`, and the A275 entries in
`docs/backlog.md:296` and `docs/backlog/fiscal.md:320–358` ("Task 7 built; owner acceptance left").
Commands: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`,
`pnpm exec vitest run scripts/guide-links.test.ts`, `pnpm --filter @waitron/till exec vitest run src/help-guide.test.ts`.

**7.7 LOOK (driver).** Screenshots go in `~/waitron-campaign-l/receipts/a275-task7-screens/`, never in
the repository. Full matrix (EN/ES × light/dark × 390×844 / 1024×768) for the Pay window with the
button and the confirmation window idle; EN light desktop and ES dark phone for presented Pay, Close
bill, busy, one refusal, the documents window after a close, and the 7.5 marks. Open each image and
write what was seen in the PR. Printed paper, QR and full-invoice email stay with their own gates.

**Fiscal gate.** No file under `packages/fiscal*` or the server's command changes. Run
`git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
(expect empty) and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
unchanged, recording the counts.

## Size

Production about 420 lines: wording 10, window 140, entry points and helper 70, app 130, strings 40,
marks 30 (7.5 default; 8 under the wording-only option). Tests about 600: window 190, helper and Pay
windows 100, app 250, marks 60. Guides about 25 lines per language. No migration, no generated files.

## Open questions (recommended default first)

1. **Counter bills: leave them out of Task 7?** Default: yes, the button shows on table bills only. The
   till does not hold a Counter order's invoice type or recipient (`api/client.ts:1383–1393`), which
   the close must repeat exactly (`transfer-close.ts:426–434`), so the Counter needs a read change
   first. Example: a company collects 20 sandwiches at the Counter and will pay next week. With the
   default, staff must take that order at a table bill. Adding it later is about 60 production lines.
2. **The sentence in the confirmation window.** The design's "Your accountant checks the bank outside
   Waitron" names a bank, which the rename retired. Default: "This closes the bill for good. Waitron
   does not record the payment when it arrives." / «Esto cierra la cuenta definitivamente. Waitron no
   registra el pago cuando llegue.»
3. **"Paid" marks.** Default: **Deferred payment** on the bill switcher, floor card and table sheet for
   these bills (7.5, needs two server reads to say so). Alternative: wording only, every closed bill
   reads **Closed** / «Cerrada» on the switcher and the floor reads **Nothing to pay** / «Nada por
   cobrar» (about 8 lines, but changes what every paid table shows). Example: a €220 bill closed as
   deferred while dessert is still coming: the floor card reads "Paid" today; with the default it reads
   "Deferred payment".
4. **The Cancel item window's "This bill is paid" line** (`cancel_item.paid`, not the refusal the owner
   named). Default: the same "This bill is closed" words, since it is shown for every closed bill
   (`cancel-item-dialog.ts:484`). Example: cancelling an unserved dessert on the deferred bill above
   would otherwise say the bill is paid.

## Stale or wrong in the master plan's Task 7

- Its Pay window files were candidates; the owners are now `bill-pay-dialog.ts` and
  `presented-pay-dialog.ts`. `tender-pay.ts` is the Counter basket's card.
- Its client test file `api/transfer-close-client.test.ts` does not exist; Task 3's cases are in
  `api/client.test.ts`. Its client name `closeBillByTransfer` is `closeByTransfer` today.
- "Persist the operation in local browser storage" is unnecessary given the server's replay by bill.
- "Final in Waitron. Your accountant checks the bank" names a bank (question 2); `{#close-by-transfer}`
  becomes `{#deferred-payment}`.
- Task 4's handed-over line numbers for the `bill.paid` sites (`till-app.ts:15022`, `:15404`) have
  moved (now `:15164`, `:15550`), and its claim that the cancel and finish windows offer a refund for
  such a bill does not match a reading of today's code (decision 7); run before changing anything.
- Its dependencies on A696 and the A739 Pay contract are met or the server's: A739 closed 2026-11-11
  (watcher 17:20), and the clock refusal is in the command (`transfer-close.ts:93`).
