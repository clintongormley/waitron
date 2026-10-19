# A796 — Paying at the table from a handheld (payments slice 2)

Status: **design, with five small owner questions open (§9). Nothing is built.** Revision 3,
2026-10-19: the owner answered Revision 2's one question — don't ask which reader is in the
waiter's hand; put a card reader drop-down and a receipt printer drop-down in the payment form, each
with the last one used selected, folded away until the waiter wants to change one (§8, default 4).
Revision 2 turned four of the first revision's five questions into defaults citing earlier owner
decisions. Backlog
entry: `docs/backlog.md`, "Slice 2 — the handheld NFC/QR link" (under _Payments and card readers_),
detail in [payments.md](../../backlog/payments.md#slice-2--the-handheld-nfcqr-link). Pictures:
[`docs/backlog/mockups/a796-handheld-payments/`](../../backlog/mockups/a796-handheld-payments/),
drawn in HTML with the apps' colour and spacing tokens, not screenshots; each is labelled "today" or
"proposed — drawn". The generator is kept outside the repository.

File references are to `main` at `d175118ed`; the files Revision 3 adds citations from are unchanged
at `4ce4a56c2` (`git diff --stat d175118ed 4ce4a56c2 --` over them prints nothing). **(read)** marks
a conclusion from reading code, not from running it. Nothing in the product was run for this design; every statement about today's code
is (read). Part of the reading was done by search helpers; the citations this design leans on were
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
so changing one is today's pick-up, under today's takeover rules. Five small questions are left
(§9): whether the folded row names the reader, what the form does on a phone's first payment and
when the reader or printer used last has gone, and whether a printer changed in the form becomes
the phone's printer for everything after.

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
- **Taking a reader another phone holds.** A scan takes it at once; a list pick asks "¿Quitar
  {item} a {device} ({person})?" first (`packages/shared/src/equipment-takeover.ts:8-9`;
  `equipment-dialog.ts:379-381`). A reader with another device's payment running cannot be taken
  (`device-readers.ts:302-304`, `reader.payment_in_progress`). The phone that lost it learns on its
  next equipment read, every 15 seconds while someone is signed in
  (`apps/till/src/state/equipment-poll.ts:4`; `till-app.ts:7944`).
- **The server already picks a reader silently in two places.** When a device joins, comes back or
  moves profile, `settleDevice` (`apps/server/src/device-equipment.ts:67-80`) takes the device's
  chosen reader, or on "Use default" the profile's default reader, if it is free
  (`settleDeviceReader`, `device-readers.ts:340-382`). And when a payment request names no reader,
  the server charges the chosen-or-default reader (`resolvePayReader`,
  `apps/server/src/till-api.ts:329-334`). A device cannot opt out of its profile's default (W100's
  Q1, kept by the owner on 2026-10-07; `docs/backlog/till.md`).
- **What the server remembers.** The phone's explicit choice (`device_card_readers`) outlives the
  holding: disabling the device releases the reader but keeps the choice (`device-delete.ts:183`),
  and re-enabling takes it back if free, and otherwise puts the device on Use default
  (`apps/server/src/device.ts:117-119`; `settleDeviceReader`); only deleting the device clears it
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
  own reader; that is W100's Q6 default, which the owner kept on 2026-10-07.

### 2.4 Receipts, cash and the drawer

- **The receipt prints on the receipt printer of the phone that took the last payment**
  (`bill-payments.ts:1259-1260`), automatically where the bill's zone, or else its department, prints
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
  resolves to it (`:285`) and the printer read keeps only switched-on printers
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
   "Lector e impresora — Lector 2 · ticket en Barra — Cambiar", shows what this phone last chose
   (default 6). Nothing asks Ana to confirm either. Whether the closed row names them is question 1.
4. **Changing one** (picture 3). Cambiar opens the row in place: a **Lector de tarjetas** drop-down
   with Escanear código QR beneath it, and an **Impresora de tickets** drop-down. The reader list is
   today's Equipment list — who has each reader, and which are busy — and picking a reader picks it
   up at once, as Equipment does today; picking one another phone has asks today's "¿Quitar Lector 1
   a Caja 1 (Marc)?" (default 5). With NFC allowed, tapping a reader's sticker anywhere in the app
   picks it up, as today, and the drop-down then shows it. The printer list is the profile's receipt
   printers at this location. The row is closed again the next time the sheet opens.
5. **Tip.** Unchanged: where tips are on, the card form has "Propina con tarjeta (opcional)" and
   cash offers "Dejar de propina". Everything else about tips is A793's design (not approved; back
   to brainstorm, [2026-10-18-a793-tips-design.md](2026-10-18-a793-tips-design.md)). This design
   keeps only the seam: the till asks for the tip before the card is charged.
