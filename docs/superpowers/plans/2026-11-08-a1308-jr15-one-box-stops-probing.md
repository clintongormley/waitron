# A1308 jr15 — a till at a one-box venue stops checking for other boxes while connected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** A till whose list of boxes holds one box stops its 5-second check for the primary
(`apps/till/src/api/server-router.ts:111`, 12 reads a minute per till) while its live connection is
up, and checks at once and on the old timer when the connection goes down. With more than one box in
its list, checking stays exactly as it is today, because each check also hands a box that is behind
the newest chart the till holds (`#handChart`, `server-router.ts:202-226`), which is how a box
learns it has been replaced.

**Architecture:** `ServerRouter` learns whether the live connection is up (`setLive(up)`). Its
interval runs only while `servers.length !== 1 || !live`; a change to either re-evaluates. Going
down calls `probeNow()` at once. The till hands the router jr13's connection state.

**Spec:** [jobs.md §1 "Browsers hold one live connection" (first bullet); §2 "Browsers"; §3 row "Till follow-the-primary probe"; §5 measure 14 (its second half)](../specs/2026-11-02-rationalisation/jobs.md);
README §7 ("A venue with one box stops checking for the primary while connected; a venue with more
than one keeps checking as it does today"). Slice rules apply.

## What it builds

`ServerRouter.setLive(up: boolean)`; the interval rule above; the till wiring; measure 14's second
half as a router test.

## What it leaves out

Everything else of the till's connection (jr13, jr14).

## Files

- Modify: `apps/till/src/api/server-router.ts` (`:96-118`), `api/server-router.test.ts`,
  `api/server-router.contract.test.ts` if it pins the timer, `till-app.ts` (where the connection's
  `up`/`down` events are handled, jr13), `main.ts` (`:41`, if the router needs the connection there)

## Size

Code ~40; tests ~140. **~180.**

## Finish line

1. `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts src/api/server-router.contract.test.ts src/till-app-boot-and-counter.test.ts` — passes.
2. Typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. Any chart case in `server-router.test.ts` (`:486-640`) needs a changed assertion.
2. A two-box case shows the probe stopping while connected.

## Needs

jr13.

## Global Constraints

- More than one box in the list: the check runs exactly as today, connected or not (jobs.md §1).
- Exactly one box and connected: no timed check. A request the till makes still routes as today.
- The connection going down, or the list growing past one box, restarts the check at once.

## Review Focus

1. **A second box joins while tills are connected.** The till's list of boxes is set only at
   start-up (`setServers` from `getTill`, `till-app.ts:4572`, and the stored list read at
   `:4614`), so a running till keeps a one-box list, and no timed check, until it next starts (a
   reload or a restart). That is today's behaviour for the list itself: today's check also never
   adds a box. The router still restarts the check at once whenever its list grows (Task 1's case),
   which covers the next start.
2. **A one-box venue's box restarts.** The connection drops; the till checks at once, then every
   5 seconds until the connection is back.
3. **A behind box at a two-box venue, with a till on a live connection.** It still receives the
   newest chart. Measure 14's second half.
4. **The list read from storage at start** (`#save`/merge, `:96-100`) holding a stale second box.
   The check runs (more than one), as today, until `getTill` corrects the list.
5. **A till with no live connection** (a kind outside `LIVE_STREAM_KINDS`). Never `live`; checks as today.

---

### Task 1: The router and measure 14's second half

- [ ] **Step 1: Failing tests** (`server-router.test.ts`, fake timers, its fake fetch):
  `"one box and connected: no timed probe"`; `"one box, the connection drops: probes at once, then every 5 seconds"`;
  `"two boxes and connected: probes every 5 seconds as before"`;
  `"the list growing to two while connected restarts the probe at once"`;
  **measure 14, second half (jobs.md §5.14), as a stand-in:** `"at a venue with two boxes, a till on a live connection still hands the newest chart to a box that is behind"` —
  two fake servers in the router's fake fetch, one answering a lower term; `setLive(true)`; within
  one interval the behind server receives the held chart, as `:486`'s case asserts without a
  connection. This unit test stands in for a real two-box venue; the PR description says so, and a
  run against two real boxes (or the two-host local simulation) belongs with the go-live checks. **Failing result, written
  in advance:** the behind box receives nothing while the till is connected. Stop (rules §5.4).
- [ ] **Step 2–4:** FAIL; implement; PASS.
- [ ] **Step 5:** Wire `router.setLive` to jr13's connection `up`/`down` events in `till-app.ts`.
  Run the Finish line. Commit: "Stop checking for other boxes while connected at a one-box venue".
