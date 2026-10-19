# A796 — Paying at the table from a handheld (payments slice 2)

Status: **design decided; no owner questions open (§9). Nothing is built; the build is to be
planned as its own item.**

Revision 4, 2026-10-19: the owner answered Revision 3's six questions (relayed by the campaign
watcher, about 12:10–12:22):
1. Where the reader's name shows: "(a)" — on the folded row and on the charge button (§3, step 3).
2. A phone that has never chosen a reader: "(b)" — the row opens by itself with the reader empty and
   Continuar greyed out, except that when the profile lists exactly one reader it is picked
   automatically (§3, default 18).
3. The last reader can no longer be charged: "(a)" — the row opens, reader empty, Continuar greyed
   out, with a reason line where the phone knows one (default 19).
4. The last receipt printer can no longer print: "(a)" — the row opens with the printer empty and a
   warning, the payment still goes ahead and the paid screen says no ticket printed; a printer
   deleted or taken off the profile's list falls back to the profile's default, shown labelled
   (default 19).
5. The form's printer: "(a) ONE setting" — it is the phone's Equipment receipt printer, which an NFC
   tap or a QR scan also changes; no separate receipt memory and no new storage. A790 follows this
   (default 12).
6. Picking a reader another phone holds: "(a)" — keep "¿Quitar Lector 1 a Móvil 2 (Marc)?" for a
   pick from the list; a sticker scan or NFC tap takes it at once, as today (default 5).

And two additions in the owner's words: "we're missing the button to scan a qr code to associate a
card reader or printer, and we should have a function running in the background to update the
appropriate device when an NFC scan happens", and "The qr button should be visible without opening
the device section". These are §3's "Scanning or tapping a sticker" and default 20; the NFC
permission ask, a small NFC button on the folded row, is default 21. New picture 12. A review and a
claim check the same day added defaults for what the answers left open — a reader lost within one
session (18, 19), no receipt printer at all (19), the paid screen's ticket line (12) and saves that
are sending or refused (22) — and corrected several readings of today's code (§2.1).

Revision 3, 2026-10-19: the owner answered Revision 2's one question — don't ask which reader is in
the waiter's hand; put a card reader drop-down and a receipt printer drop-down in the payment form,
each with the last one used selected, folded away until the waiter wants to change one (§8, default
4). Revision 2 turned four of the first revision's five questions into defaults citing earlier owner
decisions.

Backlog entry: `docs/backlog.md`, "Slice 2 — the handheld NFC/QR link" (under _Payments and card readers_),
detail in [payments.md](../../backlog/payments.md#slice-2--the-handheld-nfcqr-link). Pictures:
[`docs/backlog/mockups/a796-handheld-payments/`](../../backlog/mockups/a796-handheld-payments/),
drawn in HTML with the apps' colour and spacing tokens, not screenshots; each is labelled "today" or
"proposed — drawn". The generator is kept outside the repository.

File references are to `main` at `d175118ed`; the files Revision 3 adds citations from are unchanged
at `4ce4a56c2` (`git diff --stat d175118ed 4ce4a56c2 --` over them prints nothing). Revision 4's new
citations were read at `d63b2e448`; the till, payments, layouts and server equipment files they
point at are unchanged since `d175118ed` (`git diff --stat d175118ed d63b2e448 --` over
`apps/till/src/till-app.ts`, `apps/till/src/widgets/equipment-dialog.ts`,
`apps/till/src/widgets/equipment-scanner.ts`, `apps/till/src/state`, `apps/till/src/i18n`,
`apps/till/src/till-app.nfc.test.ts`, `packages/payments`, `packages/layouts`,
`apps/server/src/device-equipment.ts`, `apps/server/src/device-api.ts` and
`packages/db/src/schema/printers.ts` prints nothing). **(read)** marks
a conclusion from reading code, not from running it. Every statement about today's code is (read)
except where §2.1 or §3 states a run: one server test, run for this revision, and two browser
checks and one database check that the campaign's claim check ran on 2026-10-19. Part of the reading was done by search helpers; the citations this design leans on were
re-read line by line before being written here.

**Words.**
- A **handheld** is a waiter's phone running the till app. Its device **profile** is the list of
  things the venue lets that kind of device do (take orders, take cash, use the card reader…).
- A **card reader** (Spanish _datáfono_ or _lector_) is the card machine Waitron drives over the
  internet, such as a SumUp Solo. A card **typed on another machine** is one taken on a terminal
  Waitron does not talk to, recorded by hand ("hand-keyed").
- A phone **holds** a reader when the server has it down as that phone's reader. Only one device
  holds a reader at a time.
- A phone's **choice** of reader or receipt printer is what the server has stored as that phone's
  own pick, as opposed to its profile's default.
- A **bill** is what one group pays and gets one simplified invoice for. An **open** bill is still
  being ordered on; a **presented** bill (status `placed`) has been placed and waits to be
  collected. A **bill payment** is one of several payments taken against an open bill before it is
  fully paid (the bill payments design of 2026-09-26).
- A **submission id** is a random id the phone attaches to a payment request, so that sending the
  same request twice is recognised as one payment.

---

## 1. Summary

The owner decided on 2026-09-18 that a waiter carries a card reader to the table and settles the
bill there from the handheld. **Most of the machinery already exists**: a phone can pick up a reader
by NFC sticker, QR sticker or list, an open bill can be paid in shares on the reader the phone
holds, a repeated request is not charged twice, and a reader cannot be taken while it is charging.
What is missing is the path a waiter walks: the ready-made handheld profile cannot use a reader,
take cash or print; a whole bill on the table screen can only take a typed card; the payment dialog
never names the reader and cannot change it or the receipt printer; an uncertain card never
refreshes; and a live defect lets a second guest's identical payment be answered with the first
guest's (§2.3). This design fills those gaps with no database change. Following the owner's answer
of 2026-10-19, the payment form carries the phone's card reader and receipt printer, each already
set to the one this phone last chose, in a row that stays folded until the waiter opens it; nothing
asks the waiter to confirm either. Those two drop-downs are the phone's existing equipment choices,
so changing one is today's pick-up, under today's takeover rules. The folded row and the charge
button name the reader. A QR button on the folded row scans a reader's or a printer's sticker
without opening the row, and the till's existing NFC listener keeps working while the form is open,
so a tapped sticker changes the form at once. A phone with no usable reader sees the row open with
the reader empty; a printer that has gone never holds up a payment.

## 2. What works today

### 2.1 Picking up a reader (W100 #1332, W102)

- **One holder per reader.** The holder is a row in `card_reader_holders`, keyed on the reader
  (`packages/payments/drizzle/0006_device_reader_equipment.sql:1-7`). A device can pick only a
  reader on its profile's list that is switched on and paired
  (`packages/payments/src/device-readers.ts:288-301`); the list and its optional default are set on
  the dashboard's Device profiles page (`setProfileReaderList`, `device-readers.ts:63`, called from
  `apps/dashboard/src/screens/device-profiles-screen.ts:1471`).
- **Three ways in**, through the Equipment dialog (`apps/till/src/widgets/equipment-dialog.ts`): a
  list, a QR camera decoded with `jsqr` (`equipment-scanner.ts:3`), and Web NFC
  (`equipment-dialog.ts:33-35`). Once NFC is allowed, a tap on a sticker picks the reader up from
  any screen while the dialog is closed (`apps/till/src/state/equipment-nfc.ts:35-42`;
  `till-app.ts:2567-2612`) and shows "Has recogido {item}" (`till-app.ts:8211-8216`).
- **The till-wide NFC listener, read closely.** `EquipmentNfc`
  (`apps/till/src/state/equipment-nfc.ts`) scans only while the browser's NFC permission reads
  "granted", and stops when it changes away (`:34-45`). While the permission is still unanswered
  ("prompt") it only listens for the permission to change and never calls `scan()`, so it never
  asks for the permission itself. `#syncEquipmentNfc` (`till-app.ts:2584-2588`) runs it while the
  till is on the page, the Equipment dialog is closed (`equipmentOpen`) and the page is visible,
  and stops it otherwise. It is re-checked on attaching (`:1758`), on a visibility change
  (`:1708-1711`) and when `equipmentOpen` changes (`:2895`), and stopped on detaching (`:1768`);
  nothing else starts or stops it (`grep -n "syncEquipmentNfc\|#equipmentNfc"
  apps/till/src/till-app.ts`). A tap with nobody signed in is kept until sign-in (`:2572`, applied
  at `:4013-4018`). Otherwise `#pickUpNfc` (`:2590-2613`) checks the item is offered for the
  card-reader role, or for a printer for either the receipt or the payment-slip role
  (`:2591-2597`), and sends `PUT /api/device/equipment` with the sticker's kind and `via: "scan"`,
  through the one-at-a-time equipment queue (`#equipmentQueue`, `:2564`, `:8164-8165`).
