# Receipts, payment slips and duplicates — design

**Date:** 2026-09-12. **Status:** implemented and locally validated on the feature branch; awaiting `finish-branch`. Brainstormed with the owner the same day, on top
of the legal research recorded verbatim in
[compliance/verifactu-findings.md §15](../../compliance/verifactu-findings.md) and the open advisor
question [asesor-questions.md Q19](../../compliance/asesor-questions.md).

## 1. The problem, in one paragraph

The card details currently print on the fiscal ticket
([2026-09-11-card-receipt-tender-details-design.md](2026-09-11-card-receipt-tender-details-design.md),
rendered at [apps/server/src/receipt-ticket.ts](../../../apps/server/src/receipt-ticket.ts) ~line 305)
because the SumUp Solo has no printer of its own. That was a product choice, not a legal requirement —
the mandated contents of a factura simplificada carry no payment element and the Veri\*Factu registro
has no payment field at all (§15.5). Three consequences the owner wants changed: the invoice should
document the operation and not the payment; a customer paying by card should be offered the separate
payment slip a normal POS emits; and a second copy of an invoice must say «duplicado», which today it
never does — the reprint path is deliberately built to be byte-identical to the first print
([till-sale.ts](../../../apps/server/src/till-sale.ts) ~line 217), which is precisely what
RD 1619/2012 art. 14.4 forbids.

## 2. Decisions (owner, 2026-09-12)

- **Card identity comes off the fiscal ticket; the amounts stay.** `Efectivo`/`Cambio`,
  `Propina`/`Cobrado` and the manual-card `Ref.` remain, so the ticket still reconciles to the
  customer's bank statement on its own. Only scheme / last4 / entry mode / auth code move.
- **The payment slip is offered per card capture, by an operator prompt** — not automatic, not a venue
  setting. It is explicitly the slip a normal POS emits, and explicitly NOT a factura.
- **«Duplicado» is decided by the ACTION, not by a stored fact.** The receipt is always OFFERED at the
  moment the invoice is issued; that print is the original. Every print after that moment is a
  duplicate. A print-queue re-send re-emits the original bytes and is permission-gated.
- **Several guests → split by item.** Wire up the existing (landed, fiscally proven) split verb. The
  art. 14.2.a) *duplicado* route is NOT built — it is blocked on Q19 and must not be built on our own
  reading of an open legal question.
- **Handhelds may print.** Gated on a device-profile capability rather than the hardcoded handheld
  firewall: a waiter requests the bill at the table, it prints at the counter, and someone plates it
  for delivery. Smoother than walking inside to ask.
- **The slip matches the ticket's language handling for now.** `locations.invoice_locales` is designed
  for one-or-two-language invoices and snapshotted per sale, but is not rendered by either document
  today; implementing it is its own slice covering BOTH, not a bilingual slip beside a monolingual
  invoice.

## 3. Grounding

**Legal (all verbatim in findings §15, read from BOE/PETETE 2026-09-12):**

- **art. 14.1** — «sólo podrán expedir **un original de cada factura**»; **14.2** — duplicates only for
  several recipients or a lost original; **14.4** — each duplicate must carry «**duplicado**».
- **Gipuzkoa Hacienda Foral, TicketBAI FAQ** — a duplicate «debe incluir el mismo código QR y el mismo
  identificativo […] y la indicación que se trata de un "duplicado", **pero nada más**. Es decir, no
  deben estar firmados, no deben remitirse a la Hacienda Foral, no se deben anotar en un libro
  registro». TicketBAI is the Basque system, not Veri\*Factu, but it reasons from **the same state
  art. 14** it cites explicitly. **So a duplicate generates NO fiscal record and NO submission** — it
  is the same document plus one word.
- **Nothing requires a card slip** (§15.5): the invoicing rules carry no payment element, and
  RDL 19/2018 contains zero occurrences of `justificante`/`resguardo`/`comprobante`.

**Code facts at design time, before implementation:**

