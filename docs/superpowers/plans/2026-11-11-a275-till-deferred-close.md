# A275 Task 7: staff close a whole bill as a deferred payment from the till's Pay window

**Status: proposed 2026-11-11; revised 2026-11-12 after one fresh-context review (no critical, four
important findings, all folded in). PR A and B1 built as one pull request (2026-11-12); B2 open.** Builds after the code-name rename PR and after #2797 (Task 4)
lands. Every `file:line` was read at main `8c530d8a65`; the files cited are unchanged at main
`4261c97fd4` (`git diff --stat`). Task 4 was read at `origin/feat/a275-transfer-labels` `85fe91b29e`.
Only files and git history were read; no test, app or screen was run for this plan.

**Outcome.** A waiter opens **Pay** on a bill that has no payments yet, chooses **Close as deferred
payment**, checks the total and the invoice in a short confirmation window, and confirms. The server
issues the invoice (or reuses one already issued) and closes the bill for good; the till then opens
the usual "choose your documents" window so the customer gets their receipt or invoice. A double tap,
a lost reply or a reload never closes the bill twice or issues a second invoice.

"Deferred payment" here means the customer pays later, outside Waitron (for example by bank
transfer); Waitron records no debt and no later receipt of the money.

## Decisions in force (2026-11-12)

