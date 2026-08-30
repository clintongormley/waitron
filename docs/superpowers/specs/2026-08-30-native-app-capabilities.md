# Native App — Capabilities That Would Require One (Handheld & Tablet)

**Date:** 2026-08-30
**Status:** Running list. **Nothing here is committed to build.** Grow it as new "the browser
cannot do this on the target device" findings appear.

This is a companion to [2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md),
which decided the deli's hardware, and to
[2026-08-15-distribution-and-client-topology-design.md](2026-08-15-distribution-and-client-topology-design.md),
which worked out the client/server topologies (including the cloud-primary case that N4 turns on).
It exists to answer a question that keeps recurring one feature at a time: *does this force us to
ship a native app?*

---

## Why this list exists

Waitron is **browser-first by decision.** The till runs in a browser and peripheral drivers run on
the **local server**, not in the till device (hardware spec D3 / §1). That decision is what keeps
"which device is the till" a permanently free choice — any tablet, any OS, any browser.

A native app is the opposite kind of commitment: a separate iOS **and** Android build, app-store or
MDM distribution, and per-vendor SDK maintenance that never ends. So the decision *"should we build
a native handheld/tablet app?"* should be made **once, against the whole set** of capabilities that
only a native app can deliver — not piecemeal, where a single feature quietly drags a native app
into the architecture behind it. This document is where that set accumulates.

The trigger to actually spec the app is when this list crosses the threshold where the build pays
for itself. When it does, the reference shape already exists: Stripe Apps on Devices and the
Terminal / Tap-to-Pay SDKs (hardware spec §8).

## The distinction that decides each row

There are two different "can't", and only one forces a native app:

- **(a) Hard blocker** — the browser genuinely cannot do it on the target platform. Forces native
  if we want the capability on that platform.
- **(b) Quality argument** — a PWA can do it, but worse or less reliably. Weighed against the build
  cost, not decisive on its own.

Keep them apart in every row below.

**Our architecture already dodges a whole class of these.** Because peripheral drivers live on the
**server**, "Safari can't drive USB/serial/Bluetooth" does *not* bite a networked till — the server
drives the hardware and the till just talks HTTP to the server. The hard-blocker rows below bite
specifically a **device that must talk to hardware or a card network itself, with no server in
reach** — a standalone handheld, or a single-box venue where the till *is* the server.

## Capabilities (as of 2026-08-30)

