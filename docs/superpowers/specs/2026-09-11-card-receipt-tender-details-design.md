# Card receipt tender details — design

**2026-09-12 update:** The [receipts and payment slips design](2026-09-12-receipts-payment-slips-and-duplicates-design.md) moves card identity to a separate slip and marks duplicate invoices. The design below records the earlier behavior.

**Date:** 2026-09-11. **Status:** approved, pre-plan. Brainstormed with the owner the same day,
against a live SumUp Solo paired to the Cloud API (runbook
[research/2026-09-10-sumup-solo-experiments.md](../../research/2026-09-10-sumup-solo-experiments.md)).

## 1. The problem, in one paragraph

A customer who pays by card gets a receipt that says they paid cash. The ticket renderer prints
`Efectivo <total>` and `Cambio 0,00 €` on every sale, card included
([apps/server/src/receipt-ticket.ts](../../../apps/server/src/receipt-ticket.ts) ~line 294), because
its only input — `TillSaleResult` — carries no tender method and no payment data. Separately, the
customer has no proof the card was charged: no scheme, no masked card number, no authorisation code.
The SumUp adapter fetches all of that when it confirms a capture and then discards it, keeping only
`{id, status, amount}` ([packages/payments-sumup/src/client.ts](../../../packages/payments-sumup/src/client.ts)).
The job the owner named: the ticket is the customer's proof of a card payment, so it must show what
was charged and on what card.

This is a correctness-and-clarity defect, not a compliance one. The Veri\*Factu mandated-element
list (RD 1619/2012 art. 7.1 + Orden HAC/1177/2024 arts. 20–21) carries no payment-instrument element,
so the card block sits OUTSIDE the invoice body, below `TOTAL` and above the QR, and the fiscal
record is byte-unchanged. See §6.

## 2. Decisions (owner, 2026-09-11)

