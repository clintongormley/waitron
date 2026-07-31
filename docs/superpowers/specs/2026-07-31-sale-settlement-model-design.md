# Sale Settlement Model — Design

**Date:** 2026-07-31
**Status:** Approved in brainstorming
**Scope:** Moving the payment facts — the tip, the amount charged, and the tender-coverage check —
off the immutable `sales` row, so that an invoice can be issued **before** payment settles as well
as after. This is piece 2 of four; the other three are scoped in §8 and are **not** built here.

---

## 0. Why this exists

The question that produced it was operational, not architectural: in a restaurant, the waiter
prints the bill at the counter and carries it to the table. **Is that printed bill the invoice?**

It is not, and under today's code it cannot be. `recordSale` refuses to write anything until every
tender has settled (`sale.tender_unsettled`), so no invoice exists at the moment the bill is
printed. The customer therefore receives two documents: a *pre-bill*, which is not fiscal, and
afterwards a *factura simplificada*, which is.

Wanting the option of a single document — the classic Spanish *ticket*, issued when the bill is
requested and paid against — is what exposed the blocker in §2. The fiscal groundwork that made the
option viable is recorded in §9; this document is about the model change it requires.

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| D1 | **`sales` holds the fiscal figure alone.** `tip_amount` and `amount_charged` leave it |
| D2 | **The tip lives on `tenders`**, attributed to the payer who left it — not on the sale, not in its own table |
| D3 | **`amount_charged` is derived**, never stored. Nothing in production ever read it (§3) |
| D4 | **Settlement becomes an explicit, append-only fact** — a `sale_settlements` row — and the coverage check moves onto its INSERT |
| D5 | **The mode is a required argument, not configuration.** `recordSale` takes `settlement: {kind:"immediate", tenders} \| {kind:"deferred"}`; there is no `tenants.invoice_timing` column |
| D6 | **One implementation for both modes.** `kind:"immediate"` runs `settleSale`'s code in the same transaction, so the paths cannot drift |
| D7 | **The `sales_coverage_checker` machinery is kept verbatim** — role, SECURITY DEFINER, bypass policies. Only the function body changes |
| D8 | **The deferral goes.** Two deferred constraint triggers become one ordinary trigger, plus one new guard against post-settlement tenders |
| D9 | **`tenders_amount_ck` tightens from `amount <> 0` to `amount > 0`.** The permission was an artefact of spelling, not a decision — established, not assumed (§3) |

D5 is the load-bearing one. Splitting `recordSale` into two free functions would have made "chained
an invoice and forgot to settle it" a silent state indistinguishable from a legitimate deferred
sale. Requiring the caller to name the mode makes that unreachable.

---

## 2. The blocker, precisely

Three things conspire, and all three are deliberate:

- `sales` is immutable — written once, `REVOKE ALL` on UPDATE, an append-only trigger.
- `sales_amount_charged_ck` pins `amount_charged = total + tip_amount`
  ([`packages/db/src/schema/sales.ts:111`](../../../packages/db/src/schema/sales.ts)).
- Tenders must sum to `amount_charged`, *"checked at COMMIT by a deferred constraint trigger"*
  ([`sales.ts:151-154`](../../../packages/db/src/schema/sales.ts)).

Issue the invoice before payment and `tip_amount` is unknown, so it is written `0.00` and
`amount_charged` becomes `total`. The row is then immutable, so the tip has nowhere to live —
and €80 of tenders against `amount_charged = 70.00` violates the deferred constraint.

A deferred constraint cannot span transactions, and under invoice-first the settlement happens in a
later one. So the check has to move, not merely relax.

**The tip was never the visible part of the problem.** It does not appear on the invoice under
either mode (§9.2), so the printed document is identical. What breaks is the *recording* of it.

---

## 3. Schema

### `sales` — drops to one number

```sql
DROP COLUMN tip_amount
DROP COLUMN amount_charged
DROP CONSTRAINT sales_amount_charged_ck
DROP CONSTRAINT sales_tip_amount_ck
```

`total` stays. The table comment's *"Three distinct numbers, held together by CHECK"* becomes one
number: what the invoice says.

**Traced before proposing.** `rg 'amountCharged|amount_charged' packages apps` returns, outside
`record-sale.ts` (which writes it): five raw-SQL test fixtures, one string literal inside
`english-only.test.ts`, and nothing else. **No production code reads it.** The column's stated
purpose — *"what hit the payment instruments; reconciles against the acquirer"*
([`sales.ts:53`](../../../packages/db/src/schema/sales.ts)) — was never implemented;
`packages/payments/src/reconcile.ts` does not reference it. Reconciliation matches **per capture**
against the acquirer's report, and per-capture is what `tenders.amount` already is, so the aggregate
was never the useful shape.

