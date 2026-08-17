# KDS-4 — Kitchen printing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route a station's fired items to paper — a station↔printer many-to-many, print-on-fire that enqueues kitchen tickets (via the printing subsystem), and a group printer that gets one consolidated ticket per fire.

**Architecture:** A `station_printers` join; print-on-fire extends KDS-1's `fireLines`/KDS-2's `fireCourse` to `enqueuePrintJob` (Slice A) — an outbox INSERT, never blocking; a kitchen-ticket formatter on Slice A's ESC/POS builder; `ticket_scope='order'` dedupes to one ticket per fire. Non-fiscal.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, Lit + Vite, Vitest (+ browser), Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-kds-4-kitchen-printing-design.md](../specs/2026-08-17-kds-4-kitchen-printing-design.md).

## ⛔ Prerequisites — BLOCKED until the printing subsystem + KDS-1 (→ KDS-2, TS-1/FP-1) land

Re-verify first (CLAUDE.md §1): **Slice A** — `enqueuePrintJob(tx, cfg, printerId, bytes)`, the ESC/POS builder (`init`/`text`/`line`/`cut`), `printers` (+ `ticket_scope`), `printer.not_found`; **KDS-1** — `kitchen_stations`, `fireLines` (the fire point + its newly-fired item set), `station.not_found`; **KDS-2** — `fireCourse` (the other fire path); the RLS idiom (`0036`); `inmutabilidad`.

## Global Constraints