6. **Confirm** (picture 2, right): today's confirmation step, with the amounts and a button that
   names the reader: "Cobrar 20,80 € en Lector 2". The phone always sends that reader's id, so the
   server never falls back to a chosen-or-default reader (default 16).
7. **The card at the table** (picture 6, left). Ana hands the reader to the guest. The sheet shows
   "Acerca o inserta la tarjeta…", the amount and the reader in large type, and how long it has been
   waiting. A decline keeps today's words and offers "Reintentar en Lector 2" (picture 6, right).
8. **Cash**: today's cash step. Móvil as seeded opens no drawer: it has no "open-cash-drawer"
   (default 15).
9. **The next guest** (picture 8, left): "Cobrar al siguiente (2 de 3)" keeps the split and lowers
   the count (default 10). The reader and printer stay as they were.
10. **The table paid** (picture 8, right). The payment that completes the bill issues the invoice,
    as today, and its receipt prints on the receipt printer of the phone that took that payment
    (§2.4). On a handheld a short paid screen replaces the full ticket view: the payments, whether a
    receipt printed, and **Cerrar mesa**, which the waiter presses as the guests leave — paying never
    frees the table by itself (default 11). Once A758's not-served check is built, Cerrar mesa opens
    it first.

**First payment on a phone, and a reader or printer that has gone** (pictures 4 and 5). Proposed,
and asked as questions 2–4: when this phone has no usable reader the row opens by itself with the
reader field empty and Continuar waits for a pick, saying why in one line where the phone knows; a
printer that has gone opens the row with a warning but holds nothing up.

## 4. Edge cases

- **Two waiters want the same reader.** Today's rules stay (default 5). If Marc scanned Lector 2
  after Ana's phone last held it, Lector 2 is now Marc's and Ana's phone no longer has a reader:
  her form shows question 3's state (picture 5, left) rather than a reader she cannot charge. If her
  Cobrar was already on its way, it is refused before anything is charged (§2.3), and today's words
  "Elige un lector en Equipo" (`apps/till/src/i18n/codes.ts:699`) change to point at the form's own
  reader drop-down.
- **Marc walks off with Lector 2 without scanning it.** The server still has Lector 2 as Ana's, so
  her phone charges it, and 20,80 € appears on the reader at Marc's table. This is the case the
  2026-09-18 rule ("never selected silently") was there to stop. Under the owner's answer of
  2026-10-19 nothing asks; what is left to catch it is the reader's name on
  the screen — on the charge button always, and on the closed row if question 1 is answered yes —
  matching the label stuck on the reader in her hand.
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
  is unchanged here: the owner kept W100's Q6 default (no rule against the holding phone starting
  two).
- **Changing the reader or printer while a card is at the reader**: not possible; the sheet's
  controls are disabled while the card is asked, as today's dialog's are (§2.2).
- **Several guests pay at once**, on two phones and two readers, or card and cash: allowed today
  against what is left after each reservation (§2.2). Whichever payment completes the bill issues the
  invoice, and the receipt goes to that phone's printer; the printer chosen on another phone for an
  earlier share is not used.
- **The bill changes while a card is at the reader**: line changes on that bill are refused until
  the card finishes (`order.payment_in_flight`, bill payments design §5.2).
- **A presented bill** (picture 11): whole amount only, by reader, cash or another machine
  (default 1), with the same folded row.
- **An iPhone**: no Web NFC (Provenance), so the drop-down and the QR camera.
- **The venue's Wi-Fi is down altogether**: a handheld cannot reach the box; the counter's fallbacks
  apply (`CLAUDE.md` §5). Out of scope.
- **A guest wants their own receipt for their share**: one bill gets one simplified invoice; a guest
  who needs their own splits their dishes onto a separate bill first (A803). No change.
- **Refunds** are out of scope; today's refund on a received payment works on a handheld where the
  person may refund and the profile allows the payment's method (map row
  `till-api.profile-actions.test.ts:88`).

## 5. Data, routes and permissions

**No migration, and nothing new kept on the phone.** "Last used on this device" is what the server
already stores as the device's equipment choice: its reader (`device_card_readers`, one per device,
§2.1) and its receipt printer (`receiptPrinterId`, §2.4). The drop-downs show those and change them.
The one thing the server forgets is a reader taken by another phone; the reason line in picture 5
comes from the comparison the till already makes between two equipment reads in memory
(`takenFrom`, §2.1), so after a reload it is not shown and the form looks like a first use.

