# Till reroute — the route decision (Track B, decision (i))

**Date:** 2026-09-05. **Status:** owner decision, recorded (docs-only). The build is Track B item 1
(`docs/backlog.md` → *Whole-project design review → Track B*), which gets its own spec and plan.
**Supersedes** the "Route A vs Route B" fork in
[distribution §3](2026-08-15-distribution-and-client-topology-design.md) and resolves the
"go-native decision" that [failover-printing §4c](2026-08-26-failover-printing-design.md) parked the
till print agent behind.

## 1. The decision, in three parts

1. **Rerouting lives in the till web app, for every device kind** (till, handheld, KDS). The app
   holds the venue's ordered server list, detects a dead server, and swaps the base URL its requests go
   to. Not a service worker, not a native agent. Reason: handhelds are phones; routing inside an agent
   would need a native app on every phone OS, or make phones depend on the POS device's agent being
   up. The seam already exists —
   [`TillApi`](../../../apps/till/src/api/client.ts) takes a `baseUrl` (default `""`, same-origin).
2. **The device credential stays an httpOnly cookie the page cannot read, and it must reach every host
   on the venue's list.** Two delivery mechanisms, by naming:
   - **Paid tier (the MVP): one cookie scoped to the tenant's parent domain.** Every host a till reaches
     is a subdomain of a name we own (`box.<tenant>.waitron.<tld>`, `cloud.<tenant>.waitron.<tld>`,
     later `box2.…`), so a `Domain=<tenant>.waitron.<tld>` cookie rides to all of them. Zero exposure
     to page script; the cost is CORS for the venue's own origins.
   - **LAN-only tier with a second box (post-MVP): a primary-issued one-time ticket.** Free boxes stay
     `waitron.local` with a self-signed CA (owner 2026-09-05: no free public names — the name and
     certificate are a reason to pay). Two `.local` boxes share no parent name, so the primary mints a
     short-lived signed ticket the till redeems at the peer, which sets its own host-only cookie. Its
     own spec when the second box is scheduled (§5).
   - **Never a bearer token in page script** (Route A as written). A credential JavaScript can read is
     a credential XSS can steal, permanently; the ticket exposes it for one request.
3. **The native on-device agent is built from the start, for hardware, and never sits between the
   browser and the server.** Its first job is printing (a printer the venue already owns needs a local
   program to drive it; with a cloud-only server that program runs on the POS device). It is headless
   and outbound-only: it pulls print jobs from the same server list the till uses
   (failover-printing §4b) and pushes to the printer. Later option (owner, 2026-09-05): a native
   wrapper for the UI itself, for polish and familiarity — a packaging choice, not a routing mechanism.

## 2. What changed since distribution §3 (2026-08-15) — facts verified 2026-09-05

- **The MVP names both hosts under our domain.** The cloud standby exists only on the paid tier, and
  on that tier the box gets `<box-id>.waitron.<tld>` with a real certificate
  ([onboarding §3](2026-08-26-appliance-onboarding-design.md), the two-tier table); the cloud instance
  lives under our domain ([cloud services inventory](2026-08-29-cloud-services-inventory.md), case 1).
  Same-site cookies then do what Route A needed a readable token for (§4, rows 1–3).
- **The standby cannot authenticate a till under ANY route today.** The device cookie validates
  against `devices.token_hash` ([device-session.ts](../../../apps/server/src/device-session.ts)), and
  `devices` is in no sync enrolment: the core set is
  [`packages/db/src/enrolment.ts`](../../../packages/db/src/enrolment.ts), identity enrols only
  `persons` + `webauthn_credentials`
  ([`packages/identity/src/enrolment.ts`](../../../packages/identity/src/enrolment.ts)), and
  `grep -rn "enrol(devices\|enrol(tills\|enrol(deviceProfiles\|enrol(canvases" packages/*/src` prints
  nothing. So the tables `requireDevice` and `GET /api/till` read (`devices`, `tills`,
  `device_profiles`, `canvases`) must replicate before any reroute works — no new table, a required
  part of the build.
- **Direction matters.** Chrome's Local Network Access puts a permission prompt on a page from a
  public site reaching a local address; a page served from a local address is not restricted today
  (§4, row 4). So the till's page loads from the box; the cloud is an API target first and a page
  origin only while the box is dead; a page that came from the cloud reloads from the box before
  failing back; and the page never talks to the local agent on its own device.
- **Service workers need a trusted certificate, and iOS keeps an installed app's storage** (§4,
  rows 5–6). On the paid tier a precaching service worker is an optional add so the till opens while
  the box is dead; without it, staff open the cloud address, which boots the same device because the
  cookie covers both hosts.
- **The membership document already carries a contact address per node**
  ([`packages/membership/src/types.ts`](../../../packages/membership/src/types.ts), `contactUrl`),
  empty today because nothing routes on it
  ([membership-seed.ts](../../../apps/server/src/membership-seed.ts)). That field is the server list.
- **An unpromoted standby refuses a till.** The read-only gate 403s `POST /api/session` on a mirror,
  pinned by [`boot.mirror.rls.test.ts`](../../../apps/server/src/boot.mirror.rls.test.ts) (the
  "session-shaped, not routing-shaped" comment), so a till that fails over to an unpromoted cloud is
  "reachable, pending promotion" ([promotion-failover §7.1](2026-08-29-promotion-failover-and-node-lifecycle-design.md)),
  never a silent sale. That same comment names the two R3a deferrals the build carries (§5).

## 3. The handheld walkthrough the owner confirmed (the accepted behaviours)