- **What the server does with a sticker.** A reader's sticker makes it the card reader. A printer's
  sticker is set for each of the printer's **pick-up roles** (`selectDeviceEquipment`,
  `apps/server/src/device-equipment.ts:343-387`), which are receipts and payment slips unless a
  manager changed them (`packages/db/src/schema/printers.ts:60-62`) — but only when the device's
  profile offers that printer for every one of those roles. Otherwise the whole pick-up is refused
  with `device.binding_invalid` and nothing changes: test "takes both roles from the prior holder,
  and rolls back both devices on a later role refusal" (`apps/server/src/device-equipment.test.ts:885`),
  run 2026-10-19 with `pnpm exec vitest run src/device-equipment.test.ts -t "takes both roles from
  the prior holder"` in `apps/server`: 1 passed. The till's own check above passes in that case,
  so the refusal comes from the server. A printer whose pick-up set is empty changes nothing, but
  only if it is switched on, at the device's location and on the profile's receipt or payment-slip
  list; otherwise it too is refused with `device.binding_invalid` (`:365-381`; test "an empty
  pick-up set leaves choices alone but still refuses a disabled printer",
  `device-equipment.test.ts:926`).
- **How an open payment dialog learns of a tap.** The answer replaces the till's `deviceEquipment`
  (`till-app.ts:8194-8199`) unless an equipment read came back while the choice was out, in which
  case the till reads the equipment again (`#rereadIfStale`); the 15-second read replaces it too
  (`#holdEquipment`, `:7942-7946`). The bill payment dialog takes its reader settings from that
  state (`.cardReader`, `.readers`, `.defaultReaderId`, `:8339-8342`; `#payReaders`, `:7956-7960`).
  The campaign's claim check ran this on 2026-10-19 in headless Chromium: a throwaway test opened
  `till-bill-pay-dialog`, tapped a reader sticker, and the same element's `.readers`, `.cardReader`
  and `.defaultReaderId` all updated; the listener was not stopped, and a second tap sent a second
  request. So today's payment dialog neither stops the listener nor misses a tap. But today the
  dialog names no reader when the phone has one: it draws a reader choice only for two or more
  (`bill-pay-dialog.ts:1304`). And a card charge carries a reader id only when one was picked in
  that choice (`#readerEntry`, `bill-pay-dialog.ts:731-737`); with none, the server charges the
  phone's choice, else its profile's default (`resolvePayReader`, `till-api.ts:330-334`). The
  named reader on the folded row and the charge button, and the request naming it, are new.
- **Where a tap's notice shows.** It is a `wt-toast` (`till-app.ts:13349-13357`). A `wt-dialog`
  opens with `showModal()` (`packages/ui/src/components/wt-dialog.ts:287`, `:314`), and `wt-toast`
  uses neither `showModal` nor a popover (`grep -n "popover\|showModal"
  packages/ui/src/components/wt-toast.ts`, no hits). The claim check ran it on 2026-10-19 in headless
  Chromium: with the bill payment dialog open, a hit test at the notice's centre landed on
  `TILL-BILL-PAY-DIALOG`; with the dialog closed, on `WT-TOAST`. So the notice sits beneath an open
  dialog and cannot be pressed; whether it can still be seen through the backdrop was not checked.
- **Tests today.** "NFC throughout the till" (`apps/till/src/till-app.nfc.test.ts:40`) has the
  dialog owning NFC while open (`:645`), backgrounding (`:679`) and the schedule screen (`:744`);
  no case opens a payment dialog (`grep -c -i "bill-pay\|billPay\|till-bill"` on that file prints 0).
- **Where NFC permission is asked today: only in Equipment.** Its **Permitir NFC** (`:310`;
  `strings.ts:2296`) is drawn by `#renderNfc()` (`equipment-dialog.ts:303-311`), which the dialog
  draws below its rows whatever view is showing (`:547`). So it shows on Equipment's main view
  while the permission is "prompt" and the QR camera is closed; test "granting NFC in the dialog
  ends with one live reader and one selection per tap" (`till-app.nfc.test.ts:279`) presses it
  without pressing Escanear first. Pressing it calls `scan()` from that click (`#startNfc`,
  `:191-237`), the moment the browser asks. `git grep -n nfc_allow -- apps/till/src ':!*.test.ts'`
  finds only that button and its two strings.
- **The QR camera reads one kind of sticker.** `till-equipment-scanner`
  (`apps/till/src/widgets/equipment-scanner.ts`) is given a `kind` (`:46`) and, on a sticker of the
  other kind, says "Esa etiqueta no es de una impresora" or "… de un lector de tarjetas" and keeps
  filming (`:121-125`). Equipment's Escanear código QR shows wherever the browser has a camera API
  (`canScan`, `equipment-dialog.ts:64-66`, used at `:466`), and Equipment sends what the camera
  reads as a pick for that row's role with `via: "scan"` (`:450-460`).
- **Taking a reader another phone holds.** A scan takes it at once; a list pick asks "¿Quitar
  {item} a {device} ({person})?" first (`packages/shared/src/equipment-takeover.ts:8-9`;
  `equipment-dialog.ts:379-381`). A reader with another device's payment running cannot be taken
  (`device-readers.ts:302-304`, `reader.payment_in_progress`). The phone that lost it learns on its
  next equipment read, every 15 seconds while someone is signed in
  (`apps/till/src/state/equipment-poll.ts:4`; `till-app.ts:7944`).
- **The server already picks a reader silently in two places.** When a device joins, comes back or
  moves profile, `settleDevice` (`apps/server/src/device-equipment.ts:72-81`) takes the device's
  chosen reader, or on "Use default" the profile's default reader, if it is free
  (`settleDeviceReader`, `device-readers.ts:345-383`). And when a payment request names no reader,
  the server charges the chosen-or-default reader (`resolvePayReader`,
  `apps/server/src/till-api.ts:329-334`). A device cannot opt out of its profile's default (W100's
  Q1, kept by the owner on 2026-10-07; `docs/backlog/till.md`).
- **What the server remembers.** The phone's explicit choice (`device_card_readers`) outlives the
  holding: disabling the device releases the reader but keeps the choice (`device-delete.ts:183`),
  and re-enabling takes it back if free, and otherwise puts the device on Use default
  (`apps/server/src/device.ts:117-119`; `settleDeviceReader`); deleting the device clears it
  (`device-delete.ts:205`). A takeover clears the losing phone's choice
  (`device-readers.ts:319-328`), and a profile move lets go of a reader the new profile does not list
  (`settleDevice`). No record of the last reader a phone _held_ survives a takeover
  (`git grep -n -i "lastReader\|last_reader\|recentReader" -- apps packages`, no hits). The
  `payments` rows keep the reader each payment was charged on (`payments.reader_id`,
  `packages/payments/src/schema/payments.ts:60`, written at `packages/payments/src/store.ts:93`),
  which is not the same as the last one picked up.
- **What else forgets or keeps a choice.** A device has at most one reader choice: the row is keyed
  on the device (`device-readers.ts:330-333`). Switching a reader off on the dashboard changes only
  the reader's own row (`apps/server/src/payments-api.ts:535-541`), so phones keep choosing and
  holding it but pay on nothing, because the till pays only on an available reader
  (`payReaderOf`, `till-app.ts:402-406`). Deleting a reader clears every device's choice and hold of
  it (`apps/server/src/card-reader-delete.ts:277-279`). A phone that loses its reader to another
  already shows "{device} ({person}) se ha llevado {item}" (`takenFrom`, `till-app.ts:409-424`;
  `apps/till/src/i18n/strings.ts:2315`), worked out by comparing two equipment reads held in memory.
- **Choosing is one route for every kind of equipment.** `PUT /api/device/equipment`
  (`apps/server/src/device-api.ts:380-397`) takes a role — `card_terminal`, `receipt` and three
  others (`:896-902`) — a selection, and whether it came from a scan or a list
  (`parseEquipmentChoice`, `:905`). A list pick of a reader another device holds is refused unless
  the person confirmed taking it (`mayTakeOver`, `packages/shared/src/equipment-takeover.ts:8-10`;
  `device-readers.ts:305-311`); a reader with another device's payment running is refused outright
  (`:302-304`), and the Equipment dialog sends that pick without asking and shows the refusal
  (`equipment-dialog.ts:377-383`). To charge a reader the phone must hold it: the payment's start
  refuses `reader.not_held` otherwise (`assertReaderStartable`, `packages/payments/src/store.ts:129-141`).
- **Not shown:** whether a reader is reachable, or its battery; the battery only raises a dashboard
  alert (`apps/server/src/alert-sources.ts:706-717`).

### 2.2 Paying a table's bill on the phone

- **Floor → table → Cuenta.** A handheld has two screens, Floor and Order
  (`apps/till/src/built-in-screens.ts:7`). The table's bill is in the "Cuenta" panel; its pay
  section shows whenever the bill still owes (`apps/till/src/screens/till-table-order-screen.ts:3448`).
- **The whole bill can only take a typed card, on any device.** The whole-bill widget is
  `till-tender-pay` with no card provider (`till-table-order-screen.ts:3471-3478`; no `cardProvider`
  anywhere in that file), whose default is `"none"` (`apps/till/src/widgets/tender-pay.ts:266`), so
  its card button opens the typed-card form (`tender-pay.ts:592-594`). It sends an open bill to
  `POST /api/sales` and a presented one to `collectOrder` (`till-app.ts:11866-11905`).
