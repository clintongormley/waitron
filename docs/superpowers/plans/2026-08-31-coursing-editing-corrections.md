# Coursing Editing & Kitchen Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a waiter edit an order's coursing plan (move a held line to another course, hold/send lines finer than a whole course) and correct mistakes after firing (recall a not-started line, cancel a started one), with the kitchen always told.

**Architecture:** Pure extension of the existing KDS coursing machinery. A tab line has two independent facets — its **course** (`working_order_lines.course_id`) and its **fire state** (`ticket_items.fired_at` null = held, set = fired; `ticket_items.state` = `queued|preparing|ready`). New server verbs mutate those existing columns under the same `lockOpenTab` + `withTenant`/`asAppUser` discipline the current tab verbs use. Recall/cancel of a *previously-fired* line enqueues a correction slip through the existing print outbox (opaque ESC/POS bytes — no schema). The till gains per-line move/hold/send/recall/cancel affordances.

**Tech Stack:** TypeScript, Hono (HTTP), Drizzle (SQL), Postgres + PGlite (tests), Vitest, Lit (till, browser-mode vitest), `@waitron/printing` ESC/POS builder.

**Spec:** `docs/superpowers/specs/2026-08-31-coursing-editing-corrections-design.md` — the plan argues from it; executors read both.

## Global Constraints

- **No migrations.** Every column reused already exists (`working_order_lines.course_id`, `ticket_items.course_id`/`fired_at`/`state`, `0057_kds2_courses_fire.sql`). "Hold" is transient (read at fire time, never stored). The correction slip is opaque `print_jobs.payload` bytes — `print_jobs` has no job-kind column and needs none. If a task believes it needs a migration, STOP — it has diverged from this plan.
- **Non-fiscal only.** Everything lives on `working_order_lines` (open tab) and `ticket_items` (mutable kitchen). Nothing here reads or writes a filed record, tender, registro, or huella. No `sale_lines` change. Do not touch the pay path.
- **Error codes name the domain concept, never the package** (`packages/shared/src/errors.ts:35-51`). New codes carry a doc-comment (condition, params + why safe to echo, prefix justification, HTTP status, "Never renamed once shipped.") and go in `apps/server/src/errors.ts` via `declare module`, plus the `STATUS` map in `apps/server/src/till-api.ts:148`. Params are qualified (`ticketItemId`, `tabId`, `lineNo`, `courseId`) — never a bare `id`.
- **Grep the siblings before naming** an error code or a param — `apps/server/src/errors.ts` `ticket.*`/`tab.*`/`course.*` families. Codes are never renamed once shipped.
- **`apps/server` identifiers are out of the english-only guard's scope** (`packages/db/src/english-only.ts:33-63`); no `SPANISH_WORDS` change is needed anywhere in this work.
- **Server verb suites are PGlite** (`usePgliteDb`) for logic; **RLS/concurrency go in `working-order.rls.test.ts`** (`useTemplateDb`). PGlite serialises, so a contention test there is a false pass (CLAUDE.md §4). Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Gate before every commit:** `pnpm --filter @waitron/... test:coverage` for the touched package (not plain `test` — CI runs coverage), plus `pnpm lint && pnpm typecheck && pnpm format:check`. `apps/server` thresholds are 98/98/98/95; till (`apps/till`) is 95/95/90/88.
- **Any new field on the server `TabLine` must be mirrored by hand into the client `TabLine`** in `apps/till/src/api/client.ts` (they are intentionally not imported across the bundle boundary).

---

## File map