- **The card slip's only job is customer proof of payment.** Not a merchant reconciliation copy
  (that is the dashboard's job), not a signature slip. So: ONE ticket with a card block, not a second
  piece of paper, and not SumUp's hosted receipt image.
- **A tip that rides on the card is shown explicitly** — a `Propina` line and a `Cobrado` line (the
  amount actually charged, `total + tip`), so the customer's proof matches their bank statement and
  explains why the charge exceeds `TOTAL`. This is the "bloque informativo separado al pie del ticket"
  the asesor question [compliance/asesor-questions.md](../../compliance/asesor-questions.md) Q13(c)
  describes; that question is still unanswered, and the block's placement below `TOTAL` is what keeps
  it low-risk (§6).
- **Stripe fills nothing in this change.** The contract field is optional; Stripe's adapter compiles
  and behaves exactly as today. The deli has no Stripe account, and Stripe would need an extra charge
  read to supply the same facts — a named follow-up (§7), not smuggled in here.
- **Full review ceremony.** Cross-package contract change + a migration = two risk triggers.

## 3. What the live reader gave us (grounding)

The €1 control payment (runbook §0.6, transaction `f37572ac-…`) returned every field the block needs:

```
auth_code        328600
card             { last_4_digits: "5838", type: "VISA" }
entry_mode       contactless
```

SumUp's published OpenAPI file (SHA-256 prefix `5f752211d29897ad`, fetched 2026-09-10) pins two of
the three vocabularies and leaves one open:

- **`CardType`** is a closed enum of ~25 network names (`VISA`, `MASTERCARD`, `MAESTRO`, `AMEX`,
  `VISA_ELECTRON`, … `UNKNOWN`). We print it as given, underscores → spaces. We do NOT normalise the
  set — mapping 25 names to a curated list buys nothing and would silently mislabel a network the
  list forgot.
- **`entry_mode`** is NOT pinned for the in-person transaction body in the OpenAPI file (the only
  examples show the e-commerce value `CUSTOMER_ENTRY`). The live reader returned the lower-case
  `contactless`. So entry mode is the one field we normalise defensively (§4), because its input
  vocabulary is unverified. Experiment worth running before the plan: a CHIP payment on the Solo, to
  see what SumUp calls it — recorded in the runbook either way.
- **`auth_code`** is a free string, nullable in our model.

A receipt-rendering detail settled by the code: the ESC/POS builder encodes `latin1`
([packages/printing/src/escpos.ts](../../../packages/printing/src/escpos.ts) line 30). `•` (U+2022)
is not a Latin-1 character, so the masked-card separator on paper is `****`, and the on-screen twin
uses the same for lock-step.

## 4. Design

Five units, each proved independently (§5), then the seams proved end to end.

### 4.1 The provider contract (`@waitron/payments`)

`PaymentResult` ([packages/payments/src/provider.ts](../../../packages/payments/src/provider.ts))
gains one optional field:

```ts
export interface CardDetails {
  /** The issuing network as the PROVIDER names it (SumUp's CardType, underscores → spaces). Not a
   *  curated set — printed as given. */
  scheme: string;
  last4: string;
  entryMode: "contactless" | "chip" | "swipe" | "unknown";
  authCode: string | null;
}

// on PaymentResult, alongside provider/paymentRef/state/amount/settledAt:
card?: CardDetails;   // present only on a `captured` result whose provider can supply it
```

Optional by design: every current implementer that omits it compiles and behaves as today. `card` is
only ever set on a `captured` result — never on `accepted_offline` (the card facts are not known
until the forward settles), `failed`, or a reversal.

### 4.2 The SumUp adapter (`@waitron/payments-sumup`)

`SumUpTransaction` ([client.ts](../../../packages/payments-sumup/src/client.ts)) widens from
`{ id, status, amount }` to also carry the optional `card` (`{ last_4_digits, type }`), `entry_mode`
and `auth_code` the `findTransaction` call already receives. The provider
([provider.ts](../../../packages/payments-sumup/src/provider.ts)) builds `CardDetails` from them at
the `captured` outcome — on BOTH paths that reach `captured`: the inline `collect` poll (T2) and the
`resolvePending` sweep.

Entry mode is mapped, never passed through, because its input vocabulary is unverified:
`contactless → contactless`, `chip → chip`, `magstripe`/`swipe → swipe`, **anything else → `unknown`**
(including `undefined`). `scheme` is `type.replaceAll("_", " ")`. `last4` and `authCode` pass through;
a transaction missing any sub-field yields a partial block, and a transaction with no card object at
all yields `card: undefined` on the result — **never a failed capture.** The money moved; the receipt
degrades, the sale does not.

The in-process fake ([testing/fake-sumup.ts](../../../packages/payments-sumup/src/testing/fake-sumup.ts))
gains the same fields so the adapter's tests and the sandbox suite share one shape.

### 4.3 Storage (`@waitron/payments`)

Four nullable columns on `payments`
([packages/payments/src/schema/payments.ts](../../../packages/payments/src/schema/payments.ts)), in
the payments module's own migration set (a new pair, `db:generate` + `db:generate:custom` for the
check constraints):

```
card_scheme       text
card_last4        text   CHECK (card_last4 IS NULL OR length(card_last4) = 4)
card_entry_mode   text   CHECK (card_entry_mode IS NULL OR card_entry_mode IN
                               ('contactless','chip','swipe','unknown'))
card_auth_code    text
```

Plain text + CHECK, not a `pgEnum`: adding a value to an enum later hits the one-transaction
`ALTER TYPE … ADD VALUE` trap (project CLAUDE.md §2); a CHECK does not, and the set is ours to widen.

Written once, at capture, by the store call that already stamps `captured` + `external_ref`
([store.ts](../../../packages/payments/src/store.ts) `captureAttempting`). Its params gain an optional
`card?: CardDetails`; the four columns are written from it, null when absent. No other writer sets
them. A **manual** card tender (the outage-plan POS machine) creates a `payments` row with an
operator-keyed `external_ref` and leaves the four columns null.