- **The reader is reachable only through the part-payment buttons** — Pagar artículos, Aportar una
  cantidad, Dividir a partes iguales (`till-table-order-screen.ts:3545-3556`) — or "pay the rest"
  once part is paid (`:3494`). Their dialog, "Cobrar parte de la cuenta"
  (`apps/till/src/widgets/bill-pay-dialog.ts`; picture 1), offers cash only where the profile takes
  cash (`till-app.ts:8445-8446`) and card. Card goes to the reader the phone holds: the dialog is
  handed only that reader (`till-app.ts:403-406`, `:7956-7960`) and shows a reader choice only with
  two or more (`bill-pay-dialog.ts:1304`), so **it never names the reader it will ask**. With no
  reader held, or a profile without the reader action, "Tarjeta" silently becomes the typed-card
  form (`till-app.ts:8449-8451`; `bill-pay-dialog.ts:1259`).
- **A presented bill takes no bill payments**: they refuse any bill that is not open
  (`requireOpenBill`, `apps/server/src/bill-payments.ts:918-931`, called at `:1061`,
  `working_order.not_open`). Presented bills do reach tables: merging parties and moving a bill
  carry them (`apps/server/src/table-actions.ts:214-218`, `apps/server/src/move-bill.ts:350-353`).
- **While the card is at the reader** the dialog shows one muted line, "Acerca o inserta la
  tarjeta…", disables its buttons and cannot be closed; it has no Cancel (`bill-pay-dialog.ts:818`,
  `:1518-1521`). A decline stays on the confirmation with today's wording (`till-app.ts:12163-12169`).
- **After a payment** that leaves money owing, the dialog stays open, says "Pago cobrado." and
  resets its form (`till-app.ts:12182-12194`). The payment that completes the bill issues the
  invoice, closes the dialog and shows the full ticket view (`till-app.ts:12173-12176`).
- **Several guests at once.** A card at the reader reserves its amount; cash, or a second card on
  another reader, may be taken against what is left (`apps/server/src/working-order.ts:4842-4843`).
- **The table does not close by itself** (`bill-payments.ts:749-754` settles the bill only); "Cerrar
  mesa" frees it (`till-table-order-screen.ts:3648`; `POST /api/parties/:id/finish`,
  `apps/server/src/parties.ts:677-687`).

### 2.3 Double charges, drops, and a live defect

- **The server, not the phone, drives the reader.** The payment is written as pending first, then
  the provider is called with no transaction open, then settled (`bill-payments.ts:1308-1317`,
  `:1358`). A phone that loses Wi-Fi does not stop a card already at the reader.
- **A repeated request is answered, not charged again.** The phone resends an unanswered payment
  (twice, 500 ms apart, within a 150-second limit: `apps/till/src/state/draft-sync.ts:78`,
  `:110-131`) under the same submission id (`apps/till/src/state/bill-payment.ts:128-150`;
  `till-app.ts:12120`). The server finds the earlier payment by that id and returns its state
  without calling the provider (`bill-payments.ts:1049-1056`, `:1343-1353`); Stripe also gets one
  idempotency key per bill payment (`packages/payments-stripe/src/provider.ts:167-168`). A526 (#1579,
  `c7200b024`) added the matching check for presented orders (`refusePlacedPaymentInFlight`,
  `apps/server/src/till-sale.ts:1392`).
- **Live defect (read, not run): the next identical bill payment can be answered with the
  unanswered one.** After a bill payment gets no answer, the till keeps its submission id keyed on
  the bill and the confirmed request (`submissionFor`, `bill-payment.ts:144-150`, key
  `JSON.stringify([billId, confirmation])` at `:149`). The confirmation carries only the request —
  the way paid, the amount or lines, the method, the reader, what is applied and the tip — nothing
  that names the guest. The kept submission changes only when a send ends (`unansweredAfter`,
  `:173-177`; set at `till-app.ts:12130`, the one write besides its declaration at `:2640`): closing
  the dialog, going back, reopening it or logging out keep it. So the next identical payment on that
  bill from this phone reuses the id: a contribution of the same amount, the same units of the same
  line, or the same cash handed over, by any method. The server replays the first payment
  (`beginBillPayment`, `bill-payments.ts:1050-1055`): the second guest's payment is never recorded (a card is never asked), and
  the dialog shows the first payment's state — "Pago cobrado" once it was charged, "El pago con
  tarjeta sigue en curso…" while it is pending. An equal share escapes only when the number of people
  left is lowered, because that number is part of the request (`bill-pay-dialog.ts:711-712`). Fixed
  here by default 7; logged in the backlog as its own entry, because it is live today.
- **That id lives only in the page's memory** (`till-app.ts:2640`). An app-driven reload waits for
  it (`till-app.ts:1410-1422`); a phone that kills the browser loses it.
