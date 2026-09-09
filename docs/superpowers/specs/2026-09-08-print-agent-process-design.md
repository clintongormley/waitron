# The print agent process — design (Track H, push step 3, slice 1)

**Date:** 2026-09-08. **Status:** design, approved section-by-section with the owner; plan follows.

**Track H** (hardware). Builds on the printing subsystem
([2026-08-17-printing-subsystem-design.md](2026-08-17-printing-subsystem-design.md)) and realises the
"native on-device agent, printing first" of
[till-reroute-route-decision §3](2026-09-05-till-reroute-route-decision.md), in its first form: a
standalone container. Follow-ons: the virtual PDF printer (Track H item 2), the un-pin of IP printers
from one agent (failover-printing §4a, Track H item 3).

> **Amended 2026-09-08, before implementation** — §2.3's enrolment is superseded by
> [2026-09-08-device-join-and-accept-design.md](2026-09-08-device-join-and-accept-design.md) §7,
> which extends join-and-accept to devices and makes one mechanism serve both surfaces. In short:
> the verification code becomes a two-digit number the admin picks out of three (the pending list no
> longer returns it), `join` is gated on a venue-wide fifteen-minute pairing window, and pending
> agents are recommended to move to their own `local` table. Read §7 there before implementing §2.3
> here.
>
> **2026-09-09 — implemented on `feat/print-agent-process`.** Enrolment was built per device-join §7
> above (the shared `join_requests` table), superseding this design's own §2.3 and the plan's
> Tasks 5–8.

## 1. What this delivers

Today the server side of printing is complete — enrolment, auth, the outbox, the claim lease, the
transports — and **no process calls it**. This slice is that process: a headless program that joins a
venue, follows its primary wherever it is (LAN box or cloud), pulls its printers' jobs and pushes the
bytes to a USB or IP printer. A venue with the agent running and one IP printer prints kitchen tickets
and receipts end to end.

Owner decisions taken in this brainstorm (2026-09-08):

- **A container now, built to move onto a till.** The agent's core is a db-free package; everything
  that touches the machine sits behind a `Host` seam so the same code later ships as the till's native
  agent with a second host, not a rewrite.
- **The agent learns the venue's servers from its own job-pull reply**, starting from the one address
  it is given. No LAN discovery (cloud rule 1).
- **Join-and-accept replaces the pairing code.** The agent knocks; the admin accepts or denies in the
  dashboard. No code to copy, nothing typed but a server address, and only when the agent is not on
  the server's own box. The pairing-code table, routes and dashboard control are deleted.
- **Each agent pulls only its own printers' jobs; there is no agent-to-agent forwarding.** A USB
  printer's agent is the one on the box it is plugged into; the server is the queue.
- **When the server rejects its token the agent stays up and says so** — it never exits into a restart
  loop; a restart asks to join again.
- **The one thing the agent listens on is a setup/status page**, on the venue LAN, carrying no jobs
  and no secrets. The server link stays outbound-only (cloud rule 5).

## 2. The pieces

```text
packages/print-agent   @waitron/print-agent — db-free; the loop, the router, the client, the transports
apps/print-agent       the container host: env/state-dir config, the setup page, esbuild bundle, Dockerfile
packages/printing      loses the transports (moved), keeps runtime.ts; authenticateAgent learns "pending"
apps/server            print-api.ts: join/accept/deny replace enrol/codes; the pull reply carries servers
packages/db            print_agents: + approved_at, + join_code; print_agent_pairing_codes dropped
apps/dashboard         printers screen: the "generate code" form becomes the pending list with Accept/Deny
```

### 2.1 `@waitron/print-agent` (new, db-free)

No workspace dependencies: the server's `agent.*` codes are read off the wire as strings, never
thrown. Node built-ins for the socket and the device file. Never imports `@waitron/db` or
`@waitron/printing` (the dependency runs the other way — §2.1 `transport.ts`).

- `client.ts` — the three server calls over an injected `fetch`: `join(name)`,
  `pullJobs(token)`, `report(token, jobId, outcome)`, plus `probeNode(url)` for `GET /api/node`.
  Each returns a typed result or a typed failure (`unreachable`, `unauthorized`, `pending`,
  `bad_reply`); nothing here throws for a network condition.
- `router.ts` — the till's follow-the-primary rule, in Node
  ([till-reroute §4.1](2026-09-05-till-reroute-design.md)). Holds the server list, probes every server
  each round in parallel (3 s timeout each), and points `current` at the one answering
  `acceptingSales: true` — the highest `term` if several. None → `current` stays and probing goes on;
  there is no giving up and no failure count. The configured address is always a member, like the
  till's own origin. A server whose `environment` differs from the one the agent joined against is
  skipped (CLAUDE.md §5).