- **Modify** `apps/server/src/working-order.ts` — new verbs `setLineCourse`, `sendLines`, `recallLines`; extend `fireLines` with a per-line `hold` override; extend `addTabRound` to thread hold; extend `voidTabLine` to emit a VOID correction; add `state` to `readTabLines`/`TabLine`.
- **Modify** `apps/server/src/kitchen-print.ts` — new `enqueueCorrectionSlips`.
- **Modify** `apps/server/src/kitchen-ticket.ts` — new `formatCorrectionSlip`.
- **Modify** `apps/server/src/till-api.ts` — new routes; new `STATUS` entries.
- **Modify** `apps/server/src/errors.ts` — new codes.
- **Test** `apps/server/src/working-order.test.ts` (PGlite verb logic), `apps/server/src/working-order.rls.test.ts` (RLS/concurrency), `apps/server/src/kitchen-ticket.test.ts` (slip bytes), `apps/server/src/till-api.*.test.ts` (routes).
- **Modify** `apps/till/src/api/client.ts` — `TabLine` mirror + new client methods.
- **Modify** `apps/till/src/screens/till-table-order-screen.ts` (+ its store/widgets) — course-move control, hold toggle, send/recall/cancel actions, confirm dialogs.

---

# Phase A — Server capability (verbs, routes, corrections)

### Task A1: `setLineCourse` — move a held line to another course

**Files:**
- Modify: `apps/server/src/working-order.ts` (new verb near `voidTabLine:1276`)
- Modify: `apps/server/src/till-api.ts` (new route; `STATUS`)
- Modify: `apps/server/src/errors.ts` (new code `ticket.already_fired` reused; new `course.*`? no — reuse)
- Test: `apps/server/src/working-order.test.ts`

**Interfaces:**
- Consumes: `lockOpenTab(tx, tabId)`, `requireLiveCourse(tx, cfg, courseId)` (`kitchen.ts:389`), `workingOrderLines`, `ticketItems` schema.
- Produces: `setLineCourse(tx: Transaction, cfg: TillConfig, tabId: string, lineNo: number, courseId: string | null): Promise<void>`.

**Behaviour:** Move a not-yet-fired line into an active course (or clear it → null). Update `working_order_lines.course_id`; if the line has a **held** ticket item update its `ticket_items.course_id` snapshot too. Refuse if the line's ticket item has already **fired** (`fired_at IS NOT NULL`) → `ticket.already_fired`. A non-null target course is validated with `requireLiveCourse` (a retired course is not a valid new target, mirroring `setProductCourse`). Absent line → `tab.line_not_found`.

- [ ] **Step 1: Write the failing tests** (append near the fire/course block ~`working-order.test.ts:1026`). Use the existing `setupVenue`/`makeProduct`/`placeOrderWith`/`ticketItemsFor` helpers.

