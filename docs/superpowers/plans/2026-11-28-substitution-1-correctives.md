# SUBSTITUTION-1: a correction that leaves something to pay files a corrective by substitution

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (implementers
> dispatched as `subagent_type: "implementer"`) to build this plan task by task. Steps use checkboxes.

Status: written 2026-11-28 for lane L; revised the same day after one fresh-context review; not yet
cleared. FISCAL: the owner lands every pull request, the verifactu library's included.

**Goal:** when staff give money back and something is left to pay, Waitron files one corrective that
states the corrected invoice and the figures of the version it replaces (AEAT's `TipoRectificativa`
"S", option 1), and prints the corrected bill with the amount of the change. A correction that takes
the invoice to zero stays "by differences" ("I"). Receipts first, full invoices after lane L's
CORRECT-FULL-INVOICE PR 4b and PR 5.

**Spec:** [2026-11-28-corrections-by-substitution-design.md](../specs/2026-11-28-corrections-by-substitution-design.md),
decisions D1 to D3 and its §2 and §3. D4 to D10 are plans 2 and 3 of that design, not this one.

**Architecture.** The corrective's `sales` row keeps storing **the change** (`total`, `vat_breakdown`,
its negative lines) and keeps `corrects_sale_id` on the invoice the corrections hang from, so every
money reader, the VAT return and the payment-coverage trigger read it exactly as today. Three new
columns on `sales` say what only a restatement has: which version it replaces, and the corrected total
and VAT split it files. Core decides "S" or "I" from what is left after the change; the Veri\*Factu
record builder files what core hands it; the paper shows the corrected bill.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest; the `@waitron/verifactu` library and its
`scripts/live-aeat.mjs` in `~/workspace/repos/verifactu` for PR 0.

**Base.** `main` at `dc97abe4b7`, which holds the design and #4560 (CORRECT-FULL-INVOICE PR 4a,
landed as `9eae032090`). Line numbers were read at `2bfa7a34e3` and rechecked at `dc97abe4b7` for every
file #4560 or the design changed (`transaction-receipt-api.ts`, the till guide, `docs/backlog/fiscal.md`,
`docs/backlog.md`). Every `file:line` below was read; nothing was run.

**Words.** A *receipt* is a simplified invoice (AEAT's F2). A *full invoice* names the customer (F1).
A *corrective* is a new invoice that corrects an earlier one (R1 for a full invoice, R5 for a
receipt). *By differences* ("I"): the corrective carries only the change, usually negative. *By
substitution* ("S"): it carries the corrected figures and states the figures of the version it
replaces. Two kinds of Waitron document file "S": the *Q37 replacement*, which repeats an invoice AEAT
refused with nothing rectified (`replaces_original = 1`), and the new **restatement**, which this plan
builds. ("Substitution" in Waitron's code already means the F3 path, `sale_substitutions` and
`record-substitution.ts`, so the new code says "restatement".) The *target* is the invoice the
corrections hang from: the original, or its Q37 replacement (`correctionTargetFor`,
`packages/core/src/correction-target.ts:12-18`). The *latest version* is the target, or the newest
restatement of it. The *restated* figures are a restatement's corrected total and VAT split; the
*replaced* figures are the latest version's figures before the change.

## Global constraints

- AEAT option 1 (AEAT procedures FAQ, option 1 and its example 1; design §6): `Desglose`
  and `ImporteTotal` are the restated figures; `ImporteRectificacion` holds `BaseRectificada` and
  `CuotaRectificada`, the replaced version's base and VAT summed over its rates; `FacturasRectificadas`
  names the latest version's number and date. `ImporteRectificacion` is required with "S" and only with
  "S" (`val.txt:372-375`).
- A restatement only when the restated total is above zero **and the target holds no correction by
  differences yet**. Otherwise "I": a correction to zero, every whole-invoice credit (`wholeInvoice`),
  and any correction of an invoice that already holds an "I" (D3; the last because PRs 1 and 2 switch
  nothing on, so receipts keep filing "I" until PR 3 and full invoices until PR 4, which resets no
  venue).
- Receipts take R5 and the `corrective` series; full invoices R1, the same customer as stored, and the
  `full_corrective` series (D1; series rules unchanged, `record-correction.ts:206-211`).
- Every corrective filed after PR 1b names the latest version, a refused one included (D2; the owner's
  rule of 27 November, quoted in [the A1619 plan](2026-11-27-a1619-corrections-never-wait-for-aeat.md)
  "D1, the owner's answer").
- A corrective never corrects a corrective other than a Q37 replacement (Task 1's trigger, Task 3's
  refusal, Task 6b's admission, which answers a restatement `not_simplified` as it answers an "I"
  today).
- One rebuild of core's starting migration in flight at a time (PR 1's section lists them).

## Should this exist?

1. **The need.** The owner, 28 November: "I prefer substitutions because as a human, it's easier to
   understand, and you just have to look at the current invoice. You don't have to have all the chain
   of previous invoices together to understand what went on." (design D1; recorded in the design
   file, approved in session waitron-84). After this plan, a guest given money back gets a receipt
   showing what they paid for, and the tax agency holds the same. Still unavailable afterwards:
   splitting, cancelling or re-addressing a printed full invoice, and crediting to zero an invoice
   that already has corrections (plan 2); a full invoice for a past receipt (plan 3). **Simplest
   alternative:** change nothing; corrections by differences are legal (AEAT developer FAQ §27, design
   §6) and cost nothing. The owner chose against that. A smaller build (no new columns, everything
   worked out from the record) is weighed under decision S1 and rejected.
2. **True size.** Estimated below under *True size*: about 2,210 production and 3,410 test lines over
   PRs 0 to 4 (the table's *Expect* column), plus about 80 generated lines (core's starting migration and its snapshot) in PR 1a.
   Later changes to correctives touch one more idea (the latest version) in core and the paper.
3. **Who approved it.** D1 to D3: the owner, quoted with dates in the design's §1 table. Everything in
   *Decisions, each with a default* is this plan's, unreviewed until the watcher clears it.

## Review focus

The inputs a person will meet that no single task's happy path covers, most likely first; each has its
test in the task named.

1. **Two give-backs on one receipt, one after the other** (a guest, then the same guest again): the
   second must name the first's restatement and replace its figures, never the original's. Task 3
   (core), Task 12 (end to end).
2. **A reprint of an earlier restatement after a later one exists**: it must show that version's bill,
   not today's. Task 8a.
3. **A give-back that takes exactly what is left after a restatement**: an "I" to zero naming the
   restatement, never an "S" of zero. Task 3, Task 12.
4. **A rate that nets to zero** (a 21 % takeaway drink taken off a receipt that also holds 10 % food):
   the restated `Desglose` and the paper's VAT table leave that rate out; `ImporteRectificacion` still
   counts it. Task 6a, Task 9, PR 0 case F.
5. **The latest version AEAT refused, or holding an AEAT fix of its own** (a *subsanación*, a corrected
   resend of the same record): the restatement still names it and uses its newest figures. Task 6b.

---

## Decisions, each with a default