- **A reader that stops answering.** SumUp's reader, the deli's, is polled up to 120 times, a second
  apart, each poll a request to SumUp (`packages/payments-sumup/src/provider.ts:34-38`, `:266-276`;
  Stripe's 60, `payments-stripe/src/provider.ts:65-66`); the phone stops waiting after 150 seconds
  (`TABLE_REQUEST_LIMIT_MS`, `apps/till/src/state/draft-sync.ts:78`), which can come first. An unanswered payment stays pending, its amount reserved;
  the bill payment loop re-checks pending payments every minute and files the ones the provider
  reports charged (`apps/server/src/bill-payments-loop.ts:95-145`; `BILL_PENDING_RECHECK_MS`,
  `apps/server/src/boot.ts:498`; A764, #1818, for Stripe). The phone shows "El pago con tarjeta
  sigue en curso…" (`bill_pay.card_pending`) and **never re-reads by itself**: only on opening the
  dialog, after an answer, after a refusal or after a refund (`till-app.ts:12053`, `:12194`,
  `:12233`, `:12426`).
- **A reader taken mid-payment.** For a bill payment the holder is checked twice: in
  `resolvePayReader`'s own transaction before anything is written (`till-api.ts:346`), and again in
  `insertAttempting` (`packages/payments/src/store.ts:163`) after the pending bill payment row has
  committed. A refusal there (`reader.not_held`, `reader.payment_in_progress`) fails that pending row
  (`REFUSED_START`, `bill-payments.ts:1302-1306`): nothing is charged. The busy check skips the
  phone's own payments (`device-readers.ts:97-112`), so one phone could start a second charge on its
  own reader. That is the default W100 (the work that built reader holding, #1332) took on its
  sixth question — the server stops other phones, not the holding phone starting two — and the
  owner kept it on 2026-10-07.

### 2.4 Receipts, cash and the drawer

- **The receipt prints on the receipt printer of the device whose request issued the invoice**:
  for a bill payment, the phone that took the payment completing the bill
  (`bill-payments.ts:1259-1260`); for an adjustment or a bill split that leaves the bill fully
  paid, the device that made that request (`adjustments-api.ts:156`, `till-api.ts:3589`, `:3700`,
  each under `requestCfg`, `apps/server/src/request-config.ts:6-8`). It prints automatically where the bill's zone, or else its department, prints
  receipts automatically (`apps/server/src/receipt-print.ts:274-278`; `zoneReceiptMode ??
  departmentReceiptMode`, `packages/venue-service/src/operations.ts:614`). A presented bill whose
  invoice was already issued prints nothing on payment, on either path: only issuing an invoice
  queues a receipt (`enqueueSaleReceipt` at `till-sale.ts:1023`, `:1633`, `:1798`; none in
  `finalizeSettle` or collect's settle branch). That printer is the phone's own choice or
  its profile's default, or a portable printer it holds; **with none, nothing prints**, and
  provisioning seeds no printer (`git grep -n -i printer -- packages/provisioning/src ':!*.test.ts'`,
  no hits). The automatic print checks no profile action; `print-receipt` gates only explicit
  prints, reprints and deliveries (`grep -n '"print-receipt"' apps/server/src/*.ts`). A reprint
  prints on the requesting device's printer and needs that device's `print-receipt`, a receipt
  printer, and the person's zones (`POST /api/transactions/:saleId/reprint`,
  `apps/server/src/transaction-receipt-api.ts:43-68`). The till has no "nothing printed" message
  today.
- **How the receipt printer is chosen.** A device's receipt printer is its stored choice (column
  `receiptPrinterId`, `packages/layouts/src/device-equipment.ts:18`), else its profile's default
  (`roleState`, `:285`); the reprint uses the same resolution (`resolveReceiptPrinter`,
  `receipt-print.ts:81-86`, called at `:320`). A choice must be on the profile's receipt list, at the
  device's location, and switched on (`selectDevicePrinter`, `device-equipment.ts:385-412`); a
  portable printer is held like a reader, with the same takeover rule (`:414-421`). A chosen printer
  that is later switched off prints nothing and does not fall back to the default: the role still
  points at it as the printer to use (`:285`) and the printer read keeps only switched-on printers
  (`receipt-print.ts:149`). The drawer is a separate role, never the receipt printer
  (`resolveDrawerPrinter`, `:88-97`).
- **No digital receipt for a simplified invoice.** Email exists only for full invoices
  (`apps/server/src/invoice-delivery-actions.ts:136`).
- **A card on a connected reader never opens the drawer** (`takeReaderBillPayment`,
  `bill-payments.ts:1322-1409`, queues none; test `apps/server/src/bill-payments-api.test.ts:4987`).
  Cash opens one only when the device's profile allows it and the printer has a drawer
  (`receipt-print.ts:66-74`; `docs/developers/conventions-ui.md`, "A device opens the drawer when its
  profile allows it").

### 2.5 The ready-made handheld profile

"Móvil" allows taking orders, typed cards, preparing, handing over and clocking in — **not** the card
reader, cash or printing (`packages/layouts/src/device-profile.ts:110-116`, `:145-148`). That list
came from W97's seed change (#1311, `7873b97e2`), whose message says the handheld "goes from no flags
to the four new actions, because a handheld took orders, keyed cards, prepared and handed over
without any flag" — a mechanical carry-over, not an owner choice on payments.

## 3. The flow

Worked example throughout: **Mesa 4, three guests, 62,40 €**, split equally (20,80 € each). Ana's
phone last chose Lector 2 and the Barra receipt printer.

1. **From the floor to the bill.** Ana opens Mesa 4 and presses Pay (A797's handheld order view, or
   today's Cuenta panel). Pay opens the payment sheet.
2. **Choose how it is paid** (picture 2, left). For an open bill: **Toda la cuenta** (new:
   everything left, in one payment, through the bill payment path), Pagar artículos, Aportar una
   cantidad, Dividir a partes iguales. For a presented bill: the whole amount only (picture 11;
   default 1). Then the method: **Tarjeta**, **Efectivo**, and **Otro datáfono** (today's typed card,
   chosen on purpose; default 3).
3. **The reader and the printer are already set, and folded away** (picture 2). One closed row,
   "Lector e impresora — Lector 2 · ticket en Barra — 📷 QR — Cambiar", shows what this phone last
   chose (default 6). Nothing asks Ana to confirm either. The row names the reader and the printer,
   and the charge button names the reader (owner, 2026-10-19); both are new, since today's dialog
   names no reader when the phone has one (§2.1). Where the printer is the profile's default rather
   than the phone's own choice, the row says so beside it: "ticket en Barra (predeterminada)" (a new
   string). Where the profile lists no receipt printer at all, it reads "sin ticket" (default 19).
   **📷 QR** opens the camera without opening the row; while the phone's NFC permission is still
   unanswered, a small **NFC** button sits beside it (below).
4. **Changing one** (picture 3). Cambiar opens the row in place: a **Lector de tarjetas** drop-down
   and an **Impresora de tickets** drop-down, with 📷 QR (and NFC, while unanswered) kept in the
   row's heading. The two drop-downs are the phone's Equipment settings for the card reader and the
   receipt printer — one setting each, not a copy (owner, 2026-10-19; default 12). The reader field
   is marked required while Tarjeta is the method, and Continuar is greyed out for an empty reader
   only then; cash and Otro datáfono never need it. The reader list is today's Equipment list with
   today's words ("Lector 1, lo lleva Móvil 2", "Lector 3, ocupado"), and picking a reader picks it
   up at once, as Equipment does today. Picking one another phone holds asks today's "¿Quitar
   Lector 1 a Móvil 2 (Marc)?" — the one question left in the form, asked only when taking a reader
   from someone else from the list (default 5, kept by the owner on 2026-10-19). The printer list is
   the profile's receipt printers at this location. A portable receipt printer another phone holds
   is listed and asked for the same way, "Impresora 2, lo lleva Móvil 2" then "¿Quitar …?", because
   a portable printer is held like a reader under the same takeover rule (§2.4). Neither list offers
   Equipment's "Usar el predeterminado: {name}" (`apps/till/src/i18n/strings.ts:2286`), and neither
   offers a "Ninguno" entry. Equipment has no separate one either: its list is Use default — which
   reads "Usar el predeterminado: Ninguno" when the profile has no default
   (`equipment-dialog.ts:390-392`, `strings.ts:2285-2286`) — the offered choices, and a current
   choice no longer offered (`:393-404`). Use default stays in Equipment. For a receipt printer it
   means "whatever the profile's default is", which is worked out afresh at every read
   (`packages/layouts/src/device-equipment.ts:279-285`). For a reader it is narrower: the phone
   takes the default only when it joins, comes back, moves profile or picks Use default, and a
   later edit of the profile's list takes nothing for it (`settleProfileReaderDevices`,
   `device-readers.ts:410-454`). Where the phone is on Use default, the field shows the reader or
   printer the phone would use now, marked with today's "Predeterminado del perfil"
   (`strings.ts:2287`). A save that is still being sent, or is refused, follows default 22. The row
   is closed again the next time the sheet opens.
5. **Tip.** Unchanged: where tips are on, the card form has "Propina con tarjeta (opcional)" and
   cash offers "Dejar de propina". Everything else about tips is A793's design (not approved; back
   to brainstorm, [2026-10-18-a793-tips-design.md](2026-10-18-a793-tips-design.md)). This design
   keeps only the seam: the till asks for the tip before the card is charged.
6. **Today's confirmation step** (picture 2, right): the amounts and the charge button. There is
   no separate step to confirm the reader. The button reads "Cobrar 20,80 € en Lector 2", and the
   request carries the id of the reader the button names when it is pressed, so the server never
   falls back to a chosen-or-default reader (default 16).
7. **The card at the table** (picture 6, left). Ana hands the reader to the guest. The sheet shows
   "Acerca o inserta la tarjeta…", the amount and the reader in large type, and how long it has been
   waiting. A decline keeps today's words and offers "Reintentar en Lector 2" (picture 6, right),
   naming the phone's reader at that moment: if a tap changed it meanwhile, the retry names and
   charges the new one.
8. **Cash**: today's cash step. Móvil as seeded opens no drawer: it has no "open-cash-drawer"
   (default 15).
9. **The next guest** (picture 8, left): "Cobrar al siguiente (2 de 3)" keeps the split and lowers
   the count (default 10). The reader and printer stay as they were.
10. **The table paid** (picture 8, right). The payment that completes the bill issues the invoice,
    as today, and its receipt goes to the receipt printer the phone that took that payment has at
    the moment the payment settles (§2.4, default 12). On a handheld a short paid screen replaces
    today's full ticket view (picture 9): the payments, whether a receipt was sent to a printer
    (default 12), and **Cerrar mesa**, which the waiter presses as the guests leave — paying never frees the table
    by itself (default 11). Once A758's not-served check is built, Cerrar mesa opens
    it first.

**First payment on a phone, and a reader or printer that has gone** (pictures 4 and 5; owner,
2026-10-19; defaults 18 and 19). When this phone has no reader it can charge, the row opens by
itself with the reader field empty and, while Tarjeta is the method, Continuar greyed out until a
reader is picked, scanned or tapped, saying why in one line where the phone knows. The exception:
when the phone has had no reader as far as it can know, and the profile offers exactly one reader
that no other phone holds or is charging on, it picks that reader up as the form opens and the row
stays closed. A chosen printer that was switched off opens the row with the printer empty and a
warning, but holds nothing up. One deleted or taken off the profile's list has been forgotten by
the server, so the phone uses the profile's default, labelled; where the profile has no default
either, the row opens with the printer empty and the same kind of warning.

**Scanning or tapping a sticker while the sheet is open** (picture 12; owner, 2026-10-19;
default 20).
- **📷 QR** sits on the folded row beside Cambiar, and in the opened row's heading, wherever the
  browser has a camera API (`canScan`, as Equipment's Escanear código QR, `equipment-dialog.ts:466`).
  It opens today's QR camera, `till-equipment-scanner`, inside the sheet, with Volver to go back.
  New: in this use the camera accepts either kind of sticker — today it reads only the kind it is
  given (§2.1) — so one button serves both. What it reads is sent exactly as an NFC tap is:
  `PUT /api/device/equipment` with the sticker's kind and `via: "scan"`. A reader's sticker makes
  it this phone's card reader at once, taking it from another phone without asking, as a scan does
  today (default 5). A printer's sticker sets each of the printer's pick-up roles — the receipt
  printer and the payment-slip printer unless a manager changed them — when the profile offers the
  printer for all of them, and is refused otherwise (§2.1, §4). So a sticker means the same thing
  scanned in the sheet as tapped anywhere. The camera closes and the sheet returns to where it was,
  showing the change.
- **NFC keeps working while the sheet is open.** Today's payment dialog does not stop the
  till-wide listener (§2.1, run by the claim check), and the sheet must keep it so: it never sets
  `equipmentOpen` or stops the listener. A tap picks the reader or printer up as on any other
  screen.
- **The sheet learns of a change by reading the same equipment.** The folded row, the two
  drop-downs and the charge button all read the till's `deviceEquipment`, as today's dialog's reader
  settings do (§2.1), so whatever replaces it — a tap's or a scan's answer, or the re-read after
  one — redraws the sheet at once. While the sheet is open, the tap's or scan's notice — today's
  "Has recogido {item}" or its refusal — shows as one line inside the sheet, above the folded row,
  because today's toast sits beneath an open dialog (§2.1).
- **On the confirmation step** a tap changes the button's reader, and Cobrar then charges the
  reader the button names. Once the card has been asked for, the sheet's controls are disabled (§4),
  but a tap is still picked up, as on any screen, and the next payment uses the new reader. The
  server checks that the phone holds the reader only when a payment starts (`assertReaderStartable`,
  `packages/payments/src/store.ts:134-136`, called from `resolvePayReader` at
  `apps/server/src/till-api.ts:346` and from `insertAttempting` at `store.ts:163`), and picking
  another reader lets go of the old one without looking for this phone's own payment on it
  (`settleDeviceReader`, `packages/payments/src/device-readers.ts:376-382`). While that payment
  runs, no other phone can take the old reader, because the busy check counts it
  (`readerPaymentInProgress`, `:97-112`). The claim check ran this as a database test in
  `packages/payments` on 2026-10-19: phone A held r1 with a payment started on it and scanned r2,
  which succeeded, released r1 and left A holding r2; phone B then scanned r1 and was refused as
  busy. What a running card does if its phone lets go of its
  reader was not checked; the waiting view keeps naming the reader the payment was sent to
  (picture 6).
- **Asking for NFC permission** (default 21). Where the browser has Web NFC and the permission is
  still unanswered ("prompt"), a small **NFC** button sits beside 📷 QR on the folded row and in
  the opened row's heading, so it is seen without opening anything. Pressing it makes the browser
  ask; once granted, the till-wide listener scans on every screen from then on (§2.1), and the
  sheet's line shows today's "Acerca el teléfono a la pegatina NFC del equipo."
  (`equipment.nfc_hint`, `strings.ts:2297`). It is not shown on a browser without Web NFC (an
  iPhone), once granted, or once refused.

## 4. Edge cases

- **Two waiters want the same reader.** Today's rules stay (default 5). If Marc's phone, Móvil 2,
  scanned Lector 2 after Ana's phone last held it, Lector 2 is now Marc's and Ana's phone no longer
  has a reader. Her phone learns this on its next equipment read: today every 15 seconds while
  someone is signed in (`apps/till/src/state/equipment-poll.ts:4`), and, proposed, whenever the
  sheet opens. From then on her form opens the row with the reader empty (picture 5, left; default
  19) rather than showing a reader she cannot charge. A Cobrar sent before her phone learns it is
  refused by the server before anything is charged (§2.3), and today's words
  "Elige un lector en Equipo" (`apps/till/src/i18n/codes.ts:699`) change to point at the form's own
  reader drop-down.
- **Marc walks off with Lector 2 without scanning it.** The server still has Lector 2 as Ana's, so
  her phone charges it, and 20,80 € appears on the reader at Marc's table. This is the case the
  2026-09-18 rule ("never selected silently") was there to stop. Under the owner's answer of
  2026-10-19 nothing asks; what is left to catch it is the reader's name on the folded row and the
  charge button, read against the label on the reader in her hand.
- **The reader goes offline mid-payment** (picture 7, left). The 20,80 € stays reserved and the
  other guests can still pay. New: the sheet says "Aún no sabemos si se ha cobrado. No cobres a este
  cliente de otra forma todavía", and re-reads the bill every 5 seconds while a payment it shows is
  pending (default 8). The reservation already stops the bill being overpaid; the warning is there
  because the same guest paying again in cash would still pay twice. A payment nobody can settle
  stays for a manager on the dashboard, as today.
- **The phone loses Wi-Fi mid-payment** (picture 7, right). The card carries on, because the server
  drives the reader. Until an answer comes the sheet offers only **Comprobar de nuevo**, which resends
  under the same id; no new payment of any way or method can be started on that bill from this
  phone, which closes the defect in §2.3 (default 7). If the browser was killed and the id lost, the
  reopened sheet shows the payment "En curso" with its amount reserved, and asks "Hay un pago con
  tarjeta en curso en esta cuenta. ¿Cobrar otro?" before another card on the same bill. The server
  is unchanged here: the owner kept W100's sixth-question default (no rule against the holding phone starting
  two).
- **Changing the reader or printer while a card is at the reader**: not from the sheet, whose
  controls are disabled while the card is asked, as today's dialog's are (§2.2). An NFC tap is still
  picked up and the next payment uses the new reader; what the running card does was not checked
  (§3, "Scanning or tapping a sticker").
- **A sticker the phone cannot use** — not a Waitron sticker; equipment not offered to this phone;
  a reader another phone is charging on; or a printer the profile offers for some of its pick-up
  roles but not all, which the server refuses whole with `device.binding_invalid` (§2.1): today's
  words ("Esa no es una etiqueta de equipo de Waitron", "Ese equipo no está disponible para este
  dispositivo…", or the refusal's own message) show in the sheet's line, and nothing changes. A
  printer whose pick-up set is empty changes nothing where the server accepts it (switched on, at
  the device's location, on the profile's receipt or payment-slip list; §2.1) and is refused
  otherwise. When accepted, the sheet's line shows today's `equipment.no_printer_role` message,
  unless the answer shows that printer as the phone's chosen or by-default receipt or payment-slip
  printer, in which case today's code says "Has recogido {item}" (`till-app.ts:8200-8216`).
- **A printer picked up for payment slips only** (a manager changed its pick-up roles): its sticker
  sets the payment-slip printer, not the receipt printer, so the sheet's printer does not change. The
  sheet's line says "Has recogido {item} solo para justificantes de pago." (a new string) instead of
  "Has recogido {item}".
- **An unpaired reader still chosen.** Unpairing switches the reader off as well as marking it
  unpaired, and leaves the phones' choices alone (`markCardReaderUnpaired`,
  `apps/server/src/card-reader-delete.ts:245-254`); it then leaves the offered list, which keeps only
  readers both switched on and paired (`apps/server/src/device-equipment.ts:176`, `:286-293`). The
  form treats it as a switched-off reader: "Lector 2 está desactivado" (default 19).
- **Several guests pay at once**, on two phones and two readers, or card and cash: allowed today
  against what is left after each reservation (§2.2). Whichever payment completes the bill issues the
  invoice, and the receipt goes to that phone's printer; the printer chosen on another phone for an
  earlier share is not used.
- **The bill changes while a card is at the reader**: line changes on that bill are refused until
  the card finishes (`order.payment_in_flight`, bill payments design §5.2).
- **A presented bill** (picture 11): whole amount only, by reader, cash or another machine
  (default 1), with the same folded row.
- **An iPhone**: no Web NFC (Provenance), so the drop-down and 📷 QR; the NFC button is not shown.
- **NFC refused on this phone**: the NFC button is not shown; the drop-down and 📷 QR still work. Equipment
  shows its NFC controls only while the permission is "granted" or "prompt" (`#renderNfc`,
  `equipment-dialog.ts:303-305`), so the till offers no way to ask again, as today.
- **The venue's Wi-Fi is down altogether**: a handheld cannot reach the box; the counter's fallbacks
  apply (`CLAUDE.md` §5). Out of scope.
- **A guest wants their own receipt for their share**: one bill gets one simplified invoice; a guest
  who needs their own splits their dishes onto a separate bill first (A803). No change.
- **Refunds** are out of scope; today's refund on a received payment works on a handheld where the
  person may refund and the profile allows the payment's method (map row
  `till-api.profile-actions.test.ts:88`).