A waiter's phone, an on-prem box, a paid cloud standby:

1. Open `box.<tenant>.waitron.<tld>` (resolves to the LAN); optionally install to the home screen.
   Not yet a known device → enter a pairing code a manager minted on the dashboard → the box sets the
   device cookie, scoped to the tenant domain. PIN login.
2. The server list arrives with every boot and refreshes whenever the phone talks to the primary —
   never fetched once — so a standby or box added later reaches phones paired before it existed.
3. The box dies: after N consecutive failures the app switches its target to the cloud and keeps
   probing the box (a reboot must not strand it). The cloud is a mirror and refuses logins and sales,
   so the app shows "local server unreachable, waiting for promotion" with a manual switch control —
   not half-working screens. A closed page reopens from the installed app's saved copy; a plain tab is
   pointed at the cloud address instead.
4. A human promotes the cloud (restart into primary, own chain and series — R3b). The app sees a
   primary answering, re-prompts the PIN (the login session was a row on the dead box), and carries
   on: open tabs minus the replication-lag tail; a sale in flight at the moment of death is shown as
   unconfirmed for a human to check (the `working_order_id` idempotency key catches the replicated
   case only).
5. A new handheld while the box is dead: the app and the pairing code both come from the cloud.
6. The repaired box returns as the standby; if promoted back, phones whose page came from the cloud
   reload from the box address first (the direction rule), prompted by the app.

A native app behaves identically in every step that is a property of the server side (3–6). Its
differences are on the phone: installed from a store (no server to download from), can hold the
credential itself, needs no saved copy, can drive hardware — for the price of an app per platform.

## 4. Provenance — external claims

| Claim used here | Source | Their words |
| --- | --- | --- |
| Subdomains of one registrable domain are the same site | MDN Glossary, *Site* | "`support.mozilla.org` and `developer.mozilla.org` are part of the same site, because `mozilla.org` is a registrable domain." |
| A `Domain` cookie reaches every subdomain | MDN, *Set-Cookie* | "Setting the domain makes the cookie available to that domain and all its subdomains." |
| `SameSite=Strict` is a same-*site* rule, not same-origin | MDN, *Set-Cookie* | "Send the cookie only for requests originating from the same site that set the cookie." |
| Local Network Access restricts public→local, not local→public (yet) | Chrome developers blog, *Local Network Access* (Chrome 142) | requests "from the public network to a local network or loopback destination"; "In the future, we plan to extend these protections to cover all cross-origins requests going to destinations on the local network." |
| Service workers need a trusted origin | MDN, *Service Worker API* | "Service workers are only available in secure contexts: this means that their document is served over HTTPS, although browsers also treat `http://localhost` as a secure context". |
| iOS deletes script-writable storage after 7 days of disuse; home-screen apps exempt | WebKit blog, *Full Third-Party Cookie Blocking and More* | "deleting all of a website's script-writable storage after seven days of Safari use without user interaction on the site" — "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use." |

Two things the table does NOT prove, to be proven by the build, not asserted: that a real browser
sends a `SameSite=Strict; Domain=<tenant>.waitron.<tld>` cookie on a `fetch` from `box.<tenant>…` to
`cloud.<tenant>…` with `credentials: "include"` (the three MDN rows combined — run it in the
browser-mode suite against two hosts under one parent before relying on it), and that `waitron.<tld>`
is not on the Public Suffix List (it is ours to keep off it).

## 5. What the build (Track B item 1's spec) must carry

- Replicate `devices`, `tills`, `device_profiles`, `canvases` to the standby. _Pointer, same day:
  Track A's swap spec ([`2026-09-05-outbox-to-native-replication-swap-design.md`](2026-09-05-outbox-to-native-replication-swap-design.md)
  §2.1) copies every table unless a module marks it local and names `tills`, `devices` and
  `device_profiles` in its `state` publication over the WireGuard link — so this requirement is met by
  that swap, not by an outbox enrolment; the reroute build sequences after the swap slice that ships
  the state publication, and checks `canvases` is in it._
- The device cookie takes a `Domain` attribute only when the host is under the configured tenant
  domain; host-only otherwise (`waitron.local`, loopback dev). The operator session cookie stays
  host-only — a switch re-prompts the PIN (v1; the portable signed token of distribution §4(ii)
  later).
- CORS on the till/device API for the venue's own origins, allow-listed from the membership document.
- `contactUrl` populated at provision and adopt (the node's advertised URL); the server list carried
  on the public boot read and cached on the device; a public role probe so the app can tell "mirror,
  pending promotion" from "primary".
- The two R3a deferrals: till node-scoped reads (`listHeldOrders`, `listStationQueue`,
  `listExpoQueue`) routed through the display-data node; selling gated on reboot completion, not the
  point-of-no-return.
- Detection with hysteresis, a manual switch, keep-probing the dead box, the unconfirmed-sale state.
- Optional, after: a precaching service worker + install prompt.
- Deferred to the second local box: the ticket mechanism (primary signs `{deviceId, peer, expiry}`
  with its membership key, the peer verifies via the trust set and sets a host-only cookie; the
  credential crosses page script for that one request). An alternative to check then: whether a
  multi-label mDNS name (`box2.waitron.local`) plus `Domain=waitron.local` gives the free tier a
  shared parent — unverified on iOS/Android resolvers, so not designed on.
- The promoted cloud serves tills directly on its public name; the tunnel remains the path *to the
  box* only (closes the "promoted cloud's reachability" open item of R3 §6/§8).