Each is this plan's best guess unless it quotes the owner. **A** marks one for the adviser (question
15 of `docs/compliance/2026-11-19-adviser-meeting.md`); **O** one the owner should see.

| # | Decision | Default and why |
| --- | --- | --- |
| S1 (O) | **How a restatement is marked and what it stores** | Three nullable columns on `sales`: `restates_sale_id` (the version it replaces; a foreign key to `sales`, unique, so each version is replaced at most once and the versions form one line), `restated_total` and `restated_vat_breakdown`. Not the record's `tipo_rectificativa`: a Q37 replacement is "S" too, so the record cannot tell them apart; and the paper, the tax-office list and core's checks are generic code, which must not read Veri\*Factu's tables (`scripts/module-seams.test.ts`). Storing the restated figures, not working them out along the line each time, lets the tax-office list search them in SQL and lets `refuseMovedFigures` compare like with like. Cost: core's starting migration is rebuilt and **every venue is reset** (PR 1a). |
| S2 | **The database keeps the line of versions honest** | A `sales` insert trigger refuses a restatement unless it names the target or another restatement of the same target, and refuses one once the target holds a correction by differences (core never asks for one then, by the global rule, so the trigger only catches a bug). A second trigger refuses any corrective whose corrected sale is itself a corrective other than a Q37 replacement. With the unique index, a new restatement can only name the latest version, and nothing follows a correction to zero. |
| S3 (A) | **What a correction to zero names** | The latest version, like a restatement (the owner's 27 November rule: "a correction points to the previous invoice/receipt"; the design's §2 "minus the latest version's total"). Its paper names the same version. |
| S4 (A) | **A restatement's date of operation** | The target's day of operation (its `supply_day`, else its issue day in its own offset), **stored** on the restatement's `supply_day` when earlier than its issue day (so the paper prints "Date of the sale" through `saleDayOf`, `invoice-typing.ts:63-68`, and the tax-office list's operation filter, `tax-office-list.ts:108`, finds it), and filed as `FechaOperacion` from that value: AEAT's option 1 example sets it (`procedimientos-facturacion.txt:89`), and AEAT checks a VAT rate against `FechaOperacion` when present (`val.txt:475-529`). `sales_supply_day_ck` (`sales.ts:152-155`) widens to allow it. The VAT return keeps a correction on its root's day whatever its own `supply_day` (`vat-movements.ts:125-126`, `:140-156`); the accountant sheet keeps listing a restatement on its own issue day, as it lists corrections today. PR 0 cases C and G decide: if AEAT refuses it, restatements store and send none. |
| S5 | **A rate that nets to zero** | Left out of the restated `Desglose` and the paper's VAT table; `ImporteRectificacion` sums every replaced rate. PR 0 case F checks AEAT accepts it. |
| S6 (O) | **What the corrected paper shows** | The target's lines as they now stand: a line whose whole dishes were all given back is left off; whole dishes given back from a line of several shrink it (2 chips becomes 1 chips at the same unit price, by #4560's whole-dish test); money given back that is not whole dishes (goodwill, part of a dish, a set menu's dish, or a correction line naming no invoice line) leaves the lines as sold and prints one **Reduction** / «Rebaja» row (RD 1619/2012 art. 6.1.f's «descuento o rebaja»), one per VAT rate when the paper shows rates. Then the restated total and VAT table; above them, **Fully replaces invoice** {number, date} and **Amount of the correction** −3,00 (both labels exist, `packages/country-es/src/receipt-labels.ts:42-43`). |
| S7 (O) | **Lists keep showing the change** | Find a bill, the order details, the business day, the VAT return and the accountant sheet's amounts show the change, as today: they sum money. The accountant sheet labels a restatement "Corrective receipt by substitution — amounts are the change" / «Ticket rectificativo por sustitución — importes: la diferencia» (invoice: "Corrective invoice by substitution — amounts are the change" / «Factura rectificativa por sustitución — importes: la diferencia»). **The tax-office list shows each document as filed**: a restatement's restated total and split, naming the version it replaces, and its amount and rate searches match those figures. |
| S8 | **Who decides "S" or "I"** | Core, in `recordCorrection`, for every caller: Give money back (dishes and goodwill), an advance's part give-back, and the Fiscal filing page's corrective remedy. Cancel and credit, Reopen bill and Pay for items on a printed bill pass `wholeInvoice` and stay "I" (`cancel-credit.ts:115`). |
| S9 | **Crediting to zero an invoice that already has corrections** (Cancel or Reopen after a give-back) | Refused in this plan, as today (`sale.correction_not_whole`, `record-correction.ts:494-500`). **Plan 2 builds it**: a whole credit of minus the latest version's figures, naming the latest version, for receipts and full invoices. |
| S10 | **The amount staff are told** | The give-back's answer and the till's end-screen line keep the change (−3,00), read from `sales.total` as CORRECT-FULL-INVOICE PR 4a's Task 13 and PR 5's Task 18 do. |
| S11 (A) | **A date fix after a restatement (A1619 PR 2, not built)** | The date fix replaces the refused original in Q37's shape: the original's full figures, 0.00 rectified, naming the original. The restatements already filed stay, and the next correction names the newest restatement. Worked on 9 €, refused for its date, then 3 € given back by a restatement of 6 €: the date fix adds 9 and the restatement adds 6 − 9, so the tax agency holds 6, as it should, **only if it accepted that restatement**; if it refused it too, the restatement needs its own fix. A1619 PR 2 must then start the line of versions at the original when the target is a replacement, and widen S2's triggers to match. That PR is planned separately; this plan only states the default. PR 0 case I tests the restatement of a replacement this plan does build. |
| S12 | **A version on another box** (A1614, a box that took over) | Read from its local record row like any other, as A1614 reads inherited records (`backend.ts:580-590` reads by `sale_id`, not by box). |
| S13 (O) | **A bill paid by bank transfer** | Its restatement prints the bank account as its invoice did: `deferredTenderQuery` (`receipt-deferred-payment.ts:20-35`) follows a restatement to its target as it follows a replacement. |

---

## PR 0 — AEAT's test service accepts the new shapes (verifactu repo)

