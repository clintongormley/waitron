# O2: Split equally, the shares (lane O, TILL-REDESIGN-PAY-2)

What staff get: on a table's Pay, on a phone or a till, **Split equally** opens its own screen. The
waiter sets the number of guests with round − and + buttons and sees every share at once, the first
ones a cent more where the bill does not divide (€73.30 for 3: €24.44, €24.43, €24.43), with a note
saying so. **Start with Guest 1 · €24.44** opens that guest's Pay screen, "Guest 1 of 3": the
amount, the list of shares marking who is paying now, and the same Charge, Cash and Other card
machine as a whole bill. On a phone, after a share is paid and **Take the next** is pressed, the
next guest's Pay screen shows the guests already paid with a tick. **Counter is not covered**: it
keeps today's typed "People still to pay" until lane I's 15b brings the new Pay to Counter. A till
still forgets the split after each payment until O3.

**What 15c changed.** The O2 row says "until 15c, the charge still goes through today's
confirmation step". 15c (#4509) and 15 (#4453) are on `main`, and so is lane N's stepper
(`wt-stepper`, #4477): O2 waits for nothing. Charge on "Guest 1 of 3" starts the reader at once,
as on a whole bill. Only **Cash** and **Other card machine** still open today's entry and
confirmation (`#quietMethod`, `apps/till/src/widgets/bill-pay-dialog.ts:1243-1247`) until O7 and O13.

Sources: spec §7.9, §7.10, §7.11, §13 (pass 3), §14, §14.1, §14.2, §14.5; frame `ba` 1 and 3
(`html/ba-light.html`, `ba-dark.html`, `base.css`); the O2 row and "Shared pieces" of
`2026-11-26-o-till-payment-after-pay.md`.

**Split** (proposed, question 1): O2a, the shared pieces, changes nothing staff see; O2b builds the
two screens on them.

## The money: one way to divide a bill

The server divides with `equalShare` (`packages/orders-sales/src/bill-allocation.ts:77-84`): what
is left divided by the guests still to pay, rounded up to the cent, used for every share payment
(line 92). Taken guest by guest it gives the extra cents to the first shares; the test at
`bill-allocation.test.ts:55-73` checks that for every amount to €30.00 and up to 12 guests. "What is
left" is the bill less what was received and what a card in progress holds (line 132), the same
figure the till gets as `balance.outstanding` (`apps/server/src/bill-payments.ts:892`). The till
has its own copy of the division for Pay's amount (`bill-pay-dialog.ts:1236-1241`). The till
cannot import `@waitron/orders-sales`, which depends on `@waitron/db` (`packages/orders-sales/package.json`).

So O2a moves `equalShare` and its tests to `packages/shared/src/equal-share.ts`, and adds
`equalShares(left, n)`: `equalShare` applied guest by guest, the list the screen shows.
`bill-allocation.ts` imports it from `@waitron/shared`; its only caller is line 92. The till's copy
goes. The error code it throws, `management.request_invalid`, is already `@waitron/shared`'s
(`packages/shared/src/errors.ts:103`). The guest being charged always shows the server's checked
amount (15c's quote, `apps/till/src/state/table-pay-quote.ts`); the other rows are worked out from
`balance.outstanding`.

## Who has paid

The server stores each payment's `kind` and `shareOf` (`packages/db/src/schema/bill-payments.ts:45-46`)
but not a run of guests. The phone keeps the run in the dialog: `#shareRun` counts the shares paid
(`bill-pay-dialog.ts:364-366`, `#offerNext` 679-698), ends it when a card is declined (`cardEnded`,
648-662), on a refund (707-712) or a change of way; a till keeps none, since `#offerNext` runs on
a handheld only (668). O2
keeps those rules and records, for each paid guest, the amount the quote charged and whether it is
received or a card still in progress; the run moves to `apps/till/src/state/share-run.ts`.

## O2a: the shared pieces

1. **`wt-share-list`** (`packages/ui`, new; reused by O3, O9 and O16). Takes `label` (the list's
   name) and `shares`: `{ name, detail, amount, state: "due" | "current" | "paid" }[]`, as an `<ol>`.
   Look (`ba` 1 and 3, `.shares`, `.sh`, `.dot`): one card on `--wt-color-surface`, 1px
   `--wt-color-border`, `--wt-radius-md` (drawn 10px; no 10px token, as `wt-choice-tile`),
   `--wt-space-3` in from each side. Rows `calc(--wt-space-2 + --wt-space-1 * 0.75)` by
   `calc(--wt-space-3 + --wt-space-1 / 2)` padding, a 1px `--wt-color-border` line between rows,
   none under the last. Left to right, `calc(--wt-space-2 + --wt-space-1 / 2)` apart: the marker,
   22px (`calc(--wt-space-5 - --wt-space-1 / 2)`), round (`--wt-radius-full`); the name in
   `--wt-font-size-md` over `detail` in `--wt-font-size-sm`, `--wt-color-text-muted`; the amount at
   the row's end, `--wt-font-weight-bold`, tabular figures.
   - `due`: a 2px `--wt-color-border` ring, empty.
   - `current`: ring and fill `--wt-color-primary`; the row on `--wt-color-surface-lifted`, all its
     text `--wt-font-weight-bold`; `aria-current="step"`.
   - `paid`: a 2px `--wt-color-primary` ring holding the `check` icon in
     `--wt-color-primary-text`; the row's text `--wt-color-text-muted`, the amount
     `--wt-font-weight-medium`.
   The marker is hidden from screen readers; the visible `detail` says the state. Rows are not
   buttons. Tests first: `wt-share-list.test.ts` (each state paints from its tokens, set on the
   host; order; `aria-current` only on `current`), `wt-share-list.a11y.test.ts` (each state, light
   and dark), and `wt-share-list.forced-colors.test.ts` with a `forced-colors` block, since the
   states are drawn with fills (design-system "Adding a primitive", step 7).
2. **`wt-stepper variant="round"`** (`ba` 1, `.cnt`; §7.10 "Guest count"). No outer box; − and +
   are separate circles, 56px (`calc(--wt-tap-min + --wt-space-3)`), 1px `--wt-color-border`,
   `--wt-color-surface`, `--wt-radius-full`, the marks 3.5 × `--wt-space-1`; the number between
   them in `--wt-font-size-payment-amount`, bold, tabular, at least 68px
   (`calc(--wt-tap-min + --wt-space-5)`), `calc(--wt-space-4 + --wt-space-1 / 2)` gaps. Marks keep
   the stepper's colours (− text, + primary, §14.2) where `ba` 1 draws both in the text colour.
   Tests: round painting from tokens and the 56px targets in `wt-stepper.test.ts`; the round
   states in `wt-stepper.a11y.test.ts`, both themes.
3. **`equalShare` and `equalShares` in `@waitron/shared`**, as above. Tests first in
   `packages/shared/src/equal-share.test.ts`: the moved cases, `equalShares("73.30", 3)` is
   `["24.44", "24.43", "24.43"]`, every list sums to what is left, and a count above the cents left
   is refused. `packages/orders-sales/src/bill-allocation.test.ts` keeps its allocation cases.
4. `docs/developers/design-system.md`: `wt-share-list` in "Full-screen panels and payment controls"
   and the primitives table, `variant="round"` on `wt-stepper`'s row; both in the workbench
   (`packages/ui/index.html`).

About 190 production lines, 240 of tests.

## O2b: the two screens

Both are views inside today's Table Pay dialog, in a new `apps/till/src/widgets/split-equally.ts`
built like `quiet-pay.ts`; the dialog only switches to them. `bill-pay-dialog.ts` is 2,433 lines
against its 2,500 cap (`scripts/product-file-size-limits.json:51`), so the run leaving for
`share-run.ts` pays for the switch. No change to `till-app.ts` is expected.

1. **Split equally** (`ba` 1), opened by the Split equally tile (today it picks the way and shows
   the typed field, `quiet-pay.ts:215-247`, `bill-pay-dialog.ts:1821-1831`). `wt-full-screen-panel`;
   `wt-top-bar`: back "Pay", "Split equally" over the bill and what is left ("Bill 1 · €73.30"), no
   action. "How many guests are paying?" centred, `--wt-font-size-md`, muted, `--wt-space-4`
   above; the round `wt-stepper`; `wt-share-list` with each guest `due` and "to pay"; under it, only
   when shares differ, "Shares differ by a cent where the bill does not divide evenly." centred,
   `--wt-font-size-sm`, muted. `wt-foot-button-bar`: "Start with Guest 1 · €24.44", primary. The
   stepper runs from 2 (1 is Whole bill), or one more than the guests already paid, up to the
   smaller of 999 (`MAX_GUEST_COUNT`, `packages/shared/src/guest-count.ts:2`) and the cents left, so
   no share is €0.00; the guests already paid keep their ticks, and a new count shares out only
   what is left. Starting count: question 2.
2. **The share's Pay** (`ba` 3): today's Table Pay (`#quietPay`, `bill-pay-dialog.ts:1088-1225`)
   with back "Split equally", "Guest 1 of 3" over the bill's name, and the device button; the
   amount block as today, its line reading "Share €24.44 + tip €2.44" and its tip link as today;
   `wt-share-list` under it (paid guests `paid` with "paid", or "card in progress" and no tick while
   a card waits; this guest `current`, "paying now"; the rest `due`, "to pay"); the same foot
   (`quietTenderActions`, `quiet-pay.ts:154`). The request is today's
   `{ kind: "share", shareOf }` (`bill-pay-dialog.ts:773-774`).
3. **What the frame drops from today's Pay, and goes:** the typed "People still to pay" on Table
   Pay, with its "whole number" refusal; the four way tiles on the share's Pay (Back reaches them);
   the bill's payments list on the share's Pay (`#payments`, 1441; it stays on Pay); `help.payment`'s
   "asks how many people are still to pay" (`apps/till/src/i18n/help-strings.ts:14`, 83).
   **What stays although the frame does not draw it**, because a receipt or money rule needs it:
   the "own receipt?" Yes/No on a share that leaves money owing (`#ownReceiptAsked`, 2214-2223), the
   receipt's guest count on the share that pays the rest (`#guestsShown`, 2203-2212), and the line
   saying what a card in progress holds (1146-1152). Errors and recovery links stay above the foot.
4. **On a phone**, after Take the next (today's view, 1354-1382, until O3) the next guest's Pay
   opens directly. **On a till** there is still no run (668), so Pay comes back
   with Split equally chosen; O3 changes that.
5. **Words**, English and Spanish in `apps/till/src/i18n/strings.ts`: the screen's title, question,
   note, "Start with Guest {n} · {amount}", "Guest {n} of {m}", "Guest {n}", "to pay", "paying
   now", "paid", "card in progress", "Share {share} + tip {tip}". The Spanish uses §7.18's words and today's
   "comensal" (`bill_pay.way_share_hint`, line 4522).

Tests first: `apps/till/src/widgets/split-equally.test.ts` (each frame's parts; − and + reshare;
the note only when shares differ; the limits; Start opens Guest 1 of 3 with the server's amount;
Back from each screen; a run with paid guests); `split-equally.a11y.test.ts`, both themes;
`apps/till/src/state/share-run.test.ts` (paid, waiting, declined, refunded). Table-surface cases in
`bill-pay-dialog.test.ts`, `bill-pay-dialog.a11y.test.ts`, `till-app-handheld-pay.test.ts` and
`till-app-bill-payments.test.ts` that type into `people` go through a `splitAmong(el, n)` helper
in `apps/till/test/bill-pay-app.ts`, keeping every assertion; Counter's stay as they are. About
200 production lines and 250 of tests written, about 30 call sites moved.

**Guides.** `apps/server/src/guide/en/table-service.md` `{#pay-window}` (lines 1017-1019) and
`es/table-service.md` (1073-1076): at a table, set the number of guests with − and +; every share
shows, the first a cent more where the bill does not divide; **Start with Guest 1**, then charge
as for a whole bill; the list shows who has paid. Counter keeps "enter how many people are still to
pay". The `help.payment` bubble the same way, in both languages. One sentence in
`docs/backlog.md`'s TILL-REDESIGN-1 entry.

**Pictures**, beside `ba` 1 and 3, never committed: 390 × 844 light and dark; 844 × 390; a till at
1280 × 800; English and Spanish; 2, 3 and 7 guests; a share's Pay with one guest paid and one
card in progress. Differences listed: back reads "Split equally" where `ba` 3 says "Split" (§7.10:
it names the screen before; §14 the text wins); + is primary; corners 8px; the receipt questions
`ba` 3 does not draw. Lane P's finish review says "ready for the owner" first.

## Size, review and landing

O2a about three hours; O2b about three and a half, most of it moving tests. Each takes the full
`/finish-branch` wave with two Codex run-it reviews: O2a moves the division the server charges every
split share with into another package, and O2b changes how card and cash payments are started.
**Lane O lands both.** Neither changes how a receipt or invoice is issued or filed: the request is
the same (`bill-pay-dialog.ts:773-774`), the server's allocation the same
(`bill-allocation.ts:91-92`), and the receipt questions are asked as today (2203-2223).

## Questions for the watcher

1. **Split O2 into O2a (shared pieces) and O2b (screens)?** Recommended: yes; together they are
   about 390 production lines and 490 of tests, well past three hours.
2. **The starting number of guests.** Recommended: the table's guest count when it has one bill
   and at least 2 guests (`defaultGuestCount`, `packages/shared/src/guest-count.ts:15-17`, already
   passed to Pay as `receiptGuests`, `bill-pay-dialog.ts:296`), otherwise 2. The spec does not say.
