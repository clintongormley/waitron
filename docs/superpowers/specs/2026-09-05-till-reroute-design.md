# Till reroute — design (Track B item 1)

**Date:** 2026-09-05. **Status:** design, awaiting owner review; plan follows. **Track B item 1.**
Rests on decision (i) ([`2026-09-05-till-reroute-route-decision.md`](2026-09-05-till-reroute-route-decision.md)),
decision (ii) (no relay), decision (iii) (registers/devices) and Track A's swap spec
([`2026-09-05-outbox-to-native-replication-swap-design.md`](2026-09-05-outbox-to-native-replication-swap-design.md)).
Owner decisions taken in this brainstorm (2026-09-05): **the till follows the primary — no manual
"switch server" control** (a status line + "check again" instead); **only the primary sells**, so a
returned box is a standby until a human promotes it back.

## 1. What this delivers, and what it does not

A till, handheld or display keeps working across a change of primary with no one touching it: it
learns the venue's servers at boot, asks each one "are you accepting sales?", talks to the one that
says yes, and when that one dies waits for a human to promote another, then follows it. The one
thing staff see is a PIN prompt after the move, because the login session lived on the dead node.

**Not in this build:** the precaching service worker (own small slice — decision (i) §2); the
authenticated promote endpoint (Track B item 3, after the squash); the run-it proof on a real cloud
instance (item 2, after Track A's provisioning and WireGuard slices S2/S7); the one-time-ticket
credential for a LAN-only second box (post-MVP); signature verification of the membership document
on the till (v1 trusts the document its own origin served it over TLS; Ed25519 in WebCrypto and
key distribution at pairing are their own slice); the register/device UX (Track 1 area 19).

**Dropped from the backlog's item-1 list, with reasons:** the manual switch (owner, above); the
`dining_tables` enrolment comment and the config-conflict gate trim — both files are deleted by the
swap's S5 (§7 there); R3a's two deferrals are absorbed (§3.1 boot-captured `acceptingSales`; §3.6
venue-wide reads).

## 2. The model

- **One primary sells.** Every other node answers "not accepting sales" — a mirror/standby, a fenced
  returned box, a promoted-but-not-yet-restarted node.
- **The till follows the primary.** It never chooses; it probes and obeys. Both directions
  (box → cloud, cloud → box) are the same rule; the human act is promotion, on the server side.
- **The server list is the membership document** (`node_membership.document.body.nodes[]`,
  `contactUrl`), delivered on the boot read and cached on the device. The page's own origin is
  always a member of the till's list, so a stale or empty cache still reaches the box.
- **Two nodes both claiming primary** (an isolated, unfenced ex-primary — the split-brain window the
  promotion-failover design leaves to humans): the till prefers the higher membership `term`; a till
  that can only see the old primary keeps selling there (the accepted isolated-segment case).

## 3. Server side (`apps/server`)

### 3.1 Role probe — `GET /api/node`

Public, no auth, no DB write, mounted on every mode (primary, mirror, fenced). Answers:

```json
{ "nodeId": "…", "term": 7, "standing": "serving-primary", "acceptingSales": true, "environment": "preproduction" }
```

`acceptingSales` is **boot-captured**: `mode === "primary" && singleton_role === "primary" &&
!fenced`, read once from the same `holders`/`fenced` boot decision `boot.ts` already takes for the
mount guards. Boot-captured on purpose: R3b's promotion persists the corrected series before the
point of no return and takes effect on restart, so a promoted-not-yet-restarted process must answer
`false` (the "selling gated on REBOOT completion" deferral). `term`/`standing` come from
`readNodeMembership` per request (one whole-DB row; the probe runs every few seconds per till, which
is the same order of load as `/health`). Lives in a new `node-api.ts`, mounted in the TRADING branch
beside `mountTillApi` — every trading boot (primary, mirror, fenced), never setup. Not beside
`healthApp`, which is built before the setup/trading fork: a setup box has no node identity to answer
with, and a box that answers nothing reads to a till as unreachable, which is the right answer for
one.

### 3.2 The server list on the boot read

`GET /api/till` (public, mounted on every mode) gains
`servers: Array<{ nodeId, url, standing }>` — the document's nodes with a non-empty `contactUrl`,
`evicted` excluded, ordered serving-primary → serving-secondary → sell-only — and `nodeId` (this
node's own id, so the till knows which entry it is on).

### 3.3 Populating `contactUrl`

_S1 landed 2026-09-06._ The term-0 document now carries the primary's advertised origin as its
`contactUrl`, and the adopt handshake appends the joining node with the origin it advertised, so the
"today" clauses below describe the pre-S1 state. `WAITRON_ADVERTISED_ORIGIN` is validated as a bare
http(s) origin — and so, under its own name, is `WAITRON_MANAGEMENT_ORIGIN`, in EVERY environment
rather than only checked for presence in production. Both throw `server.config_invalid` with
`{ variable, reason: "not_an_origin" }`, so a deployment whose management origin carries a trailing
slash or an explicit default port now fails to boot where it previously started.

- New config `advertisedOrigin` (`WAITRON_ADVERTISED_ORIGIN`; scheme + host [+ port]; defaults to
  `managementOrigin`, the origin the dashboard is already served from). `isUnset` rule; refused if it
  does not parse as an origin.
- `seedTermZeroMembership` (provision) writes it as the primary's `contactUrl` (today `""`,
  `membership-seed.ts`).
- **Adopt adds the joining node to the document.** Today a node is appended only when it promotes
  (`nextStandings` in `promote.ts`), so a standby is absent from the document exactly when tills need
  its address. The adopt handshake carries the joining node's `advertisedOrigin`; the primary mints
  the next document with the node appended as `serving-secondary` (the existing standing for "a
  member that is not primary"; under warm standby it still sells nothing — `acceptingSales` is what
  the till obeys, never the standing), `contactUrl` set. `nextStandings`/`evictNode` already
  preserve `contactUrl` on every other node. This is the one `packages/membership` change (a
  `withMember` helper beside `nextStandings`). How the document reaches the other nodes is the
  swap's concern (`node_membership` is copied by the `state` publication); the till only needs it
  from the node it is talking to.

### 3.4 CORS for the venue's own origins

`hono/cors` on `/api/*` (till, device, locales, media): `origin` = the request's `Origin` when it
is this node's `advertisedOrigin` or the origin of any `contactUrl` in the current document (a
30-second in-process cache of the document, refreshed on read); `credentials: true`;
`allowHeaders: ["content-type", "x-waitron-dev-device"]`; the write verbs. Anything else: no CORS
headers (the browser blocks). In `devMode` the three Vite origins are allowed too.

