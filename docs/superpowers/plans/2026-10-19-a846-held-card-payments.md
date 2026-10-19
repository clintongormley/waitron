# A846 — Held card payments: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (money: a card payment the venue may owe back; a migration with two
append-only tables; a change to the shared scheduler; a change to how every recorded alert can link
to a screen). **One pull request for the whole item.** Branch `feat/a846-orphan-mismatch-reminder`,
worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a846-orphan-mismatch-reminder`.
Implementers are dispatched as `subagent_type: "implementer"`. An implementer that passes about 150
tool calls unfinished stops at a passing or cleanly failing point, commits, and hands over.

Words used throughout, explained once:

- **Orphan** — a card payment Waitron holds (`captured`) whose order was closed or abandoned with no
  sale, so no invoice will ever account for it.
- **The sweep** — the daily payments check, `reconcilePayments`
  (`packages/payments/src/reconcile.ts:215`). For one day it compares Waitron's card payments with
  the card provider's own record of what it paid out, and refunds an orphan when every safety check
  passes.
- **Held payment** — an orphan whose amount the provider paid out differs from the amount Waitron
  recorded. The sweep will not refund it (`amountDrifted`, `reconcile.ts:293-296`), because the
  refund would send back the provider's figure while Waitron recorded its own.
- **Alert** — a row in `incidents` (`packages/db/src/schema/incidents.ts:23-42`) shown on the
  dashboard's bell and Alerts screen until a manager marks it handled.
- **The scheduler** — `packages/scheduler`, which runs the sweep once for each finished day and
  retries a failed run.

**Goal:** a held payment stays in front of a manager until someone records what was done with it.
The Payments screen lists every held payment; a manager records "Refunded in the card provider's
dashboard" or "Kept: the money was owed", with an optional note and their PIN; Waitron refunds
nothing. One alert names every held payment, links to that list, can be marked handled, and comes
back the next morning while any held payment has no outcome. A day whose check fails three times is
checked again the next day instead of never.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, drizzle-kit 0.31.11, Hono routes, Lit
dashboard, Vitest (browser mode for the dashboard).

**Sources:** `docs/backlog/payments.md` → "A846. Held card payments: what the check found, and what
to build"; the backlog entry in `docs/backlog.md` (search `A846`); the picture
`docs/backlog/mockups/a846-held-card-payments/01-record-what-was-done.png` (and `-dark`); owner
question Q44's answers (below).

---

## The owner's fee question

**The question.** "Perhaps Stripe routinely refunds or pays out less than the original charge
because they take their fees off the total. If so this will be a frequent event and should be
treated as normal and automatic, not as needing management. How do we recognise a normal difference
from an abnormal one?"

**The answer: Stripe's fee never makes a payment held.** The sweep compares Waitron's amount with
the charge's full amount before Stripe's fee, never the amount left after it. A test now proves it
through the real code: a €10.00 orphan whose Stripe charge lost a €0.34 fee (so €9.66 reached the
venue's Stripe balance) is refunded as an ordinary orphan, and is not held. A difference is
abnormal by definition: in the way Waitron charges today, nothing routine makes the two figures
differ. Held payments should be rare, so treating each one as needing a person is right.

**The receipt.** `packages/payments-stripe/src/stripe-report-client.test.ts` (commit `4627e505d`)
feeds the real `stripeReportClient` a Stripe balance transaction of `amount: 1000, fee: 34, net:
966` and runs the real `StripeReconciler` and `reconcilePayments` over a real venue database. Run:
`pnpm --filter @waitron/payments-stripe exec vitest run src/stripe-report-client.test.ts --project node`
→ `Tests 3 passed (3)`. A second case holds a payment whose full amount really differs (€12.50), so
the first case cannot pass by default. Control: with `stripe-report-client.ts:23` changed to read
`bt.net`, all three cases failed (`expected [ 966 ] to deeply equal [ 1000 ]`; the fee case reported
as a difference at `9.66`; `12.11` for `12.50`); restored, all three pass.

**Every cause that can make Stripe's figure differ from Waitron's**, each with Stripe's own words
(fetched with `curl` from the `.md` form of each page on 2026-10-19 and quoted from the raw text;
send `-H "Accept-Language: en-US"` to re-check — on 2026-10-19 the hold page came back in Italian
without it)
and whether Waitron can hit it. Waitron's figure is `payments.amount`
(`packages/payments/src/schema/payments.ts:76`), read by `listReconcilable`
(`packages/payments/src/store.ts:709-740`); no update in `store.ts` sets `amount` after a payment is
written (every `.set({…})` in the file, at lines 192, 220, 263, 298, 534, 558, 586, 608 and 803,
leaves it alone). Stripe's figure is the balance transaction's `amount`
(`packages/payments-stripe/src/stripe-report-client.ts:23`), listed for `type: "charge"` only
(`:11`).

| Cause | Stripe's words | Can Waitron hit it? |
| --- | --- | --- |
| Stripe's fee | Balance transaction `amount`: "Gross amount of this transaction (in the smallest currency unit)." `net`: "You can calculate the net impact of a transaction on a balance by `amount` - `fee`" — https://docs.stripe.com/api/balance_transactions/object | **No.** The sweep reads `amount`, never `net` (`stripe-report-client.ts:22-23`); the test above proves it. |
| Currency conversion | `exchange_rate`: "if you charge a customer 10.00 EUR, the PaymentIntent's `amount` is `1000` and `currency` is `eur`. If this converts to 12.34 USD in your Stripe account, the BalanceTransaction's `amount` is `1234`, its `currency` is `usd`" — same page. "If the charge currency differs from your *settlement currency* … Stripe converts the charge to your settlement currency" — https://docs.stripe.com/currencies/conversions | **Not in normal use.** Waitron always charges in euros (`CURRENCY = "eur"` at `packages/payments-stripe/src/provider.ts:53`, `hosted-provider.ts:14`, `device-provider.ts:33`), and a Spanish venue's Stripe account settles in euros. Only a Stripe account set to pay out in another currency would make every payment differ — a setup fault, and today nothing checks `bt.currency`. Left as a backlog entry (Task 11). |
| Capturing less than was authorised | "To capture less or (for certain online card payments) more than the initial amount, pass the `amount_to_capture` option. A partial capture automatically releases the remaining amount." — https://docs.stripe.com/payments/place-a-hold-on-a-payment-method. Charge `amount_captured`: "can be less than the amount attribute on the charge if a partial capture was made" — https://docs.stripe.com/api/charges/object | **No.** Waitron creates every reader payment with `capture_method: "automatic"` (`packages/payments-stripe/src/stripe-client.ts:24`) and never sends `amount_to_capture` (no match in `packages/*/src` or `apps/*/src`). |
| A tip added on the card reader | "When you process the payment, the reader adds the selected tip. If the payment is successful, the amount in the `PaymentIntent` and `Charge` updates to include the tip amount." On-reader tipping for the S700/S710 and WisePOS E readers is "Available in: … ES …" — https://docs.stripe.com/terminal/features/collecting-tips/on-reader and https://docs.stripe.com/terminal/features/collecting-tips/overview. It is set up through "a Configuration object or the Dashboard". | **Not as Waitron is set up, but one Stripe setting away.** Waitron takes the tip at the till and adds it to the amount it charges (`tipOf`, `apps/server/src/till-sale.ts:1307`). It creates no Stripe Terminal configuration (no `terminal.configurations` call in `packages/*/src` or `apps/*/src`) and does not turn the reader's tip screen off either: `processPaymentIntent` sends only the payment's id (`stripe-client.ts:30-33`), where Stripe offers `process_config[skip_tipping]=true`. If the owner switched tipping on in Stripe's Dashboard, every tipped reader payment would be charged more than Waitron records (Waitron records its own amount on success, `provider.ts:301`), every such payment would be reported as a difference, and an orphaned one would be held. Left as a backlog entry and an owner point (Task 11, Open points). |
| A platform's application fee | Charge `application_fee_amount`: "The amount of the application fee (if any) requested for the charge." — https://docs.stripe.com/api/charges/object | **No.** Waitron uses the venue's own Stripe account and sends no application fee (no `application_fee` in `packages/*/src` or `apps/*/src`); and a fee is in `fee`, not in the gross `amount`. |
| A refund or dispute | Charge `balance_transaction`: "ID of the balance transaction that describes the impact of this charge on your account balance (not including refunds or disputes)." — https://docs.stripe.com/api/charges/object | **Never changes the figure.** A refund is a balance transaction of its own, and the sweep lists `type: "charge"` only (`stripe-report-client.ts:11`). So a payment someone refunds in Stripe's dashboard still reads as different on every later check — which is why a person has to record the outcome. |
| A hosted (online) payment | — | **No.** Waitron's checkout session has one line at Waitron's amount (`stripe-hosted-client.ts:19-27`), with no tax or discount options, and Waitron records the session's own `amount_total` (`hosted-provider.ts:68`). |

**Not tested against Stripe.** Every row above is Stripe's documentation and Waitron's code; none
was run against a real Stripe account.

---

## The owner's decisions (Q44)

- **(a) Yes:** a "Held: paid out at a different amount" list on the Payments screen, in the section
  that already lists stuck bill payments and refunds, every held payment whatever day it was taken,
  each with Record outcome: "Refunded in the card provider's dashboard" or "Kept: the money was
  owed", an optional note and the manager PIN, like that section's existing Record outcome.
  Recording ends the checks and reminders for that payment; Waitron refunds nothing.
- **(b)** An ordinary alert that can be marked handled and comes back the next morning while any held
  payment has no outcome (not an alert that cannot be dismissed). It must name every held payment
  and link to the list.
- **Built either way:** a check that fails three times in a row is retried the next day instead of
  being parked for good; the alert wording stops saying Waitron may not check these payments again.

---

## What exists today (traced)

**The sweep.** `reconcilePayments` (`reconcile.ts:215-327`) reads the day's rows in one transaction
(T1, `:221`), fetches the provider's report outside any transaction (`:224-227`), classifies
(`classify`, `:130-172`), then in a second transaction (T2, `:252-310`) decides each orphan's
fate in gate order — `workingOrderNotAbandoned`, `stateNotCaptured`, `alreadyClaimed`,
`amountDrifted`, else `claimed` (`:277-306`) — and raises one alert per class
(`raiseRowIncidents`, `:336-362`). A held payment raises `payment.reconcile_orphan` (its entry
carries `remediation: "amountDrifted"`) and `payment.reconcile_drift`.

**Why a second held payment is hidden.** `recordIncidentOnce` (`packages/core/src/incidents.ts:59-87`)
inserts `on conflict … where acknowledged_at is null do nothing` against the partial unique index
`incidents_open_dedup` on `(source, device_id or '', code, sale_id or '')`
(`packages/db/src/schema/incidents.ts:64-71`). Every sweep alert has the payment check's source, no
device and no sale, so there is at most one open alert per code; once handled, the key is free again
(`incidents.ts:56-57`, `:213-214`). Params are written once: nothing updates an open incident's
params (the only `update(incidents)` outside tests is `markIncidentHandled`, `incidents.ts:216-224`).
The measured result (`docs/backlog/payments.md`, A846): with held payments on 1 and 2 July and every
alert handled each morning, the orphan alert named only the first for four days.

**The re-check chain.** `reconcilerAsDuty` (`apps/server/src/reconcile-duty.ts:10-25`) returns
`resweepAfter: now + 1 day` when an orphan is also a difference (`gatedDriftOrphan`, `:27-30`). The
scheduler stores it as a new `pending` row of the same day, one generation up (`enqueueSuccessor`,
`packages/scheduler/src/store.ts:217-256`, called from `run.ts:194-200` only after a successful run).

**Parking.** A failed run is retried after 15 then 30 minutes (`backoff`, `run.ts:224-226`;
`backoffBaseMs: 15 * 60 * 1000`, `derive.ts:88-97`); the third failure parks it
(`parkOrRetry`, `run.ts:219-222`, `maxAttempts: 3`). `parked` is terminal (`derive.ts:86`), the day
already has a row so it is never a gap again, and no successor is queued — so no later day checks
it. This applies to a first check too. Only one scheduled duty exists in production
(`apps/server/src/boot.ts:1481`, `duties: [duty]` at `:2374`). Readers of `parked`:
`apps/server/src/pass.ts:30-36,118-134,206-213`, `apps/server/src/health.ts:36,52,63,86-90,116-128,155`,
`apps/server/README.md:469-483,504-507,542-545`. No alert is raised on parking.

**Alerts and links.** An alert is either an *event* (a stored incident; `eventAlert`,
`apps/server/src/alerts.ts:63-76`) or *ongoing* (computed each time the dashboard asks; an
`AlertSource`, `packages/module/src/alerts.ts:35-42`). Only an ongoing alert can link to a screen:
`screenTargetOf` (`apps/dashboard/src/widgets/alert-format.ts:14-23`) answers a screen only for
`kind === "ongoing"`, and `eventAlert` sets none. Only an event can be marked handled
(`incidentIdOf`, `alert-format.ts:8-12`). The bell and the Alerts screen already draw both buttons
independently (`apps/dashboard/src/widgets/alerts-bell.ts:136-166`;
`apps/dashboard/src/screens/alerts-screen.ts:174-193`). An event's area comes from the longest
matching prefix claim (`claimFor`, `alerts.ts:37-47`); payments claims `payment.` at
`packages/payments/src/alerts.ts:3`. The Handled tab names the handler, or "someone" when
`acknowledged_by` is null (`alerts-screen.ts:214-216`; `alerts.ts:204-205`).

**Wording.** `apps/dashboard/src/i18n/alert-messages.ts`: `NOT_RECHECKED_EN` ("Marking it handled
does not fix it, and Waitron may not check these payments again.") and `NOT_RECHECKED_ES` (`:18-21`)
end `payment.reconcile_unsettled`, `_lost_settlement`, `_orphan`, `_missing_local` and `_drift`
(`:238-257`). The file's header (`:5-11`) says no sentence promises a later check by the server.
Messages fill `{name}` slots only (`packages/dashboard-kit/src/alert-messages.ts:46-72`); nothing
renders `params.payments`.

**The Payments screen section.** `#renderBillRecovery()`
(`apps/dashboard/src/screens/payments-screen.ts:1421-1478`) draws "Bill payments and refunds
awaiting a card provider" with its lists, and is hidden when every list is empty (`:1429-1432`).
Its Record dialog (`#renderBillDialog()`, `:1509-1614`) uses `draftScopeFor` (`#openBillAction`,
`:1111-1132`) and `saveActionState` (`:1515`, `:1607-1609`), a `wt-combobox` for the outcome, a
required `wt-input` note and a password `wt-input` PIN; a PIN refusal shows beside the PIN
(`:1511-1513`), a "no longer pending" refusal closes the dialog and shows the section's result line
(`:1250-1266`), anything else goes to the form's bottom message (`:1516-1519`). The section's lists
are live: `payments-screen.ts:538-562` watches the stuck lists, with dependencies in
`apps/dashboard/src/api/live-queries.ts:163-172`.

