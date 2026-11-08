# A1308 jr13 — the till's one live connection: menu, equipment, floor and transfers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** Each till (and handheld and kitchen display, unless measure 6 said otherwise) holds one live
connection to jr11's device stream. About 30 seconds with nothing heard counts as down. While it is
up, the till's menu, equipment, floor and department-transfer re-reads happen when the server says
their data changed, not every 15 seconds; while it is down, their timers run as today. The till's
own transfer stream goes; its transfers become interests on the one connection.

**Architecture:** `apps/till/src/api/live-connection.ts` reads the device stream with the till
client's own `fetch` (the till reads its transfer stream that way today, `apps/till/src/api/transfer-events.ts:1-69`,
so its device proof and credentials go with it). A small gate, `whileDown`, wraps each existing poll:
the poll's read function is kept; it runs once when the connection comes up, on each `change` naming
one of its types, and on its own timer only while the connection is down. This plan covers the four
polls whose state lives in `till-app.ts`'s shell; jr14 covers the rest.

**Spec:** [jobs.md §1 "Browsers hold one live connection" (both bullets and test 2); §2 "Browsers"; §3 rows "Till menu, equipment and zone poll", "Till floor and table re-reads", "Till department transfer watch"; §5 measure 14 (its first half)](../specs/2026-11-02-rationalisation/jobs.md);
README §7 ("Tills get one live connection … Built after the runner"). Slice rules apply.

## What it builds

1. `TillLiveConnection` with the 30-second rule and reconnect back-off (1 s doubling to 30 s).
2. `LIVE_STREAM_KINDS: readonly DeviceKind[]` in `apps/till/src/layout.ts` beside `DeviceKind`
   (`:23-36`): `["till", "handheld", "kds_station"]`, or `["till"]` if jr11's measure 6 failed. A
   device of another kind opens no connection and keeps every timer.
3. `whileDown(connection, { types, intervalMs, run })`, and its use by `MenuStatePoll`
   (`state/menu-state-poll.ts:25-…`, 15 s), `EquipmentPoll` (`state/equipment-poll.ts:40`, 15 s), the
   floor screen's re-read (`screens/till-floor-screen.ts:1126-1136`, 15 s) and the department
   transfer monitor (`state/department-transfer-monitor.ts:84`, 15 s, and its stream at `:157`).
4. Measure 14's first half (Task 4).

## What it leaves out

Kitchen and pass screens, clock-in status, payment and receipt status, product images (jr14); the
probe for other boxes (jr15).

## Files

- Create: `apps/till/src/api/live-connection.ts`, `live-connection.test.ts`, `apps/till/src/state/while-down.ts`, `while-down.test.ts`
- Modify: `apps/till/src/api/transfer-events.ts` (its parser becomes `readEventStream`, shared),
  `api/client.ts` (`:2696-2706`; a `readLiveEvents(types, onEvent, options)`), `layout.ts`,
  `state/menu-state-poll.ts`, `state/equipment-poll.ts`, `state/department-transfer-monitor.ts`,
  `screens/till-floor-screen.ts`, `till-app.ts` (the connection's start and stop with the operator
  session; `:3066-3101` the two polls), their tests;
  `apps/server/src/department-transfer-api.ts` (the events route, retired), its test;
  `apps/server/src/live-resources.ts` if a type the till names is missing

## Size

| Hand-written | Lines |
| --- | --- |
| Code: connection 130, gate 40, client 20, four polls 80, `till-app.ts` 40, layout 5, server route deleted (not counted) | **~315** |
| Tests: connection 160, gate 60, the four polls' new cases 160, measure 14 stand-in 60 | **~440** |
| Total | **~755** |

## Finish line