**Routes, all existing.** Changing either drop-down, or a scan: `PUT /api/device/equipment` with
role `card_terminal` or `receipt` (§2.1), then `GET /api/device/equipment` to redraw. Open bills:
`GET /api/working-orders/:id/payments` (also re-read while a payment is pending), `POST
…/payments/preview`, `POST …/payments` (`apps/server/src/bill-payments-api.ts:202-247`). Presented
bills: `POST /api/pay` for the reader, which accepts a `placed` order (`till-sale.ts:1127`), and
`collectOrder` for cash and typed cards. Cerrar mesa: `POST /api/parties/:id/finish`
(`till-api.ts:2719-2738`, which needs the `take-orders` action). **No payment route gains a printer
field**: the receipt prints when the invoice is issued, under the device that took the payment
(`bill-payments.ts:1259-1260`) and possibly minutes later, when the bill payment loop settles a
pending card through the same code (`completeBillPayment`, `bill-payments-loop.ts:143-149`), so a printer named only in the request would have to be stored on the payment row to be
there at that moment — a migration. Using the device's choice needs none (default 12).

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
   reader and printer row with its two drop-downs and QR button, and the charge button naming the
   reader.
4. The first-use and no-longer-available states (questions 2–4) and the new refusal wording.
5. The waiting and uncertain states with the 5-second re-read; Cobrar al siguiente; the paid screen
   with Cerrar mesa.

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
- Show a reader's battery or reachability (W100's Q7 default stands).
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
4. **Settled (owner, 2026-10-19): no confirm step; the reader and receipt printer sit in the
   payment form, preselected, folded away.** The owner's words: "Don't ask. Include the card reader
   drop-down and the receipt printers drop down in the payment form, with the last used one
   selected. In fact it could even be collapsed so you can't see it. The waiter will change the
   selection when they need to." (campaign watcher, 2026-10-19 about 05:00). For this form this
   replaces the 2026-09-18 rule "A remembered reader may be offered first in the list but must never
   be selected silently" (hardware decisions §2), which now carries a dated pointer here. O3's
   drop-down "fallback that always exists" is the reader drop-down itself. What is left to catch a
   reader that changed hands unseen is §4's second case.
5. **Takeover rules stay as built**: scan takes, list asks, busy refuses (W100, kept by the owner
   2026-10-07). The reader drop-down is a list, so picking a reader another phone has asks today's
   "¿Quitar …?", and a busy reader is shown but cannot be picked. That question appears only when
   taking a reader from someone else, never as a check on the reader the form already shows.
6. **"Last used" means last chosen on this device, and it is the device's existing equipment choice
   on the server.** Last chosen, not last charged: a waiter who picks up Lector 3 at the bar and walks
   to a table expects Lector 3, and "last charged" would put Lector 2 back. Choosing already has to
   come first, because the server charges only a reader the phone holds (§2.1), so the reader the
   form shows is the one the next charge will use. The printer works the same way: the drop-down
   shows and sets the device's receipt-printer choice, else its profile's default, which is also what
   reprints use (§2.4). **Per device, not per person**: the server keeps both per device, and a
   reader is held by a device, not a person (§2.1); signing out does not let go of it — only
   disabling or deleting the device does (`releaseDevice` is called only at `device-delete.ts:183`
   and `:201`; `git grep -n "releaseDevice(" -- apps/server/src`, read). So when Marc signs in on the
   phone Ana used, the form shows the reader that phone still holds. Per person would need new storage and could name a reader another phone holds.
   Kept on the server, it needs no new storage on the phone, survives a reload, and is what
   Equipment shows (§5). After a takeover the server has forgotten the reader;
   the form then shows question 3's state.
7. **While a bill payment of any way or method is unanswered, the sheet offers only "Comprobar de
   nuevo"** (same id) for that bill — no new payment, and the kept id is dropped only when an answer
   comes — and before a second card on a bill with a card in progress it asks first. This closes the §2.3 defect on the
   phone. **The server is unchanged**: W100's Q6 default ("app-level checks stop OTHER devices, not
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
12. **Receipts keep today's printing rules, on the printer the form shows.** On paying, the phone
    that took the completing payment prints on its receipt printer automatically where the bill's
    zone (or its department) prints automatically; a presented bill whose invoice was already issued
    prints nothing on payment. Changing the printer in the form changes that phone's receipt printer
    for what follows too — reprints included — as choosing it in Equipment does; no payment route
    gains a printer field (§5). New: with nothing printed, the paid screen says so, and that a device
    whose profile may print receipts can reprint it. No digital receipt. A790's design proposes
    instead a separate last-used receipt memory that leaves the device's choice alone; the two
    designs must agree before either is planned (question 5).
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
16. **Móvil gets no default reader, and the phone always names the reader it charges.** So joining,
    returning or a profile move never hands a phone a reader silently (§2.1), and `resolvePayReader`'s
    fallback is never used from a handheld. A newly adopted reader joins the list of every profile that
    takes reader payments, never as its default; a manager can take it off.
