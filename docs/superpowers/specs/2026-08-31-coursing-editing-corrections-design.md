# Coursing editing & kitchen corrections — design

**Date:** 2026-08-31
**Status:** Draft for review
**Branch:** `feat/coursing-editing-corrections`

## 1. What this is, in one paragraph

Waitron already has coursing: a venue configures kitchen courses ("Entrantes",
"Principales", "Postres") with a `display_order`, each line carries a course, the
earliest course auto-fires when an order is sent, later courses sit held (greyed
on the kitchen display) until a waiter releases them. What's missing is the
ability to **edit the coursing plan** and to **correct mistakes** — including
after food has fired. A waiter cannot move a line from one course to another
after it's rung, cannot split one course into two sends ("send four of these
tapas now, four later"), cannot un-send a line fired too early, and when a fired
line is voided the kitchen is never told. This design adds those, reusing the
existing fire/hold machinery wholesale.

It is entirely **non-fiscal** — everything lives on the open tab
(`working_order_lines`) and the kitchen ticket (`ticket_items`), neither of which
is read into a filed record. Nothing here touches an invoice, a huella, or the
chain.

## 2. The problem, from real scenarios

Each of these is a thing a waiter says out loud and cannot currently do:

1. **"Send four of these tapas now, the other four later."** Eight tapas, all in
   the starters course. Today the earliest course fires as a block — all eight or
   none. There is no way to fire a *subset* of one course.
2. **"Oh, I forgot a main — put it with the other mains."** Nothing has fired
   yet. The forgotten main must join the mains course so it goes out with them.
   The per-line course picker only sets a course on a *new* round line as it's
   rung; there is no verb to set the course of a line already on the tab.
3. **"That dessert went into the mains course by mistake — move it to desserts."**
   Nothing has fired. Same gap: no way to re-course a line already on the tab.
4. **"Actually, cancel that — it fired too early."** A line has already fired. If
   the kitchen hasn't started it, we want to pull it back to held. If they have,
   we want to cancel it (accepting we may bin the food) and maybe re-order it —
   and either way the kitchen must be *told*.

## 3. The model: two independent axes

The single idea that makes all of this coherent: a tab line has **two separate
things** that today are tangled together.

- **Course** — *which* course the line belongs to (`working_order_lines.course_id`).
  This is organisation. The kitchen also routes the line to a station from it and
  fires courses in `display_order`.