The cookie side is a browser property, not ours: a `SameSite=Strict` cookie rides a same-site
cross-origin `fetch` with `credentials: "include"`. **Prove it in the build, not by reading** (decision
(i) §4): the plan's first task is a manual probe — two hostnames under one parent in `/etc/hosts`,
mkcert leafs, one server per host — whose FAILING case is a `401 device.unauthorized` on the second
host; the receipt (the two `Set-Cookie`/request-cookie lines) goes in the plan.

### 3.5 Device cookie scope

New config `tenantDomain` (`WAITRON_TENANT_DOMAIN`, e.g. `deli.waitron.app`; optional). `setDeviceCookie`
adds `domain: tenantDomain` when the request host equals it or ends with `.` + it; host-only
otherwise (`waitron.local`, loopback dev). The operator session cookie stays host-only — a move
re-prompts the PIN (v1; the portable token of distribution §4(ii) later). `Secure` as today.

### 3.6 Till reads become venue-wide

`listHeldOrders`, `listStationQueue`, `listExpoQueue` and the retrieve/edit paths in
`working-order.ts` drop `eq(workingOrders.nodeId, cfg.nodeId)` / `eq(ticketItems.nodeId, …)`.
Reason: under warm standby one node sells at a time, and a promoted node inherits the venue's open
tabs tagged with the dead node's id (swap §4.3 — live-service rows are copied, never drained back),
which the own-id filter would hide. `node_id` is still WRITTEN at create (the writer's id; ownership
for replication). Tests that pin the own-node filter are updated as a behaviour change;
`boot.mirror.rls.test.ts`'s "session-shaped, not routing-shaped" premise is retired with a comment
saying why.

### 3.7 What a non-selling node serves a till

Unchanged: the read-only gate 403s `POST /api/session`; the device group is unmounted (404). A till
whose probe says `acceptingSales: false` calls only `GET /api/node` and `GET /api/till` on that node.

### 3.8 CLAUDE.md §5