## 5. Data, routes and permissions

**No migration, and nothing new stored on the phone.** "Last used on this device" is what the server
already stores as the device's equipment choice: its reader (`device_card_readers`, one per device,
§2.1) and its receipt printer (`receiptPrinterId`, §2.4). The drop-downs show those and change them.
The server forgets the old reader when another phone takes it or it is deleted or taken off the
list, and the old printer when it is deleted, taken off the list or marked portable (default 19);
it keeps both when they are only switched off. The "taken" line in picture 5 comes from the comparison the till already
makes between two equipment reads in memory (`takenFrom`, §2.1), so after a reload it is not shown
and the form looks like a first use. The one new thing the phone keeps is a single in-memory flag,
held only while the page is open and never stored: whether it has had a reader this session
(default 18).

**Routes, all existing.** Changing either drop-down: `PUT /api/device/equipment` with role
`card_terminal` or `receipt` (§2.1); the exactly-one-reader pick sends the same, as a list pick. A
sticker scanned with 📷 QR or tapped: the same route with the sticker's kind and `via: "scan"`, as
today's NFC pick-up sends (§2.1). Then `GET /api/device/equipment` to redraw. Open bills:
`GET /api/working-orders/:id/payments` (also re-read while a payment is pending), `POST
…/payments/preview`, `POST …/payments` (`apps/server/src/bill-payments-api.ts:202-247`). Presented
bills: `POST /api/pay` for the reader, which accepts a `placed` order (`till-sale.ts:1127`), and
`collectOrder` for cash and typed cards. Cerrar mesa: `POST /api/parties/:id/finish`
(`till-api.ts:2719-2738`, which needs the `take-orders` action). The paid screen's ticket line:
`GET /api/sales/:id/receipt`, whose `:id` is the bill's working-order id, not a sale id
(`till-api.ts:2205-2224`, which looks the sale up by `workingOrderId`); today's ticket view already
reads it (`#readReceiptPrint`, `till-app.ts:7463-7472`). It answers a status — `not_queued`,
`queued`, `printing`, `failed` or `done` — with `jobId`, `canRetry` and sometimes `failureCode`,
`handover` or `printerWithdrawn`, but no printer (`till-api.ts:2274-2287`; `OriginalReceiptPrint`,
`apps/server/src/receipt-print.ts:417-426`). **No payment route gains a printer field**: the receipt prints when the invoice is issued, under the device that took the payment
(`bill-payments.ts:1259-1260`) and possibly minutes later, when the bill payment loop settles a
pending card through the same code (`completeBillPayment`, `bill-payments-loop.ts:143-149`). That
path passes no printer, so `enqueueSaleReceipt` looks up the device's receipt printer at that moment
(`bill-payments.ts:1256`, `:784`; `printerLookup` default, `receipt-print.ts:255-260`). A printer
named only in the request would have to be stored with the payment to still be known then — new
storage. Using the device's choice needs none (default 12).