- **Fire state** — *whether* the line has been released to the kitchen. Held
  (`ticket_items.fired_at IS NULL`, greyed, cannot advance) vs fired (workable),
  as it is today ([ticket-items.ts:70-74](../../../packages/db/src/schema/ticket-items.ts#L70-L74)).

Courses stay the **primary organising structure** — the waiter thinks in courses,
and editing the course plan is first-class. "Send-as-you-go" is a *second* lever
that only matters when the waiter wants to fire **finer than a whole course** (the
tapas split). Most orders never need it; the course sequence carries them.

### The invariant that governs everything

What you can do to a line depends only on its fire state:

| Line state | What's allowed |
| --- | --- |
| **Pending or held** (`fired_at IS NULL`, or no ticket item yet) | Freely re-course, move send timing, void — no kitchen impact, nothing's gone out |
| **Fired, not started** (`state = 'queued'`, `fired_at` set) | **Recall** to held (clean), then edit; or void with a kitchen correction |
| **Fired, started** (`state IN ('preparing','ready')`) | **Cancel** (food may be wasted — an allowed trade), optional re-order, always a kitchen correction |

Recall exists precisely to move a line up that table — from "fired, not started"
back to "held" — so the free-editing rules apply again.

## 4. The five pieces

Anchors below are to the current code the piece extends. New verbs/routes/columns
are marked **NEW**.

### P1 — Edit the course of a not-yet-fired line

**Behaviour.** Move any pending/held line into any active course; add a line to a
course. Covers scenarios 2 and 3, and subsumes "a main as a starter" (put the
main in the starters course).

**Server.** **NEW** `setLineCourse(tx, cfg, tabId, lineNo, courseId)` — updates
`working_order_lines.course_id`, and if the line has a **held** ticket item,
updates that item's `course_id` too (so the greyed KDS entry re-files). **NEW**
route `PATCH /api/working-orders/:id/lines/:lineNo/course`. Guards:
`requireLiveCourse` (an active, this-venue course — the config path's check, not
`requireCourse`); refuse if the line's ticket item has already **fired**
(new error code, §6). The existing per-line course picker on new round lines
([till-table-order-screen.ts:321-377](../../../apps/till/src/screens/till-table-order-screen.ts#L321-L377))
is unchanged; this adds the same capability for lines already on the tab.

**Kitchen effect.** None if the line is still pending (no ticket item). If held,
the greyed entry moves to the new course on the display; on a paper kitchen no
paper has printed yet (held lines print only when fired,
[working-order.ts:1054-1061](../../../apps/server/src/working-order.ts#L1054-L1061)),
so nothing to correct.

### P2 — Send-as-you-go: fire finer than a whole course

**Behaviour.** When sending, the waiter may **hold** specific lines that the
auto-rule would fire, and **send** specific held lines at any time — at line
granularity, not course granularity. Covers scenario 1 and "send everything
together" (send all held lines at once).

**Server.** Two touch points:

- **Hold on send.** The round-send wire already carries per-line fields
  ([till-api.ts:1415-1437](../../../apps/server/src/till-api.ts#L1415-L1437)). Add
  an optional per-line `hold?: boolean`. In the auto-fire decision
  ([working-order.ts:1017-1020](../../../apps/server/src/working-order.ts#L1017-L1020)),
  an explicit `hold` **overrides** the rule → the line inserts held even if its
  course is earliest or already fired. Absent `hold`, today's rule is unchanged
  (backward compatible; non-coursing venues unaffected).
- **Send held lines.** **NEW** `sendLines(tx, cfg, tabId, lineNos[])` — stamps
  `fired_at = now()` on the named lines' held ticket items and enqueues their
  kitchen prints, exactly as [fireCourse](../../../apps/server/src/working-order.ts#L1091)
  does but keyed by line instead of course. Re-fresh `queued_at` so the timing
  clock (#185) starts from the send, not the original ring. **NEW** route
  `POST /api/working-orders/:id/lines/send` with a `lineNos` body (a bare
  `.../send` with no lines, or a "send all" affordance, releases every held line).

**Kitchen effect.** Reuses the fire/enqueue path; sent lines print and go live,
held lines stay greyed.

### P3 — Recall a fired-but-not-started line

**Behaviour.** Un-send a line that fired but the kitchen hasn't started — it
returns to held, then P1/P2 apply again. Covers "it fired too early, pull it
back" when nothing's been cooked.

**Server.** **NEW** `recallLines(tx, cfg, tabId, lineNos[])` — sets
`fired_at = NULL` on the named lines' ticket items **only where `state = 'queued'`**
(the recall-clean window). `app_user` already holds UPDATE on `ticket_items`
([ticket-items.ts:30-35](../../../packages/db/src/schema/ticket-items.ts#L30-L35)),
so no grant change. A line already `preparing`/`ready` is **not** matched — the
route reports it so the till can offer P4 (cancel) instead. **NEW** route
`POST /api/working-orders/:id/lines/recall`.

**Kitchen effect.** Screen entry greys back out. On a paper kitchen a slip has
already printed, so recall enqueues a **correction slip** (§P5).

### P4 — Cancel a fired line (the kitchen has started it)

**Behaviour.** Cancel a line the kitchen is already making. Per the owner's call,
this is **allowed even at the cost of wasted food** — an option we offer, not a
wall. Optionally re-order the same line afterwards (a fresh round line).

**Server.** Reuse the existing [voidTabLine](../../../apps/server/src/working-order.ts#L1276)
— it deletes the line (and its modifier children) from the open tab, pre-fiscal,
and its ticket item cascades away via the line FK. **NEW** work: when the voided
line had a **fired** ticket item, enqueue a **correction slip** before the delete
cascades it (§P5). Re-order is just adding the line again through the normal round
path — no new verb.

**Kitchen effect.** Screen entry disappears; paper kitchens get a "VOID" slip.

### P5 — Tell the kitchen about a correction

**Behaviour.** Any change to an **already-fired** line must reach the kitchen. Two
channels, per the owner: the kitchen display reflects it live (mostly free — the
item greys, moves, or disappears as its row changes), and on a **paper kitchen**
we print a **correction slip** ("VOID: Tiramisu", "RECALLED: Steak", "MOVED to
Postres: Tiramisu"). The person at the pass is the human backstop where paper is
the only channel.

**Server.** **NEW** correction print type in the KDS-4 enqueue path
([kitchen-print.ts:90](../../../apps/server/src/kitchen-print.ts#L90)) — a slip
that names the line, the correction kind, and the station's printers, inserted
into the same outbox as a normal ticket. Only fires for lines that had already
printed (i.e. had a fired ticket item); a pending/held change prints nothing
because nothing was on paper yet.

## 5. Till UX

- **Course editor on the tab.** The per-line course control (a picker today) works
  on existing tab lines, not just new round lines — the waiter re-files a line into
  another course. Drag-and-drop between course groups is the nicer gesture over the
  same `setLineCourse` verb; a picker is the fallback.
- **Hold / send toggles.** Per line while building/holding: "send now" (default,
  from the course rule) vs "hold". A held line shows a "send" action; a "send all"
  affordance releases everything held.
- **Recall / cancel.** A fired line offers "recall" while still queued; once the
  kitchen has started it, the action becomes "cancel" behind a confirm that names
  the consequence ("kitchen has started this — cancel and bin it?"), with optional
  "re-order".
- **Correction confirmations** surface what the kitchen will be told.

All of this is `fire_control = 'waiter'` territory; a `kitchen`-controlled venue
keeps the kitchen-owned fire and these waiter actions are hidden/limited as the
existing fire affordances already are
([till-table-order-screen.ts:324-327](../../../apps/till/src/screens/till-table-order-screen.ts#L324-L327)).

## 6. Error codes (to finalise in the plan)

New codes name the **domain concept**, never the package
([errors.ts convention](../../../packages/shared/src/errors.ts)). Grep the
siblings before settling each — e.g. a re-course of a fired line and a recall of a
started line both need a "too late, it's fired/cooking" code; check whether
`ticket.already_fired` (already used for a double-fire,
[working-order.ts:1049](../../../apps/server/src/working-order.ts#L1049)) fits or a
new `ticket.*` code is warranted. Candidates (provisional): `ticket.already_fired`
(re-course/recall too late), `course.line_not_found`, reuse of `tab.not_open` /
`tab.line_not_found` / `course.not_found` from the existing tab and course verbs.

## 7. Fiscal boundary (why this is safe)

Every surface here is pre-fiscal and stays out of the huella:

- `working_order_lines` (`course_id`, the line itself) is an **open-tab** row; the
  pay path rebuilds `sale_lines` from the locked price snapshot, never these
  columns (the same guarantee `served_at` documents,
  [working-order.ts:1316-1320](../../../apps/server/src/working-order.ts#L1316-L1320)).
- `ticket_items` is the mutable, node-scoped kitchen table — no sale, tender,
  registro or huella ([fireCourse docstring](../../../apps/server/src/working-order.ts#L1082-L1085)).
- `voidTabLine` is already pre-fiscal ([working-order.ts:1266-1268](../../../apps/server/src/working-order.ts#L1266-L1268)).

No new fiscal record, no amendment, no chain interaction. New tenant-scoped
columns are not being added (P1 reuses `course_id`), so no new RLS/FORCE/policy
work — but any migration is hand-written `--custom` per the repo convention, and
if a new column *is* introduced it needs FORCE RLS + policy + grant and must pass
`packages/fiscal-verifactu`'s `inmutabilidad` guard.

## 8. Out of scope (deliberately)

- **Persistent numbered waves.** Rejected in favour of send-as-you-go: a "wave" is
  just the set of lines sent in one gesture, not a stored object.
- **Per-seat ordering** (tagging a line with which guest ordered it). A separate
  axis (who, not when), earmarked in the backlog; not needed here.
- **Backfill / migration of existing data.** Nothing is deployed (CLAUDE.md §5).

## 9. Decisions on record

- **Send-as-you-go over planned waves** — lighter, reuses held/fired wholesale.
- **Held lines show greyed on the kitchen display** (kitchen sees them coming and
  can prep), consistent with today's later-course behaviour — not hidden.
- **Cancelling a started dish is allowed, food waste and all** — an option the till
  offers behind a consequence-naming confirm.
- **Corrections are actively sent** — KDS live + a correction slip on paper
  kitchens — not left to the pass alone.
- **Course stays the organising unit** and is freely editable before fire (an
  explicit reversal of an earlier draft that reduced course to "kitchen category
  only").

## 10. Testing considerations

- **Real Postgres** (not PGlite) for anything exercising RLS as `app_user`, the
  fire/hold decision, and concurrency (a round-send racing a recall) — PGlite
  serialises and would false-pass a contention test (CLAUDE.md §4).
- **Prove each guard by deletion** — remove the "refuse re-course of a fired line"
  check and confirm the test goes red; same for the recall `state = 'queued'`
  filter and the correction-enqueue condition.
- **Timing-clock reset** on send-after-recall — assert `queued_at` refreshes so a
  recalled-then-resent line isn't instantly "overdue" (#185).
- **Correction slip only for previously-printed lines** — a pending/held change
  enqueues no print; a fired-line change enqueues exactly one, at the line's
  station's printers.
- **`inmutabilidad`** (`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`)
  if any tenant-scoped column is added.
