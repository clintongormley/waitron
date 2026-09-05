# Registers, devices and the hardware model — decision (Track B, decision (iii))

**Date:** 2026-09-05. **Status:** owner decision, recorded (docs-only). Answers SP-A.2 follow-up 2
(the "register-identity redesign" question of 2026-09-03, `docs/backlog.md` → *Layout designer &
device profiles → SP-A.2*) and opens `docs/ui-review.md` area 19 (device management). The build
splits in two (§4); neither half changes what an immutable record's `till_id` holds, so **no new H2
receipt is needed** — the SP-A.2 §16.4 receipt stands.

## 1. The decision

**Keep two concepts, and name them by what they are.**

- **Register** (`tills` table; UI word "register" / "caja") — the cash drawer whose money is counted
  at close. It belongs to one location for life. Cash-up groups sales by it
  ([`cash-up.ts`](../../../packages/reporting/src/cash-up.ts), `group by s.till_id`), the daily close
  reports `byTill`, drawer opens and incidents point at it, and the fiscal record's `till_id` is a
  snapshot of it — informational, inert to the chain (SP-A.2 §16.4(b)).
- **Device** (`devices` table; UI word "device") — an enrolled screen: a till, a handheld, a display.
  Every sale-capable device points at one register. **Several devices ring into one register**: the
  counter tablet and a waiter's phone whose cash goes into the same drawer cash up together — the deli
  shape the owner confirmed.

Rules that follow (owner, 2026-09-05):

1. **Nobody sets up a register by hand.** Enrolling a `till`-kind device creates its register in the
   same step, named after the device, at the device's location. Today a register can only come from
   provisioning: the management API has `GET /management-api/tills` and a receipt-printer `PATCH`
   ([`print-api.ts`](../../../apps/server/src/print-api.ts)) and no create — which is why area 19 felt
   unfinished.
2. **A handheld picks a register at enrol**, defaulting to the location's only one; it may get its own.
3. **"A moved till is a new register."** A register never changes location. Re-pointing a device at
   another register is configuration, never a fiscal event.
4. **One home per hardware binding.** The drawer is a printer's drawer (the kick pulse rides the
   receipt printer's RJ11 port — deli-hardware §6, "the drawer is a printer capability"), so *which
   printer's drawer* belongs with the register; *this device sits at the drawer and may kick it*, its
   receipt printer and its card reader belong with the device (SP-A.2 §16.3). `tills.receipt_printer_id`
   and `devices.receipt_printer_id` currently both mean "receipt printer"; the build gives each column
   one meaning (a rename/drop — after the squash).
5. **A shift login keys to the device's register.** Today `POST /api/session` passes the box's env
   register (`deps.cfg.tillId`, [`till-api.ts`](../../../apps/server/src/till-api.ts)), so a handheld's
   shift names the wrong register; nothing reads `sessions.till_id` yet
   ([`sessions.ts`](../../../packages/identity/src/schema/sessions.ts)), so it is harmless today and a
   build item. SP-A.2 retired the env register from the sale path; this retires it from login.

## 2. Why not "the screen is the register"

Folding `tills` into `devices` (the enrolment *is* the register, a device id stamped on the record) is
simpler only when every screen has its own drawer. The moment a phone's cash goes into the counter
drawer, cash-up must sum across screens and "which screens share a drawer" is the register again under
another name. The fold would also touch `sales`, `registros_facturacion`, `drawer_opens`, `incidents`,
`orders`, `sessions`, provisioning and the adopt bundle (`venue-adopt.ts` carries `tills`), need a new
H2 receipt for the record's `till_id`, and wait for the migration squash — keeping area 19 blocked for
nothing the deli needs.

## 3. The hardware model this rests on

Every piece of hardware becomes known to Waitron in one of three ways.

| How it attaches | Examples | How it enrols | Who drives it |
| --- | --- | --- | --- |
| It has a browser | handheld, till, every display (KDS, expo, front-desk seating, floor, customer-facing) | pairing code → a `devices` row | itself |
| It sits on the network with no browser | network printer, cloud-polling printer (Star CloudPRNT / Epson Server Direct Print), cloud-linked card reader (SumUp Solo, Stripe internet readers) | registered in the dashboard by address or provider id | a print agent on the LAN; our server through the provider's cloud; or the printer dials us |
| It is plugged into something | USB printer, the drawer via its printer's kick port, barcode scanner, bump bar, scale, tethered card reader | belongs to its host | the host: the box or a till running the native agent (USB); a phone only with the native app (Bluetooth, Tap to Pay); keyboard-class things need nothing |

Notes the walkthrough settled (owner 2026-09-05):

- **Cash drawers have no network identity.** A standard drawer is an RJ11 cable into the receipt
  printer's drawer-kick port; the printer pulses it on the ESC/POS kick command. USB-trigger and
  network drawer boxes exist and are the exception.
- **Card terminals are classified by who drives them, not by cable:** *standalone* (no link; staff
  key the amount; Waitron records a manual card tender — works today), *cloud-linked* (own WiFi/4G;
  our server pushes the amount through the provider's cloud, linked by id — `stripe_terminal`, the
  deli's Solo), *tethered / Tap to Pay* (a provider SDK on the device — native app only; the server
  sends the same "collect X for sale Y" message to our app instead of the provider's cloud, the
  outbox-and-poll shape printing already uses). On a handheld, Tap to Pay needs the app on screen, so
  the agent and the waiter's app are one native app; on a till PC or the box the agent stays headless
  (decision (i)).
- **Printers** also come as Bluetooth (mobile printers; native only) and cloud-polling (no agent;
  works with a cloud-only server; supported models only — printing design 2026-08-17).
- **Customer-facing displays** exist without a built-in card terminal (dual-screen Android desktop
  terminals; small USB customer displays for a till PC) — product names are from memory and MUST be
  verified before any buy-list. On a dual-screen Android device only a native app can draw on the
  second screen; the browser-only route is a second tablet enrolled as a display.
- **Scanners and bump bars** act as keyboards (USB/Bluetooth HID): no enrolment, no driver. **Scales**
  are either label-printing (the till scans the label; no integration) or wired to a till (native
  agent). The **box** and its **UPS** and **label printers** round out the list.

External claims in this section are general hardware knowledge stated as design context, not receipts;
anything that reaches a purchase or a spec claim gets its provenance row there
(`2026-07-30-deli-hardware-design.md` is the buying doc).

## 4. The build, in two halves

- **Now — no migration, no fiscal change (Track 1, area 19):** a register create/rename route on the
  existing `tills` table; enrolment of a `till`-kind device creates its register; the handheld picker
  with the location default; UI wording register/device (`devices.till` → "Register"/"Caja" and its
  siblings, [`strings.ts`](../../../apps/dashboard/src/i18n/strings.ts)); shift login keyed to the
  device's register (§1 rule 5).
- **After Track A's squash:** one meaning per hardware column (§1 rule 4) and retiring
  `WAITRON_TILL_TILL_ID` from provisioning seeding if the register can be minted at first enrol instead.

Neither half changes the meaning of `sales.till_id` / `registros_facturacion.till_id`. If a later change
does, that is the H2 initiative SP-A.2 follow-up 2 described, with its own receipt.
