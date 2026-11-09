# A1308 jr13 — the till's one live connection: started with the device; transfers, allergies, kitchen notices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** Each till, handheld and kitchen display (unless measure 6 said otherwise) holds one live
connection to jr11's device stream, opened as soon as the device knows who it is — a kitchen display
has no person signed in. About 30 seconds with nothing heard counts as down. On a change, the till
re-reads what changed at once. Timers whose server answer depends on database rows alone go quiet
while the connection is up; timers whose answer depends on the clock or server memory keep running.
The till's own department-transfer stream goes; its transfers become interests on the one
connection, added and removed with the person's session.

**Architecture:** `apps/till/src/api/live-connection.ts` reads the device stream with the till
client's own `fetch`, as the till reads its transfer stream today (`apps/till/src/api/transfer-events.ts:1-69`),
so its device proof goes with it. Since #2534 the transfer stream's `fetch` also names the
signed-in person (`#fetchFor(person)` and the `onRefused` callback, `apps/till/src/api/client.ts:2740-2752`
and `transfer-events.ts:6` on `48d527dbc8`); the device stream is read with the plain `#fetchImpl`,
naming no person, because it outlives each sign-in and its recheck is device proof alone (jr11), and
`readTransferEvents`' `onRefused` goes with the transfer stream. A small gate, `liveGate`, wraps each existing timer: the read is
kept; it runs once when the connection comes up, on each `change` naming one of its types, and on
its timer — always, or only while the connection is down for a timer marked `quietWhileConnected`.

**Which timers go quiet (audit of 2026-11-08, read, not run):** the server answers of the menu
state (`/api/menu-state` works out service-open, period and default menu from `new Date()`,
`apps/server/src/till-api.ts:1667-1674`, and is the only regular carrier of `setupRevision`, `:1681`),
the equipment read (`device-api.ts:424-444`: wall clock, clock witnesses, notices), and the floor
(`/api/tables/state` → `ensureToday(… clock.now())`, `till-api.ts:1308`) depend on the clock or
memory: **they keep their timers** and gain an immediate re-read on change. The department
transfer list (`department-transfer-api.ts:193-226`), the table allergy read
(`party-allergy-api.ts:93`) and the kitchen screen's notice read (`/api/device/me`, `device-api.ts:350`)
read rows alone: **they go quiet while connected**. The audit only skimmed the last three's
callees; the builder reads each server function first and keeps its timer if it reads the clock.

**Spec:** [jobs.md §1 "Browsers hold one live connection" (both bullets and test 2); §2 "Browsers"; §3 rows "Till menu, equipment and zone poll", "Till floor and table re-reads", "Till department transfer watch", "Kitchen and pass screen refresh"; §5 measure 14 (its first half)](../specs/2026-11-02-rationalisation/jobs.md);
README §7 ("Tills get one live connection … Built after the runner"). Slice rules apply.

## What it builds

1. `TillLiveConnection` with the 30-second rule and reconnect back-off (1 s doubling to 30 s),
   started once the device's identity is read (`till-app.ts:4625-4650`, where the kind is known and a
   kitchen display goes straight to its screen with no operator session) and stopped when the device
   leaves (unenrolled, `device.unauthorized`, page gone).
2. `LIVE_STREAM_KINDS: readonly DeviceKind[]` in `apps/till/src/layout.ts` beside `DeviceKind`
   (`:23-36`): `["till", "handheld", "kds_station"]`, or `["till"]` if jr11's measure 6 failed. A
   device of another kind opens no connection and keeps every timer.
3. `liveGate(connection, { types, intervalMs, run, quietWhileConnected })` and its use by:
   | Timer | Where | Today | While connected |
   | --- | --- | --- | --- |
   | Menu state (and its tick: live device zones, floor zones, theme) | `state/menu-state-poll.ts:25-…` | 15 s | **keeps its timer**; re-reads on change |
   | Equipment | `state/equipment-poll.ts:40` | 15 s | **keeps its timer**; re-reads on change |
   | Floor re-read | `screens/till-floor-screen.ts:1126-1136` → `#pollFloor` (`till-app.ts:11005-11024`) | 15 s | **keeps its timer**; re-reads on change |
   | Department transfer monitor | `state/department-transfer-monitor.ts:84`, stream `:157` | 15 s + own stream | quiet; its stream goes |
   | Table allergy re-read | `till-app.ts:4020` | 15 s | quiet |
   | Kitchen screen notice | `kitchen-screen-notice.ts:91` | 15 s | quiet |