17. **Settled: Tap-to-Pay waits for the one-time native-app decision** (§6; native-app capabilities,
    N1/N2): "should be made **once, against the whole set** … not piecemeal".

## 9. Questions for the owner

Each has a recommended answer first. None changes the database or a route.

**Q1. Should the folded row name the reader and printer, as the charge button names the reader?**
Example: Mesa 4. Ana's form opens with the row closed. (a) It reads "Lector 2 · ticket en Barra"
(picture 2), and the button "Cobrar 20,80 € en Lector 2". (b) It reads only "Lector e impresora",
and the name appears on the button alone.
Recommended: **(a)**. Since nothing asks which reader is in Ana's hand, reading "Lector 2" on the
screen against the label on the reader is the one thing that catches Marc having walked off with it
(§4). It costs one line. This was the campaign watcher's suggestion.

**Q2. What does the form do on a phone that has never chosen a reader?**
Example: Ana's new phone joins on Móvil, which has no default reader (default 16). Her first card
is Mesa 4's 20,80 €. (a) The row opens by itself, the reader field reads "Elige el lector que tienes
en la mano", and Continuar stays quiet until she picks one from the list, scans one or taps a
sticker (picture 4); cash and Otro datáfono work meanwhile. The printer shows the profile's default
receipt printer where the venue set one. (b) As (a), except that when the profile lists exactly one
reader the form chooses it and stays closed.
Recommended: **(a)** — the owner's answer is about the *last used* reader, and a phone that has used
none has nothing to preselect; picking one is a single tap that then never comes back on that phone.
(b) saves that tap only in a venue with one reader, where it is also least needed. If the venue set
a default reader on the profile, the server already gives it to the phone when it is free (§2.1),
and the form shows it as chosen.

**Q3. What does the form do when the reader this phone last chose can no longer be charged?**
Example: Ana put Lector 2 on the bar; Marc scanned its sticker and took it, so the server moved it
to his phone (§2.1). Ana then opens Mesa 4. The same applies when a manager switched Lector 2 off,
deleted it or took it off Móvil's list. (a) The row opens by itself with the reader field empty, a
line says why ("Móvil 2 (Marc) se ha llevado Lector 2", "Lector 2 está desactivado"), and Continuar
waits for a pick (picture 5, left); picking Lector 2 again asks today's "¿Quitar Lector 2 a Móvil 2
(Marc)?". After a reload the phone no longer knows why, so the line is left out (§5). (b) The row
stays closed showing "Lector 2", and pressing Cobrar is refused with a message pointing at the
row.
Recommended: **(a)** — it shows the problem before the waiter has asked the guest for a card, and it
never takes Lector 2 back from Marc's table silently. (b) would mean every case ends in a refused
charge.

**Q4. What does the form do when the receipt printer this phone last chose can no longer print?**
Example: the Barra printer was switched off at the end of lunch; at dinner Ana takes Mesa 4's last
share. Today such a printer prints nothing, silently, and the profile's default does not stand in
(§2.4). (a) The row opens with the printer field empty and a warning, "Barra está desactivada: si
no eliges otra, no se imprimirá el ticket", but Continuar works: the payment goes ahead and, if she
changes nothing, no ticket prints and the paid screen says so (picture 5, right). (b) The form falls
back to the profile's default receipt printer without saying so.
Recommended: **(a)** — a printer must never hold up a payment, and printing on a printer nobody
chose would put the guest's ticket somewhere the waiter is not looking.

**Q5. When Ana changes the printer in the payment form, is that her phone's printer from then on?**
Example: Ana sends Mesa 4's ticket to Terraza instead of Barra. Ten minutes later she reprints Mesa
9's ticket from the same phone. (a) It prints on Terraza: the form's printer is the phone's receipt
printer, the same setting Equipment changes, and the next payment form opens on Terraza too (default
12). (b) It prints on Barra: the form keeps its own "last used for a payment" memory and leaves the
phone's Equipment setting alone, which is what A790's design proposes for receipts
([A790 revision](2026-10-19-a790-document-and-printer-choice-design.md), "Eligibility, fallback and
memory").
Recommended: **(a)** — one printer per phone that the waiter can see and change in one place, and
no database change: (b) has to store the chosen printer on the payment row, because the ticket is
printed when the bill's last payment settles, which for a card can be minutes later (§5). Whichever
is chosen, A790 and A796 then follow the same rule.

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
