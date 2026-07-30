# Deli Hardware — Design

**Date:** 2026-07-30
**Status:** Approved in brainstorming
**Scope:** The physical devices the deli opens with, and the small peripheral seam needed to drive
them. The payment-provider work this implies is deliberately **not** here — see §8.

This document exists because hardware selection turned out to be an architecture question. The
deli is the first deployment, not the only one, and the stated goal is that other users should be
able to **reuse hardware they already own**. That makes the deliverable a seam with the deli as its
first adapter, rather than a shopping list.

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| D1 | **The till must be general-purpose hardware; the card reader need not be.** A device running Waitron may not be a locked POS appliance. A reader bound to one PSP is acceptable — card data is the acquirer's problem by design (`pos-architecture-design.md` §1) |
| D2 | **Launch is two counter positions plus one handheld.** A self-order kiosk and further counter positions are wanted eventually but are not bought now |
| D3 | **Peripheral drivers run on the local server**, not in the till browser |
| D4 | **No weighed goods at the deli.** Scales, the priced-label parser and the metrology question all leave the launch path |
| D5 | **Cash is accepted, and an internet outage must not stop card acceptance** |
| D6 | **SumUp is the recommended acquirer**, with the existing Stripe path retained rather than removed |

D3 is the load-bearing one. Putting drivers in the browser via WebUSB/WebSerial would have been
simpler, but iOS Safari implements none of those APIs, which silently locks every future user's
till platform to Chrome or Android. Since the local server already exists — mandatory above one
till, and on the same box for a single-till venue (`pos-architecture-design.md` §5) — hosting the
drivers there costs nothing and makes till platform a free choice permanently.

## 2. Sizing assumption

**~€15 average ticket, ~100 transactions/day, ~26 trading days** — about 2,600 card transactions
and €39,000/month. Supplied during brainstorming as an estimate for normal trading, not a
measurement. Every cost conclusion below inherits its uncertainty.

## 3. Buy list

Prices are split by provenance. **Sourced** figures were read from the vendor's own Spanish pages on
2026-07-30 (§9). **Estimate** figures are from general knowledge and have not been quoted — they are
here to size the order of magnitude and must be replaced with real quotes before purchase.

| Item | Qty | Unit | Line | Provenance |
| --- | --- | --- | --- | --- |
| SumUp Solo | 3 | €79 | €237 | Sourced |
| Local server — fanless mini-PC, 16 GB, NVMe | 1 | ~€250 | ~€250 | Estimate |
| UPS, line-interactive, ~650 VA | 1 | ~€100 | ~€100 | Estimate |
| Counter till — commercial tablet + counter stand | 2 | ~€250 | ~€500 | Estimate |
| Handheld — phone or 8" tablet | 1 | ~€180 | ~€180 | Estimate |
| Ethernet ESC/POS receipt printer | 2 | ~€200 | ~€400 | Estimate |
| Cash drawer, kicked by its printer | 2 | ~€80 | ~€160 | Estimate |
| Gigabit switch, WiFi AP, cabling | — | — | ~€200 | Estimate |
| **Total** | | | **~€2,030 ex VAT** | |

Optional: a 4G-failover router (~€200). It keeps the fiscal outbox draining through a broadband
outage, but it is **not** required to keep selling — submission is an outbox and never inline
(`CLAUDE.md` §5).

Three notes on quantities. Two printers and two drawers give each counter position its own, which
matters for cash accountability; one of each is defensible at launch if the positions are adjacent.
A barcode scanner per position (~€50) is worth adding **only if** the deli sells barcoded pre-packed
goods — undetermined, and it needs no driver either way (§6). The handheld carries a Solo alongside
it rather than integrating one, for the reason in §5.

## 4. Card acceptance — why SumUp

Stripe's card-present rate in Spain is **1.4% + €0.10** for EEA consumer cards and **2.9% + €0.10**
for non-EEA. SumUp is **1.69%** flat pay-as-you-go, or **0.99%** on domestic debit/credit under
Pagos Plus at €19/month, with premium, international and Amex staying at 1.69%.

