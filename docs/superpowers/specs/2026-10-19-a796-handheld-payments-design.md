# A796 — Paying at the table from a handheld (payments slice 2)

Status: **design, waiting for the owner's answers to four questions (end of this file). Nothing is
built.** Backlog entry: `docs/backlog.md`, "Slice 2 — the handheld NFC/QR link" (under _Payments
and card readers_), with its detail in
[payments.md](../../backlog/payments.md#slice-2--the-handheld-nfcqr-link). Pictures:
[`docs/backlog/mockups/a796-handheld-payments/`](../../backlog/mockups/a796-handheld-payments/),
drawn in HTML with the apps' colour and spacing tokens, not screenshots; each is labelled "today" or
"proposed — drawn". The generator is kept outside the repository.

File references are to `main` at `d175118ed`. **(read)** marks a conclusion from reading code, not
from running it. Nothing in the product was run for this design; every statement about today's code
is (read). Part of the reading was done by search helpers; the citations this design leans on
(the retry rule, the reader checks, the profile defaults, the table screen's pay section) were
re-read line by line before being written here.

**Words.**
- A **handheld** is a waiter's phone running the till app. Its device **profile** is the list of
  things the venue lets that kind of device do (take orders, take cash, use the card reader…).
- A **card reader** (Spanish _datáfono_ or _lector_) is the card machine Waitron drives over the
  internet, such as a SumUp Solo. A card **typed on another machine** is one taken on a terminal
  Waitron does not talk to, recorded by hand ("hand-keyed").
- A phone **holds** a reader when the server has it down as that phone's reader. Only one device
  holds a reader at a time.
- A **bill** is what one group pays and gets one simplified invoice for; a **bill payment** is one
  of several payments taken against a bill before it is fully paid (the bill payments design of
  2026-09-26).
- A **submission id** is a random id the phone attaches to a payment request, so that sending the
  same request twice is recognised as one payment.

---

## 1. Summary

The owner decided on 2026-09-18 that a waiter carries a card reader to the table and settles the
bill there from the handheld. **Most of the machinery already exists**: a phone can pick up a reader
by NFC sticker, QR sticker or list, a table's bill can be paid in shares on the reader the phone
holds, retries never charge twice, and a reader cannot be taken while it is charging. What is
missing is the path a waiter actually walks: the ready-made handheld profile cannot use a reader at
all, a whole bill on the table screen can only take a typed card, the payment dialog never says which
reader it will ask, nothing confirms the reader in the waiter's hand, an uncertain card never
refreshes, and the table does not close afterwards. This design fills those gaps with no database
change, and asks the owner four questions.

## 2. What works today

### 2.1 Picking up a reader (W100 #1332, W102)

- **One holder per reader.** The holder is a row in `card_reader_holders`, keyed on the reader
  (`packages/payments/drizzle/0006_device_reader_equipment.sql:1-7`). A device can pick only a
  reader on its profile's list that is switched on and paired
  (`packages/payments/src/device-readers.ts:288-301`); the list is set on the dashboard's Device
  profiles page (`setProfileReaderList`, `device-readers.ts:63`, called from
  `apps/dashboard/src/screens/device-profiles-screen.ts:1471`).
- **Three ways in**, all through the Equipment dialog (`apps/till/src/widgets/equipment-dialog.ts`):
  a list, a QR camera decoded with `jsqr` (`equipment-scanner.ts:3`), and Web NFC (`equipment-dialog.ts:33-35`).
  Once NFC is allowed, a tap on a sticker picks the reader up from any screen while the dialog is
  closed (`apps/till/src/state/equipment-nfc.ts:35-42`; `till-app.ts:2567-2612`) and shows "Has
  recogido {item}" (`till-app.ts:8211-8216`).
- **Taking a reader another phone holds.** A scan takes it at once; a list pick asks "¿Quitar
  {item} a {device} ({person})?" first (`packages/shared/src/equipment-takeover.ts:8-9`;
  `equipment-dialog.ts:379-381`). A reader with a payment running cannot be taken, by either path
  (`device-readers.ts:302-304`, answered `reader.payment_in_progress`). The phone that lost it
  learns on its next equipment read, every 15 seconds while someone is signed in
  (`apps/till/src/state/equipment-poll.ts:4`; `till-app.ts:7944`), and shows "{device} se ha
  llevado {item}".
- **Nothing is remembered beyond the holding.** A phone keeps holding its reader through sign-outs;
  only disabling or deleting the device releases it (`apps/server/src/device-delete.ts:183`,
  `:201`). No "last reader used" is stored anywhere (searched with
  `git grep -n -i "lastReader\|last_reader\|recentReader" -- apps packages`, no hits).
- **Not shown:** whether a reader is reachable, or its battery; the battery only raises a
  dashboard alert (`apps/server/src/alert-sources.ts:706-717`).

### 2.2 Paying a table's bill on the phone

- **Floor → table → Cuenta.** A handheld has two screens, Floor and Order
  (`apps/till/src/built-in-screens.ts:7`). The table's bill is in the "Cuenta" panel; its pay
  section shows whenever the bill still owes (`apps/till/src/screens/till-table-order-screen.ts:3448`).
- **The whole bill can only take a typed card, on any device.** The pay section's whole-bill widget
  is `till-tender-pay` with no card provider (`till-table-order-screen.ts:3471-3478`; no
  `cardProvider` anywhere in that file), whose default is `"none"`
  (`apps/till/src/widgets/tender-pay.ts:266`), so its card button opens the typed-card form
  (`tender-pay.ts:592-594`). **The reader is reachable only through the part-payment buttons**
  under it — Pagar artículos, Aportar una cantidad, Dividir a partes iguales
  (`till-table-order-screen.ts:3545-3556`) — or "pay the rest" once part is paid (`:3494`).
- **The part-payment dialog** ("Cobrar parte de la cuenta", `apps/till/src/widgets/bill-pay-dialog.ts`;
  picture 1) offers the three ways, cash only where the profile takes cash (`till-app.ts:8445-8446`;
  dialog `:1222-1238`), and card. Card goes to the reader the phone holds: the dialog is handed only
  that one reader (`till-app.ts:403-406`, `:7956-7960`) and shows a reader choice only with two or
  more (`bill-pay-dialog.ts:1304`), so **it never names the reader it will ask**. With no reader held,
  or a profile without the reader action, the same "Tarjeta" silently becomes the typed-card form
  (`till-app.ts:8449-8451`; `bill-pay-dialog.ts:1259`).
- **While the card is at the reader** the dialog shows one muted line, "Acerca o inserta la
  tarjeta…", disables its buttons and cannot be closed; it has no Cancel (`bill-pay-dialog.ts:818`,
  `:1518-1521`; `grep -n card.cancel` finds none in the file). A decline or a network refusal
  stays on the confirmation with today's wording (`till-app.ts:12163-12169`).
