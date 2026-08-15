# Distribution, installation, and client topology

**Date:** 2026-08-15
**Status:** captured brainstorm — a design, not an implementation-ready spec. It records decisions,
leans, and open questions. Several pieces named here need their own spec before they are built (the
on-device agent's concrete technology; identity-config flow-down).
**Decides / scope:** how Waitron is *packaged, installed, and connected* on real hardware — the layer
**below** the fiscal topology. Specifically: the client's shape (browser vs native), how a till
re-routes to a live server on failover, how local hardware (printers) is driven when the server is
remote, how the server ships as an appliance, and how a non-technical operator gets it onto the
network. It is the design for the deferred **deployment sub-project (#9)** plus the client/routing
layer the failover spec left as spec-only.

**Conviction legend**, used per item because this is a captured brainstorm rather than a settled
spec: **[decided-elsewhere]** already fixed by a landed spec; **[lean]** a recommendation this doc
argues for but has not ratified; **[open]** a genuine fork left for a later decision.

---

## 1. Why this exists — two layers, only one still open

The **fiscal topology is decided** in
[`2026-08-01-local-server-sif-and-failover-design.md`](2026-08-01-local-server-sif-and-failover-design.md):
the local server (the code's `node`) is the SIF, tills are clients, a venue runs two servers
active-active each on its own hash chain, and **failover is human-driven** with each till holding a
**static, ordered, client-side failover list** `[primary → secondary → cloud]` (§8 there). This
document does **not** revisit any of that.

What that spec left open, and what the deployment sub-project deferred, is the **packaging / install /
client / routing** layer that makes the topology real on hardware. The failover list was spec-only
(no code); production static-serving, HTTPS and LAN binding were deferred to sub-project #9; and how
the software is delivered to a back-room box a non-technical owner installs was never designed. That
is this document.

**One current-state fact frames everything below** (verified, not assumed): `apps/till` is already a
**Lit PWA served same-origin by the server**, authenticated by an **httpOnly session cookie**, and it
finds its server only by *being served from it* — `baseUrl = ""`
([`apps/till/src/api/client.ts:244`](../../../apps/till/src/api/client.ts)). There is **no failover
routing and no device discovery** in the tree; peers are static config
(`WAITRON_SYNC_PEERS`, [`apps/server/src/config.ts`](../../../apps/server/src/config.ts)). So the
client we have is a browser tab pinned to one origin — exactly the thing that cannot survive its
server dying.

---

## 2. The client: a PWA on a stable local endpoint, with an optional on-device agent

**[lean] Keep the PWA as the UI; have it talk to a *stable local endpoint* rather than directly to a
server's origin.** This one choice is what keeps every later door open. Made now, it is cheap; made
later, it is a rewrite.

### Why a stable local endpoint

The failover targets are *different hosts* → *different origins*. A PWA pinned to server A's origin
cannot transparently move to B: the **httpOnly session cookie is A's** (won't send to B), and the
**cached app-shell is A's**. You cannot dodge this with a floating hostname/IP either, because that
needs the two servers to agree who holds the name — the auto-election-under-partition the failover
spec deliberately refused (§8). So the routing has to live on the *device*, and to keep the app's
origin stable across a switch, the device wants a **single local endpoint it always talks to**, with
the rerouting behind it.

### The on-device agent, and why it keeps appearing

That local endpoint is naturally provided by a small **on-device (or on-LAN) agent**. Across the
brainstorm the same component was pulled into existence by **five independent requirements** — which
is the argument that it is real rather than speculative:

1. **Transparent failover routing** (stable origin in front of a changing upstream) — §3.
2. **Driving a local printer** when the server is remote/cloud (a browser cannot open a raw socket) —
   §5.
3. **The offline queue** the till model already implies (`syncOfflineQueue`/`forward`, server-host
   design §2).
4. **Hosting a native capability** such as Tap to Pay on the phone — §9, §11.
5. **Discovery** — finding the box on the LAN without the operator typing an IP — §7.

### PWA vs native — the real trade is *per OS*

The deli-hardware design fought to keep the till **general-purpose, a free browser choice** (D1), and
put peripheral drivers on the server (D3) precisely so the till platform is not locked to Chrome or
Android. A native wrapper re-imposes a platform, and the cost scales **per OS you support**: an iPad
till means an App Store app (Apple review, a paid account); an Android till means an Android app;
an x86 till means Electron/Tauri — potentially three apps to maintain. A PWA is **one codebase for
all of them**. So "go native" is cheap only if you standardise the till OS, and expensive if you stay
mixed.

### The client's hardware needs are near-zero *by design*

This is what makes the PWA viable, and it is deliberate. Everything physical was pushed to the server
(D3) or is independent:

| Device | Needs to touch | How it reaches it | Browser-friendly? |
| --- | --- | --- | --- |
| Counter till (tablet) | at most the camera | `getUserMedia` (works incl. iOS) | ✅ |
| Handheld (phone) | camera | same | ✅ |
| Server (mini-PC, x86) | receipt printer, cash drawer, card reader, UPS, (future scales) | network TCP:9100 / cloud API / USB from a full OS | n/a — real OS |
| Card reader (SumUp Solo) | nothing of ours | own SIM + screen; the *server* pushes a checkout via SumUp's cloud | n/a — independent |

**The one thing that flips a client to native** is wanting **Bluetooth-tethered readers** or
**Tap-to-Pay on the device itself** — both are native SDKs with no iOS web API. The deli avoided it
by choosing the independent Solo; a stated future want (§9) reintroduces it on *one* device.

### PWA limitations (the ceiling is set by the worst browser you must support — iOS)

- **Hardware APIs are gated and absent on Safari/iOS.** WebUSB, Web Serial, Web Bluetooth, Web NFC
  are Chrome/Android/desktop-Edge only — the deli-hardware design already sourced this from MDN's
  `browser-compat-data` (see that spec §1 and the provenance table §13 here).
- **"Chrome on iOS" is Safari's engine.** Apple has required iOS browsers to use WebKit, so installing
  Chrome/Edge/Firefox on an iPad does **not** unlock those APIs. The EU Digital Markets Act (iOS
  17.4+) permits third-party engines and Spain is in the EU, but vendors have been slow to ship them,
  so it cannot be relied on — the deli-hardware design already flagged this exact caveat (§1 there).
- **iOS eviction / no background / no silent print.** iOS can evict a PWA's cached data after disuse
  (a risk for an offline sales queue), has no real background execution, and browser printing is a
  dialog not raw ESC/POS (moot for us — printing is server-side).
- **No kiosk lockdown from the app itself** — see next.

### Kiosk is an OS/MDM feature, and it *can* wrap a PWA

Kiosk lockdown (pin to one app, no home button, auto-launch on power) is provided by the OS, **not**
by our app — which means a **PWA can be locked into kiosk mode** without going native:

- **Android** — Lock Task Mode / COSU (the most POS-friendly; built for this).
- **iOS/iPadOS** — Guided Access (manual, one device) or Single App Mode via **MDM + Supervision**
  (fleet, heavier).
- **Windows** — Assigned Access (can pin Edge to a PWA).
- **ChromeOS** — a dedicated kiosk app mode for web apps.
- **Linux** — auto-launch Chromium `--kiosk` (what we do on the *server* appliance, where we own the
  OS).

### Phasing

- **Single-server venue** → PWA served same-origin, no agent, no failover. This is what exists today
  and it is enough.
- **Multi-server / failover / reliable iOS offline / kiosk / tap-to-pay** → the agent (or, as an
  interim, a service worker — §3), and per-device native only where a hardware capability demands it.

---

## 3. How a till re-routes to a live server

### Reframe: the till needs *a* live server, not "the primary"

Because selling is active-active, **any** live server can take the sale on its own chain. The
*primary role* (config, filing, reconcile) failover is the separate, human-driven thing (failover
spec §7–§8), and **the till does not route on it.** So the routing problem shrinks to: *find the
first reachable server in the cached list, and keep the browser's world stable while switching.*

### Four parts; only the third is hard

1. **Detect** the current server is gone — reuse the existing `GET /health` route as a probe every
   few seconds, plus treat write-through failures as signal. Fail over after **N consecutive failures
   over a few seconds** (not one — a blip must not flap), with hysteresis, plus a manual "switch
   server" control for staff (consistent with the human-arbitration philosophy).
2. **Pick** the next server from the **static ordered list, cached client-side** (you cannot fetch the
   list *from* the dead server). The servers already carry the analogue as static config
   (`WAITRON_SYNC_PEERS`); the till receives its URL list at pairing and refreshes it whenever
   connected.
3. **Keep the browser's world stable** across the switch — the crux, below.
4. **Handle the in-flight request** — below.

### The crux, and the two implementations

The stable-local-endpoint indirection (§2) is what solves part 3. Two ways to provide it, and the
**auth model is the deciding factor**:

- **[open] Route A — service worker (no native code).** The SW holds the failover list and, on a
  failed call, retries the same request against the next server's absolute URL; the shell loads from
  SW cache even when A is dead at cold start. It works — but it **forces auth to be a bearer token
  the JS/SW can read**, not today's httpOnly cookie (a security downgrade — XSS can exfiltrate it) and
  needs CORS on every server. Fragile edges: if the origin you first installed from is permanently
  gone *and* the cache was evicted (iOS), you cannot bootstrap; and it cannot touch hardware. Value:
  a **browser-only interim** that ships failover before any native work.
- **[lean] Route B — the on-device agent (the stable local endpoint).** The PWA always talks to
  `localhost:agent` (or an agent-hosted `waitron.local`); that origin **never changes**, so cookie +
  cache + session stay put across failover while the agent swaps its upstream. Cold start always
  works (the agent is local). Auth stays the strong httpOnly-cookie model between browser↔agent; the
  agent holds the servers' credentials. Cost: it is the native agent — but the *same* agent already
  doing the other four jobs (§2).

**Destination is B; A is a legitimate pre-native interim** if we accept token auth.

### The in-flight request

Thin-till write-through (failover spec §5) means the open order lives on the server and **replicates**,
so on failover the till reconnects to B and B already has the order — minus the **replication lag
tail** (perhaps missing the item added 1–2 s before A died; staff re-add it, the spec's accepted
cost). When it settles it chains on **B's** chain and series — fine, that is active-active. The one
hazard is a write A committed then died before replicating; an **idempotency key** on the settle/pay
path stops B double-applying it — the pattern the payments design already uses for the card path.

---

## 4. Identity and sessions across failover — a verified gap

**Verified against the code**, because "who is the user on server B?" is load-bearing:

- **No session table is in the sync set.** The sync lane captures **14 commercial tables**
  ([`packages/sync/src/registry.ts:39-164`](../../../packages/sync/src/registry.ts); count pinned at
  [`registry.test.ts:126`](../../../packages/sync/src/registry.test.ts)), and the **entire `identity`
  package is absent** — `sessions`, `management_sessions`, `persons`, `webauthn_credentials` all
  outside it.
- **Sessions are DB-row opaque UUIDs, not signed tokens.** The cookie value *is* a random session-row
  primary key ([`packages/identity/src/schema/sessions.ts:14`](../../../packages/identity/src/schema/sessions.ts)),
  looked up in the DB on every request
  ([`apps/server/src/till-session.ts:73-92`](../../../apps/server/src/till-session.ts)). There is no
  JWT/self-contained token for users anywhere.
- **Consequence:** after failover to B, the cookie names a row **B has never seen** → validation fails
  exactly like a missing cookie. **The cashier is logged out on failover today.**
- **Contrast — catalogue config *does* replicate** (`catalogues`, `categories`, `products`,
  `payment_policy` are among the 14; `registry.ts:104-143`). So the failover spec's "config flows
  down" is *partly* built; **identity is the gap.**

This splits into two problems, handled oppositely:

**a. Identity *config* must reach B — [open], and a real not-yet-built piece.** `persons` and their
credentials must flow down to B read-only, the same way catalogue already does, or B cannot
authenticate anyone. It fits the single-writer-global model cleanly (primary writes; receivers
read-only). This needs its own small design (§10, §11) — likely enrolling the identity config tables
in the same flow-down lane catalogue uses, excluding the ephemeral `webauthn_challenges`.

**b. The *session* should NOT replicate.** Replicating session rows fights the grain three ways:
- **Write amplification** — the management session bumps `last_seen_at` on every request.
- **It breaks single-writer** — the same session touched on A then B (failover, then A returns) is
  two writers to one row, and the table carries **no node/origin column** to attribute a writer
  ([`sessions.ts`](../../../packages/identity/src/schema/sessions.ts) is keyed to the *till*, not the
  node — sessions.ts:6-8).
- **Lag tail anyway** — a session minted seconds before A died may not have reached B, so replication
  does not even make it robust.

**[lean] Re-establish the session at the target instead, three ways (in ascending cost):**

- **(iii) Quick PIN re-prompt** — on a server switch, "re-enter your PIN." The **open order already
  survived on B**, so this is a ~2 s re-auth on a *rare* event, not a lost sale. A reasonable **v1**.
- **(i) Portable signed token** — replace the DB-row session with a stateless token (person + till +
  expiry) that *any* venue server validates via a shared key — no row, no lookup, no replication. It
  fits what we learned: the session is keyed to the **till**, and till_id is stable across failover,
  so a token carrying it is naturally node-independent. Cost: a real auth-model change and harder
  revocation. The **seamless upgrade.**
- **(ii) Agent re-mints** — the agent holds a durable device credential and silently re-authenticates
  person X to B. Invisible, but the heaviest (needs the native agent *and* a trusted device
  credential *and* identity config on B). A later refinement, not the start.

**Recommended path:** build identity-config flow-down (needed regardless) → ship **PIN-re-prompt (iii)
as v1** → upgrade to the **portable token (i)** for seamless failover.

---

## 5. Driving local hardware — the printer bridge

### The NAT reality (a receipt, not an opinion)

A cloud server **cannot** open a connection to a printer on the shop LAN: the printer has a private,
non-internet-routable IP behind the shop router's NAT (RFC 1918 / RFC 2663 — §13). The connection
must be **initiated from inside the shop, outward.** There are exactly two places that outbound
initiator can live:

### Three bridge options

| Bridge | Mechanism | Independence |
| --- | --- | --- |
| **Local relay = a device on the LAN drives the printer** (the Square model) | our on-LAN software opens TCP:9100 to the printer's private IP | needs a powered-on local device present |
| **Poll-the-cloud printer** (Star CloudPRNT / Epson Server Direct Print) | the printer firmware dials **out** to a cloud URL on a timer and pulls the job | independent of **all** local compute — needs only LAN power + internet |
| **A till running the agent** | the till's native agent holds an outbound socket to the cloud and forwards to the LAN printer | needs that tablet awake and present |

Two notes on the third row. It is the PrintNode pattern (§13) hosted on a device already in the shop,
so **no extra box** — but it requires the **native agent**, because a browser cannot open a raw
TCP:9100 socket (the web platform has no raw-socket API; the HTTP-to-printer exception — Epson
ePOS-Print / Star WebPRNT — trips mixed-content and iOS Local-Network limits, so it is not
dependable). And Square is confirmed to be the *local-relay* pattern: the Square POS **app on a local
device** opens the printer connection, the cloud never does (§13) — there is no Square shape where the
cloud reaches a printer with nothing on-site.

### The failover-printing subtlety

In the normal topology the **local server is the printer bridge**. If it dies and a cloud node takes
over, the cloud node can chain sales (active-active) and the Solo still takes cards (independent) —
but **printing depends on whether the bridge died with the server**:

- **CloudPRNT / Server-Direct-Print printer** — survives, because the printer is independent of any
  local box. The cleanest fit for cloud-failover.
- **The second active-active server, if it is also a bridge** — one dying leaves the other bridging.
- **Digital receipt during a total local outage** — the sale still chains legally; the paper slip
  becomes a screen/QR/email until a bridge returns. Consistent with "nothing *external* blocks the
  sale."

### [lean] Buy-list steer

**Default = plain ESC/POS-over-TCP printer + the local node as its bridge** (cheapest, and the node
bridges it for free). **A CloudPRNT-class printer is the robustness *upgrade*, not a requirement**,
for venues that want cloud-standalone, cloud-failover, or printing that survives a full local
blackout. A till-agent relay covers the lightweight/trial case with no extra hardware.

---

## 6. The server: on-prem appliance, or cloud-hosted

**[lean] The user-facing artifact is a prebuilt OS image, ideally pre-flashed.** A non-technical
owner should never image a drive or see a terminal. The reference shape is **Home Assistant OS**:
flash (or buy pre-flashed), plug in, configure through a web page; internally a supervisor runs the
software, but the user never touches it.

**Docker Compose vs the image are not rivals.** Compose (one file describing several containers —
Postgres + the Waitron server + the sync worker + the driver service — brought up by one command) is
a way to *organise the software inside the image*, or to deploy on cloud/technical hosts. It still
assumes someone installs an OS + Docker and runs a command, so it is **plumbing, not the product**.
`apps/server` already anticipates a supervisor and names "systemd or Docker restart policy"
(server-host design §8), so either is a small step.

**[lean] Use real Postgres in every production deployment, single-box included.** PGlite's only
advantage is that it needs no orchestration — one embedded process, no separate database. But the
appliance image already ships a supervisor (above), so that advantage evaporates: Postgres is *one
more bundled service the operator never sees* — exactly the "just another container" it should be.
What PGlite would cost in production is not worth saving:

- **The real security model only runs on Postgres.** PGlite connects as superuser and **bypasses
  FORCE ROW LEVEL SECURITY** — the configuration the server-host design says has "hidden a real defect
  in three consecutive cycles" (§12 there). A production box on PGlite runs *without the
  tenant-isolation enforcement every other deployment has.* And `apps/server` already assumes a
  **non-superuser Postgres deployment role** and takes a `pg_advisory_lock` to serialise boot
  migrations (server-host design §10–§11), so the *running* server is already Postgres-shaped; PGlite
  was only ever the hermetic **test** target and an unbuilt architecture-§4 *standalone* aspiration.
  "Use Postgres single-box" is not a change — it is what the server already does.
- **One runtime target, not two.** PGlite-single-box + Postgres-multi-node means production behaviour
  diverges from the Postgres path in exactly the dimension (RLS, concurrency) where fiscal bugs hide,
  doubling the test and support surface. Postgres everywhere collapses it to one.
- **Single → two-node becomes "add a peer," not a database migration.** App-level sync writes as
  `app_user` through `withTenant`, which PGlite-as-superuser cannot enforce, so a PGlite box would
  have to switch databases the moment it wanted a failover node. On Postgres the upgrade is
  configuration.

*Honest nuance:* PGlite in production would be *correct but serialised* (a throughput ceiling under
concurrent tills), not chain-incorrect — its serialisation is safe, just slow. The real cost is the
security-model divergence and the defect-hiding above. **PGlite keeps its genuine home:** development,
the hermetic CI suites, and — [open] — possibly a zero-install "try it on a laptop" **demo** that
issues no real fiscal records.

**So the two shapes differ by process count, not database.** A **single-box venue** runs Postgres +
the server process (+ the driver service) — Compose or systemd, small. A **two-node failover venue**
adds the sync worker and replication, where **Docker Compose clearly earns its place** inside the
image. Both are Postgres.

### Cloud-hosted is a first-class mode, not just a failover node

**[decided-by-user] The server may be cloud-hosted, and this is a first-class supported deployment
mode — it is the zero-hardware on-ramp.** A configured, resilient on-prem setup now runs **€500–1000**
in hardware (worse under the 2026 RAM surge — §deli-hardware), and asking a prospect to buy a box
before they have evaluated the product is a real adoption barrier. A cloud-hosted primary removes it.

This is not new architecture. The failover design §9 already sanctioned a **dedicated single-tenant
cloud server** as primary or standalone, and scoped the cloud-storage spec §2 ("the cloud is a sync
root, never a primary store") to permit it — because §2's version-skew objection was about the
*shared multi-tenant* store, not a dedicated box running one client's version. This promotes that
sanctioned topology to a **first-class supported mode.**

Two very different cases hide under "cloud-first"; they must not be conflated:

- **(A) Cloud for trial / evaluation — buildable now, low-risk.** A prospect explores with no
  hardware: the PWA points at a cloud origin — **the same same-origin model that ships today, so no
  agent, no routing, no local hardware, the least new code of any shape in this document** — in
  **preproduction** (test payment keys, no real fiscal certificate). Because every trial runs the same
  deployed version, trials can share a **multi-tenant demo instance** — cheap for us, free for them —
  without tripping the §2 version-skew objection (which is about a shared *production system of
  record*, not a demo). **Hard constraint:** one-database-per-environment means a preproduction trial
  DB can **never** become the customer's production DB (fiscal invariant, deployment-environment spec
  / CLAUDE.md §5) — going live is always a **fresh production provision**, never an upgrade in place.
- **(B) Cloud as a real production primary — gated.** A live venue trading with no local hardware runs
  a **dedicated single-tenant** cloud server (never the shared store). Now the failover-§9 caveats all
  bite: the **fiscal certificate lives in the cloud** as a standing posture (the cloud primary is the
  submitter), the venue **cannot sell during an internet outage** (cloud-only), and **printing needs a
  poll-the-cloud printer or a local relay** (§5 — a cloud server cannot reach a LAN printer). And one
  hard **compliance gate**: the failover spec §13 flags an **open asesor question** — where may an
  *active* cloud SIF that *issues* invoices lawfully run (RD 1619/2012 location / notification
  duties)? — and states it **must be answered before cloud-primary / standalone is offered as a normal
  posture.**

**So (A) we can build now; (B) is gated on a compliance answer, not on code.** And (A) — the on-ramp
that removes the adoption barrier — is the cheapest and simplest thing in this document.

**What "completely supported" requires us to build:** a provisioning path that stands up a cloud
instance (a shared preproduction demo tenant for trials; a dedicated single-tenant instance for
production), the PWA-points-at-a-cloud-origin path (largely the same-origin model already shipped),
and — for a production cloud venue with hardware — the printer bridge of §5.

---

## 7. Network onboarding for a non-technical operator

**[decided-by-user] WiFi-based servers must be supported**, so we cannot assume a wired drop.

- **Wired + DHCP needs no config** — plug into the switch (the deli buy list already wires the server
  through a gigabit switch), get an IP. This is why keyboard-and-screen is only *forced* by WiFi.
- **AP-mode setup wizard** (the smart-plug/IoT pattern, phone-only, no keyboard/monitor): on first
  boot with no WiFi, the box **raises its own hotspot** (`Waitron-Setup`); the installer joins it from
  a phone; a setup page **lists nearby networks**; they pick the shop's and enter the password; the
  box saves it, **drops the hotspot, joins the real WiFi.**
- **USB-stick config** (the escape hatch): a small file on a stick with the WiFi SSID + password; the
  box reads it on first boot. Near-zero to build, but the user hand-edits a file — good for a
  technical/bulk install, worse for a lone owner.

### The end-to-end non-technical install (appliance style)

1. **Unbox and power on** — ideally pre-flashed, so no imaging step.
2. **Box raises its setup hotspot** — a sticker shows the name + a QR code.
3. **Phone onboarding** — scan the QR → pick shop WiFi + password, name the venue, create the first
   admin login.
4. **Box joins WiFi and self-provisions** — runs the provisioning steps automatically
   (`instance` + `venue`, [`packages/provisioning/src/cli.ts`](../../../packages/provisioning/src/cli.ts)),
   stamps the environment, comes up serving the till app.
5. **Pair the tills** — the setup page shows a QR / a `waitron.local` address; each tablet opens it and
   "Add to Home Screen"; log in.
6. **Peripherals** — printers get an IP from the network and are discovered or typed in; Solo readers
   are linked by ID after a one-time SumUp onboarding.

### What this forces us to build (all currently absent)

- **AP-mode setup firmware** (hotspot + captive page + the setup web app).
- **A discoverable name** so tills/admin find the box without an IP — mDNS / `waitron.local` (works
  well from Android/desktop; **[open] verify iOS `.local` reliability**, which a native agent
  sidesteps by discovering the box itself).
- **Glue to run the provisioning CLIs from the setup page**, not only by hand at a terminal.

### Configuring WiFi for the *other* devices

- **Tills (tablets/phones)** — trivial; the owner joins the shop WiFi in Settings like any device.
- **Printers** — the awkward, screenless case. **Wired Ethernet avoids it entirely** (deli buy-list
  choice) and is more reliable for the thing that prints every receipt; WiFi printers use their
  **vendor's** setup app / WPS / configure-over-cable-once. **We cannot push WiFi credentials into a
  screenless printer** — Waitron discovers a printer once it is on the network; it does not onboard
  it. **[lean] Prefer wired printers even when the server is on WiFi.**

### WiFi caveats

The server is the SIF every till depends on, so **WiFi is a weaker foundation for it** than the wired
switch — recommend wired-for-the-server where a cable is possible. And a fanless mini-PC needs a WiFi
adapter (a buy-list note; not all have one).

---

## 8. Can the till hardware be the server?

- **Tablets: no.** A tablet is a poor server (Postgres, always-on/no-sleep, driver hosting, a UPS),
  and D1 requires the till to stay general-purpose, not a locked appliance.
- **An x86 touchscreen terminal: yes**, as the **single-position degenerate case** the architecture
  design already allows ("on the same box for a single-till venue", §5).
- **The failure-domain catch:** the two-server design exists so a dead box does not stop trade. If
  till = server, a till failure **is** a server failure. **[lean] Above one position, keep the SIF box
  separate from any till.**

---

## 9. Installing the client on a phone or laptop, and the tap-to-pay want

- **PWA** — open the box's address (`waitron.local` / scan a QR) → **"Add to Home Screen" / "Install."**
  One tap and near-native on Android/Chrome and desktop; more hidden on iOS Safari (Share → Add to
  Home Screen). **No app store, no download, self-updating.** Zero distribution friction — the PWA's
  biggest win.
- **Native / agent** — distribute an installer: APK (sideload or Play Store), `.dmg`/`.exe`/AppImage,
  or an **App Store app on iOS** (Apple review + account); a fleet uses MDM. More friction, signing,
  update channels.

**[open] Tap-to-Pay on the owner's phone is a stated want, and it forces native — on that one
device.** Tap to Pay on iPhone / Android needs a **native app** (Apple ProximityReader / an NFC SDK);
there is **no iOS web API**, and Web NFC cannot do EMV payment. *(General knowledge, not independently
sourced in this doc — verify: Tap to Pay on iPhone availability in Spain; whether **SumUp** exposes an
embeddable tap-to-pay SDK, or whether this rides the **Stripe** Terminal seam the repo already has in
`packages/payments-stripe`.)* Crucially it is **per-device**: the tap-to-pay phone runs the native
app while counter tills stay PWAs — exactly what the "PWA on a stable local endpoint, wrapped natively
where needed" shape (§2) buys.

---

## 10. Depends on / interacts with / supersedes

- **Builds on** the failover topology
  ([`2026-08-01-...-failover-design.md`](2026-08-01-local-server-sif-and-failover-design.md)); does not
  revisit it. It **realises** that spec's §8 "static client-side failover list" as concrete routing
  (§3 here).
- **Promotes** failover-design §9's cloud topology — a **dedicated single-tenant** cloud server may be
  primary or standalone — from an option to a **first-class supported deployment mode** (§6), and
  re-affirms the deployment-environment invariant that a preproduction trial DB is never promoted to
  production.
- **Realises** the deferred deployment sub-project (#9): production static-serving, HTTPS, LAN binding,
  and now the appliance image and onboarding.
- **Extends** the deli-hardware design ([`2026-07-30-deli-hardware-design.md`](2026-07-30-deli-hardware-design.md))
  with the cloud/NAT printer case and a CloudPRNT buy-list option, and adds a WiFi-adapter note.
- **Surfaces a new dependency not yet designed or built: identity-config flow-down** (§4a) — its own
  spec.
- **Revises** architecture-design §4's "standalone = PGlite": once the deployment is an appliance with
  a supervisor, Postgres is one bundled service and the only runtime that runs the real security
  model, so production uses Postgres everywhere and PGlite is demoted to dev/test/demo (§6). Add a
  dated pointer to the architecture design at land time (CLAUDE.md §6 keeps historical docs as
  written).
- **Interacts with** the sync design (`2026-08-02-app-level-sync-design.md`): identity config would
  ride the same flow-down lane catalogue uses; sessions deliberately stay out of it.
- **Tap-to-pay** rides the Stripe seam (`packages/payments-stripe`), per-device native.

---

## 11. Open questions

- **[blocker for production cloud-primary] The active-cloud-SIF regulatory question** (§6B) — where may
  a cloud server that *issues* invoices lawfully run (RD 1619/2012 location / notification duties)? The
  failover spec §13 says this must be answered before cloud-primary / standalone is offered as a normal
  posture. Cloud **trial** (preproduction, §6A) is **not** gated by it; cloud **production-primary**
  (§6B) is. Asesor question.
- **Session-at-target choice** (§4b) — PIN-re-prompt v1, then portable token? Ratify the sequence and
  the token's shape (claims, shared-key custody, revocation).
- **Identity-config flow-down** (§4a) — its own design: which identity tables replicate read-only,
  keyed how, excluding `webauthn_challenges`.
- **The agent's concrete technology** (§2) — Tauri? a small local service + system browser? per-OS
  shape? Undecided; deserves a spike, not a guess.
- **Service-worker interim vs agent-first** (§3) — do we ship Route A before the agent exists, at the
  cost of token auth, or wait for B?
- **CloudPRNT integration** (§5) — do we implement a CloudPRNT/Server-Direct-Print server endpoint,
  and against which printer models? (Verify current model list and Spain availability.)
- **Tap-to-pay** (§9) — Spain availability for Tap to Pay on iPhone; SumUp SDK vs Stripe.
- **mDNS / `.local` reliability on iOS** (§7).
- **Which OS(es) for tills** — drives both kiosk cost and native cost (§2).

---

## 12. Out of scope

- The fiscal topology and failover *policy* (owned by the 2026-08-01 spec).
- The identity-config flow-down design (its own spec — named in §4a/§11).
- The on-device agent's implementation (its own spec/spike — §11).
- The sync **fiscal** lane (H2, owner-reviewed separately).

---

## 13. Provenance — external claims (receipts)

Every external claim this design leans on, with a source. Where the source's wording is load-bearing
it is quoted.

| Claim | Source | Key words |
| --- | --- | --- |
| WebUSB / Web Serial / Web Bluetooth / Web NFC absent on Safari & iOS | MDN `browser-compat-data`, via [`2026-07-30-deli-hardware-design.md`](2026-07-30-deli-hardware-design.md) §1 | `api/USB.json`, `api/Serial.json` record `safari: version_added: false`, `safari_ios: "mirror"` |
| iOS browsers use WebKit; DMA may change this in the EU but is not yet reliable | deli-hardware design §1 (its own caveat) | "a claim about Safari specifically… would need separate evidence about alternative engines under the EU DMA" |
| A cloud server cannot initiate a TCP connection to a device behind consumer NAT | IETF **RFC 2663** (NAT terminology); **RFC 1918** (private ranges) | "sessions are uni-directional, outbound from the private network"; N-Pri "may not be routable from N-Ext" |
| Square printing is driven by a **local** device, not Square's cloud | Square help article 6050 (connect a printer) | "USB printers… Only that specific POS device can print to the connected USB printer"; iOS Local-Network permission required |
| Square supports generic Epson/Star network printers | Square printer compatibility page | Epson & Star Ethernet/Wi-Fi/USB/Bluetooth models listed |
| Star **CloudPRNT**: the printer polls a cloud URL outbound; no port-forwarding | Star CloudPRNT Developer Guide (IFBD-HI01X); Protocol Guide | "does not requires specific firewall, port forwarding or tunneling"; POST-poll → GET-job → DELETE-complete |
| Epson **Server Direct Print**: printer pulls jobs from a web server (the NAT-friendly one) | Epson "Server Direct Print User's Manual" M00062910 Rev.K | "the printer sends an Inquiry of print request to the Web application, and the Web application returns a response that has print data included in it" |
| Epson **ePOS-Print** is a LAN-only push to the printer's IP (**not** cloud-capable) | Epson "ePOS-Print XML User's Manual" M00048210 Rev.K | endpoint is `http://[printer IP]/cgi-bin/epos/service.cgi`; "No computers or servers are required for printing" |
| Local print-relay pattern (a small LAN app dials out) | PrintNode docs | "install the PrintNode Client on any computer which has access to both the printer and the internet"; "outbound connections on ports 443 and 6123" |
| Tap to Pay on iPhone/Android needs a native app (no web API) | **general knowledge — not independently sourced here; §11 lists it to verify** | — |

**Caveats preserved from research** (not smoothed over): Square's "the device must be powered on"
sentence is from third-party integrator help centres, not a Square-authored line — the *local-device*
model itself is Square-primary (article 6050). "Printer host device" is **our** phrasing, not current
Square vocabulary (Square says "printer profile" / "printer station"). Epson's concrete poll interval
is *configurable*; any specific default (e.g. 60 s) is an example, not a spec. The full current
CloudPRNT model list and mPOP support are from Star marketing/reseller pages, not the developer guide.

---

## 14. Code-state receipts (internal)

The current-state facts this design rests on, cited so a later reader can re-check them rather than
trust the prose:

- **Till is a same-origin PWA** — `baseUrl = ""`, cookie sent `credentials: "include"`:
  [`apps/till/src/api/client.ts:244`](../../../apps/till/src/api/client.ts), client.ts:418-428.
- **No failover routing / no discovery; peers are static config** —
  [`apps/server/src/config.ts`](../../../apps/server/src/config.ts) (`WAITRON_SYNC_PEERS`).
- **Sync captures 14 commercial tables; identity is absent** —
  [`packages/sync/src/registry.ts:39-164`](../../../packages/sync/src/registry.ts); count pinned at
  [`registry.test.ts:126`](../../../packages/sync/src/registry.test.ts).
- **Catalogue config is in the sync set** — `registry.ts:104-143`.
- **Sessions are DB-row opaque UUIDs, validated by lookup each request** —
  [`packages/identity/src/schema/sessions.ts:14`](../../../packages/identity/src/schema/sessions.ts);
  [`apps/server/src/till-session.ts:73-92`](../../../apps/server/src/till-session.ts). No JWT for
  users; the only bearer token is the node-to-node sync token.
- **Session keyed to the till, not the node; no origin column** — `sessions.ts:6-8`.
- **`nodes` has no `role` column yet** (primary/secondary deferred) —
  [`packages/db/src/schema/nodes.ts:6-7`](../../../packages/db/src/schema/nodes.ts).
- **`apps/server` production assumes a non-superuser Postgres deployment role** (`DATABASE_URL`, FORCE
  RLS, an advisory-lock boot migration) — server-host design §10–§11. PGlite (`createPgliteDb`) is the
  hermetic **test** target; "standalone = PGlite" (architecture design §4) was an aspiration for the
  embedded case, revised by §6 above.
- **`apps/server` expects a supervisor (systemd / Docker restart policy)** — server-host design §8.
- **Provisioning CLIs `instance` / `venue` exist** —
  [`packages/provisioning/src/cli.ts`](../../../packages/provisioning/src/cli.ts).