```ts
describe("setLineCourse", () => {
  it("moves a HELD line to another course, updating both course_id snapshots", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const { orderId, lineNo, mainsCourseId } = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const starters = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const mains = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const p = await makeProduct(tx, cfg, catalogueId, { courseId: mains }); // defaults to mains
      // place with the line rung to STARTERS (earliest) so it fires; then we move a HELD one.
      const held = await makeProduct(tx, cfg, catalogueId, { courseId: mains });
      const { id } = await placeOrderWith(tx, cfg, [line(p, { courseId: starters }), line(held)]);
      // line 2 (held mains) is held; move it to starters
      return { orderId: id, lineNo: 2, mainsCourseId: mains, startersCourseId: starters };
    });
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await setLineCourse(tx, cfg, orderId, lineNo, /* startersCourseId */ mainsCourseId);
    });
    // assert working_order_lines.course_id AND ticket_items.course_id both moved (read them back)
  });

  it("refuses to re-course a FIRED line (ticket.already_fired)", async () => {
    // place a single line to the earliest course so it auto-fires, then setLineCourse → reject
    // expect rejects.toMatchObject({ code: "ticket.already_fired", params: { workingOrderId: orderId } })
  });

  it("refuses an unknown/retired target course (course.not_found)", async () => {
    // setLineCourse to a random uuid → rejects course.not_found
  });

  it("throws tab.line_not_found for a line_no not on the tab", async () => {
    // setLineCourse(orderId, 999, courseId) → rejects tab.line_not_found
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail** — `pnpm --filter @waitron/server test working-order -t setLineCourse`. Expected: FAIL (`setLineCourse is not defined`).

- [ ] **Step 3: Implement `setLineCourse`** (mirror `voidTabLine`'s lock + resolve-line shape):

```ts
export async function setLineCourse(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
  courseId: string | null,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  if (courseId !== null) await requireLiveCourse(tx, cfg, courseId);
  const [target] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (target === undefined) throw new AppError("tab.line_not_found", { tabId, lineNo });
  // Refuse if this line's ticket item has already fired — a fired line is corrected via recall, not move.
  const [item] = await tx
    .select({ firedAt: ticketItems.firedAt })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, target.id));
  if (item?.firedAt != null) throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  await tx
    .update(workingOrderLines)
    .set({ courseId })
    .where(eq(workingOrderLines.id, target.id));
  await tx
    .update(ticketItems)
    .set({ courseId })
    .where(eq(ticketItems.workingOrderLineId, target.id)); // no-op if no (held) item yet
}
```

- [ ] **Step 4: Add the route** in `till-api.ts` (mimic the served `:lineNo` POST at `:1490`, but `PATCH`, body carries the course):

```ts
app.patch("/api/working-orders/:id/lines/:lineNo/course", (c) =>
  run(c, log, async () => {
    await requireSession(deps, c);
    const id = requireTabParam(c.req.param("id"));
    const lineNo = requireLineNo(id, c.req.param("lineNo"));
    const body = await c.req.json<{ courseId: string | null }>();
    if (body.courseId != null && !isUuid(body.courseId))
      throw new AppError("course.not_found", { courseId: body.courseId });
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await setLineCourse(tx, deps.cfg, id, lineNo, body.courseId);
    });
    return c.body(null, 200);
  }),
);
```

- [ ] **Step 5: Run tests + gate.** `pnpm --filter @waitron/server test:coverage working-order` then `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(coursing): setLineCourse — move a held line to another course"`

---

### Task A2: `sendLines` — fire specific held lines (finer than a whole course)

**Files:**
- Modify: `apps/server/src/working-order.ts` (new verb; mirror `fireCourse:1091`)
- Modify: `apps/server/src/till-api.ts` (route `POST /api/working-orders/:id/lines/send`)
- Test: `apps/server/src/working-order.test.ts`

**Interfaces:**
- Consumes: `ticketItems`, `enqueueKitchenTickets(tx, cfg, orderId, firedItems)`, `lockOpenTab`.
- Produces: `sendLines(tx: Transaction, cfg: TillConfig, tabId: string, lineNos: number[]): Promise<void>`. Empty `lineNos` releases **every** held line of the tab ("send all together").

**Behaviour:** Stamp `fired_at = now()` on the named lines' **held** ticket items, refresh `queued_at = now()` (so the #185 timing clock starts from the send, not the ring), and enqueue their kitchen prints. Reuse `fireCourse`'s update+returning+enqueue shape but key on the line set (or all-held when `lineNos` is empty). Already-fired lines in the set are untouched (the `fired_at IS NULL` predicate skips them), matching `fireCourse`'s idempotence.

- [ ] **Step 1: Write failing tests** — send a subset of held tapas: two lines held in the same later course, `sendLines(tab, [2])` fires exactly line 2 (its `fired_at` set, `queued_at` refreshed), line 3 stays held; `sendLines(tab, [])` fires all remaining held; assert `enqueueKitchenTickets` ran (a held line produced no print until sent — spy or read `print_jobs`).

- [ ] **Step 2: Run, verify fail** (`sendLines is not defined`).

- [ ] **Step 3: Implement** (line-keyed variant of `fireCourse`):