Cleared by the watcher 2026-11-12 00:24 with three changes (lane L `questions.md`, "A275 Task 7: plan
CLEARED with three changes"), and the owner's two answers. These win over the text below.

- **Question 1, Counter bills: yes** (watcher 00:24: design §2 already includes them).
- **Question 2, the sentence** (owner 02:06, exactly): "The customer will pay later. This closes the
  bill now, and Waitron will not record the payment when it arrives." / «El cliente pagará más tarde.
  Esto cierra la cuenta ahora y Waitron no registrará el pago cuando llegue.»
- **Question 3: B, served or cancelled first** (owner 02:08). Until every dish is served or
  cancelled the button shows switched off with "Mark every dish served or cancel it first" and a
  Spanish twin in the same plain style; it is never hidden for this.
- **Watcher change 1:** decisions 3 and 4 disagree. Build a fresh request from the bill on screen at
  every confirm (the server already returns the stored result for a new id from the same person,
  device and content, `transfer-close.ts:369–379`), and drop 7.4b's lost-answer and sign-out cases
  with their two deletion checks, unless a case is named where a rebuilt request differs (then test
  that one).
- **Watcher change 2:** hide the button only when the device profile lacks the action, the bill
  already has payments, or it owes nothing. When a card or payment outcome is unknown, or dishes are
  unserved, show it switched off with the reason.
- **Watcher change 3:** PR B splits in two. B1: the window, the button in the open bill's Pay
  window, sending and refusals (7.2, 7.3, 7.4a), the served check, the sentence and the guide
  section. B2: the presented bill's Pay window, Counter bills and the screenshot check.
- **Watcher 2026-11-12 07:02 (option A):** PR A and B1 ship as ONE pull request, and B1 keeps its
  lost-reply recovery: after a send that got no answer, the till reads `getDeferredClosure` and
  matches this window's submission ids, so it never resends a close the server already made. This
  replaces decision 5's "the till never calls `getDeferredClosure`" and the two-PR order below.
- **Finish-branch review 2026-11-12 (not an owner decision):** after a refusal or a lost reply, a
  bill that can no longer be closed this way closes the window and the screen says why; a bill only
  blocked for now (a dish unserved, a payment unconfirmed, Current orders unread) keeps the window
  open with that reason, and the next Confirm reads the bill again first. Decided in the
  finish-branch review wave after a Codex reviewer found the window closing with no message. This
  replaces decision 3's "If it can't, the window closes and the screen shows the refusal" for the
  blocked-for-now case.
- **#2907 (A275-declined, waiting for the owner):** a declined card no longer refuses the close on
  the server; whether `hasPayments` counts a declined card decides whether PR B hides the button for
  such a bill. Check it when building B1.

## Authority

- Design approved by the owner 2026-10-22 15:55, "A275 looks fine"
  ([design §2–3](../specs/2026-10-22-a275-final-transfer-close-design.md#2-the-final-action)); H2 build
  scope "Yes" 2026-10-22 (lane L `queue.md`). This cuts the
  [master plan's Task 7](2026-10-22-a275-final-transfer-close.md#task-7-accepted-pay-integration-guides-and-visual-acceptance)
  to today's code.
- Owner 2026-10-21 ~02:40 (lane E `archive/questions-to-2026-10-23.md:6491–6493`). The owner asked "Do
  we need this at all? Wouldn't this reconciliation be done by the accountant outside of waitron",
  then chose the minimal scope in the picker. In the watcher's record, that scope has no awaiting
  balance, later receipt, partial receipts, reversals or debt list. So the close is whole-bill only,
  with no amount, tip, part or bank fields.
- Owner 2026-11-11 13:49 (lane L `questions.md:587–591`): "we're saying the payment should happen by
  bank transfer, but really it is deferred payment, not necessarily by transfer" and "Rename then
  land. \"Deferred payment\" / Pago aplazado". The watcher's note gives the button as "Close as
  deferred payment"; #2797's dated note in the design, line 3, gives the Spanish «Cerrar como pago
  aplazado». The till's interface has English and Spanish only (`apps/till/src/i18n/strings.ts:3927–3932`)
  and Task 7 prints no new word, so there are no Catalan, Galician or Basque drafts.
- Owner 2026-11-11 10:14 (`questions.md:511`): "Land; yes to 'closed'": the shared refusal "This bill
  is paid" becomes "This bill is closed" / «Esta cuenta ya está cerrada» instead of separate refusals.
- Watcher 2026-11-11 14:20 (`questions.md:626–627`), answering the lane's question with option A: one
  mechanical PR renames every code name from transfer to deferred before Task 7. **Names assumed:**
  device action `close-deferred`; routes `POST /api/working-orders/:id/close-deferred` and
  `GET …/deferred-closure`; codes `deferred_close.{ineligible,conflict,day_frozen}`; till client
  `closeDeferred` / `getDeferredClosure` in `api/deferred-close-types.ts`; stored tender `deferred`.
  If the rename picks others, substitute them.
- Owner's lane test rules (2026-11-09): test each property once, where it is decided; run to a defined
  end point before asserting something did not happen; reuse existing test support; one-time deletion
  checks go in the PR, never committed; no code or test for an event a venue cannot reach.

## What the code does today

| Fact | Where |
| --- | --- |
| Table **Pay** opens `till-bill-pay-dialog` for an open bill and `till-presented-pay-dialog` for a presented one, on any device | `apps/till/src/screens/till-table-order-screen.ts:5202–5221`; `till-app.ts:19082–19099`; renders `till-app.ts:11019–11078`, `:11080–11120` |
| Counter **Pay** stores the basket as a bill, then opens the same `till-bill-pay-dialog` (surface `counter`) | `till-app.ts:19346–19436`; `docs/developers/design-system.md:6491–6503` |
| Both Pay windows are a `wt-dialog` with a `wt-form-actions` footer; the bill window's help badge is `helpBadge(…, { guide })`; they only emit events, the app sends | `widgets/bill-pay-dialog.ts:1554–1610`, `:1560`, `:1070–1072`; `widgets/presented-pay-dialog.ts:404`, `:441–469`, `:351–353` |
| A handheld with no cash or card action still gets Pay | `till-table-order-screen.ts:1412` (`canSettle` never bound, so true); `bill-pay-dialog.ts:1739–1743` |
| The profile's actions are `this.capabilities` | `till-app.ts:3553`, set at `:10742`; list `apps/till/src/layout.ts:40–56` |
| What the app already holds about a bill's payments: a bill payment held or out (`#billPaymentHeld`), a card answer still unknown (`#unknownCardOutcome`), an unanswered whole payment (`#unansweredWholePayments`, shown to the table screen as `paymentConfirmation`) | `till-app.ts:3758–3762`, `:3325`, `:20886`, `:21067` |
| Before a bill payment the app refuses unsent dishes, saves the draft, then reads the expected edit | `till-app.ts:19807` (`#refusedUnsent`, defined `:19773–19780`), `:19811–19821` |
| A bill payment keeps its request only while its outcome is unknown, and reopens on it | `till-app.ts:19799–19806` (`#unansweredPayments`) |
| A table bill row holds what the close repeats: revision, total, invoice type, recipient, staged delivery, receipt language, `hasPayments`, `invoiceNumber` | `api/client.ts:2147–2184` (`PartyBill`); server `parties.ts:570–611` |
| A Counter bill read holds revision, expected edit and language, not the staged delivery choice | `api/client.ts:1383–1411` (`HeldOrder`), reads `:3282–3294` |
| The party's Current orders: each dish row names its bill and holds quantity, cancelled and served quantities | `api/client.ts:581–606`, `:636–644`; `till-app.ts:3417–3419` |
| The party's expected edits, as Finish table sends them | `till-app.ts:17296–17318`, used at `:17548` |
| After a full payment: close Pay, set `this.result`, open the documents window (A739 cut 7b and 8) | `till-app.ts:20064–20076`, `:20462`, `:21711–21761`; ticket read `api/client.ts:3038` |
| Sign-out closes every Pay window | `till-app.ts:18890` (`#endOperatorSession`), `:18935–18936` |
| A network failure is told apart from a refusal | `api/client.ts:123` (`isNetworkFailure`) |
| Wording can depend on an error's `reason` | `i18n/codes.ts:856–876` |
| Server: the close is one transaction; any failure rolls back the invoice too | `apps/server/src/transfer-close.ts:71–76`; route `transfer-close-api.ts:176` |
| Server: a repeat under the same id, or a new id on a closed bill from the same person and device with the same content, gets the stored result; anything else that differs is refused | `transfer-close.ts:348–379`; tests `transfer-close.replay.test.ts:216` (Counter bill), `:169–188` (seated party bill, new id), `:264` |
| Server: a Counter bill's new invoice can only be simplified | `transfer-close.ts:152` → `working-order.ts:4575–4586` |
| Server: an issued invoice's language is compared as stored | `transfer-close.ts:466–472` |

## Decisions, and what is cut from the master plan's Task 7

1. **The button sits in both Pay windows; the confirmation is one new window.** `till-bill-pay-dialog`
   shows a secondary **Close as deferred payment** under the Whole bill scope line while Whole bill is
   chosen. `till-presented-pay-dialog` shows it under "whole amount only". Each only emits an event;
   the app closes Pay and opens `till-deferred-close-dialog`. That window is a `wt-dialog` with a
   `wt-form-actions` footer, as the Pay windows are, and one `helpBadge` to the guide. It shows the
   bill, the invoice (simplified, or full with the customer's name and tax number), the total and one
   sentence (question 2). Its buttons are **Cancel** and either **Issue invoice and close**, or
   **Close bill** when the bill already has an invoice number.
2. **Offered only when it can work.** One pure function decides, from what the app holds. All must
   hold:
   - the profile has `close-deferred`;
   - the bill is open or presented, has no payments (`hasPayments`) and owes more than zero;
   - `#billPaymentHeld`, `#unknownCardOutcome` and `#unansweredWholePayments` are all clear for the bill;
   - under question 3's default, every dish of the bill in Current orders is served or cancelled,
     and Current orders were read.
3. **Keep the request only while the outcome is unknown, as bill payments do.** On a network failure
   or no answer, the app keeps the submission id and exact body, and the window shows the network
   message. Confirm resends them unchanged. Closing the window then drops them and re-reads the bill,
   so the screen shows whether it closed.

   On a definite refusal (any coded answer), the app drops them and re-reads the bill. If the bill
   can still be closed this way, the window stays open with the re-read total and invoice and the
   refusal at the bottom; the next confirm builds a new id from the re-read bill. If it can't, the
   window closes and the screen shows the refusal. A stale revision or total is never resent, and no
   request is rebuilt with a total staff did not see.
4. **Cut: keeping the request in browser storage across reloads** (master 7b). The close is one
   transaction (`transfer-close.ts:71–76`), so after a reload the bill reads either open or settled,
   never half-closed. A settled bill offers no Pay (`till-table-order-screen.ts:5191–5200`). A stale
   re-tap from a till that has not re-read yet gets the stored result, if the person, device and
   content match (`replay.test.ts:216`, `:169–188`). Otherwise it gets `conflict`. It never gets a
   second invoice.
5. **Cut: the recovery read in the till and the party-blocker summary.** The till never calls
   `getDeferredClosure`, which stays in the client. It sends `partyFinish` (design §2: release the
   party when every check passes). When the party stays open, the till stays on the table and
   **Finish table** explains its own refusals. After a cash payment the till never finishes a table
   itself; after this close it may. That is the approved design, stated so the owner sees it.
6. **Cut: new dashboard guide pages.** One till guide section names the profile switch and the
   accountant's file.
7. **Delivery belongs to A739's documents window.** After a successful close the app reads the filed
   ticket and calls `#showTicket(billId, bill.invoiceNumber === undefined, { surface, cashChange: null })`,
   with the same meaning as `till-app.ts:19262`. It sends no delivery of its own. An exact replay
   writing nothing more is tested on the server (`replay.test.ts:120`). Who closed comes from the
   session (`transfer-close-api.test.ts:197–201`).
8. **No refund is offered after this close, by two gates.** Cancel item offers only "keep the charge"
   on a settled bill without a refundable payment (`widgets/cancel-item-dialog.ts:190–201`, gate
   `till-app.ts:14520–14537`). Finish table budgets no refund for it (`:17630–17648`). The server lists
   no refundable payment for this tender (`tender-refund-balance.ts:122`, tested at
   `tender-refund-balance.test.ts:214`). The consequence is question 3.
9. **The "Paid" marks say Deferred payment** (design §4: label the bill explicitly). **Cancel item's
   "This bill is paid" line** (`cancel_item.paid`) takes the owner's "closed" words with the refusal.
10. **Not touched:** the server's close command, its routes, fiscal code and Task 4's labels.

## Two pull requests; each leaves main working, the owner lands both

Run till browser tests only after `memory_pressure | grep free` shows more than 15% free, and read the
`Tests` count of every run. Typecheck `pnpm --filter @waitron/till typecheck`, and
`pnpm --filter @waitron/server typecheck` in PR A. Each dispatch is well under 100 tool calls.

### PR A: a closed bill says so (7.1 + 7.5)

**7.1 "This bill is closed" (one dispatch).**
- Wording: `apps/till/src/i18n/codes.ts:494–497` and `strings.ts:69`, `:2048` (`cancel_item.paid`,
  shown by `cancel-item-dialog.ts:484`) become "This bill is closed" / «Esta cuenta ya está cerrada».
- Consumers, all using that one string: server throws at `bill-actions.ts:93`,
  `table-actions.ts:488`, `move-bill.ts:105`, `:183` and `parties.ts:274` (409 at `till-api.ts:645`).
  The till picks it at `till-app.ts:15164`, `:15550` and `state/draft-sync.ts:498`, lists it at
  `:702`, `:740`, `:751`, and checks it at `:15533`, `:20531`.
- Tests: only `i18n/codes.test.ts:308–309` pins the words; it is a changed check, named in the PR.
- Guides: EN `table-service.md:135`, `:425`; ES `:142`, `:448–449`.
- Command: `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/widgets/cancel-item-dialog.test.ts`.

**7.5 Deferred-payment marks (one dispatch).**
- Server: the bills read gains `deferred: true` for a bill closed this way (`parties.ts:570–611`).
  The floor read gains a party flag beside `hasOpenTab` (`working-order.ts:9196`). Both are read code
  only; `working-order.ts` also holds the issuing path, which is not touched.
- Till: client types gain both fields. The bill switcher (`screens/table-bill-controls.ts:9–19`) shows
  **Deferred payment** instead of **Paid ✓**. The floor card and table sheet
  (`till-floor-screen.ts:3244`, `widgets/table-details-sheet.ts:31–35`, `:195`) show it instead of
  **Paid** for a party with nothing left to pay that holds such a bill.
- Failing tests first: one server case per read; one till case per mark (switcher, floor card, sheet).
- Commands: the server suites that own the bills and floor reads (find them with
  `grep -l 'receiptAvailable\|hasOpenTab' apps/server/src/*.test.ts`), and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-switcher.test.ts src/screens/till-floor-screen.test.ts`.
- Real events: these marks first appear once PR B lands, so PR A lands immediately before it.

### PR B: the button (7.2–7.4, 7.6, 7.7)

**7.2 The confirmation window (one dispatch).**
- Files: new `widgets/deferred-close-dialog.ts`, `.test.ts` and `.a11y.test.ts`; English and Spanish
  keys in `i18n/strings.ts`, reusing `invoice.full`, `label.total` and `action.cancel`.
- Failing tests first:
  - "shows the total, a simplified invoice and the final-close sentence, with Issue invoice and close"
  - "names the full-invoice customer, and says Close bill when the invoice is already issued"
  - "sends one confirm however often it is tapped or Enter pressed while busy"
  - "shows a refusal at the bottom and keeps the confirm usable" (a request refusal never disables it)
  - accessibility: idle and refused, in light and dark.
- Trap: #2797's "no aplazar" guard in `i18n/strings.test.ts` exempts listed keys only if they
  **start** with «Pago aplazado», and «Cerrar como pago aplazado» does not. Widen it to "contains
  «pago aplazado»" for listed keys and keep the snooze ban. This is a changed check, named in the
  PR; rerun #2797's control once («Cancelar aplazar» on snooze still fails).
- Command: `pnpm --filter @waitron/till exec vitest run src/widgets/deferred-close-dialog.test.ts src/widgets/deferred-close-dialog.a11y.test.ts src/i18n/strings.test.ts`.

**7.3 Entry points and the request (one dispatch).**
- Files: new `state/deferred-close.ts` (`deferredOffered`, `deferredCloseRequest`) with
  `state/deferred-close.test.ts`; a `deferredOffered` property and an event in both Pay windows.
- The request carries the bill's revision and total, its invoice choice and staged delivery, and its
  receipt language. For an issued invoice the language is `bill.receiptLanguage` exactly as stored;
  otherwise it is `shownReceiptLanguage` (`widgets/receipt-language.ts:14–19`). It also carries the
  party's expected edits.
- Failing tests first:
  - "offers the close only when every condition of decision 2 holds": one table of cases, one row per
    condition failing.
  - "builds the request from the bill, sending an issued invoice's language as stored"
  - `bill-pay-dialog.test.ts`: "offers Close as deferred payment with Whole bill chosen and emits
    bill-pay-deferred", and "offers it on a handheld with no cash or card method"
  - `presented-pay-dialog.test.ts`: "offers Close as deferred payment and emits presented-pay-deferred"
- Command: `pnpm --filter @waitron/till exec vitest run src/state/deferred-close.test.ts src/widgets/bill-pay-dialog.test.ts src/widgets/presented-pay-dialog.test.ts`.

**7.4a Send, documents and refusals (one dispatch).**
- In `till-app.ts`: a `deferredClosing` state beside `billPaying` (`:3744`), rendered beside
  `#renderBillPaying`.
- Confirm: `#refusedUnsent` first, then `#flushDraft` and the expected edit as at `:19807–19821`, then
  `api.closeDeferred`, then `getFiledTicket`, then `#showTicket` as in decision 7.
- After a refusal: re-read through `#loadPartyBills` (`:12655`) and act as decision 3 says.
- Refusal words, using the post-rename codes:
  - `deferred_close.ineligible` names its reason through `codeMessage`'s reason branch
    (`codes.ts:856–876`). Paid, closed or cancelled elsewhere: "Someone has already taken a payment
    on this bill, closed it or cancelled it. The bill on screen now shows what happened." Invoice
    corrected or replaced: "This bill's invoice has been corrected or replaced, so it can't be closed
    as a deferred payment. Take payment with Pay instead." Nothing owed: "This bill owes nothing now,
    so there is nothing to close." `other_node` cannot happen while a venue has one node, so it keeps
    the general sentence.
  - `conflict` loses "Reload the bill": "This bill's total or invoice changed since you opened this
    window. Check the new details and confirm again."
  - Spanish is drafted beside each.
- New `till-app-deferred-close.test.ts` on `apps/till/test/bill-pay-app.ts` (`stubApi`, `billOf`,
  `mesa`, `openTable`). Failing tests first:
  - "closes the bill and opens the documents window for its receipt" (asserts the body sent)
  - "refuses unsent dishes before sending anything"
  - "after a refusal, the next confirm carries a new id and the re-read revision and total"
  - "closes the window and shows the refusal when the re-read bill can no longer be closed this way"
  - "a failed receipt read after the close is a load failure; nothing is sent again"
- Command: `pnpm --filter @waitron/till exec vitest run src/till-app-deferred-close.test.ts`.

**7.4b Unknown outcomes, sign-out and the table afterwards (one dispatch).**
- Failing tests first, in the same file:
  - "resends a lost answer with the same submission id and the same body"
  - "closing the window after a lost answer drops the request and re-reads the bill"
  - "sign-out drops the kept request; the next person's close has a new id": reset in
    `#endOperatorSession` (`:18890`)
  - "returns to the floor when the close finished the party; stays on the table when it did not"
- One-time deletion checks, recorded in the PR:
  - drop the busy guard: the double-tap case fails;
  - make a new id per retry: the lost-answer case fails;
  - keep the request after a refusal: the re-read case fails;
  - skip the sign-out reset: the sign-out case fails;
  - drop the capability check: 7.3's offered case fails.

**7.6 Guides and docs (one dispatch).**
- EN and ES `apps/server/src/guide/{en,es}/table-service.md` gain `## Close a bill as a deferred
  payment {#deferred-payment}` / `## Cerrar una cuenta como pago aplazado {#deferred-payment}`, after
  `{#pay-window}`. It says: when to use it; that it is final and Waitron records no later payment;
  that a manager switches **Closes bills as deferred payments** on in **Device profiles**; and that the
  accountant's list is **Sales & takings → Export deferred payments (CSV)**. Add question 3's sentence
  once it is answered.
- `apps/till/src/help-guide.ts:3–12` gains `"table-service.deferred-payment"`, with an English and
  Spanish bubble in `i18n/help-strings.ts`.
- Update `design-system.md:6491–6503`. Update the A275 entries at `docs/backlog.md:296` and
  `docs/backlog/fiscal.md:320–358` to "Task 7 built; owner acceptance left".
- Commands: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`,
  `pnpm exec vitest run scripts/guide-links.test.ts`,
  `pnpm --filter @waitron/till exec vitest run src/help-guide.test.ts`.

**7.7 Look (the driver).**
- Screenshots go in `~/waitron-campaign-l/receipts/a275-task7-screens/`, never in the repository.
- Full matrix (EN/ES × light/dark × 390×844 and 1024×768) for the Pay window with the button and for
  the confirmation window at rest.
- EN light desktop and ES dark phone for presented Pay, Close bill, busy, one refusal, the documents
  window after a close, and PR A's marks.
- Open each image and write what was seen in the PR. Printed paper, QR and full-invoice email stay
  with their own gates.

**Fiscal gate (both PRs).** No file under `packages/fiscal*` changes, and neither does the server's
close command. PR A edits read code in `parties.ts` and `working-order.ts`; the issuing functions in
`working-order.ts` (`priceForIssuance`, `issueUnpaidInvoice`, `refuseUnavailableFullInvoice`) are
untouched. Run
`git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
(expect empty) and
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`,
recording the counts.

## Size

| | Production | Tests |
| --- | --- | --- |
| PR A (7.1 wording 10; 7.5: two server reads 30, four client types 8, three marks 16, four strings 4) | ~70 | ~125 |
| PR B (window 150, entry points and request 100, app 7.4a 120 + 7.4b 60, strings and refusal wording 90) | ~520 | ~670 |
| Counter, if question 1 is yes (in PR B) | +~40 | +~70 |

Guides: about 30 lines per language in PR B and 4 in PR A. No migration, no generated files.

## Open questions (recommended default first)

1. **Counter bills: include them in PR B?** Default: yes, as one more dispatch.
   - Why: design §2 includes them ("Counter has no table to release"), the master plan's look list
     names "Counter + seated/split bills", and #2797 already labels such an order "Deferred payment,
     not handed over".
   - What it needs: a Counter close is always a simplified invoice with no recipient
     (`transfer-close.ts:152` → `working-order.ts:4575–4586`). The till already holds the revision,
     expected edit and language (`HeldOrder`, `api/client.ts:1383–1411`). It lacks only the staged
     delivery choice the server compares (`transfer-close.ts:436–482`), so the held-order reads gain it.
   - Example: a company collects 20 sandwiches and pays next week. With yes, staff close it at the
     Counter. With no, they must ring it up on a table bill.
2. **The sentence in the confirmation window.** The design's "Your accountant checks the bank outside
   Waitron" names a bank, which the rename retired. Default: "This closes the bill for good. Waitron
   does not record the payment when it arrives." / «Esto cierra la cuenta definitivamente. Waitron no
   registra el pago cuando llegue.» Example: a regular who pays by Bizum at month end reads nothing
   about a bank.
3. **A dish cancelled after the close stays on the customer's invoice** (decision 8). Default: **B**,
   offer the button only once every dish on the bill is served or cancelled.
   - Under B: Waitron can never invoice an uneaten dish. It costs about 15 lines in decision 2's
     function, using Current orders the till already reads. It narrows design §2, which expected
     closes with service unfinished.
   - Under **A**: accept the gap, and the guide says "close as a deferred payment once everything is
     served; a dish cancelled afterwards stays on the invoice". Fixing such a bill then needs a
     corrective invoice.
   - Example: a €220 bill is closed while a €12 dessert is still coming, and the dessert is then
     cancelled. Under A the customer's invoice still says €220. Under B, staff serve or cancel the
     dessert first, and the invoice says €208.
   - Counter food is handed over after paying, so the served check does not apply there; under
     question 1 the Counter takes A's guide sentence.

## Stale or wrong in the master plan's Task 7

- Its Pay window files were candidates. The owners are now `bill-pay-dialog.ts` and
  `presented-pay-dialog.ts`; `tender-pay.ts` is the Counter basket's card.
- Its client test file `api/transfer-close-client.test.ts` does not exist; Task 3's cases are in
  `api/client.test.ts`. Its `closeBillByTransfer` is `closeByTransfer` today.
- "Persist the operation in local browser storage" is unnecessary (decision 4).
- "Final in Waitron. Your accountant checks the bank" names a bank (question 2), and
  `{#close-by-transfer}` becomes `{#deferred-payment}`.
- Task 4's handed-over line numbers for the `bill.paid` sites (`till-app.ts:15022`, `:15404`) are now
  `:15164`, `:15550`. Its "refund offered" item is now decision 8 and question 3: no refund is
  offered, so the risk is the reverse, a charge that cannot be taken back.
- Its dependencies on A696 and the A739 Pay contract are met or are the server's. A739 closed
  2026-11-11 (watcher 17:20), and the clock refusal is in the command (`transfer-close.ts:93`).
