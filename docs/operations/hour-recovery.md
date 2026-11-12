# Recover a box with its recovery sheet

Choose a usable archive, bucket copy or Waitron Cloud backup, then find the recovery sheet whose
key name matches that copy. A newer sheet may contain a replacement key that an older backup
does not accept. Keep the archive password or Cloud login separate from the node recovery key.

## Switch a running box after an invoice identity conflict

When a filing response conflicts with this box's active invoice identity, new invoices and new
collections or refunds stop. Money already captured remains recorded for later completion. Keep any
old or copied box offline before proceeding; your answers on this page do not stop that other box.

Open **Open recovery** beside the till refusal, or open `/manage/recovery/fiscal-conflict` on this
box over HTTPS. Use the current live box's recovery key. A dashboard sign-in, backup password or
key from an older backup does not replace it. Enter the key and choose **Check conflict** to inspect
the affected invoice and identity. Confirm that the old box is offline and no parallel recovery is
underway, then choose **Compare clocks**.

The procedure compares clocks and waits for an available UTC minute using the same admission rules
as recovery. Keep the page open during its countdown. Its automatic checks run no faster than once
every five seconds; when the wait ends, compare clocks again. Review the selected identity and
choose **Switch identity** explicitly. No countdown or background task activates it for you.

The request limit is shared by everyone using this box's recovery route: 60 admitted requests
per fixed one-minute window, with at most two requests running. The recovery key does not bypass
that limit. Invalid TLS, origin or site checks are refused before this budget is used. Other devices can keep recovery unavailable by sending accepted HTTPS requests or holding their
bodies open. Close other recovery pages and stop those requests, or isolate untrusted devices on the
venue network, before retrying. **Stop** ends this page's work; it does not clear the box's shared
request budget. After a rate refusal, enter the current key again before retrying. This limit
bounds admitted work, not availability under hostile network traffic.

The switch uses the live database. It keeps your orders, payments and issued records, retires the
old identity and series from further issuance, and starts the new series at one. It leaves the
original rejected record rejected and its filing case open. It neither restores a backup nor fixes
missing history or proves that another box stopped. The payment loop can finish a captured bill in
the new series without collecting again; do not charge that customer a second time.

If the activation response is lost, check the same attempt with the current key. A confirmed stored
result reports the already committed switch. A retained attempt whose result cannot be confirmed
requires **Start a new attempt**, with a fresh clock comparison and another available minute.
**Stop** clears the entered key and confirmations and stops this page's checks; it cannot undo a
switch already committed. Reopen the page to check its result. Never delete the retained attempt
or reuse its minute to force a retry.

Qualification: `apps/server/src/live-conflict-recovery.test.ts` exercises real activation, exact
replay and a sale queued behind commit or rollback. `conflict-payment-recovery.test.ts` completes
one captured bill after the actual switch and checks a second payment-loop pass.
`boot.conflict-recovery.test.ts` checks a real HTTPS listener, enabled module authentication and
the dashboard entry at the cold recovery URL; its SPA file is a fixture, not a browser rendering
check. The public bootstrap and fiscal dashboard browser suites check rendering, key entry,
explicit activation, Stop, lost replies and discarded drafts. These use local controlled services,
not AEAT acceptance or proof of another machine's isolation.

## Check the selected copy