No backfill — no production data exists (CLAUDE.md §5 "no backwards-compatibility … until
production"). The migration is the columns and their constraints, nothing else.

### 4.4 The ticket data (`apps/server`)

`TillSaleResult` ([apps/server/src/till-sale.ts](../../../apps/server/src/till-sale.ts)) replaces its
bare `change: string` with a tagged `tender` block:

```ts
tender:
  | { method: "cash"; change: string }
  | { method: "card";
      charged: string;            // total + tip — the amount actually charged
      tip: string;                // "0.00" when none
      card: CardDetails | null;   // null for a manual tender, or a provider that gave nothing
      reference: string | null }  // operator-keyed external_ref, MANUAL tender only
```

**The tender block is built in ONE new helper, `readTenderBlock`, called by all FOUR ticket
construction sites** — `fileImmediateSale` (line ~693, cash + manual-card immediate sales, reused by
Mode-T integrated collect), `finalizeCapture` (line ~1058, integrated fresh capture),
`finalizeRecovery` (the lost-T2 card-recovery path — a captured payment whose sale was never filed),
and `readSettledTicket` (line ~469, reprints + concurrent replays). Today those four build the result
inline and independently; only `readSettledTicket` reads the sale back. The plan touches all four —
there is no single chokepoint to edit, and assuming one was a false claim caught in spec self-review.

`readTenderBlock(tx, cfg, saleId, workingOrderId, { cashChange })` reads the sale's `tenders` row
(method, `tip_amount` — exactly one per sale) and, for a card, the `payments` row for that working
order (`findCapturedPaymentForWorkingOrderAnyProvider`; the ticket path knows the working order but
not which provider settled it, so it does NOT filter by provider). The read is keyed on
`working_order_id`, which is `NOT NULL` from the first insert, so it does NOT depend on the `sale_id`
association having happened yet. Both reads carry their own `eq(tenantId, cfg.tenantId)` —
one-tenant-per-db is NOT the query boundary (CLAUDE.md §3, the `getHeldOrder` cross-tenant leak).

**The card block is fully read back from persisted rows, so a reprint is byte-identical to the first
print BY CONSTRUCTION** — the same read path feeds both, which is the regression property the owner
named. The one value that cannot be read back is cash `change`: the tendered cash is never persisted
(only the settled amount, = total), so `cashChange` is passed in at first print and defaults to
`"0.00"` on reprint — preserving today's exact cash behaviour, quirk included.

`reference` is populated only for a MANUAL tender (`provider = "manual"`): the operator-keyed number
lets the customer match the two slips. An INTEGRATED payment's `external_ref` is the provider's own
id (for SumUp, the UUID-shaped transaction id — useless on paper), so `reference` is suppressed for
`provider != "manual"` and the auth code is the proof field there.

**Degrade, never throw.** A card tender whose `payments` row is missing or carries no card facts
yields `card: null`. The sale is filed and immutable by the time this runs; a presentation gap must
never throw where a fiscal read would not.

The till mirrors this type BY HAND
([apps/till/src/api/client.ts](../../../apps/till/src/api/client.ts) line ~577, which says so) — it
changes in the same step.

### 4.5 The renderers

Both the paper renderer
([apps/server/src/receipt-ticket.ts](../../../apps/server/src/receipt-ticket.ts)) and the on-screen
twin ([apps/till/src/screens/till-ticket-view.ts](../../../apps/till/src/screens/till-ticket-view.ts))
branch on `tender.method`. The block sits where the cash lines sit today: after `TOTAL`, before the
QR. Labels are fixed Spanish strings in each renderer's `LABEL` table (the two tables are kept
identical by convention, stated in both files). New labels: `card: "Tarjeta"`, `tip: "Propina"`,
`charged: "Cobrado"`, plus entry-mode strings `Sin contacto` / `Chip` / `Banda` (the `swipe` value).

Rendered shapes (paper; the on-screen twin is identical content):

```
cash                     card, no tip              card + tip                manual card
----                     ----                      ----                      ----
TOTAL        1,00 €       TOTAL        1,00 €       TOTAL        1,00 €       TOTAL        1,00 €
Efectivo     1,00 €       Tarjeta VISA **** 5838    Tarjeta VISA **** 5838    Tarjeta
Cambio       0,00 €       Sin contacto · Aut 328600 Sin contacto · Aut 328600 Ref. 4471
                                                   Propina      0,50 €
                                                   Cobrado      1,50 €
```

Conditional lines, stated so the plan pins each:
- The second card line (`<entry mode> · Aut <code>`) is dropped entirely when there is neither an
  entry mode (`unknown` prints nothing) nor an auth code.
- `Propina` + `Cobrado` appear together, only when `tip ≠ "0.00"`. With no tip, `Cobrado` would just
  repeat `TOTAL` one line below it, so both are omitted and `TOTAL` is the charged amount.