### `tenders` — gains the tip

```sql
ADD COLUMN tip_amount numeric(12,2) NOT NULL DEFAULT '0.00'
CHECK (tip_amount >= 0)
CHECK (tip_amount <= amount)              -- a tender cannot be more tip than it is money

-- and, in the same migration:
tenders_amount_ck: amount <> 0  →  amount > 0
```

`settled_at` stays `NOT NULL`: a row exists only once the money landed.

**Why the sign check is tightened here, and why it has to be.** `tenders_amount_ck` was
`amount <> 0`, **not** `amount > 0` ([`sales.ts:173`](../../../packages/db/src/schema/sales.ts)), so
negative tender amounts were legal. `CHECK (tip_amount <= amount)` would reject every one of them,
tip or no tip, since `0 <= -10` is false — the two constraints cannot coexist.

The permission turns out to be an artefact rather than a decision, and this was checked three ways
rather than assumed:

- **It is not for refunds.** `rg 'insert\(tenders\)'` across `core`, `payments` and
  `payments-stripe` returns exactly one site, [`record-sale.ts:284`](../../../packages/core/src/record-sale.ts).
  The payments package owns its own lifecycle tables and a void appends to `sale_voids`; nothing on
  a refund path writes a tender.
- **No rationale was recorded.** The check arrived in `10b16fd` (*"feat: sales spine — data model +
  write path (plan 2) (#12)"*, 2026-07-21), whose message explains at length why `total`,
  `tip_amount` and `amount_charged` are three columns and why the deferred trigger exists — and says
  nothing about sign. The sales-spine design does not mention it either.
- **Neither boundary is tested.** `tenders_amount_ck` appears in exactly one place in the
  repository: its own definition. Every tender amount in `sales.test.ts` is positive.

The reading that fits all three is that the check was written to reject a **zero** tender and `<> 0`
was simply how it got spelled. Meanwhile the shape is reachable — `recordSale` takes the tender list
from its caller and validates only the sum, so `[80.00, -10.00]` against a €70 sale passes today and
means nothing. Tightening closes that and restores the simple tip check.

The migration validates existing rows, so a stray negative tender in a developer's database fails
the migration loudly rather than being silently dropped. There is no production data.

Putting the tip here rather than on the sale is not only expedient. It attributes the tip to the
payer who left it, which is exactly what sub-project 13 (*Tips — attribution + payroll export*)
needs, and it turns the tip from a residual into a recorded affirmation — see §4's note on the
€500-instead-of-€50 case.

### `sale_settlements` — new, append-only, one row per sale

```sql
(id, tenant_id, sale_id, settled_at)
UNIQUE (tenant_id, sale_id)
FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id)
```

- append-only and TRUNCATE-blocking triggers, `REVOKE UPDATE, DELETE`, following
  `registros_facturacion` and `tenders`
- RLS enabled and forced, tenant-isolation policy matching `tenders_tenant_isolation`
- `GRANT SELECT, INSERT TO app_user` — the same grant `tenders` holds, and no more

**Consequence worth stating plainly:** "is this sale paid?" stops being answerable from `sales`
alone. It becomes the existence of a `sale_settlements` row, which is a new join for every consumer
that asks. Under invoice-first, an unsettled sale is a legitimate steady state, not an anomaly.

---

## 4. The core API

`recordSale` loses `tipAmount` and `tenders`, and gains a mode it cannot ignore:

```ts
recordSale({
  …existing fields, minus tipAmount and tenders,
  settlement:
    | { kind: "immediate"; tenders: RecordSaleTender[] }   // pay-first
    | { kind: "deferred" }                                  // invoice-first
})

settleSale({ tenantId, saleId, tenders })                   // the deferred half, later
```

`RecordSaleTender` gains `tipAmount` beside `method`, `amount`, `settledAt`.

`kind:"immediate"` calls the same code `settleSale` calls, in the same transaction. Pay-first
behaviour is therefore unchanged, and D6 holds by construction rather than by discipline.

### Why the mode is not configuration

A `tenants.invoice_timing` column would be a second source of truth for something the call site
must state anyway. The model requires the choice per sale; **whether staff are offered the choice is
till-UI policy**, and belongs to sub-project 7.

### The tip is decided in Waitron, never on the reader

Every provider offers an on-device tip prompt and every one is shaped differently. Reading a tip back
off the terminal would mean `PaymentResult.amount` exceeding what `collect` was asked for, and the
identity in §5 failing at settlement. The amount sent to the reader is final.

That does **not** mean the tip is known before the first `collect`. In the flow that motivated this
design — *"I'll pay €30"; "I'll pay €50"; "but you only owe €40"; "take the rest as tip"* — the tip
emerges at the last tender. What the model requires is only that each `collect` is told an exact
number, and that the excess over the invoice total is **affirmed as a tip at the till**, not
inferred from arithmetic: €50-against-€40 and €500-against-€50 are the same keystroke pattern, and
card overpayment cannot be handed back as change. `tenders.tip_amount` is where that affirmation
lands.

### Errors

| Code | Change |
| --- | --- |
| `sale.tender_unsettled` | Kept. Now raised by the settlement path, both inline and deferred |
| `sale.tender_shortfall` | Kept. Doc comment reworded to `sum(amount) = total + sum(tip_amount)`. Still fires in **both** directions despite the name — codes are never renamed once shipped |
| `sale.already_settled` | **New.** Surfaced from the `UNIQUE (tenant_id, sale_id)` violation via `isUniqueViolation`, the pattern `record-void.ts` already uses |

`settleSale` must additionally refuse two states that could not exist before: a sale carrying a
`sale_voids` row, and a sale in another tenant — the latter hidden by RLS and therefore
indistinguishable from not-found, which is the fail-closed shape `sale.series_not_found` already
documents.

### No fiscal involvement

`settleSale` writes `tenders` and `sale_settlements` and nothing else. Payment is not a fiscal
event: nothing here touches the chain, takes the chain-head lock, or submits to AEAT. The
lock-ordering hazard documented at `record-sale.ts` step 3 (chain-head before series, never the
inversion) does not extend into it.

---

## 5. The coverage machinery — kept, moved, and one hole closed

### What exists, and why it is not to be rewritten

`sales_assert_tenders_cover(uuid)` is `SECURITY DEFINER`, reassigned to a NOLOGIN role
`sales_coverage_checker`, and reaches its rows through role-scoped permissive `SELECT` policies on
`sales` and `tenders` ([`packages/db/drizzle/0005_sales.sql`](../../../packages/db/drizzle/0005_sales.sql)).
The migration records why, and it was verified live rather than reasoned about:

> SECURITY DEFINER alone does NOT close the fail-open hole an invoker-rights function would have.
> […] With `app.tenant_id` cleared before COMMIT, the row disappears, `charged` comes back NULL, and
> the early RETURN two lines down would let an uncovered sale commit — fail-OPEN. Verified live
> against a genuine non-superuser, non-BYPASSRLS owner: exactly that happened.

**All of it is kept.** The role, the ownership transfer dance, the temporary-then-revoked grants and
the bypass policies are untouched. `sale_settlements` needs no bypass policy of its own, because the
function takes `sale_id` as a parameter and never reads that table.

### What changes

The function body compares against the new shape:

```sql
sum(tenders.amount) = sales.total + sum(tenders.tip_amount)
```

The `IS NULL → RETURN` early-exit still covers the rolled-back-sale case, since `total` is
`NOT NULL` and a missing row therefore yields NULL exactly as `amount_charged` did.

### What goes away

Both deferred constraint triggers — `sales_check_tender_coverage` and
`tenders_check_tender_coverage` — are dropped. Under invoice-first a sale with no settlement is
legitimate, so a trigger on `sales` demanding coverage is not merely relaxed but **wrong**. One
ordinary `BEFORE INSERT` trigger on `sale_settlements` replaces both: the check now runs at the
moment completeness is *declared*, leaving nothing for COMMIT-time evaluation to do.

### The hole that opens, and closes here

A point-in-time check invites a later transaction to add another tender and change the sum. So
`tenders` keeps a trigger — a different one: **reject any INSERT for a sale that already has a
`sale_settlements` row.** Non-deferred, one existence check.

---

## 6. Migration `0012`

Ordered, in one migration:

1. `tenders.tip_amount` + its two checks, and `tenders_amount_ck` retightened to `amount > 0`
2. `CREATE TABLE sale_settlements` + immutability and TRUNCATE triggers + RLS + policy + grants
3. **Backfill** (below)
4. Replace `sales_assert_tenders_cover`'s body
5. Drop the two deferred constraint triggers; create the `sale_settlements` coverage trigger and the
   `tenders` post-settlement guard
6. Drop `sales.tip_amount`, `sales.amount_charged` and their two checks

**The backfill** assigns each existing sale's tip to its earliest tender —
`ORDER BY settled_at, id LIMIT 1`, deterministic and independent of uuid ordering — and writes a
`sale_settlements` row for every existing sale. It runs after step 1, so every surviving tender is
positive by then. The settlement row is correct by construction: under the old model a `sales` row
could not exist unless its tenders already covered `amount_charged`. The tip assignment is a **guess
with no information behind it** — the old schema recorded one tip per sale and never which payer
left it — so it is only defensible because the alternative is losing the figure. Where a sale
carries a non-zero tip and no tender at all, the old CHECK made that reachable only at
`total + tip_amount = 0`; the backfill **asserts** rather than guessing there.

Nothing is deployed, so there is no production data — but dev and CI databases run this path, so it
still has to be right.

`packages/db/drizzle` is sequentially numbered and carries `meta/_journal.json`. `0011` is current;
two branches adding migrations in parallel collide on the journal every time. This is why the four
pieces in §8 are sequenced rather than parallelised.

**Also in scope:** the five raw-SQL fixtures writing `amount_charged`, three of which are the
duplicated `seed.ts` copies already on the follow-up list — a reasonable moment to collapse them —
and the stale `sale.amountCharged` string literal inside `english-only.test.ts`.

---

## 7. Testing

### Real Postgres is mandatory here, not preferred

PGlite makes every connection a superuser, so it cannot show the behaviour `sales_coverage_checker`
exists for. The fail-open hole was found by running as a genuine non-superuser, non-BYPASSRLS owner;
changing that function's body and re-verifying only on PGlite would be the "reading is not
verification" failure this repository is named for. The suite runs on the real target, as the
deployment role, with `app.tenant_id` cleared before the settlement insert, and asserts the check
still fires.

### Every new guard proved by deletion

Remove it, watch the test fail, restore it — with a negative control confirming each failure is for
the claimed reason:

| Guard | Deletion must make this pass |
| --- | --- |
| `sale_settlements` coverage trigger | a settlement whose tenders do not sum correctly |
| `tenders` post-settlement guard | a tender inserted after settlement |
| `sale_settlements` immutability + TRUNCATE triggers | UPDATE / DELETE / TRUNCATE |
| `tenders_tip_amount_ck` (`<= amount`) | a tender that is more tip than money |
| `tenders_amount_ck` (`> 0`) | a zero tender **and** a negative one |

That last row closes a gap this design found rather than created: the constraint had **no test at
all** before, in either direction. Both boundaries get one, so the tightening is a visible behaviour
change rather than an untested edit.

### Concurrency on the real target only

Two `settleSale` calls racing on one sale must leave exactly one settlement, surfaced as
`sale.already_settled`. On PGlite that test is a **false pass**, not a weak one — it serialises every
query onto one backend.

### Mode equivalence

The same sale settled `{kind:"immediate"}` and `{kind:"deferred"}` must produce identical `tenders`
and `sale_settlements` rows. This is the assertion that keeps D6 true, and it is cheap because there
is one implementation underneath.

### Gate

`packages/db` and `packages/core` run **unfiltered** `test:coverage`. A name-filtered run never
loads `english-only.test.ts`, `schema-ownership.test.ts` or `errors.reachability.test.ts`, and this
change touches schema, error codes and a guard fixture, so all three are in play. Thresholds stay
`98/98/98/95`. New suites carry guarded teardowns — PR #15 is mid-flight fixing 94 unguarded ones,
and this must not add a 95th.

---

## 8. The other three pieces

Four pieces came out of the same session. This spec is piece 2. The others get their own specs,
plans and PRs, sequenced because they all add migrations to `packages/db` (§6):

| # | Piece | Status |
| --- | --- | --- |
| 1 | Working-order amendment log (LGT art. 29.2.j) | **Deferred into sub-project 7** — see below |
| 2 | Payment facts off the immutable sale | **This document** |
| 4 | Rectificativas — *por sustitución* and *por diferencias* | Next cycle. Touches the chain |
| 3 | Invoice-first enabled in the till | Last. Depends on 2, and on 4 existing as the remedy |

**Order: 2 → 4 → 3.** Piece 3 is deliberately last: invoice-first must not be offered to staff before
a rectificativa path exists, because the normal remedy for a disputed bill *is* a rectificativa and
anulación is not available for a meal that was really served (§9.1).

**Piece 1 was deferred, not dropped.** Nothing writes working orders yet —
`rg -l 'workingOrderLines|workingOrders' packages/*/src apps/*/src` returns only the schema itself,
`packages/db`'s barrel, and the payments layer carrying `working_order_id` as a foreign key.
`packages/core` has no `addLine`/`amendLine`/`removeLine`. Building an append-only log with no
producer would repeat the `errors.reachability.test.ts` shape: a guard that looks wired and is not.
The obligation is recorded instead — see §9.3 and the pointer added to sub-project 7 in the phasing
table.

**Piece 4's prerequisite is now closed.** The sales-spine design recorded *"Asesor Q5(b) — whether
rectificativas require their own series — is unverified"*
([§3](2026-07-19-sales-spine-and-fiscal-layer-design.md)). It is verified: RD 1619/2012 art. 6.1.a)
makes it obligatory *«en todo caso»*
([verifactu-findings.md §10.1](../../compliance/verifactu-findings.md)). `N series per till` already
supports it, so piece 4 starts with the numbering question settled rather than open.

**A fifth piece surfaced while closing it, and it is not part of piece 4.** When a customer who
received a simplified invoice asks for a proper one with their tax details, the correct document is
a **factura de canje, `TipoFactura` F3** — and AEAT is explicit that it *«no tiene la consideración
de rectificativa»*, that the simplified invoices must **not** be annulled, that one F3 may exchange
many of them, and that its registro must name them in `FacturasSustituidas`
([findings §10.2](../../compliance/verifactu-findings.md)).

`packages/verifactu` already types `F3`, `FacturasRectificadas` and `FacturasSustituidas`. Nothing
above it uses them: `fiscal-verifactu/src/backend.ts:257` emits
`sale.counterparty === null ? "F2" : "F1"` and no third case, and `sales` carries no reference to
another invoice. A restaurant is asked for a proper invoice routinely, so this is ordinary trade
rather than an edge case — it wants its own spec, sequenced with piece 4 since both touch the chain
and both add `packages/db` migrations.

---

## 9. Fiscal findings behind this design

These came out of the same research and are recorded here because they constrain the pieces above.
The primary-source items also belong in
[`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md); the unresolved
one belongs in [`asesor-questions.md`](../../compliance/asesor-questions.md).

### 9.1 There is no "update" in Veri\*Factu

AEAT's developer FAQ enumerates four paths and none is an amendment. Before issuance,
*«se corrigen sin más antes de emitirla»*. After issuance: a **factura rectificativa** for anything
the ROF covers; an **RF de alta de subsanación** only for internal record fields *«que "no se ven" en
la factura impresa»*; an **RF de anulación** only where the invoice should never have existed.

Two constraints follow. Subsanación is not an edit — it cannot change an amount. And anulación is
unavailable for the ordinary case:

> «todas las facturas emitidas, en la medida en que respondan a operaciones realmente efectuadas
> (como es el caso habitual) no pueden anularse»

AEAT reserves *«casos muy excepcionales»* for subsanación and anulación **only**. Rectificativa is
the normal sanctioned procedure, not something frowned upon — which is what makes piece 3 viable at
all, and why it must wait for piece 4.

### 9.2 The tip appears on no document, and must not

The DGT's position is that a voluntary tip is not consideration: *«no constituyen la remuneración de
entregas de bienes o prestaciones de servicios […] se entrega voluntariamente un donativo cuyo
importe determinan los mismos donantes libremente»*. Outside the VAT base, not invoiced. So the tip
**must not** appear on the factura simplificada — putting it there would be wrong, not merely
unnecessary.

The card slip shows the gross charged and breaks out no tip, because the terminal is sent one final
amount (§4). If the customer is to see the split — recommended, since otherwise the invoice and
their bank statement disagree — it is a **non-fiscal block printed below the invoice**, clearly
separated for the same reason a pre-bill must be: AEAT cares about documents that could be confused
with invoices.

> **Unverified, and load-bearing.** The sources are asesor commentary citing **DGT consulta
> vinculante 2174-03**, not the DGT text itself, and `docs/compliance/asesor-questions.md` has no
> propina entry at all. The "non-taxable" claim already baked into
> [`sales.ts:52`](../../../packages/db/src/schema/sales.ts) and
> [`record-sale.ts:59`](../../../packages/core/src/record-sale.ts) has never been put to the
> advisor. Added to the asesor list by this change.

### 9.3 Printing a pre-bill triggers a preservation duty (piece 1)

AEAT treats pre-bills as ordinary and lawful, and locates the moment an invoice comes into being
after them: *«tiene que existir un momento en el que, una vez completado internamente el contenido de
una factura, este se valide a los efectos de elaborar un RF […] expedir la correspondiente factura
con su numeración e, inmediatamente, remitir el RF»*.

Mutating an order before that moment is explicitly fine — *«cualquier alteración que se produzca en
ese registro, previo al RF, sería perfectamente lícita»*. What attaches on **issuance** is a
preservation duty:

> «cuando los albaranes, proformas, prefacturas o facturas sin validez fiscal se expidan, sus
> registros deberán conservarse de forma inalterable (salvo que la alteración se produzca por medio
> de un registro posterior, que también deberá quedar anotado en el sistema)»

This is not RRSIF but art. 29.2.j) LGT, which AEAT says *«despliega efectos directos desde su entrada
en vigor en octubre de 2021 respecto de cualquier otro sistema informático»*. The parenthesis is the
design: **an append-only amendment log satisfies it; the working order itself may stay mutable.**

Agreed shape for piece 1, for whoever specs sub-project 7: a **snapshot at each pre-bill print**, a
**diff per amendment thereafter**, and **no logging before the first print** — there is no issued
document to reconcile against, and AEAT's own words make pre-issuance mutation lawful.

> **An interpretation, not AEAT's word.** Their list says *albaranes, proformas, prefacturas*; it
> never uses *precuenta*. Treating a restaurant pre-bill as a member of that family is our reading.
> Added to the asesor list.

### 9.4 Issuing and delivering are both obligatory

RD 1619/2012 art. 11: *«Las facturas deberán ser expedidas en el momento de realizarse la
operación»* — the 16th-of-next-month deadline applies only to a business recipient. Art. 2 requires
*«expedir factura y copia de esta»*, and art. 18 requires transmission immediately on issuance to a
non-business recipient. Handing it over is not on request.

One consequence bites the printing question: art. 9 conditions electronic invoicing on
*«que su destinatario haya dado su consentimiento»*. **Digital delivery cannot be the default**, so
"email the invoice instead of walking back to the counter" is not an available answer. A
server-driven WiFi ESC/POS printer is, and stays consistent with D3 of the deli hardware design.

---

## 10. Provenance

| Claim | Source |
| --- | --- |
| No update path; rectificativa / subsanación / anulación semantics; anulación unavailable for real operations | [AEAT, *FAQs Desarrolladores VERI\*FACTU*, 4 Dec 2025, §"RECTIFICACIONES, ANULACIONES, SUBSANACIONES"](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf) |
| Pre-facturas lawful; pre-issuance mutation lawful; preservation on issuance; art. 29.2.j LGT direct effect from Oct 2021 | Same document, §11 and the duplicate-RF section |
| Invoice issued at the moment of the operation; copy required; immediate transmission; electronic delivery needs consent | [RD 1619/2012, arts. 2, 9, 11, 18 (BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) |
| Tips outside the VAT base, not invoiced | **Secondary** — asesor commentary citing DGT consulta vinculante 2174-03. Not read at source. See §9.2 |
| A specific series for rectificativas is obligatory | [RD 1619/2012 art. 6.1.a) (BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696), read via both the consolidated and original renderings |
| F3 canje is not a rectificativa; no annulment; `FacturasSustituidas`; V2543-06 | AEAT developer FAQ, worked examples for rectifying simplified invoices |
| No production reader of `amount_charged` | `rg 'amountCharged\|amount_charged' packages apps`, 2026-07-31 |
| No writer of working orders | `rg -l 'workingOrderLines\|workingOrders' packages/*/src apps/*/src`, 2026-07-31 |
| Only one site inserts tenders; refunds do not | `rg 'insert\(tenders\)' packages/core/src packages/payments/src packages/payments-stripe/src`, 2026-07-31 |
| `tenders_amount_ck` has no rationale and no test | `git log -S tenders_amount_ck` → `10b16fd` (2026-07-21), whose message never mentions sign; `rg tenders_amount_ck` returns only its own definition |
| Fail-open behaviour of an invoker-rights coverage function | [`packages/db/drizzle/0005_sales.sql`](../../../packages/db/drizzle/0005_sales.sql), verified live at the time it was written |
