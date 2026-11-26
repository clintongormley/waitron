# Till redesign: payment after Pay's opening screen (lane O) · PLAN FOR APPROVAL

What staff get when this is done: every screen after Pay's opening screen, on a phone or a till, is
the approved full-screen design: the device sheet, the full invoice's details, cash, the reader,
Paid, the guest's bill and tip, and pass 3's ways to pay (Split equally, Items, An amount, Other card
machine), with the venue's other card machines chosen from a list kept on the dashboard.

Sources: [spec §7 (its look in §7.10 and §7.11), §11, §12, §13 and §14.5](../specs/2026-11-26-till-handheld-redesign-design.md#7-payment);
rows 16–21b of the [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md), moved to lane O by
the watcher at 21:25 on 26 November (lane I's `questions.md`, recording the owner's "1"). Pictures,
never committed: `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/`. This page
sets only the order and the cuts. Each PR gets its own one-page plan, a Claude read and the
watcher's clearance before it is built. That plan names the frame for every element, says whether
it covers Counter, and updates the English and Spanish guides and `design-system.md`. Its pictures
go beside the frames with the differences listed before the owner sees them.

## The PRs, in order

Lane I builds Pay's opening screen in three PRs: 15 (a table's Pay), 15b (Counter's Pay, and Pay
inside the order's column on a wide till) and 15c (Charge and Cash act at once, and the receipt's
number of diners and the "own receipt?" question move onto Pay). None is on `main` yet. Every
screen below opens where Pay opens, so its Counter and wide-till versions wait for 15b.