- **After a payment** that leaves money owing, the dialog stays open, says "Pago cobrado." and
  resets its form (`till-app.ts:12182-12194`). The payment that completes the bill issues the
  invoice, closes the dialog and shows the full ticket view (`till-app.ts:12173-12176`).
- **Several guests at once.** A card at the reader reserves its amount; cash, or a second card on
  another reader, may be taken against what is left (`apps/server/src/working-order.ts:4842-4843`;
  bill payments design §5.2). The bill's dialog shows the reserved amount and lists each payment
  with its state (`bill-pay-dialog.ts:960-963`, `:912-916`).
- **The table does not close by itself.** Full payment settles the bill only
  (`apps/server/src/bill-payments.ts:749-754`); the table is freed by "Cerrar mesa"
  (`till-table-order-screen.ts:3648`, `POST /api/parties/:id/finish`, `apps/server/src/parties.ts:677-687`).

### 2.3 No double charge, and what happens when something drops

- **The server, not the phone, drives the reader.** The payment is written as pending first, then
  the provider is called with no transaction open, then settled (`bill-payments.ts:1308-1317`,
  `:1358`). A phone that loses Wi-Fi does not stop a card that is already at the reader.
- **A repeated request is answered, never charged again.** The phone resends an unanswered payment
  (twice, 500 ms apart, within a 150-second limit: `apps/till/src/state/draft-sync.ts:78`,
  `:110-131`) under the same submission id (`apps/till/src/state/bill-payment.ts:128-149`;
  `till-app.ts:12120`). The server finds the first payment by that id and returns its state without
  calling the provider again (`bill-payments.ts:1049-1056`, `:1343-1353`); Stripe is also given one
  idempotency key per bill payment (`packages/payments-stripe/src/provider.ts:167-168`). After the
  limit the dialog says the payment "puede haberse cobrado o no" and that pressing Cobrar again
  "no se registrará dos veces" (`bill_pay.unconfirmed`, `apps/till/src/i18n/strings.ts:2946`).
  A526 (#1579, `c7200b024`) added the matching check for a placed counter order
  (`refusePlacedPaymentInFlight`, `apps/server/src/till-sale.ts:1392`), not for bill payments.
- **That id lives only in the page's memory** (`till-app.ts:2640`). An app-driven reload waits for
  it (`till-app.ts:1410-1422`), but a phone that kills the browser loses it.
- **A reader that stops answering.** Stripe's reader is polled up to 60 times, a second apart
  (`provider.ts:65-66`); an unanswered or failed poll leaves the payment "attempting"
  (`provider.ts:303`, `:311-315`, `:181-189`). A764 (#1818, `737ae86fd`) resolves such payments
  automatically; the bill payment loop re-checks pending bill payments every minute and files the
  ones the provider reports charged (`apps/server/src/bill-payments-loop.ts:95-145`;
  `BILL_PENDING_RECHECK_MS`, `apps/server/src/boot.ts:498`). Until then the amount stays reserved
  and the phone shows "El pago con tarjeta sigue en curso…" (`bill_pay.card_pending`). **The phone
  never re-reads by itself**: the bill is read again only on opening the dialog, after an answer or
  after a refusal (`till-app.ts:12053`, `:12194`, `:12233`).
- **Taking a reader mid-charge, and the same phone twice.** The payment's first write checks, in
  the same transaction, that this phone holds the reader and no **other** device is charging on it
  (`packages/payments/src/store.ts:124-141`, `reader.not_held` / `reader.payment_in_progress`). The
  busy check skips the phone's own payments (`device-readers.ts:97-112`), so one phone could start
  a second charge on its own reader while the first is still running (W100's owner question Q6,
  `docs/backlog/till.md`).

### 2.4 Receipts, cash and the drawer

- **The receipt prints on the paying phone's receipt printer**, automatically where the department
  prints receipts automatically (`apps/server/src/receipt-print.ts:274-278`; the invoice is filed
  under the paying device, `bill-payments.ts:1259-1260`). That printer is the phone's own choice or
  its profile's default, or a portable printer it holds. With none, nothing prints. The automatic
  print checks no profile action (read: `print-receipt` is checked only by the explicit
  print, reprint and delivery routes, `grep -n '"print-receipt"' apps/server/src/*.ts`).
- **No digital receipt for a simplified invoice.** Email exists only for full invoices
  (`apps/server/src/invoice-delivery-actions.ts:136`); the receipt's QR is the tax agency's
  verification link (`till-sale.ts:335-342`).
- **A card on a connected reader never opens the drawer** (`takeReaderBillPayment`,
  `bill-payments.ts:1322-1409`, queues none; test `apps/server/src/bill-payments-api.test.ts:4987`).
  Cash opens one only when the profile allows it and the printer has a drawer
  (`receipt-print.ts:66-74`).

### 2.5 The ready-made handheld profile

The profile a new venue gets for phones, "Móvil", allows taking orders, typed cards, preparing,
handing over and clocking in — **not** the card reader, cash or printing receipts
(`packages/layouts/src/device-profile.ts:110-116`, `:145-148`). So out of the box a waiter's
phone cannot take a reader payment until a manager adds "integrated-card-payment" to Móvil and puts
the readers on its list.

## 3. The flow

Worked example throughout: **Mesa 4, three guests, 62,40 €**, split equally (20,80 € each). Ana's
phone holds Lector 2.

1. **From the floor to the bill.** Ana opens Mesa 4 and presses Pay (A797's handheld order view,
   or today's Cuenta panel). Pay opens the payment sheet; there is no separate whole-bill widget on
   a handheld (default 1).
2. **Choose how it is paid** (picture 2, left). Four ways: **Toda la cuenta** (new: everything left,
   in one payment, through the same bill payment path), Pagar artículos, Aportar una cantidad,
   Dividir a partes iguales. Then the method: **Tarjeta**, **Efectivo** (only where the profile takes
   cash, question 2), and **Otro datáfono** (today's typed card, now chosen on purpose; default 2).
3. **The reader is named** (picture 2). Under Tarjeta, one line: "Lector 2 · Lo llevas tú ·
   Cambiar". With no reader held, the line says so and opens the pick-up panel (step 4) instead of
   falling back to a typed card.
4. **Pick up or change the reader without leaving the payment** (picture 6). The panel listens for
   an NFC sticker while open, has one QR camera button, and lists the profile's readers with who
   holds each and which are busy. The reader this phone held last comes first, marked "El último
   que usaste", and **nothing is selected until the waiter taps one** (owner decision O4; default 4).
   Taking a reader another phone holds keeps today's rules (default 5).
5. **Tip.** Unchanged: where tips are switched on, the card form has today's "Propina con tarjeta
   (opcional)" field and cash offers "Dejar de propina". Who a tip belongs to, the venue setting and
   everything after the payment are A793's design (not approved; back to brainstorm,
   [2026-10-18-a793-tips-design.md](2026-10-18-a793-tips-design.md)). This design only keeps the
   seam: the till asks for the tip before the card is charged.
6. **Confirm** (picture 2, right). The amounts as today, the reader line again, and a button that
   says both: "Cobrar 20,80 € en Lector 2". Question 1 decides whether one more check happens here
   (pictures 3–5).
7. **The card at the table** (picture 7, left). Ana hands the reader to the guest. The sheet shows
   "Acerca o inserta la tarjeta…", the amount and the reader in large type, and how long it has been
   waiting. A decline keeps today's words and offers "Reintentar en Lector 2" (picture 7, right).
8. **Cash** (where allowed): today's cash step — cash handed over, change, "Dejar de propina".
   No drawer opens on a handheld, because Móvil never has "open-cash-drawer" in any option of
   question 2.
9. **The next guest** (picture 9, left). After a share the sheet stays open, as today, and offers
   **"Cobrar al siguiente (2 de 3)"**, keeping the split and lowering the count (default 9).
10. **The table paid** (picture 9, right). The payment that completes the bill issues the invoice
    as today. On a handheld, a short paid screen replaces the full ticket view: the payments, where
    the receipt printed ("Ticket impreso en Barra", with Reimprimir where the profile prints), and
    **Cerrar mesa** (default 10; question 3 decides whether the table closes by itself instead).
11. **Back to the floor.** Cerrar mesa does what today's does: it ends the party and leaves its
    tables needing clearing (`closeParty` → `leaveForClearing`, `apps/server/src/parties.ts:697-730`).

## 4. Edge cases

- **Two waiters want the same reader.** Today's rules stay (default 5): a scan takes it, a list
  pick asks, a reader mid-charge cannot be taken, and the payment's own first write refuses a phone
  that no longer holds the reader (`store.ts:135-136`) — so Ana's Cobrar after Marc scanned Lector 2
  answers "Este dispositivo ya no tiene ese lector…" and charges nothing, and her sheet opens the
  pick-up panel. Question 1 covers the case the server cannot see: Marc walks off with Lector 2
  **without** scanning it.
- **The reader goes offline mid-payment** (picture 8, left). The server keeps the payment pending
  and its 20,80 € reserved until the provider says what happened (§2.3); the other guests can still
  pay. New: the sheet says plainly "Aún no sabemos si se ha cobrado. No cobres a este cliente de otra
  forma todavía", and re-reads the bill every 5 seconds while a payment it shows is pending, so it
  turns into "Pago cobrado" or a failure without anyone reopening it (default 7). The reservation
  already stops the bill being overpaid; the warning is there because the same guest paying again in
  cash would still be charged twice in person. A payment nobody can settle stays for a manager on the
  dashboard's card payments screen, as today.
- **The phone loses Wi-Fi mid-payment** (picture 8, right). The card carries on, because the server
  drives the reader. The phone resends under the same submission id and gets the first payment's
  answer (§2.3); after 150 seconds it shows today's "puede haberse cobrado o no" message, and the
  button, renamed "Comprobar de nuevo", resends under the same id again. If the browser was killed
  and the id lost, the reopened sheet shows the payment "En curso" with its amount reserved, and
  default 6 stops the same phone starting a second charge on the same reader while it runs.
- **Several guests pay at once**, on two phones and two readers, or one by card and one in cash:
  allowed today against what is left after each reservation (§2.2). The invoice is issued by
  whichever payment completes the bill.
- **The bill changes while a card is at the reader.** Adding or changing dishes on that bill is
  refused until the card finishes (`order.payment_in_flight`, bill payments design §5.2).
- **An iPhone.** No Web NFC in Safari (Provenance), so the QR camera and the list.
- **The venue's Wi-Fi is down altogether.** A handheld cannot reach the box, so it cannot sell; the
  counter's fallbacks (a standalone terminal, cash) apply (`CLAUDE.md` §5). Out of scope here.
- **A guest wants their own receipt for their share.** One bill gets one simplified invoice at full
  payment; a guest who needs their own splits their dishes onto a separate bill first (A803). No
  change here.
- **Refunds** are out of scope. Today's refund action on a received payment works on a handheld
  where the person may refund (`sale.refund`, or a manager's PIN) and the profile allows the
  payment's method (map row `till-api.profile-actions.test.ts:88`).

## 5. Data, routes and permissions

**No migration.** Nothing new is stored on the server. The one new remembered fact — the last reader
this phone held — is kept on the phone (default 4).

**Routes used, all existing:** `GET /api/working-orders/:id/payments` (the bill's balance, now also
polled while a payment is pending), `POST …/payments/preview` and `POST …/payments`
(`apps/server/src/bill-payments-api.ts:202-247`); `GET` and `PUT /api/device/equipment` for pick-up
(`apps/server/src/device-api.ts:370-397`); `POST /api/parties/:id/finish` for Cerrar mesa
(`apps/server/src/till-api.ts:2719-2738`, which needs the `take-orders` action).

**Server changes, both small:**
- A phone may not start a card payment on a reader where its **own** earlier payment is still in
  progress (default 6): the start check in `assertReaderStartable` stops skipping the phone's own
  payments. The takeover check is unchanged.
- The seeded Móvil profile follows question 2 (`DEFAULT_PROFILE_CAPABILITIES`, a provisioning seed;
  before go-live an existing venue is reset rather than migrated, `CLAUDE.md` §3), and a newly
  adopted reader joins the list of every profile that takes reader payments (default 14).

**Permissions.** The person needs `sale.take_payment` (`bill-payments-api.ts:224`); STAFF have it
(`packages/identity/src/permissions.ts:45`). The device's profile needs the action for the method,
as the route-to-action map at the top of `apps/server/src/till-api.profile-actions.test.ts` records:
row `:87`, `POST /api/working-orders/:id/payments` — `take-cash` / `hand-keyed-card-payment` /
`integrated-card-payment`; rows `:101-102` — `print-receipt` for Reimprimir; picking up a reader
needs no action (`:135-137`, "choosing equipment is not printing, paying or opening the drawer").
`open-cash-drawer` is not involved: a reader card opens no drawer, and Móvil has no drawer action.

**Build slices** (each one pull request, for the plan to refine):
1. Móvil's seeded actions (question 2), new readers joining reader-taking profiles, and the
   same-phone start refusal.
2. The pay sheet on a handheld: Toda la cuenta, the named reader line, Otro datáfono, the confirm
   button naming the reader, and question 1's check.
3. Pick-up inside the sheet, with the remembered reader.
4. The waiting, uncertain and Wi-Fi states, with the 5-second re-read.
5. Cobrar al siguiente, the paid screen and question 3's close.

## 6. Tap-to-Pay

**What it is:** the phone itself takes the card, with no reader. **What exists:** a server-side
Stripe provider for it, `StripeOnDeviceProvider` (`packages/payments-stripe/src/device-provider.ts:48`),
which no app builds (`grep -rn StripeOnDeviceProvider apps` prints nothing), whose real client throws
because the charge "runs in the device SDK"
(`packages/payments-stripe/src/stripe-device-client.ts:23`), and the till's
`stripe_on_device` branches, which the server never sends (`apps/server/src/till-setup.ts:90-92`).
The bill route refuses offline acceptance "until the Tap to Pay work enables it"
(`bill-payments-api.ts:133-135`).

**What it would take:**
- **A native app.** Stripe ships Tap to Pay only in its iOS, Android and React Native Terminal SDKs
  (Provenance); a web page cannot call them. The till would need an installable Android app that
  wraps the web till and carries the SDK — a new thing to build, sign and update on every handheld.
- **A Stripe account.** The deli's reader is SumUp; whether SumUp offers an equivalent to a web or
  wrapped app was not verified.
- **Recovery rules.** The on-device provider writes its payment row only after the money moves
  (`device-provider.ts:43-47`), which breaks the bill payment loop's rule that no row means no
  charge (`bill-payments-loop.ts:101-108`); a crash in between leaves a charge only reconciliation
  finds. The bill payments design already says such a payment would go to a manager (§5.4).
- **Spain.** Stripe lists Spain as generally available for Tap to Pay on iPhone, and only in
  public preview for Tap to Pay on Android (Provenance).

**Proposal: a later slice** (question 4), not part of this one.

## 7. What this design does not do

- Change how tips work (A793), refunds, or the counter's payment window (A739).
- Add a digital receipt, or a guest paying from their own phone (A508, parked).
- Show a reader's battery or reachability in the list (W100's Q7 default stands).
- Cancel a card at the reader from the phone (default 8).
- Change the bill and table model (A803) or the handheld's screens (A797); it uses both.

## 8. Decided by default (owner may overrule)

1. **On a handheld, every payment goes through the bill payment path**, with a new way, **Toda la
   cuenta**, for the whole remaining bill, so the reader is reachable for a whole bill. (The counter
   gets the same through A739.)
2. **The card line always names the reader**, and a typed card is an explicit third method, **Otro
   datáfono**, never a silent fallback.
3. **Pick-up happens inside the payment sheet**, with today's three ways, instead of sending the
   waiter to Equipment.
4. **The remembered reader is the last one this phone held**, kept on the phone, shown first and
   labelled, never selected.
5. **Takeover rules stay as built**: scan takes, list asks, busy refuses.
6. **One charge per phone per reader at a time**, enforced by the server.
7. **An uncertain payment refreshes itself** every 5 seconds while the sheet shows it, and says not
   to take the same guest's money another way.
8. **No Cancel button while the card is at the reader**: no route cancels a bill payment at the
   reader today.
9. **"Cobrar al siguiente"** after a share, keeping the way chosen.
10. **A short paid screen replaces the full ticket view on a handheld.**
11. **Receipts keep today's rules**: the paying phone's receipt printer, automatic where the
    department prints automatically; no digital receipt.
12. **Tips: A793's seam only**; the till asks before the card is charged, as today.
13. **Whether the sheet sits at the foot of the screen** (as drawn) or stays a centred dialog is
    left to the plan; it is the shared `wt-dialog` either way.
14. **A newly adopted reader joins every profile that takes reader payments**; a manager can take
    it off.

## 9. Questions for the owner

Ask in this order. "All recommended" is a complete answer.

**Q1. Should the phone ask which reader is in the waiter's hand before every card payment?**
Example: Mesa 4, three guests, 62,40 €. Ana's phone still holds Lector 2 from the last table, but
Marc picked Lector 2 up from the bar without scanning it and is now at Mesa 9. Ana presses "Cobrar
20,80 € en Lector 2": with no check, Marc's guest at Mesa 9 sees 20,80 € on the reader.
- (a) **One tap on the reader's name** before every card ("¿En qué lector?" → "Lector 2"), or a tap
  of its sticker (picture 3).
- (b) **Tap or scan the reader's sticker** before every card (picture 4).
- (c) **No check**: charge the reader the phone holds, as today, now named on screen (picture 5).

Recommended: **(a)** — it is your 2026-09-18 rule (a remembered reader is offered, never chosen
silently) for one tap, and still works on an iPhone.

**Q2. What should the ready-made handheld profile (Móvil) allow on a new venue?**
Example: a new venue with no counter till. Ana takes Mesa 4's 62,40 € at the table. Today she
cannot use the reader until a manager changes Móvil on the dashboard; the third guest's cash has to
go to a till the venue does not have.
- (a) Card reader and receipts, **no cash** (picture 13, left).
- (b) Card reader, receipts **and cash**; never the drawer (picture 13, middle).
- (c) **As today**: typed cards only (picture 13, right).

Recommended: **(b)** — you decided any device does everything a till does except the drawer, and
that venues start with no tills.

**Q3. When the last bill of a table is paid at the table, should the table close by itself?**
Example: Mesa 4's third guest pays the last 20,80 €. The three are still finishing their coffee.
- (a) **A big "Cerrar mesa" on the paid screen**; the waiter presses it as they leave (picture 10).
- (b) **Close automatically**; the table shows as needing clearing at once (picture 11).
- (c) **As today**: the ticket view, then reopen the table and find Cerrar mesa at the foot of its
  Cuenta panel (picture 12).

Recommended: **(a)** — one tap, and a table with guests still at it never looks empty on the floor.

**Q4. Tap-to-Pay (the phone itself takes the card, no reader): when?**
Example: a busy Saturday, both readers are in use, and Mesa 4 wants to pay 62,40 € by card now.
- (a) **A later slice**, built when a venue wants it; it needs an installable Android app around the
  till and a Stripe account (§6).
- (b) **Next after this slice.**
- (c) **Drop it**, and delete the unused on-device code.

Recommended: **(a)** — it is a new app to ship and keep on every phone, the deli's reader is SumUp,
and Stripe's Android version is still a preview in Spain.

## 10. Provenance

| Claim | Source (read 2026-10-19 with `curl`, text grepped) | Its words |
| --- | --- | --- |
| Web NFC is Chrome for Android only | MDN browser-compat-data, `https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/NDEFReader.json` | `"chrome_android": {"version_added": "89"}`; `"chrome"`, `"firefox"`, `"safari"`: `"version_added": false`; `"safari_ios": "mirror"`; status `"experimental": true` |
| Scanning needs one user gesture; NFC pauses when the page is hidden | `https://developer.chrome.com/docs/capabilities/nfc` | "It was only called in response to a user gesture such as a touch gesture or mouse click."; "All NFC operations are automatically suspended when document is hidden." |
| Stripe's Tap to Pay is in its native SDKs only | `https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=android` and `?platform=ios` | "Stripe includes Tap to Pay on Android in the Terminal Android SDK and the Terminal React Native SDK, and enables payments directly in your Android mobile app."; "Stripe includes Tap to Pay on iPhone in the Terminal iOS SDK and the Terminal React Native SDK, and enables payments directly in your iOS mobile app." |
| Spain: iPhone generally available, Android in preview | the same two pages | iPhone page: "Availability Australia Austria … Spain Sweden …"; Android page: "Availability in Public preview Bulgaria … Slovenia Spain" |
| SumUp offers Tap to Pay to a web or wrapped app | — | **unverified**: the two SumUp developer addresses tried answered "Page not found" |
| A SumUp Solo lets the guest cancel on the reader | — | **unverified**; not relied on (default 8) |

Earlier readings of the same Web NFC facts, with the sticker and metal findings, are in
[2026-09-18-handheld-and-till-hardware-decisions.md](2026-09-18-handheld-and-till-hardware-decisions.md)
§3 and §8.
