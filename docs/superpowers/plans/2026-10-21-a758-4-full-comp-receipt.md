# A758-4 — A full comp prints "Descuento 100%": implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** A printed receipt is a simplified invoice, the companion of a filed fiscal
record, so this touches a fiscal invariant's neighbourhood even though no filed field changes.
Each code task (1 to 4) gets a per-task reviewer; Tasks 5 and 6 (docs, looking) do not. The plan is
reviewed once against the design before any implementer starts, and `/finish-branch` runs its full
wave, the Codex run-it seat as two reviews side by side. **No task changes who may do what, a
migration, the chain, invoice numbering or anything `recordSale` reads.**

Implementers are dispatched as `subagent_type: "implementer"`. An implementer that passes about 150
tool calls with its task unfinished stops at a passing or cleanly failing point, commits, and hands
over: what is done, what is left, the files, and each check's state.

**Goal:** wherever a receipt prints «Invitación» today, a full comp prints the language's own
discount word with "100%" («Descuento 100%», «Descompte 100%», «Desconto 100%», «Deskontua 100%»),
and an amount comp that took the item's whole list price joins it. The `comp` receipt label goes.
A test filed before any change shows that a full comp's filed record is the same afterwards.

**Architecture:** one pure rule, `isFullComp`, in `packages/adjustments` decides what counts as a
full comp; the reader of a bill's adjustments marks each row with it, and the report screen (built
by A758-3) uses the same rule in place of its own copy. The server keeps sending a receipt entry of
`kind: "comp"`, which now means "a full comp" and covers a whole-list-price amount too. The two
renderers — the server's receipt document (printed tickets, full invoices, invoice pages) and the
till's on-screen ticket — print that kind as the discount word with "100%", through the code that
already prints a percentage. Then the `comp` label key is deleted from the country contract and
from Spain's four label sets.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Lit (the till's ticket view), Vitest (`node`
projects; the till and the adjustments dashboard in real headless Chromium).

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` — D11 (`:64`), §3.4
"What the receipt prints" (`:333-343`), §8 "Does the receipt's wording reach a filed record?"
(`:980-994`), §9.1 "Changed test checks" (`:1042-1079`). Parent plan and the outline this plan
replaces: `docs/superpowers/plans/2026-10-19-a758-reason-rules.md`, "# A758-4" (`:1096-1122`), its
"Global constraints" (`:130-209`) and Open point 3 (`:1167-1169`). Backlog: `docs/backlog.md` "A758"
(`:2194-2231`) and "A911" (`:2318-2320`), `docs/backlog/till.md` "## A758" (`:1472-1569`).

Every `file:line` below was read on 2026-10-21 in this worktree at `main` `c7b301702` with
`sed -n`/`grep -n`, unless it names a command that was run. A773-1 (#1897), A758-1 (#1906), A758-2
(#1909) and A758-3 (#1937) are all in that history.

---

## The files

| File | Tasks |
|---|---|
| `apps/server/src/full-comp.fiscal-identity.test.ts` (new) | 1 |
| `apps/server/src/testing/adjustment-venue.ts` (`provisionAdjustmentVenue`, `:300-302`) | 1 |
| `packages/adjustments/src/full-comp.ts` (new), `full-comp.test.ts` (new) | 2 |
| `packages/adjustments/src/record.ts` (`BillAdjustment` `:188-196`, `readBillAdjustments` `:198-224`) | 2 |
| `packages/adjustments/src/record.test.ts` (`readBillAdjustments` cases `:620-718`) | 2 |
| `packages/adjustments/src/dashboard/adjustment-report-screen.ts` (`:116-134`) | 2 |
| `apps/server/src/receipt-adjustments.ts` (`:94-98`) | 3 |
| `apps/server/src/receipt-document.ts` (`adjustmentLabel` `:95-108`, `discountRow` `:290-299`) | 3 |
| `apps/server/src/till-sale.ts` (`ReceiptAdjustment` `:264-271`) | 3 |
| `apps/server/src/receipt-ticket.test.ts`, `receipt-document.test.ts`, `receipt-figures.test.ts`, `receipt-adjustments.test.ts`, `adjustments-apply.test.ts`, `adjustments-bill-payments.test.ts` | 3 |
| `apps/server/scripts/receipt-look.ts` (look-only samples) | 3, 6 |
| `apps/till/src/screens/till-ticket-view.ts` (`adjustmentLabel` `:109-123`) | 4 |
| `apps/till/src/api/client.ts` (`ReceiptAdjustment` `:1032-1038`) | 4 |
| `apps/till/src/screens/till-ticket-view.test.ts` | 4 |
| `packages/country/src/country.ts` (`RECEIPT_LABEL_KEYS`, `"comp"` at `:74`) | 4 |
| `packages/country-es/src/receipt-labels.ts` (`comp:` at `:25`, `:65`, `:105`, `:145`) | 4 |
| `docs/backlog.md`, `docs/backlog/till.md`, `docs/compliance/asesor-questions.md` | 5 |

**Every reader of the `comp` label and of the receipt entry's `kind`**, found with
`git grep -nE "\.comp([^a-zA-Z]|$)" -- apps packages`, `git grep -n "ReceiptAdjustment\|billAdjustments" -- apps packages`
and `git grep -n "receiptLabels\|ReceiptLabels\|RECEIPT_LABEL_KEYS" -- apps packages scripts`:

- **Who writes `kind`:** `receiptLines` (`apps/server/src/receipt-adjustments.ts:95`, from each
  stored row) and its fallback `perDish` (`:200-201`, "comp" when every changed row of a dish now
  costs nothing, which is a full comp already). The look script's fixtures
  (`apps/server/scripts/receipt-look.ts:270`, `:339`, `:418`) and test fixtures write it by hand.
- **Who reads `kind`:** `adjustmentLabel` in `apps/server/src/receipt-document.ts:100` (every
  simplified ticket line, every bill-foot line, and a full invoice row named by one entry) and its
  twin in `apps/till/src/screens/till-ticket-view.ts:116`. `invoiceDiscounts`
  (`apps/server/src/receipt-figures.ts:80-133`) only passes an entry through as `named`.
- **Who reads `label.comp`:** `receipt-document.ts:100` and `:292-293` (a full invoice row whose
  lines at that rate have a filed base of zero, `GroupDiscount.comp`), and
  `till-ticket-view.ts:116`. Nothing else: `invoice-email.ts`, `receipt-print.ts` and
  `tender-refund-receipt.ts` read other keys (`invoice-email.ts:38`, `:55`; `receipt-print.ts:299`;
  `tender-refund-receipt.ts:118-130`).
- **Who pins the key list:** `packages/country-es/src/spain.test.ts:278-285` checks each language's
  keys equal `RECEIPT_LABEL_KEYS`, so deleting the key from both stays green.
  `packages/country-packs/src/registry.test.ts:242-254` checks identity (`toBe`), not contents.
- **Every printing path goes through `buildReceiptDocument`:** `receipt-ticket.ts`,
  `invoice-page.ts` (`git grep -ln buildReceiptDocument -- apps packages`), and through it the A4
  raster and PDF. Every caller of `receiptLines` (`bill-payments.ts:786`, `invoice-document.ts:63`,
  `till-sale.ts:831`, `:1025`, `:1638`, `:1803`, `transaction-receipt.ts:98`) runs after the sale
  is filed (`till-sale.ts:831` is read beside `backend.filedReceiptFor`, "Reads the already-filed
  record; never re-files", `:839`).
- **There is no English receipt-label set.** Only Spain's pack carries `receiptLabels`
  (`packages/country-es/src/spain.ts:294`); any other locale, `en-GB` included, prints Spain's
  Spanish words (`packages/country-packs/src/registry.ts:152-160`, pinned at
  `receipt-ticket.test.ts:245`). The fallback (`registry.ts:142-143`) is Spain's own object, so it
  needs no change.

## Global constraints

- **The filed record does not change.** No task touches `computeHuella`, the chain, invoice-number
  allocation, `registros_facturacion`, the alta builders or anything `recordSale` is given. Every
  code task ends by running, unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
  Task 1's test is the measurement, and it is written before any other change (Decision 6).
- **A test's check changes only where this item's design changes what it checks** (owner,
  2026-10-05). Every such change is listed under "Changed test checks" with its line, old and new
  value and design point. A helper or fixture that gains something is listed under "Fixtures grown".
  Any other check that turns red is a stop and a report to the driver.
- **General code is English only** (CLAUDE.md §3). Receipt words live only in
  `packages/country-es/src/receipt-labels.ts`; the code composes `${labels.discount} 100%` and names
  no Spanish word. `packages/adjustments` is scanned by the guard (`GENERIC_PACKAGES`,
  `packages/db/src/english-only.ts:15-45`, "adjustments" at `:42`), so `full-comp.ts` and its test
  say "Free", "amount", never a Spanish word. Server and till tests may keep typing receipt words,
  as their neighbours do (`receipt-ticket.test.ts:2460-2545`); the new Task 1 test reads them from
  `receiptLabelsFor` instead. Run `pnpm exec vitest run scripts/english-only.test.ts` from the
  worktree root after Task 2.
- **Test first.** Each code task starts with a failing test, run with the command given, and its
  expected failure is read before the code is written. Read the `Tests` count on every run; a run
  that prints none proved nothing (CLAUDE.md §4).
- **Browser suites** (`apps/till`, `packages/adjustments/src/dashboard/`) run in real headless
  Chromium. Check `memory_pressure | grep free` first; never beside a whole-workspace coverage run.
- **Coverage 98/98/98/95** holds in every package touched. Local runs are focused; CI runs the
  package suites and coverage (owner rule). Branch counts to watch: the new `full-comp.ts` (three
  outcomes, each tested in Task 2) and `receipt-document.ts`'s row words (three outcomes, Task 3).
- **Stop only processes you started**, by recorded id. Every commit `git commit -s`, staging named
  paths, never `git add -A`.
- **Guides:** no user guide describes a receipt's comp words. `git grep -n -i "descuento\|discount\|invitaci\|comp " -- apps/server/src/guide`
  matched only "discounts"/«descuentos» in `en/modifiers.md:110` and `es/modifiers.md:122`, about a
  recalled dish's prices. No guide changes, and no `docs/developers` page names the receipt labels
  (`git grep -n -i "receipt label\|RECEIPT_LABEL_KEYS\|receipt-labels" -- docs/developers` printed
  nothing).

## Review Focus

The inputs the design implies that are most likely to print the wrong words, each pinned by a test
in the task named:

1. **An amount comp that takes what an earlier comp left** (Burger 50%, then €6.00 off) prints
   «Descuento» and its amount, not "100%" (A911's default). Task 2 (the rule), Task 3 (printed).
2. **A Free comp of part of a line** (one of three Burgers) prints «Descuento 100%» under the row it
   carved off, not under the rest. Task 3.
3. **An amount on the whole bill equal to the bill's whole list value** is full and prints
   «Descuento 100%» at the bill's foot; a bill-level amount less than that prints «Descuento». Task 2
   (the reader marks it), Task 3 (the foot's words).
4. **A full invoice whose dish was cut partly by its own amount comp and the rest by a bill comp**
   prints that dish's row with its own comp's words («Descuento»), not "100%", though the dish's
   filed base is zero. Today it prints «Invitación». Task 3.
5. **The longest new words on the narrow roll** — «Deskontua 100% (BEZa barne)» on a 58 mm full
   invoice — stay within the printer's columns. Task 3.

## Where the outline drifted (re-read on `c7b301702`)

1. **The outline's mechanism is not the one built.** It sent a full comp as
   `{ kind: "discount", percentBp: 10000, amount }`. That would leave `kind: "comp"` with no writer
   in two type copies (`apps/server/src/till-sale.ts:266`, `apps/till/src/api/client.ts:1034`), or
   force removing it, which changes the wire pins at `adjustments-apply.test.ts:450`, `:2791` and
   `receipt-adjustments.test.ts:441`, `:487`, `:523`, `:540` and about twenty hand-written `kind:
   "comp"` fixture inputs (`git grep -n 'kind: "comp"' -- 'apps/**/*.test.ts'`). This plan keeps
   `kind: "comp"` and changes its meaning to "a full comp" (Decision 1): no wire shape changes,
   only printed words.
2. **Lines moved.** `BillAdjustment` is `packages/adjustments/src/record.ts:188-196` (outline
   `:176-184`); the receipt entry is `receipt-adjustments.ts:94-98` (outline `:93-97`); the full
   invoice's row words are `receipt-document.ts:290-299`, the comp branch at `:292-293` (outline
   `:290-294`); the till's label is `till-ticket-view.ts:109-123`, comp at `:116` (outline
   `:114-127`). Test pins: `adjustments-apply.test.ts:455`, `:483` (outline `:447`, `:475`);
   `adjustments-bill-payments.test.ts:247` (`:244`); `receipt-adjustments.test.ts:594` (`:592`);
   `receipt-document.test.ts:843`, `:846` (`:787`); `till-ticket-view.test.ts:1575-1576`, `:1836`
   (`:1549-1550`, `:1810`). `country.ts:74` and `receipt-labels.ts:25`, `:65`, `:105`, `:145` hold.
3. **The outline missed four things that print or decide the words.** The fallback `perDish`
   (`receipt-adjustments.ts:200-201`) also writes "comp" (it stays right: a dish whose changed rows
   all cost nothing lost its whole list value). The full invoice's row checks `comp` before the
   entry that names it (`receipt-document.ts:292-295`), so with "100%" in the words a dish cut
   partly by its own comp and partly by a bill comp would claim "100%" (Decision 4). The
   per-language table case asserts the comp word a second time at `receipt-ticket.test.ts:317`.
   And A758-3 already wrote A911's rule once, as `tookWholeValue`
   (`packages/adjustments/src/dashboard/adjustment-report-screen.ts:127-134`): two copies of one
   owner rule could drift, so Task 2 makes one.
4. **"Any fallback in `registry.ts:142`"** needs no change: it is Spain's `es-ES` object
   (`registry.ts:142-143`).
5. **The before-and-after measurement is a committed test written first**, not a run in a
   throwaway worktree (Decision 6).
6. **A documented example quotes the old word:** `docs/compliance/asesor-questions.md:1445` and
   `:1470` (Q29) describe a comped burger printing «Invitación -12,00 €». Task 5 adds a dated note.
7. **The outline's unchanged hits still hold, one moved:** staff invitations
   (`apps/dashboard/src/screens/staff-screen.test.ts:469`, `:811`,
   `apps/dashboard/src/widgets/staff-list.test.ts:65`, `apps/setup/src/screens/done-screen.test.ts:133`)
   and the demo seed's reason name, now `apps/server/scripts/demo-seed/seed-adjustments.ts:156-159`
   (a reason's name, never printed on a receipt: design §4, `:919-920`).
8. **"Shares 9 files with A773-1"** is moot: A773-1 landed.

## Decisions (with receipts)

1. **`kind: "comp"` stays on the wire and now means "a full comp".** `receiptLines` writes it when
   the stored row is full (Decision 3), not when its action is `comp`. Both renderers print it as
   `${labels.discount} ${percent(100)}%`, through the same formatter a percentage uses
   (`receipt-document.ts:101-107`, `till-ticket-view.ts:117-122`), so the four languages print
   «Descuento 100%», «Descompte 100%», «Desconto 100%», «Deskontua 100%» (design §3.4, `:337-340`).
   The two type copies carry one line saying so. A 100% percentage keeps `kind: "discount"` with its
   `percentBp`; it already prints «Descuento 100%» (`receipt-document.ts:107`).
2. **One rule, in `packages/adjustments/src/full-comp.ts`.** It imports only `@waitron/shared`, so
   the dashboard bundle can import it by relative path as it already imports `../entry-pages.js`
   (`adjustment-report-screen.ts:13`) without pulling `@waitron/db` (`client.ts:5-6`). It is not
   exported from the package's index; its two readers import it by path.
3. **What counts as full** (design §3.4: "Free, 100%, or an amount equal to the price"; A911's
   default, the parent plan's Open point 3):
   - `comp` (Free) — always, even after an earlier comp took part of the price (owner point 2);
   - `discount_amount` — when it left the item at zero (`afterAmount` 0) **and** the item was at its
     whole list value before it (`beforeAmount` = `nominalValue`). The server writes `before` as
     the subjects' charged price and `nominal` as their list value
     (`apps/server/src/adjustments-apply.ts:540`, `:545` for a line; `:452`, `:463` for the bill),
     so this holds for a whole line, a carved part, a dish with its extras and the whole bill;
   - `discount_percent` — never flagged: it prints its own percentage, a 100% one included.
   This is exactly A758-3's rule for the report (`adjustment-report-screen.ts:119`, `:127-134`), so
   the report's "Comp 100%" and the receipt's "Descuento 100%" mark the same rows.
4. **A full invoice's discount row takes its words from the one comp that names it, then from the
   zero-base flag, then plain.** Today: `discount.comp ? label.comp : named ? adjustmentLabel(named)
   : label.discount` (`receipt-document.ts:292-296`). New: `named !== null ?
   adjustmentLabel(named) : discount.comp ? fullLabel : label.discount`. A row named by a full comp
   still prints «Descuento 100%» (its entry is `kind: "comp"`), so every row that printed
   «Invitación» because of a Free or whole-price comp prints «Descuento 100%». The one change of
   choice is a row whose dish reached zero partly through a bill comp while its own one comp was
   partial: it now prints that comp's words. `GroupDiscount` (`receipt-figures.ts:49-58`) does not
   change. Left as is, and an owner point: a row with **two or more** own comps and a bill comp
   that together left the dish at zero is unnamed (`named` is null for more than one entry,
   `receipt-figures.ts:119`) and prints «Descuento 100%» beside only its own part.
5. **The `comp` label key is deleted**, from `RECEIPT_LABEL_KEYS` (`country.ts:74`) and the four
   sets (`receipt-labels.ts:25`, `:65`, `:105`, `:145`), once Tasks 3 and 4 leave it unread. The
   `discount` key is reused; no key is added.
6. **The filed record is measured by a committed test written before any other change.** The
   design reached its §8 conclusion by reading; the owner asked for it confirmed. The test files
   the same full-comp bill in two fresh databases provisioned identically under one fixed clock —
   once with the receipt labels as shipped, once with every label replaced by a marker — and
   compares the stored `registros_facturacion` row, the sale's lines and the alta XML serialised
   from the row. A control proves the marker reached the printed receipt. It also pins the filed
   figures, the record's fingerprint (`huella`) and the XML's SHA-256 as literals. Written and
   committed in Task 1, when the branch's code is still `c7b301702`'s, and run unedited after
   Tasks 2 to 4, it measures before and after with one file. That is what the outline's throwaway
   worktree would have measured, and it stays as a guard, as
   `apps/server/src/list-unit-price.fiscal-identity.test.ts` (A663) does for the list price. If
   Task 1 is ever committed after a product change, fall back to the outline: `git worktree add
   --detach <dir> c7b301702`, `pnpm install` there, copy the test file and the helper change in, run
   it, `git worktree remove` after (CLAUDE.md §4).

---

## Task 1: the filed record of a full-comp sale, measured first

**Files:** create `apps/server/src/full-comp.fiscal-identity.test.ts`; modify
`apps/server/src/testing/adjustment-venue.ts:300-302`.

**Interfaces:**
- Produces: `provisionAdjustmentVenue(db: Database, options?: { clock?: TrustedClock }):
  Promise<AdjustmentVenue>` — `options.clock` replaces `systemClock()` for the backend and the till
  routes; without it, behaviour is unchanged.

The model is `apps/server/src/list-unit-price.fiscal-identity.test.ts`: two `useVenueDb` instances
with `migrationOptionsFor(manifestSets(), null)` and `timeoutMs: 60_000` (`:54-56`), a fixed
`TrustedClock` (`:58-71`), the compared column lists (`:72-95`) and `vi.hoisted` + `vi.mock` for
the injection (`:34-46`). Here both databases take `resetPerTest: false`
(`packages/db/src/testing/venue-db.ts:36-41`), and the two filings run once, in a `beforeAll`
registered after both `useVenueDb` calls, so the three cases read the same two results. The bill and the adjustments come from the adjustment harness as
`adjustments-apply.test.ts` uses it (`adjust` `:98-122`, `payWorkingOrder` `:459-463`,
`formatReceipt` + `printedLines` `:468-481`).

- [ ] **The helper option.** Add `options: { clock?: TrustedClock } = {}` to
  `provisionAdjustmentVenue`; `const clock = options.clock ?? systemClock();`. `src/testing/` is
  outside coverage (`apps/server/vitest.config.ts:43`). Listed under "Fixtures grown".
- [ ] **The injection.** Mock `@waitron/country-packs`, spreading the real module; while
  `inject.on`, `receiptLabelsFor(locale)` answers the real set with every value replaced by
  `` `MARK-${key}` `` (map over `Object.keys` of the real set, so the file runs the same before and
  after the `comp` key goes).
- [ ] **`fileFullComps(db)`** provisions with the fixed clock (`ISSUED_AT =
  new Date("2026-09-25T11:30:00.000Z")`, `offsetMinutes: 120`), and fakes `Date` at `ISSUED_AT` for
  the whole run as `packages/adjustments/src/record.test.ts:622-630` does
  (`vi.useFakeTimers({ toFake: ["Date"] })`, restored in `finally`), so every wall-clock read agrees
  with the fiscal clock. It opens one bill with `billWith(venue, [{ name: "Burger" }, { name:
  "Bottle" }, { name: "Bread" }, { name: "Water" }])` and, under the `house` reason as
  supervisor:
  - Burger: `comp` (Free, full);
  - Bottle (€30.00): `discount_amount` `"30.00"` (full: the whole list price);
  - Bread (€2.50): `discount_percent` 5000, then `discount_amount` `"1.25"` (not full: it took what
    the 50% left);
  then pays it cash `"2.00"` with `payWorkingOrder` and prints the ticket with `formatReceipt`
  (`invoiceLocale: "es-ES"`, 80 mm, 180 dpi). It answers `{ registros, lines, xml, printed }`:
  `registros` = every `registros_facturacion` column but `id`, `sale_id`, `node_id`, `device_id`,
  `sif_id`, `creado_en` (the precedent's `REGISTRO_COLUMNS`, `:88-95`); `lines` = every
  `sale_lines` column but the minted ids, catalogue ids compared as present/absent (the
  precedent's `:72-83`, `:228-237`); `xml` = `serializeEnvio(cabecera, [{ RegistroAlta:
  fromRegistroRow(decodeRegistroRow(row)) }])` from `@waitron/verifactu` and
  `@waitron/fiscal-verifactu/src/registro-row.js` (as
  `apps/server/src/hour-recovery-placement-1.test.ts:47`, `:289` and
  `packages/fiscal-verifactu/src/canje-path.e2e.test.ts:129-138`, with no `RefExterna`, which
  carries the minted row id).
- [ ] **Case 1 — "files the same record, lines and alta XML whatever words the receipt prints".**
  `inject.on = false` → `shipped`; `inject.on = true` → `marked`. Assert:
  - control: `marked.printed` contains a line starting `"  MARK-"` and `shipped.printed` none;
  - `shipped.registros` has length 1; `marked.registros` `toEqual` it; `marked.lines` `toEqual`
    `shipped.lines`; `marked.xml` `toBe` `shipped.xml`.
- [ ] **Case 2 — "files the full comps' sale with these figures".** From `shipped.registros[0]`,
  `toEqual` a literal of `tipo_factura`, `num_serie_factura`, `importe_total`, `cuota_total`,
  `desglose`, `descripcion_operacion`, `fecha_hora_huso_gen_registro` and `huella`; and
  `createHash("sha256").update(shipped.xml).digest("hex")` `toBe` a literal. Write the literals as
  `"?"` first, run, and copy the values from the failure. Check them by arithmetic before pinning:
  `importe_total` is the Water alone, `"2.00"`; at 21% its base is 1.65 and its tax `"0.35"`;
  `descripcion_operacion` is `"Restaurante"` (`adjustment-venue.ts:319`). A value that disagrees is
  a stop and a report.
- [ ] **Case 3 — "serialises no receipt word into the alta XML".** Control: `shipped.xml` contains
  `"<sf:DescripcionOperacion>Restaurante</sf:DescripcionOperacion>"` (the probe reads text the
  record does carry). Then for each of `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`, the real
  `receiptLabelsFor(locale).discount` (from `vi.importActual`) is not in `shipped.xml`, and neither
  is `"100%"` nor `"MARK-"`.
- [ ] **Run:** `pnpm --filter @waitron/server exec vitest run src/full-comp.fiscal-identity.test.ts`.
  Expected first: Case 2 fails on the `"?"` literals, Cases 1 and 3 pass. After pinning: 3 passed.
- [ ] **Negative control, not committed.** Change `marked`'s Bread amount to `"1.24"` and run: Case
  1 must fail on `importe_total`/`desglose` and the line columns. Revert; `git diff --stat` shows
  only the two files above. Record the command and both results for the PR.
- [ ] **Prove the base.** `git diff --stat c7b301702 HEAD -- apps packages` before this commit lists
  nothing; after it, only the two files above. Then the golden gates, unedited. Typecheck
  `pnpm --filter @waitron/server typecheck`. Commit — "Test that a full comp's filed record ignores
  the receipt's words".

## Task 2: one rule for a full comp

**Files:** create `packages/adjustments/src/full-comp.ts`, `full-comp.test.ts`; modify
`record.ts:188-224`, `record.test.ts`, `dashboard/adjustment-report-screen.ts:116-134`.

**Interfaces:**
- Produces: `isFullComp(row: { action: string; beforeAmount: string; afterAmount: string;
  nominalValue: string }): boolean` in `packages/adjustments/src/full-comp.ts` (Decision 3).
  `BillAdjustment` gains `full: boolean` (doc: "Free, or an amount that took the item's whole list
  value: it prints as 100%. A percentage carries its own `percentBp`.").
- Consumes: nothing from Task 1.

- [ ] **Failing tests.**
  - `full-comp.test.ts` (node project): `isFullComp` is true for `comp` whatever its amounts (one
    case with `beforeAmount` "6.00", `nominalValue` "12.00"); true for `discount_amount` 12.00 →
    0.00 of 12.00; false for `discount_amount` 6.00 → 0.00 of 12.00 (A911); false for
    `discount_amount` 12.00 → 3.00 of 12.00; false for `discount_percent` at 10000 with 12.00 →
    0.00 of 12.00; and decimals compared as values, not text (`"12.0"` against `"12.00"` is full).
  - `record.test.ts`, a new case under `describe("readBillAdjustments")`: "marks a Free comp and an
    amount that took the whole list value as full": record a `comp`, a line `discount_amount` 12.00
    → 0.00 of 12.00, one 6.00 → 0.00 of 12.00, and a bill-level (`line: null`) `discount_amount`
    20.00 → 0.00 of 20.00, each with `recordAt` so their order is fixed; `(await read…).map((row)
    => row.full)` `toEqual([true, true, false, true])`.
  - The existing case's `toEqual` (`:672-705`) gains `full` on its four entries: `true`, `true`,
    `false`, `false` (changed check 1).
  Run `pnpm --filter @waitron/adjustments exec vitest run src/full-comp.test.ts src/record.test.ts`.
  Expected: `full-comp.test.ts` fails to load (no such module); `record.test.ts`'s two cases fail on
  the missing `full`.
- [ ] **The rule.** `full-comp.ts` with `isFullComp` as Decision 3, using `decimal` and
  `compareDecimal` from `@waitron/shared`.
- [ ] **The reader.** `readBillAdjustments` also selects `beforeAmount`, `afterAmount`,
  `nominalValue`, converts them with `centsToDecimal` as it does `reduction`, sets `full:
  isFullComp(…)`, and leaves the three out of what it answers.
- [ ] **The report.** In `entryWords`, `entry.action === "comp" || tookWholeValue(entry)`
  (`adjustment-report-screen.ts:119`) becomes `isFullComp(entry)` imported from `../full-comp.js`;
  delete `tookWholeValue` (`:127-134`) and any import only it used.
- [ ] **Run** the two node files again (read the count), then
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/adjustment-report-screen.test.ts`
  — every case passes unedited, among them A758-3's "Comp 100%" and "Comp €6.00" cases. Then
  `pnpm --filter @waitron/adjustments typecheck`, `pnpm exec vitest run scripts/english-only.test.ts`
  from the root, Task 1's test and the golden gates.