The fixed component decides it. Stripe and SumUp pay-as-you-go are equal where
`0.014T + 0.10 = 0.0169T`, i.e. at **T = €34.48**. Below that ticket size SumUp is cheaper; above it
Stripe is. A deli is nowhere near €34.

At the §2 volumes: Stripe ≈ **€806/month**, SumUp Pagos Plus ≈ **€405/month**. About **€400/month,
€4,800/year**, and the gap widens with tourist trade because Stripe's non-EEA rate is far above
SumUp's flat 1.69%. €39k/month also clears SumUp's €10k threshold for a negotiated custom rate on
day one.

**The Stripe path is retained, not removed.** It is the mechanism that has been proven end-to-end
against a live account, and it is the fallback if the Solo integration disappoints in the shop. The
`PaymentProvider` seam exists precisely so both can coexist.

## 5. The outage path

D5 requires card acceptance to survive a broadband outage. The expensive answer is a native wrapper
and an on-device SDK for store-and-forward. The cheap answer uses hardware already in the buy list
and code already merged:

| State | Card path |
| --- | --- |
| Healthy | The server pushes a checkout to the Solo via SumUp's Cloud API. Fully integrated |
| Deli broadband down | Staff take the payment **standalone on the Solo**, over the reader's own mobile connection, and record it in the POS as a **Mode 1 manual tender** — already landed |
| Broadband and mobile both down | Cash. The till keeps chaining sales locally throughout |

A pleasant side effect: the readers do not depend on the deli LAN at all, so a counter WiFi failure
does not stop card payment.

Two consequences to carry forward.

**It is a manual fallback, not store-and-forward.** Staff key the amount into the Solo and mark the
tender in the POS. That is a deliberate trade — it costs no new hardware, no native app and no new
code, against a slower flow during an outage that should be rare.

**It puts records in the `unmatched` bucket.** A standalone Solo payment appears in SumUp's
settlement report with no local row referencing it, which is `classify`'s `unmatched` return
(`packages/payments/src/reconcile.ts`) — **not** an `orphan`. Orphan means the opposite direction: a
local captured row with no sale attached, classified without consulting the report at all
(`reconcile.ts:200`). Getting this the wrong way round would send the payment spec hunting the wrong
mechanism.

Whether it is noise or a finding depends on two things this spec cannot settle: how the SumUp
adapter scopes its sweep, and whether a Mode 1 manual tender is visible to it at all, given
reconcile audits one `provider` identity. The payment spec (§8) must decide — plausibly by matching
a manual tender to an unmatched record on amount and time window. Left undecided, a fallback running
all afternoon fills the report with unmatched records.

**This section rests on an unverified claim.** See §7.

## 6. The peripheral seam

Dropping weighing (D4) shrank this from a sub-project to a section. Three things, one of which is
not a device:

- **`ReceiptPrinter` — ESC/POS over TCP to port 9100.** One adapter covers Epson, Star and most of
  the installed base, which is what makes "reuse your existing printer" true rather than
  aspirational. Network-attached rather than USB because the server is in a back room and the
  printers are at the counter.
- **Cash drawer — a capability of the printer, not a peripheral.** The drawer is wired to the
  printer's kick port and opened by an escape sequence. No second adapter, no second transport.
- **Barcode scanner — no adapter at all.** An HID scanner types. The till needs a timing heuristic
  to distinguish a scan from a human at a keyboard, and that is the entire integration.

Tested against a byte-capturing fake sink so the escape sequences are asserted exactly; verification
against a real printer is manual and should be recorded as such.

Live-weight scales and the priced-label barcode parser stay on the roadmap as later adapters behind
this seam. Of the two, the **label parser is much the cheaper** — the scanner is already a keyboard,
so the work is a configurable parser for in-store EAN-13 (GS1 reserves the `02` and `20`–`29`
prefixes for restricted distribution) or GS1-128 application identifiers. Live weight is a
per-vendor driver programme with no common protocol; Mettler-Toledo's SICS is the closest thing to a
standard and the right first target.

## 7. What needs verifying before money is spent