- `Ref.` only when a manual tender keyed one.
- A card with nothing known prints `Tarjeta` alone (plus the tip pair if any).

The cash-drawer kick already keys off the tender method at print time
([receipt-print.ts](../../../apps/server/src/receipt-print.ts) `enqueueSaleReceipt`); unchanged.

## 5. Testing

- **SumUp adapter.** The fake carries the four fields; pin that a `captured` outcome on BOTH the
  inline poll and the `resolvePending` sweep carries the block; the entry-mode map including the
  `unknown` fallthrough; and the money-critical negative — a transaction MISSING card fields still
  captures with a partial/absent block, never fails.
- **Store + schema (real Postgres, not PGlite — CHECK constraints and grants).** Capture with and
  without card facts; both CHECKs proved by inserting a 5-digit `last4` and a bogus entry mode and
  watching them refuse; the module's privilege suite as the grants receipt (new columns inherit the
  table grant — a claim, so it is RUN).
- **Ticket data.** `readSettledTicket` for cash; integrated card with facts; manual card with and
  without a keyed reference; a card tender whose payment row carries nothing. The one that matters
  most for the slip's job: **a reprint returns a `tender` block identical to the original print's**
  (both go through `readSettledTicket`, so this is a regression pin, not new behaviour).
- **Renderers.** Paper renderer pins each variant's lines, the `****` mask surviving the Latin-1
  round trip, and each conditional line appearing only when it should; the till view + its a11y test
  get the same variants.
- **Wire contract.** Six test files pin `change` on the sale response today
  (`receipt-ticket.test.ts`, `till-sale-integrated.test.ts`, `till-ticket-view.test.ts`,
  `till-ticket-view.a11y.test.ts`, `till-app.test.ts`, `api/client.test.ts`); they move to `tender`.
  Server and till both assert this body, so the final gate is a **full workspace run**, not a scoped
  one (CLAUDE.md §2, a value more than one package asserts).
- **Live.** The self-skipping sandbox suite
  ([collect.sandbox.test.ts](../../../packages/payments-sumup/src/collect.sandbox.test.ts)) gains one
  assertion: after a real €1 capture the four columns hold `VISA / 5838 / contactless / <auth>`.
- **Root guards** run (a table changed): `classification-complete` and `append-only-enable-always`.
  No new error codes, so the reachability guard is untouched.

## 6. Fiscal invariants — untouched, as an assertion

No hash input changes (the block is never hashed — `entorno`-style, CLAUDE.md §5), no series, no
chain, no immutable `registros_facturacion` row. The block renders below `TOTAL` and above the QR,
outside RD 1619/2012 art. 7.1's mandated elements, so the filed invoice is byte-identical to today's.
The tip's `Propina`/`Cobrado` pair is informative display of the `tenders.tip_amount` already stored
(and already excluded from the taxable base); it adds no fiscal figure. Because nothing here touches
§5, no fresh-context fiscal read gates the plan.

## 7. Out of scope, named

- **Stripe card details.** The contract field is optional and Stripe leaves it empty. Filling it needs
  an extra charge read (`payment_method_details`) on the device/hosted adapters — a follow-up, logged
  to the backlog, gated on the deli actually having a Stripe account (it does not).
- **A second physical slip / SumUp's hosted receipt image.** Rejected in §2; not built.
- **Merchant reconciliation copy.** The dashboard's job, not the ticket's.
- **The cash-reprint `Cambio 0,00` quirk.** Pre-existing, unchanged.
- **Normalising the card-scheme name set.** Printed as the provider gives it.

## 8. Provenance

Live transaction `f37572ac-c534-407f-b0c5-59ba9eb4e19c` (merchant `MY2NPHDW`, reader
`rdr_19F1G0V4JF98NBRQDARRW2293X`), captured 2026-09-11, full body in runbook §0.6. SumUp OpenAPI file
`raw.githubusercontent.com/sumup/sumup-openapi/refs/heads/main/openapi.yaml`, SHA-256 prefix
`5f752211d29897ad`, fetched 2026-09-10: `CardType` enum, `entry_mode`/`verification_method`/
`simple_payment_type` vocabularies. Latin-1 encoding: `packages/printing/src/escpos.ts:30`.