**The section's Record route.** `POST /management-api/payments/bill-payments/:id/attest`
(`apps/server/src/payments-api.ts:1196-1237`): management session only, permission `payments.manage`
(`:123`), PIN checked before the write lock by `pinGated` (`:306-329`, via `managerPinToCheck`
`:270-284` and `verifyManagerPin` `:287-304`), body parsed by `parseAttestation` (`:221-232`, which
refuses a blank note), all in one `withTransaction` through `gated` (`:256-266`). Its tests:
`apps/server/src/payments-api.stuck.test.ts:1614-1996`. No device session or device profile is
involved: this is a dashboard route, so the till-route rules in CLAUDE.md §3 do not apply.

**Storage the payments module owns.** `PAYMENTS_CLASSIFICATION`
(`packages/payments/src/classification.ts:11-21`): `payments` and `payment_refunds` are `ledger`,
`payment_resolutions` is `appendOnly` `ledger`. Every classified table is a live change source
(`:23-25`). The migration set is `packages/payments/drizzle`, latest `0008_automatic_payment_resolution`;
its manifest entry lists `appendOnlyTables: ["payment_resolutions"]`
(`packages/migrations/migrations.manifest.json:62-67`). Foreign keys pointing at `payments`:
`payment_refunds.payment_id` (`packages/payments/src/schema/payment-refunds.ts:29`) and
`payment_resolutions.payment_id` (`payment-resolutions.ts:46`). `payment_resolutions.person_id` has
no foreign key because `persons` is in another migration set this one does not require
(`payment-resolutions.ts:29-31`).

