# Let slow backup uploads finish

**Goal:** A progressing setup backup upload finishes beyond five minutes; ordinary routes keep a 300-second receive deadline. Source: Lane K’s `SLOW-RESTORE-UPLOAD` queue item. Separate Sol-high draft checked by the driver; Claude review and watcher clearance are pending.

**Reproduced:** On main `a25201632a`, a real HTTP restore-preview request sent 1 KiB each second and received 408 at 300011.524 ms. Its partial staging was removed. This measures the product route and receiver behind Node’s default listener, not a full appliance restore. Logs and disposable source: `~/waitron-campaign-k/receipts/slow-restore-upload/main-real-time-{reproduction.log,probe.ts}`.

## Scope and implementation

Reuse `receiveSetupArchive` for the unchanged 4 GiB ceiling, space checks and partial-file cleanup; Hono remains the body consumer. Add no dependency, configuration surface or stored record. Leave emergency handover, media, configuration transfer, whole-file recovery buffers and separate landing/recovery listeners alone. These three uploads are mounted by normal setup in `boot.ts`, not by those separate listeners.

- Add `apps/server/src/request-receive-limits.ts`: `attachRequestReceiveLimits(server, limits?)`, with internal shortened-duration injection for tests. Wire it once immediately after `serve` in `boot.ts:startListening`, before requests arrive; cover HTTP and HTTPS.
- **Server-wide change:** raise native `requestTimeout` from 300000 to 43200000 ms (12 hours); retain `headersTimeout = 60000`. Native timeout supplies the finite upload ceiling. Ordinary requests get a separate non-refreshing 300-second receive timer at the parsed-header request event. This changes the native first-byte accounting boundary; the header phase retains its separate 60-second bound. Review must judge that against the queue’s ordinary-route requirement.
- Only POST pathnames `/setup-api/restore/preview`, `/setup-api/recovery/stage` and `/setup-api/restore` get the longer allowance; query strings do not change selection. Uploads stop after two minutes without progress, checked each second through public `request.socket.bytesRead`. Do not add body data listeners, resume it or change socket inactivity/keepalive settings. Four GiB at a constant 1 Mbit/s takes 9.54 hours by arithmetic, leaving some room under 12 hours.
- Expiry answers 408 where possible and closes the connection so the existing receiver aborts and cleans up. Clear timers/listeners once the body is complete or the request/connection ends; receiving a body and processing its result have separate lifetimes.

## Build and verification

1. In new `apps/server/src/request-receive-limits.test.ts`, write failing behavioral cases and watch them fail before implementation. Use real HTTP transport, retained sockets and short injected durations: only the three POST paths (queries, methods and near-miss/excluded routes); progress survives the ordinary deadline with exact bytes; a stalled upload aborts and cleans staging; continuous progress still reaches the native ceiling; ordinary requests expire despite progress; headers remain bounded; completed bodies permit delayed responses and a later keepalive request gets ordinary limits. Delay Hono’s consumption with headers and initial bytes sent together; include HTTPS using existing minted-certificate support.
2. Add a focused setup-listener wiring check in `apps/server/src/boot.setup-routes.test.ts`, reusing its existing real listener fixture; keep archive-validation cases in their current layer. Implement the helper and wiring minimally, then run `pnpm --filter @waitron/server exec vitest run src/request-receive-limits.test.ts src/setup-archive-upload.test.ts src/boot.setup-routes.test.ts`.
3. Outside CI, run production-duration retained-socket probes: a progressing ordinary request must answer 408 around 300 seconds; a 341 KiB restore-preview body at 1 KiB/second must finish after 300 seconds with exact bytes and empty staging. Retain commands/timings. Do not put these five-minute probes into the four-minute CI shards.
4. Update `apps/server/src/guide/{en,es}/backup-recovery.md` with the new limits and retry advice, and run `src/guide-content.test.ts`. The setup client’s interrupted-upload EN/ES text names no duration, so needs no change. Delete the finished entry from `docs/backlog.md` and `docs/backlog/setup.md`. Finish through the required reviews, normal hook, current-head CI and authorised landing.

**Expected added/removed lines:** production +80–110/−0–3; tests +170–210/−0; support +0–15/−0; prose including plan +50–65/−20–30. Total upper estimate 433 changed lines; outside opinion before 650. No existing test assertion is deliberately changed.

| Source | Exact words | Use |
| --- | --- | --- |
| [Node HTTP](https://nodejs.org/api/http.html#serverrequesttimeout) | “Sets the timeout value in milliseconds for receiving the entire request” | Explicit native setting change. |
| [Node socket bytes](https://nodejs.org/api/net.html#socketbytesread) | “The amount of received bytes.” | Passive progress observation, checked through real transport. |