Listed in order of how much rests on it.

1. **That the SumUp Solo has built-in mobile data and operates standalone.** The whole of §5 rests
   on this. It is reported by third-party reviews, **not** by a SumUp page I was able to read — the
   product URL 404s. Confirm on SumUp's own material or with sales before treating the outage path
   as designed. If it is false, D5 forces the native-wrapper route and this design changes shape.
2. **The actual contracted rates.** The official pricing page says 1.69% pay-as-you-go; a
   third-party review said 1.5%. Confirm against the real contract, and ask for the custom rate
   given §2 volumes.
3. **Six of the eight buy-list lines.** Everything marked Estimate in §3.
4. **Whether the deli sells barcoded pre-packed goods**, which decides the scanner line.

## 8. Deliberately not in this spec

**The async card-present provider shape**, and `@waitron/payments-sumup` as its first adapter. This
is its own spec and its own cycle. The finding that justifies the shape: Stripe Mode 2a, SumUp's
Cloud API and Square's Terminal API are all *the same topology* — our server pushes a checkout to a
networked reader over HTTPS and the outcome comes back. Stripe returns it synchronously; SumUp and
Square return it by webhook, which Mode 3's async neutral layer and the `resolve_payment_tenant`
webhook seam already absorb. So the sub-project is the shape, with SumUp first on cost and Square
second on reach, and Adyen or Redsys later on the same shape.

Square matters for reuse specifically: a merchant with a Square Terminal can keep it, buy a cheap
tablet, and run Waitron — the Terminal API pairs a third-party POS to the device by device code.
Limits to design against: no splitting one checkout into multiple payments, no cash, no external
printer while paired, and completed checkouts deleted after 30 days, which needs checking against
our reconcile lookback.

**Also deferred:** the self-order kiosk (D2); scales and metrology (D4); and whether Waitron can run
*on* Square hardware — undetermined. What exists is developer-forum threads from 2020 to 2024 asking
for it and Square pointing people at the Terminal API. That is absence of documented support, which
is not proof of impossibility. Settling it requires trying it, not reading further.

By contrast Stripe's hardware **is** open to this: Apps on Devices runs a custom Android app on the
S700, with an APK uploaded to the Stripe API under a 200 MB limit and 8 GB of device storage, the
POS and consumer-facing halves talking over TCP/IP. If a single-device handheld ever matters more
than the fee difference, that is the route.

## 9. Provenance of the sourced figures

All read 2026-07-30.

| Figure | Source |
| --- | --- |
| Stripe card-present 1.4% + €0.10 EEA, 2.9% + €0.10 non-EEA, +€0.10 Tap to Pay, +€0.05 P2PE | <https://stripe.com/es/pricing> |
| Stripe hardware — WisePad 3 €59, WisePOS E €199, Reader S700 €259, all ex VAT | <https://stripe.com/es/terminal> |
| SumUp 1.69% PAYG, Pagos Plus €19/mo → 0.99% domestic, 1.69% premium/international, custom plan above €10k/mo | <https://www.sumup.com/es-es/precios/> |
| SumUp hardware — Tap to Pay €0, Solo Lite €34, Solo €79, Terminal €169 | <https://www.sumup.com/es-es/datafonos/> |
| SumUp Cloud API — server-driven, no proximity limit, webhook results, target device must be online, 60s window, Virtual Solo sandbox has no offline | <https://developer.sumup.com/terminal-payments/cloud-api> |
| SumUp refunds — `POST /v0.1/me/refund/{txn_id}`, full or partial; transactions list with a `RECONCILED` status | <https://developer.sumup.com/api/transactions> |
| Square Terminal API — device-code pairing, `terminal.checkout.updated` webhook or polling, and the four limits in §8 | <https://developer.squareup.com/docs/terminal-api/overview> |
| Stripe Apps on Devices — custom Android app on S700, 200 MB APK, 8 GB storage, TCP/IP between halves | <https://docs.stripe.com/terminal/features/apps-on-devices/overview> |

Not sourced, and flagged in §7: the Solo's built-in connectivity and standalone operation.
