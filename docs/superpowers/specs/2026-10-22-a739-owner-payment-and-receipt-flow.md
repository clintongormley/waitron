# 2026-10-27 approved contract: payment first, dismissal means None

**Authoritative addendum.** The owner approved the revised pay screen at about 02:12 CET,
after answering dismissal at 02:01 and reader settings at 02:05. These answers take precedence
over every conflicting question, proposal, gate and estimate below, in the companion revision,
and in the older mockups. Approval to plan and build is already given. The driver implements
inline after the dependencies below; there is no further design-approval step.

You open **Park · Pay**, then choose **An amount / Split equally / Items / Whole bill**, with
**Whole bill** selected on the right. Keep cash entry/change, counter part payments through the
bill-payment path, order-bound card outcomes and recovery, the three practice-reader choices,
Demo-reader retirement, and A796's Change/QR/NFC equipment interaction. A partial payment shows
what remains and asks for the next tender. Confirmed final settlement and successful local
issuance, including a settling edit or genuine zero-total completion, open **Receipt / Full
invoice / None**. Closing the table remains a separate action with its existing service checks.

Each card reader has the saved setting **Prints its own slip automatically**, default **false**.
True means no Waitron card slip. False offers **Print card slip** at payment, initially unticked.
This setting describes the reader; Waitron does not control its printer. There is no provider
print toggle, hardware-control qualification prerequisite, unknown-capability fallback or disabled
native-print checkbox. Cash never prints payment slips. Manual card remains excluded. Freeze the
accepted slip intent, reader setting, eligible printer and language before starting the payment;
only confirmed received money admits the slip. Keep historical amount/balance snapshots, replay,
reconciliation, copy audit, printer-role checks and warnings without undoing received money.

Receipt and Full invoice have independent, explicit **Print** and **Email** actions. Selection,
folding equipment and typing an address do neither. Receipt shows the folded default-printer row;
Full invoice also shows the appropriate recipient facts. Delivery uses a valid recorded document.
Server history determines original/copy across paper and email; failed or uncertain attempts keep
their existing recovery rules. A lost command answer is reconciled using that command's identity.
None or dismissal cancels no accepted slip, print or email. Documents and their retries never
charge, issue again or open the drawer; cash/manual-card payment retains its separately audited,
authorized drawer action and money/device/person/zone checks.

**If the final choice disappears, assume None.** Leaving, connection loss, finishing the bill or
absence of an active initiating session creates no durable pending document choice, recovery item,
timer or zone-policy fallback. No disappearance write is needed: absence of an accepted delivery
command means None. Payment and accepted-delivery recovery still persist their own facts. An edit
that settles the bill owns a fresh choice in its active editing session, including management;
it never borrows the last partial payer's intent. With no active editor, use None. You can later
open the existing paid-view or Orders document actions deliberately, including on a closed bill.