Open Restore in setup and select the copy. Review its taxpayer, environment, source, saved node
and key name. Keep production and preproduction separate. Use a saved PDF through the recovery
picker or enter its grouped key. There is no installation code to type: the form has no field for
one and sends none (`packages/fiscal-verifactu/src/setup/recovery-hour.browser.test.ts`, "has no
installation-code field" and "sends no installation code"). A typed key still has to
authenticate the selected backup; its short typing check is not authentication.

The box checks the backup once, when it is uploaded, and keeps that checked copy for the clock
steps that follow. If a newer restore page uploads the backup again and it passes its check, that
copy replaces the first, and the older page stops working until the box restarts (after a
restart, each open page uploads again once and the later upload holds the copy): open restores in one page only
(`apps/server/src/hour-recovery-staged.test.ts`, "lets the newest restore event's checked upload
replace the copy"). If the box restarts while the page is open, or the copy goes unused for an
hour, the page's next clock step uploads the backup again by itself under the same restore
(`apps/setup/src/screens/recovery-copy.test.ts`, "uploads again under the same restore event when
the box no longer holds the staged copy").

Confirm that the former seller is stopped and no parallel recovery is underway. Selecting a
fresh name does not stop a copied or returning machine. Arrange recovery with the business's
other venues so that only one fresh setup or recovery runs at a time.

## Recover while first setup is blocked

On the interrupted-setup repair page, choose **Recover from backup**, tick "Delete the old attempt
and recover from a backup." (with the venue database missing, "Nothing was filed to AEAT and nothing
was sold.") and choose **Recover from backup** again. The box deletes the failed setup exactly as
Start again does, and restarts. Press **Reconnect**: the page opens "Join or recover an existing
restaurant". Choose the copy there, then follow [Check the selected copy](#check-the-selected-copy)
above and [Make the new invoice series](#make-the-new-invoice-series) below. If the page is reloaded before
Reconnect, it opens its first screen; if that asks "Is this page secure?", press **Continue to
setup**, then choose **Join or recover**.

Recover from backup is not offered where Start again is not, including when the setup's own record
cannot be read. The bilingual
[backup recovery guide](../../apps/server/src/guide/en/backup-recovery.md) walks through the
controls. It is served with the other guides during normal operation; the repair-only listener does
not link to or serve those guides.

A box that holds a recovery from backup begun on the repair page by a Waitron from before November
2026 does not start, whether that recovery ran, stopped, or was discarded by Start again or Recover
from backup (both kept its records): its page says the box holds a setup from an older version of
Waitron and asks for Waitron to be reinstalled (`setup.workspace_unsupported`). Reinstalling deletes
the backups kept on the box, so keep the backup you will restore from somewhere else first.

## Make the new invoice series

If the backup has no usable time zone, the clock times and a reissued recovery pack
show UTC. Recovery keeps the saved zone unchanged.

The page lists the backup's environment, country, taxpayer NIF and time zone one to a row, and after
**Proceed**, when the clocks differ, the clock step the first-setup runbook describes
(`recovery-hour.browser.test.ts`, "Check this venue lists the backup's details one to a row, and no
clock rows" and
"clocks that differ show one time per clock and ask which is correct; neither answer sends
anything"). Before **Proceed**, **Edit these details** sends nothing and goes back to choosing the
backup (the same file's "Edit these details sends nothing and asks to go back to choosing the
backup", and `apps/setup/src/screens/recovery-copy.test.ts`, "Edit these details from the restore
page goes back to choosing the backup and sends nothing"). Once the series are made the page shows
"We've created these series"; the key and statements stay on the page, hidden, for the restore to
read.

There is no "last hour" question (`recovery-hour.browser.test.ts`, "asks no last-hour question and
offers no clock confirmation"). Enter the recovery key, tick both statements and "These details are correct.", in any order, and
press **Proceed**. The invoice series is the code at the start of every invoice number; recovery
creates new ones so the box never repeats the old box's. Until **Proceed** the page sends nothing
to the box; while the button reads **Proceed** it says "When you press Proceed, Waitron creates new invoice series for this box, so
its invoice numbers never repeat the old box's." with an example of an invoice series (the same
file's "the key, both statements and the details tick send nothing until Proceed, and the page says what Proceed
does"). After **Proceed** the box compares its own clock with the clock of the device showing the
page and with the internet's, and when they agree the page asks the box for the invoice series, all
by itself; nobody types a time (`recovery-hour.browser.test.ts`, "decodes the printed key and sends
independent recovery declarations before selecting"). Changing or clearing the key, either
statement or the details tick stops it, and putting it back sends nothing until **Proceed** is
pressed again (the same file's "an edit to a declaration stops the wait, and putting it back sends
nothing until Proceed" and "an edit to the details tick stops the wait, and putting it back sends
nothing until Proceed, as a statement does").
After the box refuses the key, the key's error shows under the key until the key changes, **Clear**
is pressed or **Proceed** is pressed again, and **Proceed** stays enabled while the key, both statements and the details tick are in: pressing it
sends the key again. Unticking a statement or the details tick disables it until it is ticked again
(the same file's "after the box refuses the key, Proceed stays enabled, and pressing it sends the
key again and makes the series" and "after the box refuses the key, unticking %s disables Proceed
and ticking it again enables it, and the key's error stays under the key until the key changes").
Besides **Clear** and **Edit these details** the page has one main button; what it reads in each
state is the same file's "while %s the restore page's one button reads %s". A
page shown on the box's own screen runs on the box's clock, so it does not count as the second
clock (`apps/server/src/request-from-box.test.ts`;
`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, "a browser on the box itself
is no second clock"). The box's clock must be within 30 seconds of every other clock it reads, ahead
or behind, and nothing confirms past it (`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a
name needs a second clock within 30 seconds of the box").

The new series are named from the box's clock: five symbols for the UTC minute. The box also reads
the selected backup and any database still on the disk. If a name there already holds the minute
the box would take, the page says so, counts down to the next free minute and checks again by itself (see the list below;
`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, "D1: a name at the settle
target in the surviving database"). A later name, or invoices dated after the box's time, no
longer stop the restore (the same file's "selected although a later name is known" cases;
`apps/server/src/hour-recovery-host.test.ts`, "selects at the ordinary wait although the backup's
newest record is later"). Names made after the backup, or by a box this one
never saw, are invisible to it, and a later name held only in the database the restore replaces is
not in the database the restore places (`apps/server/src/hour-recovery-placement-3.test.ts`, "places an older
selected hour over a newer surviving %s destination").

If the backup holds sales dated after the box's time, the restore finishes (the test below runs the
restore's hooks, not the restore route and the restart after it) and, when they are more than a
minute later, the box then takes no payments until its clock catches up or is confirmed, as
whenever the box's clock reads more than a minute earlier than its last sale. On a box that sends records to the tax agency, the box asks the agency for its time about
once a minute, and an answer that agrees lifts the stop (`apps/server/src/guide/en/box-status.md`,
"When payments stop because of the clock"; read, not run here). Once a confirmation lifts it, the alert
`clock.records_misdated` lists how many sales are dated later than the real time and their first
and last time (`apps/server/src/hour-recovery-host.test.ts`, "a restore below the backup's newest
invoice names its minute, a sale is then refused by the clock-behind stop, and a confirmation lists
the later sale").

After the clocks pass, the box waits 90 to 150 seconds before it takes the name, and the page
counts down (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "restore waits until a minute
start 90 to 150 seconds after its check"; `recovery-hour.browser.test.ts`, "explains a waiting
restore with a countdown that goes back to the server at zero"). Keep the page open. A reloaded
Cloud restore page is a new restore and starts a new 90 to 150 seconds: it makes a new restore
event each time it opens (`apps/setup/src/screens/recovery-copy.ts` mounts the page with no
binding, and `apps/setup/src/screens/recovery-allocation.ts` then uses
`eventId: crypto.randomUUID()`), and the box keeps each event's wait apart
(`packages/fiscal-verifactu/src/hour-selection.ts`, `sameEvent`). No test reloads a
restore page end to end. At zero the page goes back to the box by itself; during the countdown it
shows no button but **Clear** (`recovery-hour.browser.test.ts`, "while %s the restore page's one
button reads %s", its "a countdown after a press" row). Once the invoice series are made, the page lists
them and no longer shows that button (the same file's "once the series are made, the page's one
button is gone"). What the page shows when it cannot go ahead, and what it asks for:

- **No second clock** (no internet, and the page is on the box itself): connect the box to the
  internet, or open the page on a phone or laptop on the venue's network that has the backup. It
  checks again about every 15 seconds and carries on by itself (`recovery-hour.browser.test.ts`,
  "with no second clock it explains itself and carries on when the internet arrives").
- **The clocks differ by more than 30 seconds**: the page shows the server's time and this device's
  and asks which is correct; either answer says to correct this device's time and reconnect to the box. It does not
  retry by itself; press **Compare the clocks again**, which
  carries on to the invoice series once the clocks agree (`recovery-hour.browser.test.ts`, "a clock
  refusal shows each clock's reading and no countdown, and waits for Compare the clocks again" and
  "Compare the clocks again after Proceed carries on to the series once the clocks agree").
- **The minute this box would use is already taken**: the page says "This invoice series code has already been used. Waitron creates a
  new one by itself when the countdown ends." and "New invoice series in 03:00", counting down in minutes and
  seconds to the next free minute with no button to press; it checks with the box again by itself and keeps the sentence up through the box's ordinary wait that follows (`recovery-hour.browser.test.ts`,
  "a minute in use shows one countdown, checks again quietly and keeps saying why"). If one of those
  checks is lost on the network, the countdown carries on and the page checks again about every 15
  seconds; once the countdown reaches 00:00 it stays there until a check gets through
  (`recovery-hour.browser.test.ts`, "a lost re-check during a taken minute keeps counting and checks
  again"; `clock-wait.browser.test.ts`, "a taken minute's figure stays at 00:00 while lost re-checks
  repeat"). An answer from the box the page cannot read still shows the page's failure message
  (`recovery-hour.browser.test.ts`, "an answer it cannot read during a taken minute shows the failure"). If this attempt
  has already chosen its name and that name then turns up in the box's records, the attempt is refused
  (`minute_in_use`, with no time; `packages/fiscal-verifactu/src/hour-selection.test.ts`, "a pick is
  refused when a record naming its own minute appears after it"). The page says this is a fault in
  Waitron and that reloading the page and starting the restore again makes a new restore, which
  creates new invoice series (`recovery-hour.browser.test.ts`, "a stored pick found taken names the
  fault and how to start the restore again (%s)").
- **The box's clock is earlier than a time it has already used** (the page says "The invoice series
  cannot be created yet: this box's clock is earlier than a time it has already used for invoice
  series.", with no time given): the box's clock has gone back behind the name this attempt already
  chose. It does not retry by itself; once the box's clock reaches the moment this attempt chose its
  name, press **Compare the clocks again**
  (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a backward clock refuses existing
  material and retains its spent hour"; `recovery-hour.browser.test.ts`, "a later minute in use is
  explained and does not count down", and the "a later minute is already in use" row of "while %s
  the restore page's one button reads %s").

For example, a restore whose clocks are compared at 09:00:04 UTC on 24 October 2026 waits until
09:02:00 and takes `0D0RY` (`hour-selection.test.ts`, the same restore test). With prefixes `A`,
`FF` and `R`, that prepares `A-0D0RY`, `FF-0D0RY` and `R-0D0RY` for future invoices. Recovery
keeps recorded invoices and their recovered counters, retires the old active series from further
issuance and starts the new series at one. It does not reuse the old series from the restored
counter position.

Follow the form's preparation and restore steps. Preserve the exact selected source and retained
operation if interrupted. The host checks the event, source, target and recovery authority again;
a started marker by itself grants no activation. Do not delete a staged request, key file or
spent-name record to retry. An uncertain outcome needs inspection rather than a new submission.

The box makes the new series when it places the backup, after the restart the restore asks for, and
it checks its time against the internet's again at that moment. If it cannot read the internet's
clock then, placement is refused (`sif.allocation_invalid`, `second_clock_missing`), the staged
restore is kept, and the next start tries again (`apps/server/src/hour-recovery-placement-3.test.ts`,
"a fresh-box Cloud restore refused at placement for no internet clock keeps its request and places
on the next start"). How long a Cloud download took makes no difference to this (0 and 31 seconds were tried while
building A1385; no test keeps that comparison). The box restarts by
itself after a failed start (`restart: unless-stopped`, `deploy/compose.yml`); after three failed
starts in a row (`RECOVERY_AT`, `apps/server/src/recovery-state.ts`) it shows the start-failure
page, which says "The box could not make its new invoice series." and asks you to connect the box
to the internet and press **Retry a normal boot**; once the box reads the internet's clock the restore finishes
(`apps/server/src/recovery-surface.test.ts`, "names a refused series in both languages"; the
restart and the three-start count are read, not run here).

## Keep the resulting evidence

Ordinary reboot and exact completion keep the current activation.
They do not take another name. Keep the recovery pack, or older recovery sheet, that holds the
key each retained backup needs, and check the restored server's outcome before using the till. The
pack setup makes holds only the server key (`packages/fiscal-verifactu/src/initial-hour-setup.test.ts`,
"the command path writes recovery pack 1 holding only the staged key, in %s").

Signed paper allocations, Cloud allocation receipts and random emergency identities are historical
formats. Their old environment-file collectors do not provide authority through the current
production preparation API. Shared Cloud accounts, backup access and recovery approvals continue
to serve their separate purposes. The [hour-code design](../superpowers/specs/2026-10-16-a679-hour-coded-series-design.md)
records the limits of clock and operator assurance; the
[two-box design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md), §6.5 and §6.7,
replaces its hour names with minute names and its clock confirmation with the 30-second rule.


## A working box keeps its fiscal identity

You cannot start a new chain on a working box while keeping its database. Use the restore procedure
for a replacement box, or promote a previously admitted spare. Those paths retain the clock,
history and authentication checks described above.