4. The transfer types (`department-transfer-api.ts:127-130`) join the connection's interests when a
   person signs in on a profile that takes orders, and leave at sign-out; the connection itself stays.
5. Measure 14's first half (Task 4).

## What it leaves out

Station and pass screens, clock-in, payment, receipt and bill-draft status (jr14); the probe for other
boxes (jr15).

## Files

- Create: `apps/till/src/api/live-connection.ts`, `live-connection.test.ts`, `apps/till/src/state/live-gate.ts`, `live-gate.test.ts`
- Modify: `apps/till/src/api/transfer-events.ts` (its parser becomes `readEventStream`, shared),
  `api/client.ts` (`:2696-2706`; a `readLiveEvents(types, onEvent, options)`), `layout.ts`,
  `state/menu-state-poll.ts`, `state/equipment-poll.ts`, `state/department-transfer-monitor.ts`,
  `screens/till-floor-screen.ts`, `kitchen-screen-notice.ts`, `till-app.ts` (connection start with
  the identity, `:4625-4650`; transfer interests with the operator session; `:3066-3101` the two
  polls; `:4020` the allergy read), their tests; `apps/server/src/department-transfer-api.ts` (the
  events route, retired) and its test; `apps/server/src/till-api.profile-actions.test.ts` (the
  transfer events row in the inventory, `:478-490`, goes with the route);
  `scripts/live-subscriptions.test.ts` (the till's types check)

## Size

| Hand-written | Lines |
| --- | --- |
| Code: connection 130, gate 45, client 20, six timers 90, `till-app.ts` 55, layout 5; server route deleted (not counted) | **~345** |
| Tests: connection 160, gate 70, the six timers' cases 180, types guard 20, measure 14 stand-in 50 | **~480** |
| Total | **~825** |

## Finish line

1. `pnpm --filter @waitron/till exec vitest run src/api/live-connection.test.ts src/state/live-gate.test.ts src/state/menu-state-poll.test.ts src/state/equipment-poll.test.ts src/state/department-transfer-monitor.test.ts src/screens/till-floor-screen.refresh.test.ts src/kitchen-screen-notice.test.ts src/till-app-allergy.test.ts src/till-app-menu-refresh.test.ts src/till-app-device-zones.test.ts` — passes (browser mode: check free memory first, CLAUDE.md §2).
2. `pnpm --filter @waitron/server exec vitest run src/department-transfer-api.test.ts src/device-live-api.test.ts src/till-api.profile-actions.test.ts` — passes.
3. `pnpm exec vitest run scripts/live-subscriptions.test.ts` — passes, with the new case counted.
4. Typecheck, format; protection list EQUAL; measure 14's first half recorded.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. Measure 14's stand-in fails (Task 4). 2. An existing timer test needs a changed assertion (with no
connection, or the connection down, each timer behaves as today). 3. A "quiet" timer's server read
turns out to read the clock: keep its timer and record it; not a stop.

## Needs

jr11 (the device stream).

## Global Constraints

- With no connection, or a connection down, every timer runs exactly as today.
- A till makes no activity of its own: the connection, like the timers, never counts as a person's
  activity (`state/menu-state-poll.ts:19-20`).
- The device stream answers `session-invalid` only with `device.unauthorized` (jr11): that stops the
  connection and the till's existing device handling takes over (the join screen,
  `till-app.ts:4651-4654`). A person's `session.required` comes from the person's own requests, never
  from this stream.
- Each change event re-reads at most once per timer per microtask.

## Review Focus

1. **A box that loses power** (no closing packet). The till counts it down within about 30 seconds
   and its quiet timers start. Task 4.
2. **A kitchen display booting with nobody signed in.** It opens the connection on its device proof
   alone, right after reading its identity. Task 3's kitchen display case.
3. **A person signing out on a till.** The transfer interests leave; the connection stays for the
   device's own data. Task 3.
4. **A menu going live at 18:00 on a connected till.** The menu poll keeps its 15-second timer, so the
   till shows it within 15 seconds, as today.