**Repo:** `~/workspace/repos/verifactu` (`waitron-io/verifactu`), from `origin/main` (`be5ccf2`, which
holds lane A's `canje` mode, verifactu #158). Light review path; the owner lands it; nothing in `src/`,
no version bump. Precedents: the `replacement-after-credit` mode (`scripts/live-aeat.mjs:3374`) and
`canje` (#158's body: one installation and chain per case, the run exits 0 only when every required
record is `Correcto` and AEAT's lookup finds it once with the hash sent).

**Task 0: a `restatement-corrections` mode.**

**Files:** `scripts/live-aeat.mjs` (a builder `buildRestatementProbeRecords(options, now)` and the mode
branch beside `:3374`, submitting through `submitChainedProbe`), `scripts/live-aeat.test.mjs`,
`.github/workflows/live-aeat.yml` (the mode in `options`, `:11-39`).

The cases, each its own chain, one record per request, one 10 % rate unless named:

| Case | Records | Required |
| --- | --- | --- |
| A | F2 9.00 (8.18 + 0.82); R5 "S" restated 6.00 (5.45 + 0.55), `ImporteRectificacion` 8.18 / 0.82, naming the F2 | yes |
| B | after A: R5 "S" restated 3.00 (2.73 + 0.27), rectified 5.45 / 0.55, naming A's R5 | yes |
| C | F1 dated yesterday, 121.00 at 21 % (100.00 + 21.00), naming a customer by NIF; R1 "S" today restated 60.50 (50.00 + 10.50), rectified 100.00 / 21.00, the same `Destinatarios`, `FechaOperacion` yesterday | yes, for PR 4 only |
| D | control: F2 9.00; R5 "I" −9.00 naming it | yes |
| E | after B: R5 "I" −3.00 (−2.73 − 0.27) naming B's R5 "S" | yes |
| F | F2 with 10 % 6.00 and 21 % 3.63 (3.00 + 0.63); R5 "S" restated 6.00 at 10 % only, rectified 8.45 / 1.18 | yes (decision S5) |
| G | F2 dated yesterday; R5 "S" today with `FechaOperacion` yesterday | decides S4 for receipts |
| H | F2 dated tomorrow (AEAT refuses `1112`); R5 "S" restatement naming it | reported only (S11's question) |
| I | F2 dated tomorrow (refused `1112`); R5 "S" Q37 replacement today, 9.00, rectified 0.00, naming it; R5 "S" restatement restated 6.00, rectified 8.18 / 0.82, naming the replacement | yes (the F2 refused, both R5 `Correcto`) |

- [ ] **Step 1: failing tests** in `live-aeat.test.mjs`: the builder's records for each case, as
  values — for A's R5: `TipoFactura: "R5"`, `TipoRectificativa: "S"`, `ImporteTotal: "6.00"`,
  `Desglose` one line base `"5.45"` tax `"0.55"`, `ImporteRectificacion: { BaseRectificada: "8.18",
  CuotaRectificada: "0.82" }`, `FacturasRectificadas` naming the F2's `NumSerieFactura` and date; C's
  R1 carries `FechaOperacion`; the library's `validate` returns no error for every record; the exit
  decision (0 only when A to G and I pass as the table says; G and C's `FechaOperacion` answers are
  reported as deciding S4; H never changes it).
- [ ] **Step 2:** `node --test scripts/live-aeat.test.mjs` fails on the missing builder.
- [ ] **Step 3:** implement. If the Madrid day changes between a case's records, stop and send
  nothing more (as `canje` does).
- [ ] **Step 4:** `node --test scripts/live-aeat.test.mjs`, `npm run lint`, `npm run format:check`:
  all exit 0.
- [ ] **Step 5:** commit `-s`, PR; after the owner lands it,
  `gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=restatement-corrections`,
  and record the run id and each case's answer in this plan's header.

**Gate.** PR 3 (receipts switched on) does not land until A, B, D, E, F and I are as required; PR 4
until C is. A refusal stops the lane, which writes to the watcher with the `CodigoErrorRegistro`. G's
and C's answers set S4; H's goes to the adviser with S11. Test service only: it does not show what
production does.

---

## PR 1 — the writer can file a restatement (packages; nothing calls it)

Three pull requests, in order, each on the full review path (fiscal, migration, cross-package
contract: two Codex reviews), each leaving nothing changed for anyone. Sale-path read changed: no.
`db` and `fiscal` are mutation-tested at a floor of 90 (CLAUDE.md §2); CI runs it, and a survivor in
the new CHECKs, triggers or fake is fixed in the PR that adds it.

- **PR 1a — Tasks 1, 2, 5** (the only rebuild of core's starting migration in this plan). **First line
  of the PR: "Resets every venue: core's starting migration is rebuilt."**
- **PR 1b — Tasks 3, 4** (core files a restatement through the seam and checks filed figures).
- **PR 1c — Tasks 6a, 6b** (the Veri\*Factu record, and admission telling a restatement from a
  replacement).

**Core rebuilds in flight or planned.** Each regenerates core's starting migration and snapshot
(`pnpm --filter @waitron/server migration-baseline rebuild --set core`). Known now: lane L's
`feat/vat-rates-b5` (paused behind #4560; it also edits `packages/db/triggers/core.sql` and
`scripts/behavioural-triggers.test.ts`, as Task 1 does); CORRECT-FULL-INVOICE PR 4b
(`invoice_corrections.delivery`); plan 2's schema PRs; plan 3's PRs 1 and 2. **The rule: one core
rebuild in flight at a time; the second to land takes `main`'s copy of the generated files
(`git checkout --ours` during the rebase) and reruns the rebuild** (CLAUDE.md §3). The lane asks the
watcher which goes first before opening PR 1a.

### Task 1: the columns, the checks and the triggers

**Files:**

- Modify: `packages/db/src/schema/sales.ts` (columns after `replacesOriginal`, `:102`; constraints in
  the table's list, `:132-175`, `sales_supply_day_ck` at `:152-155`; the comments at `:90-91`,
  `:99-101` and `:103-104`)
- Modify: `packages/db/triggers/core.sql` (two triggers beside `sales_recipient_identity_insert`, `:683`)
- Modify: `packages/core/src/insert-sale.ts` (accept the three fields)
- Generated: core's starting migration and snapshot
- Test: `packages/db/src/schema/sales.test.ts` (new `describe("sales — a restatement")` beside `:877`),
  `scripts/behavioural-triggers.test.ts` (the name list, `:130-163`, and its cases)
- Docs: `docs/developers/conventions-data.md`, "A sale's correctives are summed through `correctivesOf`" (`:1302`)

**Interfaces — produces:** `sales.restatesSaleId: string | null`, `sales.restatedTotal: number |
null` (cents), `sales.restatedVatBreakdown: { rate: string; base: string; tax: string }[] | null`;
`insertSale` takes them as optional fields.

- [ ] **Step 1: failing tests** (`sales.test.ts`, each asserting the refusal's message or the row):
  - `sales_restatement_ck` refuses `restated_total` without `restates_sale_id`, a restatement with
    `replaces_original = 1`, one with no `corrects_sale_id`, one with `restated_total = 0`, and one with
    `restated_vat_breakdown` null;
  - `sales_supply_day_ck` admits `supply_day` on a restatement, still refuses it on a correction by
    differences;
  - `sales_restatement_names_latest` refuses a restatement naming a sale of another target, and one
    inserted after a correction by differences of the same target; it admits target → R1 → R2, and an
    "I" after R2;
  - `sales_corrects_an_invoice` refuses any corrective whose corrected sale is a restatement or a
    correction by differences; it admits a corrective of an ordinary sale and of a Q37 replacement;
  - `sales_one_restatement_uq` refuses a second restatement naming R1;
  - `sales_restates_fk` refuses a missing sale.
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts` — the new cases fail.
- [ ] **Step 3: implement.** Columns through `packages/db/src/schema/columns.ts` (`id`, `money`, `json`).
  `sales_restatement_ck`:
  `(restates_sale_id is null and restated_total is null and restated_vat_breakdown is null) or
  (restates_sale_id is not null and corrects_sale_id is not null and replaces_original = 0 and
  restated_total > 0 and restated_vat_breakdown is not null)`. `sales_supply_day_ck` gains
  `or restates_sale_id is not null`. The unique index is partial (`where restates_sale_id is not
  null`). `sales_restatement_names_latest`, `BEFORE INSERT … WHEN new.restates_sale_id IS NOT NULL`,
  raises unless `new.restates_sale_id = new.corrects_sale_id` or a sale with that id has
  `corrects_sale_id = new.corrects_sale_id` and a non-null `restates_sale_id`, and raises when a sale
  with `corrects_sale_id = new.corrects_sale_id`, `replaces_original = 0` and a null
  `restates_sale_id` exists. `sales_corrects_an_invoice`, `BEFORE INSERT … WHEN new.corrects_sale_id
  IS NOT NULL`, raises when the corrected sale has a non-null `corrects_sale_id` and
  `replaces_original = 0`. A test fixture that corrects a corrective describes a state no path makes:
  fix the fixture. Comments, cut to what stays true: `vat_breakdown` "The per-rate VAT split of what
  this sale moves; the filed one too, except on a restatement, which files `restated_vat_breakdown`";
  `replaces_original` names Q37's replacement (the invoice's full amounts, moving no money), not every
  "S"; `supply_day` also on a restatement. Add both trigger names to `behavioural-triggers.test.ts`'s
  list with one refusing and one admitted case each. Rebuild core's starting migration.
- [ ] **Step 4:** run, each exit 0 and a non-zero `Tests` count:
  `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts`, then from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/id-columns-are-references.test.ts`,
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- [ ] **Step 5:** conventions-data: one sentence after `:1308`: a restatement (a corrective by
  substitution that is not a Q37 replacement) stores the change in `total` and `vat_breakdown` like a
  correction by differences and is summed like one; its restated figures live in `restated_*`.
  Commit `-s`.

### Task 2: the latest version and the arithmetic (core)

**Files:**

- Modify: `packages/core/src/correction-target.ts` (add `latestVersionOf`)
- Create: `packages/core/src/restatement-figures.ts`; test `restatement-figures.test.ts`
- Create or extend: `packages/core/src/correction-target.test.ts` (plan 3 creates it too)

**Interfaces — produces:**

- `latestVersionOf(tx: Transaction, targetId: SaleId): Promise<SaleId>` — the sale no other sale's
  `restates_sale_id` names, walking from `targetId` one indexed lookup (`sales_one_restatement_uq`)
  per step; `targetId` when nothing restates it.
- `type Figures = FiledVersionFigures` (`{ total: Decimal; vatBreakdown: VatBreakdownLine[] }`,
  `packages/fiscal/src/backend.ts:64-67`), so core and the backend pass one shape.
- `restate(replaced: Figures, change: Figures): Figures` — per rate by basis points, in whole cents;
  a rate whose base and VAT both end at 0 is dropped (S5); order: `replaced`'s rates, then new ones.
- `figuresOfVersion(tx, saleId): Promise<Figures>` — a restatement's `restated_*`, else `total` and
  `vat_breakdown`.

- [ ] **Step 1: failing tests.** `restate`: 9.00 (8.18 + 0.82 at 10) with −3.00 (−2.73 − 0.27) is 6.00
  (5.45 + 0.55); F's two rates with −3.63 at 21 drops the 21 line; a change at a rate the replaced
  figures lack adds it. `latestVersionOf`: no restatement → target; target → R1 → R2 → R2; a Q37
  replacement as target with R1 under it → R1. `figuresOfVersion` of R1 reads its restated columns.
- [ ] **Step 2:** `pnpm --filter @waitron/core exec vitest run src/restatement-figures.test.ts src/correction-target.test.ts` fails.
- [ ] **Step 3:** implement with `decimalToCents` / `centsToDecimal` (CLAUDE.md §3, money).
- [ ] **Step 4:** the same command passes. **Step 5:** commit.

### Task 3: `recordCorrection` files a restatement when asked (core)

**Files:** `packages/core/src/record-correction.ts` (input `:63-118`, the target read `:172-197`, the
remaining check `:252-264`, the insert `:358-387`, the backend call `:405-421`); test
`packages/core/src/record-correction.test.ts`; `scripts/corrective-sums.test.ts` (its
`record-correction.ts` entries' counts and reasons).

**Interfaces — consumes:** Task 2. **Produces:**

- `RecordCorrectionInput.byRestatement?: true` — a temporary seam until PR 3, which deletes it and lets
  core decide. A plain `Error` (no route can send it) beside `wholeInvoice`, or when the restated total
  would not be above zero. When the target already holds a correction by differences the seam is
  ignored and the correction files "I" (the global rule).
- The backend call's second argument gains `rectifiesSaleId: SaleId` (always: the latest version) and,
  for a restatement, `restatement: { replaced: Figures; restated: Figures }` and `operationDate`, the
  value stored in `supply_day` (S4; the same pairing as `record-replacement.ts:171,229`).

- [ ] **Step 1: failing tests** against the fake backend (`packages/fiscal/src/testing/fake-backend.ts`):
  - 9.00 receipt, `byRestatement` −3.00: the row stores `total` −300, `vat_breakdown` the change,
    `restates_sale_id` the receipt, `restated_total` 600 and the restated split; the backend saw
    `rectifiesSaleId` the receipt and `replaced` 9.00;
  - a second, −3.00: it names the first restatement, `replaced` 6.00, `restated` 3.00;
  - then the rest without the seam: an "I" of −3.00 naming the second restatement, no restated
    columns;
  - a receipt holding an "I" of −1.00, then `byRestatement` −3.00: files "I", no restated columns, no
    refusal;
  - a receipt issued yesterday: the restatement's `supply_day` is that day and the backend saw it as
    `operationDate`; issued today: `supply_day` null, no `operationDate`;
  - a correction whose `correctsSaleId` is a restatement refuses `sale.correction_not_admitted`
    with `reason: "not_simplified"` before a number is taken, the answer Task 6b's admission gives and
    the one an "I" already gets (`correction-admission.ts:49-51`);
  - `byRestatement` taking everything left throws; beside `wholeInvoice` throws; nothing is written
    and no number is taken;
  - a target whose correctives' sum disagrees with `figuresOfVersion(latest)` refuses
    `sale.correction_history_unusable`;
  - every existing case in the file passes unedited, except one that pins the backend's second
    argument exactly, which gains `rectifiesSaleId` equal to the target.
- [ ] **Step 2:** `pnpm --filter @waitron/core exec vitest run src/record-correction.test.ts` fails.
- [ ] **Step 3: implement.** After `correctionTargetFor`, refuse a target that is a corrective other
  than a replacement (its `correctsSaleId` and `replacesOriginal`, already read at `:183-184`) with
  `not_simplified`. Before
  the number is taken: `latest = latestVersionOf(tx, correctsSaleId)`; with the seam and no "I" on the
  target, `replaced = figuresOfVersion(tx, latest)`, checked against the target's stored figures plus
  every corrective of it (the `remaining` sum `:252-255`, and per rate the same rows'
  `vat_breakdown`); `restated = restate(replaced, change)`. Store the three columns and `supply_day`;
  call the backend as above. Update the guard's allowlist for any new `eq(sales.correctsSaleId, …)`
  line, reason "the correction target's own corrections, checked against the latest version's
  figures".
- [ ] **Step 4:** the core command, then `pnpm exec vitest run scripts/corrective-sums.test.ts`: pass.
  **Step 5:** commit.

### Task 4: the filed-figures check reads restated figures (core)

**Files:** `packages/core/src/correction-history.ts` (`readStored` `:232-253`, `refuseMovedFigures`
`:259-289`); test `packages/core/src/correction-history.test.ts`.

- [ ] **Step 1: failing test:** after one restatement filed through the fake backend, a preview of a
  further correction is admitted (today it would refuse `filed_figures_changed`, comparing the stored
  −3.00 with the filed 6.00); a restatement whose filed figures the fake reports as 5.00 refuses
  `filed_figures_changed`.
- [ ] **Step 2:** run `pnpm --filter @waitron/core exec vitest run src/correction-history.test.ts`; it fails.
- [ ] **Step 3:** `readStored` also selects `restatesSaleId`, `restatedTotal`, `restatedVatBreakdown`;
  `refuseMovedFigures` compares a restatement's restated figures, any other sale's stored ones.
- [ ] **Step 4:** pass. **Step 5:** commit. **PR 1b leaves:** nothing changes for anyone.

### Task 5: the backend contract and the fake

**Files:** `packages/fiscal/src/backend.ts` (`recordCorrection`'s doc and argument, `:495-507`),
`packages/fiscal/src/testing/fake-backend.ts` (`:217`, and its `filedFiguresFor` / `filedReceiptFor`
answering a restatement's restated figures), `packages/fiscal-none/src/backend.ts:72` (unchanged
body; type only). Tests: `packages/fiscal/src/testing/fake-backend.test.ts`.

**Produces:** `recordCorrection(tx, sale, correction: { correctsSaleId: SaleId; rectifiesSaleId?:
SaleId; replaces?: true; operationDate?: string; restatement?: { replaced: FiledVersionFigures;
restated: FiledVersionFigures } })`. Doc: `sale` always carries the change; with `restatement` the
record files `restated` and names `rectifiesSaleId` (absent: `correctsSaleId`); `operationDate` is read
with `replaces` or `restatement`; `replaces` beside `restatement` is refused.

- [ ] Steps: failing fake test (a restatement's filed figures are its restated ones) → run
  `pnpm --filter @waitron/fiscal exec vitest run` → implement → pass → commit. **PR 1a leaves:**
  nothing changes for anyone; every venue reset.

*(Task 5 is listed here for its contract but builds in PR 1a, before Task 3.)*

### Task 6a: the restatement's record fields (pure)

**Files:** Create `packages/fiscal-verifactu/src/restatement-record.ts` (`backend.ts` is 957 of 1,000
lines) and `restatement-record.test.ts`; modify `packages/fiscal-verifactu/src/registro-row.ts`
(`operationDateRefused`, `:143-148`) and `registro-row.roundtrip.test.ts`.

**Produces:** `restatementFields(restatement: { replaced; restated }, change: FiledVersionFigures):
Pick<AltaInput, "TipoRectificativa" | "Desglose" | "CuotaTotal" | "ImporteTotal" |
"ImporteRectificacion">`, refusing `fiscal.correction_unsupported` with a new param `reason:
"restated_figures_invalid"` unless `restated = restate(replaced, change)` rate by rate, its total is
above zero and no restated base or VAT is negative.

- [ ] **Step 1: failing tests:** A's figures give `TipoRectificativa: "S"`, `Desglose` 5.45 / 0.55,
  `ImporteTotal` "6.00", `CuotaTotal` "0.55", `ImporteRectificacion` 8.18 / 0.82; F's two rates give
  one `DetalleDesglose` and 8.45 / 1.18; a restated total of 0.00, a negative restated rate, and a
  restated split that is not `replaced` plus the change each refuse; `registro-row` admits
  `FechaOperacion` on an R1 "S" (today it refuses everything but F1, F2 and R4/R5 "S"), still refuses
  it on an R1 "I", and a non-zero `ImporteRectificacion` round-trips.
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/restatement-record.test.ts src/registro-row.roundtrip.test.ts` fails.
- [ ] **Step 3:** implement; `ImporteRectificacion`'s two values are `sumDecimals` of the replaced bases
  and of the replaced VAT. `operationDateRefused` allows any R1–R5 with "S". Register the `reason`
  values in `packages/fiscal-verifactu/src/errors.ts`.
- [ ] **Step 4:** pass. **Step 5:** commit.

### Task 6b: the backend files it, and admission tells a restatement from a replacement

**Files:** `packages/fiscal-verifactu/src/backend.ts` (`recordCorrection`, `:567-691`; its record read
`:580-590`), `correction-record-type.ts` (`:8-26`), `correction-admission.ts` (`:44-51`). Tests:
`backend.test.ts`, `correction-record-type.test.ts`, `correction-admission.test.ts`,
`correction-amount.huella.test.ts`, `record-remedy-facts.test.ts`, `record-remedy-corrective.test.ts`.

Today both readers take `tipo_rectificativa === "S"` to mean a Q37 replacement
(`correction-record-type.ts:12`, `correction-admission.ts:46`), so after PR 3 a restatement's R5 "S"
would be admitted as an invoice to correct, reachable through the Fiscal filing page's corrective
remedy (`record-remedy-corrective.ts:159-161`, where `correctionTargetFor` returns a restatement
unchanged), and its corrective would hang from a corrective that `correctivesOf` never counts. Both
readers therefore read the record's sale's `replaces_original` (one join on `sales.id = sale_id`) and
treat an "S" record as a replacement only when it is set: `correctionRecordType(original: {
tipo_factura; tipo_rectificativa; replacement: boolean }, namesCustomer)` returns R1 or R5 for an R4 or
R5 "S" only when `replacement`, and the admission's `byReplacement` (`:46`) becomes
`tipoRectificativa === "S" && replacement`. A restatement then falls through to today's `{ eligible:
false, reason: "not_simplified" }` (`:49-51`), the answer an "I" corrective already gets. Records of
"I" correctives keep that answer; nothing moves to another reason. (Plan 2 adds a `reason` to
`correctionRecordType`; whichever plan lands second merges both into one signature.)

- [ ] **Step 1: failing tests:**
  - F2 9.00, then a restatement: the record is R5 "S" with Task 6a's fields, `FacturasRectificadas` the
    F2's number and date; `validate` from `@waitron/verifactu` returns no errors;
  - the second names the first restatement's record (its own `NumSerieFactura`), rectified 5.45 /
    0.55; an "I" after it names the second;
  - F1 → R1 "S" with the F1's stored `Destinatarios` (copied as at `backend.ts:654-656`) and a
    `FechaOperacion` when the F1 was issued on another day;
  - `FechaOperacion` absent when `operationDate` is the same day;
  - the named version refused by AEAT (submission `rechazado`) is still named, its figures used; one
    with a subsanación is named by its newest version (the query at `:580-590`) with that version's
    figures;
  - `replaced` differing from the named version's newest filed figures (`filedFiguresFor`) refuses
    `fiscal.correction_unsupported` with `reason: "replaced_figures_differ"`, nothing appended;
  - admission of a restatement's sale answers `not_simplified`; of a Q37 replacement's, eligible as
    today; of an "I" corrective's, `not_simplified` as today (pinned unedited);
    `correctionRecordType` of an R5 "S" record returns R5 only with `replacement: true`;
  - the corrective remedy on a restatement's filing case refuses before anything is written;
  - Q37 unchanged: `backend.test.ts:903-927` passes unedited;
  - `correction-amount.huella.test.ts`: a restatement is filed at its row's `restated_*`, a correction
    by differences at its `total` and `vat_breakdown`;
  - a description fix (subsanación) of an R5 "S" restatement keeps its `Desglose` and
    `ImporteRectificacion` (`record-remedy-http.ts:51-62` compares them).
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backend.test.ts src/correction-record-type.test.ts src/correction-admission.test.ts src/correction-amount.huella.test.ts src/record-remedy-facts.test.ts src/record-remedy-corrective.test.ts` fails.
- [ ] **Step 3: implement.** In `recordCorrection`, read the target's record as today (type,
  `Destinatarios`) and the named version's (`rectifiesSaleId ?? correctsSaleId`) for
  `FacturasRectificadas`; with `restatement`, read the named version's newest figures through
  `filedFiguresFor` and compare, then spread `restatementFields`; `FechaOperacion` through
  `fechaOperacionFor` (`backend.ts:133-141`). Register `replaced_figures_differ` beside Task 6a's
  reason.
- [ ] **Step 4:** the command passes; then
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] **Step 5:** commit. **PR 1c leaves:** nothing changes for anyone; the writer can file a
  restatement end to end.

---

## PR 2 — the paper and the lists show a restatement (receipts; still nothing calls it)

After PR 1c. #4560 is on `main` (`9eae032090`): Task 8a reuses its whole-dish test (`wholeDishesOf`,
`apps/server/src/corrective-lines-in-part.ts:19`, private today, exported here). Sale-path read
changed: no (`readInvoiceTyping` returns before any new read for a sale that corrects nothing,
`invoice-typing.ts:78`). Three pull requests, in order, each leaving nothing changed for anyone:

- **PR 2a — Tasks 7, 8a, 8b** (what a corrective names; the corrected bill's lines). Light path.
- **PR 2b — Tasks 9, 11** (the roll paper, and looking at it). Light path.
- **PR 2c — Task 10** (the tax-office list is a filing record, and the accountant sheet). Full path.

### Task 7: what a corrective names, and the amount printed

**Files:** `packages/orders-sales/src/invoice-typing.ts` (`TypedSale` `:7-20`, `corrects` `:23-30`,
`readInvoiceTyping` `:73-105`), `packages/orders-sales/src/receipt-facts.ts` (`:191`, `:585`),
`packages/orders-sales/src/receipt-issuer.ts` (its select `:27-39`),
`apps/server/src/transaction-receipt-api.ts:325`, `apps/till/src/api/payments-api.ts:207-212` (the
mirrored type). Tests: `packages/orders-sales/src/receipt-issuer.test.ts` (where `readInvoiceTyping`
is tested), `apps/server/src/receipt-issuer.test.ts`, `apps/server/src/transaction-receipt-api.test.ts`.

**Produces:** `corrects: { invoiceNumber; issuedAt; issuedOffsetMinutes?; inFull?: true;
rectificationAmount?: string; replacement?: true }`. A restatement: names `restates_sale_id`,
`inFull`, `rectificationAmount` its change ("-3.00"), and `saleDay` from its `supply_day`
(`saleDayOf`, `:63-68`). A Q37 replacement: names `corrects_sale_id`, `inFull`,
`rectificationAmount` "0.00", `replacement`. A correction by differences: names
`latestVersionOf(corrects_sale_id)` (S3).

- [ ] **Step 1: failing tests:** each of the three shapes above, from rows filed through
  `recordCorrection` (`byRestatement` for the first, one of a receipt issued yesterday printing its
  sale date); the reprint route's "first print is its original" branch (`:325`) runs for a Q37
  replacement and not for a restatement.
- [ ] **Step 2:** `pnpm --filter @waitron/orders-sales exec vitest run src/receipt-issuer.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/receipt-issuer.test.ts src/transaction-receipt-api.test.ts` fail.
- [ ] **Step 3:** implement; `:325` tests `ticket.corrects?.replacement === true`.
- [ ] **Step 4:** pass. **Step 5:** commit.

### Task 8a: the corrected bill's lines (reader)

**Files:** Create `apps/server/src/restated-invoice.ts` and `restated-invoice.test.ts`.

**Interfaces — produces:** `readRestatedInvoice(tx, sale): Promise<RestatedInvoice | null>`, null unless
`sale.restatesSaleId` is set; `RestatedInvoice = { rows: SaleLineRow[]; reductions: { rate: Decimal;
gross: Decimal }[]; total: Decimal; vatBreakdown: VatBreakdownLine[] }`. It walks back from the sale
through `restates_sale_id` to its target, so a reprint of R1 counts R1 and the versions before it,
never later ones.

Per target row (dishes and extras; deduction rows as stored): `taken` is minus the sum of the chain's
rows naming it in `corrects_line_id`. `taken = 0`: the row as sold. `taken` is the whole row: left off.
`taken` is whole dishes of a counted row (#4560's test): the row with that many fewer dishes and its
amounts scaled. Otherwise the row as sold, and `taken` added to its rate's reduction. A chain row
naming no invoice line (allowed without `partialVatBreakdown`, `record-correction.ts:140-142`) adds its
gross to its rate's reduction. Then `sum(rows' gross) − sum(reductions) = restated_total` or it throws
`sale.correction_history_unusable`.

- [ ] **Step 1: failing tests**, one table over rows filed through `recordCorrection` with the seam:
  beer taken off 1 beer + 2 chips (2 chips, 6.00); then one chips (1 chips, 3.00); a reprint of the
  first after the second (still 2 chips, 6.00); goodwill 2.00 of 9.00 (both lines as sold, one
  reduction −2.00, total 7.00); goodwill over two rates (one reduction per rate); a correction line
  naming no invoice line (its amount in its rate's reduction, the sum check passing); a dish's extra
  whose dish was given back (left off with it); a divided set menu's dish (a reduction); a free item
  never given back (kept at 0.00); a stored row that breaks the sum check throws.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/restated-invoice.test.ts` fails.
- [ ] **Step 3:** implement. **Step 4:** pass. **Step 5:** commit.

### Task 8b: the receipt reads the corrected bill, and a transfer's bank account

**Files:** `apps/server/src/transaction-receipt.ts` (`readTransactionReceipt`, `:136-267`: rows
`:149-151`, `markGivenBackInPart` `:198-212`, `total`/`vatBreakdown` `:255-256`),
`apps/server/src/receipt-deferred-payment.ts` (`deferredTenderQuery`, `:20-35`). Tests: the
`readTransactionReceipt` cases in `restated-invoice.test.ts` (there is no `transaction-receipt.test.ts`),
the existing tests of `receipt-deferred-payment.ts`.

- [ ] **Step 1: failing tests:** `readTransactionReceipt` of a restatement answers Task 8a's rows,
  reductions, restated total and split; of a correction by differences its own rows as today
  (`receipt-document.given-back-in-part.test.ts` unedited); `deferredTenderQuery` of a restatement of a
  sale paid by transfer finds the transfer (S13).
- [ ] **Step 2:** run those files; they fail.
- [ ] **Step 3:** use the reader when it answers; `TillSaleResult` gains `reductions`. In
  `deferredTenderQuery`'s recursive part, a third branch follows `s.corrects_sale_id` from a sale with
  a non-null `restates_sale_id`.
- [ ] **Step 4:** pass. **Step 5:** commit. **PR 2a leaves:** nothing changes for anyone.

### Task 9: the roll paper

**Files:** `apps/server/src/receipt-document.ts` (`:166-183`; a reduction prints as the existing
discount row does, `:200-202`), `packages/country/src/country.ts` (the label keys, `:106-107`),
`packages/country-es/src/receipt-labels.ts` (a `reduction` label in each of its five languages),
`packages/orders-sales/src/receipt-facts.ts` (a reduction row). Tests:
`apps/server/src/receipt-document.test.ts`, the labels' completeness test.

Labels: en "Reduction", es «Rebaja», ca «Rebaixa», gl «Rebaixa», eu «Beherapena» (Spanish from RD
1619/2012 art. 6.1.f; the other three for a language reviewer to confirm before go-live, as the
existing labels were).

- [ ] **Step 1: failing tests**, 58 mm and 80 mm: a restatement prints **Fully replaces invoice** and
  the named version's number and date, **Amount of the correction** −3,00, the restated lines, total and
  VAT table, and no 0,00; a reduction row above the total; a VAT table with no 0,00 line (S5); a Q37
  replacement still prints 0,00 (`:182`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/receipt-document.test.ts` fails.
- [ ] **Step 3:** print `corrects.rectificationAmount` where `:182` prints "0.00".
- [ ] **Step 4:** pass. **Step 5:** commit.

### Task 10: the tax-office list and the accountant sheet

**Files:** `apps/server/src/tax-office-list.ts` (the select `:128`, the filters `:103-106`, the
`corrects` join), `apps/server/src/tax-office-export.ts`, `apps/server/src/accountant-export.ts`
(`periodDay` `:497-509`, `invoiceType` `:596-605`), `apps/server/src/i18n/accountant-export.ts`
(`:52-57`, `:167-172`). Tests: `tax-office-list.kinds.e2e.test.ts`, `tax-office-export.test.ts`,
`accountant-export.test.ts`.

- [ ] **Step 1: failing tests:** a restatement's tax-office row is R5 with total 6.00, its restated
  split and `corrects` the version it names; the amount search finds it by 6.00 and by 5.45, not by
  −3.00; a restatement of yesterday's receipt matches an operation filter on yesterday; a correction by
  differences is listed as today. The accountant sheet lists the restatement's change, −3.00, as kind
  `restatement`, with S7's words in English and Spanish, under its own issue day even when its
  `supply_day` is earlier; a Q37 replacement keeps "do not add".
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/tax-office-list.kinds.e2e.test.ts src/tax-office-export.test.ts src/accountant-export.test.ts`; fails.
- [ ] **Step 3:** the list reads `coalesce(s.restated_total, s.total)` and
  `coalesce(s.restated_vat_breakdown, s.vat_breakdown)` in the select and both filters, and names
  `coalesce(s.restates_sale_id, s.corrects_sale_id)`'s number (for a correction by differences after a
  restatement, S3's latest version, read in JS for the page's rows). The accountant sheet's
  `periodDay` passes a null `supplyDay` for a restatement; its `invoiceType` gains `"restatement"`
  before `"corrective"` (the local `substitution` at `:530`, `:600` stays the F3's). If the list's
  join line moves, update its `scripts/corrective-sums.test.ts` entry (`:43-47`).
- [ ] **Step 4:** pass, and `pnpm exec vitest run scripts/corrective-sums.test.ts`. **Step 5:** commit.
  **PR 2c leaves:** nothing changes for anyone; the lists are ready.

### Task 11: look at the paper

`apps/server/scripts/receipt-look.ts` renders fixtures to PNGs (`:1`); a string-asserted page has
nothing checking that it renders (CLAUDE.md §4).

- [ ] **Step 1:** add fixtures copied from what Task 8b's cases read (print each `TillSaleResult` once,
  `--reporter=default`): beer taken off; then one chips; goodwill 2.00; two rates with a reduction; a
  receipt from yesterday (its sale date); the Q37 replacement unchanged. Each at 58 mm and 80 mm,
  `es-ES` and `en-GB`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts "$(mktemp -d)"`, then
  open every PNG with the Read tool and check against the design's §2 table: the lines, the total, the
  named version, −3,00, no stray 0,00, nothing cut or overlapping.
- [ ] **Step 3:** commit the fixtures only (pictures are never committed). **PR 2b leaves:** nothing
  changes for anyone; the paper is ready.

---

## PR 3 — receipts are corrected by substitution

Waits for PR 0's gate and PRs 2a–2c. Full path: two Codex reviews. The PR names the AEAT run. Sale-path
read changed: no.

### Task 12: core decides

**Files:** `packages/core/src/record-correction.ts` (delete `byRestatement`; the rule); tests: every
"I" pin the change moves — `packages/fiscal-verifactu/src/correction-path.e2e.test.ts:205`,
`correction-form.test.ts:135,193` (exact XML), `apps/server/src/give-back.test.ts`, the
`byRestatement` uses from PRs 1b to 2c (the seam's lines go; the expectations stay). Unchanged and
passing unedited: `rectificativa-columns.test.ts` (inserts its own records),
`give-back-full-invoice.test.ts`, `testing/full-invoice-give-back.ts`, `backend.test.ts:1207` (a
full invoice's R1 "I").

The rule: a restatement when the invoice names nobody (`!fullInvoice`), it is not `wholeInvoice`, the
target holds no correction by differences, and the restated total is above zero; otherwise by
differences. Every caller is unchanged (S8).

- [ ] **Step 1: failing end-to-end tests** (`apps/server/src/give-back-restatement.e2e.test.ts`), one
  case per caller whose answer differs (the restatement-then-restatement-then-"I" sequence is Task 3's,
  in core, and is not repeated here): Give money back by dish on a 9.00 receipt, 3.00, files R5 "S"
  naming the receipt; goodwill on an untouched receipt is "S"; everything at once is "I" naming the
  receipt; Cancel and credit and Reopen bill are "I"; an advance given back in part is "S"; the Fiscal
  filing page's corrective remedy for part of a receipt is "S". A receipt already holding an "I" is
  **seeded directly**: its partial "I" written through `VerifactuBackend.recordCorrection` with no
  `restatement` and its `sales` and `sale_lines` rows through the test fixtures, as a correction filed
  before PR 3 would be; a give-back on it files "I". Then: two presses one after the other from two
  tills name the versions in order; the VAT return holds each change on the receipt's day
  (`packages/reporting/src/vat-movements.ts`, unchanged); the payment-coverage trigger still settles
  (`core.sql:118-130`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/give-back-restatement.e2e.test.ts` fails.
- [ ] **Step 3:** implement; update the pins listed.
- [ ] **Step 4:** the new file, `pnpm --filter @waitron/core exec vitest run`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/correction-path.e2e.test.ts src/correction-form.test.ts src/write-path.e2e.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/give-back.test.ts src/cancel-credit.test.ts`.
- [ ] **Step 5:** commit.

### Task 13: words and records

- [ ] The till guide's give-back section (`apps/server/src/guide/en/table-service.md:448-449` and its
  Spanish twin): after "A corrective receipt or invoice that does not print by itself can be printed
  from **Find a bill**.", one sentence:
  "A corrective receipt shows the bill as it stands now and how much was given back." / «Un ticket
  rectificativo muestra la cuenta tal como queda y cuánto se ha devuelto.» Run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] `docs/backlog.md:1833` (Q31's row): "`recordCorrection` files by substitution ("S") when the
  invoice stays above zero, by differences ("I") to zero (2026-11-28 design, D1–D3)".
- [ ] `docs/backlog/fiscal.md:286` (the design's 2026-11-28 note under A231: "planned, not built… Today's
  code still corrects by differences") becomes "built for receipts (PR 3); full invoices follow".
- [ ] `docs/compliance/2026-11-19-adviser-meeting.md` question 15, both parts: add S3, S4 (with PR 0
  cases C and G's answers) and S11, one line each, as best guesses.
- [ ] CLAUDE.md: no line becomes false. The `correctivesOf` rule ("leaves a replacement out and takes
  in its refunds") still holds, since a restatement is summed as a change; checked lines: §3 Data
  `correctivesOf`, the free-item/set-menu line, the money-columns line.
- [ ] Commit. **PR 3 leaves:** every receipt correction that leaves something to pay is a restatement.

---

## PR 4 — full invoices are corrected by substitution

Waits for PR 3, CORRECT-FULL-INVOICE PR 4b and PR 5 on `main`, and PR 0 case C accepted. What those change
that this touches: PR 4b rebuilds core's starting migration (`invoice_corrections.delivery`) and gives
a corrective email and try-again in `transaction-receipt-api.ts`; PR 5 adds the till's end-screen line,
whose −{amount} is the corrective's `sales.total` (the change, S10), and a past R1's delivery block in
Find a bill. #4560's `deliversAsFullInvoice` (`packages/orders-sales/src/invoice-selection.ts`, on `main`
since `9eae032090`) admits any corrective that is not a replacement, so a restatement goes out unchanged; Task 14
pins it. Do not edit their branches. Full path. PR 4 resets nothing: an F1 already holding an R1 "I"
keeps taking "I" by the global rule.

### Task 14: the rule, the A4 page and delivery

**Files:** `packages/core/src/record-correction.ts` (drop `!fullInvoice`), `apps/server/src/invoice-document.ts`
(restated rows through Task 8a's reader, as `transaction-receipt.ts` does), `apps/server/src/invoice-layout.ts`
(`:274-284`: the heading and `corrects.rectificationAmount`; reduction rows). Tests:
`apps/server/src/give-back-full-invoice.test.ts` (its R1 "I" expectations become "S" where the invoice
stays above zero and holds no "I"), `apps/server/src/testing/full-invoice-give-back.ts`,
`invoice-layout.test.ts`, the delivery tests #4560 and PR 4b added, the existing tests of
`receipt-deferred-payment.ts`.

- [ ] **Step 1: failing tests:** goodwill on an F1 files R1 "S" in `full_corrective`, the stored
  customer, naming the F1; a second names the first; the rest is R1 "I"; an F1 issued yesterday gives
  its R1 "S" a sale date and `FechaOperacion`; an F1 already holding an R1 "I" takes "I"; the A4 page
  prints the restated lines, the customer, **Fully replaces invoice**, **Amount of the correction**;
  an F1 paid by transfer prints its bank account on the R1 "S" (S13); it is emailed or printed as the
  original went (PR 4a/4b's paths); the give-back's answer and the end-screen line carry the change.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/give-back-full-invoice.test.ts src/invoice-layout.test.ts` fails.
- [ ] **Step 3:** implement. **Step 4:** pass, plus the delivery tests. **Step 5:** commit.

### Task 15: look and records

- [ ] receipt-look fixtures for an R1 "S" on A4 and both rolls, `es-ES` and `en-GB`, one with a bank
  transfer; render to a `mktemp -d` folder; open every PNG with Read; commit fixtures only.
- [ ] `docs/backlog/fiscal.md:309` ("Refund on an F1 files an R1 by differences") and the design's
  2026-11-28 note there: now by substitution when above zero. `docs/backlog.md:1143` (A1407): "A full
  invoice that already holds a corrective (an R1)…". A dated pointer at §3 ("By differences") of
  `docs/superpowers/specs/2026-11-25-correct-full-invoice-design.md` naming this plan.
- [ ] Commit. **PR 4 leaves:** D1–D3 done.

---

## What this plan does not do

- Split, cancel or re-address a printed full invoice, and credit to zero an invoice that already has
  corrections (plan 2, S9); a full invoice for a past receipt, and removing the F3 code (plan 3).
- A1619 PR 2's date fix after a refund (S11 states only the default it should take).
- Change Find a bill's, the order details', the business day's or the VAT return's figures (S7).

## True size

Production, then tests, by file; expected at about three times production and twice tests, as
CORRECT-FULL-INVOICE's PRs came out (its plan, *True size*).

| PR | Tasks | By file (production / test) | Expect | Generated |
| --- | --- | --- | --- | --- |
| 0 | 0 | 200 / 250 (verifactu repo) | 330 / 450 | none |
| 1a | 1, 2, 5 | 90 / 220 | 270 / 420 | core's starting migration and snapshot, about 80 lines |
| 1b | 3, 4 | 80 / 180 | 240 / 350 | none |
| 1c | 6a, 6b | 100 / 200 | 290 / 380 | none |
| 2a | 7, 8a, 8b | 160 / 280 | 430 / 540 | none |
| 2b | 9, 11 | 60 / 120 | 160 / 230 | none |
| 2c | 10 | 60 / 120 | 160 / 230 | none |
| 3 | 12–13 | 40 / 200 | 80 / 360 | none |
| 4 | 14–15 | 90 / 220 | 250 / 450 | none |
| **All** | | **880 / 1,790** | **2,210 / 3,410** | about 80 lines, one reset |

Tasks are sized for 50 to 80 implementer calls; one that passes 60 unfinished is split. Order: PR 0
and PR 1a now, in parallel (PR 1a only when no other core rebuild is in flight); then 1b, 1c, 2a, 2b,
2c; PR 3 after PR 0's gate and 2c; PR 4 after PR 3, CORRECT-FULL-INVOICE PR 4b and PR 5, and case C. Each leaves
`main` green and working as its "leaves" line says.