**Fiscal precedence.** Build only from main after E/A948 [PR #2122](https://github.com/clintongormley/waitron/pull/2122)
lands. Preserve its F1 enablement in every environment, including production; add no F1-off boundary.
Keep its actual route scope, including any counter restriction still owned by A555. An already-issued
F1 can be printed/emailed using its recorded identity; A790's Receipt/Invoice choices are renderings
of that same full invoice. Once F2 has issued, Full invoice instead needs a new F3 replacement
under **A556**. A739 does not build that integration or call `recordSubstitution`. Keep actionable
receipt/reprint options while that dependency remains; do not offer a pretend replacement Save,
charge again, defer original issuance or overwrite F2/customer snapshots. Keep existing valid
pre-issuance identity paths so A948's F1 flow continues to work. A556 retains recipient/address,
source linkage, replay, authority, no-debt presentation and delivery integration for replacement.

No authority is granted to change fiscal writers, hashes, chains, number allocation,
`recordSubstitution`, alta builders, `registerSif`, `restoreFiscal`, golden tests or guards.
The sole existing guard exception is the owner's 21 October addition of
`bill_payment_slip_copies` to `scripts/append-only-triggers.test.ts`'s `EXPECTED`.
Use unpublished `feat/a739-payment-window` at `3e45abdc69c0305100304d4501ca96812ba87a0b`
as a retained-work reference, not a branch to merge blindly. Regenerate its needed migrations
from fresh main; retain the existing checks and changed-test inventories.

A790 keeps its document routing, separate Equipment Invoice setting and dashboard-memory scope;
A796 keeps the one Equipment Receipt setting, takeover, save and concurrency rules. A582's payment
help belongs in the rebuilt window. Updated static boards accompany this publication; running UI
acceptance remains part of implementation.
The [approved implementation plan](../plans/2026-10-27-a739-approved-payment-flow.md) names the cuts,
interfaces, focused TDD checks and dependencies. Publishing this plan does not finish A739.

## Sources for this addendum

These are owner instructions and source-reading evidence, **not runtime verification**.

- Owner answers: `/Users/clintongormley/waitron-campaign-f/questions.md:1043–1060`
  (02:01/02:05/02:12), and the A948 overlap note at `:1065–1066`;
  `/Users/clintongormley/waitron-campaign-f/queue.md:72–74`, `RUNNER.md:75–139`.
- At documentation base `63a0ccc59ccfa65c1292616cc0571d8643cda1bc`:
  `packages/payments/src/schema/card-readers.ts:6`,
  `packages/payments/src/device-readers.ts:161`, `apps/server/src/payments-api.ts:578`
  are the reader storage, equipment projection and edit route to extend;
  `packages/payments/src/configuration-transfer.ts:1` exports payment policy, not hardware readers.
- At that base: `apps/server/src/bill-payments.ts:656–816`,
  `apps/server/src/receipt-print.ts:256–283`, `apps/server/src/invoice-selection.ts:87`,
  `apps/server/src/invoice-delivery.ts:42`, `apps/server/src/orders-api.ts:281`
  identify issuance/delivery separation, zone automatic delivery to suppress for A739,
  saved invoice identity, delivery history and later reprint.
- Retained source at `3e45abdc69c0305100304d4501ca96812ba87a0b`:
  `apps/server/src/payment-receipt-context.ts:139–279`,
  `apps/server/src/payment-slip-print.ts:243–400`,
  `packages/db/src/schema/order-payment-contexts.ts:16`,
  `packages/db/src/schema/bill-payment-slip-copies.ts:6` identify reusable payment recovery,
  slip snapshot/admission and copy audit, whose old final-choice coupling must be replaced.
- Scope contracts: [A790](2026-10-19-a790-document-and-printer-choice-design.md),
  [A796](2026-10-19-a796-handheld-payments-design.md),
  [A582](2026-10-18-a582-help-mode-design.md), and
  historical artwork README.

**Everything below is preserved verbatim as historical material. Its open questions, native-control
proposals, pending-choice proposals and F1-off statements are superseded by this approved addendum.**

---

# 2026-10-27 precedence: reader checkbox answer and remaining decisions

**Design amendment only; no rebuild before complete revision agreement.** Owner, 2026-10-26 ~07:00:
“A739 yes, but the checkbox should default to not printing on the reader”. For a reader supplying
its own slip, the target is an initially **unticked** checkbox: ticking requests the reader's own
slip. This answers the former reader-display question; it does not approve the capability fallback
below. An effective native checkbox requires proved adapter **and hardware** control of both
choices. Fallback A below proposes showing it unticked and disabled, with an unavailable-control
explanation until qualification. Do not claim that an unticked disabled box suppresses the reader's
paper.

Known no-paper readers retain Waitron **Print card slip**, initially off. Unknown capability is
unavailable, never guessed to mean no paper. Neither own-paper nor unknown readers get an extra
Waitron slip. Manual card remains excluded; practice readers have no native paper. These are the
amended target boundaries, subject to the fallback decision below, not a claim of built controls.

The 2026-10-22 ~11:55 **no cash slips** answer and all four main journeys stay unchanged: EUR10 cash
on EUR30 leaves EUR20 and prints no slip. After each part, show what remains and ask the next
tender. After confirmed final settlement and issuance, or a successful settling edit, show **Receipt
/ Full invoice / None** in that active session. The edit owns a fresh choice. Receipt and Full
invoice reveal a folded default-printer row with **Print**, and an email field with separate
**Email**; Full invoice also reveals customer details. None reveals no fields and leaves accepted
slips and deliveries in place. Keep amount modes, cash/change, payment recovery, practice-reader
work and separate table closure.

Full invoice after issued F2 still needs a new F3 replacement under **A556**, with A948/A555 and
asesor Q17/Q5(d). It never edits the original, takes another payment or delays original issuance.
Public F1/F3 stays gated pending that separate fiscal work. Original/copy designation still follows
server delivery history across Print and Email and existing failed/unknown recovery boundaries; a
retry is not automatically a copy. Documents, None and slip retry open no drawer. Payment keeps its
independent profile/permission checks and separately audited drawer action. A790/A796 keep their
answered scopes. This amendment adds no landing gate or build plan.

## What was run, and what remains unverified

Runs on base `6ee2f4ff12cdbfccbf991a220e293dfcbbd8c8d2`, in the isolated documentation worktree,
2026-10-27. The disposable probe ran in that checkout, was retained in the local campaign receipts,
and was then removed from the checkout. It contacted no provider and performed no network or
hardware writes. The capability assertions expected different outgoing arguments for a synthetic
extra `printReceipt` input set to `false` and `true`; both failed with identical arguments. Both
amount-change controls (EUR10 to EUR11) passed. The current adapters did not forward that proposed
input. This is not evidence of impossibility in vendor APIs or physical printer output.

| Current path                       | Observed boundary                                                                                                                                                                                                                  | Qualification still outstanding                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| SumUp `sumupClient.createCheckout` | Real client, captured fetch JSON identical for both print values: `{"total_amount":{"currency":"EUR","minor_unit":2,"value":1000},"description":"local probe"}`. Existing `sumup-client.test.ts` / `provider.test.ts`: 102 passed. | Physical Solo/cradle paper and control of both choices unverified. |
| Stripe `stripeClient`              | Real wrapper, captured SDK `createPaymentIntent` / `processPaymentIntent` arguments identical for both print values. Existing `stripe-client.test.ts`: 17 passed.                                                                  | Physical reader paper and control of both choices unverified.      |

The inspected registry names SumUp and Stripe (`packages/composition/src/card-providers.ts:13`). The
Stripe on-device collect binding is a stub
(`packages/payments-stripe/src/stripe-device-client.ts:15`), not a supported native-paper path to
promise here. The owner's request to run each supported reader remains open for physical
qualification. The recorded adapter runs do not complete it.

Source trace: issuance calls `enqueueSaleReceipt` (`apps/server/src/bill-payments.ts:804`); that
function resolves the zone's `receiptPrintMode` and can queue an original for auto mode
(`apps/server/src/receipt-print.ts:255–283`). The focused existing case “uses the zone's automatic
receipt policy when the department setting is on request” passed (1 passed, 157 skipped):
`pnpm --filter @waitron/server exec vitest run src/receipt-print.test.ts -t "uses the zone's automatic receipt policy"`.
That test checks its named automatic path, not the proposed pending-choice recovery. Do not read the
proposal below as today's durable pending-choice state.

## New owner subquestion: unavailable native control

**While native control is unproved, which boundary should A739 use?** This asks about a newly
exposed capability gap, not whether the owner's YES or unticked default still stands.

- **A, recommended:** explain that native print control is unavailable, with the target checkbox
  unticked and disabled. Add no Waitron slip for own-paper or unknown readers; retain the initially
  off Waitron checkbox for known no-paper readers. Qualify each supported adapter and physical
  reader before enabling native control. This avoids promising control the runs did not demonstrate.
- **B:** hold all A739 until native control is confirmed for the supported readers. This delays the
  other agreed payment-flow changes too.
- **C:** name a different change to the boundary.

**No fallback is approved.** The
eight SVG boards show A as a target
proposal, with native control disabled, not an effective new feature.

## Separate owner question: an unanswered document choice

**After settlement/issuance or a settling edit, should Document choice stay pending without a
deadline or automatic zone delivery (A, recommended), must you answer before leaving (B), or should
the zone policy take over after five minutes (C)?** None of these options is approved.

- **A, recommended:** retain the pending choice durably until explicit **Receipt / Full invoice /
  None**. Closing, finishing the table or starting a new counter bill may proceed. Authorized staff
  can recover the choice through the bill/sale, including a closed bill, without charging or issuing
  again. Staff decide whether to print the final document instead of a timer choosing for them.
- **B:** require an explicit document decision before leaving. This adds friction and can hold a
  shared device while the operator waits for an answer.
- **C:** after five minutes apply the zone policy. This can print paper the guest did not request
  and needs a timed worker; it is not the recommendation.

Example for A: Marta receives the last EUR10 of a EUR30 bill on a handheld. Settlement and issuance
succeed, then the link drops before she answers. Twenty minutes later Daniel opens the closed bill
in Orders: **EUR30 paid · Document choice pending**. With authority to answer, he chooses a document
without another charge or issuance. Separately, reducing a EUR30 bill to EUR10 with EUR10 already
paid creates the edit's own pending decision, not the earlier payer's choice. Money and issuance
recovery remain separate; an unknown payment outcome is never treated as settled. This durable
recovery is proposed future behaviour, not an inspected implementation.

## Separate owner question: complete revision agreement

**Do you approve the complete amended A739 revision and its remaining builder calls, with your
explicit answers to the capability and pending-choice questions incorporated, before rebuilding?**
Complete approval remains open, separate from both policy answers. The no-cash decision, four
journeys and separate A556/F1/F3 fiscal gates remain as stated above.

**Historical body below, preserved unchanged.** Conflicting cash, reader-display and
unchecked-native-default builder-call wording below is superseded by this addendum. Its source
register stays tied to its original M/P SHAs and source reads; “this checkout's HEAD” means that
original inspection. The original product SHA `3e45abdc69c0305100304d4501ca96812ba87a0b` and
changed-test inventories remain preserved. The remaining questions are presented separately for
owner decisions; no implementation is approved by this amendment.

---

# A739: payment first, then your receipt or full invoice

**Current revision, 2026-10-22, following the owner's ~09:05 direction. Design only; no
rebuild until the owner agrees this revision.** Timing A is answered. The earlier A/B
comparison and post-payment slip row are historical. This revision adds no landing gate.

You take the payment before asking how to deliver the final document. Before a card
transaction, you can tick **Print credit card slip**. On confirmed successful acknowledgement,
Waitron requests that eligible slip immediately. After a part payment, you see what remains
and choose the next tender. After the final payment, or an edit that clears the amount owed,
you see **Receipt / Full invoice / None** on the device that completed it.

These are the owner's choices. Starting the card checkbox **unchecked** is a proposed builder
call, not an owner answer. An acknowledgement of a request, a decline or an unknown outcome
is not acknowledgement that money was received. Printer transport happens separately;
“queued” must never be described as paper already handed to the guest.

Keep A739's wider scope: Park / Pay, counter part payments, the answered mode order
**An amount / Split equally / Items / Whole bill**, with Whole bill selected on the right,
and the existing cash/change and card-outcome recovery. Keep the practice-reader choices and
Demo-reader retirement from the retained work, plus A796's Change/QR/NFC equipment interaction.
This revision changes the document sequence, not those decisions.

## Read the four cases

Eight native SVG boards and PNG render targets
show the same four journeys in English and Spanish, light and dark, at 390 and 1280 px.
They depict the target interaction. Full-invoice fields are explicitly marked as dependent
on separate fiscal work; they are not screenshots of an available feature.

| Case                                  | Before settlement                                                                                                                                                                                                   | Immediately afterwards                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counter, EUR30                        | Whole bill selected. Choose card and optionally tick Print credit card slip before submitting EUR30. No final delivery or invoice-identity form in Pay.                                                             | On confirmed receipt of EUR30, request the selected eligible card slip once. Show Paid EUR30, due EUR0 and Receipt / Full invoice / None. Receipt reveals the collapsed default-printer row plus Print, and a separate email field plus Email. Full invoice additionally reveals customer details.         |
| Last of three EUR10 guests            | Guest 1 pays EUR10, leaving EUR20. The next screen says EUR20 left and asks Cash or Card. Guest 2 pays EUR10, leaving EUR10; the next screen asks again. Guest 3 sees EUR10 to pay and their own pre-card checkbox. | Guest 3's confirmed payment leaves EUR0. Ask the operator on that handheld or counter for the **whole EUR30** document. Historical payment slips keep EUR20, EUR10 and EUR0 respectively. The table remains open until Finish table, with its separate service checks.                                     |
| Edit clears the balance               | EUR30 total, EUR10 received, EUR20 due. Another operator removes the unpaid EUR20 and saves. The revised total is EUR10.                                                                                            | When save, settlement and local issuance succeed, open a **fresh** EUR10 document choice for that edit. No new payment or slip. The earlier EUR10 payer never owns this choice by recency. Show it in the active editing session, including a dashboard editor; absent-session recovery is proposed below. |
| Receipt, then a later invoice request | Receipt S/318 for EUR30 has already been issued and printed. Reopen that sale; the guest now supplies their invoice details.                                                                                        | Target: an explicitly confirmed replacement full invoice, linked to S/318, with Print and Email separately. Current boundary: missing public F3 orchestration under A556. Show the dependency, without a working reissue button, new charge or another settlement.                                         |

For a genuine zero-total bill, use the existing no-tender completion path; after successful
completion show the document question, without inventing EUR0 money or a slip. A displayed
EUR0 available balance can instead mean pending card money reserved the balance. Pending
payment/refund or unknown card money is **not settled** [P2]. Keep its payment recovery visible.
For collection of an already-issued invoice, collect against that sale and recover its existing
document history; do not issue a new sale or assign a second original to the collector [P5].

## What the final screen means

**Receipt** selects the recorded simplified document on the ordinary new-sale path. Beneath it,
show **Printer: Bar receipt · Default**, folded, and **Print on Bar receipt**. Below that,
show an email field and its own **Email** action. Print and Email are independent explicit
commands: selecting Receipt, folding a row, reading offers or entering an address does neither.
You can request both, subject to current delivery state. This replaces the old exclusive
Print / Email / None medium selector, not A790's printer permissions or settings. Keep the
already-offered delivery languages in this form; rendering another offered language does not
rewrite filed content snapshots. The order's pre-issuance content language stays in Bill details.

**Full invoice** reveals name and details only after selection: legal name, tax identifier,
country and full postal address, plus any country-specific continuation the separately approved
fiscal contract requires. Delivery email is a separate field. Start recipient Save quiet and
disabled until changed; after an invalid attempt retain values, explain every bad field inline,
and put one correction message above the actions. Expand invalid folded fields. A failed request
alone does not disable retry. Use shared fields, disclosure and form actions; semantic names,
customer autocomplete off, draft protection, keyboard/focus return and 44 px minimum targets.
The target Print/Email commands wait for a valid, recorded document and current delivery authority.

**None** is the explicit final-document decision and reveals no further fields. Proposed builder
call: record it on its press, showing the accepted result and allowing recovery if unanswered.
It cancels no previously requested card slip, accepted Print, Email or fiscal record. Closing the
screen is not None. Selecting Full invoice alone must not issue a record: the separate fiscal
operation needs an explicit, idempotent confirmation after validated details. Exact confirmation
and its recovery belong in the fiscal design, not an invented working button in these drawings.

A790's **Receipt / Invoice** for an **existing full invoice** is a format/routing choice for the
same recorded document. A739's **Full invoice** for an **issued simplified receipt** requests a
new replacement document. These are different operations. Neither paper size nor choosing an
invoice-role printer changes the recorded type. After a full invoice exists, A790's compact
Receipt route preserves all its recorded customer facts and number.

## The fiscal dependency is visible, not solved by moving fields

The inspected new-sale path selects F1/F2, calls `recordSale`, then `settleSale` in the issuing
transaction before delivery [P2, M2]. This revision does **not** wait for a guest to enter details
before that issuance, edit an immutable F2 into F1, or take money again. On the illustrated F2
path, choosing Full invoice immediately after settlement therefore needs the same separate
**F3 substitution** as asking later. F3 means a newly recorded full invoice referencing the
simplified receipt it replaces; the original remains recorded.

Core already exports `recordSubstitution`. Its body allocates a full-series number, inserts a
new sale and lines, writes `sale_substitutions`, then calls the fiscal backend [M1]. It takes no
tender, calls no settlement writer and supplies no working-order link or recipient postal address
in its inserted sale. The backend reads each original fiscal record and checks F2 [M3]. This is
existing low-level writer code, **not a built public reissue flow**. Repository grep found only
test callers under apps, in both inspected trees [M4]. Orders can list substitution links [M5];
that does not establish recipient capture, safe request replay, bill-linked delivery or paid-state
presentation for a new replacement. In particular, the helper's unsettled new sale must not be
fed into ordinary debt collection and charged again.

Keep this missing integration in **existing A556**, alongside A948/A555's full-invoice work and
[asesor Q17](../../compliance/asesor-questions.md)
and Q5(d). Those are existing dependencies, not fresh legal findings or new queue items.
The fiscal design must resolve recipient/address snapshots, source-sale and bill linkage,
series/identity decisions, permissions, one substitution per source, concurrent and lost-response
recovery, no-charge/no-debt presentation and original/copy delivery. The owner lands truly fiscal
builds. This document authorizes none and does not enable public F1.

The present server still advertises `fullInvoices: false`, refuses direct F1 requests and refuses
saved-F1 issuance [M2, P7]. The **target** final screen has Full invoice; the **currently gated
product** cannot offer it as an executable promise. Until separate fiscal work is agreed and
built, retain the gate and explain the unavailable dependency. Mockups label the expanded Full
invoice state as a target preview and disable its delivery. A pre-existing F1 collection retains
its recorded identity; it never invokes substitution. A555's old before-payment recipient/delivery
proposal is retained as history with a dated pointer, not silently applied to this new flow.

## Slip boundaries: one next owner question

G5 approved non-fiscal slips for each eligible reader part, including the final part. The later
cash answer approved the same slip for cash **under the old Print choice**, while retaining
manual-card exclusion, no duplicate reader paper and no unsolicited paper for Email/None.
The new direction names a card checkbox and removes that old choice. Cash eligibility is
answered; cash's **new trigger** is not. Keeping the old coupling to final None would also let a
later choice cancel a slip that should already have printed. That conflict needs an explicit answer.

**For cash parts, should we preserve your agreed cash slip with an optional “Print payment slip”
checkbox before Cash, matching the card checkbox (recommended)?**

Recommend the checkbox because it preserves the agreed cash-slip option without automatic paper.
Its unchecked default is the same builder proposal as card. This asks only cash's replacement
interaction, not timing, general approval or another landing permission.

Subsequent topics, in order, without asking them now:

1. **Reader-owned paper boundary.** Preserve the prior no-duplicate rule. Proposed interpretation:
   on known own-paper readers, show “Reader supplies its slip” instead of an effective Waitron
   print checkbox; do not claim this app controls the reader's own paper or suppresses it when
   unchecked. Unknown capability is unavailable with an explanation, never guessed “no paper”.
   The new “print credit card slip” wording alone does not decide reader-native print control.
2. **No answer or no active session.** Companion proposal 2 remains unapproved: durable Document
   choice pending, visible recovery including closed bills, no timer or zone fallback. An active
   dashboard editor gets the result there; an unattended edit retains the edit's new decision
   for another authorized operator. No extra till identity or remote Finish action is invented.
3. **Review the complete revision and its remaining builder calls**, then reconcile the concrete
   implementation plan. The owner has already required agreement before rebuilding. A556's fiscal
   work and A790's full routing-design approval remain separate in their existing scopes.

No post-payment slip Print / No paper row remains. A Waitron slip is not the fiscal receipt:
freeze the contribution, bill reference, received time and balance at confirmation. For a EUR10
payment leaving EUR20, a later copy still says EUR20. Do not subtract pending money or reprice it
from the current bill. Show the current slip printer in the folded equipment row when the box is checked, using the
same device Receipt setting and retaining slip-role checks. Freeze checkbox intent, eligible slip
printer, reader capability and rendering language at payment admission; print only after confirmed success. Manual card keeps its prior
exclusion. Unchecked means no new Waitron slip, not no reader paper. Requested but unavailable
printing leaves money received and shows a warning, never a silent printer switch [P3].

## Separate intent, equipment and recovery

The following are **builder proposals**, not owner answers or current runtime claims.

- Separate the received-payment/slip record from a bill/sale-owned document decision. A settling
  edit creates its own cause identity and revision. Record the initiating operator separately
  from a later answerer. Do not rename the immutable payment fingerprint to mean something else;
  all bill/whole/zero/collection, restart and recovery consumers must move together [P1, P4, P5].
- Preserve one accepted document intent/history per decision revision. Before any command, draft
  changes may change the offered document. After acceptance, replay the saved result; an explicit
  later change follows current copy/replacement rules. Two devices answering concurrently must
  reload the accepted history instead of creating competing originals. Print and Email have
  separate stable command identities and frozen sale/document/recipient-or-printer/language facts.
- Original versus copy comes from server delivery history across paper and email, never a client
  switch. The first eligible request may be original. A retry after known failure or uncertainty
  is not automatically a copy; follow existing status actions. After recorded completion, a further
  explicit delivery is designated a copy. A changed designation requires refreshed confirmation.
  Later F3 issuance is separate from both original delivery and copying the unchanged receipt.
- Keep a submitted destination fixed even if Equipment later changes. A newly opened form reads
  the current eligible setting, not the old command's target. Recheck person/session, device action,
  zone, sale-derived location, role lists and active equipment when admitting work. A selected
  printer becoming unavailable requires explicit reselection. Selection is not a queued job.
- Keep A790 A–M and Q1–Q6 precise: one device Equipment Receipt setting; one separate Equipment
  Invoice setting saved on explicit selection after a successful save (M); no new receipt memory.
  Dashboard without a profile uses all active printers at the sale's venue and separate browser
  memories per venue/document, shared across logins, changed on print acceptance. Keep its sole/
  several/empty-offer rules and named final confirmation. A796 keeps device Receipt takeover,
  QR/NFC and save/concurrency rules. Choosing Full invoice does not silently change Equipment.
- Lost payment answer: recover the same payment, never charge again for a document. Lost document
  acceptance or print/email answer: reconcile that same command before fresh work. A successful
  write followed by failed refresh stays accepted with status unavailable. Bind late replies to
  the session, sale and opening; they cannot overwrite another form or release its in-flight gate.
- Queued, sending, transport-completed, failed and unknown remain distinct. Do not auto-resend
  unknown email or uncertain paper. Warn before an explicitly permitted further attempt that the
  earlier delivery may still arrive. A request retry is not proof of exactly one piece of paper.
  Retain A554's no-address status/empty later-email entry and keep customer details out of logs.
- Proposed pending policy suppresses automatic final-document zone delivery while awaiting an
  answer, because the traced context-free edit route otherwise reaches that policy [P4]. This
  suppression/recovery remains **unapproved**, not a new default silently installed. Collection
  tickets keep their service purpose. No Print, Email, None, slip retry or F3 delivery opens a
  drawer; payment retains its independent authorized drawer policy.

## Built seams to reuse, and work that moves

“Built” here means **present in the inspected source**, not verified working in this task.
There is no timing estimate.

| Present seam                                                                                            | Integration change proposed after agreement                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Pay dialog, four amount modes, cash/change, connected-card outcomes and retained submission ids  | Keep tender and amount handling. Remove final Print/Email/None, destination and Full invoice/identity from Pay. Add the pre-card checkbox and remaining-amount/next-tender screen; cash depends on the single question above.                      |
| Accepted payment contexts, frozen equipment, historical slip snapshot/renderer and stable slip job keys | Preserve money/replay/history assertions. Separate slip intent from final delivery and map confirmed acknowledgement to one original slip admission. Audit every request mirror/fingerprint/worker consumer.                                       |
| Local issuance, received tender settlement, edit callers and collection/zero adapters                   | Keep issuance independent of guest response. Open the document decision after settlement; edits create new ownership. Replace any automatic final delivery only under the agreed pending policy.                                                   |
| Receipt rendering/PDF/email worker, F1 delivery statuses, retries and copies                            | Reuse rendering and outcomes. Move final command admission out of the payment context, allow separately requested Print and Email under shared original/copy history, preserve failure isolation. F3 document projection is separate missing work. |
| Paid strip/table detail/Orders recovery surfaces                                                        | Keep paid facts and table closure separate. Add proposed durable pending recovery; use active editor and authenticated management printer scope without borrowing a till.                                                                          |
| Core substitution writer and substitution-list read                                                     | Reuse only through separately designed A556 fiscal orchestration. No public route, recipient/address completeness, request recovery or bill delivery is established by the helper.                                                                 |
| Existing acceptance tests and unpublished plan                                                          | Parent keeps every changed-test inventory. Later TDD must move old payment-time receipt expectations while retaining fiscal, money, drawer, permissions, historical balances and replay assertions. No test is edited here.                        |

## Source register: read, not run

Main publication base **M = `81c3d5f3c1bc3205894afa7d3c64940a3d19cfad`**, this checkout's
HEAD and local main at inspection. Preserved product **P =
`3e45abdc69c0305100304d4501ca96812ba87a0b`**, read-only original checkout
`/Users/clintongormley/workspace/worktrees/waitron-feat-a739-payment-window`.
`git rev-parse HEAD` and `git status --porcelain=v1` there returned P and no entries.
All references below are tied to those SHAs; they are source-reading receipts only.

| Ref | File:line at the indicated SHA                                                                                                                                                              | What was read                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `packages/core/src/index.ts:10`; `record-substitution.ts:26–72,128–146,184–262`                                                                                                             | Export, inputs, full-series check, new sale/lines/substitution links/backend call; no tender/settlement or working-order/address insertion.                                                                                       |
| M2  | `apps/server/src/invoice-selection.ts:87–146`; `bill-payments.ts:655–745`; `till-setup.ts:118`; `till-sale.ts:521–527`; `working-order.ts:4046–4053`                                        | Pre-issuance stored identity/type, local record/settle path and public F1 closure.                                                                                                                                                |
| M3  | `packages/fiscal-verifactu/src/backend.ts:493–549`                                                                                                                                          | Required counterparty; reads original fiscal records; rejects non-F2 substitutions.                                                                                                                                               |
| M4  | `rg -n recordSubstitution packages apps`, repeated in P; `rg -n recordSubstitution apps --glob '!*.test.ts' --glob '!*.test.mjs'` in M                                                      | Full search found core/backend declarations and test callers. Production-app search returned no matches (exit 1). No public route call was found in either tree's full search. This is a textual caller audit, not an HTTP probe. |
| M5  | `apps/server/src/orders-list.ts:824–875`; `till-api.ts:2638–2675`; `bill-payments-api.ts:207–271`; `packages/core/src/settle-sale.ts:41–80`                                                 | Substitution listing, existing authorized collection and bill-payment boundaries, separate settlement writer.                                                                                                                     |
| P1  | `apps/server/src/payment-receipt-context.ts:139–203,243–279`                                                                                                                                | Immutable choice/equipment matching per submission and sale ownership checks.                                                                                                                                                     |
| P2  | `apps/server/src/bill-payments.ts:701–852`                                                                                                                                                  | Pending-money/refund checks, local invoice selection/issuance, settle, context-aware receipt admission.                                                                                                                           |
| P3  | `apps/server/src/payment-slip-print.ts:243–327`                                                                                                                                             | Stable slip key, receipt-medium coupling, manual/reader-paper/unknown capability exclusions, printer/rendering outcomes.                                                                                                          |
| P4  | `apps/server/src/receipt-print.ts:360–411`; `bill-payments.ts:856–864`; `adjustments-api.ts:225`; `line-cancel-api.ts:218`; `working-order.ts:6368`; `till-api.ts:3479,3514,3638,3874,3986` | Context-free edit issuance versus accepted-context delivery; zone policy fallback and separate collection ticket.                                                                                                                 |
| P5  | `apps/server/src/till-sale.ts:2445–2544,1124–1127`; `invoice-delivery.ts:64–144`                                                                                                            | Existing-sale collection/replay, zero no-tender contract and receipt email's payment-context/settlement join.                                                                                                                     |
| P6  | `apps/till/src/widgets/bill-pay-dialog.ts:2486–2593`                                                                                                                                        | Gated Full invoice and exclusive receipt-medium/email/language controls presently inside Pay.                                                                                                                                     |
| P7  | `apps/server/src/till-setup.ts:118`; `till-sale.ts:540`; `working-order.ts:4052`                                                                                                            | Public F1 remains disabled in the unpublished product tree too.                                                                                                                                                                   |

Owner provenance: lane F `questions.md:2524` (G5), `:2583` (cash yes), `:2782–2784`
(edit owns the new decision), `:2843–2865` (~09:05 verbatim flow and unanswered companion 2);
`queue.md:162–164` (A739). These local campaign references identify instructions for the parent,
not public repository links. No campaign file was changed. A790's complete historical A–M/Q1–Q6
body, A555 and the previous A739 revision were read and retained. Palette literals come from
`packages/ui-core/src/tokens/colors.css`, re-exported by `packages/ui/src/tokens/index.ts`;
structure comes from `packages/ui-core/src/tokens/structure.css`.

These static drawings establish no runtime, accessibility-test or physical-print result. Future
implementation still needs behavioral and recovery checks, current-head branch gates and its
separately authorized fiscal work. No legal determination is made here.