**Server changes.** Only the seed: Móvil's actions (default 15) and no default reader (default 16);
and adopting a reader adds it to the list of every profile that takes reader payments, never as that
profile's default (default 16). The seed is provisioning data; before go-live an existing venue is
reset rather than migrated (`CLAUDE.md` §3). Nothing in payment handling changes.

**Permissions.** The person needs `sale.take_payment` (`bill-payments-api.ts:224`; STAFF have it,
`packages/identity/src/permissions.ts:45`). The device's profile needs the action for the method, as
the route-to-action map at the top of `apps/server/src/till-api.profile-actions.test.ts` records:
row `:87`, bill payments — `take-cash` / `hand-keyed-card-payment` / `integrated-card-payment`; row
`:75`, `POST /api/pay` — `integrated-card-payment`, then `take-orders` (both checked,
`till-api.ts:1691-1692`); row `:86`, collect — `take-cash` /
`hand-keyed-card-payment`; rows `:101-102`, `print-receipt` for a print or reprint. Choosing a
reader or a printer needs no action (`:136-137`, "choosing equipment is not printing, paying or
opening the drawer"). No drawer action is involved.

**Build slices** (each one pull request, for the plan to refine):
1. The resend fix on today's dialog (default 7) — independent and live.
2. Móvil's seed, no default reader, new readers joining reader-taking profiles.
3. The pay sheet on a handheld: Toda la cuenta, the presented-bill sheet, Otro datáfono, the folded
   reader and printer row with its two drop-downs, the reader's name on the row and the charge
   button with the request naming that reader, and saves in flight or refused (default 22).
4. Stickers in the sheet: 📷 QR on the folded row, the camera accepting either kind, the sheet's
   notice line, and the NFC button, which needs a new way into `EquipmentNfc` that calls `scan()`
   from a click while the permission is "prompt" (§2.1: today it never does). Tests: in
   `till-app.nfc.test.ts`, beside "continues listening on the schedule screen" (`:744`), a tap with
   the payment sheet open changes its folded row, its drop-downs and its charge button and leaves
   the listener running; a tap on the confirmation step makes Cobrar send the new reader; a tap
   while a card is at the reader is picked up and the waiting view keeps naming the reader the
   payment was sent to; the NFC button ends with one reader listening, as "granting NFC in the
   dialog ends with one live reader and one selection per tap" (`:279`) pins for Equipment. In the
   scanner's and the sheet's own tests, a scanned reader's sticker and a scanned printer's sticker
   each send the pick-up request with its kind, and a refused printer sticker changes nothing.
5. The waiting and uncertain states with the 5-second re-read; Cobrar al siguiente; the paid screen
   with Cerrar mesa and its ticket line.
6. The first-use and no-longer-available states (defaults 18 and 19), including the paid screen's
   "No se ha impreso ticket" when a switched-off printer was left as it was, and the new refusal
   wording.

## 6. Tap-to-Pay

**What it is:** the phone itself takes the card, with no reader. **Settled as a process:** "Waitron
is **browser-first by decision**", and whether to build a native app "should be made **once, against
the whole set** of capabilities that only a native app can deliver — not piecemeal"
([2026-08-30-native-app-capabilities.md](2026-08-30-native-app-capabilities.md), whose rows N1 and N2
list SumUp's and Stripe's Tap to Pay as hard blockers for a browser till). So Tap-to-Pay waits for
that one-time decision (default 17).

**Why it needs a native app.** Both providers offer it only inside their phone SDKs. SumUp's page
lists its "Integration Compatibility" as "iOS SDK Android Tap-to-Pay SDK" and says "Tap to Pay is
contactless-only. If you need chip insertion, use a physical reader such as Solo or Solo Lite"
(Provenance); the deli hardware design records the same, with no Cloud API
([2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md), "SumUp Tap to Pay"). Stripe
ships it in its iOS, Android and React Native Terminal SDKs, generally available in Spain on iPhone
and in public preview on Android (Provenance).

**What exists in the code** and would need finishing: `StripeOnDeviceProvider`
(`packages/payments-stripe/src/device-provider.ts:48`), which no app builds; its real client throws
because the charge "runs in the device SDK" (`stripe-device-client.ts:23`); it writes its payment row
only after the money moves (`device-provider.ts:43-47`), which breaks the bill payment loop's rule
that no row means no charge (`bill-payments-loop.ts:101-108`); and the bill route refuses offline
acceptance "until the Tap to Pay work enables it" (`bill-payments-api.ts:133-135`).

## 7. What this design does not do

- Change how tips work (A793), refunds, or the counter's payment window (A739).
- Add a digital receipt, or a guest paying from their own phone (A508, parked).
- Show a reader's battery or reachability (W100's seventh question kept today's answer: not shown).
- Cancel a card at the reader from the phone (default 9).
- Split a presented bill, or change when any invoice is issued.
- Change the bill and table model (A803) or the handheld's screens (A797); it uses both.

## 8. Decided by default (owner may overrule)

Items marked **settled** follow an owner decision and are not asked again; the source and its words
are given.

1. **A presented bill keeps today's collect path, and the handheld offers the reader on it.** A
   presented bill cannot take bill payments (§2.2), so it is paid whole: cash or a typed card through
   `collectOrder`, as today, and a reader card through `POST /api/pay`, which already accepts a
   placed order (`till-sale.ts:1127`; route-map row `:75`). **This
   changes neither when an invoice is issued nor any route**: a presented bill that already has its
   invoice is settled against it on both paths (`readOutstandingSaleForOrder`, `till-sale.ts:1147`
   for the reader, `:2080` for collect); one without is invoiced when the money is taken — at
   collect (`fileImmediateSale`, `:2136`) or at the card's capture (`finalizeCapture`, `:1514`). So
   it is not put to the owner.
2. **On a handheld, an open bill is paid through the bill payment path**, with a new way, **Toda la
   cuenta**, for the whole remaining bill, so the reader is reachable for a whole bill.
3. **A typed card is an explicit method, "Otro datáfono"**, never a silent fallback.
4. **Settled (owner, 2026-10-19): no step to confirm the reader; the reader and receipt printer
   sit in the payment form, preselected, folded away.** The owner's words: "Don't ask. Include the card reader
   drop-down and the receipt printers drop down in the payment form, with the last used one
   selected. In fact it could even be collapsed so you can't see it. The waiter will change the
   selection when they need to." (campaign watcher, 2026-10-19 about 05:00). For this form this
   replaces the 2026-09-18 rule "A remembered reader may be offered first in the list but must never
   be selected silently" (hardware decisions §2), which now carries a dated pointer here. O3's
   drop-down "fallback that always exists" is the reader drop-down itself. What is left to catch a
   reader that changed hands unseen is §4's second case.
5. **Settled: takeover rules stay as built**: scan takes, list asks, busy refuses. The owner kept
   the question on 2026-10-19 ("(a) keep the question … only when taking someone else's reader from
   the list; a sticker scan or NFC tap takes it at once, as today"). These come from W100's
   plan ([2026-10-04-device-equipment-and-independent-drawers.md](../plans/2026-10-04-device-equipment-and-independent-drawers.md)
   line 17,
   "QR scan takes over immediately; dropdown takeover identifies the holder and requires
   confirmation"), not from the list of defaults the owner kept on 2026-10-07
   (`docs/backlog/till.md:1512-1531`, Q1–Q7), which does not mention them. The reader drop-down is a list, so picking a reader another phone holds asks today's
   "¿Quitar …?". That is the only question left in the form, and it appears only when taking a reader
   from someone else, never as a check on the reader the form already shows. 📷 QR in the sheet and
   an NFC tap are scans, so they take at once. New: a busy reader is shown greyed out and cannot be picked, where today's Equipment
   dialog sends the pick and shows the server's refusal (`equipment-dialog.ts:377-383`).
6. **"Last used" means last chosen on this device, and it is the device's existing equipment choice
   on the server.** Last chosen, not last charged: a waiter who picks up Lector 3 at the bar and walks
   to a table expects Lector 3, and "last charged" would put Lector 2 back. Choosing already has to
   come first, because the server charges only a reader the phone holds (§2.1), so the reader the
   form shows is the one the next charge will use. The printer works the same way: the drop-down
   shows and sets the device's receipt-printer choice, else its profile's default, which is also what
   reprints use (§2.4). **Per device, not per person**: the server keeps both per device, and a
   reader is held by a device, not a person (§2.1); signing in or out does not let go of it. What
   does is equipment and device changes — a takeover (`device-readers.ts:319-328`), deleting the
   reader (`card-reader-delete.ts:277-279`), a profile list edit (`settleProfileReaderDevices`,
   `device-readers.ts:410-454`), a profile move or a device coming back (`settleDevice`,
   `apps/server/src/device-equipment.ts:72-81`, from `device.ts:116-119`), a join
   (`join-requests.ts:559`), disabling or deleting the device (`device-delete.ts:183`, `:201`), or
   the phone picking another reader or Use default. None of those callers is on a sign-in or
   sign-out path (`git grep` for the release and settle functions across `apps/server/src` and
   `packages`, read). So when Marc signs in on the phone Ana used, the form shows the reader that
   phone still holds. Per person would need new storage and could name a reader another phone
   holds. Kept on the server, it needs no new storage on the phone, survives a reload, and is what
   Equipment shows (§5). Where the server has forgotten the reader, the form follows defaults
   18 and 19.
7. **While a bill payment of any way or method is unanswered, the sheet offers only "Comprobar de
   nuevo"** (same id) for that bill — no new payment, and the kept id is dropped only when an answer
   comes — and before a second card on a bill with a card in progress it asks first. This closes the §2.3 defect on the
   phone. **The server is unchanged**: W100's sixth-question default ("app-level checks stop OTHER devices, not
   the holder starting two at once") was kept by the owner on 2026-10-07 ("Ok", keep every default;
   lane C's questions file, 2026-10-07 ~08:50).
8. **An uncertain payment re-reads itself** every 5 seconds while the sheet shows it, and says not to
   take the same guest's money another way.
9. **No Cancel while the card is at the reader**: no route cancels a card at a real reader today (the
   only cancel route, `POST /api/demo-reader/cancel`, is the simulator's pretend reader, mounted only
   for it, `till-api.ts:1178`, `:1220`).
10. **"Cobrar al siguiente"** after a share, keeping the way chosen.
11. **Settled: the table closes only on Cerrar mesa**, now a big button on the paid screen. Service
    design §8 (owner-approved 2026-09-26): "Paying does not by itself free an occupied table. By
    default, **Finish table** closes the visit." Once built, it first runs A758's check (D12, owner
    answer Q40, 2026-10-18): "Finish table warns about dishes not served and offers 'Cancel and
    refund' or 'Cancel, no refund'".
12. **Receipts keep today's printing rules, on the phone's receipt printer at the moment the
    bill's last payment settles.** The device whose request issued the invoice (§2.4; for a bill
    paid in shares, the phone that took the completing payment) prints on its receipt printer
    automatically where the bill's zone (or its department) prints automatically; a
    presented bill whose invoice was already issued prints nothing on payment. Usually that is the
    printer the form showed. A card that settles later uses whatever the phone has by then (§5): if
    Mesa 4's last card is still pending when Ana switches to Terraza for Mesa 9, Mesa 4's ticket
    prints on Terraza. Changing the printer in the form changes that phone's receipt printer for what
    follows too — reprints included — as choosing it in Equipment does; no payment route gains a
    printer field (§5). New: the paid screen's ticket line (picture 8), by default and with no
    server change. It comes from today's `GET /api/sales/:id/receipt` (§5) and names no printer,
    because the route returns none and the server picks the printer when the invoice is issued, so
    the phone's own memory could name a printer that did not print. `queued`, `printing` or `done`:
    "Ticket enviado". `failed`: "No se ha podido imprimir", with today's retry where `canRetry`.
    `not_queued`: "No se ha impreso ticket", and that a device whose profile may print receipts can
    reprint it. Naming the printer would need the route to return the print job's printer, which
    the read behind it already joins (`readOriginalReceiptPrints`,
    `apps/server/src/receipt-print.ts:437-453`); that is a possible later addition, not part of this
    build. No digital receipt. **Settled (owner,
    2026-10-19): "ONE setting"** — the form's printer is the phone's Equipment receipt printer,
    which an NFC tap or a QR scan also changes; no separate receipt memory and no new storage.
    A790's design already follows this on `main` at `d63b2e448`: "The separate receipt memory
    updated only after an accepted print is withdrawn from the current proposal", and "A796 says
    **“ONE setting”** for the phone's Equipment receipt printer, with no separate receipt memory or
    new storage" ([2026-10-19-a790-document-and-printer-choice-design.md](2026-10-19-a790-document-and-printer-choice-design.md)
    lines 7-8 and 13-14).
