# Recover a box with its recovery sheet

Choose a usable archive, bucket copy or Waitron Cloud backup, then find the recovery sheet whose
key name matches that copy. A newer sheet may contain a replacement key that an older backup
does not accept. Keep the archive password or Cloud login separate from the node recovery key.

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

On the interrupted-setup repair page, choose **Recover from backup**. This is separate from the
ordinary Restore page: it authenticates the selected copy before showing its private preview and
keeps the old attempt and database files separately. You do not need the old setup password to
prove access to an independently authenticated backup.

Choose an archive, bucket copy or supported Cloud copy. Supply its named node recovery key,
and its archive key or source credentials where applicable. Choose the saved recovery PDF or a recovery pack that holds the server key, or enter the grouped key from your recovery sheet. Cloud approval is separate from this key;
production Cloud recovery remains unavailable through the current client.

After **Open backup**, check the authenticated details and use the module's recovery controls.
The key still needs to pass the current history and clock checks. Keep the former box stopped,
coordinate with the other venues and follow any wait before selecting the series.

Opening a backup pauses ordinary setup even if its key is refused. Retry recovery on this page,
or restart the box to return to ordinary setup. Going back or refreshing the page does not resume it.

Keep the recovery page open, and able to reach the box, until the recovery finishes. The recovery
stops if the box restarts, or within five minutes of leaving the page or closing its tab. If it had
saved progress, the repair page then shows it as stopped and does not offer **Recover from backup**
beside it; **Start again** deletes it. Do not erase a retained operation
by hand to make another source fit. The bilingual [backup recovery guide](../../apps/server/src/guide/en/backup-recovery.md)
walks through the controls. It is served with the other guides during normal operation; the
repair-only listener does not link to or serve those guides.

## Make the new series

There is no "last hour" question (`recovery-hour.browser.test.ts`, "asks no last-hour question and
offers no clock confirmation"). Press **Compare clocks**: the box compares its own clock with the
clock of the device showing the page and with the internet's, by itself; nobody types a time. A
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
newest record and creation time are later"). Names made after the backup, or by a box this one
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
(`packages/fiscal-verifactu/src/hour-selection.ts`, `sameEvent`). A restore from a backup during
setup returns to the same restore when reopened: the server reuses the binding it stored
(`apps/server/src/first-setup-backup-recovery.ts`, `before.record?.binding ?? …`; read, not run). No test reloads a
restore page end to end. What the page shows when it cannot go
ahead, and what it asks for:

- **No second clock** (no internet, and the page is on the box itself): connect the box to the
  internet, or open the page on a phone or laptop on the venue's network that has the backup. It
  checks again every 15 seconds and carries on by itself (`recovery-hour.browser.test.ts`, "Compare
  clocks with no second clock explains the wait and checks again by itself" and "with no second
  clock it explains itself and carries on when the internet arrives").
- **The clocks differ by more than 30 seconds**: the page shows both readings and asks you to try
  from another phone or laptop that has the backup; if they still differ, the box's time may be
  wrong, so ask for help. It does not retry by itself; press **Check again**
  (`recovery-hour.browser.test.ts`, "a clock refusal shows both readings and no countdown, and waits
  for Check again").
- **The minute this box would use is already taken**: after you press **Make the
  series**, the page says "The auto-generated invoice series code (which is time-based) already
  exists in the database." and "Generating a new code in: 3 minutes", counting down in minutes and
  seconds to the next free minute with no button to press; it checks with the box again by itself and keeps the sentence up through the box's ordinary wait that follows (`recovery-hour.browser.test.ts`,
  "a minute in use shows one countdown, checks again quietly and keeps saying why"). If this attempt
  has already chosen its name and that name then turns up in the box's records, the attempt is refused
  (`minute_in_use`, with no time) and is offered no way on yet
  (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a pick is refused when a record naming its
  own minute appears after it"; backlog A1223).
- **A later minute is already in use** (no time given): the box's clock has gone back behind the
  name this attempt already chose; it can finish once the box's clock reaches the moment this attempt chose
  its name
  (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a resume under a clock behind its own pick
  refuses before writing anything").

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

## Keep the resulting evidence

Ordinary reboot and exact completion keep the current activation.
They do not take another name. Keep the recovery sheet needed by each retained backup and check
the restored server's outcome before using the till. The sheet carries the node recovery key and
no installation code (`packages/fiscal-verifactu/src/recovery-pdf-node.test.ts`, "refuses a sheet
that still carries an installation code").

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
