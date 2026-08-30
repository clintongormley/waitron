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
| D1 | **The till must be general-purpose hardware; the card reader need not be.** A device running Waitron may not be a locked POS appliance. A reader bound to one PSP is acceptable — card data is the acquirer's problem by design ([2026-07-18-pos-architecture-design.md](2026-07-18-pos-architecture-design.md) §1) |
| D2 | **Launch is two counter positions plus one handheld.** A self-order kiosk and further counter positions are wanted eventually but are not bought now |
| D3 | **Peripheral drivers run on the local server**, not in the till browser |
| D4 | **No weighed goods at the deli.** Scales, the priced-label parser and the metrology question all leave the launch path |
| D5 | **Cash is accepted, and an internet outage must not stop card acceptance** |
| D6 | **SumUp is the recommended acquirer**, with the existing Stripe path retained rather than removed |

D3 is the load-bearing one. Putting drivers in the browser via WebUSB/WebSerial would have been
simpler, but **neither API is available in Safari, on the desktop or on iOS**, which would silently
lock every future user's till platform to Chrome or Android.

> **The receipt.** MDN's `browser-compat-data`, read 2026-07-30:
> [`api/USB.json`](https://github.com/mdn/browser-compat-data/blob/main/api/USB.json) and
> [`api/Serial.json`](https://github.com/mdn/browser-compat-data/blob/main/api/Serial.json) both
> record `safari: version_added: false` and `safari_ios: "mirror"` — mirroring desktop Safari, so
> also false. WebUSB is Chrome 61+; Web Serial is Chrome 89 on desktop but only **Chrome Android
> 138**, so even on the supported platform it is recent. MDN labels both *"Limited availability —
> not Baseline because it does not work in some of the most widely-used browsers."* This is a claim
> about Safari specifically; it is **not** a claim that no iOS browser can ever do it, which would
> need separate evidence about alternative engines under the EU DMA.

Since the local server already exists — mandatory above one till, and on the same box for a
single-till venue ([2026-07-18-pos-architecture-design.md](2026-07-18-pos-architecture-design.md)
§5) — hosting the drivers there costs nothing and makes till platform a free choice permanently.

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

Optional but reassessed upward: a **4G-failover router (~€200)**. Originally justified as keeping the
fiscal outbox draining, which is real but weak — submission is an outbox and never inline
(`CLAUDE.md` §5), so an outage delays filing rather than blocking it. The stronger case emerged from
§5: because the reader carries its own mobile data, the *only* broken link during a broadband outage
is **our server's** internet. Restore that and the integrated Cloud API path keeps working, which
turns the outage experience from manual keying back into a normal sale. At €200 against ~€2,030 that
is the best-value line in the table.

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
| Deli broadband down, server on 4G failover | Still fully integrated — the reader was never on our network. This is why the optional router in §3 is worth buying |
| Deli broadband down, no failover | Staff take the payment **standalone on the Solo**, over the reader's own mobile data, and record it in the POS as a **Mode 1 manual tender** — already landed |
| Reader's mobile signal also drops | The Solo advertises an **offline mode** "as a backup if your signal drops". Its limits are unestablished — see §7 |
| Everything down | Cash. The till keeps chaining sales locally throughout |

The reader's independence is sourced, not assumed: SumUp state the Solo ships with *"a 4G SIM card
with free unlimited data so you can accept payments on the go"* and can use WiFi instead where
available. So the readers do not depend on the deli LAN at all, and a counter WiFi failure does not
stop card payment.

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

**An apparent contradiction, resolved.** SumUp's Cloud API docs say *"the target device must be
online, otherwise checkout won't be accepted"*, while the Solo's product page advertises an offline
mode. Both are true and they describe different paths: the Cloud API **push** needs the device
reachable from SumUp's servers, whereas offline mode belongs to the device's **own** standalone flow.
That distinction is why the fallback works at all, and why offline mode cannot be used to rescue the
integrated path.

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

1. ~~**That the SumUp Solo has built-in mobile data and operates standalone.**~~ **Closed 2026-07-30
   on SumUp's own material.** Connectivity: *"a 4G SIM card with free unlimited data so you can
   accept payments on the go"*, with WiFi as an alternative. Standalone: the reader carries a touch
   screen holding up to 50 products with saved fixed prices, and issues refunds on the device. Also
   found, and better than designed for: *"4G, WiFi, and offline mode as a backup if your signal
   drops"*. §5 no longer rests on an unverified claim.
2. **Whether standalone and offline operation survive being paired to the Cloud API — and what
   offline mode's limits are.** This is the *narrowed residual* of item 1, and now the only thing §5
   still assumes. SumUp's Solo product page says nothing at all about third-party POS or API
   integration, so the interaction is undocumented in both directions. That pairing can change device
   behaviour is not hypothetical: Square's Terminal API disables external printer connections while
   paired (§8). Also unestablished are offline mode's floor limits, value or count caps, and how long
   it will hold. Ask SumUp both questions together; neither changes the buy list, but the second
   decides how much of the last two table rows in §5 is real.
3. **The actual contracted rates.** The official pricing page says 1.69% pay-as-you-go; a
   third-party review said 1.5%. Confirm against the real contract, and ask for the custom rate
   given §2 volumes.
4. **Six of the eight buy-list lines.** Everything marked Estimate in §3.
5. **Whether the deli sells barcoded pre-packed goods**, which decides the scanner line.

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
Limits to design against: no cash, no external printer while paired, and completed checkouts deleted
after 30 days, which needs checking against our reconcile lookback.

**Not** a limit, despite how the reference reads: *"the Terminal API doesn't support splitting a
checkout into multiple payments for a single checkout request."* That constrains one request, not
one sale. Square documents split tender as *"the seller creates multiple Terminal checkout requests
that address each part of the total payment amount"* — so the split lives in our domain model and
the processor just charges cards, which is what we want anyway. Our schema already represents it:
`payments.sale_id` is nullable under a **non-unique** index, and the unique keys are
`(tenant_id, id)` and `(tenant_id, provider, payment_ref)`, so N payment rows may share one sale.
Fiscally it changes nothing — payments reference sales, sales are what chain, so N tenders still
produce one registro.

Take the variant where **we** compute the amounts and send N independent checkouts, not the one that
passes Square an `order_id` and reads authorised totals back via `RetrieveOrder`. The order-linked
form puts our domain state in the processor, is regionally gated on order-ID support (unchecked for
Spain), and has no SumUp or Stripe equivalent — it would break the one-shape-many-adapters premise
above. The genuine work is not the split but the **partial failure**: one checkout captures, the next
declines, and a sale is left part-tendered. That state machine is provider-neutral and belongs in the
payment spec. None of it is deli scope — split tender is Restaurant phase
([2026-07-18-pos-architecture-design.md](2026-07-18-pos-architecture-design.md) §2 #10).

**Also deferred:** the self-order kiosk (D2); scales and metrology (D4); and whether Waitron can run
*on* Square hardware — undetermined. What exists is developer-forum threads from 2020 to 2024 asking
for it and Square pointing people at the Terminal API. That is absence of documented support, which
is not proof of impossibility. Settling it requires trying it, not reading further.

By contrast Stripe's hardware **is** open to this: Apps on Devices runs a custom Android app on the
S700, with an APK uploaded to the Stripe API under a 200 MB limit and 8 GB of device storage, the
POS and consumer-facing halves talking over TCP/IP. If a single-device handheld ever matters more
than the fee difference, that is the route.

**SumUp Tap to Pay — the phone *as* the reader, and why it is not the Solo's replacement.** SumUp
offers Tap to Pay on both iPhone (XS or newer, iOS 16.4+) and Android (any NFC phone/tablet on
Android 11+): the device's own NFC becomes the contactless reader, with no Solo. It is tempting for
the handheld, since it would drop the Solo that §3 currently pairs alongside it. Two findings,
sourced 2026-08-30, decide against it for now — recorded so the option is not re-researched from
scratch, and **nothing is built now**:

- **It is SDK-only — there is no server-driven path, and this is by security design, not a SumUp
  quirk.** Unlike the Solo, Tap to Pay has no Cloud API: SumUp exposes it only through an on-device
  iOS SDK and Android Tap-to-Pay SDK
  (<https://developer.sumup.com/terminal-payments/readers/tap-to-pay>). The intuitive route — read
  the card on the phone's NFC, POST it to our server, drive the Cloud API — is impossible: when a
  card is tapped the phone's **Secure Element takes over the NFC controller, reads the card, and
  encrypts it straight to the payment service provider; no app on the device ever sees card data,
  only a payment token**
  (<https://support.apple.com/guide/security/tap-to-pay-on-iphone-sec72cb155f4/web>). There is
  nothing to POST, and routing PAN through our backend is exactly what PCI forbids. The only
  integration is Waitron running **as a native app on the phone** with SumUp's SDK linked in — the
  same "native app on the device" shape as Stripe Apps on Devices above, and a genuinely larger
  build than the backend HTTPS call the Solo already fits. **Stripe's Tap to Pay is identical in
  this respect** (built into the Terminal iOS/Android SDK; the server-driven Terminal API supports
  smart readers only), so this is a property of phone-as-reader, not of one vendor
  (<https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay>).
- **In Spain it is fee-neutral, not a premium.** The 2.75% figure that circulates is SumUp's
  US/Ireland rate and does **not** apply here. The es-es Tap to Pay page charges the same rate as
  the card readers — **1.49% pay-as-you-go / 0.75% Pagos Plus** as read 2026-08-30
  (<https://www.sumup.com/es-es/tap-to-pay/>). So the trade is not fee-for-convenience: per tap it
  equals the Solo, it saves the Solo's €79 hardware, and it costs a native app build plus the loss
  of **chip-insert** (Tap to Pay is contactless-only — a card that will not tap cannot be served).
  Note this 1.49% / 0.75% is **lower** than the 1.69% / 0.99% recorded from the `precios` page on
  2026-07-30 in §9 — reconcile the two before relying on either; it may be a general rate cut since
  July or a page-specific figure.

This is the leading entry in the running list of capabilities that would justify a native
handheld/tablet app — see
[2026-08-30-native-app-capabilities.md](2026-08-30-native-app-capabilities.md).

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
| Solo connectivity and standalone operation — 4G SIM with free unlimited data, WiFi alternative, *"offline mode as a backup if your signal drops"*, on-device product list and refunds | <https://www.sumup.com/en-us/solo-card-reader/> plus SumUp's own Solo FAQ copy |
| SumUp Tap to Pay — SDK-only (iOS SDK + Android Tap-to-Pay SDK), no Cloud API; iPhone XS+/iOS 16.4+, Android 11+ NFC; read 2026-08-30 | <https://developer.sumup.com/terminal-payments/readers/tap-to-pay> |
| SumUp Tap to Pay rate (ES) — 1.49% PAYG / 0.75% Pagos Plus, same as readers per that page; read 2026-08-30 | <https://www.sumup.com/es-es/tap-to-pay/> |
| Tap to Pay security model — Secure Element reads and encrypts the card straight to the PSP; app receives a token, never card data; PCI MPoC validated | <https://support.apple.com/guide/security/tap-to-pay-on-iphone-sec72cb155f4/web> |
| Stripe Tap to Pay — built into the Terminal iOS/Android SDK; server-driven Terminal API supports smart readers only, not Tap to Pay; read 2026-08-30 | <https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay> |

Still unsourced, and now the only such claim in this spec: whether standalone and offline operation
remain available once the reader is paired to a Cloud API integration, and what offline mode's limits
are (§7 item 2). Note the earlier product URL `www.sumup.com/es-es/datafonos/solo/` 404s; the
`en-us/solo-card-reader/` path is the one that resolves.

**Rate discrepancy to reconcile (added 2026-08-30).** The Tap to Pay page above shows 1.49% PAYG /
0.75% Pagos Plus, while the `precios` row recorded on 2026-07-30 shows 1.69% / 0.99%. Both were read
from SumUp's own es-es pages, five weeks apart. This may be a general rate cut or a page-specific
figure; confirm against the current `precios` page and the actual contract (§7 item 3) before either
number is used in a cost decision. §4's math still stands on the 2026-07-30 figures and is not
re-run here.