| # | Capability | Why the browser can't (target platform) | Evidence | Weight |
| --- | --- | --- | --- | --- |
| N1 | **Phone-as-reader card acceptance — SumUp Tap to Pay** | SDK-only, no Cloud/server API. The Secure Element encrypts the card straight to the PSP; the app gets a token, never card data — so it cannot be driven from our server | hardware spec §8; [SumUp dev](https://developer.sumup.com/terminal-payments/readers/tap-to-pay), [Apple](https://support.apple.com/guide/security/tap-to-pay-on-iphone-sec72cb155f4/web) | **Hard blocker** for phone-as-reader. Fee-neutral vs the Solo in ES; saves €79 hardware; loses chip-insert |
| N2 | **Phone-as-reader card acceptance — Stripe Tap to Pay** | Same shape: built into the Terminal iOS/Android SDK. Server-driven Terminal API supports smart readers only, not Tap to Pay | [Stripe](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay) | **Hard blocker.** The Stripe-side sibling of N1 — confirms this is a property of phone-as-reader, not one vendor |
| N3 | **Store-and-forward / certified offline card capture on the device** | Certified offline capture lives in the on-device payment SDK; the hardware spec already names this "the expensive answer … a native wrapper and an on-device SDK" | hardware spec §5 | **Hard blocker** — but only relevant if we ever want offline card capture on the device *itself*, rather than the Solo's own standalone mode, which already covers the deli outage path |
| N4 | **The local print-server agent (LAN→cloud print bridge)** — polls print jobs from the primary node and dispatches each to the right local printer | With the **primary node in the cloud**, the cloud cannot reach a LAN printer (NAT — the printer's IP is private): the bridge must be initiated from inside the shop, and a browser cannot hold it. The web platform has no raw-socket API for TCP:9100, and the HTTP-to-printer exceptions (Epson ePOS-Print / Star WebPRNT) trip mixed-content + iOS Local-Network limits. So a native agent on a LAN device holds the outbound socket to the cloud and forwards jobs to the printer | topology spec §5 three-bridge table — esp. "a till running the agent"; hardware spec §6 | **Hard blocker for the cloud-primary topology.** Escape hatch: a **CloudPRNT / Server-Direct-Print** printer polls the cloud in firmware and needs no local agent — a hardware upgrade, not a requirement. Fully **moot when a local node exists** and bridges the printer for free (the deli's case) |
| N5 | **Direct Bluetooth (BLE) peripheral from the device** — a BLE receipt printer, reader or scale paired to the handheld itself | Web Bluetooth is unsupported in iOS Safari (Apple declined it, citing fingerprinting) | browser-compat surveys, 2026-08-30 — confirm against MDN `browser-compat-data` as §1 does | **Hard blocker on iOS.** Mostly moot while drivers are server-side |
| N6 | **Direct NFC read from the device** — staff badge tap, NFC loyalty, product NFC | Web NFC is Chrome-Android-only; unsupported in iOS Safari (Apple ships Core NFC for native apps only) | browser-compat surveys, 2026-08-30 — confirm against MDN | **Hard blocker on iOS** |
| N7 | **Direct USB / serial peripheral from the till device itself** | WebUSB and Web Serial are unsupported in Safari / iOS (hardware spec §1 receipt: MDN `browser-compat-data`) | hardware spec §1 | **Hard blocker on iOS** — but the server-side driver model is exactly what avoids needing this |
| N8 | **Single-app kiosk lockdown / MDM-managed handheld** | A device locked to a single app is managed at the OS/MDM layer | unverified — needs a check | Quality/ops, not a payments blocker |
| N9 | **Reliable background push on the handheld** | Web Push exists on iOS 16.4+, but requires the PWA to be installed to the home screen and has EU/DMA caveats worth confirming for Spain | Web Push on iOS 16.4+ per browser-compat, 2026-08-30 — verify the EU/home-screen conditions | Borderline — verify before counting it as a reason |
| N10 | **Automatic request routing to the primary, with failover to secondaries** (the `[primary → secondary → cloud]` list) | A browser client points at one origin; failing over to another host mid-session normally loses the auth cookie, cache and session. A **stable local endpoint** (`localhost:agent`) that never changes while the agent swaps its upstream is what keeps the browser's world stable across the switch — and only a native on-device agent can provide it | topology spec §3, "Route B — the on-device agent" | **Strong quality/security argument, not a strict hard blocker.** The browser-only path (Route A, a service worker holding the failover list) ships failover with no native code, but **downgrades auth to an XSS-exfiltratable bearer token**, needs CORS on every server, and can't cold-start on iOS if the origin is gone and the cache was evicted. The topology spec's destination is Route B |

## Several of these are one component — that is the whole point

The rows are not each a separate app. **N4 (the print bridge) and N10 (the failover routing /
stable local endpoint) are the same native process** — the topology spec's on-device agent, which
holds the servers' credentials, provides the unchanging `localhost:agent` origin the PWA talks to,
swaps its upstream on failover, and forwards print jobs to the LAN printer. N3 (on-device
store-and-forward) and the direct-hardware rows (N5–N7) would fold into that same agent too.

This is exactly why the decision must be made **once against the whole set**. Weighed alone, each
row has a browser-only workaround or a hardware escape hatch and "don't build the app" wins every
time. Weighed together, one on-device agent discharges N3, N4, N10 and the hardware rows at once —
and the auth model (N10's Route B) and the cloud-primary printer bridge (N4) both point at building
it rather than papering over each in the browser. The list exists so that compounding is visible
instead of being lost across four separate feature decisions.

## How to use this list

- When a new feature's design hits a *"the browser can't do this on iOS/the device"* wall, **add a
  row here** rather than quietly letting that one feature pull a native app into the design behind
  it.
- Every row must say **which platform** blocks it (several are iOS-only) and **whether the
  server-side driver model already avoids it** — many of these only bite a standalone / single-box
  device.
- Keep the (a) hard-blocker vs (b) quality distinction honest. Only hard blockers move the "build a
  native app" needle.
- Several rows are marked *unverified* or *confirm against MDN*. That is deliberate — per the house
  claim rules, a "the browser can't do X" assertion needs a receipt (MDN `browser-compat-data`, the
  pattern hardware spec §1 already uses) before it is relied on in a build decision. Verify the row
  when it becomes load-bearing, not before.

## Not on this list, on purpose

Capabilities the browser handles well enough that they are **not** a reason to go native: the till
UI itself, camera-based QR/barcode scanning where a networked path exists, receipt display, and
anything the local server already drives on the till's behalf. Adding one of these here would
inflate the case for an app we should not build yet.
