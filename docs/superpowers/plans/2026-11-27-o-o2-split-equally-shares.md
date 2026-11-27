# O2: Split equally, the shares (lane O, TILL-REDESIGN-PAY-2)

What staff get: on a table's Pay, on a phone or a till, **Split equally** opens its own screen. The
waiter sets the number of guests with round − and + buttons and sees every share at once, the first
ones a cent more where the bill does not divide (€73.30 for 3: €24.44, €24.43, €24.43), with a note
saying so. **Start with Guest 1 · €24.44** opens that guest's Pay screen, "Guest 1 of 3": the
amount, the list of shares marking who is paying now, and the same Charge, Cash and Other card
machine as a whole bill. **Counter is not covered**: it keeps today's typed "People still to pay"
until lane I's 15b brings the new Pay to Counter. A till still forgets the split after each
payment until O3, so the screen must not assume one (see "Starting count").

**What 15c changed.** 15c (#4509), 15 (#4453) and lane N's stepper (`wt-stepper`, #4477) are on
`main`: O2 waits for nothing. Charge on "Guest 1 of 3" starts the reader at once. Only **Cash** and
**Other card machine** still open today's entry step (`#quietMethod`,
`apps/till/src/widgets/bill-pay-dialog.ts:1244-1248`) until O7 and O13.

Sources: spec §7.9–§7.11, §13 (pass 3), §14, §14.1, §14.2, §14.5; frame `ba` 1, 3 and 4's
subtitle (`html/ba-light.html`, `ba-dark.html`, `base.css`); the O2 row and "Shared pieces" of
`2026-11-26-o-till-payment-after-pay.md`.

## The money: one way to divide a bill

The server charges each share `equalShare(left, guests still to pay)`
(`packages/orders-sales/src/bill-allocation.ts:77-84`, used at line 92): what is left, divided and
rounded up to the cent. "Left" is the bill less what was received and what a card in progress holds
(line 132), the till's `balance.outstanding`. The till keeps its own copy
(`bill-pay-dialog.ts:1236-1241`) because it cannot import `@waitron/orders-sales`, which depends
on `@waitron/db`.

2026-11-27, after O2a: `equalShare` is in `packages/shared/src/equal-share.ts`, called at
`bill-allocation.ts:80`, and the till imports it; `bill-pay-dialog.ts` line numbers in this
plan predate O2a and later changes, and `bill.allocation_changed` is at `bill-allocation.ts:136-152`. The paid tick is drawn in `--wt-color-primary`, not `--wt-color-primary-text` (root `CLAUDE.md`: the primary colour paints icons). The round stepper's number is `--wt-font-size-payment-amount`, 42px, where §7.10 and `ba` 1 draw 44: the difference listed under "Pictures" below.

O2a moves `equalShare` and its tests unchanged to `packages/shared/src/equal-share.ts`, exported
from `packages/shared/src/index.ts`, and adds `equalShares(left, n)`: `equalShare` applied guest by
guest, the list the screen shows. The till's copy becomes an import of it. **The reviewer's
experiment:** 62,262 amount/count pairs compared before and after the move, 0 differences; a
control with the extra cent removed found 23,292. `equalShare` itself is unchanged and still
answers a count above the cents left (€0.02 among 3 gives €0.01); only `equalShares` refuses one,
and the stepper never asks for it.

