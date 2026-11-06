# Closing a drawer (A1325, with A239)

Status: approved by the owner on 6 November 2026, after a fresh reviewer read it. Nothing is built. It replaces the
"close the day" framing in [A1325](../../backlog/till.md#a1325-close-the-day-count-the-cash-and-save-the-days-close)
and absorbs [A239](../../backlog/till.md#recorded-cash-in-and-out-of-a-tills-drawer-a239--open-needs-a-spec-before-queueing-owner-2026-10-03).

## Intent

A restaurant ends its night with one job: count the cash, take out what is not needed for tomorrow, and
get it to the bank. The owner's words: "a close is really just a withdrawal". Waitron today treats a
close as a frozen end-of-day financial document, one per business day, with no screen to make one. This
design replaces that with a small cash operation that the last person to leave can do, on any drawer,
at any time.

**Success:** the last person, who may not be a manager, can close a drawer in about a minute. The owner
can later see what was counted, what was taken out, by whom, and whether the cash added up.

## Goals

- Every drawer keeps a running balance of the cash that should be in it.
- Anyone allowed can close a drawer at any moment, with no dependence on the business day.
- A close records the count, the difference, what was taken out and what was left.
- Top-ups and other cash in or out are recorded the same way (A239).
- A missed close produces a warning.

## Non-goals

- **No sales or VAT on a close.** Those stay on the dashboard's Sales screen, by date.
- **No bank matching.** Waitron records "for the bank". Matching it to a statement is the accountant's
  work outside Waitron.
- **No fiscal meaning.** A close files nothing with AEAT and changes no invoice.
- **No business-day logic in a close.**

## Anti-goals

These would make it a failure even if it worked:

- A close that stops anyone selling, or a warning that blocks anything.
- A finished close that can be changed.
- Sending the person to a manager with no way forward (root `CLAUDE.md` §3).
- A close that needs a manager to be present.

## Decisions the owner made

| # | Decision |
| --- | --- |
| 1 | A close is a withdrawal: count the cash, remove the extra, put it in the bank, and separate the tips if needed |
| 2 | Each drawer closes on its own |
| 3 | A close can happen at any point in the day or week, and covers everything since that drawer's last close. Anything later goes on the next close |
| 4 | A finished close is never changed |
| 5 | A close is expected daily on a schedule, and a warning goes out if it does not happen. Nothing more happens |
| 6 | The person closing sees the difference before finishing |
| 7 | They type the count first, then see the difference, and may recount once. Both counts are saved for the manager |
| 8 | Closing needs the `cash.drawer` permission, and all staff hold it, so the last person can always close. Every open and entry is logged under their name |
| 9 | A close is purely about cash. Owners read sales in Waitron, and an email can carry a summary |
| 10 | `daily_closes`' frozen copy of sales and VAT goes, and so does the tamper-evident chain |

Decision 10 answers the chain question A1325 left open. Nothing runs `verifyDailyCloseChain` except a demo
script, and it is a plain hash with no secret.

Decisions 2 and 3 replace item 2 of A1325, "one close across all tills, run by the primary", and the
rule of one close per business day.

## How it works

### The running balance

A drawer's expected cash is what was left at its last close, plus everything that has moved since:
cash payments in, cash refunds and cash voids out, and recorded top-ups and removals.

A **drawer** is a printer with a cash drawer, as today (`printers.has_cash_drawer`). Two tills that share
a drawer share one balance. This differs from today's code, which adds up cash per device
(`close.cash.byOrigin`).

Each cash movement writes its own entry on the drawer's record, in the same transaction as the payment or
refund. The balance is never worked out from `drawer_opens`: A1308 moves that table into `activity_log`,
which product logic must not read ([tables-devices.md](../2026-11-02-rationalisation/tables-devices.md)).
So every cash path needs to know its drawer when it runs. Cash taken where no drawer resolves belongs to
no drawer, like cash on a device with no drawer, and shows only on the Sales screen.

### Closing a drawer

The till's menu offers **Close drawer** on a device with a drawer. Steps:

1. The drawer opens, through the same audited path as a manual open. If it cannot, for example because
   its printer is off, the till says so, and the person opens it with the key and carries on.
2. The person types what they counted. The expected figure is not shown yet.
3. Waitron saves the count, then shows the difference. If it is not zero they may recount once, and that
   is saved too.
4. They enter what is staying in the drawer. It starts filled with the amount left at the last close.
5. The rest is the withdrawal, shown as **For the bank**. Where the venue uses it, they can move part of
   it to **For tips**.
6. They confirm. The close is saved and the slip prints.

**An unfinished close.** The first count is saved at step 3, not at the end, or backing out would give a
fresh first count with the expected figure already known. If the person stops or the till dies, the next
attempt on that drawer, from any device, resumes from what was saved. A manager sees a count that was
never finished. This is why the record is a series of entries and not one row written at the end.

Example of the slip:

```
CLOSE: BAR DRAWER
From Thu 5 Nov 23:48
To   Fri 6 Nov 23:52
Closed by Ana

Cash sales            532.50
Cash refunds          -12.00
Cash in or out        -20.00
Expected in drawer    650.50
Counted               650.50
Difference              0.00

Left for tomorrow     150.00
For the bank          500.50

Cards on this till  1,310.00
```

"Cards on this till" lets staff compare with the card terminal's own total. A shared drawer shows cards
for all the devices that use it.

### Cash in and out (A239)

Any time, on a device with a drawer, a person holding `cash.drawer` can record cash put in or taken out:
how much and why, for example topping up change or paying a supplier. Each is an entry on the running
balance, and the replaced "opening float" and "payouts" figures go. A close is the same kind of entry,
with a count attached.

### The first close

A new drawer's balance starts at zero. The starting change is recorded as cash put in. If nobody does,
the first close shows that amount as a difference, which is harmless.

### Waiters' cash (A240)

A waiter settles their float into a drawer before leaving, as already decided. That settlement is cash in
on the drawer's balance. So A240 needs nothing else from a close, and it can land after it. Until it does,
cash taken on a device with no drawer belongs to no drawer's balance, and the Sales screen is the only
place it shows. A240's open point, where a float's opening cash comes from, stays open. The owner's rule
that a close lists any float still open moves to the daily summary email, because a float belongs to a
waiter and not to any drawer.

### Tips

"For tips" is shown only where the venue has turned it on. It records that the money left the drawer for
tips, and nothing else. Who receives it and how it reaches payroll stays with A793 and the labour adviser
(L5), which are on hold, so this split can land later.

### The expected close and the warning

- A close is expected once a day for each drawer that had cash movement since its last close. A drawer
  with no movement is never warned about.
- The check runs after closing, as the owner decided. Waitron has no single closing time, because hours
  belong to each department, vary by season and can be missing. So closing means the latest end of any
  department's hours that day, and the check runs one hour after it, which gives the last person time to
  finish. On a day with no hours, a closed day that still had cash, the check runs at the venue's
  business-day start.
- A drawer that had cash movement since its last close, and was not closed by then, is warned about. The
  warning names the drawer, appears as a dashboard alert and goes out by email.
- It repeats once a day until that drawer is closed, and it never blocks anything.
- A venue may turn the warning off, or change it to weekly.

### A drawer whose printer changes

The balance belongs to the printer's id, and a deleted printer comes back with a new one.

- **Off or broken:** the drawer can still be closed by hand, as above, so the warning can always be cleared.
- **Deleted or replaced:** the delete screen says the drawer still holds cash and offers a close first.
  A close that leaves nothing ends the balance, and the new drawer starts with cash put in. If it is
  deleted anyway, the warning for it stops, and the amount it held stays visible in past closes.

### Seeing past closes

The dashboard's Sales screen lists closes by drawer and date, for anyone holding `report.view`. Each shows
both counts where there were two, who closed, what was taken out and what was left, and it can be
reprinted. A shortage or overage needs no action in Waitron: the next close starts from what was really
left, so a difference is recorded once and not carried forward.

### The daily summary email

At the same moment as the check, the owner gets a short email: that day's sales, and each close made since
the last email, with any difference. It does not depend on a close having happened.

## What changes in the existing code

- **`daily_closes` and `daily_close_chain` are replaced** by an append-only record of drawer entries.
  This waits for A760, under the owner's hold on new table work. Nobody calls `recordDailyClose` in
  production, so no data needs carrying over. A1308's documents keep `daily_closes` and name `drawer_opens`'
  move, and A1308 rewrites the payment and refund tables, so this comes after those slices. Its
  [tables-fiscal.md](../2026-11-02-rationalisation/tables-fiscal.md) needs correcting once this is approved.
- **`computeDailyClose` stays** as the source of the Sales screen. Only its use as a stored document goes.
- **`record-daily-close.ts`, `daily-close-hash.ts`, `verify-daily-close-chain.ts` and
  `apps/server/scripts/daily-close-z-demo.ts` go.**
- **The backup check changes:** `packages/reporting/src/backup-verification.ts` and
  `CORE_BACKUP_TABLE_POLICIES` (`packages/db/src/backup-evidence.ts`) name these tables.
- **`venue.business_day_locked`** no longer depends on a close: the `closed` half of the check in
  `apps/server/src/business-day-start.ts`, and `apps/server/src/venue-details.ts`, go. Activity after the
  change date still refuses, through the `future` half of that query.
- **A void that hands back cash** must count as cash out, or it shows as a shortage ([the backlog
  entry](../../backlog/till.md)). No route calls `recordVoid` yet, so this applies when one does.

## Rules that apply

- `cash.drawer` moves from `SUPERVISOR` to `STAFF` in `packages/identity/src/permissions.ts`. Every consumer
  must be traced first: the PIN path for a person without it stops being reachable through this permission,
  and tests that expect staff to be refused change. The device's profile must still allow opening a drawer,
  so a device that should not can be given a profile of its own (root `CLAUDE.md` §3 and §5).
- Opening the drawer follows the existing rules: an active device and session, the same drawer, an audited
  open and never a resend (root `CLAUDE.md` §5). A close does not take money, but it does the drawer work
  those rules cover, so it behaves as a manual open does during a clock stop.
- The new alert code needs an area claim and English and Spanish wording.
- Till text stays short, and the feature sits in the menu, off the path to selling.
- Forms follow [design-system.md](../../developers/design-system.md) → Forms.
- The guide changes in English and Spanish.

## The builder's calls, which the owner has not been asked about

These are the designer's choices and the owner may overrule them.

- The name **Close drawer**.
- Step 4 starts filled with the amount left last time.
- A difference is recorded once and not carried forward.
- A new drawer starts at zero.
- The warning repeats daily, may be turned off or made weekly, and skips a drawer with no movement.
- Closing means the latest end of any department's hours that day, the margin is one hour, and a day with no
  hours falls back to the business-day start.
- The first count is saved when the difference is shown, and an unfinished close resumes.
- A close carries on by hand when the drawer will not open.
- Deleting a printer that holds a balance offers a close first, and does not refuse.
- No separate alert for a large difference, because the summary email shows it each day.
- The email is sent to the venue's owner account, and goes to no one if email is not set up.
- Open waiters' floats are listed in the daily email and not on a drawer's close.

## Left to the builder

The shape of the new table, within "append-only, one row per entry". How each cash movement finds its
drawer, from `drawer_opens` or a new link. The order of the pull requests. The till and dashboard
layouts, within the design system.