**The user guide** has no Payments page (`apps/server/src/guide/en/` and `es/` hold
`content-and-images.md`, `modifiers.md`, `products.md`; `apps/dashboard/src/help-guide.ts` has no
payments link), so no guide changes.

---

## Decisions (each conservative, following an existing pattern)

**D1. Two new append-only tables in the payments module's own set.**
- `payment_holds` — one row per held payment, written by the sweep the first time it holds it:
  `id`, `payment_id` (foreign key to `payments.id`, `on delete restrict`, unique
  `payment_holds_payment_key`), `provider_amount` (`money`, check `> 0`, the provider's figure in
  whole cents, converted at the row with `decimalToCents`), `found_at` (`tsString`).
- `payment_hold_outcomes` — one row per recorded outcome: `id`, `hold_id` (foreign key to
  `payment_holds.id`, `on delete restrict`, unique `payment_hold_outcomes_hold_key`), `outcome`
  (`'refunded_at_provider' | 'kept'`, an enum check), `note` (nullable; when present not blank, as
  `bill_payments_attestation_ck` requires of its note, `packages/db/src/schema/bill-payments.ts:94-97`
  — use the same column builder as `attestation_note`), `person_id` (no foreign key, for the reason at
  `payment-resolutions.ts:29-31`), `recorded_at` (`tsString`).
- Both `appendOnly("…", "ledger", LEDGER)`: a provider's figure and a manager's statement of what was
  done with money are audit facts that must never be corrected, like `payment_resolutions`. Two
  tables rather than outcome columns on the first, so neither row is ever updated.
- No rebuild: only new tables are created, so no existing table's foreign-key children are at risk
  (CLAUDE.md §3 rebuild trap). Ledger to ledger keys only; no `local` table is involved.

**D2. What counts as held, exactly.** An orphan that reaches the `amountDrifted` gate
(`reconcile.ts:293-296`): abandoned order, `captured`, never claimed for a refund, amounts differ.
The sweep records a `payment_holds` row for it in T2, with
`onConflictDoNothing({ target: paymentHolds.paymentId })` (target named: CLAUDE.md §3), so a
concurrent sweep or a re-sweep never writes a second row.

**D3. A recorded outcome ends the checks.** `listReconcilable` gains `paymentId` and `holdResolved`
(true when the payment has a hold with an outcome). `classify` still counts such a row as matched (so
its settlement never reads as missing) but files it in no class. So it raises nothing, is never
refunded, and stops `gatedDriftOrphan` asking for tomorrow's re-check.

**D4. One alert for held payments, apart from the orphan and difference alerts.** New code
`payment.reconcile_held`, severity `error`, source the payment check, params
`{ count, payments: [{ paymentRef, workingOrderId, amount, providerAmount }] }` registered in
`packages/payments/src/errors.ts`. A held payment leaves the `payment.reconcile_orphan` and
`payment.reconcile_drift` alerts (it is still in the sweep's result lists, so the run summary and the
re-check chain are unchanged), so one held payment raises one alert, not three.

**D5. Keeping the alert true: replace, do not stack.** Because an open alert's params never change,
"name every held payment" needs the alert to be replaced when the set changes.
`refreshHeldAlert(tx, sink, { now, by })` in a new `packages/payments/src/held-alert.ts`:
1. `H` = every hold with no outcome, oldest first.
2. Read two incidents of code `payment.reconcile_held` from the payment check: `open`, the open one
   (the `incidents_open_dedup` index allows at most one), and `lastHandled`, the most recently
   handled one (newest `acknowledged_at`, then the later `detected_at`, then id). Do not pick "the latest, open or handled" by
   `detected_at`: the sweep passes one `now` to T1 and T2, so a replacement in T2 gives the handled
   alert and its successor the same `detected_at`, and the id tie-break between two random UUIDs
   would then pick either.