```ts
export async function sendLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  await lockOpenTab(tx, tabId);
  const lineFilter =
    lineNos.length === 0
      ? undefined
      : inArray(
          ticketItems.workingOrderLineId,
          tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(
              and(
                eq(workingOrderLines.workingOrderId, tabId),
                inArray(workingOrderLines.lineNo, lineNos),
              ),
            ),
        );
  const fired = await tx
    .update(ticketItems)
    .set({ firedAt: sql`now()`, queuedAt: sql`now()` })
    .where(
      and(
        eq(ticketItems.workingOrderId, tabId),
        isNull(ticketItems.firedAt),
        ...(lineFilter ? [lineFilter] : []),
      ),
    )
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
    });
  await enqueueKitchenTickets(tx, cfg, tabId, fired);
}
```

- [ ] **Step 4: Add the route** (no `:lineNo` path param — the list is in the body, parsed like `/round`):

```ts
app.post("/api/working-orders/:id/lines/send", (c) =>
  run(c, log, async () => {
    await requireSession(deps, c);
    const id = requireTabParam(c.req.param("id"));
    const body = await c.req.json<{ lineNos?: number[] }>();
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await sendLines(tx, deps.cfg, id, body.lineNos ?? []);
    });
    return c.body(null, 200);
  }),
);
```

- [ ] **Step 5: Run tests + gate.** PASS.
- [ ] **Step 6: Commit** — `feat(coursing): sendLines — fire specific held lines / send-all`

---

### Task A3: `hold` on send — insert lines held without firing

**Files:**
- Modify: `apps/server/src/working-order.ts` (`fireLines:865`, `addTabRound:1217`; also `placeOrder`/`sendToPrep` pass-through of the new optional field as `undefined`)
- Modify: `apps/server/src/till-api.ts` (`/round` body type gains `hold?: boolean`)
- Test: `apps/server/src/working-order.test.ts`

**Interfaces:**
- Produces: `fireLines` `lines` element gains optional `hold?: boolean`; the `/round` wire line gains optional `hold?: boolean`.