- [ ] Commit — "One rule for a full comp, read with a bill's adjustments".

## Task 3: the server prints a full comp as "Descuento 100%"

**Files:** `apps/server/src/receipt-adjustments.ts:94-98`, `receipt-document.ts:95-108` and
`:290-299`, `till-sale.ts:264-271`, the six test files in the files table, and
`apps/server/scripts/receipt-look.ts`.

**Interfaces:**
- Consumes: `BillAdjustment.full` (Task 2).
- Produces: a receipt entry `{ kind: "comp", amount }` for every full row; `ReceiptAdjustment`'s
  `kind` doc: "`comp`: a full comp — Free, or an amount that took the whole list value — printed as
  the discount word with 100%."

- [ ] **Change the pinned words first** (changed checks 2 to 11; old → new in the table below), then
  add:
  - `receipt-adjustments.test.ts`, against a real venue as its neighbours do (`:560-600`): (a) "prints
    an amount that took the Burger's whole price as Descuento 100%": Burger `discount_amount`
    `"12.00"`, pay; the ticket line's `adjustments` `toEqual([{ kind: "comp", amount: "12.00" }])`
    and the printed line beneath it is `at80("  Descuento 100%", "-12,00")`; (b) "prints an amount
    that took what a 50% left with its amount": Burger 50% then `"6.00"`; `adjustments`
    `toEqual([{ kind: "discount", percentBp: 5000, amount: "6.00" }, { kind: "discount", amount:
    "6.00" }])`, printed «Descuento 50%» then «Descuento», each `-6,00` (Review Focus 1); (c) "prints
    a Free comp of one of three Burgers beneath the Burger it carved off": `quantity: "1"` of a
    line of 3; the carved row carries `[{ kind: "comp", amount: "12.00" }]`, the other row none
    (Review Focus 2).
  - `receipt-ticket.test.ts`: (d) "prints a full comp on the whole bill as Descuento 100% at the
    foot": `BILL_DISCOUNT` (`:2189-2213`) with both lines' `gross` `"0.00"`, `total` `"0.00"`, a
    zero VAT breakdown and `billAdjustments: [{ kind: "comp", amount: "6.50" }]` prints
    `at80("Descuento 100%", "-6,50")` after the goods (Review Focus 3); (e) "keeps a full
    comp's line within 58 mm in every language": `ADJUSTED` as `invoiceType: "F1"` and as F2, in
    `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`, `PRINTER_58`; every printed line's length ≤
    `columnsFor("58mm")`, and the joined text contains «Deskontua 100%» for `eu-ES` (Review Focus 5).
  - `receipt-document.test.ts`: (f) "names a dish's row by its own part comp when a bill comp took
    the rest": one filed line at a filed base of zero, list 10.00, `adjustments: [{ kind:
    "discount", amount: "6.00" }]`, `billAdjustments: [{ kind: "discount", percentBp: 10000,
    amount: "4.00" }]`; the table's discount row under the dish reads «Descuento», and the end row
    «Descuento 100%» (Review Focus 4, Decision 4).
  Run `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts src/receipt-document.test.ts src/receipt-figures.test.ts src/receipt-adjustments.test.ts src/adjustments-apply.test.ts src/adjustments-bill-payments.test.ts`.
  Expected: every changed and new check fails on «Invitación» / «Invitació» / «Gonbidapena», (a) on
  `kind: "discount"`, (f) on «Invitación»; (b), (c) and (e) may already pass — say which in the
  task's report.
- [ ] **The entry.** `receipt-adjustments.ts:95`: `kind: record.full ? "comp" : "discount"`.
  `perDish` (`:200-201`) is unchanged.
- [ ] **The words.** In `receipt-document.ts`, `adjustmentLabel` prints `kind: "comp"` as a 10000
  basis-point percentage through the existing formatter (one `percentBp` read: `adjustment.kind ===
  "comp" ? 10000 : adjustment.percentBp`), so `label.comp` is no longer read there; `discountRow`'s
  `item` follows Decision 4, its zero-base branch calling `adjustmentLabel({ kind: "comp", amount:
  "0" }, locale, label)` so the 100% wording has one source. Update `ReceiptAdjustment`'s doc in
  `till-sale.ts`.
- [ ] **The look script.** Add two samples to `SAMPLES` in `apps/server/scripts/receipt-look.ts`
  (`:439-480`): `"simplified-full-comps"` — a Free Burger and a whole-price amount on a Bottle
  (each `{ kind: "comp" }`), and Bread with `{ kind: "discount", percentBp: 5000 }` then
  `{ kind: "discount" }` for what was left; and `"full-comp-eu-58"` — `FULL` as F1 with one
  full-comp line and `invoiceLocale: "eu-ES"`. The
  script is typechecked (`apps/server/tsconfig.json:7` includes `scripts`), never run by CI.
- [ ] **Run** the six files again (read each count), the receipt and invoice neighbours that pin
  amount entries — `src/invoice-document.test.ts src/receipt-language.test.ts` — and Task 1's test
  unedited, the golden gates, `pnpm --filter @waitron/server typecheck`. Search for anything left
  reading the label: `git grep -nE "label\.comp|labels\.comp" -- apps/server` prints nothing.
- [ ] Commit — "Receipts print a full comp as Descuento 100%".

## Task 4: the till's ticket, and the `comp` label goes

**Files:** `apps/till/src/screens/till-ticket-view.ts:109-123`, `apps/till/src/api/client.ts:1032-1038`,
`apps/till/src/screens/till-ticket-view.test.ts`, `packages/country/src/country.ts:74`,
`packages/country-es/src/receipt-labels.ts:25`, `:65`, `:105`, `:145`.

**Interfaces:**
- Consumes: the wire meaning of `kind: "comp"` (Task 3).
- Produces: `ReceiptLabels` without `comp`.

- [ ] **Failing test.** Change checks 12 and 13, and add to
  `describe("till-ticket-view: a line given away or discounted …")` (`:1530`) a Basque case:
  `locale: "eu-ES"`, one `{ kind: "comp", amount: "12.00" }` line; the row after the dish reads
  "Deskontua 100% -12,00 €". Run (free memory checked)
  `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts`. Expected:
  those three cases fail on «Invitación» / «Invitació» / «Gonbidapena».
- [ ] **The words.** `adjustmentLabel` in `till-ticket-view.ts` reads `percentBp` as 10000 for
  `kind: "comp"`, as the server does (Task 3); its doc comment keeps naming the server file it
  mirrors. Update `ReceiptAdjustment`'s doc in `client.ts` to Task 3's sentence.
- [ ] **Retire the key.** Delete `"comp"` from `RECEIPT_LABEL_KEYS` and `comp:` from the four sets.
  `git grep -nE "\.comp([^a-zA-Z]|$)" -- apps packages | grep -v "\.test\.ts"` then lists only
  `receipt-document.ts`'s `discount.comp` and `receipt-figures.ts`'s `entry.comp` (the zero-base
  flag, not a label).
- [ ] **Run:** the ticket view suite and `src/screens/till-ticket-view.a11y.test.ts` (unedited:
  its `kind: "comp"` inputs at `:501`, `:516` are wire data); `pnpm --filter @waitron/country-es
  exec vitest run src/spain.test.ts`; `pnpm --filter @waitron/country-packs exec vitest run
  src/registry.test.ts`; typecheck `@waitron/till`, `@waitron/country`, `@waitron/country-es`,
  `@waitron/country-packs`, `@waitron/server`; Task 1's test unedited; the golden gates. Re-run
  the label sweep: `git grep -n -i "invitaci\|Gonbidapena" -- 'apps/**' 'packages/**'` lists only
  the staff invitations and the demo seed's reason name (Where the outline drifted, item 7).
- [ ] Commit — "The till shows a full comp as Descuento 100%; the comp receipt label goes".

## Task 5: backlog and the asesor note

**Files:** `docs/backlog.md` (`:2214-2231`, `:2318-2320`, A955 at `:2266-2268`),
`docs/backlog/till.md` (`:1493-1498`), `docs/compliance/asesor-questions.md` (`:1438-1439`).

- [ ] **A758** (`docs/backlog.md`): after A758-3's sentence, "**A758-4 built the receipt words**
  ([plan](superpowers/plans/2026-10-21-a758-4-full-comp-receipt.md)): a full comp — Free, or an
  amount that took the whole list price — prints «Descuento 100%» in each language's own discount
  word, and the «Invitación» receipt label is gone; a test shows the filed record is unchanged."
  "Left:" loses "A758-4 ("Descuento 100%" on receipts),". The entry stays open (A758-5 and the §3.8
  and "collect it at the counter" slices). Never mark it done.
- [ ] **A911** is rewritten, and **A955 deleted into it**, because one function now decides both:
  "**A911. What counts as a full comp (left open by A758-1, A758-3 and A758-4).** Free always
  counts, even after an earlier comp took part of the price, so it prints «Descuento 100%» beside
  what was left, as a 100% percentage already does. An amount counts only when it took the item's
  whole list price; one that takes what an earlier comp left prints «Descuento» and its amount, and
  the report reads "Comp €6.00". One rule decides both (`packages/adjustments/src/full-comp.ts`).
  Owner to confirm both halves." Say in the commit that A955 is folded into A911.
- [ ] **`docs/backlog/till.md` "## A758"**: the same A758-4 sentence after A758-3's (`:1493-1495`);
  "A758-4 and A758-5 and the §3.8 …" becomes "A758-5 and the §3.8 …". The review notes below it
  (`:1501-1569`, «Invitació» at `:1517`) are the pre-answer review, which that paragraph already says
  the design overrides; leave them.
- [ ] **`docs/compliance/asesor-questions.md`, Q29**: under the 2026-09-30 note (`:1438-1439`) add
  "_2026-10-2x, A758-4 (owner D11): a full comp now prints «Descuento 100% -12,00 €» where (c)'s
  example says «Invitación -12,00 €»; the figures and the filed record are unchanged. S10 already
  treats a free item as a discount (V0555-17)._" (the actual date). The Word copies are not
  changed; the legal track is the owner's.
- [ ] `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true` (docs are not
  format-checked). Commit — "Backlog: A758-4 built; A911 holds the full-comp rule".

## Task 6: LOOK

Tests read text; nobody has seen the new words on paper or on the till. Look at both.

- [ ] **Printed.** `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts
  /Users/clintongormley/waitron-campaign-c/a758-4-shots/receipts`. Open the 58 mm and 80 mm PNGs of
  `simplified-full-comps`, `full-comp-eu-58` and the existing `full-comped-weighed` (thermal and A4,
  and its PDF). Check: «Descuento 100%» sits under the comped item, indented like «Descuento 20%»;
  its amount is right-aligned with the others; on 58 mm a wrapped «(BEZa barne)» keeps the amount
  on the line it belongs to; the full invoice's row prints «Descuento 100%» in the item column.
- [ ] **On the till.** Write `apps/till/src/screens/till-ticket-view.look.test.ts` (not staged):
  mount `till-ticket-view` with `mountWidget(tag, props, theme)` as the a11y suite does
  (`till-ticket-view.a11y.test.ts:488-526`), with a Free line, a whole-price amount, a 50%-then-
  amount line and a bill comp, as F2 and as F1 (`(IVA incluido)`), in `es-ES` and `eu-ES`; size the
  frame with `page.viewport(390, 844)` and `page.viewport(1280, 800)` from `vitest/browser`, never
  `commands.setViewportSize` (`docs/developers/testing-guide.md:1317-1338`); print
  `window.innerWidth` in each case and report that width, not the one asked for; save with
  `page.screenshot({ path: "__screenshots__/look/<name>.png" })` (`testing-guide.md:1349-1350`).
  Light and dark, 390 wide; light, 1280 wide.
- [ ] Copy the pictures to `/Users/clintongormley/waitron-campaign-c/a758-4-shots/till/`, delete the
  harness and its `__screenshots__/look/` folder, and check `git status --short` shows neither.
- [ ] Look, and record in the PR what to check: on a phone, «Descuento 100% (IVA incluido)» wraps
  without pushing its amount off the row; the amount column lines up with the item rows; dark theme
  keeps the adjustment rows readable. Fix a defect test-first; list a judgement call as an owner
  point.

**PR description** (plain English): first line, the review path and that it changes printed
invoice wording only — by the 2026-10-21 rule "truly fiscal PRs (invoices…) wait for the owner",
so the driver asks the owner before landing; what a receipt now prints, with the pictures' paths;
**the filed-record measurement** — Task 1's three cases, that they were written and pinned on
`c7b301702`'s code and pass unedited at the tip (`git diff <task-1-sha> HEAD -- apps/server/src/full-comp.fiscal-identity.test.ts`
empty), the negative control's command and result, and the golden gates' counts; **Changed test
checks** and **Fixtures grown** below; **owner points** below.

---

## Changed test checks

Each changes only because design D11 / §3.4 makes a full comp print the discount word with "100%"
(rows 2–13), or because the reader now says which rows are full (row 1).

| # | Task | Where | Old → new |
|---|---|---|---|
| 1 | 2 | `packages/adjustments/src/record.test.ts:672-705` ("reads this bill's comps and discounts oldest first…", `:637`) | each entry gains `full`: `true`, `true`, `false`, `false` |
| 2 | 3 | `apps/server/src/receipt-ticket.test.ts:241-256`, `:317` ("prints F1 reductions before VAT…") | the table's fourth column (the comp word) goes; `` `${comp} -${figure("1.00")} 10%` `` → `` `${discount} 100% -${figure("1.00")} 10%` `` |
| 3 | 3 | `receipt-ticket.test.ts:2231` | `at80("  Invitación", "-12,00")` → `at80("  Descuento 100%", "-12,00")` |
| 4 | 3 | `receipt-ticket.test.ts:2238` | `at80("  Invitación", "-10,50")` → `at80("  Descuento 100%", "-10,50")` |
| 5 | 3 | `receipt-ticket.test.ts:2276`, `:2287` | name "prints the comp's label as Invitación" → "prints a full comp as Descuento 100%"; `"  Invitación "` → `"  Descuento 100% "` (still 2) |
| 6 | 3 | `receipt-ticket.test.ts:2319` (58 mm) | `` `  Invitación${" ".repeat(12)}-12,50` `` → `` `  Descuento 100%${" ".repeat(8)}-12,50` `` (30 columns either way) |
| 7 | 3 | `receipt-ticket.test.ts:2467`, `:2503`, `:2539` | `comp:` «Invitació -12,00» → «Descompte 100% -12,00»; «Invitación -12,00» (gl) → «Desconto 100% -12,00»; «Gonbidapena -12,00» → «Deskontua 100% -12,00» |
| 8 | 3 | `apps/server/src/receipt-adjustments.test.ts:594` | `at80("  Invitación", "-12,00")` → `at80("  Descuento 100%", "-12,00")` |
| 9 | 3 | `apps/server/src/adjustments-apply.test.ts:455`, `:483` | name "…with an Invitación line beneath it…" → "…with a Descuento 100% line beneath it…"; `/^ {2}Invitación +-12,00$/u` → `/^ {2}Descuento 100% +-12,00$/u` |
| 10 | 3 | `apps/server/src/adjustments-bill-payments.test.ts:247` | `"Invitación -20,00"` → `"Descuento 100% -20,00"` |
| 11 | 3 | `apps/server/src/receipt-document.test.ts:843`, `:846` | name "prints a comped jamón's value and an invitation" → "…and Descuento 100%"; `{ item: "Invitación", amount: "-2,68" }` → `{ item: "Descuento 100%", amount: "-2,68" }` |
| 12 | 4 | `apps/till/src/screens/till-ticket-view.test.ts:1575-1576` | «Invitación -12,00 €», «Invitación -1,50 €» → «Descuento 100% -12,00 €», «Descuento 100% -1,50 €» |
| 13 | 4 | `till-ticket-view.test.ts:1836` | «Invitació -12,00 €» → «Descompte 100% -12,00 €» |

**Names only, no check changes:** `apps/server/src/receipt-figures.test.ts:469` ("calls a comped
dish's own row an invitation…") and `:686` ("calls a comped dish an invitation") become "marks …
as a comp"; their `comp: true` checks stand, because `GroupDiscount.comp` does not change.

**Unchanged, checked:** every `kind: "comp"` wire pin and fixture input (Decision 1); the
adjustment report's suites (Task 2 runs them unedited); `spain.test.ts` and `registry.test.ts`;
`till-ticket-view.a11y.test.ts`; the golden gates.

If a suite turns red on a check not in this table — for instance a pin of a whole-price amount comp
as `kind: "discount"` that `git grep -n 'kind: "discount", amount' -- 'apps/server/src/*.test.ts'`
did not show as whole-price on 2026-10-21 — it is a stop and a report, then a new row here.

## Fixtures grown

- `apps/server/src/testing/adjustment-venue.ts`: `provisionAdjustmentVenue` takes an optional
  `{ clock }` (Task 1). Every existing caller passes nothing and keeps `systemClock()`.
- `apps/server/scripts/receipt-look.ts`: two look samples (Task 3). Not a test.

## Owner points (each with the default this PR builds)

1. **An amount counts as a full comp only when it took the item's whole list price** (A911). €6.00
   off a Burger a 50% comp had already halved prints «Descuento -6,00», not «Descuento 100%».
   The other way: any amount that leaves an item at zero prints «Descuento 100%».
2. **Free always counts as a full comp**, even after an earlier comp: that Burger, made Free after
   its 50%, prints «Descuento 50% -6,00» and «Descuento 100% -6,00», as a 100% percentage already
   does. The other way: Free after an earlier comp prints «Descuento» and what it took.
3. **A full invoice names a dish's discount row by its own comp when it has exactly one** (Decision
   4). Left as it is: a row with two or more of its own comps and a bill comp that together left the
   dish at zero prints «Descuento 100%» beside only its own part.
4. **This is invoice wording.** No filed figure changes (Task 1's measurement), but a simplified
   invoice's printed words do; the driver asks the owner before landing.