| Claim | Receipt |
| --- | --- |
| Reconciliation does NOT flow through the ticket DTO | `payments` carries `working_order_id` (NOT NULL), `sale_id`, `provider`, `payment_ref` under a UNIQUE idempotency key, plus `payments_reconcile_idx (tenant_id, provider, settled_at)` — [packages/payments/src/schema/payments.ts](../../../packages/payments/src/schema/payments.ts) |
| The manual-card `Ref.` is hand-typed and optional | `...(ref === "" ? {} : { externalRef: ref })` — [apps/till/src/widgets/tender-pay.ts](../../../apps/till/src/widgets/tender-pay.ts) ~line 489 |
| A split check is table-less and label-less | `createOpenOrder(tx, cfg, checkId, [], null)` — the `null` IS the label; design states a check «is NOT table-anchored… it is a payment unit» ([working-order.ts](../../../apps/server/src/working-order.ts)) |
| `working_orders.label` already exists for this | «An optional operator-supplied label ("table 4", "blue umbrella") shown beside the number» — [packages/db/src/schema/orders.ts](../../../packages/db/src/schema/orders.ts) ~line 35 |
| Capabilities are the designed replacement for the handheld firewall | «Server-enforced device-capability flags… **generalising the hardcoded assertNotHandheld firewall**» — [packages/layouts/src/canvas.ts](../../../packages/layouts/src/canvas.ts) ~line 56 |
| A capability check passes for a device-less caller | «(1) Absent cookie ⇒ the env-till / legacy caller — pass, matching `assertNotHandheld`» — [apps/server/src/device-session.ts](../../../apps/server/src/device-session.ts) ~line 455 |
| `print_jobs` has NO sale link and carries opaque bytes | «OPAQUE ESC/POS bytes (the subsystem never inspects them)» — [packages/db/src/schema/print-jobs.ts](../../../packages/db/src/schema/print-jobs.ts) |
| There is no manual job re-send today, only bounded auto-retry | `packages/printing/src/runtime.ts` ~line 123 — a `failed` job under the attempt cap is re-claimed |
| `sales` cannot carry a mutable "printed" flag | `GRANT SELECT, INSERT` + `reject_mutation()` on UPDATE/DELETE — [packages/db/drizzle/0001_db_baseline_sql.sql](../../../packages/db/drizzle/0001_db_baseline_sql.sql) lines 131–145 |
| Cash handed over was not persisted | `settlementFor` retained change only in memory; `readSettledTicket` defaulted it to zero. The HTTP regression in `till-api.receipt.test.ts`, “replays and reprints the original cash handed over and change”, reproduced €20 tendered against €1.50 due becoming zero change on replay. |

**Implementation clarification (owner, 2026-09-12).** Preserve missing payment facts on the existing tender row rather than storing receipt snapshots or printer bytes. A duplicate preserves the filed invoice content, QR and recorded payment facts; optional owner-authored header and footer text uses the current layout. Invoice-first mode always prints the original at placement, regardless of the general receipt-print setting.

**Drawer clarification during branch review (owner, 2026-09-12).** Printing is independent of opening the drawer. A cash payment at a till creates a separate audited drawer job regardless of the receipt-print setting; card payments and invoice-first placement do not. Handhelds can record cash payments but cannot open the linked till's drawer, including through the manual-open route even when their profile declares the capability. The till hides that action on handhelds. Document jobs contain no drawer command and can be resent unchanged. Drawer jobs cannot be manually resent; an authorized manual opening at the till creates its own audit entry. `print_jobs.kind` distinguishes `document` from `drawer` without decoding the opaque bytes. This is a core-set column because it describes the existing delivery job.

**Why no new table.** An earlier draft proposed an append-only `receipt_originals` keyed
`(tenant_id, sale_id)` to decide original-vs-duplicate from a stored fact. The owner's rule — always
OFFER the receipt at issuance, mark everything after — removes the need: the distinction is carried by
which action the operator invoked, so no original-print tracking table, race or `on_request` special case. The separate cash-fact correction below does require a column migration. Recorded
because the rejected alternative is the one a future reader will re-propose.

## 4. Design

### 4.1 The fiscal ticket loses the card block