13. **Tips: A793's seam only.**
14. **Whether the sheet sits at the foot of the screen** (as drawn) or stays a centred dialog is left
    to the plan; it is the shared `wt-dialog` either way.
15. **Settled: Móvil takes reader cards, cash and prints receipts; never the drawer.** O2 (2026-09-18):
    "The bill can be settled at the table"; the owner, 2026-10-01 (`docs/developers/conventions-ui.md`):
    "A handheld should be able to do pretty much anything a till can do, it just depends on the
    permissions of the person using the handheld"; and 2026-10-03
    ([2026-10-03-till-is-a-device-design.md](2026-10-03-till-is-a-device-design.md) §1–§2): "A
    device's profile decides what it may do", "Even without a float a waiter can take cash, just
    without giving change", and "The owner expected a Prepare or Live venue to start with no devices
    and add each one". Today's list is
    W97's carry-over (§2.5), not a choice. Picture 10.
16. **Móvil gets no default reader, and every charge request names the reader it charges.** This
    is about the request the phone sends; the button also names it (owner, 2026-10-19). So joining,
    returning or a profile move never hands a phone a reader silently (§2.1), and `resolvePayReader`'s
    fallback is never used from a handheld. A newly adopted reader joins the list of every profile that
    takes reader payments, never as its default; a manager can take it off.
17. **Settled: Tap-to-Pay waits for the one-time native-app decision** (§6; native-app capabilities,
    N1/N2): "should be made **once, against the whole set** … not piecemeal".
