# A1308 jr14 — the till's connection: station and pass screens, clock-in, payment, receipt and bill-draft status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** The till's remaining timed re-reads gain jr13's connection: each re-reads at once when its
data changes; a timer whose server answer depends on rows alone goes quiet while the connection is
up; a timer whose answer depends on the clock keeps running.

**Architecture:** jr13's `liveGate` wraps each timer; each keeps its read and its own in-flight
guard. Kitchen displays have no person signed in, which is why the device-session mount exists
(jobs.md §3, "Kitchen and pass screen refresh"); jr13 opens their connection with the device.

**Spec:** [jobs.md §2 "Browsers"; §3 rows "Kitchen and pass screen refresh", "Till clock-in status poll", "Till payment and receipt status re-reads", "Product image refresh"](../specs/2026-11-02-rationalisation/jobs.md).
Slice rules apply.

## What it builds

The audit of 2026-11-08 (read, not run) classified each server read:

| Timer | Where | Interval | Server read | While connected |
| --- | --- | --- | --- | --- |
| Station screen | `apps/till/src/screens/till-station-screen.ts:431` | 15 s (`:52`) | clock (`apps/server/src/kitchen.ts:159`, `device-api.ts:613`, `till-api.ts:2259`) | keeps its timer; re-reads on change |
| Pass screen | `screens/till-pass-screen.ts:241` | 15 s (`:67`) | clock (`pass-board.ts:59, :100, :128`) | keeps its timer; re-reads on change |
| Clock-in status | `state/clocking.ts:63` | 15 s | clock (`till-clock-api.ts:91`) | keeps its timer; re-reads on change |
| Receipt and invoice delivery status | `till-app.ts:9627-9636` (a 5 s chain while a delivery is queued or sending) | 5 s (`:547`) | deliveries: clock (`invoice-delivery.ts:262`); receipt: rows (skimmed) | keeps its chain; re-reads on change |
| Pending bill payment status | `till-app.ts:19057` | 5 s (`:549`) | rows (`bill-payments-api.ts:209`, skimmed) | quiet |
| Bill-draft refresh | `till-app.ts:11915-11922` | 15 s | not classified | re-reads on change; quiet only if the builder finds its bills read uses rows alone |

Each timer's `types` are the change-source types of the tables its route reads; representative
tables for the tests: the kitchen ticket item table (station, pass), `time_entries` (clock-in),
`invoice_deliveries`, `print_jobs` and `outgoing_mail` (deliveries), `payments` and `bill_payments`
(pending payments), the bill and order tables the orders slice left (bill draft).

Product images reach the till with the menu read (jr13); the dashboard's image library refresh
(`packages/media/src/dashboard/image-library.ts:671`) is jr12's to mark quiet once its read is
confirmed to use rows alone. Nothing more here.

## What it leaves out

The enrolment screen's 2-second wait (`screens/till-enrol-screen.ts:150`: no session exists yet,
jobs.md §2 "Kept as they are"); the battery report; the probe for other boxes (jr15). With jr13,
every 5–15 second till timer jobs.md §3 names is now either quiet while connected or kept for a
stated reason.

## Files

- Modify: the six timers' files, their tests (`till-station-screen*.test.ts`,
  `till-pass-screen*.test.ts`, `state/clocking.test.ts`, `till-app-bill-payments.test.ts`,
  `till-app.test.ts`'s delivery cases, `till-app-drafts.test.ts`), `apps/till/src/api/live-connection.ts`
  (`TILL_LIVE_TYPES` gains these timers), `scripts/live-subscriptions.test.ts` (no change if jr13's
  case reads `TILL_LIVE_TYPES` whole)

## Size

| Hand-written | Lines |
| --- | --- |
| Code: six gates 105, handing the connection to the two screens and clocking 40 | **~145** |
| Tests: per timer "re-reads on change" and "timer quiet / still runs while connected", 12 cases | **~300** |
| Total | **~445** |

## Finish line

1. `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-pass-screen.test.ts src/state/clocking.test.ts src/till-app-bill-payments.test.ts src/till-app-drafts.test.ts src/till-app.test.ts src/till-app.pass-screen.test.ts` — passes (browser mode; measure free memory first).
2. `pnpm exec vitest run scripts/live-subscriptions.test.ts` — passes, with jr13's till-types case counted. Typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. A screen test needs a changed assertion (with no connection each timer behaves as today).
2. A kitchen display cannot open the device stream on its device proof (jr11's mount refuses it).

## Needs

jr13; 3a-ii (`outgoing_mail` as a change source).

## Global Constraints

As jr13: with no connection or a connection down, every timer runs exactly as today; the connection
is no person's activity; each change event re-reads at most once per timer.

## Review Focus

1. **A kitchen display during a rush.** Many ticket changes in a second give one re-read in flight
   and at most one queued after it, through the screens' existing refresh guards.
2. **A receipt queued while connected.** Its status re-reads when the delivery row changes, and the
   5-second chain keeps running (the delivery read expires claims by the clock). Task 1.
3. **A device of a kind outside `LIVE_STREAM_KINDS`** (measure 6's fallback). Every timer as today.
4. **Clock-in pending** (`state/clocking.ts:64`'s `#pending` guard). A change during a pending
   clock-in does not read over it.
5. **Another till merges the bill on screen** (`till-app.ts:11924-11926` says the timer exists for
   this). The bill-draft re-read runs on that change at once.

---

### Task 1: The six timers

- [ ] **Step 1: Failing tests**, per timer: `"while connected, a change to <representative table> re-reads at once"`
  and either `"while connected, the <n>-second timer still reads"` (station, pass, clock-in,
  deliveries) or `"while connected, the <n>-second timer does not read"` (pending payments, and the
  bill draft if its read uses rows alone).
- [ ] **Step 2–4:** FAIL; replace each `setInterval` / timeout chain with `liveGate` (jr13 Task 2),
  passing the till's connection (handed to the screens the way the api is); PASS. Commit:
  "Re-read the kitchen, pass, clock-in, payment, receipt and bill screens on change".
- [ ] **Step 5:** Update the till guide only if it tells staff to wait for a screen to refresh
  (`rg -n "refresh" apps/server/src/guide*` and the till guide sources); a guide sentence earns its
  place by changing what staff do (CLAUDE.md §3). Run the Finish line.