**Behaviour:** A round line may carry `hold: true`. That line inserts **held** (`fired_at NULL`, greyed on the KDS, no print) even if its course would auto-fire. Absent `hold`, today's auto-fire rule is unchanged (backward compatible). `addTabRound` must correlate each input round line's `hold` to the parent line row that `priceOrderLines` produced for it (parents carry `parentLineId === null`, emitted in input order — verify this ordering in `priceOrderLines` while implementing; pin it with the modifier'd-line test below).

- [ ] **Step 1: Write failing tests.**
  - Ring two starters (earliest course) via a round, `hold: true` on the second → line 1 fires (`fired_at` set, a print enqueued), line 2 is held (`fired_at` null, no print). Assert against `ticket_items` and `print_jobs`.
  - Correlation guard: a round of `[plainProduct (hold:true), productWithModifiers (hold:false)]` → the **plain** parent is held and the **modified** parent (plus its child rows) fires; proves `hold` maps to the right parent when option expansion changes row counts.

- [ ] **Step 2: Run, verify fail** (line 2 currently fires — the assertion that it is held fails).

- [ ] **Step 3: Implement.**
  - In the `fireLines` `lines` type add `hold?: boolean`. In the fired decision (`working-order.ts:1017`) short-circuit: `const fired = line.hold === true ? false : (courseId === null || firedCourseIds.has(courseId) || displayOrderByCourse.get(courseId) === earliestDisplayOrder);`
  - In `addTabRound`, after building `appended`/`appendedLines`, correlate hold from `lines` (input) onto the returned parent rows in order:

```ts
let parentIx = 0;
const withHold = appendedLines.map((al) => {
  if (al.parentLineId !== null) return { ...al, hold: false };
  const hold = lines[parentIx]?.hold === true;
  parentIx += 1;
  return { ...al, hold };
});
await fireLines(tx, cfg, tabId, withHold);
```
  - Add `hold?: boolean` to the `/round` route body element and to `addTabRound`'s `lines` param type. `placeOrder`/`sendToPrep` select lines without `hold` (their elements simply omit it → `undefined` → not held), so they are unaffected.

- [ ] **Step 4: Run tests + gate.** PASS. Confirm existing `addTabRound`/`placeOrder` fire tests are still green (backward compatibility).
- [ ] **Step 5: Commit** — `feat(coursing): hold lines on send (insert held, no fire, no print)`

---

### Task A4: `recallLines` — un-send a not-started line

**Files:**
- Modify: `apps/server/src/working-order.ts` (new verb)
- Modify: `apps/server/src/errors.ts` (new `ticket.already_started`) + `till-api.ts` `STATUS`
- Modify: `apps/server/src/till-api.ts` (route `POST /api/working-orders/:id/lines/recall`)
- Test: `apps/server/src/working-order.test.ts`

**Interfaces:**
- Produces: `recallLines(tx: Transaction, cfg: TillConfig, tabId: string, lineNos: number[]): Promise<void>`.
- New error: `"ticket.already_started": { ticketItemId: string }` → **409**.

**Behaviour:** Set `fired_at = NULL` on the named lines' ticket items **where `state = 'queued'`** (the clean recall window) — the line greys back to held, re-editable by A1/A2. A named line whose item is `preparing`/`ready` is a state conflict → `ticket.already_started` (the till offers cancel instead). A named line with no fired item (already held, or absent) → resolve like the other tab verbs: absent `line_no` is `tab.line_not_found`; an already-held line is a no-op (its `fired_at` is already null). The correction slip for a recalled *previously-printed* line is added in Task A6.

- [ ] **Step 1: Add the error code** with doc-comment in `errors.ts` (grep the `ticket.*` family first; model the comment on `ticket.item_held:807-826`). Add `"ticket.already_started": 409` to `STATUS` (`till-api.ts` `ticket.*` block ~`:189`).

```ts
/**
 * A recall was asked for a line the kitchen has already STARTED (`ticket_items.state` is
 * `preparing`/`ready`, not `queued`). Recall un-fires a line back to held, which is only clean while
 * nothing is cooking; once started the food is real, so the correction is a cancel (void), not a recall.
 * The inverse-direction sibling of `ticket.already_fired` / `ticket.not_fired`. `ticketItemId` is echoed
 * so the till can point at the exact line; it is an opaque uuid, safe to echo. Maps to 409. Never renamed
 * once shipped.
 */
"ticket.already_started": { ticketItemId: string };
```

- [ ] **Step 2: Write failing tests** — fire a line, `recallLines(tab, [n])` → `fired_at` back to null, `state` still `queued`; a line advanced to `preparing` then recalled → rejects `ticket.already_started`; recall of an already-held line → resolves (no-op); recall of an absent line_no → `tab.line_not_found`.

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement** — resolve the named lines to ticket items; if any is `preparing`/`ready` throw `ticket.already_started` with its `id`; else `UPDATE ticket_items SET fired_at = NULL WHERE workingOrderId AND state='queued' AND lineId IN (…)`. Use `lockOpenTab` first. (Read the items before the update so the started-check can name the offending `ticketItemId`.)

- [ ] **Step 5: Add the route** (body `{ lineNos: number[] }`, like `/lines/send`).

- [ ] **Step 6: Run tests + gate.** PASS.
- [ ] **Step 7: Commit** — `feat(coursing): recallLines — un-send a not-started line`

---

### Task A5: correction slip formatter

**Files:**
- Modify: `apps/server/src/kitchen-ticket.ts` (new `formatCorrectionSlip`)
- Test: `apps/server/src/kitchen-ticket.test.ts`

**Interfaces:**
- Consumes: `esc()` (`@waitron/printing`), `itemLine`, `emitItem`, `hhmm` (kitchen-ticket.ts internals).
- Produces: `formatCorrectionSlip(slip: CorrectionSlip): Uint8Array`, with `interface CorrectionSlip { kind: "VOID" | "RECALLED"; stationName: string; tableLabel: string | null; orderNumber: string; at: string; item: KitchenTicketItem }`.

**Behaviour:** A single-item slip whose header line is `*** VOID ***` / `*** RECALLED ***` (ESC/POS has no bold — `kitchen-ticket.ts` header note), then `stationName`, `tableLabel`, `orderNumber`, `hhmm(at)`, then the item via the existing `emitItem` (so `2 x Steak` + `  + <modifier>` render identically to the kitchen ticket the cook already has). Reuse the `esc().init()…feed(3).cut().bytes()` envelope.

- [ ] **Step 1: Write failing test** — `formatCorrectionSlip({ kind: "VOID", stationName: "Cocina", tableLabel: "Mesa 6", orderNumber: "A-12", at: "...", item: { qty: 2, name: "Tiramisu", modifiers: ["extra nata x2"] } })` → decode bytes and assert the string contains `VOID`, `Tiramisu`, `2 x Tiramisu`, `+ extra nata x2`, `Mesa 6`, `A-12`. (Mirror the existing `formatKitchenTicket` tests' decode approach.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** reusing `emitItem`/`itemLine`/`hhmm`.
- [ ] **Step 4: Run + gate.** PASS.
- [ ] **Step 5: Commit** — `feat(coursing): correction slip formatter (VOID/RECALLED)`

---

### Task A6: enqueue corrections on recall & void

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` (new `enqueueCorrectionSlips`)
- Modify: `apps/server/src/working-order.ts` (`recallLines` emits RECALLED; `voidTabLine` emits VOID)
- Test: `apps/server/src/working-order.test.ts`

**Interfaces:**
- Consumes: the `station_printers → printers` lookup pattern (`kitchen-print.ts:109-133`), `enqueuePrintJob`, `formatCorrectionSlip`.
- Produces: `enqueueCorrectionSlips(tx, cfg, orderId, items: { workingOrderLineId: string; stationId: string }[], kind: "VOID" | "RECALLED"): Promise<void>`.

**Behaviour:** Only a **previously-fired (printed)** line produces a slip — a held line's recall/void enqueues nothing (no paper was out). `enqueueCorrectionSlips` reads each line's `descriptions`/`quantity`/modifiers (the `enqueueKitchenTickets` read shape), resolves each station's active printers via the same locked lookup, formats a slip per item, and `enqueuePrintJob`s it. Wire it in:
- **recallLines** — after clearing `fired_at`, call `enqueueCorrectionSlips(tx, cfg, tabId, recalledItems, "RECALLED")` for the items that were fired before the recall (the update's own knowledge of which were `queued`+fired).
- **voidTabLine** — **before** the delete cascade, read the target line's ticket item; if it had `fired_at` set, capture `{ workingOrderLineId, stationId }` + its descriptions, then after the delete call `enqueueCorrectionSlips(tx, cfg, tabId, [captured], "VOID")`. (Reading before delete is mandatory — the cascade removes the item.)

- [ ] **Step 1: Write failing tests** — (a) recall a fired line → exactly one `print_jobs` row at that station's printer with `RECALLED` bytes; (b) recall a *held* line → zero new `print_jobs`; (c) void a fired line → one `VOID` job; (d) void a held line → zero. Assert on `print_jobs` count + payload substring.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `enqueueCorrectionSlips`, then wire into `recallLines` and `voidTabLine`.
- [ ] **Step 4: Run + gate.** PASS.
- [ ] **Step 5: Commit** — `feat(coursing): correction slips on recall & void`

---

# Phase B — RLS & concurrency (real Postgres)

### Task B1: RLS + race coverage for the new verbs

**Files:**
- Modify: `apps/server/src/working-order.rls.test.ts` (`useTemplateDb({ template: "manifest" })`, `:64`)

**Behaviour:** PGlite cannot prove tenant confinement or a two-backend race (CLAUDE.md §4). Add, as `app_user` on real Postgres:
- **RLS confinement:** `setLineCourse`/`sendLines`/`recallLines` on another tenant's tab id resolve nothing (`tab.not_open`/`tab.line_not_found`), never touching the other tenant's rows.
- **Round-send racing a recall:** two concurrent transactions — one `sendLines`, one `recallLines` on the same held line — serialise via `lockOpenTab`'s `FOR UPDATE`; the final `fired_at` is deterministic, no lost update. (Model on the existing concurrency test the file already documents at `:49-55`.)

- [ ] **Step 1: Write the failing RLS/race tests** (copy the file's existing two-connection helper).
- [ ] **Step 2: Run** with `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test working-order.rls` — verify fail.
- [ ] **Step 3:** No new impl expected (the verbs already lock/scope); if a test exposes a missing lock, fix the verb.
- [ ] **Step 4: Run + gate** (`test:coverage`, `pnpm reap` after). PASS.
- [ ] **Step 5: Commit** — `test(coursing): RLS + send/recall race coverage`

---

# Phase C — Read model & till UX

### Task C1: expose `state` on the tab-line read

**Files:**
- Modify: `apps/server/src/working-order.ts` (`TabLine:1524`, `readTabLines:1562`)
- Modify: `apps/till/src/api/client.ts` (client `TabLine` mirror `:886`)
- Test: `apps/server/src/working-order.test.ts` (or the readTabLines suite), `apps/till/src/api/client.test.ts`

**Interfaces:**
- Produces: server & client `TabLine` gain `state: TicketState | null` (`"queued" | "preparing" | "ready"`, null when the line has no ticket item yet). The till uses `firedAt === null` ⇒ held, `state === 'queued'` ⇒ recallable, `state in (preparing,ready)` ⇒ cancel-only.

- [ ] **Step 1: Write failing test** — `readTabLines` returns `state` per line: a fired-and-queued line → `"queued"`; assert the field is present. Update the client `TabLine` type test if one pins the shape.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add `state: ticketItems.state` to the `readTabLines` SELECT (already left-joins `ticket_items`); add `state` to both `TabLine` interfaces. Mirror by hand into `apps/till/src/api/client.ts`.
- [ ] **Step 4: Run + gate** (`@waitron/server` and `@waitron/till`). PASS.
- [ ] **Step 5: Commit** — `feat(coursing): expose ticket state on the tab-line read`

---

### Task C2: till API client methods

**Files:**
- Modify: `apps/till/src/api/client.ts` (new methods)
- Test: `apps/till/src/api/client.test.ts`

**Interfaces:**
- Produces: `setLineCourse(orderId, lineNo, courseId: string | null)`, `sendLines(orderId, lineNos: number[])`, `recallLines(orderId, lineNos: number[])` on the till API client (each `#request` to the routes from Phase A). `voidLine` already exists.

- [ ] **Step 1: Write failing tests** mirroring existing client method tests (assert method, path, body). E.g. `setLineCourse("wo-1", 2, "c-9")` → `PATCH /api/working-orders/wo-1/lines/2/course` with `{ courseId: "c-9" }`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the three methods next to `getTabLines:1406`.
- [ ] **Step 4: Run + gate** (`@waitron/till`). PASS.
- [ ] **Step 5: Commit** — `feat(coursing): till API client — setLineCourse/sendLines/recallLines`

---

### Task C3: hold toggle in the round builder

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (round bar; `#roundCourses` sibling `#roundHolds`)
- Test: `apps/till/src/screens/till-table-order-screen.test.ts`

**Behaviour:** Each round line gets a per-line "hold" toggle beside its course picker, tracked in a `#roundHolds = new WeakMap<OrderLine, boolean>()` (mirroring `#roundCourses:377`). `send-round` forwards `hold: true` on held lines to `addTabRound` (extends the existing `{ productId, quantity, courseId }` mapping with `hold`). Default off.

- [ ] **Step 1: Write failing test** — toggling hold on a round line and sending emits `send-round` with that line carrying `hold: true` (mirror `till-app.test.ts:2155` "send-round forwards a per-line course OVERRIDE").
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the toggle + `#roundHolds` + wire into the send-round detail mapping; thread through `till-app.ts`'s round handler to the client `addTabRound`/round call.
- [ ] **Step 4: Run + gate** (browser-mode vitest — do **not** run other browser packages' `test:coverage` concurrently, memory/RAM). PASS.
- [ ] **Step 5: Commit** — `feat(coursing): round-builder hold toggle`

---

### Task C4: per-line course move on the tab

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (tab-line list; reuse the course picker for existing lines)
- Test: `apps/till/src/screens/till-table-order-screen.test.ts`

**Behaviour:** Each **not-yet-fired** tab line (`firedAt === null`) shows a course control (the existing picker component, now bound to `setLineCourse(orderId, lineNo, courseId)`), letting the waiter re-file it. A fired line shows its course read-only. Drag-and-drop is a follow-on nicety (backlog); the picker is the shipped gesture. On change, call the client `setLineCourse`, then reload the tab lines (the existing reload-after-mutation pattern).

- [ ] **Step 1: Write failing test** — changing a held line's course calls `api.setLineCourse(orderId, lineNo, newCourseId)` and reloads; a fired line offers no editable picker.
- [ ] **Step 2–4:** implement + gate.
- [ ] **Step 5: Commit** — `feat(coursing): move a held tab line's course`

---

### Task C5: send / recall / cancel actions with confirms

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts`
- Test: `apps/till/src/screens/till-table-order-screen.test.ts`

**Behaviour:** Per tab line, gated on state:
- `firedAt === null` (held) → **Send** (calls `sendLines(orderId, [lineNo])`); a **Send all** affordance calls `sendLines(orderId, [])`.
- fired + `state === 'queued'` → **Recall** (calls `recallLines(orderId, [lineNo])`).
- fired + `state in (preparing, ready)` → **Cancel** behind a confirm naming the consequence ("kitchen has started this — cancel and bin it?"), calling the existing `voidLine`. Optional **re-order** re-adds the line via the normal round path.
Each action reloads the tab afterward; a rejected call (e.g. a raced `ticket.already_started`) surfaces the existing non-fatal banner and reloads to reconcile (mirror `#onFireCourse:1402`).

- [ ] **Step 1: Write failing tests** — one per branch: held line shows Send and calls `sendLines`; queued fired line shows Recall and calls `recallLines`; preparing line shows Cancel behind a confirm and calls `voidLine`; a rejected recall shows the banner and reloads.
- [ ] **Step 2–4:** implement + gate.
- [ ] **Step 5: Commit** — `feat(coursing): send/recall/cancel line actions with confirms`

---

## Self-review notes (author)

- **Spec coverage:** P1→A1+C4; P2 (send-as-you-go)→A2 (send) + A3 (hold) + C3/C5; P3 (recall)→A4 + C5; P4 (cancel started)→A6 (void correction) + C5 (confirm/re-order, reuses existing `voidTabLine`); P5 (kitchen correction)→A5+A6. Read-model gap for the till's recall-vs-cancel gate→C1 (`state`). All five spec pieces map to tasks.
- **Migrations:** none, per Global Constraints — reconfirmed against `0057_kds2_courses_fire.sql` and `print_jobs` (no kind column).
- **Type consistency:** `sendLines`/`recallLines` both `(tx, cfg, tabId, lineNos: number[])`; `setLineCourse` `(tx, cfg, tabId, lineNo, courseId|null)`; `state: TicketState | null` used identically in server + client `TabLine`.
- **Open detail to verify during A3:** that `priceOrderLines` emits parent rows in input order (the hold correlation relies on it); the modifier'd-line test pins it. If it does not, carry an explicit input-index on the priced rows instead.
