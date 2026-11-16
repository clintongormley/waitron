# SumUp sandbox qualification and your settlement check

You need two different checks before treating the integration as qualified: simulated declines
through Waitron, then one real card payment followed by its daily report check.

**15 November 2026:** sandbox experiments have not run. The watcher confirmed at 15:58 that
no sandbox merchant exists yet and the saved experiment keys are live. Sandbox access is with
the owner. This page is a test script, not evidence of a successful payment or match.

**16 November 2026:** the €10 successful control passed through the till and real SumUp
client on Virtual A, using the confirmed sandbox merchant Foo Bar / M1Z03T0H.
You saw the requested **10€**, used the simulator’s external **Pay** button in place of
tapping a card and saw **Approved**. Waitron received €10, settled the bill and issued a receipt;
SumUp reported `SUCCESSFUL` for the same amount. The decline and second-reader checks
still need a coordinated session. Your real-card settlement check remains separate.

## Sandbox checks

Use a separate preproduction venue, a confirmed sandbox merchant and two Virtual Solos on
that account. Connect through Waitron's existing SumUp setup and use its real client.
Record the till's actual words, the order, amount, time, reader and both Waitron and provider
references for each attempt. Keep raw receipts outside git.

| Check | Expected observation | Actual result |
| --- | --- | --- |
| Virtual A, €10 successful control | Final success pays the correct order; accepting the checkout is insufficient. | Passed, 16 November: €10 received, bill settled, provider `SUCCESSFUL`. |
| Virtual A, €11 decline | Order stays unpaid; record the exact message and available retry/other-payment choices. | Pending: next coordinated reader session. |
| Virtual A, €42.51 insufficient funds | Order stays unpaid; record whether Waitron uses a generic decline or names insufficient funds. | Pending: next coordinated reader session. |
| Same-account Virtual B | Pay a separate order through the till and real client; verify final success and correct routing to B. | Pending: next coordinated reader session. |

After a definite decline, verify that a retry has a new reference and reaches the intended
order and reader. An unknown outcome needs checking before another attempt. Virtual readers
leave physical backup hardware, real PIN entry and signature handling unqualified. A backup
match needs a charge made outside Waitron; if Virtual Solo cannot originate one, record that
experiment blocked. Never enter an integrated charge a second time as **Other card machine**.
Keep Waitron’s affiliate key unchanged and record its existing fallback if used; a checkout
refusal is a blocker, not a reason to substitute credentials or change the integration.

### Control evidence, 16 November 2026

The replacement control began at 16:23:05 CET and completed at 16:24:28. The till moved
from “Acerca o inserta la tarjeta…” to **Documento para el cliente**. Its payment response
reported `received`, €10 received, €0 reserved and €0 outstanding. A read-only database
query found the payment `captured` and its bill payment `received`, both for 1,000 cents.
The provider lookup by the saved client reference returned HTTP 200, EUR 10 and `SUCCESSFUL`.

| Reference | Value |
| --- | --- |
| Virtual A | `rdr_4JYAMRDDXQ8F4SYS3X8X0GH89Y` |
| Waitron payment | `5591d0f7-e75a-407a-8b36-d2c5ec967075` |
| Checkout client reference | `746ac48e-4690-4eb4-8729-769f46e98782` |
| Final provider transaction | `9095ba2d-0cdf-4292-a733-c96ddd2eb1d4` |
| Working order | `6ac22b3f-f07c-4dea-b008-096dd4bdc21c` |
| Receipt | `A-0E1FR/396` |

Redacted response, provider and local-row receipts are retained outside git in Lane F's
`receipts/a949-sandbox-qualification-20261115/fresh-control-*.json`. Merchant history since
16:20 returned one successful €10 transaction with this exact checkout client reference
and Waitron order in its description; the transaction lookup also matched Waitron's payment
reference. The owner clarified that the reader showed the requested **10€** and the
simulator’s external **Pay** button stood in for tapping a card; it then showed **Approved**.
That account is recorded in Lane F’s questions at 16:30, with watcher publication clearance
at 16:31. This control qualifies the integrated sandbox success path only. The earlier 15:53 checkout had no
transaction in the retained provider reads; the watcher closed it as an unattended timeout
based on the owner's late arrival, without a provider failure reason. No decline is inferred
from it. The €11 form was prepared but no checkout was sent after the owner left.

