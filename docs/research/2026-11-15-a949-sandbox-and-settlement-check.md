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

**Later on 16 November 2026:** the two virtual decline scenarios and the separate Virtual B
payment ran with you at the reader tabs. See [the later session](#reader-checks-16-november)
for the results and the €11 late-response limit. The real-card settlement check is still pending.

## Sandbox checks

Use a separate preproduction venue, a confirmed sandbox merchant and two Virtual Solos on
that account. Connect through Waitron's existing SumUp setup and use its real client.
Record the till's actual words, the order, amount, time, reader and both Waitron and provider
references for each attempt. Keep raw receipts outside git.

| Check | Expected observation | Actual result |
| --- | --- | --- |
| Virtual A, €10 successful control | Final success pays the correct order; accepting the checkout is insufficient. | Passed, 16 November: €10 received, bill settled, provider `SUCCESSFUL`. |
| Virtual A, €11 decline | Order stays unpaid; record the exact message and available retry/other-payment choices. | Confirmed late decline: provider `FAILED`; till initially pending, then manager recorded not charged. |
| Virtual A, €42.51 insufficient funds | Order stays unpaid; record whether Waitron uses a generic decline or names insufficient funds. | Passed: returned `declined` within the till wait; generic decline wording, no specific insufficient-funds text. |
| Same-account Virtual B | Pay a separate order through the till and real client; verify final success and correct routing to B. | Passed: separate €10 order received and settled; provider `SUCCESSFUL`. |

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

## Reader checks, 16 November

You completed three more checkouts through the real SumUp client on the sandbox merchant
Foo Bar / M1Z03T0H. Waitron sent each once. The two Virtual A attempts used the same unpaid
order, with different payment and submission references; Virtual B paid a separate order.

**Virtual A, €11.00:** the checkout started at 18:54:01 CET. At 18:56:31, Waitron's
150-second wait ended without a final outcome. The till kept €11 reserved and
said the payment was still in progress, with **Close** available and the route to **Check card
payments**. You reported **Failed**; SumUp's later lookup returned `FAILED`, EUR 11, with the
saved client reference and Waitron payment reference. The provider row became failed, but the
bill remained pending. The existing manager **Record not charged** action released it only
after that evidence was checked. The reopened bill listed it as **Failed** and reserved €0.
This checks the late-decline recovery, not an immediate decline response on this amount.

**Virtual A, €42.51:** the next checkout started at 19:00:20 and returned at 19:01:49, inside
the till's wait. Waitron answered `declined`, left the €44 bill unpaid and reserved €0.
Its Spanish message was “La tarjeta se ha rechazado y no se ha cobrado nada. Vuelve a intentarlo
con la tarjeta, o vuelve atrás y elige otra forma de pago.” It offered **Atrás** and **Cobrar**.
You reported **failed**, without separate insufficient-funds wording. SumUp's lookup returned
`FAILED`, EUR 42.51, matching the new references. The retained provider status fields and the
till did not distinguish insufficient funds; the amount identifies the documented test scenario.

**Virtual B, €10.00:** the separate order started at 19:04:15 and completed at 19:05:09.
The payment preview named Virtual B and the real `sumup_cloud` client. Waitron answered
`received`, with €10 received, €0 reserved and €0 outstanding. The bill settled and issued
receipt `A-0E1M8/396`; the till opened **Documento para el cliente**. SumUp returned
`SUCCESSFUL`, EUR 10, for the same payment and order. The customer-document step was closed
without another payment. The final local read held exactly these three provider-payment rows:
two failed and one captured, with just one sale, for B.

| Check | Waitron payment reference | Checkout client reference | Final provider transaction |
| --- | --- | --- | --- |
| A, €11 | `28d5708e-7581-41ba-bbfb-dba9a80d5188` | `e1d56345-e2a3-4b39-b2aa-055b93605850` | `e3e122cb-4b0d-465f-a84a-5e1425dc9196` |
| A, €42.51 | `dda59b3b-ec70-4131-b4e9-4914079d05ed` | `15c85efb-febd-497c-8c5c-d2cd7003e85b` | `e66db114-1d0f-4b06-907b-b6ceba4a9894` |
| B, €10 | `c4f2597b-a0e7-4b51-a370-ef9c62726c48` | `66706f35-e2ff-4d1a-acf3-e0a5753511b3` | `6b6c0f5d-7398-4156-b560-d0f85163b687` |

The A order was `12740d0f-9d99-449d-8fb3-9fd6aabdcb10`; B was
`f8f2c0d2-24e0-4e9e-b686-47d24ad5d6e2`. Small, redacted provider/local/UI receipts are retained
outside git under Lane F's `receipts/a949-sandbox-qualification-20261115/session-1843-*`.
Your reader reports are recorded in Lane F questions at 18:57 and 19:02; at 19:06 you reported
**done** for B. Its final result above is matched by Waitron and SumUp. Physical cards, PIN entry, signature handling, standalone
backup-machine matching and the real-card settlement check remain unqualified. No further
checkout is authorised by this record.

## Your one real-card check: ten minutes now

Arrange this session with Codex. Use your already-paired Solo and a separate preproduction
Waitron venue configured for real SumUp payments. Check **Hardware → Card payments** together
before paying. Codex needs read-only access to this venue database for the later evidence
check; arrange that now. The intended merchant and reader must be selected, without the payment
simulator. Preserve the venue until the later check. Do not re-pair the reader for this test.

Open **Hardware → Devices**, select the device you will use and choose **Edit**. Set its **Card reader** to the intended Solo and save before taking the payment.

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


## Real-card session and battery reading, 17 November

Your paired Solo captured EUR 1.40 through Waitron, SumUp transaction TAAA7H7DNAD, at 18:36 CET.
The daily comparison remains pending after 00:00 UTC on 18 November; this payment does not
qualify the backup reader, signature flow or settlement matching by itself.

During the session, SumUp returned battery 1.67 with activity at 15:22 UTC while you reported the
reader charged to 100%. That value remained unchanged through at least 17:31 UTC. A fresh read
at 17:41 UTC returned 100.0 with activity at 17:36:33 UTC. These observations show that a
successful status read can return an older battery snapshot; they do not establish an idle update cadence.

| Source, read 17 November | Source wording | What the reading means here |
| --- | --- | --- |
| [SumUp reader status API](https://developer.sumup.com/api/readers/get-status/) | “Battery level percentage”; `minimum: 0`, `maximum: 100` | Treat the number as a percentage from 0 to 100. |
| Same source | “Provides the last known status for a Reader.”; “Timestamp of the last activity from the device” | The response describes the last known status and its activity time. A successful read alone does not establish current charge. |

Waitron omits a SumUp battery percentage when its activity time is missing, invalid, in the future
or over ten minutes old at the status read. The existing alert cache can retain an accepted reading
for another five minutes. An idle reader may therefore show no percentage or low-battery alert;
check its charge on the reader. These are Waitron limits, not a provider freshness guarantee.