`shareByWeight` (`packages/shared/src/share-by-weight.ts`) with equal weights gives the same lists:
€0.01 to €50.00 among 2 to 30 guests (144,565 pairs) differed 0 times, and a control that reversed
its list differed 129,599 times (run 27 November, against `main`'s money functions). The plan uses
`equalShare` because it is the function the server charges with, guest by guest on what is left;
`equalShares`' test checks it against `shareByWeight` so the two cannot drift apart.

## Who has paid

The server keeps no run of guests (each payment has only `kind` and `shareOf`,
`packages/db/src/schema/bill-payments.ts:45-46`). Today the phone counts shares paid in the dialog
(`#shareRun`, 364-372; `#offerNext`, 676-698) and ends the count on a declined card (`cardEnded`,
645-661), a refund (706-712), a typed count (1828) or any way tile (1172); a till keeps none, since
`#offerNext` runs on a handheld only (668). O2 moves this record to
`apps/till/src/state/share-run.ts` with the same ending rules, except that tapping the way already
chosen keeps it. For each paid guest it keeps the amount applied to the bill, taken from the
preview in `#take` (2161, beside `#sharePaying` at 2190; `PayTaken`, 139-148, carries no share
amount, and the quote's charged amount includes the tip), and whether it is received or a card in
progress.

**The guests sent to the server** (`#choice()`, line 774, today `Number(this.people)`) become the
stepper's count less the guests the record counts as paid, cards in progress included. The request
shape is unchanged.

## O2a: the shared pieces (changes nothing staff see)

1. **`wt-share-list`** (`packages/ui`, new; reused by O3, O9 and O16). `label` and `shares`:
   `{ name, detail, amount, state: "due" | "current" | "paid" }[]`, as an `<ol>`. Look (`ba` 1, 3):
   one card on `--wt-color-surface`, 1px `--wt-color-border`, `--wt-radius-md`, `--wt-space-3` in
   from each side; rows `calc(--wt-space-2 + --wt-space-1 * 0.75)` by
   `calc(--wt-space-3 + --wt-space-1 / 2)`, a 1px border line between rows. Left to right: a 22px
   round marker (`calc(--wt-space-5 - --wt-space-1 / 2)`); the name in `--wt-font-size-md` over
   `detail` in `--wt-font-size-sm`, muted; the amount at the end, `--wt-font-weight-bold`, tabular.
   `due`: a 2px `--wt-color-border` ring. `current`: ring and fill `--wt-color-primary`, row on
   `--wt-color-surface-lifted`, its text `--wt-font-weight-bold`, `aria-current="step"`. `paid`: a
   2px primary ring holding `check` in `--wt-color-primary-text`, text muted, amount
   `--wt-font-weight-medium`. **A card in progress is a `due` row** whose detail reads "card in
   progress": no fourth state; the words carry it, as the marker is hidden from screen readers.
   Tests first: `wt-share-list.test.ts` (each state's tokens, order, `aria-current` only on
   `current`); `wt-share-list.a11y.test.ts` and `wt-share-list.forced-colors.test.ts` (each state
   and a card-in-progress row, both themes).
2. **`wt-stepper variant="round"`** (`ba` 1, `.cnt`): separate 56px circles
   (`calc(--wt-tap-min + --wt-space-3)`), 1px border, `--wt-color-surface`; the number in
   `--wt-font-size-payment-amount`, bold, tabular, at least `calc(--wt-tap-min + --wt-space-5)`
   wide. Marks keep the stepper's colours (§14.2). Tests in `wt-stepper.test.ts` and its a11y file.
3. **`equalShare` and `equalShares`** as above; tests first in `equal-share.test.ts`.
4. `docs/developers/design-system.md` and the workbench (`packages/ui/index.html`).

About 190 production lines, 250 of tests; about three hours.

## O2b-1: the Split equally screen

`apps/till/src/widgets/split-equally.ts`, built like `quiet-pay.ts`. `bill-pay-dialog.ts` is 2,433
lines against its 2,500 cap (after O2a's few lines less): the record leaving for `share-run.ts`
(about 60 lines) pays for the switch; if not, `#nextShareLabel` (1338-1352) moves to
`split-equally.ts`.

- The tile opens it: `wt-full-screen-panel`, top bar back "Pay" and "Split equally" over "Bill 1 ·
  €73.30"; the question, muted; the round stepper; `wt-share-list`; the cent note only when shares
  differ; foot "Start with Guest 1 · €24.44". Start leads to today's Table Pay with the share's
  amount and no typed field; Back returns here.
- **Starting count.** With nothing received or held on the bill: the table's guest count (question
  2). **With money received or held and no record** (a till after any share; a phone after a
  declined card or refund once another guest has paid): 2, asking "How many guests are still to
  pay?" over "Bill 1 · €48.86 left" (as `ba` 4's subtitle), the rows numbered from Guest 1. With a
  record: its count, paid guests ticked. Every start stays within the limits: from 2 (or one more
  than the guests paid) to the guests paid plus the cents left, at most 999 (`MAX_GUEST_COUNT`,
  `packages/shared/src/guest-count.ts:2`).
- **The entry step** (Cash, Other card machine) draws no way field for a share started here
  (today `#wayFields`, 1161, draws the typed field at 1821-1831). Counter keeps it.
- Words in `apps/till/src/i18n/strings.ts`, English and Spanish (§7.18, "comensal" as 4522); the
  guides' `{#pay-window}` (`apps/server/src/guide/en/table-service.md:1017-1019`,
  `es/…:1073-1076`) and `help.payment` (`help-strings.ts:14`, 83) for a table: set the guests with
  − and +, the first shares a cent more. Counter keeps "enter how many people are still to pay".
- Tests first: `split-equally.test.ts` (parts, − and + reshare, note, limits, the three starting
  counts, **a till after one share** and **a phone after Back → Pay → Split equally**, Start's
  amount and request, the entry step's missing field) and its a11y file. **Moving tests:** 33
  places type into `people` (9 in `bill-pay-dialog.test.ts`, 8 in its a11y file, 14 in
  `till-app-handheld-pay.test.ts`, 2 in `till-app-bill-payments.test.ts`) and go through
  `splitAmong(el, n)` in `apps/till/test/bill-pay-app.ts`; 16 assertions read the field
  (`bill-pay-dialog.test.ts:3002`, 3009, 3022, 3044 and 8 more; handheld 3337, 3494, 3517, 3556)
  and go through `guestsStillToPay(el)`, which reads the unpaid rows while any row is ticked, null
  otherwise.
  The "whole number" cases (`bill-pay-dialog.test.ts:812-813`) move to Counter.

About 130 production lines, 200 of tests and 49 call sites; about three hours.

## O2b-2: the share's Pay screen

- `#quietPay` (1088-1228) with back "Split equally", "Guest 1 of 3" over the bill's name; the
  amount block reading "Share €24.44 + tip €2.44"; `wt-share-list` (paid `paid` "paid"; card in
  progress `due` "card in progress"; this guest `current` "paying now", with the server's checked
  amount; the rest `due` "to pay", from `balance.outstanding`); the same foot.
- **Gone from it, as `ba` 3:** the four way tiles (Back reaches them), and the bill's payments list
  (`#payments`, 1441) **unless the bill holds a payment that is not one of the split's**: when
  received plus held differs from what the record's guests paid (a payment taken on another
  device), the list stays. A dish added mid-split re-shares what is left; a stale amount is still
  refused by `confirmAllocation` (`bill.allocation_changed`, `bill-allocation.ts:150-164`).
- **Kept although `ba` 3 does not draw them:** "own receipt?" (`#ownReceiptAsked`, 2214-2223), the
  receipt's guest count (`#guestsShown`, 2203-2212), what a card in progress holds (1143-1149).
- On a phone, after Take the next (1354-1384, until O3), the next guest's Pay opens directly.
- Tests first, in `split-equally.test.ts`: the rows by state, the payments list with and without
  another device's payment, a dish added mid-split, Take the next. Guide: "the list shows who has
  paid".

About 100 production lines, 150 of tests; about two hours.

**Pictures** (O2b-1 and O2b-2), beside `ba` 1 and 3, never committed: 390 × 844 light and dark;
844 × 390; a till at 1280 × 800, which shows Pay full screen until lane I's 15b; English and
Spanish; 2, 3 and 7 guests; a share's Pay with one guest paid and one card in progress.
Differences listed: back "Split equally" for `ba` 3's "Split" (§7.10); + is primary; corners 8px;
row text 14/12 for the drawn 15/13, the guest number 42 for 44, the paying row 600 for 700 (§14's
size rule); the receipt questions. Lane P's finish review says "ready for the owner" first.

## Review and landing

All three take the full `/finish-branch` wave with two Codex run-it reviews, as every payment PR
in this lane does: O2a moves the division every share is charged with, O2b-1 changes where the
guests sent come from, and O2b-2 changes what a waiter sees while charging a share. **Lane O lands
all three**: none changes how a receipt or invoice is issued (request shape at line 774 and the
server's allocation unchanged). Each leaves `main` working: after O2a nothing staff see changes;
after O2b-1 Start leads to today's Table Pay.

## Questions for the watcher

1. **Cut O2 into O2a, O2b-1 and O2b-2?** Recommended: yes. Together about 420 production lines and
   600 of tests, about eight hours; the screens alone about five.
2. **The starting number of guests.** Recommended: with nothing received or held, the table's guest
   count when it is at least 2 (`receiptGuests`, `bill-pay-dialog.ts:296`, which is
   `defaultReceiptGuestCount(orderParty)` except while a payment is unconfirmed,
   `apps/till/src/till-app.ts:12000`), otherwise 2; with money received or held and no record of the
   split, 2, asking "How many guests are still to pay?"; with a record, its count. The spec does not
   say.
