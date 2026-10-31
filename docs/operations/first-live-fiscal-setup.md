# Set up your first Live fiscal identity

Set up boxes for the same taxpayer one at a time, including boxes at other venues. Each fresh
setup names its series from the box's clock: five symbols for the UTC minute. Two boxes that know
nothing of each other and take a name in the same minute can choose the same names, so your
coordination matters even when both clocks are correct.

## Review the business and clock

Choose Live in the local setup wizard. Enter the business, location and administrator details.
If you imported a prepared configuration, review whether it belongs to this same taxpayer before
continuing. Complete the applicable certificate, email and separate preproduction readiness steps.
The readiness sample uses its own database and grants no production identity.

Review the country, location, time zone and displayed date and time together. The box compares
its clock with the clock of the device showing the page, and with the internet's when it reaches
it, by itself; nobody types a time
(`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "automatically compares clocks
and shows combined country, place, zone and local time before selection"). A page shown on the
box's own screen runs on the box's clock, so it does not count as the second clock
(`apps/server/src/request-from-box.test.ts` sorts a request from the box's own address as the box;
`packages/fiscal-verifactu/src/hour-setup-clock.test.ts`, "a browser on the box itself is never
the second clock"). The box's clock must be within 30 seconds of every
other clock it reads, ahead or behind, and there is no confirmation to get past it
(`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a name needs a second clock within 30
seconds of the box"). There is no "last hour" question: the page has no such field
(`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "asks no last-hour question and offers no clock confirmation"). Before you
press **Make the series**, the page explains nothing and retries nothing
(`first-hour.browser.test.ts`, "a preview refused for %s on load shows the readings with no
failure and no explanation").

After you press it and the clocks pass, the box waits 90 to 150 seconds before it takes the name,
and the page counts down; keep it open (`packages/fiscal-verifactu/src/hour-selection.test.ts`,
"setup checked at %s waits until %s"; `first-hour.browser.test.ts`, "explains a waiting setup with
a countdown that goes back to the server at zero"). A reload during the wait shows the time the
box has left (`first-hour.browser.test.ts`, "a reload during a wait shows the server's time
left"). What the page shows when it cannot go ahead, and what it asks for:

- **No second clock** (no internet, and the page is on the box itself): connect the box to the
  internet, or open the page on a phone or till on the venue's network and enter the setup
  password. It checks again about every 15 seconds and carries on by itself (`first-hour.browser.test.ts`,
  "with no second clock it explains itself and carries on when the internet arrives").
- **The clocks differ by more than 30 seconds**: the page shows both readings and asks you to try
  from another phone or till; if they still differ, the box's time may be wrong, so ask for help.
  It does not retry by itself; press **Check again** (`first-hour.browser.test.ts`, "a clock
  refusal shows both readings and no countdown, and waits for Check again").
- **The minute this box would use is already taken**: the page says "The auto-generated
  invoice series code (which is time-based) already exists in the database." and "Generating a new
  code in: 03:00", counting down in minutes and seconds to the next free minute with no button
  to press; it checks with the box again by itself and keeps the sentence up through the box's ordinary wait that follows (`first-hour.browser.test.ts`,
  "a minute in use shows one countdown, checks again quietly and keeps saying why"). If one of those
  checks is lost on the network, the countdown carries on and the page checks again about every 15
  seconds; once the countdown reaches 00:00 it stays there until a check gets through
  (`first-hour.browser.test.ts`, "a lost re-check during a taken minute keeps counting and checks
  again"; `clock-wait.browser.test.ts`, "a taken minute's figure stays at 00:00 while lost re-checks
  repeat"). An answer from the box the page cannot read still shows the page's failure message
  (`first-hour.browser.test.ts`, "an answer it cannot read during a taken minute shows the failure"). A reload before
  the box's own wait begins shows no countdown; tick "The country, place, time zone and displayed
  time are correct." and press **Make the series** again (read, not run: the page's check on load
  ignores a refusal for a taken minute, `#compare` in `packages/fiscal-verifactu/src/setup/first-hour.ts`). If this attempt
  has already chosen its name and that name then turns up in the box's records, the attempt is refused
  (`minute_in_use`, with no time) and is offered no way on yet
  (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a pick is refused when a record naming its
  own minute appears after it"; backlog A1223).
- **A later minute is already in use** (no time given): the box's clock has gone back behind the
  name this attempt already chose; it can finish once the box's clock reaches the moment this attempt chose
  its name
  (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a resume under a clock behind its own pick
  refuses before writing anything").

For example, a setup whose clocks are compared at 09:00:00 UTC on 24 October 2026 (11:00 Madrid
summer time) waits until 09:02:00 (`hour-selection.test.ts`, the setup test above), and that
minute's code is `0D0RY` (`hour-selection.test.ts`, "restore waits until a minute start 90 to 150
seconds after its check"). Prefixes `A`, `FF` and `R` become `A-0D0RY`, `FF-0D0RY` and `R-0D0RY`.
Correct clocks
and surviving history reduce accidental reuse; they cannot discover another box whose activity
you did not report.

## Keep recovery pack 1

Choose **Make recovery pack**, then download `waitron-recovery-pack-1.pdf`, print it, or both. Both
actions use the same document within that delivery session. Check the business, venue, server ID
and key name on its server-key page, then tick **I kept the recovery pack.** before continuing.
There is no separate signing key, custodian computer, register or downloadable tool.

Keep the PDF or paper outside the box and its backups. It contains the server key. Pack 1 holds
only that key: its cover lists the bucket copy and archives as not set up
(`packages/fiscal-verifactu/src/initial-hour-setup.test.ts`, "the command path writes recovery pack
1 holding only the staged key, in %s"). Your Cloud login, or the downloaded archive's password,
stays separate. Keep an older pack or recovery sheet while you retain backups that need its key.
The box stores a verifier for the key; it cannot recover the old secret from that verifier.

You can select the saved pack, or an older sheet, during recovery or type its grouped key. The
typing check catches mistakes; opening the selected backup still authenticates the complete secret.
See [recovering a box](hour-recovery.md).

## Resume an interruption

Reconnect to inspect the attempt before starting another setup. The repair page lets you prove
ownership with the setup password and recover the same attempt. An eligible interrupted marker
can be repaired; preserve the state and venue folders when the page reports an uncertain or
conflicting outcome. Do not delete records to get past a refusal.

**Finish** publishes an exactly checked committed result. It does not activate another identity,
reset counters or require a new name because the clock has advanced. **Start again** asks for no
password: anyone who can open the repair page can use it and see what it shows — what the setup
reached, a stopped recovery's times, and whether the setup database could be read. Pressing it
makes the box check what it would delete, and the page shows that before anything is deleted. The
box refuses, in the page's words, when the setup already saved the settings the box sells with
(Continue with the setup password finishes it), when the setup already finished, or when the setup
database holds an invoice or another record Waitron never deletes; when it cannot confirm that
deleting is safe, the page says so and does not offer it. If part of the setup database cannot be
read, the page says "The previous setup process was unsuccessful." without "No invoice was sent to
AEAT.", because the box may not have been able to check that database for invoices, and Start again
still deletes it. Start again deletes the attempt and keeps no record of the invoice series names it chose: a later setup's name is the
box's current minute, after the clock check and the wait, and not a minute a name the box can
still read already holds (`CLAUDE.md` §5). If a Start again is cut off, for example by a power cut, the next start finishes it, or
refuses with a page that says what to do. If that page lists files Start again did not create,
such as a venue copied from a backup, it offers **Keep everything and stop** or **Move these files
aside and finish Start again**, behind the administrator password you chose during setup. If the
attempt's recovery-key record is damaged, pressing **Start again** shows "This setup's
recovery-key record is damaged and cannot be read." above what Start again deletes; you can still
choose **Cancel**.

When the venue database is missing, the box cannot check whether the attempt filed anything to
AEAT or made a sale, and the repair page does not offer **Continue**. Pressing **Start again**
says so, lists what the attempt's own record says it reached — whether it did not start, started
or finished activation — and offers **Recover from backup** there too. Start again then asks you to tick "Nothing was filed to AEAT and nothing was
sold." If the setup already finished, the box refuses instead, with "This setup already finished,
so deleting it is not offered. Reconnect to check the saved result." If the attempt's
recovery-key record is damaged, the page also says "This setup's recovery-key record is damaged and
cannot be read." above what Start again deletes, and you can still choose **Cancel**.

The page no longer starts a recovery from backup itself; the next two paragraphs describe one
begun on the repair page before this version of Waitron.

While a backup recovery is running on another device, the repair page says so, with when it
started and when it was last active, and offers only **Reconnect** and **Set up secure
connection** until it stops. It counts as running while one of its steps is in progress and for
five minutes after its last activity. The five minutes end early if the recovery fails, and the
box keeps them in memory only, so a restart ends them too (`runningInMemory` in
`apps/server/src/first-setup-backup-recovery.ts`).

Once a backup recovery has stopped, the repair page says it started and did not finish and that
Start again deletes it. **Recover from backup** is offered beside it too, and its confirmation says
only "The previous recovery from backup started on … did not complete." With the venue database
missing, the page shows this once **Start again** or **Recover from backup** is pressed, and either
deletes the recovery with the attempt after the missing-database confirmation above. With the venue database present,
the page shows the stopped recovery beside **Start again**, within the limits above. Start again
then reads the recovery's details again, shows them, and deletes the recovery with the attempt
once you tick "Delete the old attempt and start again." Before it deletes anything, the box writes
a confirmation record (`first-setup-start-again-confirmations/`) when the venue database is
missing, when part of it cannot be read, or when a stopped recovery is discarded. The record says
whose setup it was, that it was confirmed on the repair page with nobody signed in, when, and the
summary the page confirmed, with `database` set to `missing`, `present` or `unreadable`. For a Waitron Cloud copy the page adds that the approval in Waitron Cloud closes
by itself within an hour of when it was given, and that until then Cloud cannot approve a new
recovery for this box's venue.

Start again keeps the discarded recovery's journal records and its lock files, and deletes the
rest. If a file cannot be deleted, or the disk fills part-way through, the page says "Start again
has not finished. Reload this page to see what is left to do. If the box is restarting, wait until
it answers.", the box restarts, and the next start tries the deletion again. With the venue
database missing, a recovery whose records cannot be read is reported as such, and neither Start
again nor Recover from backup is offered beside it.

**Recover from backup** is offered wherever Start again is, asks for no password either, is
refused in the same cases, and runs the same deletion. Its confirmation says "Recover from backup
first deletes what was entered in the setup that stopped part way. No invoice was sent to AEAT.
Then you choose the backup." After the box restarts, **Reconnect** opens "Join or recover an
existing restaurant", where the [ordinary restore](hour-recovery.md) takes an archive, bucket or
supported Cloud copy, as on a new box. After Start again, **Reconnect** opens "Set up this Waitron
server" instead. A reload before Reconnect forgets which was chosen and opens the page's first
screen; if that asks "Is this page secure?", press **Continue to setup**, then choose **Join or
recover**.
Secure-connection repair is available:
choose **Set up secure connection** on the repair page and follow the
[connection repair procedure](../../apps/server/README.md#repairing-the-secure-connection).
A732's proposed fresh-workspace action and recovery desk were withdrawn by the owner on
21 October 2026. Promotion's browser screen and complete venue-copy adoption remain separate work.

## When both credentials are lost

If you have lost both the administrator password and every recovery pack or sheet holding the server key, reinstall the box and set
it up again (owner, 2026-10-21). Reinstallation loses the box's local data. The new setup starts a
fresh fiscal identity and chain; it does not reopen the old account or continue its history.
Keep any separately held archive, bucket or managed Cloud copy: recovering one still requires
its named recovery key and the [ordinary restore checks](hour-recovery.md). Reinstalling cannot
replace that key. This documentation change does not authorise a reset or reinstall now.

## Use the provisioning command

Build the provisioning bundle with `pnpm --filter @waitron/provisioning build`, then run its
`venue` command against the intended migrated venue directory with `WAITRON_STATE_DIR` set.
Choose an absolute `--recovery-pdf` destination outside the host-state and venue folders.
For example, with your real paths:

```sh
WAITRON_STATE_DIR=/var/lib/waitron/state \
  node packages/provisioning/dist/bin.js venue \
    --venue-dir /var/lib/waitron/state/venue \
    --recovery-pdf /media/recovery/olivo-recovery.pdf
```

Follow the venue, password and kept-document prompts; the command asks nothing about the clock or
recent setups. It needs the internet's clock: with only the box's own, it explains why and stops
(`packages/fiscal-verifactu/src/initial-hour-setup.test.ts`, "the terminal with only the box's
clock explains and cancels without a question"). When the name must wait, it prints why and the
time it continues at, and stops; run it again within a minute after that time, or it waits again
(same file, "the terminal asks nothing, prints why it waits and until when, and keeps the wait"
and "a terminal run more than a minute after its wait's target waits again"). `--yes` does not
answer the retention question. Production additionally needs the accepted readiness
receipt. Supply login secrets through their private prompts or supported environment variables,
never command arguments. `WAITRON_INITIAL_VENUE_INPUT` cannot supply Live activation authority.
The [provisioning reference](../../packages/provisioning/README.md) describes the options.

The [15 October procedure](first-live-fiscal-setup-2026-10-15.md) records the superseded
custodian protocol and its historical qualification; it is not a setup route on this candidate.
