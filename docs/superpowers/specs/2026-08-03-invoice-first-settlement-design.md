# Invoice-first mode — headless settlement slice — Design

**Date:** 2026-08-03
**Status:** Approved in brainstorming
**Scope:** Making an invoice-first (deferred) sale that has been **corrected by a rectificativa**
settleable at the corrected amount, plus the read model that surfaces unsettled sales and a runnable
script that walks the whole loop. This is the headless part of the fiscal sequence's "piece 4"
(invoice-first); the till UI that would *offer* the choice to staff is out of scope and belongs to
sub-project 7.

---

## 0. Why this exists, and what is already done

The backlog lists "invoice-first mode" as the still-to-build head of the fiscal sequence. Most of it
is already built. The **fiscal and database model** for issuing an invoice before payment landed with
**#39 (sale settlement)**:

- `recordSale({ settlement: { kind: "deferred" } })` already chains the invoice into the fiscal
  chain, stamps the huella, and queues it to AEAT via the `envios` outbox — **with no payment at
  all**. Verified: the fiscal record is written regardless of settlement mode
  ([`record-sale.ts:330-348`](../../../packages/core/src/record-sale.ts), asserted by
  [`record-sale.test.ts:531-546`](../../../packages/core/src/record-sale.test.ts)).
- `settleSale` closes it out later, touching **only** `tenders` + `sale_settlements` — never the
  chain, never AEAT ([`settle-sale.ts:16-21`](../../../packages/core/src/settle-sale.ts)).
- The correction remedy `recordCorrection` (R5 rectificativa) exists from **#46**.

So every **unrepairable, fiscal** part of invoice-first is done. What is missing is not fiscal. This
slice fills the one real functional gap and gives the deferred path a runnable exercise.

### The gap, precisely

`recordCorrection` writes a **new** `sales` row with a signed (typically negative) total and
`corrects_sale_id` pointing at the original, and it *"settles NOTHING — the customer refund is a
separate payments-layer action"*
([`record-correction.ts:74-96`](../../../packages/core/src/record-correction.ts)). That doc comment
describes the **settle-then-correct** case — a paid sale corrected downward, refunded via the
payments layer. The **correct-then-settle** case that invoice-first needs is not built:

> Print a €70 bill, issue it invoice-first (unpaid, chained, filed). The customer disputes / is €5
> short / you "take a fiver off". You issue an R5 rectificativa for **−€5** referencing the original.
> Declared turnover is now €70 + (−€5) = €65. The customer pays **€65**.

Today `settleSale` refuses that. Its coverage check is `sum(tenders.amount) = sale.total (70) +
sum(tips)` on the single original row
([`settle-sale.ts:66-78`](../../../packages/core/src/settle-sale.ts)), enforced a second time by the
`SECURITY DEFINER` function `sales_assert_tenders_cover`
([`0012_sale_settlement.sql:71-96`](../../../packages/db/drizzle/0012_sale_settlement.sql)). Neither
knows corrections exist, so €65 against a €70 sale is a shortfall. This is the design §5 "take a
fiver off" case that the sale-settlement spec said *"needs a factura rectificativa — the thing piece
4 builds"* ([sale-settlement design §5](2026-07-31-sale-settlement-model-design.md)); the
rectificativa half exists, the settlement half does not.

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| D1 | **Settlement becomes correction-aware.** The amount a sale is due is `total + sum(totals of rectificativas that correct it) + sum(tips)`, netting every correction that exists at settlement time |
| D2 | **Both enforcers change in lockstep** — the `SECURITY DEFINER` coverage function (migration `0021`) and the app-level check in `settleSale` — so they cannot drift, the discipline #39 established |
| D3 | **No new error code.** `sale.tender_shortfall` still fires; its `due` param is now the net. Codes are never renamed once shipped, and this needs no new concept |
| D4 | **Correctives are never themselves settled.** A rectificativa has a negative total, `tenders_amount_ck` (`amount > 0`) forbids a negative tender, and it contributes only to the *original's* net — consistent with `recordCorrection` settling nothing |
| D5 | **A `listOutstandingSales` read model** in `packages/core` answers "which issued sales are unpaid, and for how much?" — the "is this sale paid?" reader the sale-settlement design named as a new join with no consumer yet |
| D6 | **A runnable server script** under `apps/server/scripts/` walks issue → list → correct → list → settle, modelled on `record-one-sale.ts`. The human-checkable artifact |
| D7 | **No new table, no new fiscal-chain code, no backfill.** The chain is untouched; nothing is deployed |

D1 is the load-bearing one. The alternative — settling the original at its full printed total and
modelling the reduction as a separate adjustment row — adds state that is already derivable from the
correctives, and diverges the payment record from the fiscal declaration. Netting keeps one number,
the net, equal to declared turnover.

---

## 2. Correction-aware coverage

### The identity

For a sale `S`, the amount owed becomes:

```text
due(S) = S.total
       + sum(C.total  for C in sales where C.corrects_sale_id = S.id)   -- signed; usually negative
       + sum(T.tip_amount for T in tenders where T.sale_id = S.id)
```

and settlement requires `sum(T.amount) = due(S)`. For the worked case: `65 = 70 + (−5) + 0`. A
comped/zero sale still holds (`0 = 0 + 0 + 0`), and a sale with no corrections reduces to today's
identity exactly, so pay-first and uncorrected invoice-first behaviour is unchanged.

### Migration `0021` — replace the coverage function body

The function stays owned by `sales_coverage_checker` and `SECURITY DEFINER`, reached through the
role-scoped bypass policies 0005 installed — that is the fail-open fix and it is **kept verbatim**.
Only the body changes, applied via the same owner-dance 0012 used (`GRANT` schema CREATE + role to
`CURRENT_USER`, `SET ROLE`, `CREATE OR REPLACE`, then revoke):

```sql
CREATE OR REPLACE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  sale_total  numeric(12, 2);
  corrections numeric(12, 2);
  tendered    numeric(12, 2);
  tipped      numeric(12, 2);
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  -- Net in every rectificativa that corrects this sale. Same table, same bypass policy as the
  -- SELECT above, so no new grant. corrects_sale_id is a tenant-consistent FK, so this can only
  -- sum same-tenant correctives even though the definer sees every row.
  SELECT coalesce(sum(total), 0) INTO corrections
    FROM sales WHERE corrects_sale_id = p_sale_id;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + corrections + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + corrections + tips is %',
      p_sale_id, tendered, sale_total + corrections + tipped;
  END IF;
END;
$$;
```

The `IS NULL → RETURN` early exit still covers the rolled-back-sale case. The added SELECT is on
`sales`, which the checker already reads, so no privilege changes and `sale_settlements` still needs
no bypass policy of its own.

### `settleSale` — the same net, in the app

`settleSale` computes `due` from `sale.total` and the tender tips today
([`settle-sale.ts:66-69`](../../../packages/core/src/settle-sale.ts)). It gains one query — the sum
of `sales.total` where `corrects_sale_id = input.saleId` — and adds it into `due`, so the app-level
shortfall check matches the trigger's identity exactly. `sale.tender_shortfall`'s `due` param carries
the net; no new code path, no new error.

### Which corrections count, and the boundary this draws

The function reads current state, so **every correction that exists at settlement time nets in**. A
rectificativa issued *after* settlement does not (the `sale_settlements` row is already written and
immutable) — that is the existing decoupled-refund case, untouched. This is the clean line:

| Ordering | Meaning | Path |
| --- | --- | --- |
| correct **then** settle | reduce what is owed before payment (invoice-first) | this slice — nets into `due` |
| settle **then** correct | refund an overpayment after the fact | unchanged — payments-layer refund |

**Concurrency.** A rectificativa commits in its own transaction (it takes the chain-head and series
locks); `settleSale` takes neither. So a correction can commit between the app-level check and the
`sale_settlements` INSERT. The trigger is the arbiter — it re-reads the sum at INSERT time and fails
closed if the net moved. Rare, and the safe direction.

**Correctives are not settled.** A negative `due` cannot be covered by `amount > 0` tenders, and no
flow settles a corrective. The read model (§3) also excludes them, so nothing offers it.

---

## 3. The outstanding-sales read model

`listOutstandingSales(tx, tenantId)` in `packages/core` — the "is this sale paid?" reader the
sale-settlement design flagged (*"a new join for every consumer that asks"*, §3). RLS-scoped under
`withTenant`; an ordinary SELECT, no `SECURITY DEFINER`.

A sale is **outstanding** iff all hold:

- it is an ordinary alta — `corrects_sale_id IS NULL` (a rectificativa is not independently owed);
- it is **not** an F3 canje substitute — no `sale_substitutions` row with `substitution_sale_id =
  s.id` (an F3's amount was already collected via the tickets it substitutes — AEAT's *"no cobrar
  dos veces"*, [findings §10.2](../../compliance/verifactu-findings.md));
- it has no `sale_settlements` row (unsettled);
- it has no `sale_voids` row (not voided).

Each returned row carries `saleId`, `invoiceNumber`, `issuedAt`, `tillId`, `total` (the printed
figure), `correctionTotal` (`sum` of correctives, 0 when none), and `amountDue = total +
correctionTotal` — the net a consumer would collect.

**Deliberately not exhaustive over every document type.** A simplified ticket that was substituted by
an F3 *while still unpaid* is a flow that does not occur (a canje exchanges already-issued — normally
already-paid — tickets), so the reader does not special-case the substitut**ed** side. Recorded so
the boundary is a decision, not an oversight.

---

## 4. The server script

`apps/server/scripts/settle-invoice-first.ts` (name to be finalised in the plan), modelled closely on
[`record-one-sale.ts`](../../../apps/server/scripts/record-one-sale.ts): connection string from
`DATABASE_URL` only, `WAITRON_ENV` required (it stamps `entorno` onto an unrepairable chain), the same
`VerifactuBackend` construction and `systemClock`. It takes the ids as arguments — tenant, till, node,
**standard** series, **rectificative** series — because it issues both an alta and a rectificativa,
and neither series is auto-provisioned.

It walks the loop and prints each step so a human can read the story:

1. issue an invoice-first (deferred) sale of €70 → print `saleId`, fiscal record, `pendiente`;
2. `listOutstandingSales` → shows the €70 sale, `amountDue 70.00`;
3. `recordCorrection` for −€5 on the rectificative series → print the corrective's `saleId`/record;
4. `listOutstandingSales` → same original, `amountDue 65.00`;
5. `settleSale` with a €65 tender → succeeds;
6. `listOutstandingSales` → empty.

This is the end-to-end proof that the #46 dependency actually closes the invoice-first loop, and the
first non-test consumer of deferred mode.

---

## 5. Testing

**The coverage function runs on real Postgres, as the non-superuser role.** PGlite makes every
connection a superuser, so it cannot show the behaviour `sales_coverage_checker` exists for — the
fail-open hole #39's §7 was named for. The genuine non-superuser apply is exercised by
`packages/provisioning`'s RLS suite (which applies the `core` manifest as `prov_admin`), exactly as
0012 records; the new migration rides the same path.

**Every guard proved by deletion**, with a negative control confirming the failure is for the claimed
reason:

| Guard | Deletion must make this pass |
| --- | --- |
| correction-netting in the coverage function | a €65 settlement of a €70 sale carrying a −€5 rectificativa wrongly succeeds |
| correction-netting in `settleSale` | same, at the app layer |
| `listOutstandingSales` corrective exclusion | a −€5 rectificativa appears as an outstanding sale |
| `listOutstandingSales` F3 exclusion | an F3 canje sale appears as outstanding |

**Mode equivalence stays green.** An uncorrected sale settled `immediate` and `deferred` still
produces identical `tenders` and `sale_settlements` rows (#39's D6 assertion), and an uncorrected
sale's `due` is unchanged — this slice only adds a term that is zero when there are no corrections.

**Concurrency** (real target only): a rectificativa committing between the app check and the
`sale_settlements` INSERT must be caught by the trigger, not silently accepted.

**Gate.** `packages/db` and `packages/core` run **unfiltered** `test:coverage` — this touches schema
(the migration), a guard, and error-code call sites, so the whole-package cross-cutting suites must
load. Thresholds stay `98/98/98/95`. New suites carry guarded teardowns.

---

## 6. Out of scope

- **Partial payment / running tabs** — accumulating tenders against an issued invoice over time.
  Newly expressible by the schema, no consumer needs it; owner decision, 2026-08-03.
- **The till UI** — offering invoice-first to staff is sub-project 7. This slice is headless.
- **The working-order amendment log** (art. 29.2.j LGT preservation duty) — nothing writes working
  orders, so a log has no producer; deferred into sub-project 7, unchanged.
- **The precuenta question** — whether a printed pre-bill triggers the preservation duty is still
  advisor-blocked (Q14).
- **No backfill.** Nothing is deployed; the migration changes a function body only, touching no data.

---

## 7. Provenance

| Claim | Source |
| --- | --- |
| Deferred mode already chains + files the invoice with no payment | [`record-sale.ts:330-348`](../../../packages/core/src/record-sale.ts); [`record-sale.test.ts:531-546`](../../../packages/core/src/record-sale.test.ts), read 2026-08-03 |
| `settleSale` checks `sum(amount) = total + sum(tip)` on one sale, and `recordCorrection` settles nothing | [`settle-sale.ts:66-78`](../../../packages/core/src/settle-sale.ts); [`record-correction.ts:74-96`](../../../packages/core/src/record-correction.ts), read 2026-08-03 |
| The coverage function is `SECURITY DEFINER`, owned by `sales_coverage_checker`, via bypass policies | [`0012_sale_settlement.sql:52-96`](../../../packages/db/drizzle/0012_sale_settlement.sql) |
| A rectificativa carries a negative `ImporteTotal`; the corrective's total is a signed delta | [`record-correction.ts:62-67`](../../../packages/core/src/record-correction.ts); [findings §10.2](../../compliance/verifactu-findings.md) |
| Anulación is unavailable for a real operation (so void-and-reissue is illegal) | [findings §7](../../compliance/verifactu-findings.md) (AEAT developer FAQ, 4 Dec 2025) |
| An F3 canje's amount must not be collected twice | [findings §10.2](../../compliance/verifactu-findings.md) |
| Highest migration is `0020`; new work is `0021` | `packages/db/drizzle/`, read 2026-08-03 |