1. `pnpm --filter @waitron/till exec vitest run src/api/live-connection.test.ts src/state/while-down.test.ts src/state/menu-state-poll.test.ts src/state/equipment-poll.test.ts src/state/department-transfer-monitor.test.ts src/screens/till-floor-screen.refresh.test.ts src/till-app-menu-refresh.test.ts src/till-app-device-zones.test.ts` — passes (browser mode: check free memory first, CLAUDE.md §2).
2. `pnpm --filter @waitron/server exec vitest run src/department-transfer-api.test.ts src/device-live-api.test.ts` — passes.
3. Typecheck, format; protection list EQUAL; measure 14's first half recorded.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. Measure 14's stand-in fails (Task 4). 2. An existing poll test needs a changed assertion (each
poll keeps today's behaviour while down, and a test with no connection is "down").

## Needs

jr11 (the device stream), jr12 (only for the shared 30-second constant's wording; not code).

## Global Constraints

- With no connection, or a connection down, every timer runs exactly as today.
- A till makes no activity of its own: the connection, like the polls, never counts as a person's
  activity (`state/menu-state-poll.ts:19-20`).
- `session.required` from the stream stops it as a sign-out does (today's transfer stream's rule,
  `transfer-events.ts:46-56`); `device.unauthorized` ends it and the till's existing device
  handling takes over.
- Each change event re-reads at most once per poll per microtask (several types in one event, one read).

## Review Focus

1. **A box that loses power** (no closing packet). The till counts it down within about 30 seconds
   and its timers start. Task 4.
2. **A burst of changes** (a busy kitchen send). One re-read per poll per event, and a re-read
   already out is not doubled: each poll's existing in-flight guard (`MenuStatePoll`'s `#tickRead`,
   the floor's `#floorPoll`) stays. Task 3.
3. **The connection coming back after a drop.** One catch-up read per poll, then events again.
4. **A till that signs out and another person signs in.** The connection follows the operator
   session's start and stop; a stale stream's events are ignored after stop.
5. **A kitchen display with no person signed in.** It opens the device stream on its device proof alone.

---

### Task 1: The connection

**Interfaces:**

```ts
// api/transfer-events.ts → shared parser
export async function readEventStream(url: string, fetchImpl: typeof fetch,
  onEvent: (event: string, data: string) => void, signal?: AbortSignal): Promise<void>;
// api/live-connection.ts
export const LIVE_SILENCE_MS = 30_000;
export class TillLiveConnection extends EventTarget {
  constructor(options: {
    read: (types: readonly string[], onEvent: (event: string, data: string) => void, signal: AbortSignal) => Promise<void>;
    now?: () => number;
  });
  readonly up: boolean;
  setInterests(types: readonly string[]): void;   // union of every gate's types; reopens on change
  start(): void;
  stop(): void;
  // dispatches "up", "down", and "change" (detail: { types: string[] })
}
```

- [ ] **Step 1: Failing tests** (`live-connection.test.ts`, fake timers, a fake `read`):
  `"is up at ready and dispatches up"`; `"a change event dispatches its types"`;
  `"thirty seconds with no event counts as down, closes the read and reconnects after 1 s, then 2 s"`;
  `"a keepalive every 15 seconds keeps it up"`; `"session-invalid with session.required stops it"`;
  `"stop ignores a late event"`; `"setInterests with the same set does not reopen"`.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Give the till one live connection with a thirty-second silence rule".

### Task 2: The gate

**Interfaces:** `whileDown(connection: TillLiveConnection | undefined, options: { types: readonly string[]; intervalMs: number; run: () => void }): { stop(): void }` —
with no connection, a plain `setInterval(run, intervalMs)`; otherwise `run` on `up`, on a `change`
naming any of `types`, and on the interval only while `!connection.up`.

- [ ] **Step 1–4:** Tests `"with no connection it is today's timer"`, `"while up the timer does not run"`,
  `"a matching change runs it once"`, `"coming up runs it once"`, `"going down starts the timer"`;
  FAIL; implement; PASS. Commit: "Run till re-reads on change while connected, on a timer while not".

### Task 3: Menu, equipment, floor, transfers

Each poll replaces its `setInterval` with `whileDown`. Its `types` are the change-source types of
the tables its server route reads (each route named here; read it at the base for the tables):

| Poll | Route it reads | Representative table for the test |
| --- | --- | --- |
| `MenuStatePoll` (and its `onTick`: live device zones, floor zones) | `api.menuState(zoneId)`; `#readLiveDeviceZones` | the menu release table (`menu_releases` after the menu slice) |
| `EquipmentPoll` | `#readDeviceEquipment` | `printers` |
| Floor re-read | the floor screen's `floor-refresh` → `#pollFloor` (`till-app.ts:11005-11024`) | the live table state table (the floor slice's name) |
| Department transfer monitor | its list read; the four types today's stream watches (`department-transfer-api.ts:127-130`) | `department_transfer_requests` |

Add a server-side case to `apps/server/src/live-resources.test.ts` (create it if absent):
`"every type a till interest names is one the device stream accepts"`, importing the till's type
lists from one exported constant `TILL_LIVE_TYPES` in `apps/till/src/api/live-connection.ts`.

- [ ] **Step 1: Failing tests**, one per poll: `"a change to <representative table> re-reads at once while connected"`;
  `"while connected the 15-second timer does not read"`; and the department transfer monitor reads
  on a transfer change through the one connection, opening no stream of its own.
- [ ] **Step 2–4:** FAIL; implement; start the connection with the operator session in `till-app.ts`
  for kinds in `LIVE_STREAM_KINDS`; delete `readDepartmentTransferEvents` and the server's
  `/api/department-transfers/events` route with its tests' stream cases (the device stream's own
  cases cover it); PASS. Commit: "Move menu, equipment, floor and transfer re-reads onto the live connection".

### Task 4: Measure 14, first half — a box that goes silent

- [ ] **Step 1:** Stand-in for a power cut (a real one was not run, jobs.md §1 test 2): with a till
  open in Chromium (Playwright) on a `wa-wt demo` stack, freeze the server process (`kill -STOP` on
  its recorded id) so its socket stays open and silent. Record the time until the till reports down
  and its first timed re-read. Then `kill -CONT`.
- [ ] **Step 2: Failing result, written in advance:** the till does not count the box down within
  35 seconds, or no timed re-read starts. Stop (stop point 1). A person runs the same check by
  cutting a box's power before this lands; the PR description says whether that has been done.
