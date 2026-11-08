# A1308 jr11 — one live stream for management and device sessions, checked without the write lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** The server half of tills' live connection (J7). The two copies of the live event loop
(`apps/server/src/live-api.ts:95-182` for the dashboard, `apps/server/src/department-transfer-api.ts:111-182`
for tills' transfer watch) become one implementation; a new mount serves it to **device** sessions
(tills, handhelds, kitchen displays, which may have no person signed in); and the session check on
every wake, the 15-second keepalive included, becomes a read that takes no write lock. That last
part is required, not optional: without it a stream per till makes the lock pressure worse
(jobs.md §4, "Performance").

**Architecture:** `apps/server/src/live-stream.ts` holds the loop: subscribe to the `LiveEvents` bus,
collect matching resources, wake on a change or the 15-second keepalive, re-check the session, write
`ready`, `change`, `reset`, `keepalive` or `session-invalid`. Each mount supplies how it
authenticates at connect (may take the write lock once, as today) and how it re-checks at a wake (a
plain read on the venue database's read connection, which takes no write lock:
`packages/store/src/index.ts:226-229`). The device mount sends resource **types** only, never ids:
a device proof is weaker than a person's sign-in, and the till re-reads what it shows through its
own authorised routes.

**Spec:** [jobs.md §1 "Browsers hold one live connection" and test 1 ("An open stream does not hold up a handover"); §2 "Server: kept outside the runner" ("Live event streams"); §3 row "Live update streams to open screens"; §4 "Performance"; §5 measure 6](../specs/2026-11-02-rationalisation/jobs.md);
README §7 ("Tills get one live connection … Built after the runner"). Slice rules apply.

## What it builds

1. `live-stream.ts` and both existing mounts moved onto it, behaviour unchanged except the
   lock-free wake check.
2. `GET /api/live/events?resources=[…]` for device sessions.
3. Measure 6 (Task 1), whose result decides which device kinds open the stream (jr13).

## What it leaves out

The browser halves (jr12 dashboard, jr13/jr14 till); publishing the in-memory states (jr12).

## Files

- Create: `apps/server/src/live-stream.ts`, `live-stream.test.ts`, `device-live-api.ts`, `device-live-api.test.ts`
- Modify: `live-api.ts` (`:88-183`), `live-api.test.ts`, `department-transfer-api.ts` (`:111-182`),
  `department-transfer-api.test.ts` (or the file holding its events cases), `boot.ts` (`:2215-2225`,
  the device mount beside it), `packages/identity/src/management-session.ts` (`:45`), its test,
  `apps/server/src/till-session.ts` (a read-only session read), the reads `monitoringActor` uses
  (their parameter types only), `apps/server/src/till-api.profile-actions.test.ts` (`:478-490`),
  `scripts/live-subscriptions.test.ts` if it pins the mount list

## Size

| Hand-written | Lines |
| --- | --- |
| Code: `live-stream.ts` 120 (about 120 lines leave the two mounts), `device-live-api.ts` 60, the two mounts 45, read-only session reads and widened parameter types 55, `boot.ts` 10 | **~290** |
| Tests: `live-stream.test.ts` 180, `device-live-api.test.ts` 120, re-pointed mount cases 70, identity 30, inventory 5 | **~405** |
| Total | **~695** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/live-stream.test.ts src/device-live-api.test.ts src/live-api.test.ts src/department-transfer-api.test.ts src/handover-gate.test.ts src/till-api.profile-actions.test.ts` — passes.
2. `pnpm --filter @waitron/identity exec vitest run src/management-session.test.ts` — passes.
3. `pnpm exec vitest run scripts/live-subscriptions.test.ts` — passes. Typecheck, format; protection list EQUAL; measure 6's table in the PR description.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. Measure 6 fails (Task 1). 2. A `live-api.test.ts` case needs a changed assertion. 3. The
handover gate counts an open device stream as admitted work (jobs.md §1 test 1 says it must not).

## Needs

jr1 (only so the order holds; nothing here uses the runner). If jr1's measure 1 failed, this plan
goes first, before jr2.

## Global Constraints

- The keepalive stays every 15 seconds (`live-api.ts:136`), so a browser can call 30 seconds of
  silence "down" (jobs.md §1).
- No wake check takes the write lock; the connect-time check may (once per connection).
- A slow reader gets a bounded `reset`, never an unbounded queue (`live-api.ts:128-132`).
- The device mount never sends a resource id, a person's name or any business value.
- An open stream is never counted by the handover gate (jobs.md §1, test 1).

## Review Focus

1. **A keepalive while a long write holds the lock.** It is written on time. Task 2's lock case.
2. **A device revoked while its stream is open.** The next wake (at most 15 seconds) answers
   `session-invalid` with `device.unauthorized` and closes. Task 3.
3. **A dashboard person suspended while streaming.** Same, with `person.suspended` (today's codes,
   `live-api.ts:156-163`). Task 2.
4. **A full disk.** A wake check is a read, so it still answers; today's transfer stream already
   treats a full-disk refusal as a log line, not a sign-out (`department-transfer-api.ts:158-163`). Task 2.
5. **Twenty kitchen screens and tills connected.** Measure 6.

---

### Task 1: Measure 6 — what twenty open streams cost

- [ ] **Step 1:** On a `wa-wt demo` stack (a throwaway worktree with Task 2–3's code), open 20 device
  streams with a script holding real device cookies (enrol 20 devices through the dev path), plus one
  sale every 20 s. Over 10 minutes record: server RSS before and after opening them; CPU over 5 idle
  minutes against 5 with none open; the longest main-thread stall when one change fans out to all 20
  (`perf_hooks.monitorEventLoopDelay`); the main-thread time of one keepalive round of 20 checks.
- [ ] **Step 2: Failing result, written in advance:** 20 streams add more than 20 MB RSS, or more than
  1% of one core while idle, or a fan-out or keepalive round stalls the main thread more than 20 ms.
  The design's fallback (jobs.md §5.6): only tills get the stream; handhelds and kitchen displays keep
  their timed re-reads. The server mount stays for all; jr13's `LIVE_STREAM_KINDS` becomes `["till"]`.
  Stop and ask before taking it.

### Task 2: `live-stream.ts`, and the dashboard on it

**Interfaces:**

```ts
export interface LiveStreamOptions {
  bus: LiveEvents;
  interests: readonly ResourceIdentity[];
  /** Re-checks the session at every wake; a plain read, never the write lock. Throws to end. */
  recheck: () => Promise<void>;
  /** Codes that answer `session-invalid` instead of a log line. */
  invalidCodes: ReadonlySet<string>;
  /** false: `change` carries types only, never ids. */
  sendIds: boolean;
  log: Logger;
  keepaliveMs?: number;   // 15_000
}
export function liveStreamResponse(c: Context, options: LiveStreamOptions): Response;
export function parseInterests(raw: string | undefined, allowed: ReadonlySet<string>): ResourceIdentity[]; // moved from live-api.ts:61-86
```

- `@waitron/identity`: `checkManagementSession(db: Database, token: string): Promise<void>` — the
  same read and the same refusals as `resolveManagementSession(tx, token, { touch: false })`
  (`management-session.ts:45-…`), on the database's read connection, writing nothing (use pp1's
  renamed table and names if pp1 has landed).
- `live-api.ts`: connect check unchanged; `recheck: () => checkManagementSession(deps.db, sessionId)`;
  `invalidCodes` = today's three; `sendIds: true`.

- [ ] **Step 1: Failing tests** (`live-stream.test.ts`, a hono app over a real `useVenueDb` database):
  `"a keepalive while another caller holds the write lock is written without waiting for it"` —
  hold `db.withWriteLock(() => <a promise the test releases>)`, advance 15 s, read the `keepalive`
  event before releasing; `"a matching change is written; another type is not"`;
  `"more than 256 pending identities send one reset"`; `"a recheck that throws an invalid code writes session-invalid and ends"`;
  `"a recheck that throws another code is logged and ends without session-invalid"`;
  `"with sendIds false, a change carries types only"`; `"the bus closing ends the stream"`.
  Re-point `live-api.test.ts`'s stream cases; assertions unchanged.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Share one live stream loop and check sessions on wake without the write lock".

### Task 3: The device mount, and the transfer watch on it

**Interfaces:**
- `till-session.ts`: `checkDeviceStillProven(db: Database, deviceId: string, tokenHash: string | null): Promise<void>` —
  the read `assertDeviceStillProven` makes (`device-session.ts:313-332`), on the read connection;
  throws `device.unauthorized` when the device is inactive or its token hash changed.
  `readTillSession(db: Database, token: string): Promise<<requireSession's return type>>` —
  `requireSession`'s lookup (`till-session.ts:95-128`) as a plain read with no stamp; throws
  `session.required` or `device.unauthorized`.
- `device-live-api.ts`: `mountDeviceLiveApi(app, deps: { db; bus: LiveEvents; resourceTypes: readonly string[]; devMode?: boolean }, log)`
  — `GET /api/live/events`; connect: `requireDeviceProof(deps, c, { passive: true })`; interests
  parsed against `resourceTypes` (the same list the dashboard gets, `liveResourceTypes`,
  `boot.ts:2223`); `recheck`: `checkDeviceStillProven`; `invalidCodes`: `device.unauthorized`;
  `sendIds: false`.
- `department-transfer-api.ts`: its events route uses `liveStreamResponse` with its four types
  (`:127-130`), `sendIds: false`, its connect check unchanged, and a `recheck` that keeps **every**
  check today's wake makes (`authenticate`, `:115-118`), as plain reads: `readTillSession(deps.db, token)`,
  the `take-orders` profile action on the binding it returns (`assertProfileAction`, in memory),
  and `monitoringActor(deps.db, session)` (`:39-62`: permission `payment.take`, person active,
  device still proven, profile admits the person) with its parameter widened from `Transaction` to
  `Database | Transaction` — every read in it (`authorize`, the `persons` select,
  `assertDeviceStillProven`, `canUseDeviceProfile`, `readProfileZones`) is widened the same way,
  and none of them writes (`department-transfer-api.test.ts:798` asserts the profile-admission
  case through a wake). `invalidCodes` keeps
  every code today's wake answers with `session-invalid`, with `data` the code only (`:158-163`).
  Its route is retired in jr13, when the till moves to the device stream.

- [ ] **Step 1: Failing tests** (`device-live-api.test.ts`): `"an enrolled device opens the stream and hears a change, as types only"`;
  `"a request with no device proof is refused device.unauthorized"`;
  `"an unknown interest type refuses the stream"`; `"a device revoked while streaming gets session-invalid at the next wake"`;
  `"a device stream does not hold up a stepdown's admitted-work wait"` (the gate's `settled` resolves
  with the stream open, as jobs.md §1 test 1). Re-point the transfer stream's cases with assertions
  unchanged — in particular `department-transfer-api.test.ts:1366-1395` (the stream closes with
  `session-invalid` and `data: {"code":…}` on `person.suspended`, `device.forbidden_action` and
  `device_profile.not_admitted`) and `:798` (profile admission withdrawn while streaming), now
  through the lock-free recheck; add
  `"a transfer stream's recheck takes no write lock"` (the held-lock case of Task 2, on this mount).
  In `till-api.profile-actions.test.ts`, add `GET /api/live/events` to the route inventory
  (`:478-490` is the transfer group) in the group of device-proof routes that name no profile action;
  if the inventory has no such group, stop and ask.
- [ ] **Step 2–4:** FAIL; implement; mount in `boot.ts` beside `mountLiveApi`, outside the
  `!fencedOrMirror` block only if the dashboard's is (follow `mountLiveApi`'s placement); PASS.
  Commit: "Serve the live stream to device sessions".