`TenderBlock` ([till-sale.ts](../../../apps/server/src/till-sale.ts) ~line 153) drops its
`card: CardDetails | null` field **entirely** — not merely its rendering. The slip reads the card facts
from the `payments` row directly, so carrying them through the ticket DTO buys nothing. `readTenderBlock`
stops reading the four `payments` card columns; the columns themselves are unchanged and become the
slip's source.

Both renderers change in lock-step, preserving the convention that the paper renderer and the
on-screen twin ([apps/till/src/screens/till-ticket-view.ts](../../../apps/till/src/screens/till-ticket-view.ts))
stay identical:

```
cash (unchanged)          card, no tip        card + tip          manual card
TOTAL        1,00 €       TOTAL     1,00 €    TOTAL     1,00 €    TOTAL     1,00 €
Efectivo     1,00 €       Tarjeta             Tarjeta             Tarjeta
Cambio       0,00 €                           Propina   0,50 €    Ref. 4471
                                              Cobrado   1,50 €
```

`Ref.` survives for MANUAL tenders only: a manual tender has no `payments` card data, so it gets no
slip, and the operator-keyed number is the customer's only link between the ticket and the bank
terminal's own paper. `ENTRY_MODE_LABEL` and the `card` entry in the renderers' `LABEL` tables are
deleted; `Tarjeta`, `Propina`, `Cobrado` stay.

### 4.1a Persist the missing cash fact

Add nullable `tenders.cash_tendered`, without changing `amount`: the latter remains the amount applied to settlement. A non-null cash amount is valid only for a cash tender and must be at least `amount`. The same INSERT that settles a cash sale stores the money handed over; change is reconstructed as `cash_tendered - amount`. Core callers omitting the optional cash fact leave it null; the till always supplies it for cash. A null fact has no separately recorded change.

This column belongs to the existing core tender table because that row owns settlement facts. Its append-only protection and settlement-sum checks continue to apply. A retried payment returns the recorded change, while its replay path still does not dispense cash or open the drawer again.

The fiscal receipt interface exposes the issuer identity stored by a backend that retains it. Veri*Factu reads the filed issuer name and tax ID; generic callers do not import the regime. A backend with no stored receipt provides no historical issuer identity.

### 4.2 The payment slip — a new, deliberately separate renderer

New `apps/server/src/payment-slip.ts`. It is a SEPARATE module rather than a mode flag on
`receipt-ticket.ts` for a structural reason: it has no access to invoice number, series or QR
generation, so it **cannot** emit a document that reads as a factura — a property that survives future
edits by construction rather than by a reviewer noticing.

```
       JUSTIFICANTE DE PAGO
    Este documento no es una factura
-----------------------------------------
Casa Gormley · B12345678
12/09/2026 14:32
Mesa 6 · Pedido 41

Tarjeta        VISA **** 5838
Entrada        Sin contacto
Autorización   328600

Importe        1,00 €
Propina        0,50 €
Cobrado        1,50 €
```

- **No invoice number, no series, no QR** — the three marks that make a document a factura. The invoice
  number is omitted deliberately even though it would aid reconciliation: combined with the issuer NIF
  and total it would leave a document resembling a simplified invoice missing only its QR. That
  trade-off is Q19(e) to the advisor; if the advisor blesses it, adding the number later is a one-line
  change.
- **`Mesa 6 · Pedido 41`** is the grouping key (§4.3) — what lets whoever is at the printer collect
  several slips and tickets from one table.
- Degrades like the ticket does: a capture with no card facts prints the amounts and omits the card
  lines; it never throws (§5 forbids a presentation gap failing a filed sale).

**Route:** `POST /api/sales/:id/payment-slip`, keyed on the working-order id exactly as `reprint` is,
resolving the same printer through the same `resolveReceiptPrinter` path. Refuses an unknown id with
`working_order.not_found` (404) — the code the sibling receipt routes already use via
`requireUuidId(c.req.param("id"), "working_order.not_found")`, NOT a `sale.*` code — and enqueues
nothing when the sale had no card tender.

