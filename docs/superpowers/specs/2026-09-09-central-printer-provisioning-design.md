# Central printer provisioning redesign — design (Track H, item 3)

**Date:** 2026-09-09. **Status:** design, approved section-by-section with the owner; plan follows.

**Track H** (hardware). Builds directly on the print-agent process
([2026-09-08-print-agent-process-design.md](2026-09-08-print-agent-process-design.md), LANDED #289)
and the printing subsystem ([2026-08-17-printing-subsystem-design.md](2026-08-17-printing-subsystem-design.md)).
It **subsumes and supersedes** the old "un-pin IP printers" follow-on
([2026-08-26-failover-printing-design.md](2026-08-26-failover-printing-design.md) §4a): where §4a
un-pinned only `network_tcp`, this removes the stored printer→agent binding for **every** transport and
adds discovery for all three local transports.

## 1. What this delivers

Today a printer stores the one agent that serves it (`printers.agent_id`), and that column is both the
routing key and the authorisation scope: the job-pull claims only `p.agent_id = ${agentId}`
(`packages/printing/src/runtime.ts:144-160`), and the report allows only the same
(`runtime.ts:214-239`). A USB or IP printer is therefore bound to one box; if that box dies, its
printers are stranded even though another box on the LAN could reach the IP printer, and a USB printer
that moves to another box must be re-created. Adding a printer is a manual form: the operator types the
transport, the device path or host, and picks the serving agent by name from a dropdown
(`apps/dashboard/src/screens/printers-screen.ts`).

This redesign makes registration **central** (the dashboard) and eligibility **derived from live
capability** (which box can currently reach the printer), and it makes all three local transports —
USB, network (IP), Bluetooth — **discoverable** so the operator picks from a list instead of typing
device paths.

## 2. Owner decisions (2026-09-09, this brainstorm)

- **(a) The serving agent is derived, never stored.** `printers.agent_id` is removed. A box is eligible
  to print a job when it can currently reach the printer: for `network_tcp`, any box in the venue; for
  `usb`/`bluetooth`, the box currently reporting that device's fixed local ID. Unplug a USB printer and
  plug it into another box — it just works, no re-registration. One rule for every transport.
- **(b) USB and Bluetooth printers are discovery-driven, keyed on a stable local ID.** The agent
  discovers attached/paired printers and reports them; the operator registers a chosen SUBSET centrally
  with a name (discovery ≠ exposure). The key is the USB **serial** or the Bluetooth **MAC** — stable
  across reboot/replug — never a raw device path.
- **(c) IP printers are discoverable too** (mDNS, port-9100 sweep fallback), which pre-fills — does not
  replace — manual address entry. For v1 an IP printer is addressed by **host:port** (recommend a DHCP
  reservation); MAC-keyed IP resolution is a noted follow-up (§13).
- **(d) Bluetooth is in scope now** as a third live transport, with a **box-local pairing** step.
- **(e) Active discovery is on-demand, opened from the dashboard** (a venue-wide window), never
  always-on. Cheap presence-of-registered-devices stays always-on because serving needs it.
- **(f) No printer drivers.** Raw ESC/POS only; page printers (e.g. the HP LaserJet) are out of scope
  and served by the virtual-PDF path (Track H item 2).
- **(g) The discovered inventory and the discovery window are in-memory on the server** — no new
  tables. Pre-production drop-and-recreate migration for the schema change, no backfill (CLAUDE.md §3).

## 3. The model — eligibility is derived from live capability

The serving agent is no longer a stored fact. A box (agent A, at venue location L, currently reporting
a set of visible local keys VK) is eligible to claim a job for printer P when:

```
P.active AND P.tenant = cfg.tenant AND (
     (P.transport = 'network_tcp' AND P.location_id = A.location_id)   -- any box in the venue
  OR (P.transport IN ('usb','bluetooth') AND P.local_key = ANY(VK))    -- the box that currently sees it
)
```

- **`network_tcp` → the venue.** Every box on the LAN can reach an IP printer, so the eligibility pool
  is the venue (all its agents). This is the failover win: no single box to die with. Deployment is
  one venue per database, so today the pool is "every agent"; the `location_id` filter is correct for a
  future multi-location tenant. (What ticket goes to *which* printer is the separate, unchanged
  station→printer routing — `station_printers`.)
- **`usb`/`bluetooth` → whoever sees it.** A USB serial or Bluetooth MAC is physically present on
  exactly one box at a time, so "the box reporting this key" is naturally exactly one box — but replug
  to another box just works, because the new box starts reporting the key.
- **`cloud_poll` is never agent-served** (the printer firmware self-polls); it is excluded here,
  unchanged from today.

Because the printer no longer names an agent, the job records **who claimed it** (`print_jobs.claimed_by`,
§4), and that is the report authorisation: you may report a job iff you are the box that holds it.

## 4. Data model

`printers` (`packages/db/src/schema/printers.ts`):

- **Remove** `agent_id` (the stored binding — `:53`, with its hand-written composite FK to
  `print_agents`) and `usb_path` (`:60`; a raw path is not stable — the defect (b) exists to fix).
- **Add** `local_key text` — the stable device ID: the USB serial for `usb`, the MAC for `bluetooth`.
  NULL for `network_tcp` and `cloud_poll`.
- **Add** `bluetooth` to the `print_transport` enum (`usb`, `network_tcp`, `bluetooth`, `cloud_poll`).
  An additive enum value, like `cloud_poll` before it.
- **Rewrite** the transport-required-field CHECK (`printers_transport_fields_ck`, hand-written in the
  `--custom` migration) and `REQUIRED_FIELDS` (`packages/printing/src/printers.ts:88-92`):
  `network_tcp` needs `host`; `usb`/`bluetooth` need `local_key`; `cloud_poll` needs `poll_id`. No
  transport requires `agent_id` any more.
- A **partial UNIQUE** on `(tenant_id, location_id, local_key)` where `local_key IS NOT NULL` — one
  registered printer per physical USB/BT device per venue; a second register of the same serial is a
  friendly conflict, not a duplicate.

`print_jobs` (`packages/db/src/schema/print-jobs.ts`):

- **Add** `claimed_by uuid` — the agent currently holding the job. Set on claim; cleared/overwritten
  when the lease reclaims it (`claimed_at` already exists, `:74`). The tenant-consistent
  `(tenant_id, claimed_by) → print_agents(tenant_id, id)` composite FK is hand-written in the migration,
  NULLABLE (MATCH SIMPLE skips the check on NULL), exactly like the other bare-uuid FKs here.

Both tables are core-set already; the column changes are a regenerated core migration + its `--custom`
grants/CHECK twin, per CLAUDE.md §3's recipe. `classification.ts` is unchanged (no table added/removed).

**No new tables.** The discovered-but-unregistered inventory and the discovery-window flag are
in-memory on the server (§6) — transient venue state that a couple of seconds of agent polling rebuilds,
with no value in history (owner, 2026-09-09).

## 5. Claim and report

**Claim** (`claimPrintJobs`, `runtime.ts:139-182`). The `join printers p … and p.agent_id = ${agentId}`
scope (`:144-160`) becomes the derived eligibility of §3. The claim takes the agent's venue location and
its **currently visible keys** as parameters; the existing `for update of j skip locked` row lock
(`:104` today) still hands each job to exactly one grabber. The second statement stamps
`status='printing', claimed_at=now(), claimed_by=${agentId}` (the claim already RETURNs the printer's
connection facts for the wire job — §8).

The two-distinct-boxes-racing-for-one-IP-printer path is **reachable for the first time** (today the
`agent_id` filter means two agents never select overlapping jobs, so the existing race test exercises
two instances of the *same* agent — `runtime.race.test.ts`). It gets a **new distinct-agents race test,
proven by deleting the lock** — each job delivered once — beside the existing one. At-least-once is the
accepted MVP behaviour (rare duplicate over dropped ticket); a per-claim token hardens it later (§13).

**Report** (`reportPrintJob`, `runtime.ts:214-239`). The `p.agent_id = ${agentId}` scope (`:228-237`)
becomes `print_jobs.claimed_by = ${agentId}` (with the unchanged `status='printing'` idempotency guard).
The box that holds the lease reports it; a stale or cross-agent report is a no-op returning
`{updated:false}`, as today. This is deliberately independent of live capability at report time — a USB
printer unplugged in the second between print and report must not fail its own report.

## 6. Discovery — windowed active scan, always-on presence

Two different needs, deliberately split:

- **Presence of a registered printer (always-on, cheap).** Serving needs to know, at claim time, which
  registered USB/BT keys a box can currently reach. Reading attached USB serials is a local sysfs read;
  a paired Bluetooth printer connects on demand; an IP printer is a TCP connect. USB attach/detach is a
  local kernel event, cheap enough to report every poll. So each poll the agent reports its current
  visible keys (§8), and the server uses them both for eligibility (§5) and to populate the discovered
  list. **No network or radio scan is involved in serving.**
- **Discovery of new devices (windowed, expensive).** Finding *unregistered* devices means the
  expensive/noisy operations — LAN-wide mDNS/announce queries and a port-9100 sweep for IP; a Bluetooth
  inquiry scan — which must not run continuously (LAN noise that reads as snooping; Bluetooth airtime
  and power). These run **only while a discovery window is open**.

**The discovery window.** The operator clicks "Scan for printers" in the dashboard, which opens a
short venue-wide window (a `discoveryUntil` timestamp held in server memory, like the pairing window's
shape). Agents learn the window is open from their next poll reply and run their active scans while
`now < discoveryUntil`, reporting what they find. The window auto-expires. This reuses the existing
dashboard-opened, venue-wide, time-boxed window pattern
([2026-09-08-device-join-and-accept-design.md](2026-09-08-device-join-and-accept-design.md) §7).

**In-memory stores (server, per venue):**

- `discoveredDevices` — keyed `(agentId, transport, localKey)`, value `{ make, model, name, lastSeenAt }`,
  upserted from each agent's report, entries expiring after a few missed reports. The dashboard reads a
  merged view (§10), marking any whose `local_key` matches a registered printer as already-registered.
  _(2026-09-11: a `network_tcp` result matches on host:port as well — it has no local key — and each
  entry carries the matched `printerId` plus `lastSeenAt`; the dashboard hides matched results and shows
  "seen on … at …" against the registered printer instead.)_
- `discoveryWindow` — the venue's `discoveryUntil`, set by the start route (§9), read into each poll
  reply. Both are transient; a server restart empties them and the next polls refill them (owner's
  in-memory decision).

Because these live on the acting primary and agents follow the primary, discovery works while the venue
is healthy (its normal setup condition). A promoted cloud has no local USB/BT bus and serves no local
printer anyway — nothing to reconcile.

## 7. The `Host` seam — where hardware lives

The agent core stays db-free and hardware-free; everything touching real hardware sits behind the
`Host` seam (`packages/print-agent/src/host.ts`), so the same code later ships on a till with a second
host. The seam gains transport-aware jobs (no-ops where a transport doesn't apply):

```ts
interface Host {
  // …existing config/token/fetch/now/sleep/log/status…
  scan(kinds: TransportKind[]): Promise<DiscoveredDevice[]>;   // active discovery, window-gated by the caller
  visibleKeys(): Promise<VisibleKey[]>;                        // cheap presence: attached USB serials, paired BT MACs
  resolve(target: PrinterTarget): Promise<ResolvedSink>;       // local_key → device node / BT channel / host:port, at print time
  pair(mac: string): Promise<PairResult>;                      // Bluetooth only; box-local; no-op elsewhere
  transport: Transport;                                        // send bytes to a ResolvedSink
}
```

- **`resolve`** is the serial→`/dev/usb/lpN` (and MAC→paired channel) mapping decision (b) requires — the
  stable key stored centrally, the unstable path found live at print time.
- **`pair`** is Bluetooth's box-local step (d), surfaced on the agent's existing LAN setup page (port
  9110): a **Bluetooth** section with **Scan → Pair**. Once paired, the printer appears in the box's
  `visibleKeys` and thus in the dashboard's discovered list for central registration. IP/USB pairing is
  a no-op.

**Feasibility flags — all behind this seam, all proven on real hardware (owner's USB/BT printer arrives
2026-09-10), none of them design risks:**

- The #289 container is handed one device (`--device /dev/usb/lp0`). Enumerating *all* USB printers and
  their serials needs broader USB access (`/dev/bus/usb` + sysfs). A packaging change, not a design one.
- Network scanning (mDNS/sweep) needs the container to share the host LAN (host networking); Docker's
  default bridge does not pass LAN multicast through (and, 2026-09-11, the sweep enumerates the
  container's own interfaces, so under a bridge it sees only Docker's /16). Packaging.
- Containerised Bluetooth (BlueZ over DBus) is the least certain — likely a DBus socket mount plus host
  access. If it cannot be given cleanly, that is a packaging fix; the seam and the model are unchanged.
- **Real unknown for the arriving printer:** does the USB printer enumerate as a standard printer-class
  device (a `/dev/usb/lpN` node appears — the easy path via the kernel's generic USB-printer support) or
  as a vendor-specific device (needs a userspace USB library and its endpoints)? `resolve`/`transport`
  hide which; it is the first thing to check when the hardware lands.

*External-behaviour claims to verify, not assert (CLAUDE.md §1):* that most network ESC/POS printers
announce over mDNS `_pdl-datastream._tcp`; that a printer-class USB device binds `usblp` → `/dev/usb/lpN`;
the exact container capabilities each scan needs. Confirmed on hardware before the spec's testing rows
are ticked.

### Hardware receipt (2026-09-10, `clinton@waitron.local`)

Verified on the real box with the arriving ESC/POS printer:

- **USB is the easy path — printer-class, not vendor-specific.** The printer binds `usblp` and appears
  as `/dev/usb/lp0` (`crw-rw---- root:lp`). Identity comes from the USB device dir reached three parents
  up from `/sys/class/usbmisc/lp0`: `serial=B120300001` (→ `localKey`), `manufacturer=YICHIP3121`
  (→ make), `product="USB Portable Printer"` (→ model). `ieee1284_id` is empty, so identity is those
  three attrs — no IEEE-1284 parsing. `readUsbPrinters`' walk was re-run against the real `/sys` from
  inside the container and returned exactly these values.
- **Container access confirmed as the unprivileged `node` user:** `--device /dev/usb/lp0` plus
  `group_add` gid 7 (`lp`, which owns the node's write bit) — the node user's `groups` include `7(lp)`
  and it wrote ESC/POS to the device. `--network host` for mDNS. The BlueZ DBus-socket mount ships but
  was not exercised (no adapter, below).
- **End-to-end USB print CONFIRMED:** the node user wrote ESC/POS (init + centred/left formatting) to
  `/dev/usb/lp0` and a physical slip printed. Operator note: thermal paper is one-sided — it must be
  loaded coated-side to the print head, or the paper feeds blank.
- **Deferred, honestly:** the live Bluetooth path (the box has no adapter — no `hci`, nothing under
  `/sys/class/bluetooth`) and live mDNS discovery (no network printer on the LAN). Both seams and their
  parsers ship and are fixture-tested; the live radios/sockets are gated for a later receipt.
  - _2026-09-11 (`feat/print-agent-9100-sweep`):_ the owner's Epson TM-T88III at 192.168.20.247
    answered the ESC/POS `GS I 66`/`GS I 67` identity queries on TCP 9100 and appeared under no mDNS
    service type (`dns-sd -B _services._dns-sd._udp` from a Mac that listed the HP on the same subnet),
    so the §2c port-9100 sweep was built; a sweep of 192.168.20.0/24 from that Mac with the real connect
    seam returned exactly the HP and the Epson. The sweep has not yet run on the box, which sits on
    another VLAN: it routes to both printers (ping and TCP 9100 from the box, 2026-09-11), so a print
    by address reaches them, but the sweep covers only the box's own subnets and would list neither.

## 8. The agent loop and wire protocol

The loop (`agent.ts`, §4 of the #289 design) gains: **on each poll, report `visibleKeys()`**; **while a
discovery window is open, run `scan()` and report the results.** The pull request therefore carries the
box's current inventory `{ visibleKeys, scanResults? }`; the server updates its in-memory stores and
scopes the claim in one round trip (a benign staleness — a job for a key a box no longer sees simply
isn't claimed by it, and the lease reclaims it). The pull reply gains `discoveryUntil` alongside the
existing `servers`/`nodeId` (`client.ts`).

The wire job (`WireJob`, `client.ts:49-57`) drops `usbPath` and gains `localKey`; it keeps
`transport`, `host`, `port`. For `usb`/`bluetooth` the box `resolve`s `localKey` to a sink; for
`network_tcp` it uses `host:port` as today. No secret is added to the page or the wire.

## 9. Server routes (`apps/server/src/print-api.ts`)

Changed:

| Route | Change |
| --- | --- |
| `POST /management-api/printers` | body drops `agentId`/`usbPath`, gains optional `localKey`; `network_tcp` needs `host`, `usb`/`bluetooth` need `localKey`. `locationId` still injected from `cfg`, never the client. |
| `PATCH /management-api/printers/:id` | drops `agentId`/`usbPath`, gains `localKey`; the rest (name, host, port, ticketScope, active) unchanged. |
| `POST /print-api/agent/jobs` | pull is a POST (it carries the agent's inventory in the request body); claim scoped by §3; reply gains `discoveryUntil`. |
| `POST /print-api/agent/jobs/:id/result` | report authorised by `claimed_by` (§5). |

New:

| Route | Auth | Does |
| --- | --- | --- |
| `POST /management-api/printer-discovery/start` | `printer.manage` | opens the venue discovery window (sets `discoveryUntil` in memory); returns the window end. |
| `GET /management-api/discovered-printers` | `printer.manage` | the merged in-memory discovered list — `{ agentId, agentName, transport, localKey, make, model, alreadyRegistered }` — unregistered devices first. |

The pairing/setup-page Bluetooth **Scan/Pair** lives in `apps/print-agent` (the box), not here — it acts
on local hardware and is outside the outbound-only server link.

## 10. Dashboard create flow (`apps/dashboard/src/screens/printers-screen.ts`)

The single form with the **agent dropdown is replaced** (the dropdown is gone for every transport):

- **Add IP printer** — name + address + port; a **Discover** button opens the window and offers found
  IP printers to pre-fill the address. No agent picker.
- **Add USB / Bluetooth printer** — a **"discovered printers"** list (from
  `GET /management-api/discovered-printers`): each row shows make/model, which box sees it, and its
  stable ID, with a **Register** action that asks only for a name. Already-registered devices are
  marked.
- **Bluetooth, first time** — a one-line pointer to the box's setup page to **pair** the printer, after
  which it appears in the discovered list.

Per-row display drops the agent column (there is no serving agent to show); it may show "last seen on
box X" derived from the inventory instead. Station→printer routing on this screen is untouched.

## 11. Security

- The authorisation boundary **moves**: from "your own printer" (agent identity) to "your venue" (IP)
  and "what you can currently see" (USB/BT), with report gated by `claimed_by`. This is a real change to
  the security boundary and gets the mandated **`security-review`** pass before merge
  ([printing subsystem design §7](2026-08-17-printing-subsystem-design.md)).
- A stranger agent cannot claim a venue's IP jobs without a valid, accepted token (unchanged auth) *and*
  membership of that venue's location; it cannot claim a USB/BT job without physically holding the
  device (reporting its key). Reporting is gated by `claimed_by`, so a token cannot report on a job it
  never held.
- The discovered list and the discovery window are readable only with a `printer.manage` session. The
  agent setup page stays LAN, unauthenticated, secret-free (as #289); Bluetooth **Pair** acts only on
  the box's own radio.
- The partial UNIQUE on `local_key` stops two registrations of one physical device racing to two rows.

## 12. Testing

- **`@waitron/print-agent` (hermetic):** `scan`/`visibleKeys`/`resolve`/`pair` against a fake `Host`;
  the loop reports inventory each poll and scans only within a window (proven by deletion of the window
  check); the wire job carries `localKey`, not a path. Existing transport suites (loopback TCP, temp
  file) unchanged; a Bluetooth-sink fake added.
- **Server routes (`print-api.test.ts` PGlite, `print-api.pg.test.ts` real PG for grants + `app_user`
  shape):** the create/patch bodies (localKey required per transport, agentId/usbPath gone), the
  eligibility claim (IP by venue, USB/BT by reported keys — proven by deletion), `claimed_by`
  set-on-claim and cleared-by-lease, report allowed only for the claimer, the discovery-window start +
  `discoveredPrinters` list, `discoveryUntil` on the pull.
- **The distinct-agents race (real PG):** two different agents, one shared IP printer, many jobs — each
  delivered exactly once; proven by deleting the row lock and watching a double-print. This is the §5
  behaviour that today's code has never run.
- **End to end (`apps/server`):** the real `mountPrintApi` on PGlite, an agent `runOnce` with `fetch`
  routed to the Hono app and a loopback TCP listener as the printer — register (IP), enqueue, pull,
  bytes land, job `done`; then the same for a USB printer via a fake device sink.
- **Real-hardware receipts (2026-09-10, recorded here when taken):** one USB print and one Bluetooth
  print end to end on the arriving printer, and the existing HP LaserJet at `192.168.20.56:9100` for
  the TCP path. The USB/BT receipts also settle the §7 feasibility unknowns (enumeration class, mDNS
  behaviour, container access).
- **Security review** (§11) before merge.
- **Root guards after the schema change:** `classification-complete`, `append-only-enable-always`,
  `errors-reachable`. `@waitron/print-agent` throws no codes (it reads the server's off the wire), so
  ships no `errors.ts`; new codes below live in `packages/printing/src/errors.ts`.
- Coverage: `@waitron/print-agent`, `apps/print-agent`, `packages/printing` at the 90/90/85/85 floor;
  `packages/db` keeps 98/98/98/95.

**Error codes** (add to `packages/printing/src/errors.ts`, mapped in `print-api.ts`'s STATUS map, per
the domain-concept naming rule — never the throwing package): `printer.already_registered` (a second
register of one `local_key`, 409) and `printer.invalid_config`'s reason set extended for the new
required-field rules. No code is renamed; `agent.*` unchanged.

## 13. Scope, sequencing, open questions

**In scope:** the derived-eligibility model (§3), the schema change (§4), the claim/report rewrite (§5),
windowed discovery + always-on presence (§6), the `Host` seam with USB + Bluetooth + IP scanning (§7),
the loop/wire changes (§8), the new/changed routes (§9), the dashboard flow (§10), the distinct-agents
race test and the security review (§11–12).

**Out of scope / follow-ups:**

- **MAC-keyed IP printers** — addressing an IP printer by MAC and resolving MAC→current-IP live (the
  USB trick, for DHCP resilience). v1 uses host:port + a DHCP-reservation recommendation (owner (c)).
- **Per-claim token** hardening the at-least-once reclaim to closer-to-exactly-once (§5) — MVP accepts
  the rare duplicate.
- **`cloud_poll`** — carried, still unbuilt; untouched here.
- **Non-Linux USB/BT hosts** (the native till agent's second `Host`) — later, with the till agent.

**Open questions:** none blocking. The §7 hardware unknowns are resolved by the 2026-09-10 receipts, not
by a design choice.

## 14. Provenance

Designed 2026-09-09 against the live tree and the landed #289 print-agent.

**Internal (file:line):** the stored binding + pull/report scope this replaces —
`packages/db/src/schema/printers.ts:53,60`, `packages/printing/src/runtime.ts:144-160,214-239`,
`runtime.race.test.ts` (same-agent race only); the agent's venue scope already present —
`packages/db/src/schema/print-agents.ts:36-39`; the lease anchor + pull index —
`packages/db/src/schema/print-jobs.ts:74,78`; the wire job + client —
`packages/print-agent/src/client.ts:49-57`; the `Host` seam —
`packages/print-agent/src/host.ts`; the create form + agent dropdown —
`apps/dashboard/src/screens/printers-screen.ts`; the routes + STATUS map —
`apps/server/src/print-api.ts`; the required-field rule + error translation —
`packages/printing/src/printers.ts:88-92`; the printer/agent error family —
`packages/printing/src/errors.ts:20-37`; the venue-wide dashboard-opened window pattern —
[2026-09-08-device-join-and-accept-design.md](2026-09-08-device-join-and-accept-design.md) §7; the
superseded un-pin follow-on — [2026-08-26-failover-printing-design.md](2026-08-26-failover-printing-design.md)
§4a, §10; the ESC/POS-is-driverless / page-printers-need-the-PDF-path boundary —
[2026-09-08-print-agent-process-design.md](2026-09-08-print-agent-process-design.md) §7.

**External (to verify on hardware, per CLAUDE.md §1 — not asserted):** network ESC/POS printers
announcing over mDNS `_pdl-datastream._tcp`; a printer-class USB device binding `usblp` →
`/dev/usb/lpN`; the container capabilities each scan/pair needs (broader USB, host networking, BlueZ
DBus). Receipts taken 2026-09-10 with the arriving USB/Bluetooth printer; the mDNS row's first
evidence (2026-09-11, §7 addendum) is negative — the Epson TM-T88III announces nothing.
