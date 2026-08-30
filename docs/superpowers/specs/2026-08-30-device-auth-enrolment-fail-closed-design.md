# Device authentication — enrol every device, fail closed — Design

**Date:** 2026-08-30. **Status:** design (captured with the owner 2026-08-30); **DEFERRED — build
post-demo**, as infra hardening. The Phase-1 demo is unaffected: the order-only handheld firewall
already shipped (PR #173) covers it. **Runs SUPERVISED** when built — this is the trust boundary for
every client, and it touches the fiscal/cash path.

This is a **design of record for later work**, not an implementation plan. When it is scheduled it gets
its own spec-review → plan → build cycle; the sub-projects below each become their own slice.

---

## 0. Owner decisions this design is built on (2026-08-30)

1. **Every device is enrolled.** Today only KDS displays and (as of PR #173) handhelds are enrolled
   devices; a counter till is *not* — its identity is env config stamped into its server process
   (`WAITRON_TILL_*`, `till-config.ts`). This design makes **every browser device** — till, handheld,
   KDS — an enrolled device carrying a trusted identity.
2. **Device identity = the enrolled httpOnly token** (extend the machinery already shipped), **not**
   client certificates / mTLS. The scrypt-hashed 32-byte token in the `waitron_device` cookie is a
   strong-enough device gate; mTLS is a possible future rung, out of scope here.
3. **Fail closed.** The firewall flips from a **blocklist** ("refuse if handheld", PR #173) to an
   **allowlist**: each sensitive action declares which device *kinds* may perform it, and **no valid
   device cookie → denied**.
4. **MAC address is NOT a browser-device auth factor.** Reality-checked (§5): a web server cannot read
   a browser client's MAC from an HTTP request, and where it partially can (same L2 segment, via ARP)
   it is randomised by modern phones and trivially spoofable. Printers are a different case (§6).
5. **Printers are a separate track** (§6) — they are not HTTP clients, so identity is address-pinning
   at enrolment, hardware-limited. Independent of the browser-device work.
6. **Deferred to post-demo** (owner, 2026-08-30). No demo item depends on it.

Pre-production, so **no migration / no backfill** (CLAUDE.md §3): enrolment simply becomes mandatory.

---

## 1. Problem and current state

The trust model today is inconsistent across device classes, verified against the tree:

- **KDS / expo** — enrolled devices (`kds_station`; `expo_pass` specced): a pairing code mints a
  scrypt-hashed token in the httpOnly `waitron_device` cookie; `requireDevice`
  (`apps/server/src/device-session.ts`) authenticates each request. Strong.
- **Handheld** (PR #173) — enrolled the same way; carries a device cookie; order-only is
  **server-enforced** via `assertNotHandheld` on the fiscal/cash routes (`till-api.ts`), a
  **blocklist** ("this one kind is refused").
- **Counter till** — **not enrolled at all.** Identity is `WAITRON_TILL_*` env vars in the server
  process (`till-config.ts:131-186`); the boot fetch `GET /api/till` is unauthenticated; selling is
  gated only by the operator PIN session (`requireSession`), not by any device identity.

Consequence: "only an enrolled device may sell" is **not** enforceable today, because the seller (the
till) has no device identity. The blocklist can only name the kinds to refuse; it cannot require
positive identification. This design closes that: **positive device identity for every client, and a
fail-closed allowlist.**

---

## 2. Scope

**In (browser devices):**

- **Sub-project A — enrol every browser device.** A `till` `device_kind`; till provisioning mints a
  device identity so every till/handheld/KDS carries a `waitron_device` cookie.
- **Sub-project B — fail-closed allowlist authz.** Replace the blocklist with an allowlist: a single
  place maps each sensitive action → the set of device kinds permitted; no valid device cookie → deny.
  Generalises `device.forbidden_action`.

**In (separate track):**

- **Sub-project C — printer identity** (§6): address-pinning (IP, optionally MAC via ARP) at
  enrolment. Hardware-limited; independent.

**Out (YAGNI / deferred):**

- **Client certificates / mTLS** (decision 0.2) — a stronger future rung; not this design.
- **MAC as a browser-device auth factor** (decision 0.4, §5) — dropped.
- Any migration/backfill (pre-production).

---

## 3. The fail-closed allowlist (sub-project B, the heart of it)

Today's guard is a blocklist: `assertNotHandheld(deps, c, action)` throws when the caller *is* a
handheld. That inverts to an **allowlist** guard — call it `requireDeviceKind(deps, c, action)` — that:

1. reads the device cookie (`tryReadDevice`, already built in PR #173);
2. if there is **no valid device cookie → denies** (`device.unauthorized` / a new
   `device.enrolment_required`), the fail-closed default;
3. if the device's kind is **not in the allowlist for this action → denies** (`device.forbidden_action`);
4. otherwise proceeds.

The allowlist is **one tested table** (the single source of truth — the shape of `WIDGET_CONFIG` or the
permissions catalogue), e.g.:

| Action | Allowed device kinds |
|---|---|
| Sell — **cash** tender (`POST /api/sales`, cash) | `till`, `handheld` |
| Sell — **card** tender (`/api/sales` card, `POST /api/pay` integrated) | `till` |
| Reprint-sale / drawer-open (cash register) | `till` |
| Order-taking (open tab, round, fire, serve, status) | `till`, `handheld` |
| KDS bump / advance | `kds_station` |
| Expo fire/ready/away | `expo_pass` |
| Enrol a device (`POST /api/device/enrol`) | **exempt — unauthenticated** (bootstrap, §4) |

**The sell row is tender-aware because of a separate owner decision (2026-08-30): handhelds take
payments** — order-only (PR #173) was a risk-scoping choice, **not** a fiscal necessity. The SIF is the
**submitting node** (`nodeId`, `record-sale.ts:79-82` — "Which node processes and chains the sale — the
SIF/chain/series key"), **not** the till; a handheld files under its node's SIF exactly like a till, so
no per-device SIF is needed. **Cash-at-table is built first** (a near-term slice that reverses PR #173's
firewall for the cash tender only); **card via a mobile reader is deferred**. Until the card slice
lands, a handheld's card tender (manual or integrated `/api/pay`) stays fenced, and a handheld does not
open a cash drawer (a table waiter has a pocket float, not a register).

`device.forbidden_action` (shipped PR #173) carries over; the new default-deny path needs one code
(candidate `device.enrolment_required`, 400/401 — grep the `device.*` siblings before minting, never
renamed once shipped — CLAUDE.md §3). The full `requireSession`-route classification already recorded
on `mountTillApi` (PR #173) becomes the seed for the allowlist table.

**This is where "fail closed" lives:** an unidentified request cannot sell, bump, or fire — it is
denied by default rather than allowed by the absence of a blocklist match.

---

## 4. Never brick the venue — the bootstrap exemptions (load-bearing)

Fail-closed device auth must not lock a venue out of trading or setup. The exemptions:

- **The enrol route stays unauthenticated.** `POST /api/device/enrol` cannot require a device cookie
  (a fresh device has none). It is gated instead by a **manager-minted, single-use, short-TTL pairing
  code** (already the model) plus the redemption rate-limit — the bootstrap path.
- **Setup mode is exempt.** Before a venue is provisioned there are no devices; the onboarding wizard
  (setup-mode boot, `setup-api`) runs before any `waitron_device` exists and must not be gated by the
  allowlist.
- **Break-glass stays out-of-band.** The `waitron-break-glass` CLI (PR #166) authenticates by physical
  shell + `DATABASE_URL`, not a device cookie — unaffected, and remains the admin-recovery path.
- **Provisioning mints the till's device identity** so a provisioned till is *born* enrolled (the
  cookie set at provision time, persistent). A till therefore never reaches "logged in but no device
  identity" during normal operation.

---

## 5. Why MAC is not a browser-device auth factor (the reality check)

Recorded so this is not relitigated:

- **A web server cannot read a browser client's MAC from an HTTP request.** MAC is link-layer; by the
  time a request reaches the server socket, the server sees the peer **IP**, and any MAC in the frames
  is the **last hop's** (router/AP), not the origin device's. No HTTP header or TLS field carries it.
- **Same-L2-segment is the only exception, and it is weak.** If client and server share a broadcast
  domain (no router between — plausible for an on-box appliance), the server can resolve client-IP →
  MAC from its **ARP table**. But modern phones/laptops **randomise their WiFi MAC per network**
  (iOS 14+, Android 10+, desktop OSes) and can rotate it — unstable for exactly the handhelds in
  question — and **MAC is trivially spoofable**. As a security control it buys almost nothing over the
  enrolled token while adding real fragility (a waiter's phone silently locked out when iOS rotates its
  private address).

**Verdict:** the enrolled scrypt-hashed token is the browser-device identity. MAC is not used for
browser-device auth. (This is an external/technical claim, so before building, re-confirm the
same-subnet ARP behaviour in-place rather than trusting this paragraph — CLAUDE.md §1.)

---

## 6. Printer identity (sub-project C — separate, hardware-limited)

Printers are **not HTTP clients making authenticated requests** — the on-box server dials *them*
(IPP / raw 9100 by IP). So the cookie/allowlist model does not apply. A printer's identity is:

- **Pinned at enrolment as its network address** (IP; optionally its MAC via ARP on the same subnet —
  here MAC is more feasible than for browser clients because the server initiates and they share the
  LAN, though still same-subnet-only and spoofable, so a *soft* binding).
- Plus whatever the printer hardware supports (some support an auth token / TLS).

This is a distinct, smaller design shaped by printer-hardware limits — kept out of the browser-device
sub-projects and specced separately when scheduled.

---

## 7. The §5 reconciliation — fail-closed selling vs "nothing may block a sale"

CLAUDE.md §5: *"Nothing may block a sale on anything but the sale itself. A till that cannot sell is a
shop that cannot trade."* Fail-closed device auth requires a valid device cookie to sell, which appears
to conflict. It does not, **provided the check stays local**:

- §5 forbids making a sale depend on **remote/external** systems (network, AEAT, cloud) — fiscal
  submission is an outbox, never inline. A device cookie is checked **locally** by the on-box server
  reading a local cookie — no external dependency.
- Selling **already** requires a local operator session (`requireSession`); adding "a valid local
  device cookie" is a similar local gate, not a new class of dependency.
- The cookie is **long-lived** (1 year) and **set at provisioning**, so it does not normally vanish;
  recovery from loss (cleared browser data, reimage) is a **fast local re-enrol** (manager mints a
  pairing code), the same shape as an operator re-logging in.

So the rule is: **keep every device-auth check local, keep the enrol/setup/break-glass paths exempt,
and keep recovery on-box.** Under those, fail-closed is consistent with §5's spirit. A build must prove
(prove-by-deletion) that no device-auth check reaches for a remote resource on the sale path.

---

## 8. Sub-projects, dependencies, sequencing

1. **A — `till` device kind + enrol every browser device.** Add `till` to the `device_kind` enum
   (additive, per PR #173's precedent); provision a till with a device identity; the till app boots
   with a device cookie. **Must land first** — B cannot fail-closed until every till is enrolled or the
   shop cannot trade (§7).
2. **B — fail-closed allowlist authz.** Replace the blocklist with `requireDeviceKind` + the allowlist
   table + the default-deny path; the enrol/setup/break-glass exemptions (§4). **Depends on A.**
3. **C — printer identity.** Independent; schedule separately.

Each is its own slice with its own spec-review → plan → build. Order: A → B; C any time.

---

## 9. Testing posture (for the eventual build)

- **Real Postgres**, `requireDeviceKind` proven by deletion in both directions per action (a `till`
  sells, a `handheld` is denied selling, an unidentified request is denied everything on the allowlist;
  order-taking permits `till` + `handheld`); the fiscal H2 grep (no allowlist path reaches
  `recordTillSale` for a disallowed kind).
- **The allowlist table is a guard**: a test enumerates every fenced `requireSession` route and asserts
  it is covered by the allowlist (so a new fiscal route added later fails closed by default and the
  test names it) — the cross-cutting-guard pattern (CLAUDE.md §4, like `inmutabilidad`).
- **Bootstrap tests**: enrol works unauthenticated with a valid code; setup mode is exempt;
  break-glass unaffected.
- Coverage at the usual per-package thresholds.

---

## 10. Provenance

Designed against the live tree on 2026-08-30, reusing the device-identity machinery shipped in
device-identity-1 and extended in PR #173 (handheld tableside ordering): `devices`/`device_kind`,
`device_pairing_codes`, `requireDevice`/`tryReadDevice`, `assertNotHandheld` + `device.forbidden_action`
+ the `mountTillApi` route classification (`apps/server/src/device*.ts`, `till-api.ts`); the till's
env-config identity (`till-config.ts`); the setup-mode/onboarding path (`setup-api`) and the
break-glass CLI (PR #166). The MAC reality (§5) is an external/technical claim to re-verify in-place
before building. Owner decisions (§0) taken in the 2026-08-30 brainstorm.
