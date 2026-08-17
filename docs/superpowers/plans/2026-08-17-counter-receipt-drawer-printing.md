# Counter printing — customer receipt + cash drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the customer receipt (faithfully, to a per-till thermal printer via the printing subsystem) and open the cash drawer (auto on cash + a manual button), without touching the fiscal record and without ever blocking a sale.

**Architecture:** `tills.receipt_printer_id` + `locations.receipt_print_mode`; a `qr()` method added to the subsystem's ESC/POS builder; `formatReceipt` reproducing every mandated art. 7.1 / arts. 20–21 element; a server-side post-filing hook enqueues the receipt (+ drawer kick on cash) to the outbox; a manual reprint + audited drawer-open. Non-fiscal (re-renders the filed result).

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, Lit + Vite, Vitest (+ browser), Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-counter-receipt-drawer-printing-design.md](../specs/2026-08-17-counter-receipt-drawer-printing-design.md).

## ⛔ Prerequisites — BLOCKED until the printing subsystem lands

Re-verify first (CLAUDE.md §1): `enqueuePrintJob(tx, cfg, printerId, bytes)`, the ESC/POS builder (`init/text/line/feed/cut/kick`) it extends, `printers`, `printer.not_found` (Slice A); `tills`/`locations` schema; the receipt render (`till-ticket-view.ts:229-318`), `TillSaleResult` (`client.ts:129-139`), `r.qr` + `qr.ts`, the tender `method` discriminant (`client.ts:96-115`); `recordSale`/`collectOrder` (the filing sites); `till-config.ts` `readOrderFlow` (the per-location-column precedent for `receipt_print_mode`).

## Global Constraints

- **The fiscal record is untouched** — this slice reads the filed `TillSaleResult` and enqueues paper; a grep proves `record-sale.ts`/the alta builders are byte-unchanged.
- **Never block a sale** (CLAUDE.md §5) — print-on-sale is a post-filing outbox INSERT; no hardware I/O in the filing path. A test pins it.
- **The paper is a legal receipt** — `formatReceipt` reproduces **every** art. 7.1 / arts. 20–21 element; the completeness test proves non-suppression by deletion.
- **QR** — native `GS ( k`, EC level **M** (Orden art. 21.1), module size for **30–40 mm**; content = `r.qr` verbatim; raster fallback.
- **Labels stay the fixed Spanish constants** (`nif/factura/fecha/base/iva/total/efectivo/cambio`); money/date/name in the invoice locale. English *identifiers* only (`receipt_printer_id`, `receipt_print_mode`, `drawer_opens`).
- **Permissions** — `printer.manage` (config); `requireSession` (reprint, drawer-open, audited). No new permission (the `cash.drawer` gate is a fast-follow).
- **No back-compat / data-migration** (pre-production). **Migration number via `db:generate`.** Re-run `inmutabilidad`.
- **Coverage:** db, server, `@waitron/printing` → 98/98/98/95; till, dashboard → 95/95/90/88. Real-PG for RLS. `TESTCONTAINERS_RYUK_DISABLED=true`. Prove guards by deletion.

## File Structure

**Created:** `packages/db/src/schema/drawer-opens.ts` (+ `.rls.test.ts`); `packages/db/drizzle/<NNNN>_receipt_printing.sql` + `<NNNN>_receipt_printing_rls.sql`; a receipt formatter (`apps/server/src/receipt-ticket.ts` or `@waitron/receipt`).
**Modified:** `packages/db/src/schema/{index, tills, locations}.ts`; `packages/printing/src/escpos.ts` (add `qr()`); `apps/server/src/{till-sale.ts (the post-filing hook), till-api.ts, management-api.ts, errors.ts}`; `apps/till/src/{screens/till-ticket-view.ts, api/client.ts}`; `apps/dashboard/src/{screens/printers-screen.ts, api/client.ts}`; `docs/backlog.md`.

---

### Task 1: Schema — `receipt_printer_id`, `receipt_print_mode`, `drawer_opens`