**Till:** a third button in the existing `.receipt-actions` row
([till-ticket-view.ts](../../../apps/till/src/screens/till-ticket-view.ts) ~line 513), rendered only
when `tender.method === "card"`.

### 4.3 A grouping label on split checks

`splitOffCheck` ([working-order.ts](../../../apps/server/src/working-order.ts)) currently passes `null`
as the new check's label, and the check is deliberately not table-anchored — so today four checks from
one table carry nothing connecting them to each other or to the table. It will instead stamp the label
from the ORIGIN tab (its table's name, falling back to the origin's own label when the origin has none).

When a sale files, stamp its resolved table label on the working order. For invoice-first orders, that happens at placement; other orders stamp it at settlement. Filed receipts read the stored label, so table renaming and later table turnover do not change it.

`TillSaleResult` gains `orderLabel: string | null` and `orderNumber: number`, printed on both the
fiscal ticket and the slip. This is what makes the owner's split-bill workflow physically work: the
bills for one table come off the printer identifiable as a set.

### 4.4 «Duplicado» — three actions

| Action | Surface | Prints | Gate |
| --- | --- | --- | --- |
| **Print receipt** | the sale-completion screen, at issuance | original | capability (§4.5) |
| **Reprint receipt** | a filed sale, any time after | «DUPLICADO» | capability (§4.5) |
| **Re-send job** | the Impresoras dashboard | the original bytes, unchanged | `print.resend` |

The rule in one sentence: **the receipt is always offered at the moment the invoice is issued, and that
print is the original; every print after that moment is a duplicate.** For pay-at-issuance flows, `auto` prints automatically and `on_request`/`never` offer the original on the completion screen. In invoice-first mode, placement always prints the original bill for the customer to read and pay. It carries no payment block before settlement; collection offers duplicates and retains the cash-drawer action. A customer who declines and
later asks gets a duplicate — the invoice was issued and offered, so the later paper is genuinely a
second copy.

**Routes.** `POST /api/sales/:id/reprint` KEEPS its name and its meaning narrows to "print a
duplicate" — it always marks from now on. A new `POST /api/sales/:id/receipt` prints the original and is
what the completion screen calls, including the `on_request` prompt. Splitting them this way leaves the
shipped route name meaning something a caller would still expect, and puts the new behaviour on the new
name.

`buildReceiptBytes` ([receipt-print.ts](../../../apps/server/src/receipt-print.ts) ~line 114) gains one
boolean, `duplicate`. Per Gipuzkoa, the duplicate is otherwise identical — same QR, same fiscal
identifier — with «DUPLICADO» rendered prominently near the header. The filed invoice content, QR and recorded payment facts are preserved; optional header/footer trim follows the current layout. It creates **no** fiscal record
and triggers **no** submission. `enqueueReceiptReprint` is split into the two named actions above so the
call site, not a stored fact, carries the meaning.

**Re-send** is new (only bounded auto-retry exists today) and takes a new `print.resend` permission. The
alternative of reusing `printer.manage` was rejected: configuring a printer and re-emitting a fiscal
document are different risks, and permissions are never renamed once shipped.

**Stated plainly, because the spec must not imply more than it delivers:** nothing here *enforces* one
original per invoice. The guarantee is procedural — the operator picks the right action, and the queue
re-send sits behind a permission. Art. 14.1 binds the business, and the owner has chosen to meet it by
procedure rather than by software lock. A future slice could make it structural with the rejected
`receipt_originals` table (§3).

### 4.5 Handhelds print, by capability

A new `CAPABILITY_FLAGS` member — `print-receipt` — added in
[packages/layouts/src/canvas.ts](../../../packages/layouts/src/canvas.ts). The three receipt routes
(print, reprint, payment-slip) swap `assertNotHandheld(deps, c, …)` for
`assertDeviceCapability(deps, c, "print-receipt", …)`.

Behaviour is preserved for ordinary tills: a device-less caller passes at branch (1). A handheld gains
the ability by having the flag added to its device profile, and is refused `device.forbidden_action`
(403) without it — fail-closed, since profiles default to `[]`.

### 4.6 Split-bill UI