| PR | Staff can use | Frames | Waits for | Lands |
| --- | --- | --- | --- | --- |
| O1 Machine list | A manager keeps the venue's other card machines on the dashboard's card readers page: a name, and where its payments go (the venue's SumUp account, offered only while SumUp is connected, or another bank). Nothing changes for staff until O13. | none (design-system Forms) | nothing | lane O |
| O2 Split equally: shares | Set the guests with − and +, see every share at once (the first shares carry the extra cent), and charge "Guest 1 of 3" with the list of who has paid. Until 15c, the charge still goes through today's confirmation step. | `ba` 1, 3 | I 15 | lane O |
| O3 Split equally: between guests | What the last guest paid, "Next: Guest 3", the slip and "Change the number of guests". The till keeps the split from guest to guest, as the phone already does. | `ba` 4 | O2 | lane O |
| O4 Device sheet (16) | Pay's top-right button opens a sheet with the camera on; several stickers scan in a row ("Picked up Reader 3"); under it one dropdown per device this payment uses, the cash drawer only where the device's profile may open one. Tapping a device keeps working on any screen. | `r` 1–3 | I 15 | lane O |
| O5 Invoice details (17) | The full-invoice screen, tax number first, with today's places to send it, opened from "Full invoice instead" and from the bill's menu. | `q` 4 | I 15; D 13b for the bill's menu | lane O |
| O6 Invoice on any printer | The invoice's Print choice lists every printer, A4 and receipt alike, office first. | `q` 4 | O5 | owner |
| O7 Cash (18) | The amount large, Exact and the next notes up, a keypad, the change large, and "Took €90.00 · give €9.48". The keypad is shared with O11 and O12. | `ah` 3 | I 15c | lane O |
| O8 At the reader (19) | The amount and reader large with the time waited, nothing to press until the reader answers; a decline offers Try again; an unknown outcome keeps checking; a split goes on to the next guest. | `k` 3 | I 15c | lane O |
| O9 Paid (20) | One Paid screen for every payment: what was taken and how, where the receipt went (or why not, with a fix), what is still owed with "Pay Bill 2 · Ana" and "Back to Table 4", and "Print payment slip" once. Email is offered only where the box can send it. | `k` 4 as §7.11 redraws it | O8 | lane O, or owner if its plan changes when a full invoice can be chosen after paying |
| O10 Items: whole dishes | Tick the dishes a guest pays for, part of a row of identical dishes with − and +; a dish sold by weight is paid whole; Paid shows the new bill and what is left. | `bb` 1–3 | O9 | lane O |
| O11 Items: dishes with options | A dish with options can be paid for one at a time like any other. | `bb` 1 | O10 | owner, unless its plan shows the receipts' lines are unchanged |
| O12 An amount | Type the amount and watch "Still to pay after this"; "Their own receipt" is a switch on the same screen, off to start with; "Add a tip" is a small link for the waiter; Paid shows the bill and its payments. | `bc` 1–2 | O7, O9 | owner |
| O13 Other card machine | The amount to type on the machine, three steps, the machine chosen from O1's list (starting on the one this phone used last), the operation number in view, "It went through" and "It was declined" (back to Pay, nothing recorded). | `bd` | O1, I 15c | lane O |
| O14 Guest's bill (21a) | On a table with tips switched on, Pay first shows the guest the bill in its customer-facing names and the receipt's language, with a language choice and Skip for the waiter. | `ah` 1 | I 15 | lane O |
| O15 Guest's tip, whole bill (21b) | The guest chooses 5, 10 or 15% or types a total; the tip travels once, apart from the bill, through Cash, Card and a bill already printed and handed over. | `o` 2–3 | O7, O8, O14 | lane O, or owner if a printed bill's tip changes its receipt |
| O16 Guest's tip on a share | Each split guest, and each Items guest, is asked on their own share; a tip the table agreed is divided into the shares; Remove tip on a share. | `ba` 2 | O3, O10, O15 | lane O |

Why this order: O1 is the one piece that can be built before lane I lands anything. Split equally
needs least from 15c, so it comes first of the screens that open from Pay. Cash, the reader and Paid
wait for 15c because it moves the questions off today's confirmation step, which those screens
replace. Items and An amount reuse Paid's layout and the keypad. The guest's tip comes last because
it has to travel through every way to pay. O14 can move up if wanted; on its own it shows the bill
and "No tip · hand back to your waiter".

## What this plan proposes

1. **The machine list, and what a payment keeps.** The list is part of the payments settings
   document (`packages/payments/src/settings.ts:13-46`): no new table and no migration. Each machine
   has a fixed id. The till sends the id; the server looks up the machine's name and where its money
   goes, and stores copies in the payment's existing `external_machine` and `external_provider`
   (`packages/payments/src/manual.ts:45-64`), so renaming or removing a machine never changes a
   past payment and SumUp's matching keeps reading the same field
   (`packages/payments-sumup/src/reconciler.ts:123`). Today the till sends both as free text
   (`apps/server/src/outside-card.ts:7-28`). O1's plan says whether the list goes with a venue's
   configuration export, as `tipsEnabled` does (`settings.ts:16`).
2. **The cash drawer follows the device's profile on every device, a phone included** (the owner's
   "2 y" to the watcher's question, lane F `questions.md`, 17:20 on 26 November). The server already
   decides it that way (`apps/server/src/receipt-print.ts:217-220`), so O4 and O7 do not change who
   may open the drawer. §7.9's last sentence ("and a phone's never") disagrees with that answer; O7
   adds a dated note beside §7.5, §7.8 and §7.9, unless the watcher says §7.9 wins.
3. **Who lands what.** O6 changes which printers the server accepts for a full invoice (today the
   device's own A4 printer, or receipt paper: `apps/server/src/invoice-choice-delivery.ts:39-64`).
   O11 changes which lines can move to a bill with its own receipt. O12 makes "their own receipt"
   start as No, where today the waiter must answer before taking the money
   (`apps/till/src/widgets/bill-pay-dialog.ts:2306`). Each of those changes when a receipt or invoice
   is issued, so the owner lands it. Every PR here touches cards, cash, the drawer or receipts, so
   each takes the full review with two run-it reviews.

## A question for the owner, through the watcher

**Cancelling a card at the reader.** The reader screen the owner approved has nothing to press
(§7.6 and §7.8). Since 21 November staff can cancel a SumUp card payment that is still waiting
(PR #3959). Keep that as a small link on the new reader screen, or remove it? I recommend keeping
it, listed as a difference from `k` 3: it was added after the owner's own report on 20 November
([its plan](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-21-cancel-waiting-card-payment.md) names it), and the approved picture may simply
not have shown it.

Each PR aims at about three hours. O4, O9 and O15 are the likeliest to run over; their plans say
how they would split.