- **English identifiers** — `station_printers`, `station_id`, `printer_id`. No new `SPANISH_WORDS`. UI copy en/es.
- **Never block a fire/sale** — print-on-fire only calls `enqueuePrintJob` (an outbox INSERT); no hardware I/O in the fire path (Slice A's guarantee; a test re-pins it here).
- **Domain codes** — reuse `station.not_found` + `printer.not_found`; no new code. `import "./errors.js"`.
- **Permissions** — `printer.manage` (mapping), `requireSession` (reprint). No new permission.
- **No back-compat / data-migration** (pre-production). **Migration number via `db:generate`.** Re-run `inmutabilidad`.
- **Coverage:** db, server → 98/98/98/95; dashboard → 95/95/90/88. Real-PG for RLS. `TESTCONTAINERS_RYUK_DISABLED=true`. Prove guards by deletion.

## File Structure

**Created:** `packages/db/src/schema/station-printers.ts` (+ `.rls.test.ts`); `packages/db/drizzle/<NNNN>_station_printers.sql` + `<NNNN>_station_printers_rls.sql`; a kitchen-ticket formatter (`apps/server/src/kitchen-ticket.ts`).
**Modified:** `packages/db/src/schema/index.ts`; `apps/server/src/{working-order.ts (fireLines/fireCourse), management-api.ts, till-api.ts}`; `apps/dashboard/src/{screens/…, api/client.ts}` (station↔printer mapping + reprint); `docs/backlog.md`.

---

### Task 1: Schema — `station_printers` + migration + RLS

- [ ] **Step 1:** `station-printers.ts` — §2a (PK `(tenant_id, station_id, printer_id)`, bare `station_id`/`printer_id` uuids). Register in `index.ts`.
- [ ] **Step 2:** `db:generate` → verify (the join table). Note `<NNNN>`.
- [ ] **Step 3:** Custom `<NNNN+1>_station_printers_rls.sql` — FORCE RLS + policy + `GRANT SELECT,INSERT,DELETE`; the two composite FKs (`→ kitchen_stations`, `→ printers`). Register in `_journal.json`.
- [ ] **Step 4:** RLS test (real-PG) — isolation + negative `WITH CHECK`; prove FORCE by deletion.
- [ ] **Step 5:** Guards — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`.
- [ ] **Step 6:** Commit. `git commit -s -m "feat(db): station_printers mapping with FORCE RLS"`

---

### Task 2: attach / detach / list verbs

- [ ] **Step 1:** Failing test — attach (idempotent), detach, list; `station.not_found` / `printer.not_found` for bad ids.
- [ ] **Step 2:** Run → FAIL → implement `attachPrinterToStation`/`detachPrinterFromStation`/`listStationPrinters` (import `"./errors.js"`; validate both live). `ON CONFLICT DO NOTHING` for idempotent attach.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(server): station-printer attach/detach verbs"`

---

### Task 3: Kitchen-ticket formatter

- [ ] **Step 1:** Failing test — `formatKitchenTicket({ scope:'station', stationName:'Cocina', tableLabel:'Mesa 4', … items })` returns bytes containing "Cocina", "Mesa 4", the qty×name lines, ending in a cut; an `order`-scope ticket groups by station.
- [ ] **Step 2:** Run → FAIL → implement `kitchen-ticket.ts` using Slice A's ESC/POS builder (header per scope, bold table/order, qty×name lines, group-by-station for order scope, cut).
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(server): kitchen-ticket ESC/POS formatter"`

---

### Task 4: Print-on-fire (extend fireLines/fireCourse) + the order-scope dedupe

- [ ] **Step 1:** Failing test:
```ts
it("prints per-station tickets and one consolidated ticket for a group printer", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
  const barra = await createStation(tx, cfg, { name: "Barra" });
  const pCocina = await createPrinter(tx, cfg, { name: "Cocina", transport:"network_tcp", ticketScope:"station", /*…*/ });
  const pGroup  = await createPrinter(tx, cfg, { name: "Pase", transport:"network_tcp", ticketScope:"order", /*…*/ });
  await attachPrinterToStation(tx, cfg, { stationId: cocina.id, printerId: pCocina.id });
  await attachPrinterToStation(tx, cfg, { stationId: cocina.id, printerId: pGroup.id });
  await attachPrinterToStation(tx, cfg, { stationId: barra.id,  printerId: pGroup.id });
  await fireOrderWith(tx, cfg, [line(steak,{station:cocina.id}), line(beer,{station:barra.id})]);
  const jobs = await printJobsFor(tx);
  expect(jobs.filter(j => j.printerId === pCocina.id)).toHaveLength(1);   // station ticket: Cocina items
  expect(jobs.filter(j => j.printerId === pGroup.id)).toHaveLength(1);    // ONE consolidated ticket, not two
});
it("never opens a socket on fire", async () => { /* Slice A never-block re-pinned */ });
```
- [ ] **Step 2:** Run → FAIL → implement — after `fireLines`/`fireCourse` write the newly-fired items: group them by station; for each station's attached `ticket_scope='station'` printers, `enqueuePrintJob(formatKitchenTicket(station-scope))`; collect the distinct `ticket_scope='order'` printers across the event's stations and enqueue **one** consolidated ticket each (dedupe by printer_id). All within the fire tx; no hardware I/O.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(server): print-on-fire (station + deduped group tickets)"`

---

### Task 5: Reprint + HTTP + dashboard mapping

- [ ] **Step 1:** Failing tests — `reprintOrderTickets` re-enqueues an order's current tickets; management `POST/DELETE /management-api/stations/:sid/printers/:pid` (`printer.manage`, 401/403/manager, gate by deletion); till `POST /api/orders/:id/reprint` (`requireSession`); the dashboard station↔printer multi-select attaches/detaches and the station display/expo gain a Reprint action.
- [ ] **Step 2:** Run → FAIL → implement the verb + routes (`gated`/`requireSession`, `run`, `STATUS`, `requireUuidId`); the dashboard mapping UI (a stations multi-select on the printer editor; `DashboardApi.attachPrinterToStation`/`detach`/`listStationPrinters`; a Reprint button). a11y both themes.
- [ ] **Step 3:** Prove the config gate by deletion. PASS, coverage. Commit. `git commit -s -m "feat(server+ui): station-printer mapping, reprint, print config UI"`

---

### Task 6: Fiscal grep, guards, backlog

- [ ] **Step 1:** `grep -rn "print\|station_printers" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → zero hits; the never-block test (Task 4) green. Record in the commit.
- [ ] **Step 2:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest. No new package (schema in `packages/db`, formatter in `apps/server`) — no `GENERIC_PACKAGES` churn.
- [ ] **Step 3:** Flip `docs/backlog.md` — KDS-4 kitchen printing **BUILT**; note the printing subsystem's `cloud_poll` + receipt/cash-drawer consumers remain.
- [ ] **Step 4:** Commit. `git commit -s -m "docs(backlog): KDS-4 kitchen printing built; chore: fiscal grep receipt"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2a `station_printers` → T1; §3a config verbs → T2; §3b print-on-fire + dedupe → T4; §3c formatter → T3; §3d reprint → T5; §3e HTTP → T5; §5 dashboard → T5; §4 fiscal → T6. No gaps.

**2. Placeholder scan** — real test/impl throughout; deferrals are the Slice-A/KDS-1/KDS-2 re-verification (Prerequisites) + the `db:generate` number — both flagged.

**3. Type consistency** — `attachPrinterToStation({ stationId, printerId })` consistent T2→T5; `formatKitchenTicket(scope, …) → Uint8Array` defined once (T3) and called by print-on-fire (T4); `enqueuePrintJob(printerId, bytes)` is Slice A's, used unchanged (T4); `ticket_scope` values `station`/`order` consistent T3/T4/T5; reuse `station.not_found`/`printer.not_found` (no new codes). The order-scope **dedupe** (one job per group printer per fire) is the single new rule and is pinned by the T4 load-bearing test.

**Known cross-slice risk** (flagged): print-on-fire hooks KDS-1's `fireLines` + KDS-2's `fireCourse` and calls Slice A's `enqueuePrintJob` — re-verify all three at execution; the migration sequences after both KDS-1's and the printing subsystem's (the FK targets).