- [ ] **Step 1:** Add `receipt_printer_id uuid` (bare) to `tills`; `receipt_print_mode` (new pgEnum `['auto','on_request','never']` default `'auto'`) to `locations`; create `drawer_opens` (§2). Register in `index.ts`.
- [ ] **Step 2:** `db:generate` → verify (two columns + enum + table). Note `<NNNN>`.
- [ ] **Step 3:** Custom `<NNNN+1>_receipt_printing_rls.sql` — the `tills.receipt_printer_id` composite FK → `printers`; `drawer_opens` FORCE RLS + policy + `GRANT SELECT,INSERT` (append-only). Register in `_journal.json`.
- [ ] **Step 4:** RLS test (real-PG) — `drawer_opens` isolation + append-only (no UPDATE/DELETE grant) + negative `WITH CHECK`; new columns visible under `app_user`; prove FORCE by deletion.
- [ ] **Step 5:** Guards — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`.
- [ ] **Step 6:** Commit. `git commit -s -m "feat(db): receipt_printer_id + receipt_print_mode + drawer_opens"`

---

### Task 2: `drawer.no_printer` error code

- [ ] **Step 1:** Failing registration test (`drawer.no_printer` → 400). Add to `errors.ts`. PASS. Commit. `git commit -s -m "feat(server): drawer.no_printer error code"`

---

### Task 3: ESC/POS `qr()` (extend the subsystem builder)

- [ ] **Step 1:** Failing test — `esc().qr("https://…", { ecLevel:"M" }).bytes()` emits a `GS ( k` sequence (assert the store + print function bytes) at level M; the raster fallback emits `GS v 0`.
- [ ] **Step 2:** Run → FAIL → implement `qr(text, { ecLevel="M", moduleSize })` in `packages/printing/src/escpos.ts`: the native `GS ( k` (fn 165 model, 167 module size for 30–40 mm @203dpi, 169 EC level M, 180 store, 181 print) + a `qrRaster()` fallback. Byte-asserted (fake sink; real print manual).
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(printing): ESC/POS qr() (GS ( k) + raster fallback"`

---

### Task 4: `formatReceipt` — the legal document (load-bearing)

- [ ] **Step 1:** Failing completeness test:
```ts
it("reproduces every mandated element of a filed receipt", async () => {
  const bytes = formatReceipt({ result: FILED_SALE, issuer, receipt: TRIM, invoiceLocale: "es" });
  const s = decodeEscPosText(bytes);
  expect(s).toContain(issuer.venueName); expect(s).toContain(`NIF: ${issuer.nif}`);
  expect(s).toContain(FILED_SALE.invoiceNumber);            // serie+número (7.1.a)
  FILED_SALE.lines.forEach(l => expect(s).toContain(name(l)));// goods (7.1.e)
  FILED_SALE.vatBreakdown.forEach(v => { expect(s).toContain(`Base ${v.rate}`); expect(s).toContain(`IVA ${v.rate}`); }); // 7.1.f
  expect(s).toContain("TOTAL"); expect(s).toContain("VERI*FACTU");   // 7.1.g + legend
  expect(bytesInclude(bytes, escQrFor(FILED_SALE.qr))).toBe(true);   // the QR (arts. 20-21)
});
// prove non-suppression: remove the legend line → the test fails; restore.
```
- [ ] **Step 2:** Run → FAIL → implement `formatReceipt` mirroring `till-ticket-view.ts:229-318` element-for-element (fixed Spanish labels; money/date/name in `invoiceLocale`; trim around the core; `qr(result.qr)`; cut). Reuse the till's `lineName`/`issueDate`/`formatMoney` logic (port or share).
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(server): formatReceipt ESC/POS (faithful legal receipt)"`

---

### Task 5: Print-on-sale + drawer kick (server-side, non-blocking)

- [ ] **Step 1:** Failing test:
```ts
it("auto-prints on a cash sale with a drawer kick, records the open, and never blocks filing", async () => {
  await setTillReceiptPrinter(tx, cfg, printerId); await setReceiptPrintMode(tx, cfg, "auto");
  const noIo = spyNoSocket();
  const res = await recordSale(/* … cash tender */);         // files the sale
  expect(noIo).not.toHaveBeenCalled();                        // filing never blocked
  const job = await onlyPrintJob(tx);
  expect(job.printerId).toBe(printerId);
  expect(bytesInclude(job.payload, DRAWER_KICK)).toBe(true);  // cash → kick appended
  expect(await drawerOpens(tx)).toContainEqual(expect.objectContaining({ reason: "cash_sale" }));
});
it("card sale prints no kick; mode 'never' prints nothing", async () => { /* … */ });
```
- [ ] **Step 2:** Run → FAIL → implement — after `recordSale`/`collectOrder` file, in the same tx: read the till's `receipt_printer_id` + the location's `receipt_print_mode`; if `auto` + printer set → `enqueuePrintJob(formatReceipt(result))`; if the tender `method==="cash"` → append `DRAWER_KICK` bytes + INSERT `drawer_opens('cash_sale', saleId)`. All post-filing, no I/O.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(server): print-on-sale + cash drawer kick (post-filing outbox)"`

---

### Task 6: Reprint + manual drawer-open + HTTP + UI

- [ ] **Step 1:** Failing tests — `POST /api/sales/:id/reprint` re-enqueues the filed sale's receipt (no re-filing); `POST /api/drawer/open` enqueues a kick-only job + records `drawer_opens('manual')`, `drawer.no_printer` when unset; management routes set `tills.receipt_printer_id` + `locations.receipt_print_mode` (`printer.manage`, gate by deletion); the till ticket screen gains Reprint + Abrir cajón; the dashboard Impresoras gains the receipt-printer picker + mode toggle.
- [ ] **Step 2:** Run → FAIL → implement the routes (`requireSession`/`gated`, `run`, `STATUS`, `requireUuidId`); `TillApi.reprint`/`openDrawer`; the till buttons; `DashboardApi.setTillReceiptPrinter`/`setReceiptPrintMode` + the UI. a11y both themes.
- [ ] **Step 3:** Prove the config gate by deletion. PASS, coverage. Commit. `git commit -s -m "feat(server+ui): reprint, manual drawer-open (audited), receipt-printer config"`

---

### Task 7: Fiscal grep, guards, backlog

- [ ] **Step 1:** H2 grep — `git diff` shows `packages/core/src/record-sale.ts` + the alta builders **unchanged**; `grep -rn "receipt_printer\|drawer\|formatReceipt" packages/core packages/fiscal-verifactu/src/backend.ts` → the formatter reads `TillSaleResult` only, writes no fiscal table. Record in the commit.
- [ ] **Step 2:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest.
- [ ] **Step 3:** Flip `docs/backlog.md` — customer-receipt + cash-drawer printing **BUILT**; note the `cash.drawer` permission gate (fast-follow, needs the till `authorize()` path) + `cloud_poll` remain.
- [ ] **Step 4:** Commit. `git commit -s -m "docs(backlog): receipt + drawer printing built; chore: H2 receipt receipt"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2 schema → T1; §3a `qr()` → T3; §3b `formatReceipt` → T4; §3c print-on-sale+kick → T5; §3d reprint+manual-open → T6; §3e HTTP → T6; §5 client → T6; §4 fiscal → T7. No gaps.

**2. Placeholder scan** — real test/impl throughout; deferrals are the subsystem re-verification (Prerequisites), the `db:generate` number, and the `cash.drawer` permission gate (spec §8, needs the till `authorize()` path) — all flagged.

**3. Type consistency** — `receipt_printer_id`/`receipt_print_mode` consistent T1→T5→T6; `formatReceipt({ result, issuer, receipt, invoiceLocale })` defined once (T4) and called by print-on-sale + reprint (T5/T6); `qr(text,{ecLevel})` defined once (T3); `drawer_opens` reasons `cash_sale`/`manual` consistent T1/T5/T6; `enqueuePrintJob` is Slice A's, unchanged. The completeness test (T4) and never-block test (T5) are the two load-bearing proofs.

**Known cross-slice risk** (flagged): `formatReceipt` must stay in lock-step with `till-ticket-view`'s mandated elements — if the screen receipt changes, both change together (a shared element list would prevent drift; noted). The `qr()` module size for 30–40 mm depends on printer dpi — verified manually on the real printer (fake-sink asserts the command shape).
