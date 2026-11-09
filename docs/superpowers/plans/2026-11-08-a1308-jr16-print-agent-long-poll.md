# A1308 jr16 — the print agent's long poll, only if it shows a real saving — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** Measure first (jobs.md §5.7). If a held request ("long poll": the box answers the agent's
pull only when a job arrives, or after a wait) shows a real saving over today's pull every 2 seconds
(`packages/print-agent/src/agent.ts:28`), build it; if not, keep the poll and record why (owner,
2026-11-04: "Waits on a held request, if the measurement shows a real saving").

**Architecture (if built):** the pull route (`apps/server/src/print-api.ts:596-757`) does all of
today's work at once (agent check, inventory, Bluetooth outcomes, claims); when the claim returns no
job and the request asks to wait (`?wait=25`), it waits on the `LiveEvents` bus for a `print_jobs`
change, the handover gate closing (a new `closed` signal on `HandoverGate`, which today has only
`close` and `settled`, `apps/server/src/handover-gate.ts:5-10`), a Bluetooth command for this agent
being queued, or 25 seconds; then, unless the request's own abort signal has fired, it claims once
more and answers. The agent
raises its request limit for the held pull only (`DEFAULT_TIMEOUT_MS`, 3 s,
`packages/print-agent/src/client.ts:174`) to 30 seconds, and stops sleeping after an empty pull.

**Spec:** [jobs.md §2 "Print agent (separate container)"; §3 row "Print agent job poll loop"; §4 "Performance"; §5 measure 7](../specs/2026-11-02-rationalisation/jobs.md);
README §10 ("Print agent: waits on a held request, if the measurement shows a real saving").
CLAUDE.md §3 (the print agent is database-free and imports no other package of this repo).
Slice rules apply.

## What it builds

Task 1 always (the measurement). Tasks 2–3 only if Task 1's verdict is "build".

## What it leaves out

Printer discovery, the Bluetooth check and worker, A4 claim renewal, certificate pinning — all kept
as they are (jobs.md §2).

## Files