## Your one real-card check: ten minutes now

Arrange this session with Codex. Use your already-paired Solo and a separate preproduction
Waitron venue configured for real SumUp payments. Check **Hardware → Card payments** together
before paying. Codex needs read-only access to this venue database for the later evidence
check; arrange that now. The intended merchant and reader must be selected, without the payment
simulator. Preserve the venue until the later check. Do not re-pair the reader for this test.

1. Choose an existing item for a total of about €1, with no tip. Note the exact total before
   you choose **Pay → Card**.
2. Present your card once on the Solo. Wait for Waitron's final result. Finish the bill normally;
   do not abandon it after charging, because abandoned-order recovery can refund the charge.
   Save the completed order or invoice reference, exact amount, currency and local time.
3. Open that transaction in SumUp and save its transaction reference, amount and time. Codex
   also records Waitron's payment reference and the saved provider reference. Do not save
   card numbers, credentials or authentication headers.
4. Keep this small completed test payment, including after the comparison; no refund is
   part of this session. If Waitron's result is uncertain, check
   the existing payment in SumUp with Codex before trying another charge.

## Five minutes a day or two later

Return with the same venue and references. In SumUp’s transaction list, find your saved charge.
Open **Reporting → Check card payments → SumUp comparison**, choose that venue calendar date
and check that it no longer reports **Comparison incomplete**. Its complete day needs the
following UTC-midnight check and the connected credential. This only establishes day coverage.
Codex checks the saved daily audit read-only. You do not need another payment.
Keep the result pending if Codex cannot obtain the records below.

### Evidence Codex collects

For your normal paired-reader payment, retain the successful `payments.reconcile.sumup`
audit covering its timestamp and the local payment/provider record. Confirm that the
local payment is captured, its settled time lies inside that run’s period and predates
the run, and no resolved hold exempts it from classification. Its exact provider reference
and gross EUR amount must agree with SumUp. Check `checked ≥ 1` and that its payment reference
is absent from `unsettled`, `lostSettlement`, `orphan` and `drift`, and its provider reference
is absent from `missingLocal`. Retain the latest successful generation’s period, completion
time and summary. SumUp’s zero settlement-lag setting makes a missing eligible charge a
mismatch; absence of an alert alone is insufficient. If those records cannot establish the match,
leave qualification pending and record what evidence is missing.

**Reporting → Check card payments → SumUp comparison** shows backup-machine matches.
An empty list there, or the absence of an alert, does not prove that this paired-reader
payment matched. A failed, missing or incomplete daily check needs investigation; do not
replace it with a new charge.

A completed check establishes agreement with SumUp's gross charge records. It does not establish a bank
payout or reconcile fees; those remain your accountant's reconciliation outside Waitron.
A day or two is the return time for this check, not a promise of bank arrival.

## Sources and evidence boundaries

| Source, checked 15 November 2026 | Source words and use |
| --- | --- |
| [SumUp sandbox setup](https://developer.sumup.com/terminal-payments/quickstart/#sandbox-merchant-account) | “They have a separate merchant ID”: confirm sandbox selection before simulated charges. |
| [SumUp in-person testing](https://developer.sumup.com/terminal-payments/testing/) | “42.51 EUR” and “insufficient funds”: the documented specific-decline scenario; €11 is the generic-decline scenario. |
| [Virtual Solo limits](https://developer.sumup.com/terminal-payments/cloud-api/#solo-virtual-terminal) | “PIN entry simulation (always auto-approved)”: simulation does not qualify real PIN interaction. |

The report source is `packages/payments-sumup/src/report-source.ts`; classification and
selection are in `packages/payments/src/reconcile.ts` and `store.ts`. The saved summary is
written by `apps/server/src/reconcile-duty.ts`; the backup panel is
`apps/dashboard/src/widgets/backup-audit.ts`. Follow those current paths when gathering
the later evidence. No new report viewer or bank-payout audit is part of this check.
