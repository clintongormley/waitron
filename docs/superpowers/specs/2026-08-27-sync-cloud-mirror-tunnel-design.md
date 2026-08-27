# Sync cloud-mirror — sub-project B: the outbound tunnel

**Status:** design, awaiting owner review · **Date:** 2026-08-27 · **Branch:** `feat/sync-outbound-tunnel`

## 0. Where this sits

"Build the sync cloud-mirror peer" (backlog top-tier #2) is three subsystems, proven against a
**local stand-in cloud** (no real hosting, DNS or TLS yet — none exists):

- **A — Peer identity & auth. LANDED (#144).** Each subscriber has its own DB-backed identity and a
  per-peer scrypt bearer token; the source derives `subscriberId` from the token, never the body
  ([spec](2026-08-27-sync-cloud-mirror-peer-identity-design.md)). This closed a real data-loss forge
  gap and is the hard prerequisite for B and C.
- **B — Outbound tunnel (THIS spec).** Invert the *transport* so the on-prem box always dials
  outbound and the cloud's pull rides back down the box-initiated connection. The box is behind NAT
  and cannot be dialed; the cloud is in a datacentre and can dial freely. Proven against a **local
  relay stand-in**. Authenticates the box to the relay with a new box↔relay credential; the cloud→box
  leg keeps A's per-peer token unchanged.
- **C — Cloud read-mirror (later).** A "mirror mode" of `apps/server` that pulls + applies into its
  own Postgres and serves the dashboard read-only. First real subscriber of the ordered lane, so the
  `dining_tables` FK-closure enrolment (the `fkRank` hard-gate) lands **there**.

This spec is **only B**. It changes **no application-level sync behaviour**: `runSyncPull`,
`syncPullOnce`, `sync-api.ts`, the wire format, the cursor/retention model, and A's token auth are all
untouched. B adds a transport *beneath* them.

## 1. The scenario, in plain terms

Two Waitron nodes replicate by an application-level outbox: every committed row is captured into
`sync_log`, a subscriber "pulls" the rows past its cursor and re-applies them, and reports how far it
has caught up. On a LAN, the subscriber simply makes HTTP requests to the source's URL — the source is
directly reachable ([pull.ts](../../../packages/sync/src/pull.ts), `syncPullOnce`).

The cloud DR mirror is a subscriber too, but the source it must pull from — the venue box — **sits
behind NAT with no inbound ports**. The cloud cannot open a connection *to* the box. So we invert the
transport: the **box dials out** to a relay we operate and keeps that connection open; when the cloud
wants to pull, its request rides **back down the box-initiated connection**. The box's own HTTPS server
answers, exactly as if the cloud had reached it directly. Nothing about "the cloud is the subscriber
and pulls past its cursor" changes — only the direction of the underlying TCP handshake does. This
matches the settled direction decision (memory `sync-cloud-mirror-connection-direction`, confirmed
with the owner 2026-08-15).

## 2. Why a reverse tunnel (and why blind)

Three properties drive the shape:

1. **The box must initiate every connection** (NAT). So the box pre-establishes idle connections to a
   public relay and replenishes them; the relay can then hand the cloud one the instant it arrives.
   This is the frp/ngrok/snitun reverse-tunnel pattern.
2. **The relay must be blind.** The cloud mirror is a *distrusting* leg (the reason A exists); the
   relay we operate should route ciphertext and never hold data or credentials. So **TLS runs
   end-to-end box↔cloud** and the relay only ever splices raw bytes. The box already terminates HTTPS
   with its own cert ([tls.ts:43](../../../apps/server/src/tls.ts#L43), onboarding CA-serving #143), so
   this needs no new TLS machinery on the box — the tunnel proxies the existing HTTPS port.
3. **A's auth must survive unchanged.** The per-peer Bearer token authenticates cloud→box and
   terminates on the box's `sync-api`; because TLS is end-to-end, the relay never sees it. The box
   authenticates to the *relay* with a **separate** credential (§8) — a different pair, a different
   concern (anti-impersonation / tenancy, not confidentiality: a stranger who registers as this box
   still cannot answer the cloud's TLS, lacking the box's key).

**Licence:** this is the snitun *pattern* reimplemented in Node, never the GPL-3 snitun code — the
chosen, GPL-clean path ([dashboard §7](2026-08-07-management-dashboard-design.md)).

**Rejected alternatives** (owner decision, 2026-08-27, recorded so they are not silently revisited):
an app-layer relayed poll (CloudPRNT-style) was rejected because the relay would see plaintext and the
per-peer token in flight — not blind — and would re-implement request/response correlation the byte
splice gets for free; a box-pushes-rows-up-with-cursor-acks model was rejected because it changes the
sync *protocol* (the box becomes the active party) and forces the cursor/retention model to be
re-reasoned, trading a solved problem for an unsolved one.

## 3. Locked decisions

1. **Blind byte-splice reverse tunnel.** Box dials out, relay splices, TLS end-to-end. `runSyncPull`
   and A's token auth are byte-for-byte unchanged.
2. **New `@waitron/tunnel` package**, not code in `packages/sync` or `apps/server`. The mechanism is
   transport-agnostic (it proxies to a configurable local port) and is the same one the dashboard's T1
   remote-access tunnel needs later ([dashboard §5/§8](2026-08-07-management-dashboard-design.md)), so
   it is shared infra (`replication-is-shared-infra`). `@waitron/sync` never learns the tunnel exists.
3. **Relay stand-in only.** SNI-peek routing, multi-box relay, and scale are the real-T1 relay's job
   and are out of scope; the stand-in serves one box and is a test/dev harness, not shipped hosting.
4. **New box↔relay credential**, verified with the existing `verifySecret`/`timingSafeEqual` crypto —
   no new crypto. Absent by default → the tunnel is off.
5. **Wire the box's tunnel client into boot now**, guarded by config (inert unless `WAITRON_TUNNEL_*`
   is set), so "the box always dials out" is real and C inherits a working box.
6. **v1 = single-tenant DR mirror**, matching A. The multi-tenant whole-log reader and the
   fiscal/hash-chain lane stay deferred.

## 4. The mechanism

```
 Box (behind NAT)                 Relay (BLIND)              Cloud subscriber
 ─────────────────                ─────────────              ────────────────
 tunnel client ──REGISTER────────▶ park in box pool
      (× poolSize idle conns)      ◀──ACK──
      · heartbeat PING/PONG ·
                                                     ◀──TLS connect (SNI=box)── runSyncPull
                                   pop idle conn, send GO ─▶
 on GO: dial localhost:httpPort    ══ raw byte splice ══      GET /hello /log · POST /cursor
 pipe ◀════ box's own HTTPS ═══════════════════════════════▶ (per-peer Bearer token, A #144)
 replenish pool
```

- The box's `runTunnelClient` opens `poolSize` connections to the relay, each REGISTERing with the box
  id + relay token, and keeps them idle with a heartbeat. It replenishes the pool whenever a
  connection is consumed (goes to splice) or dies.
- The relay parks idle box connections keyed by box id. When a cloud connection arrives, it pops one
  idle box connection, sends it `go`, and **splices the two TCP streams** raw in both directions.
- On `go`, the box dials `localhost:<httpPort>` (its own HTTPS server) and pipes bytes between the
  relay connection and the local socket. The box's HTTPS server terminates the cloud's TLS and answers
  the sync-api request. When either side closes, the box closes the other and the slot is gone; the
  pool is topped back up.
- One spliced connection can carry several sequential HTTP requests via keep-alive (the cloud's undici
  Agent reuses it for `hello`, then `log`, then `cursor`), so a single-peer pull needs no
  multiplexer. `poolSize` (default 4) covers reconnect races and any incidental concurrency.

## 5. Package structure & boundaries

New `packages/tunnel` (`@waitron/tunnel`), following the enumerated-`exports` convention
(`@waitron/db`, CLAUDE.md §3) — no wildcard.

| File | Purpose | Exports |
|---|---|---|
| `src/protocol.ts` | Frame types + a newline-delimited-JSON encode/decode with the leftover-buffer contract (§6). Pure, no I/O. | `.` |
| `src/client.ts` | `runTunnelClient(deps)` — pool, handshake, splice-to-localhost, heartbeat, reconnect/backoff, abort. | `.` |
| `src/errors.ts` | `tunnel.*` codes; `import "./errors.js"` keeps them reachable (tree-wide guard). | `.` |
| `src/index.ts` | Barrel. | `.` |
| `src/testing/relay.ts` | The relay stand-in: `createRelayStandin({ verifyToken })` → a listening TCP server that pairs + splices. For tests and local dev only. | `./testing/relay.js` |

**Note (impl 2026-08-27):** shipped **without** `src/errors.ts` — the `tunnel.*` codes are *logged*
free strings, not thrown, so there is no `AppError` to register and no reachability guard to satisfy
(the plan reconciled this against the `sync.pull_failed` precedent). No `errors.ts` row and no
`import "./errors.js"` exist in the package.

**Isolation check.** `runTunnelClient`'s one job is "keep the box reachable through the relay by
proxying to a local port"; it knows nothing of sync, cursors, or SQL. The relay stand-in's one job is
"pair a registered box connection with a client connection and splice." Either can be understood and
changed without the other, and neither touches `@waitron/sync`.

**Grants/RLS/migrations:** none. B introduces no table and no SQL — it is pure transport. (This is why
it is not gated on the fiscal `inmutabilidad` FORCE-RLS scan or any migration numbering.)

## 6. The wire protocol

Frames are **newline-delimited JSON**, used **only** for the pre-splice handshake; after `go` the
connection carries **raw bytes** (the cloud's TLS records) and is never reframed.

| Frame | Direction | Meaning |
|---|---|---|
| `{"t":"register","boxId":...,"token":...}` | box → relay | claim an idle slot in this box's pool |
| `{"t":"ack"}` | relay → box | registered; connection idle |
| `{"t":"ping"}` / `{"t":"pong"}` | either → other | idle heartbeat; a missed pong (plus TCP keepalive) marks the connection dead and it is replaced |
| `{"t":"go"}` | relay → box | a client is paired; **the next byte on this connection is raw splice data** |
| `{"t":"reject","code":...}` | relay → box | registration refused (bad token / unknown box); box logs `tunnel.registration_rejected` and backs off |

**Named trap (CLAUDE.md §1 — name the gotcha, don't assume it away):** the box reads handshake frames
line-by-line, and its line reader **must** hand any bytes buffered *past* the `go` newline straight
into the splice rather than discarding or re-parsing them. In practice the relay sends `go` and then
waits for the cloud's first byte, so a round-trip separates them and the leftover is empty — but the
code must not depend on that. `protocol.ts`'s decoder returns `{ frame, rest: Buffer }` so this is a
value the splice consumes, tested directly (§12), not an implicit assumption.

**The symmetric case — a control frame in flight box→relay at pairing (a known, self-healing race).**
The trap above is the relay→box direction; the box→relay direction has the mirror-image gap, and it is
*not* fully closed by this slice. The box writes control frames (`ping`) on an idle connection, and the
relay chooses *which* idle connection to splice. If the relay pops a connection for pairing while a
`ping` the box already put on the wire is still in flight box→relay — arriving after the relay has
detached its idle frame reader — the relay forwards those `ping` bytes raw to the cloud, ahead of the
box's TLS ServerHello, corrupting that one handshake. The window is ≈ one RTT per heartbeat interval
(default 15 s) and must coincide with a pairing, so it is rare; sync is a retry/outbox model with a
cursor-idempotent apply, so the failed pull simply retries and the next attempt does not coincide — **no
data loss, and a `ping` carries no secret.** The box cannot prevent it (it has no signal that pairing is
imminent until `go` arrives, by which point the ping is already sent), so closing it is a
**protocol-level barrier the real T1 relay must add** — drain any pending pre-`go` control frame before
splicing, or invert the heartbeat to relay→box so an idle box writes nothing on the wire. Deliberately
out of scope for this single-box stand-in (recorded as a T1 follow-up, §11); the stand-in's tests never
hit it because loopback pairing is either immediate (no ping yet) or after a clean pong.

## 7. Cloud-side HTTP client — a tunnel-aware dispatcher

The only cloud-side code is a **sibling of [`fetchHttpClient`](../../../apps/server/src/sync-http.ts)**:
a custom undici `Agent` whose connector **dials the relay's address** while presenting the **box
hostname** as the TLS `servername` (so the box's cert validates) and trusting the box's CA. This is the
same custom-dispatcher shape [`mtlsFetch`](../../../apps/server/src/aeat-transport.ts#L124) already
uses for AEAT mTLS. `peer.url` is `https://<box-hostname>/`; the dispatcher routes the TCP to the
relay. `runSyncPull` receives this client through its existing `deps.http` seam — **no loop change**.

The exact undici connector form (the `connect`-function the `Agent` accepts, vs. a `buildConnector`
wrapper) is pinned by the implementing test, not asserted from memory here — it is an internal library
detail verified by TDD, not a claim this spec should carry unproven (CLAUDE.md §1).

This client is a small module; whether it lives in `@waitron/tunnel` (as `./testing`-adjacent client
help) or beside `sync-http.ts` in `apps/server` is settled during the plan — it is the cloud/C's
concern, and B only needs it to exist for the e2e test. Default: a `tunnelHttpClient` beside
`sync-http.ts`, since that is where the sync `HttpClient` seam already lives and where C will wire it.

## 8. Relay auth & config

The box authenticates to the relay on `register` with a bearer token the relay verifies via
`verifySecret`/`timingSafeEqual` (reuse crypto, write none). New box config, all read by a
`loadTunnelConfig(env)` beside `loadSyncConfig`:

- `WAITRON_TUNNEL_RELAY_URL` — the relay's address (host:port). Absent → tunnel off.
- `WAITRON_TUNNEL_BOX_ID` — this box's id at the relay (the pool key).
- `WAITRON_TUNNEL_TOKEN` — the box↔relay bearer token.
- `WAITRON_TUNNEL_POOL_SIZE` — optional, default 4.

All three of URL/BOX_ID/TOKEN are required together; any subset present without the others is a loud
config error (fail closed), the `loadSyncConfig` posture. An **empty** `WAITRON_TUNNEL_RELAY_URL` is
refused explicitly — an empty string is not a valid URL, mirroring the empty-connection-string trap
(CLAUDE.md §3).

The relay stand-in takes a `verifyToken(boxId, token) → boolean` injection; the test supplies a
constant-time check against a known fixture token. Real relay token storage is the T1 relay's job.

## 9. Reconnect / backoff & shutdown

`runTunnelClient` reuses the `loop.ts` idiom: an injected `sleep(ms, signal)` and an `AbortSignal`, so
suites assert durations rather than waiting them and SIGTERM never waits out a backoff. When the relay
is unreachable or drops connections, the client redials with **bounded exponential backoff**; when
backoff first saturates it logs `tunnel.stream_stalled` (mirroring `sync.stream_stalled`,
[pull.ts](../../../packages/sync/src/pull.ts)) for the operator alarm — **no payload content in any log
line**. Individual pool-connection deaths are replaced without tearing the whole client down; only a
failure to *establish* connections drives backoff.

## 10. Boot wiring

Beside the sync block ([boot.ts:802-862](../../../apps/server/src/boot.ts#L802)): after
`loadTunnelConfig(env)`, if the tunnel is configured, start `runTunnelClient` with
`localPort = config.httpPort` and register it in `close()`'s teardown set so SIGTERM aborts it with the
rest. Inert when unconfigured — no behaviour change to any existing deployment. The client's own loop
never rejects (it backs off every error), matching how boot treats `runSyncPull`'s promise
([boot.ts:867](../../../apps/server/src/boot.ts#L867)).

## 11. Out of scope (named, not dropped)

- **SNI-peek routing, multi-box relay, scale, real hosting/DNS/TLS-certs** — the real T1 relay.
- **The cloud read-mirror's apply/store and the `dining_tables` FK-closure enrolment** — sub-project C.
- **Multi-tenant whole-log reader** and the **fiscal hash-chain lane** — later slices.
- **Relay-side token persistence / an enrolment CLI for box↔relay tokens** — the stand-in takes an
  injected verifier; real storage is T1's.
- **Protocol/robustness hardening the real T1 relay + client want** (all within B's accepted
  semi-trusted-relay threat model, so out of scope for this stand-in, and each self-heals or fails
  closed today):
  - the **box→relay control-frame splice race** (§6) — a pre-`go` `ping` can leak into the spliced TLS
    stream; the T1 relay must drain pending control frames before splicing, or the heartbeat inverts to
    relay→box;
  - a **max pre-`go` frame-length guard** — a malformed/hostile relay that streams bytes with no newline
    grows the client's frame buffer unbounded (OOM); cap it and drop the connection;
  - **ignore `go` while not yet registered** — a relay that sends `go` before `ack` should not drive the
    box to dial its local port (no disclosure — the per-peer Bearer token still gates the sync-api);
  - a **registration/handshake timeout** — a relay that TCP-accepts but never sends `ack`/`reject`/close
    parks a pool slot until abort;
  - a **disposal seam on `tunnelHttpClient`** so C's long-running subscriber can release its undici
    `Agent` keep-alive pool (§7).

## 12. Testing

- **Headline e2e (faithful, proves blindness).** Stand up the real `sync-api` on a localhost **HTTPS**
  server (self-signed via `tls.ts`), the relay stand-in, and `runTunnelClient`. Drive `runSyncPull`
  with the tunnel-aware dispatcher and `peer.url = https://<box-hostname>/`. Seed rows in the box's
  `sync_log`; assert the cloud **pulls + applies** them, the cursor **advances**, and
  `POST /sync-api/cursor` reports back — all through the tunnel. **Assert the relay only ever observed
  bytes that parse as TLS records** (never plaintext, never the Bearer token) — the blindness property,
  proven by inspection of what the splice copied, not by assumption.
- **Proven by deletion** (CLAUDE.md §4): break the splice's leftover-buffer handoff (drop `rest`) and
  watch a request that packs bytes after `go` fail; restore and it passes.
- **Relay pairing unit tests:** register → ack → idle; a second registration parks a second pool slot;
  a client pops the oldest idle slot, receives `go`, and gets a bidirectional splice; an unknown box id
  or bad token gets `reject`.
- **Client unit tests:** the pool is replenished after a slot goes to splice; a dead idle connection
  (missed pong) is replaced; the relay being unreachable drives backoff and saturates to
  `tunnel.stream_stalled`; abort tears every connection down promptly.
- **`protocol.ts` unit tests:** frame round-trips; a frame split across two reads reassembles; the
  `go` frame returns the correct `rest` leftover.
- **Config tests:** all-three-present enables; any-subset is a loud error; empty URL is refused.
- **Target choice:** the tunnel/relay/protocol suites are pure Node sockets — **no database**, so no
  PGlite-vs-real-PG question for them. The e2e uses whatever DB the `sync-api`/pull path already needs
  (real Postgres, since it exercises `sync_log`/`sync_cursor` under the sync roles — PGlite cannot show
  the role split, CLAUDE.md §4). `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Coverage:** new package holds 98/98/98/95; run `pnpm --filter @waitron/tunnel test:coverage` and
  `pnpm --filter @waitron/server test:coverage`, plus the **unfiltered** `@waitron/tunnel` and
  `apps/server` suites (cross-cutting guards do not load under a name-filter). A pure-Node package with
  no DB and framed I/O is coverage-friendly; the reconnect/heartbeat timing paths are the ones to watch
  — drive them with the injected `sleep`, never real time.

## 13. Security review

B is part of a distrusting-peer boundary, so a security review is part of the slice. Points it must
confirm:

- **The relay stays blind.** TLS is end-to-end to the box; the relay copies bytes and never terminates,
  logs, or inspects them. The e2e's ciphertext assertion is the receipt.
- **A stranger cannot impersonate the box** to the relay (the box↔relay token is required and
  constant-time-checked), and even a successful impersonator cannot answer the cloud's TLS (no box key)
  — so the worst a stolen relay token buys is denial of service, not data disclosure. State this
  explicitly.
- **No credential or row content in any log line** — `tunnel.*` params carry ids and counts only, never
  tokens or payload, matching the `sync.*` discipline.
- **A's cloud→box auth is unchanged and unweakened** — the per-peer token still terminates on the box;
  B adds a layer beneath it and removes nothing.
- **Fail-closed config** — a partial `WAITRON_TUNNEL_*` set, or an empty relay URL, refuses to start
  the tunnel rather than dialing something unintended.

## 14. Conventions & error codes

- **Error codes name the domain concept** (`tunnel.*`, CLAUDE.md §3): `tunnel.registration_rejected`
  (the relay refused the box), `tunnel.stream_stalled` (backoff saturated — operator alarm). Both are
  logged, not thrown across a request boundary (there is no HTTP surface here); they exist for the log
  vocabulary and the reachability guard. Grep the `tunnel.` siblings before adding a code; register
  each in `errors.ts` and `import "./errors.js"` from every file that names one.
  **Note (impl 2026-08-27):** shipped without `errors.ts` — because the `tunnel.*` codes are logged,
  not thrown, no registry entry (and hence no `import "./errors.js"`) is needed; the reachability guard
  only covers packages that ship both `index.ts` and `errors.ts`. Reconciled against the
  `sync.pull_failed` precedent (see the plan's Global Constraints).
- **English identifiers throughout** (the package is under the english-only guard's scope); no new
  `SPANISH_WORDS`.
- **Reuse crypto** — `verifySecret`/`timingSafeEqual` for the relay token; write none.
- **Never widen a grant / never build SQL by concatenation** — not applicable; B has no SQL.

## 15. Docs & comments this change touches (editing a file is not auditing it)

- The `apps/server` config docs gain the `WAITRON_TUNNEL_*` block beside the sync/peer config.
- The boot sync-wiring comment region ([boot.ts:802](../../../apps/server/src/boot.ts#L802)) gains the
  tunnel start, documented in the same idiom.
- The **backlog** "B — outbound tunnel" thread ([backlog.md:157](../../../docs/backlog.md#L157)) moves
  from deferred to in-flight/landed, and the memory `sync-cloud-mirror-peer-identity` records B's
  state. (Backlog + memory updated at land, per `/land-branch`.)
- The dashboard design's T1 note ([§5/§8](2026-08-07-management-dashboard-design.md)) gains a dated
  pointer that the reusable box-dials-out mechanism now exists in `@waitron/tunnel` (a pointer, not a
  rewrite — historical docs record what was true when written).

## 16. Provenance

Internal receipts are cited inline as `file:line` against the branch tree and were read from the
current code, not from memory: the pull seam ([pull.ts](../../../packages/sync/src/pull.ts)), the
`HttpClient` production adapter ([sync-http.ts](../../../apps/server/src/sync-http.ts)), the custom
undici dispatcher pattern ([aeat-transport.ts:124](../../../apps/server/src/aeat-transport.ts#L124)),
the HTTPS serve path ([tls.ts:43](../../../apps/server/src/tls.ts#L43),
[boot.ts:225](../../../apps/server/src/boot.ts#L225)), and the sync boot block
([boot.ts:802-867](../../../apps/server/src/boot.ts#L802)). External claims: none of substance — the
snitun *pattern* is architecture, not code, and the exact undici connector form is pinned by test at
build rather than asserted here. The seeding memories (`sync-cloud-mirror-connection-direction`,
`sync-cloud-mirror-peer-identity`, `replication-is-shared-infra`) are point-in-time notes and were
re-verified against code before use.