- `transport.ts` — `NetworkTcpTransport`, `UsbTransport`, `RoutingTransport`, `FakeSink`, the
  `Transport`/`PrinterTarget` types and the `PrintTransport` union, moved verbatim from
  `packages/printing/src/transport.ts` with their tests. `packages/printing` type-imports
  `Transport`/`PrinterTarget`/`PrintTransport` from here (it has no runtime use of the adapters; its
  suites use `FakeSink`).
- `agent.ts` — `runOnce(host)` and `start(host)`; §4.
- `host.ts` — the seam:

```ts
interface Host {
  config(): Promise<AgentConfig | null>;         // { serverUrl, name, environment? } or null = unconfigured
  saveConfig(c: AgentConfig): Promise<void>;
  token(): Promise<string | null>;
  saveToken(t: string | null): Promise<void>;    // null clears it
  transport: Transport;                          // what the host can drive
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  log: { info(msg: string, fields?: object): void; warn(...): void; error(...): void };
  status(s: AgentStatus): void;                  // the host renders this (the setup page, a screen)
}
```

`AgentStatus` is `{ phase: "unconfigured" | "pending" | "running" | "unauthorized" | "unreachable",
serverUrl, current, verificationCode?, lastJobAt?, lastError? }` — everything the setup page shows,
nothing secret.

### 2.2 `apps/print-agent` (new, the container host)

- Config from env when set — `WAITRON_SERVER_URL`, `WAITRON_AGENT_NAME` (default the hostname),
  `WAITRON_STATE_DIR` (default `/var/lib/waitron-print-agent`), `WAITRON_SETUP_PORT` (default 9110) —
  otherwise from `<state-dir>/config.json`, which the setup page writes. Env wins over the file, so a
  compose-supplied address is never overridden by the page. The token lives in `<state-dir>/token`,
  mode 0600, written atomically. Every value can come from the environment or a file (cloud rule 4).
