# Native App — Capabilities That Would Require One (Handheld & Tablet)

**Date:** 2026-08-30
**Status:** Running list. **Nothing here is committed to build.** Grow it as new "the browser
cannot do this on the target device" findings appear.

This is a companion to [2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md),
which decided the deli's hardware. It exists to answer a question that keeps recurring one feature
at a time: *does this force us to ship a native app?*

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
| N4 | **Host the local printer / peripheral agent on the till device itself** | A browser tab cannot hold a raw TCP socket to an ESC/POS printer on `:9100`, cannot drive USB (WebUSB unsupported on iOS Safari), and cannot run a persistent background process. To drive its *own* printer with no separate server box, the till needs a native host process | hardware spec §6 (ESC/POS over TCP:9100); WebUSB/Web Serial receipt in §1 | **Hard blocker** for a single-box / serverless till. Moot while the server hosts drivers and the till is networked to it — the case this covers is the till that *is* the server |
| N5 | **Direct Bluetooth (BLE) peripheral from the device** — a BLE receipt printer, reader or scale paired to the handheld itself | Web Bluetooth is unsupported in iOS Safari (Apple declined it, citing fingerprinting) | browser-compat surveys, 2026-08-30 — confirm against MDN `browser-compat-data` as §1 does | **Hard blocker on iOS.** Mostly moot while drivers are server-side |
| N6 | **Direct NFC read from the device** — staff badge tap, NFC loyalty, product NFC | Web NFC is Chrome-Android-only; unsupported in iOS Safari (Apple ships Core NFC for native apps only) | browser-compat surveys, 2026-08-30 — confirm against MDN | **Hard blocker on iOS** |
| N7 | **Direct USB / serial peripheral from the till device itself** | WebUSB and Web Serial are unsupported in Safari / iOS (hardware spec §1 receipt: MDN `browser-compat-data`) | hardware spec §1 | **Hard blocker on iOS** — but the server-side driver model is exactly what avoids needing this |
| N8 | **Single-app kiosk lockdown / MDM-managed handheld** | A device locked to a single app is managed at the OS/MDM layer | unverified — needs a check | Quality/ops, not a payments blocker |
| N9 | **Reliable background push on the handheld** | Web Push exists on iOS 16.4+, but requires the PWA to be installed to the home screen and has EU/DMA caveats worth confirming for Spain | Web Push on iOS 16.4+ per browser-compat, 2026-08-30 — verify the EU/home-screen conditions | Borderline — verify before counting it as a reason |

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