"Nothing EXTERNAL may block a sale" is rewritten: a till needs *the venue's primary* — the on-site box
when the internet is down; a promoted cloud when the box is dead (which needs the internet); box-down
AND internet-down together is no failover (the MVP's accepted case). AEAT, the card network and the
internet stay off the sale path of whichever node is primary.

## 4. Till side (`apps/till`)

### 4.1 `ServerRouter` (`src/api/server-router.ts`)

Holds the list, the current target, and per-server state; drives the probe loop; is the ONE place
that knows more than one server exists. `TillApi` is untouched (`baseUrl` stays `""`): the router
is applied as a `fetch` wrapper, `withServerTarget(fetch, router)`, composed in `main.ts` exactly
where `withDevDeviceHeader` is, rewriting a relative `/api/…` (and `/media/…`) path to an absolute
URL on `router.current`. Same-origin when the current target is the page's origin — byte-identical
behaviour to today until a move happens.

- **List:** `servers` from the boot read, persisted under `localStorage["waitron.servers"]`
  (guarded like `dev-device.ts`); seeded with `{ url: location.origin }` so a first boot or a wiped
  store still has the box.
- **Probe loop:** every 5 s, `GET /api/node` on every listed server, 3 s timeout (`AbortController`),
  in parallel. Per server: `unknown | unreachable | standby | primary`, plus `term`. No counters.
- **Target rule (owner, 2026-09-05 — "keep trying until one server responds positively"):** after
  each round, if any server answered `acceptingSales: true`, the target is that server (the highest
  `term` if several). If none did, the target stays where it is and the till keeps probing. That is
  the whole rule: there is no giving up on a server and no failure count. A blip of the box while
  the cloud is a standby moves nothing, because nobody else said yes; the till moves exactly when
  another server says yes, which is exactly when a human has promoted it. `acceptingSales` is
  boot-captured, so one yes is a settled fact. No move while a request is in flight (its outcome is
  handled first, §4.3); the move happens on the next round.
- **Waiting:** no server accepting sales in the latest round → `waiting`. The status line shows what
  each server said; requests to the current target still go out (it may be back next round) and
  their failures surface as today (`boot.error`, `sale.error`, `sale.unconfirmed`).
- **`probeNow()`** — "check again": runs one probe round immediately.
- Emits `server-changed` and `state-changed` events; `till-app` listens.

### 4.2 Boot order

Probe the page's own origin first; if it is not accepting sales, probe the cached list; then
`getTill` (which refreshes the list) and the device probe, both against the current target. Own
origin unreachable AND an empty cache → today's `boot.error` (a first boot with the box dead has
nothing to go on; staff open the cloud address — decision (i) §3.5).

### 4.3 The move, and the request in flight

On `server-changed`: end the operator session locally (screen → `lock`, operator cleared, working
order kept in memory), banner `server.switched` ("Moved to <name>. Enter your PIN."), re-run
`#boot()` against the new target (getTill → device probe). The held-orders list on the new target
shows the replicated state — an order settled seconds before the box died is settled there or, in
the lag tail, still open.