- If built — Modify: `apps/server/src/handover-gate.ts` (a `closed: AbortSignal`, aborted by
  `close`), `handover-gate.test.ts`, `apps/server/src/print-api.ts` (`:596-757`), `print-api.test.ts`,
  `packages/print-agent/src/client.ts` (`:154`, `:564-575`), `client.test.ts`,
  `packages/print-agent/src/agent.ts` (the poll loop), `agent.test.ts`, `boot.ts` (hand `liveEvents`
  and the gate's closed signal to `mountPrintApi`)
- If not built — Modify: `docs/backlog/architecture.md` (A1308's "Decisions and deliberate limits":
  one line with measure 7's numbers and "the print agent keeps its 2-second pull")

## Size

If built: code ~135, tests ~230, **~365**. If not: ~10 lines of docs.

## Finish line

1. Measure 7's table in the PR description, with the verdict.
2. If built: `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts src/print-agent-e2e.test.ts src/handover-gate.test.ts src/handover-stepdown.test.ts` and
   `pnpm --filter @waitron/print-agent exec vitest run` — pass; typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. A held pull is counted by the handover gate as admitted work and delays a stepdown (Task 2's
   stepdown case fails).
2. `print-agent-e2e.test.ts` needs a changed assertion.

## Needs

jr11 (nothing structural; ordered last in this part).

## Global Constraints

- `@waitron/print-agent` stays database-free and imports no other package of this repo (CLAUDE.md
  §3; guard: the `import-x/no-restricted-paths` zone in `eslint.config.js`).
- A held pull ends at once when the stepdown closes the gate or the server stops; it never holds a
  stepdown's 180-second admitted-work wait (`handover-stepdown.ts:18`, `:202-206`).
- No compatibility path for an older box: nothing is live yet (CLAUDE.md §3, "No
  backwards-compatibility … until Waitron is in production"), so the agent always asks to wait.

## Review Focus

1. **A ticket sent while the agent's pull is held.** It is answered within a second, not at the end
   of the hold. Task 2.
2. **A stepdown with three agents holding pulls.** Each is answered at the gate's close; the stepdown
   is not delayed. Task 2.
3. **A dead box.** The agent's 30-second limit on the held request means a dead box is noticed within
   30 seconds instead of 3; the router's other checks keep their 3-second limit.
4. **The secret-hash check on every pull.** Fewer pulls means fewer checks; the cached verification
   (`verifiedAgents`, `packages/printing/src/agent.ts:13, :51`) is unchanged.
5. **Discovery and Bluetooth.** With fewer pulls, a discovery window and a Bluetooth command still
   get prompt results: the agent ends its hold when a discovery pass finds devices or a Bluetooth
   command finishes (today both cut its sleep short, `agent.ts:26-27`), and the server ends a held
   pull when a Bluetooth command for that agent is queued.
6. **A drawer kick left waiting.** Since #2594 (`5f11ab6405`) every claim first ends drawer jobs
   queued 30 seconds or claimed past the 60-second lease (`endStaleDrawerJobs`,
   `packages/printing/src/runtime.ts:70-105` on `48d527dbc8`), and the till's "Drawer didn't open"
   notice reads that ending (`apps/server/src/box-staff-notices.ts:155-189`). It runs only when a pull
   claims, and a drawer job going stale is not a `print_jobs` change, so a 25-second hold can end
   such a job, and show the notice, up to about 25 seconds later than today's 2-second pull. Task 1
   records it; the verdict says whether the hold must also end at the earliest queued drawer job's
   30-second mark.

---

### Task 1: Measure 7 — the poll against a held pull

- [ ] **Step 1:** In a throwaway worktree, prototype the held pull (Task 2's shape, roughly). On a
  `wa-wt demo` stack with the print agent container and the demo printer, for 30 minutes each way
  (the poll; the prototype) record: the time from a kitchen send to the agent receiving the job
  (median and 95th percentile over 200 sends), the agent's requests per idle hour, and the
  write-lock turns per idle hour reached from the pull route (jr1 Task 1's counter).
- [ ] **Step 2: Verdict, written in advance.** "Build" when **either** the median send-to-agent time
  falls by 500 ms or more, **or** the pull route holds the write lock for 0.5% or more of an idle
  hour today and the held pull cuts that by at least 80%. Otherwise "keep the poll": make only the
  docs change in Files, and stop there. Either way, ask the watcher to confirm the verdict (rules §5.4)
  before Task 2 or the docs change.

### Task 2 (if built): the held pull on the server

**Interfaces:** the route accepts `?wait=<seconds>` (1–25, else refused `management.request_invalid`
with field `wait`, the code the print API's request checks already use); `HandoverGate` gains
`readonly closed: AbortSignal`, aborted inside `close()`; `mountPrintApi`'s deps gain
`bus: LiveEvents` and `stopping: AbortSignal` (`AbortSignal.any([gate.closed, <the server's stop>])`).

- [ ] **Step 1: Failing tests** (`print-api.test.ts`): `"an empty pull asking to wait answers when a job for its printer arrives"`;
  `"a job for another agent's printer does not end the wait"`; `"answers empty after the wait"`;
  `"the gate closing answers a held pull at once"`; `"a Bluetooth command queued for the agent ends its hold"`;
  `"a request aborted while held claims nothing"` (abort the request, then emit a `print_jobs`
  change: no job is claimed for a connection already gone); `"a pull with no wait answers at once as today"`.
  `handover-gate.test.ts`: `"close aborts closed"`.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Hold an empty print agent pull until a job arrives".

### Task 3 (if built): the agent

- [ ] **Step 1: Failing tests** (`client.test.ts`, `agent.test.ts`): `"a held pull is given 30 seconds"`;
  `"after an empty held pull the agent pulls again at once"`;
  `"a discovery pass that finds devices ends the hold early"` and `"a finished Bluetooth command ends the hold early"`
  (the agent aborts its held pull and pulls again).
- [ ] **Step 2–4:** FAIL; implement; PASS. Update the print agent's README or runbook sentence that
  says it polls every 2 seconds (`rg -n "2 s|2 seconds|every two seconds" packages/print-agent docs deploy`).
  Commit: "Let the print agent wait on a held pull".