3. If `H` is empty: mark `open` handled (by `by`), if there is one, and stop. ("When no held payment
   is left, the alert goes.")
4. If `open` names exactly `H`'s payments: do nothing. If it names a different set: mark it handled
   (by `by`) and raise a new one naming `H`.
5. If there is no `open`: raise one naming `H` when `lastHandled` is null, when `lastHandled` was
   handled before the start of the current UTC day (the morning return: the owner's "comes back the
   next morning" counts from when it was marked handled, so an alert raised yesterday and handled
   at 15:00 today stays down until tomorrow), or when `H` holds a payment `lastHandled` did not name
   (a new held payment is never hidden).
The sweep calls it in T1 (so the morning return happens even when the provider's settlement report
cannot be fetched that day — though not when `StripeReconciler.reconcile`'s `resolveAccount()`
throws first, `packages/payments-stripe/src/reconciler.ts:37`, for example with
`server.credential_unusable` or `payment.credential_environment_mismatch`
(`apps/server/src/stripe-account.ts:59,63`), because that throw comes before `reconcilePayments`
opens T1; Open point 7) and again at
the end of T2 only when T2 wrote a new hold, with `by: null`. The Record route calls it in its own
transaction with `by` = the recording manager. A replaced alert therefore shows in the Handled tab
as handled by the manager who recorded an outcome, or by "someone" when the sweep replaced it
because a new held payment appeared (Open point 3).

**D6. How payments reaches incidents.** `packages/payments` keeps `@waitron/core` a development
dependency (`reconcile.ts:47-51`), so the sink is typed structurally and injected, as `IncidentSink`
is: `HeldAlertSink = { raise: IncidentSink; current(tx, { origin, code }); handle(tx, { id,
personId, handledAt }) }`. `@waitron/core` gains `currentIncidentsOf(tx, { origin, code })`,
answering `{ open, lastHandled }` as D5 step 2 defines them (each `null` when there is none), and
`markIncidentHandled` accepts `personId: string | null` (`incidents.ts:216-224`; null today is what
the Handled tab already reads as "someone"). `StripeReconciler`
(`packages/payments-stripe/src/reconciler.ts:40-50`) and `FakeReconciler`
(`packages/payments/src/testing/fake-reconciler.ts`) pass `{ raise: recordIncidentOnce, current:
currentIncidentsOf, handle: markIncidentHandled }`.

**D7. "Next morning" is the next UTC day**, the same day boundary as the scheduler's periods
(`utcDayStart`, `packages/scheduler/src/derive.ts:7`). The first check of each day runs at the first
scheduler tick after 00:00 UTC (01:00 or 02:00 in Spain), so a handled alert is back before the
venue opens. `packages/payments` may not import the scheduler; compute the day start inline
(`Date.UTC` of the year, month and day). Open point 2.

**D8. Events may link to a screen.** `AlertEventClaim` (`packages/module/src/alerts.ts:45-49`)
gains optional `screen`; `eventAlert` copies it to the alert; `screenTargetOf` stops requiring
`kind === "ongoing"`. Payments adds a second, longer claim
`{ prefix: "payment.reconcile_held", area: "payments", permission: "payments.manage", screen:
"payments" }` beside `payment.` (`claimFor` picks the longest, `alerts.ts:37-47`; two claims on one
prefix throw, `alerts.ts:30-31`, and these differ). The held alert then shows both "Mark handled" and
the existing "Go to {screen}" button (`"alerts.go_to"`, `apps/dashboard/src/i18n/strings.ts:806`,
ES `:3920`) — not the picture's "Open Payments" (Open point 4).

**D9. A parked check is tried again the next day, for duties that ask.** `PeriodDuty`
(`packages/scheduler/src/duty.ts:31-37`) gains optional `retryParkedAfterMs`. When a run parks and
its duty sets it, the same transaction that parks the row queues the next generation of that day,
due `now + retryParkedAfterMs`, through `enqueueSuccessor` (which already treats `parked` as
terminal, pinned by `store.test.ts:393`). `reconcilerAsDuty` sets one day. A duty without the field
parks for good, as today, so `run.test.ts:131` keeps its assertion. The parked row stays `parked`,
so `/health` still reports that pass as degraded (`health.ts:86-90`).

**D10. Wording.** Drop `, and Waitron may not check these payments again` from all five alerts
(the owner's decision): each keeps " Marking it handled does not fix it." (ES " Marcarla como
resuelta no lo soluciona."). The held alert, adapted from the picture to the `{count}` form every
payment alert uses:
- EN: `{count} card payments for closed orders were paid out at a different amount than was charged. Waitron will not refund them. Record what was done with each on Card payments.`
- ES: `{count} pagos con tarjeta de pedidos cerrados se liquidaron por un importe distinto del cobrado. Waitron no los devolverá. Registra qué se hizo con cada uno en Pagos con tarjeta.`
  (the screen's own nav names, `nav.payments`: "Card payments" at `strings.ts:978`, "Pagos con
  tarjeta" at `:3993`.)
It carries no `MORE_EN`: the replacement in D5 keeps the count true. The header comment (`:5-11`)
gains the held alert among those that come back on their own.

**D11. The list and the dialog, quoted from the picture.** Inside `#renderBillRecovery()`, after the
existing lists, a sub-heading `Held: paid out at a different amount` and one row per held payment:
`Order {number} · {date, time}` (the payment's `settled_at`, sent as `settledAt`, formatted as the section's other rows
format times), under it `Charged {amount} · {provider} paid out {providerAmount}` (the provider's
display name as the section already shows it), and a secondary button `Record outcome`. Shown only
when at least one held payment exists, and the section's "all lists empty" check (`:1429-1432`)
counts it. The dialog: heading `Record what was done`; the row's order line; `Charged here` and
`{provider} paid out` with the two amounts; `Outcome` (required) with `Refunded in the card
provider's dashboard` and `Kept: the money was owed`; `Note` (optional); `Manager PIN` (required,
the existing `payments.bill.pin`); buttons `Cancel` and `Record`. The outcome is a `wt-combobox`
like the section's existing dialog, because no radio-group primitive exists in `packages/ui` (Open
point 5). The paragraph under the picture's buttons and its caption are notes for the owner, not
product text. Words the picture does not draw (defaults): outcome missing → `Choose what was done.`
(ES `Elige qué se hizo.`); recorded → `Outcome recorded. That payment is no longer checked.` (ES
`Resultado registrado. Ese pago ya no se comprueba.`); `payment.hold_not_found` → `That payment is
no longer held.` (ES `Ese pago ya no está retenido.`); `payment.hold_already_recorded` → `Someone
has already recorded what was done with that payment.` (ES `Alguien ya ha registrado qué se hizo con
ese pago.`). Spanish list heading `Retenidos: liquidados por otro importe`; row `Cobrado {amount} ·
{provider} liquidó {providerAmount}`; `Registrar resultado`; dialog `Registrar qué se hizo`,
`Cobrado aquí`, `{provider} liquidó`, `Resultado`, `Devuelto en el panel del proveedor de tarjetas`,
`Conservado: el dinero se debía`, `Nota`, `Registrar`.

**D12. The Record route.** `GET /management-api/payments/held` lists every hold with no outcome,
oldest first: `{ holdId, paymentRef, provider, orderNumber, label, settledAt, amount, providerAmount }`
(`label` left out when the order has none)
(amounts as decimal strings via `centsToDecimal`). `POST /management-api/payments/held/:id/outcome`
with `{ outcome, note?, pin }`: management session, `payments.manage`, the PIN checked before the
write lock through `pinGated` exactly as the attest route does; one `withTransaction` that
re-checks the hold, writes the outcome row and calls `refreshHeldAlert` with `by` = the manager.
Refusals, named by concept beside their siblings `payment.not_found` and
`payment.already_associated` (`packages/payments/src/store.ts:291,313`):
`payment.hold_not_found` (404), `payment.hold_already_recorded` (409), `management.request_invalid`
with `field: "outcome"` or `field: "note"` (a note present but not text; `parseAttestation`
sets no length limit, `payments-api.ts:221-232`, so neither does this route), `shared.invalid_id`, and the PIN and session refusals the attest
route already gives. The note is trimmed and an empty note stored as null.

---

## Tasks

Every task: failing test first, watch it fail, minimal code, watch it pass, run the named guards,
typecheck the changed packages, `pnpm format:check`, commit with `git commit -s`. Under an AI agent
Vitest hides a passing test's output (CLAUDE.md §4); read the `Tests` count, never the exit status of
a pipe. `useVenueDb` empties every table between tests with the triggers dropped
(`packages/db/src/testing/venue-db.ts:34-41,190-195`), so suites whose `beforeEach` deletes
`payments` keep working after holds exist — confirm by running them, do not assume.

### Task 1: core can find a code's open and last-handled alert, and the system can mark one handled

**Files:** Modify `packages/core/src/incidents.ts` (add `currentIncidentsOf`, D6;
`markIncidentHandled`'s `personId: string | null`), `packages/core/src/index.ts` (export). Test
`packages/core/src/incidents.test.ts`.

- [ ] **Step 1: failing tests** — `"answers the open incident of a code and the last one handled"`
  (three incidents of one code: two handled at different times, one open; a fourth of another code
  and one of the same code from another source; expects the open one and the later-handled one,
  and `{ open: null, lastHandled: null }` for an unused code); `"picks the open incident, not a
  handled one detected at the same instant"` (a handled and an open incident with equal
  `detected_at`, the handled one given the higher id — the case a `detected_at` ordering gets
  wrong); `"marks an incident handled by no one"` (personId `null`; the row is handled,
  `acknowledged_by` null, and the key is free: a `recordIncidentOnce` after it returns `true`).
- [ ] **Step 2:** `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts` → FAIL.
- [ ] **Step 3:** implement; **Step 4:** same command → PASS. If `packages/core` has an
  "exports exactly" pin, it gains `currentIncidentsOf` (say so in the commit).
- [ ] **Step 5:** `pnpm exec vitest run scripts/errors-reachable.test.ts`; typecheck `@waitron/core`
  and `@waitron/server` (the route's caller of `markIncidentHandled` still passes a string).
- [ ] **Commit** — `Let the payments check find its latest alert and close one itself (A846)`.

### Task 2: a parked check is tried again the next day

**Files:** Modify `packages/scheduler/src/duty.ts` (`retryParkedAfterMs?: number` on `PeriodDuty`,
and correct the comment at `:25-27` so it says parking is final unless the duty asks), `run.ts`
(`runOne`, `:141-217`: the successor's due time is `resweepAfter` on success, or
`now + duty.retryParkedAfterMs` on park; the "mutually exclusive" comment at `:213-214` still holds
because a parked row has no `nextAttemptAt`, but `CompletedRun`'s comment at `:124-128` — "Null
there when the run left nothing further due (… or a park …)" — becomes false for a duty that sets
the field: correct it), `apps/server/src/reconcile-duty.ts` (set
`retryParkedAfterMs: DAY_MS`). Tests `packages/scheduler/src/run.test.ts`,
`packages/scheduler/src/resweep.test.ts`, `apps/server/src/reconcile-duty.test.ts`.

- [ ] **Step 1: failing tests** in `run.test.ts`, with a throwing duty that sets the field
  (`packages/scheduler/src/testing/fake-duty.ts:12-35` shows the shape):
  `"queues the parked day again after the duty's retry delay"` (three failing ticks two hours apart;
  the row is `parked`, and a generation-1 `pending` row exists with `next_attempt_at` at park time
  plus the delay. Do not assert the tick's `nextDueAt` equals that time: `runDue` folds in the
  derivation's next UTC-day boundary (`derive.ts`, `nextBoundary`; `run.ts:88`), which is always
  earlier than park time plus one day, so the tick reports the boundary); `"runs the requeued day
  when it is due and stops on
  success"`; `"parks a first check too, and requeues it"` (generation 0 parks);
  `"keeps one chain: a parked requeue that fails again queues one more, not two"`. Keep
  `"parks a period after maxAttempts and stops retrying it"` (`:131`) unchanged — it is the duty
  without the field. In the server test: `reconcilerAsDuty(...).retryParkedAfterMs` is one day.
- [ ] **Step 2:** `pnpm --filter @waitron/scheduler exec vitest run src/run.test.ts src/resweep.test.ts src/store.test.ts src/derive.test.ts` → the new cases FAIL.
- [ ] **Step 3:** implement; **Step 4:** same command → PASS; then
  `pnpm --filter @waitron/server exec vitest run src/reconcile-duty.test.ts src/pass.test.ts src/pass.db.test.ts src/health.test.ts`.
- [ ] **Step 5:** `pnpm --filter @waitron/scheduler exec vitest run src/index.test.ts` (unchanged: a
  type field adds no export). Typecheck `@waitron/scheduler`, `@waitron/server`.
- [ ] **Commit** — `Try a payments check again the next day after three failures (A846)`.

### Task 3: the two tables and their migration

**Files:** Create `packages/payments/src/schema/payment-holds.ts` (both tables, D1), modify
`packages/payments/src/schema/index.ts`, `packages/payments/src/classification.ts` (two
`appendOnly(...)` rows after `payment_resolutions`), `packages/migrations/migrations.manifest.json`
(`appendOnlyTables` gains both, `:66`). Generate with `cd packages/payments && pnpm db:generate --name
payment_holds` — never number or edit the files by hand. Test: create
`packages/payments/src/payment-holds.test.ts` (set up as `packages/payments/src/resolutions.test.ts`
is).

- [ ] **Step 1: failing tests** — stores a hold and an outcome and reads them back; refuses a second
  hold for one payment and a second outcome for one hold (unique index names in the message); refuses
  `provider_amount` 0, an unknown outcome and a blank note (check names in the message — a CHECK
  refusal is code 1811 and is identified by its words, CLAUDE.md §3); refuses a hold naming no
  payment and an outcome naming no hold (`FOREIGN KEY constraint failed`); refuses an update and a
  delete of each table (`triggerRaised(…, "payment_holds is append-only")`, as
  `resolutions.test.ts:187-191` does). Catch each refusal outside the transaction.
- [ ] **Step 2:** `pnpm --filter @waitron/payments exec vitest run src/payment-holds.test.ts` → FAIL.
- [ ] **Step 3:** schema, classification, manifest, generate. **Read the SQL:** two `CREATE TABLE`
  and their indexes, nothing else. Any `__new_` table (a rebuild) is a stop: report it.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5: guards** —
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/append-only-migration-sets.test.ts scripts/id-columns-are-references.test.ts scripts/column-vocabulary.test.ts scripts/module-graph-honesty.test.ts scripts/journal-monotonic.test.ts`.
  `schema-constraints.test.ts` lists constraint and index names by table: add the new ones there.
  `append-only-triggers.test.ts` lists every append-only table by name (`payment_resolutions` at
  `:51`): add both there. `packages/payments/src/migrations.ts:8` derives the descriptor's
  `appendOnlyTables` from `PAYMENTS_CLASSIFICATION`, so the descriptor half of CLAUDE.md §3's
  "travels in both" rule follows from the classification rows; the manifest half is the hand edit.
  `migration-upgrade.test.ts` may need sample values for the new tables in its `CANDIDATES` — adding
  them is allowed; say so in the commit. Then `pnpm --filter @waitron/composition exec vitest run`,
  `pnpm --filter @waitron/payments exec vitest run src/classification.test.ts src/migrations.test.ts src/schema-ownership.test.ts src/monetary-columns.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` (must pass
  unedited).
- [ ] **Commit** — `Keep a held card payment's provider figure and its recorded outcome (A846)`.

### Task 4: the store reads and writes holds

**Files:** Create `packages/payments/src/holds.ts`: `recordHold(tx, { paymentId, providerAmount,
foundAt })` (D2), `listOpenHolds(tx)` (oldest first; joined to `payments` for `paymentRef`,
`provider`, `amount`, `settledAt`, `workingOrderId`), `recordHoldOutcome(tx, { holdId, outcome,
note, personId, at })` (throws `payment.hold_not_found`, `payment.hold_already_recorded`). Modify
`packages/payments/src/errors.ts` (the two codes, and `payment.reconcile_held`'s params from D4),
`packages/payments/src/store.ts` (`ReconcilableRow` gains `paymentId` and `holdResolved`;
`listReconcilable` left-joins holds and outcomes), `packages/payments/src/index.ts` (exports).
Tests: create `packages/payments/src/holds.test.ts`; extend `packages/payments/src/store.test.ts`.

- [ ] **Step 1: failing tests** — a second `recordHold` for one payment writes nothing and does not
  throw; `listOpenHolds` lists two holds from different days and drops one once it has an outcome;
  `recordHoldOutcome` refuses an unknown hold (`code` `payment.hold_not_found`) and a second outcome
  (`payment.hold_already_recorded`) — assert the codes, not `toBeInstanceOf(Error)`;
  `listReconcilable` reports `holdResolved` false for a hold with no outcome and true after one.
- [ ] **Step 2:** `pnpm --filter @waitron/payments exec vitest run src/holds.test.ts src/store.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS. Then
  `pnpm --filter @waitron/payments exec vitest run src/index.test.ts src/classify.test.ts`: the
  package-root export pins (`index.test.ts:58-139`) gain the new names, and `classify.test.ts`'s row
  fixture gains the two fields (fixture grown — name it in the commit).
- [ ] **Step 5:** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts`;
  typecheck `@waitron/payments`, `@waitron/payments-stripe`.
- [ ] **Commit** — `Read and record held card payments in the payments store (A846)`.

### Task 5: the sweep records holds and stops checking one with an outcome

**Files:** Modify `packages/payments/src/reconcile.ts` (T2 calls `recordHold` for each
`amountDrifted` orphan with the settlement's amount; `classify` files a `holdResolved` row in no
class but still marks its settlement matched). Tests `packages/payments/src/reconcile.test.ts`,
`packages/payments/src/classify.test.ts`, `packages/payments/src/reconcile.concurrency.test.ts`.

- [ ] **Step 1: failing tests** — `"records a held payment once, with the provider's figure"` (two
  sweeps of one day; one `payment_holds` row, `provider_amount` 1250 for €12.50); `"files a held
  payment with a recorded outcome in no class, and its settlement is not missing"`; `"asks for no
  re-check once every held payment of the day has an outcome"` (through `reconcilerAsDuty` in
  `apps/server/src/reconcile-duty.test.ts`: no `resweepAfter`); concurrency — two racing sweeps
  write one hold.
- [ ] **Step 2:** `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts src/classify.test.ts src/reconcile.concurrency.test.ts src/reconcile.wiring.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS. Every existing assertion that a held payment is
  NOT refunded stays (`reconcile.test.ts:760-845`).
- [ ] **Step 5:** `pnpm --filter @waitron/payments-stripe exec vitest run --project node` (the
  reconciler and the fee test); typecheck.
- [ ] **Commit** — `The payments check keeps each held payment and stops checking one with an outcome (A846)`.

### Task 6a: the held-payments alert, on its own

Split from one task so each implementer stays well under about 100 tool calls; 6b wires it in.

**Files:** Create `packages/payments/src/held-alert.ts` (`HeldAlertSink`, `refreshHeldAlert`, D5–D7).
Modify `apps/dashboard/src/i18n/alert-messages.ts` (the held message, D10),
`scripts/alert-codes.test.ts` (`INCIDENT_CODE_SOURCES`, `:24-40`, gains
`packages/payments/src/held-alert.ts`, so the guard reads its code). Test: create
`packages/payments/src/held-alert.test.ts` with the real `recordIncidentOnce`, `currentIncidentsOf`
and `markIncidentHandled`, and holds written through Task 4's `recordHold`/`recordHoldOutcome`.

- [ ] **Step 1: failing tests**, each reading the `incidents` rows:
  `"raises one alert naming every held payment, whatever day it was held"` (holds from 1 and 2 July;
  one open `payment.reconcile_held`, `count: 2`, both refs); `"replaces an open alert when a payment
  is newly held"` (old one handled with `acknowledged_by` null, new names both);
  `"replaces an alert twice at one instant and still finds the open one"` (two replacements with
  the same `now`, then a third call with an unchanged set raises nothing and leaves exactly one open
  row — the tie D5 step 2 avoids); `"raises again the next UTC day after it was handled"` and
  `"does not raise again the same day after it was handled"`; `"does not raise again the day it
  was handled, even when it was raised the day before"` (raised 1 July 00:05, handled 2 July 15:00,
  called 2 July 16:00: no new row; called 3 July 00:05: a new row); `"raises at once, the same day,
  for a payment the handled alert did not name"`; `"closes the open alert when no held payment is
  left"`; `"marks a replaced alert handled by the person given"`; `"raises nothing when no payment
  is held"`.
- [ ] **Step 2:** `pnpm --filter @waitron/payments exec vitest run src/held-alert.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS.
- [ ] **Step 5:** `pnpm exec vitest run scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`; typecheck
  `@waitron/payments`, `@waitron/dashboard`.
- [ ] **Commit** — `One alert names every held card payment and comes back each morning (A846)`.

### Task 6b: the sweep raises the held alert instead of the orphan and difference alerts

**Files:** Modify `reconcile.ts` (`ReconcileDeps.heldAlerts`; call `refreshHeldAlert` in T1 and at
the end of T2; leave held payments out of the orphan and drift alert groups, D4; the comment at
`:329-335` stays true), `packages/payments-stripe/src/reconciler.ts` and
`packages/payments/src/testing/fake-reconciler.ts` (pass the core functions, D6). Tests: extend
`reconcile.test.ts`.

- [ ] **Step 1: failing tests** in `reconcile.test.ts`: `"leaves a held payment out of the orphan
  and difference alerts"` (and an orphan that is not held still raises `payment.reconcile_orphan`
  in the same sweep — the legitimate case beside the removal); `"raises the morning alert even when
  the settlement report cannot be fetched"` (report `fetch` throws; T1 already raised it).
- [ ] **Step 2:** `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts src/reconcile.concurrency.test.ts src/reconcile.wiring.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS. Existing assertions that expected
  `remediation: "amountDrifted"` inside `payment.reconcile_orphan`'s params (in `reconcile.test.ts`
  today at `:845` and `:955`; grep `amountDrifted` across every `*.test.ts`, which also finds
  `index.test.ts:190`, a type pin that stays) now find that payment in `payment.reconcile_held`
  instead: move each assertion, do not delete it, and list every moved one in the commit message.
  `OrphanRemediation` keeps `"amountDrifted"`: the sweep's result lists still carry it (D4).
- [ ] **Step 5:** `pnpm --filter @waitron/payments-stripe exec vitest run --project node`,
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/reconcile-duty.test.ts`;
  typecheck `@waitron/payments`,
  `@waitron/payments-stripe`, `@waitron/server`.
- [ ] **Commit** — `The payments check reports held payments in their own alert (A846)`.

### Task 7: a recorded alert can link to its screen; the wording stops promising nothing

**Files:** Modify `packages/module/src/alerts.ts` (`AlertEventClaim.screen?`), `apps/server/src/alerts.ts`
(`eventAlert`, `:63-76`), `apps/dashboard/src/widgets/alert-format.ts` (`screenTargetOf`, `:14-23`, and
its comment), `packages/payments/src/alerts.ts` (the second claim, D8),
`apps/dashboard/src/i18n/alert-messages.ts` (D10's removal and header). Tests
`apps/server/src/alerts.test.ts` (or the file that tests `eventAlert` — grep), the bell's and Alerts
screen's tests (grep `alert-go-to`), `apps/dashboard/src/i18n/alerts.test.ts`.

- [ ] **Step 1: failing tests** — the server answers a `payment.reconcile_held` incident with
  `screen: "payments"` and area `payments`, and a `payment.reconcile_orphan` one with no screen; the
  bell and the Alerts screen show both "Mark handled" and "Go to Card payments" (ES "Ir a Pagos con tarjeta"; the label is
  `alerts.go_to` filled with `nav.payments`, `alert-format.ts:83`) for the held alert, and
  Go to opens Payments (`wt-alert-go-to`); an event with no screen still shows only "Mark handled";
  the five reconcile messages no longer contain "may not check", in either language.
  `apps/dashboard/src/widgets/alert-format.test.ts:53` today asserts that an event WITH a screen
  answers `null`: that is the behaviour this task changes on purpose, so invert it (an event with a
  screen the session can open answers the screen; one it cannot open, and one with no screen,
  answer `null`) and name the inversion in the commit message.
  The header comment's "the daily payments check looks at each day once" (`alert-messages.ts:5`)
  is already untrue of a day with a held payment (`reconcile-duty.ts` re-sweeps it) and becomes
  untrue of a parked day after Task 2: correct it with D10's header change.
- [ ] **Step 2:** run each file with `pnpm --filter <pkg> exec vitest run <file>` → FAIL.
- [ ] **Step 3–4:** implement; same commands → PASS. Then
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets src/screens/alerts-screen.test.ts`
  and the alert screens' `*.a11y.test.ts` (grep `alerts-screen.a11y`, `alerts-bell.a11y`).
- [ ] **Step 5:** `pnpm exec vitest run scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts`;
  typecheck `@waitron/module`, `@waitron/server`, `@waitron/dashboard`.
- [ ] **Commit** — `The held-payments alert links to Payments; payment alerts stop saying they may never be checked again (A846)`.

### Task 8: the server lists held payments and records an outcome

**Files:** Modify `apps/server/src/payments-api.ts` (D12; follow `/payments/stuck` at `:938-974` for
the list and the bill attest route at `:1196-1237` for the PIN gate), `apps/server/src/errors.ts` only
if a code is thrown there (the two hold codes belong to `packages/payments`); the route file's
`STATUS` map (`payments-api.ts:125`) gains `payment.hold_not_found: 404` and
`payment.hold_already_recorded: 409`, beside `payment.not_stuck: 409`. Test: create
`apps/server/src/payments-api.held.test.ts`, set up as `payments-api.stuck.test.ts:103-160` is.

- [ ] **Step 1: failing tests** — legitimate: lists two held payments from different days, oldest
  first, with both amounts and the order number; records "refunded_at_provider" with a note and
  "kept" without one (note stored null), the payment leaves the list, the outcome row names the
  manager, and the open alert is closed when it was the last and replaced (handled by that manager)
  when one remains. Refusing, each asserting the code and that nothing was written: a staff session
  with that person's own PIN (`authorization.not_permitted`), a wrong PIN (`pin.invalid`, beside the
  PIN on the screen), too many wrong PINs (`pin.throttled`), an unknown outcome
  (`management.request_invalid`, `field: "outcome"`), an unknown hold (`payment.hold_not_found`), a
  second record (`payment.hold_already_recorded`), a non-UUID id (`shared.invalid_id`). And the PIN
  is checked before the write lock, as `payments-api.stuck.test.ts:1899-1996` checks for the attest
  route ("derives no key for a session without payments.manage", "…for a PIN that is not text").
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/payments-api.held.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS. Then
  `pnpm --filter @waitron/server exec vitest run src/payments-api.stuck.test.ts src/payments-api.pin-turn.test.ts`.
- [ ] **Step 5:** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts`;
  typecheck `@waitron/server`.
- [ ] **Commit** — `A manager records what was done with a held card payment (A846)`.

### Task 9: the whole loop on the real scheduler

**Files:** Create `apps/server/src/held-payments.scheduler.test.ts`, built from the probe
`~/waitron-campaign-c/a846-design/probe.test.ts` (outside the repository): `useVenueDb({ migrations:
migrationOptionsFor(manifestSets(), null) })`, `runDue` with `DEFAULTS`, `reconcilerAsDuty` over
`FakeReconciler` (Task 6b gave it the held sink), a settlement report that can be told to fail. Give
`FakeReconciler` a provider-name option instead of the probe's `Object.defineProperty`, or use one
database per `describe`.

- [ ] **Step 1: tests** (they fail before Tasks 2–8 and should pass now; if any passes before its
  task's code is reverted, the test is not measuring it — run that control for the second case by
  reverting `held-alert.ts`'s new-payment rule):
  `"two held payments on two days are both named, every morning"` (handled each morning; four days);
  `"a handled alert comes back the next morning, not the same day"`;
  `"recording the outcome of each ends the alert and the daily re-check"` (no open
  `payment.reconcile_held`, no pending `scheduled_runs` row for those days);
  `"a day whose check failed three times is checked again the next day and finds the held payment"`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/held-payments.scheduler.test.ts` → PASS
  (and the control fails as described).
- [ ] **Commit** — `Check the held-payment loop end to end on the real scheduler (A846)`.

### Task 10a: the Payments screen's Held list (rows only, no dialog)

Split from one task so each implementer stays well under about 100 tool calls; 10b adds the dialog.

**Files:** Modify `apps/dashboard/src/api/client.ts` (`listHeldPayments`, `recordHeldOutcome`, the
row type beside `StuckBillPaymentRow` at `:1857-1872`; the list is a GET like
`listStuckBillPayments`, `:4287-4289`), `apps/dashboard/src/api/live-queries.ts`
(`listHeldPayments: ["payment_holds", "payment_hold_outcomes", "payments", "working_orders"]`),
`apps/dashboard/src/screens/payments-screen.ts` (watch the list beside `:538-562`; the sub-list in
`#renderBillRecovery()`, with a `Record outcome` button that does nothing yet), and
`apps/dashboard/src/i18n/strings.ts` (the list's EN and ES words, D11). Tests: create
`apps/dashboard/src/screens/payments-screen.held.test.ts`; extend
`payments-screen.a11y.test.ts` (the held list, both themes), `apps/dashboard/src/api/client-routes.test.ts`
and `apps/dashboard/src/api/live-queries.test.ts` (rows for `listHeldPayments`, as `:124-125`
have for `listStuckBillPayments`).

Every test that fakes the screen's API gains `listHeldPayments` (today these name
`listStuckBillPayments`: `apps/dashboard/src/dashboard-app.test.ts`,
`src/screens/payment-attestation.unsaved.test.ts`, `src/screens/payment-readers.unsaved.test.ts` and
every `src/screens/payments-screen*.test.ts`; re-grep), so none of them starts failing on a
missing method.

- [ ] **Step 1: failing tests** — the list draws each row's two lines and button from the API, in
  both languages; the section shows when only held payments exist, and stays hidden when every
  list, held included, is empty; a held payment whose outcome is recorded leaves the list when the
  live query refreshes; axe passes in light and dark.
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.held.test.ts src/screens/payments-screen.a11y.test.ts src/api/client-routes.test.ts src/api/live-queries.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS. Then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen src/screens/payment-attestation.unsaved.test.ts src/screens/payment-readers.unsaved.test.ts src/dashboard-app.test.ts`.
- [ ] **Step 5:** `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/style-token-names.test.ts scripts/pinned-actions-column.test.ts`;
  typecheck `@waitron/dashboard`. Measure free memory before the browser run
  (`memory_pressure | grep free`).
- [ ] **Commit** — `The Payments screen lists held card payments (A846)`.

### Task 10b: the Record what was done dialog

**Files:** `apps/dashboard/src/screens/payments-screen.ts` (a held dialog following
`#openBillAction`/`#attestBill`/`#renderBillDialog`, with `draftScopeFor` and `saveActionState`;
field primitives only: `wt-combobox`, `wt-input`; required marks from `required`, the note not
required; the PIN refusal beside the PIN; not-found and already-recorded close the dialog and show
the section's result line; other refusals in the bottom message),
`apps/dashboard/src/i18n/strings.ts` (the dialog's EN and ES words, D11),
`apps/dashboard/src/i18n/codes.ts` (sentences for `payment.hold_not_found` and
`payment.hold_already_recorded`, D11, beside `payment.not_stuck` at `:1159`). Tests: create
`apps/dashboard/src/screens/payment-held-outcome.unsaved.test.ts` (set up as
`payment-attestation.unsaved.test.ts` is); extend `payments-screen.held.test.ts`,
`payments-screen.a11y.test.ts` (the dialog, both themes), `payments-screen.save-state.test.ts`,
`apps/dashboard/src/i18n/codes.test.ts` (each new code has its own sentence, not the generic one,
as the case at `:358` checks for `payment.not_stuck`).

- [ ] **Step 1: failing tests** — Record opens quiet and disabled until the draft changes;
  submitting with no outcome marks the outcome field and shows the bottom message `Correct the
  highlighted fields to continue.` on its own line above the buttons; a refused PIN shows beside
  the PIN and stays until it changes; `payment.hold_already_recorded` and `payment.hold_not_found`
  each close the dialog and show the result line; a successful record sends `{ outcome, note, pin }`
  (note omitted when blank), closes the dialog, shows `Outcome recorded. …` and refreshes the list;
  leaving with a changed draft asks first (the unsaved test); axe passes in light and dark.
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.held.test.ts src/screens/payment-held-outcome.unsaved.test.ts src/screens/payments-screen.a11y.test.ts src/screens/payments-screen.save-state.test.ts src/i18n/codes.test.ts` → FAIL.
- [ ] **Step 3–4:** implement; same command → PASS. Then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen src/screens/payment-attestation.unsaved.test.ts`.
- [ ] **Step 5:** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`;
  typecheck `@waitron/dashboard`. Measure free memory before the browser run.
- [ ] **Commit** — `The Payments screen records what was done with a held card payment (A846)`.

### Task 11: docs and the backlog

**Files:** `apps/server/README.md` (`:469-483`, `:504-507`, `:542-545`: a parked payments check is
now tried again the next day); the comments at `apps/server/src/pass.ts:30-36` and `:202-205`
("`parked`, which nothing will claim again") and `packages/scheduler/src/duty.ts:25-27` if Task 2
left them; `docs/developers/design-system.md`'s list of forms that open quiet until their draft
changes (batch 3b at `:2579-2581` names "the bill attestation's Record") gains the held payment's
Record; `docs/backlog.md` (delete the A846 entry);
`docs/backlog/payments.md` (delete the A846 section; add the new entries below); then grep the prose
for stale claims across the whole branch range:
`git grep -n -i "parked\|may not check\|never retried\|not check these payments\|held payment" -- docs apps/server/README.md packages/*/README.md`,
and for code comments
`git grep -n -i "nothing will claim\|nothing retries\|or a park\|looks at each day once" -- apps packages ':!*.test.ts'`.
Read each hit; edit only what this branch made false.

New backlog entries (Payments and card readers), each one short line plus detail:
- **Turn off Stripe's on-reader tip screen, or read the tip back.** If tipping is switched on in
  Stripe's Dashboard, every tipped reader payment is charged more than Waitron records (the fee
  question's table in this plan). Next action: pass `process_config[skip_tipping]=true` from
  `processPaymentIntent` (`packages/payments-stripe/src/stripe-client.ts:30-33`), tested against
  Stripe's sandbox.
- **The payments check ignores the currency Stripe reports.** `stripeReportClient` never reads
  `bt.currency`; an account paying out in another currency would make every payment differ.
- **Any open point below the owner leaves open at land.**

- [ ] `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/guide-links.test.ts`;
  `pnpm exec prettier --file-info` on each changed `docs/` file reads `"ignored": true` (docs are
  ignored whole), so read them by eye.
- [ ] **Commit** — `Docs and backlog for held card payments (A846)`.

### Task 12: LOOK — the Held list and dialog in real Chromium

Open the Payments screen with two held payments (the dev stack: `wa-wt demo
waitron-feat-a846-orphan-mismatch-reminder`, seeding two holds through the API or a test helper; or a
browser test that writes screenshots), in light and dark and at phone width (390 px). Look at: the
two-line rows and the button's place at phone width; the dialog's amounts lined up; the required
marks; the bottom message on its own line above the buttons; the alert bell's two buttons. Save
screenshots outside the repository (`~/waitron-campaign-c/a846-look/`), compare with the picture, and
fix what differs from the design system. No commit unless a fix is needed.

---

## PR description requirements

- First line: **FULL review path — money** (held card payments; two append-only tables; a scheduler
  change).
- Migration: `packages/payments/drizzle/<generated>_payment_holds.sql` creates two tables; no
  rebuild; foreign keys now pointing at `payments`: `payment_refunds`, `payment_resolutions`,
  `payment_holds`. It marks no EXISTING table append-only, so a box's first start raises no
  `append_only.triggers_restored`.
- Fixtures grown: `classify.test.ts`'s reconcilable row (two fields). Whole-shape pins that gained a
  key or name: `packages/payments/src/index.test.ts` exports; `@waitron/core` exports if pinned;
  `migration-upgrade.test.ts` `CANDIDATES` if extended; `schema-constraints.test.ts` names.
- Assertions moved, not deleted: every `amountDrifted` assertion moved from the orphan alert to the
  held alert (list them). Assertion inverted on purpose: `alert-format.test.ts:53` (an event with a
  screen now links to it).
- Behaviour changes a reader must know: held payments leave the orphan and difference alerts; a
  parked payments check is requeued the next day; recorded alerts can carry a screen link.
- The fee question's answer, with the test command and the control.

## Open points for the owner at land

1. **"Kept: the money was owed" leaves money with no invoice.** The payment stays captured on an
   abandoned order with no sale; Waitron files nothing for it. That is the owner's chosen outcome;
   whether the money needs an invoice is a fiscal question this item does not answer.
2. **"Next morning" is midnight UTC** (01:00 or 02:00 in Spain), not the venue's own business-day
   changeover. A venue still open then sees the alert come back during service.
3. **A replaced alert reads "handled by someone"** in the Handled tab when the check replaced it
   because a new held payment appeared. Alternative: a distinct "replaced by a newer alert" line.
4. **The alert's button reads "Go to Card payments"** (the screen's nav name), as every other
   alert's link does, not the picture's "Open Payments".
5. **The outcome is a dropdown, not the picture's two radio buttons**, because no radio-group field
   exists in the shared components and the section's existing dialog uses a dropdown. Building one is
   a new shared field with its own tests.
6. **Stripe's on-reader tipping** (fee question table): one Stripe Dashboard setting would make every
   tipped reader payment differ. Backlog entry added; the guard is a one-line change.
7. **The morning return needs the payments check to start.** While the Stripe credential cannot be
   used (`resolveAccount()` throws before the check reads anything), no check runs, so a handled
   held-payment alert does not come back. What shows instead is the check's own failure: the pass
   log's `reconcile.run_failed` and `reconcile.run_parked` lines (`logNonSucceededRun`,
   `apps/server/src/pass.ts:202-213`), and `/health` reporting degraded for the pass that parks it
   (`health.ts:86-90`). Moving the refresh ahead of `resolveAccount()` is the alternative.
