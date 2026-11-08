# A1308 jr12 — the dashboard's connection: 30 seconds of silence is down, timers only while down — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** The dashboard's one live connection (`packages/dashboard-kit/src/live-connection.ts`)
counts about 30 seconds with no event as down; its screens' re-read timers run only while it is down,
except for the few whose data changes with time or lives outside the database; and the server
publishes the in-memory states nothing publishes today, so those screens no longer need a timer.

**Architecture:** `LiveConnection` records when it last heard anything (the server sends a
`keepalive` every 15 seconds, `apps/server/src/live-api.ts:136`, kept by jr11) and treats 30 seconds
of silence as an error: in Chromium a silent server leaves an `EventSource` open with no error after
45 seconds (jobs.md §1, test 2). `LiveData` (`packages/dashboard-kit/src/live-data.ts:80-87`) learns
whether the connection is up and skips a timed re-read while it is, unless the query says
`refreshWhileConnected`. The server publishes `pairing`, `printer_discovery`, `email_inbox` and
`backup_status` on the `LiveEvents` bus when they change (today they are accepted interests that
nothing publishes, `apps/server/src/live-resources.ts:3-23`).

**Spec:** [jobs.md §1 "Browsers hold one live connection" (the 30-second rule covers the dashboard too); §2 "Browsers"; §3 rows "Dashboard background re-reads", "Dashboard printer and device pairing helpers", "Product image refresh"; §6 J7](../specs/2026-11-02-rationalisation/jobs.md);
README §10 "Applied as the design" ("The 30-second silence rule applies to the dashboard as well as
tills"). Slice rules apply.

## What it builds

1. `LIVE_SILENCE_MS = 30_000` in `LiveConnection`; silence closes the stream, re-reads once, and
   reconnects with today's back-off (1 s doubling to 30 s, `live-connection.ts:151-155`).
2. `LiveData.setConnected(up: boolean)`; a timer tick is skipped while up unless the query has
   `refreshWhileConnected: true`.
3. `refreshWhileConnected: true` on exactly these queries, whose data changes with time or comes
   from outside the database: `getOverdueOrders` and `getDiskStop` (time and disk),
   `getBoxHealth` (the server's in-memory health), `getStreamSettings` (the bucket copy's lag), and
   the two content-translation dialog queries (`apps/dashboard/src/widgets/content-translations-dialog.ts:287, :312`,
   job progress at Waitron Cloud). Every other `refreshMs` (the list from
   `rg -n "refreshMs" apps/dashboard/src packages/*/src`) runs only while down.
4. Server publishers: `pairing` when the pairing window opens, closes, is claimed, or a hold lapses
   (a one-shot timer at the earliest hold's end, `apps/server/src/pairing-mode.ts:34-…`);
   `printer_discovery` when a pull adds a device or changes one's description
   (`apps/server/src/print-api.ts:626, :648`) — not on every pull, which comes every 2 seconds per
   agent and mostly restamps `lastSeenAt`;
   `email_inbox` when the mail sender delivers to the practice inbox (3a-i's `runMailPass`, after a
   `sent` outcome whose delivery mode is the practice inbox); `backup_status` when a destination
   outcome, the stopped-run record or the loaded settings change (`BackupSupervisor`'s
   `#recordResult`/`#recordUpload`, `runStopped` set or cleared in `runOnce`, the end of `reload`)
   and when the bucket copy's state changes (`StreamSupervisor`'s status transitions).
5. `google_config`: if the environment part has moved Google sign-in into a settings document,
   `getGoogleConfig`'s dependencies become that document's change type and `google_config` leaves
   `liveResourceTypes`; otherwise "configured" is fixed until restart
   (`management-api.ts:798-806` reads `deps.googleOidc`) and the query needs no timer while up.

## What it leaves out

The till (jr13, jr14).

## Files

- Modify: `packages/dashboard-kit/src/live-connection.ts`, `live-connection.test.ts`,
  `live-connection.lifecycle.test.ts`, `live-data.ts`, `live-data.test.ts`,
  `apps/dashboard/src/api/live-queries.ts` (`:584-610`), `apps/dashboard/src/widgets/content-translations-dialog.ts`,
  `apps/server/src/pairing-mode.ts`, `print-api.ts`, `mail-sender.ts`, `backup-supervisor.ts`,
  `backup-sweep.ts`, `stream-host.ts` (or `packages/stream`'s supervisor status hook), `live-resources.ts`,
  `boot.ts` (hand the bus to each), and each one's test
- Create: `apps/server/src/live-publish.ts` (`publishState(bus: LiveEvents, type: string, log: Logger): void`,
  absorbing a throw as `changeSubscriber` does, `live-api.ts:41-49`)

## Size

| Hand-written | Lines |
| --- | --- |
| Code: connection 45, data 25, queries 15, publishers 90, `boot.ts` 15 | **~190** |
| Tests: connection 120, data 50, publishers 160 | **~330** |
| Total | **~520** |

## Finish line

1. `pnpm --filter @waitron/dashboard-kit exec vitest run src/live-connection.test.ts src/live-connection.lifecycle.test.ts src/live-connection.session-generation.test.ts src/live-data.test.ts` — passes.
2. `pnpm --filter @waitron/server exec vitest run src/pairing-mode.test.ts src/print-api.test.ts src/mail-sender.test.ts src/backup-supervisor.test.ts src/live-publish.test.ts src/stream-host.test.ts` — passes.
3. `pnpm exec vitest run scripts/live-subscriptions.test.ts` — passes. Typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. A dashboard screen test that relies on a timed re-read while connected fails and its data is not
   in the `refreshWhileConnected` list: stop and ask whether it belongs on the list.
2. `live-connection.session-generation.test.ts` needs a changed assertion.

## Needs

jr11 (its keepalive and lock-free wake check). 3a-i (the mail sender).

## Global Constraints

- Automatic dashboard reads stay passive session activity (CLAUDE.md §3).
- A publisher never throws into the code that changed the state.
- The silence rule never closes a stream that is still delivering keepalives.

## Review Focus

1. **A box that loses power with a dashboard open.** Within about 30 seconds the dashboard re-reads
   and starts its timers. Task 1's silence case.
2. **A laptop waking from sleep.** Its timers fire late at once; the silence check sees a stale
   last event and reconnects, which re-reads everything once — the same as an error today.
3. **Two dashboards open, one opens pairing.** The other sees the window open through `pairing`
   without its 5-second timer, and sees it close when the hold lapses. Task 3.
4. **A query that only ever had a timer** (no dependencies). It keeps its timer while up only if it
   is on the list; otherwise it re-reads on the connection's open and on each reconnect.
5. **A page hidden and shown** (`pagehide`/`pageshow`). The silence timer is cleared while suspended
   and started again on return (`live-connection.ts:32-48`).

---

### Task 1: Silence counts as down

- [ ] **Step 1: Failing tests** (`live-connection.test.ts`, fake timers, the injected `open`):
  `"no event for 30 seconds closes the stream, re-reads once and reconnects"`;
  `"a keepalive every 15 seconds keeps it open indefinitely"`;
  `"the silence clock starts at open and restarts at every event"`;
  `"a suspended page runs no silence check"`; `"the connection tells LiveData it is up at ready and down at error or silence"`.
- [ ] **Step 2–4:** FAIL; implement (a 5-second check interval comparing `Date.now()` with the last
  event; any named event or `open` counts); PASS. Commit: "Count thirty seconds of silence on the dashboard's stream as down".

### Task 2: Timers only while down

**Interfaces:** `ResourceQuery<T>.refreshWhileConnected?: boolean`; `LiveData.setConnected(up: boolean): void`
(`up` starts false). The timer callback (`live-data.ts:83-86`) marks the entry dirty only when
`!connected || query.refreshWhileConnected`.

- [ ] **Step 1: Failing tests** (`live-data.test.ts`): `"a timed query does not re-read while connected"`;
  `"it re-reads on its timer while down"`; `"a refreshWhileConnected query re-reads on its timer either way"`.
- [ ] **Step 2–4:** FAIL; implement; mark the six queries in item 3; PASS. Commit: "Re-read dashboard data on a timer only while the live connection is down".

### Task 3: The server publishes its in-memory states

- [ ] **Step 1: Failing tests**, one per publisher, each subscribing to a `LiveEvents` bus:
  `"opening, closing and claiming the pairing window publishes pairing"`;
  `"a hold lapsing publishes pairing at its end"`; `"a pull that finds a new device publishes printer_discovery; a pull that changes nothing does not"`;
  `"a mail delivered to the practice inbox publishes email_inbox; one sent over SMTP does not"`;
  `"a backup destination outcome publishes backup_status"`; `"the bucket copy changing state publishes backup_status"`;
  `"a publisher whose bus throws does not fail the caller"`.
- [ ] **Step 2–4:** FAIL; implement through `publishState`; hand `liveEvents` from `boot.ts`
  (`:2215`) to each; settle item 5 (`google_config`); PASS. Update `live-resources.ts`'s comment
  (`:3-9`), which says nothing publishes these. Commit: "Publish pairing, discovery, inbox and backup states to open dashboards".
