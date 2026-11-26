# Till redesign: payment after Pay's opening screen (lane O) · PLAN FOR APPROVAL

What staff get when this is done: every screen after Pay's opening screen on a phone or a till is
the approved full-screen design — the equipment sheet, the full invoice's details, cash, the reader,
Paid, the guest's bill and tip, and pass 3's ways to pay (Split equally, Items, An amount, Other card
machine), with the venue's other card machines picked from a list kept on the dashboard.

Sources: [spec §7, §12 and §13](../specs/2026-11-26-till-handheld-redesign-design.md#7-payment); rows
16–21b of the [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md), moved to lane O by the
watcher at 21:25 on 26 November (lane I's `questions.md`, owner "1"). Pictures, never committed:
`~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/`. This page sets the order and
the cuts only. Each PR gets its own one-page plan, a Claude read and the watcher's clearance before
it is built; that plan names the frame for every element, and its pictures go beside the frame with
the differences listed before the owner sees them.

## The PRs, in order

Lane I builds Pay's opening screen as PR 15 (table), 15b (Counter and the wide order column) and 15c
(Charge and Cash act straight away; the guest-count and own-receipt questions move into Pay). None is
on `main` yet, so the first PR here needs nothing from them.

| PR | Staff can use | Frames | Needs on `main` | Lands |
| --- | --- | --- | --- | --- |
| O1 Other card machines | A manager keeps the venue's other card machines on the dashboard's card readers page: a name, and where its payments go (the venue's SumUp account, offered only while SumUp is connected, or another bank). Today's Other card machine form then offers that list instead of the typed name and the "Card taken on" choice; with no machine on the list it stays as today. | none for the dashboard (design-system Forms); `bd` for the dropdown | nothing | lane O |
| O2 Split equally | Set the guests with − and +, see the shares at once (first shares carry the extra cent), charge "Guest 1 of 3" with the list of who has paid, and between guests see what the last one paid, "Next: Guest 3", the slip and "Change the number of guests". The till keeps the split from guest to guest, as the phone does. | `ba` 1, 3, 4 | I 15 | lane O |
| O3 Equipment (16) | The button at the top right of Pay opens a sheet with the camera on; several stickers scan in a row ("Picked up Reader 3"); under it one dropdown for each device this payment uses. NFC pickup keeps working from any screen. | `r` | I 15 | lane O |
| O4 Full invoice (17) | A full screen with tax number first, address suggestions, then Print (one list of every printer, office first) or Email, opened from "Full invoice instead" and from the bill menu. | `q` 4 | I 15 (D 13b for the bill-menu entry) | owner (below) |
| O5 Cash (18) | The amount large, Exact and the next notes up, a keypad, the change large, and "Took €80.00 · give €6.80". The keypad is a shared piece O9 reuses. | `k` 2 | I 15c (15b for Counter) | lane O |
| O6 Reader (19) | The amount and reader large with the time waited, nothing to press until the reader answers; a decline offers Try again; an unknown outcome keeps checking; a split goes on to the next guest. | `k` 3 | I 15c | lane O |
| O7 Paid (20) | What was taken and how, where the receipt went (or why it did not, with a way to fix it), what is still owed with "Pay Bill 2 · Ana" and "Back to Table 4", and "Print payment slip" once. | `k` 4 | O6 | lane O, unless its plan moves the after-payment full-invoice choice (then owner) |
| O8 Items | Tick the dishes a guest pays for, part of a row of identical dishes with − and +, a dish with options one at a time; Paid shows the new bill and what is left. | `bb` 1–3 | O7 | lane O |
| O9 An amount | Type the amount and watch "Still to pay after this"; "Their own receipt" is a switch on the same screen; "Add a tip" is a small link for the waiter; Paid shows the bill box. | `bc` 1–2 | O5, O7 | lane O |
| O10 Other card machine screen | The amount to type on the machine, three steps, the machine dropdown starting on the one this phone used last, the operation number in view, "It went through" and "It was declined". | `bd` | O1, I 15c | lane O |
| O11 Guest bill (21a) | On a table with tips switched on, Pay first turns the phone to the guest: the bill in customer-facing names in the receipt's language, a language choice, and Skip for the waiter. | `o` 1 | I 15 | lane O |
| O12 Guest tip (21b) | The guest chooses 5, 10 or 15% or types a total; each share of a split, and each Items guest, is asked on their own share; the tip travels once, apart from the bill, through Cash, Card and a presented bill. | `o` 2–3, `ba` 2 | O2, O5, O6, O8, O11 | lane O, unless a presented-bill tip changes the receipt (then owner) |

Why this order: O1 is the one piece that can be built before lane I lands. Split equally is the
way-to-pay that needs least from 15c, so it goes first of those that open from Pay. Cash, the reader
and Paid follow 15c because 15c is what moves the guest-count and own-receipt questions out of
today's confirmation step, which the Cash and reader screens replace. Items and An amount reuse
Paid's pieces and the keypad. The guest's tip comes last because it has to travel through every way
to pay. O11 can move up if the watcher wants it earlier; on its own it shows the bill with
"Hand back to your waiter" and no tip yet.

## What this plan proposes, for the watcher to confirm

1. **Where the list of machines lives, and what a payment keeps.** A list in the payments settings
   document (`packages/payments/src/settings.ts:13-46`), so no new table and no migration, since
   nothing else points at a machine. A payment keeps what it keeps today, copied at payment time: the
   machine's name in `external_machine` and where its money goes in `external_provider`
   (`packages/payments/src/manual.ts:45-64`). Renaming or removing a machine then never changes a
   past payment, and SumUp's reconciliation keeps reading `external_provider`
   (`packages/payments-sumup/src/reconciler.ts:123`).
2. **The drawer follows the device's profile on every device**, a phone included (owner "2 y", lane F
   `questions.md` 17:20). The server already decides it that way for cash and for a hand-keyed card's
   slip (`apps/server/src/receipt-print.ts:109-116`, `:788-797`), so O3 and O5 change no authority.
   §7.9's last sentence ("and a phone's never") disagrees with that answer; O5 records a dated
   pointer beside §7.5, §7.8 and §7.9, unless the watcher says §7.9 overrides it.
3. **Cancel at the reader.** Spec §7.6 says nothing to press while the card is at the reader, but
   #3959 (2026-11-21) added Cancel payment for a waiting SumUp reader, recorded in A796's default 9.
   O6 proposes keeping it as a small link and listing it as a difference from `k` 3.
4. **Who lands what.** O4 changes which printers the server accepts for a full invoice (today only
   the device's own A4 printer, or the receipt printer as "receipt paper",
   `apps/server/src/invoice-choice-delivery.ts:39-64`), so the owner lands it. O7 and O12 go to the
   owner only if their plans change how a receipt or invoice is issued. Every PR here touches card,
   cash, drawer or receipts, so each takes the full review with two run-it reviews. O9's switch
   starts off, as §7.9 says; today the waiter must answer the question (`bill-pay-dialog.ts:2306`),
   so O9's plan names that change for the owner's picture OK.

Each PR aims at about three hours. O4, O7 and O12 are the likeliest to run over; their plans say how
they would split.