- The setup/status page: a small Hono app on port 9110, published on the venue LAN by default (owner,
  2026-09-08: the person reading it is usually at the dashboard, not at the printer's box). It trusts
  nothing about its caller and shows nothing secret; a venue that wants it loopback-only changes the
  publish line to `127.0.0.1:9110:9110`. Unconfigured: one required field, *server address*, one
  optional, *name*; Save. Joining/pending: "Waiting for approval in the dashboard — verification code
  **ABCD**". Running: the server it follows, last job time, last error. Unauthorized: "This agent was
  revoked — restart it to ask to join again."
- Bundled with esbuild to `dist/print-agent.js` like `apps/server`'s bins; `Dockerfile` in this
  directory (node 24 alpine, the state dir a named volume, a USB printer via `--device
  /dev/usb/lp0`). Track P's compose wires it in beside the server later; on that box the compose sets
  `WAITRON_SERVER_URL` to the server's service address, so the same-box agent needs nothing typed.

### 2.3 Server side (`apps/server`, `packages/printing`, `packages/db`)

**Data.** `print_agents` gains `approved_at timestamptz null` (NULL = pending) and `join_code text
null` (the 4-character Crockford verification code, set at join, cleared at accept). `active` keeps
its meaning (revoked = false); deny sets it false without ever approving, so a denied row is a revoked
row that was never approved — hidden by the dashboard, refused by auth. `print_agent_pairing_codes` is
dropped (pre-production: drop and recreate, no backfill — CLAUDE.md §3). Both are core-set tables
already; the column change and the drop are a regenerated core migration + its `--custom` grants
twin, per §3's recipe. `classification.ts` loses the pairing-codes line.

**Auth.** `authenticateAgent` (`packages/printing/src/agent.ts`) selects `approved_at` alongside
`token_hash`; a verified token on an unapproved row throws `agent.pending` (→ 403), so the agent can
tell "wait" from "go away". Everything else stays folded into `agent.unauthorized` (401): unknown,
revoked, denied, bad secret. `enrolAgent`/`generateAgentCode` and their codes
(`agent.pairing_invalid`, `agent.pairing_expired`, `agent.pairing_rate_limited`) are deleted with
their routes — nothing is shipped, so no deprecation sibling is needed; the commit says so.

**Routes** (`print-api.ts`):

| Route | Auth | Does |
| --- | --- | --- |
| `POST /print-api/agent/join` `{ name }` | none; rate-limited (the enrol limiter, code `agent.join_rate_limited`); refused with `agent.join_full` when the tenant already has 10 pending rows | inserts the row (`approved_at` NULL, `join_code` minted, token hashed); returns `{ agentId, token, verificationCode }` |
| `GET /print-api/agent/jobs` | agent | unchanged claim; the reply gains `nodeId` and `servers` (`routableServers(held)` from `@waitron/membership`, the till read's exact shape) — `[]` when no document is held |
| `POST /print-api/agent/jobs/:id/result` | agent | unchanged |
| `GET /management-api/print-agents` | `printer.manage` | rows gain `approvedAt` and `joinCode`; denied rows (never approved, inactive) are omitted |
| `POST /management-api/print-agents/:id/accept` | `printer.manage` | `approved_at := now(), join_code := null` on a pending active row; 404 otherwise |
| `POST /management-api/print-agents/:id/deny` | `printer.manage` | `active := false` on a pending row; 404 otherwise |
| `POST /management-api/print-agents/:id/revoke` | `printer.manage` | unchanged |
| `POST /management-api/print-agents/codes` | — | **deleted** |
| `POST /print-api/agent/enrol` | — | **deleted** |

`mountPrintApi` gains `readMembership` in its deps for `servers` — one added line at the call in
`boot.ts` (the shared file).

**Dashboard** (`apps/dashboard/src/screens/printers-screen.ts`, a Track 1 file — edit confined to this
screen and its strings/client): the generate-code form becomes **"Print agents waiting to join"** —
name, verification code, Accept, Deny (Deny behind the same two-step confirm as Revoke). The enrolled
list shows only approved rows. Below the pending list, the one line a non-techie needs: "On the
computer the printer is plugged into (or from here, at `http://<that computer>:9110`), enter this server address:
`<the dashboard's own origin>`."

## 3. Joining — the operator's view

1. Start the agent. On the server's own box it already knows the address (compose); anywhere else,
   open `http://<that box>:9110` from any machine on the LAN and type the address the dashboard shows.
2. The agent calls `join`, saves the token, and shows "Waiting for approval — code ABCD".
3. In the dashboard, the agent appears under *waiting to join* with the same code. Accept.
4. Within one poll the agent is running. Assign printers to it in the dashboard as today.

Denied: the row is revoked; the agent's next pull is 401; it clears the dead token, shows "denied or
revoked — restart to ask again", and stops asking until restarted (an automatic re-join would put a
denied agent straight back in the list). On restart it has no token, so it joins afresh (a new row, a
new code). Revoked later: the same.

## 4. The loop

`runOnce(host)`, in order; every step's failure is caught, reported through `host.status`, and the
loop moves on. `start(host)` calls it forever and never throws.

1. **Config.** `host.config()` null → status `unconfigured`, done (the page is where it gets one).
2. **Probe.** The router round (§2.1). The first successful probe fixes `environment` into the saved
   config if it was unset.
3. **Credential.** No token → `join(name)` at `current`; save the token; status `pending` with the
   verification code; done for this tick.
4. **Pull** from `current`. `pending` → status `pending`; `unauthorized` → clear the token, status
   `unauthorized`, and set an in-memory `halted` flag so later ticks neither pull nor re-join until the
   process restarts (§3); `unreachable` → status `unreachable`; each of these ends the tick. A good
   reply merges `servers` into the router (the configured address is never dropped) and records
   `nodeId`.
5. **Push and report**, one job at a time, in reply order: `transport.send` then `report`. A failed
   send reports `failed` with the error text. A report that cannot be delivered is logged and dropped:
   the server's 60 s lease reclaims the job, and reprint-not-drop is the runtime's stated rule
   (`PRINT_JOB_LEASE_MS`, at-least-once).
6. A full batch (`PULL_BATCH_LIMIT`) → run again at once; otherwise sleep the interval (2 s).

Logging is on **state change** only — the host's `status` callback and the log see a line when the
phase or `current` changes, never per tick — so a dead box does not write a line every two seconds.

After a failover the promoted node holds replicated `print_agents` and `print_jobs` (both `state`), so
the token still verifies and a job the old primary handed out but never heard about is reclaimed by
the lease. Nothing to reconcile on the agent.

## 5. Security notes

- The agent holds one secret, its token, in a 0600 file on a named volume; the page never shows it.
- `join` is the one unauthenticated write. Two guards: the per-process fixed-window limiter the enrol
  route used (`enrol-rate-limit.ts`, 30/min), and a per-tenant cap of 10 pending rows, refused (not
  evicted — eviction would let a stranger push the real agent out). Junk rows are one Deny each.
- A pending token is useless: `authenticateAgent` answers `agent.pending` on every route, so an agent
  that has not been accepted can neither claim nor report.
- Accept/Deny need a management session with `printer.manage`, like every management route here.
- The verification code is a 4-character Crockford string: enough for an admin to tell two names apart
  on a small LAN, not a secret, not a credential. It is shown in the dashboard and on the agent's page
  and nowhere else.
- The setup page is on the venue LAN, unauthenticated: anyone on the LAN can read the agent's phase
  and set its server address while it is unconfigured. It carries no secret and no job, and a wrong
  address only makes the agent knock on a door the admin never opens. A venue that wants it
  loopback-only changes the publish line.

## 6. Testing

- **`@waitron/print-agent`, unit, hermetic:** client against a fake `fetch` (each typed failure);
  router (the accepting server wins, highest term on a tie, environment mismatch skipped, none
  accepting keeps `current`, configured address never dropped); loop against a fake host + `FakeSink`
  (each phase, a 401 leaves the token in place, a failed send reports `failed`, a lost report is
  logged not retried, full batch loops at once); the transports' existing loopback-TCP and temp-file
  suites, moved. Prove the environment skip and the "configured address never dropped" rule by
  deletion.
- **`apps/print-agent`, unit:** env-over-file precedence, the 0600 atomic token write, the setup page's
  save and the status rendering per phase (Hono `app.request`, no listener).
- **Server routes** (`print-api.test.ts` PGlite, `print-api.pg.test.ts` real PG for the grants on the
  new columns and the `app_user` shape): join (limiter, cap, minted code), accept/deny (pending-only,
  404 otherwise, deny hidden from the list), pending → 403 on pull and report, `servers`/`nodeId` on
  the pull, the deleted routes answer 404.
- **End to end, in `apps/server`** (packages never import apps): the real `mountPrintApi` on PGlite,
  the agent's `runOnce` with `fetch` routed to the Hono app, a loopback TCP listener as the printer →
  join, accept, `enqueuePrintJob`, pull, the bytes land on the listener, the job is `done`; then a
  revoke → the loop reports `unauthorized` and claims nothing.
- **Manual receipt, recorded here when taken:** one dashboard test-print to the owner's HP Color
  LaserJet M181fw at `192.168.20.56:9100` through the real container. Probed 2026-09-08 with
  `nc -z`: 9100 open, 631 open, HTTP 200 on 80. This proves the TCP path and nothing about receipt
  formatting — it is not an ESC/POS device, escape codes will print as stray characters and "cut" does
  nothing. Nothing is sent to it without the owner's go-ahead.
- Coverage: the new package and app at the 90/90/85/85 floor — which `packages/printing` is also on (`packages/printing/vitest.config.ts:33`; it is NOT one of `scripts/coverage-thresholds.test.ts`'s six high-bar packages). `packages/db` keeps 98/98/98/95.
- Root guards to run after the schema change: `classification-complete`, `append-only-enable-always`,
  `errors-reachable`. The new package throws no codes — it reads the server's `agent.*` codes off the
  wire — so it ships no `errors.ts`; the codes stay declared in `packages/printing/src/errors.ts`.

## 7. Out of scope (each its own slice)

- **Virtual PDF printer** (Track H item 2): a `virtual` transport whose jobs complete at enqueue, and
  `GET /management-api/print-jobs/:id/pdf` rendering any job's ESC/POS payload to a receipt-shaped PDF
  (`pdf-lib`), with a Download link on every job in the dashboard and a virtual printer in the dev
  seed. No agent needed; works in the cloud. **With retention (owner, 2026-09-08):** nothing deletes a
  `print_jobs` row today, so every ticket's bytes accumulate forever; item 2 adds a daily sweep that
  deletes `done` jobs and at-cap `failed` jobs older than seven days (the `backup-sweep` shape), and
  the download is offered only while the row exists. Whether `app_user` holds DELETE on
  `print_jobs` is item 2's first check — never widened to make a test pass.
- **Un-pin IP printers** (failover-printing §4a, Track H item 3): any agent at the location serves a
  `network_tcp` printer; the distinct-agents race test; location-scoped authorisation; security
  review.
- **Non-Linux USB hosts** (macOS/Windows spooler, Android USB host) — further `Host` implementations
  with the native till agent.
- **Long-polling** the pull route, if a 2 s interval ever feels slow.
- **Installing the agent on a non-server box** is a packaging question (Track P / the native app);
  this slice ships the image and the page, not an installer.

## 8. Shared files (coordination)

`apps/server/src/boot.ts` (one dep at the `mountPrintApi` call), `packages/db` schema + a regenerated
core migration pair, `packages/db/src/classification.ts` (one line), `apps/dashboard`'s printers
screen + its API client + strings (Track 1). Whoever lands second rebases; the migration is regenerated
per CLAUDE.md §3.