A `recordSale`/`pay`/`placeOrder` whose `fetch` fails at the network level (TypeError/abort — never
a `{ code }`, which is a server answer) → `errorKey = "sale.unconfirmed"`: "The server did not
answer. Check whether the sale went through before trying again." Basket kept. The retry is a
human's decision: the same `#store.id` rides the retry, so a replicated sale replays idempotently
(`sales_working_order_id_key`, `payWorkingOrder`'s 23505 backstop); an unreplicated one is a second
sale — the accepted lag-tail cost (decision (i) §3.4).

### 4.4 The status line and "check again"

On the lock screen, one line from router state: "On: Box · Cloud: standby, not promoted", "Box:
unreachable · Cloud: standby, not promoted — waiting for promotion", "On: Cloud · Box: standby".
Names are the document's node labels where present, else the host. A "Check again" button calls
`probeNow()`. Also shown, compact, in the shell header while `waiting`. New i18n keys (en + es):
`server.on`, `server.unreachable`, `server.standby`, `server.primary`, `server.waiting_promotion`,
`server.check_again`, `server.switched`, `sale.unconfirmed`.

## 5. Failure modes — what the till does

| Situation | Probe results | Till |
| --- | --- | --- |
| Normal | box: primary | works; status "On: Box" |
| Box dies, cloud unpromoted | box: unreachable; cloud: standby | `waiting`; stays aimed at the box; "waiting for promotion"; keeps probing both |
| Cloud promoted | cloud: primary | moves; PIN prompt; carries on |
| Box returns (fenced) | cloud: primary; box: standby | stays on cloud; status shows box as standby |
| Box promoted back | box: primary; cloud: standby | moves back; PIN prompt |
| Internet down, box alive | box: primary; cloud: unreachable | works; status shows cloud unreachable |
| Box + internet down | both unreachable | `waiting`; stays aimed at the box; the MVP's accepted no-failover case |
| Two primaries (isolated ex-primary) | both primary | highest term; a till seeing only the old one stays |
| Box blips once, cloud a standby | box: unreachable (one round); cloud: standby | no move — nobody else said yes; next round the box is back |
| Request in flight when the box dies | — | `sale.unconfirmed`, basket kept, human decides |
| Page closed while `waiting`, no service worker | — | reopen from the box fails; staff open the cloud address (cookie covers it) |

## 6. Testing

- **Till (browser-mode vitest, stub fetch):** the router as a state machine — state the failing case
  first: a round with no yes anywhere leaves the target where it is (a blip moves nothing); a
  `standby` answer is never chosen; the first round in which another server says yes moves the
  target; highest term wins among several yeses; no move mid-request (deferred to the next round);
  `probeNow`; persistence round-trip incl. a throwing `localStorage`; the wrapper
  rewrites `/api/x` to `<target>/api/x` and leaves absolute URLs alone; `till-app` on
  `server-changed` → lock + banner + re-boot; `sale.unconfirmed` on a TypeError and NOT on a
  `{ code }`; the status line renders each row of §5.
- **Server (unit, PGlite):** `/api/node` per boot posture (primary / mirror / fenced / promoted-not-
  restarted → `false`); `/api/till.servers` shape and ordering, evicted excluded; CORS allows the
  advertised origin and a document `contactUrl` origin with credentials, denies a stranger (no
  headers), handles preflight; cookie `domain` set under `tenantDomain` and absent on
  `waitron.local`/loopback; `advertisedOrigin` parse/refusal; adopt appends the member with
  `contactUrl`; `withMember` in `packages/membership`.
- **Server (real PG, e2e):** two `startServer` boots on two databases with the same device rows
  seeded directly (replication of those rows is Track A's): A primary, B mirror → a till-shaped
  client (node `fetch` + cookie jar, driven by the router's own module) sees A primary/B standby,
  loses A (killed), sits in `waiting`; then B re-booted as primary → the router moves, login on B
  re-prompts, `listHeldOrders` on B returns the tab A had opened (venue-wide reads). Failing case
  stated per step.
- **Manual receipt (plan task 1):** the same-site cookie probe of §3.4, two hosts under one parent.
- Guards: `errors-reachable` (new codes, if any, import the registry); coverage bars; the
  `english-only` guard is out of scope for `apps/*` (Spanish identifiers caught by review).

## 7. Slices (each a PR; order matters)

1. **S1 — server truth:** `advertisedOrigin`, `contactUrl` at provision, adopt appends the member,
   `withMember`, `GET /api/node`, `servers` on `GET /api/till`.
2. **S2 — cross-origin plumbing:** CORS, `tenantDomain` cookie scope, the manual same-site probe
   receipt in the plan.
3. **S3 — venue-wide reads** + CLAUDE.md §5 rewrite (+ the retired mirror-test premise).
4. **S4 — till router:** `ServerRouter`, wrapper, persistence, boot order, probe loop.
5. **S5 — till behaviour:** the move + PIN re-prompt, `sale.unconfirmed`, status line + "check
   again", i18n.
6. **S6 — two-process e2e** (§6) and the backlog/design pointers.

## 8. Interactions

- **Track A:** `node_membership`, `devices`, `tills`, `device_profiles`, `canvases` must be in the
  `state` publication (swap §2.1 names the first three; the plan checks `canvases`); the outbox
  deletion (S5 there) removes the two cleanups this item once carried. Adopt is rewritten by the
  swap's S2; §3.3's append rides whichever adopt exists when S1 lands — a textual rebase.
- **Track B item 2** proves this on real machines; **item 3** (promotion endpoint, S4 of the swap)
  is what makes the "cloud promoted" row of §5 reachable without a manual restart-into-primary.
- **Track 1 area 19** (registers/devices UX) is independent; the status line touches the lock screen
  only.
- **Decision (ii):** the promoted cloud serves tills on its public name; no relay in this build.

## 9. Open items (not this build's)

One name or two for the box on the LAN vs remotely (relay decision §4) — this build takes whatever
`advertisedOrigin` says. Register/device wording on the lock screen follows Track 1's area 19.