18. **Settled (owner, 2026-10-19, answer "(b)"): a phone with no reader.** The owner's answer: the
    row opens by itself, the reader empty and Continuar greyed out until a reader is picked or
    scanned; cash still works. By default (owner may overrule): the reader field's placeholder is
    "Elige el lector que tienes en la mano" (a new string; a field's hint is its placeholder); the
    field is marked required, and Continuar greyed out for it, only while Tarjeta is the method, so
    Otro datáfono works too; a tapped sticker counts as a pick (picture 4, left). The printer field
    shows the printer the phone would use now — its profile's default receipt printer, where the
    venue set one — marked "Predeterminado del perfil" (`strings.ts:2287`). A portable default
    printer this phone does not hold gives it no printer at all: a portable printer serves only the
    device holding it, chosen or default (`packages/layouts/src/device-equipment.ts:274-276`, used
    at `:285`). The exception the owner chose:
    when the profile offers exactly one reader, it is picked automatically (picture 4, right). By
    default, for the owner to overrule, the design reads that as all of these:
    - the phone has had no reader as far as it can know. Within a session it does know: the till
      keeps its latest equipment read in memory (`#holdEquipment`, `till-app.ts:7942-7946`) and
      already compares reads to produce the "taken" line (`takenFrom`, `:411-424`). So a phone that
      had a reader earlier in this session (say Lector 2, since deleted or taken off the profile's
      list) gets default 19's empty field and reason line, not the automatic pick. That needs a small
      new in-memory note that the phone has had a reader, since the till keeps only its latest read.
      After a reload the phone cannot tell, and the automatic pick applies;
    - the equipment read offers exactly one reader for the card-reader role (the profile's list,
      switched on and paired, without the demo reader: `apps/server/src/device-equipment.ts:286-293`,
      "available" at `:176`);
    - that reader is neither held by another phone nor busy with another phone's payment (`heldBy`,
      `busy`, `:248-251`).

    The form then sends the same request as a list pick of it, as it opens, and the row stays
    closed naming it. A reader held or busy elsewhere is never taken this way: the form looks like
    the left-hand picture, and picking it from the list asks today's "¿Quitar …?". An automatic pick
    that is refused or gets no answer leaves the form as on the left (default 22). Where a venue
    does give a profile a default reader, the server hands it to a phone only when the phone joins,
    comes back, moves profile or picks Use default, and only if it is free (`settleDeviceReader`,
    `packages/payments/src/device-readers.ts:345-383`, called with `acquire` from
    `apps/server/src/device-equipment.ts:72-81` and `device-readers.ts:335`); editing the profile's
    list hands out nothing (`device-readers.ts:410-454`; test "a profile list edit takes nothing for
    a device on Use default", `packages/payments/src/device-readers.test.ts:378`). When the phone has
    it, the form shows it marked "Predeterminado del perfil".
19. **Settled (owner, 2026-10-19, answers "(a)" and "(a)"): a reader or printer that has gone.**
    The owner's answers: for the reader, the row opens, reader empty, Continuar greyed out, with a
    reason line where the phone knows one; for the printer, the row opens with the printer empty
    and a warning, the payment still goes ahead and with no change no ticket prints and the paid
    screen says so, and a printer deleted or taken off the profile's list falls back to the
    profile's default, shown labelled. The rest of this item is how the design carries that out, from today's code, and
    where marked, by default.
    *The reader* (picture 5, left): the row opens by itself with the reader field empty and, by
    default only while Tarjeta is the method, Continuar greyed out until a reader is picked. One line says why where the
    phone knows: "Móvil 2 (Marc) se ha llevado Lector 2" when the phone saw the takeover this session;
    "Lector 2 está desactivado" (`strings.ts:2291`) for a switched-off or unpaired reader, whose
    choice the server keeps (§2.1, §4). For a reader deleted or taken off the profile's list during
    this session, by default (owner may overrule): "Lector 2 ya no está disponible" (a new string),
    from the in-memory note of default 18. After a reload, a reader the server has forgotten gets no
    reason line, and default 18's rules apply. Picking Lector 2 again from the list asks today's
    "¿Quitar Lector 2 a Móvil 2 (Marc)?".
    *The printer* depends on how it went. Switched off (picture 5, middle): the phone keeps it as its
    choice and today prints nothing, silently; the profile's default does not stand in (§2.4). The
    row opens with the printer field empty and the warning "Barra está desactivada: si no eliges
    otra, no se imprimirá el ticket" — a new string, because today's `equipment.switched_off`,
    "{item} está desactivado", is masculine — but Continuar works: the payment goes ahead and, if the
    waiter changes nothing, no ticket prints and the paid screen says so. Deleted, taken off the
    profile's list or marked portable: the server clears the phone's choice — deletion at
    `apps/server/src/printer-delete.ts:182-187`, a list edit through `settleProfilePrinterDevices`
    (`packages/layouts/src/device-printers.ts:151`, `packages/layouts/src/device-equipment.ts:588-626`),
    a profile move through `clearUnlistedPrinterChoices` (`apps/server/src/device-equipment.ts:77`),
    marking portable through `setPrinterPortable` (`packages/layouts/src/device-equipment.ts:633-651`)
    — and the phone falls back to the profile's default receipt printer. Marking a printer portable
    is not in the owner's answer; it is today's code clearing choices the same way, so the form
    treats it the same. The row stays closed and shows "ticket en Terraza (predeterminada)"
    (picture 5, right). By default (owner may overrule),
    where nothing is left to print on, two cases differ. If the profile lists no receipt printer at
    all, the venue has chosen no tickets on this kind of device: the row stays closed and reads
    "sin ticket". If the profile lists receipt printers but the phone has no choice and the profile
    no default, the row opens with the printer field empty and the warning "Sin impresora de
    tickets: si no eliges una, no se imprimirá el ticket" (a new string); the payment is not held
    up. This matches A790's earlier, still unapproved proposal for its own receipt forms: "If none
    qualifies, leave the inline field empty and ask for a choice there" (A790 design, lines
    234-235, under "Historical text retained verbatim", line 122, in a section headed as a proposed
    builder call with persistence not agreed, line 212; A790's addendum says "A790's first-use
    behavior and further fallback details remain unapproved", lines 64-65).
20. **Settled (owner, 2026-10-19): a QR button on the folded row, and NFC working while the form is
    open** — "we're missing the button to scan a qr code to associate a card reader or printer, and
    we should have a function running in the background to update the appropriate device when an
    NFC scan happens"; "The qr button should be visible without opening the device section". The
    background function already exists and today's payment dialog does not stop it (§2.1); what is
    new is the sheet naming the reader, showing a tap's result at once, and tests pinning both.
    Chosen by default, for the owner to overrule: the sheet's camera accepts either kind of sticker
    and sends what it reads exactly as a tap does (kind and `via: "scan"`), so a printer's sticker
    follows the printer's pick-up roles, and the server's all-or-nothing refusal, either way; and a
    tap's or scan's notice shows as a line inside the sheet while it is open (§3, "Scanning or
    tapping a sticker").
21. **NFC permission is asked from a button on the folded row** (by default, owner may overrule).
    Today only Equipment asks (§2.1). While the browser has Web NFC and the permission is still
    unanswered, a small **NFC** button sits beside 📷 QR on the folded row and in the opened row's
    heading (pictures 4 and 12), so a phone meets it on every payment until it is answered, whether
    or not the row opens — including after an automatic pick or a reader chosen in Equipment. Its
    accessible name is today's "Permitir NFC" (`strings.ts:2296`). Pressing it calls `scan()` from
    that click, which is new behaviour: in "prompt", `EquipmentNfc.start()` subscribes to permission
    changes but never scans (§2.1), so the plan needs a new way into it. Once granted, the
    till-wide listener runs on every screen, with one reader listening. It is a button rather than
    asked as the sheet opens because Chrome's NFC page ties the first scan to "a user gesture such
    as a touch gesture or mouse click" (Provenance), as Equipment's Permitir NFC already does. It is
    not shown on a browser without Web NFC, once granted, or once refused.
22. **A drop-down or automatic pick that is being saved, or is refused** (by default, owner may
    overrule). A790's design leaves these to A796: "A796 owns those interactions, the reader labels
    and NFC permission; its background NFC requirement does not authorize assuming permission.
    Save timing, pending/refused saves, rollback and concurrent Equipment changes need a builder
    proposal and agreement." (A790 design lines 56-59.)
    While a pick is being sent, the field shows the new choice as sending, and Continuar (and Cobrar
    on the confirmation step) is greyed out until it is answered, so a charge never goes out against
    a reader the server has not given the phone. On a refusal the field goes back to what it showed
    before, and the refusal's message appears under that field, as the form rules ask of a refusal
    that names a shown field. A pick that gets no answer may still have been stored, so the till
    reads the equipment again, as `#switchEquipment` does today for an error with no status
    (`till-app.ts:8228-8239`, re-read at `:8255`), and the field shows what that read says, with the
    line "No se ha podido guardar" (a new string) under it. Today that re-read happens only once no
    other choice is waiting, and is tried once (`#rereadIfStale`, `:7936-7940`). An automatic pick
    (default 18) that is refused or gets no answer as the form opens leaves the form as answer 2's
    empty reader field, with the message under it. Picks, scans and taps keep going through today's
    one-at-a-time queue (§2.1), but the order the server stores them in is not guaranteed once one
    goes unanswered: a cut-off request "may still reach the server after later ones"
    (`till-app.ts:2559-2563`).

## 9. Questions for the owner

None open. The owner answered all six of Revision 3's questions on 2026-10-19 (see the Revision 4
note at the top). Defaults 18–21 record what this design chose where the answers left a detail
open; the owner may overrule any of them.

## 10. Provenance

| Claim | Source (read 2026-10-19 with `curl`, text grepped) | Its words |
| --- | --- | --- |
| Web NFC is Chrome for Android only | MDN browser-compat-data, `https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/NDEFReader.json` | `"chrome_android": {"version_added": "89"}`; `"chrome"`, `"firefox"`, `"safari"`: `"version_added": false`; `"safari_ios": "mirror"`; `"experimental": true` |
| Scanning needs one user gesture; NFC pauses when the page is hidden | `https://developer.chrome.com/docs/capabilities/nfc` | "It was only called in response to a user gesture such as a touch gesture or mouse click."; "All NFC operations are automatically suspended when document is hidden." |
| SumUp's Tap to Pay is SDK-only and contactless-only | `https://developer.sumup.com/terminal-payments/readers/tap-to-pay` (HTTP 200) | "Integration Compatibility … iOS SDK Android Tap-to-Pay SDK"; "Tap to Pay is contactless-only. If you need chip insertion, use a physical reader such as Solo or Solo Lite." |
| Stripe's Tap to Pay is in its native SDKs only | `https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=android` and `?platform=ios` | "Stripe includes Tap to Pay on Android in the Terminal Android SDK and the Terminal React Native SDK, and enables payments directly in your Android mobile app."; the iPhone page says the same for the iOS SDK |
| Spain: Stripe's iPhone version available, Android in preview | the same two pages | iPhone page: "Availability Australia Austria … Spain Sweden …"; Android page: "Availability in Public preview Bulgaria … Slovenia Spain" |
| A SumUp Solo lets the guest cancel on the reader | — | **unverified**; not relied on (default 9) |

Earlier readings of the Web NFC facts, with the sticker and metal findings, are in
[2026-09-18-handheld-and-till-hardware-decisions.md](2026-09-18-handheld-and-till-hardware-decisions.md)
§3 and §8.
