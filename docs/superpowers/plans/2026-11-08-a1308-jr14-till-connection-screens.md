# A1308 jr14 — the till's connection: kitchen and pass screens, clock-in, payment and receipt status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** The rest of the till's timed re-reads move onto jr13's connection: the kitchen station and
pass screens (15 s), the clock-in status (15 s), and the payment and receipt status re-reads (5 s).
While the connection is up they re-read when their data changes; while it is down, as today.

**Architecture:** jr13's `whileDown` gate wraps each timer; each keeps its read and its own in-flight
guard. Kitchen displays have no person signed in, which is why the device-session mount exists
(jobs.md §3, "Kitchen and pass screen refresh").

**Spec:** [jobs.md §2 "Browsers"; §3 rows "Kitchen and pass screen refresh", "Till clock-in status poll", "Till payment and receipt status re-reads", "Product image refresh"](../specs/2026-11-02-rationalisation/jobs.md).
Slice rules apply.

## What it builds

| Timer | Where | Interval | Types (the tables its route reads; representative one for the test) |
| --- | --- | --- | --- |
| Station screen | `apps/till/src/screens/till-station-screen.ts:431` | 15 s (`:52`) | the kitchen ticket tables (the floor-and-kitchen slice's ticket item table) |
| Pass screen | `screens/till-pass-screen.ts:241` | 15 s (`:68`) | the same, plus the pass's own tables |
| Clock-in status | `state/clocking.ts:63` | 15 s | `time_entries` |
| Receipt and invoice delivery status | `till-app.ts:9627-9636` (a 5 s timeout chain while a delivery is queued or sending) | 5 s (`:547`) | `invoice_deliveries`, `print_jobs`, `outgoing_mail` |
| Pending bill payment status | `till-app.ts:19057` | 5 s (`:549`) | `payments`, `bill_payments` |

Product images reach the till with the menu read (jr13); the dashboard's image library refresh
(`packages/media/src/dashboard/image-library.ts:671`) already runs only while down after jr12,
because `media_images` is a change source (`packages/media/src/module.ts:37`). Nothing more here.

## What it leaves out

The enrolment screen's 2-second wait (`screens/till-enrol-screen.ts:150`: no session exists yet,
jobs.md §2 "Kept as they are"); the battery report; the probe for other boxes (jr15).

## Files

- Modify: the four files in the table, their tests (`till-station-screen*.test.ts`,
  `till-pass-screen*.test.ts`, `state/clocking.test.ts`, the till-app delivery and bill-payment
  suites: `till-app-bill-payments.test.ts`, `till-app.test.ts`'s delivery cases),
  `apps/till/src/api/live-connection.ts` (`TILL_LIVE_TYPES` gains these types)

## Size

| Hand-written | Lines |
| --- | --- |
| Code: five gates 90, wiring the connection into the two screens and clocking 40 | **~130** |
| Tests: one "re-reads on change while connected" and one "timer quiet while connected" per timer, 10 cases | **~260** |
| Total | **~390** |

## Finish line

1. `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-pass-screen.test.ts src/state/clocking.test.ts src/till-app-bill-payments.test.ts src/till-app.test.ts src/till-app.pass-screen.test.ts` — passes (browser mode; measure free memory first).
2. `pnpm exec vitest run apps/server/src/live-resources.test.ts` (jr13's guard) — passes. Typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. A screen test needs a changed assertion (with no connection each timer behaves as today).
2. A kitchen display cannot open the device stream on its device proof (jr11's mount refuses it).

## Needs

jr13.

## Global Constraints

As jr13: with no connection or a connection down, every timer runs exactly as today; the connection
is no person's activity; each change event re-reads at most once per timer.

## Review Focus

1. **A kitchen display during a rush.** Many ticket changes in a second give one re-read in flight
   and at most one queued after it, through the screens' existing refresh guards.
2. **A receipt queued while connected.** Its status re-reads when the delivery row changes, and the
   5-second chain does not run; when the connection drops mid-wait, the chain resumes. Task 1.
3. **A device of a kind outside `LIVE_STREAM_KINDS`** (measure 6's fallback). Every timer as today.
4. **Clock-in pending** (`state/clocking.ts:64`'s `#pending` guard). A change during a pending
   clock-in does not read over it.
5. **A pass screen on a till that loses its person's session.** The device stream stays; the
   screen's own session handling decides as today.

---

### Task 1: The five timers

- [ ] **Step 1: Failing tests**, per timer: `"while connected, a change to <representative table> re-reads at once"`
  and `"while connected, the <n>-second timer does not read"`; for the delivery chain,
  `"a connection dropping mid-wait resumes the five-second chain"`.
- [ ] **Step 2–4:** FAIL; replace each `setInterval` / timeout chain with `whileDown` (jr13 Task 2),
  passing the till's connection (handed to the screens the way the api is); PASS. Commit:
  "Move the kitchen, pass, clock-in and payment status re-reads onto the live connection".
- [ ] **Step 5:** Update the till guide only if it tells staff to wait for a screen to refresh
  (`rg -n "refresh" apps/server/src/guide*` and the till guide sources); a guide sentence earns its
  place by changing what staff do (CLAUDE.md §3). Run the Finish line.