5. **A burst of changes.** One re-read per timer per event; a read already out is not doubled (each
   timer's in-flight guard stays: `MenuStatePoll`'s `#tickRead`, the floor's `#floorPoll`).

---

### Task 1: The connection

**Interfaces:**

```ts
// api/transfer-events.ts → shared parser
export async function readEventStream(url: string, fetchImpl: typeof fetch,
  onEvent: (event: string, data: string) => void, signal?: AbortSignal): Promise<void>;
// api/live-connection.ts
export const LIVE_SILENCE_MS = 30_000;
export const TILL_LIVE_TYPES: Readonly<Record<string, readonly string[]>>; // per timer, for the guard
export class TillLiveConnection extends EventTarget {
  constructor(options: {
    read: (types: readonly string[], onEvent: (event: string, data: string) => void, signal: AbortSignal) => Promise<void>;
    now?: () => number;
  });
  readonly up: boolean;
  addInterests(owner: string, types: readonly string[]): void;   // reopens when the union changes
  removeInterests(owner: string): void;
  start(): void;
  stop(): void;
  // dispatches "up", "down", "change" (detail: { types: string[] }) and "unauthorized"
}
```

- [ ] **Step 1: Failing tests** (`live-connection.test.ts`, fake timers, a fake `read`):
  `"is up at ready and dispatches up"`; `"a change event dispatches its types"`;
  `"thirty seconds with no event counts as down, closes the read and reconnects after 1 s, then 2 s"`;
  `"a keepalive every 15 seconds keeps it up"`;
  `"session-invalid with device.unauthorized stops it and dispatches unauthorized"`;
  `"stop ignores a late event"`; `"adding the same interests again does not reopen"`;
  `"removing one owner's interests reopens with the rest"`.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Give the till one live connection with a thirty-second silence rule".

### Task 2: The gate

**Interfaces:** `liveGate(connection: TillLiveConnection | undefined, options: { types: readonly string[]; intervalMs: number; run: () => void; quietWhileConnected: boolean }): { stop(): void }` —
with no connection, today's `setInterval(run, intervalMs)`; otherwise `run` on `up`, on a `change`
naming any of `types`, and on the interval unless `quietWhileConnected && connection.up`.

- [ ] **Step 1–4:** Tests `"with no connection it is today's timer"`, `"a quiet timer does not run while up"`,
  `"a timer that is not quiet runs while up"`, `"a matching change runs it once"`, `"coming up runs it once"`,
  `"going down starts a quiet timer"`; FAIL; implement; PASS. Commit: "Re-read on change on the till, keeping clock-based timers".

### Task 3: Start with the device; the six timers

Each timer's `types` are the change-source types of the tables its server route reads (read the
route at the base); `TILL_LIVE_TYPES` lists them per timer.

- [ ] **Step 1: Failing tests:** one per timer, `"a change to <a table its route reads> re-reads at once while connected"`;
  for the three quiet ones, `"while connected its 15-second timer does not read"`; for the three that
  keep their timers, `"while connected its 15-second timer still reads"`. `till-app` cases:
  `"a kitchen display opens the connection after reading its identity, with nobody signed in"`;
  `"signing in adds the transfer interests and signing out removes them, keeping the connection"`;
  `"a device outside LIVE_STREAM_KINDS opens no connection"`; `"unauthorized from the stream takes the till to its join screen"`.
  `scripts/live-subscriptions.test.ts` (the root project runs only `scripts/**`, `vitest.config.ts:71`):
  `"every type a till interest names is one the device stream accepts"`, importing
  `TILL_LIVE_TYPES` from `apps/till/src/api/live-connection.ts` and the server's `liveResourceTypes`.
- [ ] **Step 2–4:** FAIL; implement; delete `readDepartmentTransferEvents`, the server's
  `/api/department-transfers/events` route, its inventory row in `till-api.profile-actions.test.ts`
  and its tests' stream cases (the device stream's own cases cover them); PASS. Commit: "Move till re-reads onto the live connection".

### Task 4: Measure 14, first half — a box that goes silent

- [ ] **Step 1:** Stand-in for a power cut (a real one was not run, jobs.md §1 test 2): with a till
  open in Chromium (Playwright) on a `wa-wt demo` stack, freeze the server's Node process — the one
  `wa-wt` started for the stack's server, by its recorded process id — with `kill -STOP`, so its
  socket stays open and silent. Record the time until the till reports down and its first quiet-timer
  read. Then `kill -CONT` the same id.
- [ ] **Step 2: Failing result, written in advance:** the till does not count the box down within
  35 seconds, or no quiet timer starts. Stop (stop point 1).
- [ ] **Step 3:** This pull request lands with the stand-in (coordinator decision, 2026-11-08). A real
  power cut by a person is required **before go-live**, not before landing; add it to the go-live
  checklist entry in `docs/backlog.md` if that entry exists, else say so in the PR description.