Replace the `"table.action_split": "Split (soon)"` placeholder
([apps/till/src/i18n/strings.ts](../../../apps/till/src/i18n/strings.ts) ~line 383) with the real flow
against the landed `POST /api/tabs/:id/split`. The split operation already exists: `splitOffCheck` and its fiscal proofs are
on `main` (`apps/server/src/split-bill.fiscal.test.ts` — one tab → 3 checks → exactly 3 chained
registros with contiguous numbers), and §4.3's label is the only change to the split operation. The till can select partial quantities of plain dishes. Existing modifier rules remain: a dish with options must move as a whole line.

## 5. Testing

- **Ticket renderer.** A card ticket renders NO scheme, last4, entry mode or auth code; the
  `Propina`/`Cobrado` pair still appears when a tip rode along; cash payment lines are unchanged apart from corrected replay facts; the manual-card
  `Ref.` survives. The on-screen twin and its a11y suite get the same variants.
- **Slip renderer.** Contains no QR, no series and no invoice number. Introduce forbidden output and confirm the test fails, then restore the renderer. Removing an assertion cannot prove its protection. Every conditional line (missing card
  facts, no tip, no label) pinned. The `****` mask survives the Latin-1 round trip
  ([packages/printing/src/escpos.ts](../../../packages/printing/src/escpos.ts) line 30).
- **Duplicado.** Print → unmarked; reprint → marked; for the same rendering inputs, marked and unmarked bytes differ only by the added text. Across a later print, filed invoice facts and QR remain the same; optional trim follows the current layout; a reprint files no `registros_facturacion`
  row and submits nothing — asserted on real Postgres, since that is the claim that matters fiscally.
- **Stored facts.** A cash sale and its pay replay return the same change; a duplicate prints the original cash handed over. Changing the current issuer identity or reusing/renaming the table preserves the filed identity and stored grouping. Current optional trim remains visible.
- **Invoice first.** Placement prints one unpaid original in every print mode, to the issuing device’s printer. Collection creates no second original and retains the cash drawer action.
- **Capability.** A device-less caller passes all three routes; a device whose profile lacks
  `print-receipt` is refused 403 on all three; adding the flag admits it. Proved by deletion on the
  capability check.
- **Split label.** A split off a table stamps the check's label; the label reaches both documents; an
  origin with no table falls back to the origin's own label.
- **Wire contract.** `TenderBlock` is asserted across BOTH `apps/server` and `apps/till` — the plan
  enumerates the files from a grep at execution time rather than trusting a count written here, which
  goes stale (CLAUDE.md §7). Because more than one package asserts the shape, the final gate is a
  **full workspace run**, not a scoped one (CLAUDE.md §2).

## 6. Fiscal invariants — untouched, as an assertion

No hash input changes, no series, no chain, no `registros_facturacion` row. `computeHuella`'s inputs are
not touched. Removing the card block DELETES material from below `TOTAL`, strictly shrinking what sits
outside the mandated elements. «DUPLICADO» is added outside the invoice body and, on the Gipuzkoa
reasoning, creates no record and triggers no submission — the duplicate carries the SAME QR and
identifier as the original, so nothing about the filed record changes. The rectificativa path is
untouched: a corrected bill is a new invoice in its own series, printed as an original.

## 7. Out of scope, named

- **Multi-guest *duplicados* under art. 14.2.a)** — blocked on Q19. Do not build on our own reading.
- **Bilingual rendering of `invoice_locales`** — configured and snapshotted, rendered by neither
  document; its own slice covering both.
- **Making one-original-per-invoice structural** — the rejected `receipt_originals` table (§3, §4.4).
- **The SumUp printer-cradle experiment** — hardware not owned; runbook §5d.
- **Putting the invoice number on the slip** — gated on Q19(e).

## 8. Provenance

Legal texts read from BOE consolidated pages and PETETE on 2026-09-12; the DGT consulta was
cross-checked word-for-word against a legal-database reproduction. Full quotations and their caveats
live in [compliance/verifactu-findings.md §15](../../compliance/verifactu-findings.md) rather than being
restated here. Every code claim in §3 was run, not read from memory.
