# Set up your first Live fiscal identity

Set up boxes for the same taxpayer one at a time, including boxes at other venues. Each fresh
setup names its series from the box's clock: five symbols for the UTC minute. Two boxes that know
nothing of each other and take a name in the same minute can choose the same names, so your
coordination matters even when both clocks are correct.

## Review the business and clock

The box must run a Waitron release. None has been published yet. On any other build, the start
after a Live setup stops on the recovery page with `server.unreleased_build` ("This box is running a
test build.").

Choose Live in the local setup wizard. Enter the business, venue and administrator details.
If you imported a prepared configuration, review whether it belongs to this same taxpayer before
continuing. Complete the applicable certificate, email and separate preproduction readiness steps.
The readiness sample uses its own database and grants no production identity.

Review the country, location and time zone together. The box compares its clock with the clock
of the device showing the page, and with the internet's when it reaches it, by itself; nobody types
a time (`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "automatically compares
clocks and shows combined country, place and zone, with no clock time, before selection"). A page shown on the
box's own screen runs on the box's clock, so it does not count as the second clock
(`apps/server/src/request-from-box.test.ts` sorts a request from the box's own address as the box;
`packages/fiscal-verifactu/src/hour-setup-clock.test.ts`, "a browser on the box itself is never
the second clock"). The box's clock must be within 30 seconds of every
other clock it reads, ahead or behind, and there is no confirmation to get past it
(`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a name needs a second clock within 30
seconds of the box"). There is no "last hour" question: the page has no such field
(`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "asks no last-hour question and offers no clock confirmation").

Tick "These details are correct.", then press **Proceed**; once
the clocks agree, the page asks the box for the invoice series
(`first-hour.browser.test.ts`, "with the clocks agreeing, ticking the details and pressing Proceed
makes the series"). The invoice series is the code at the start of every invoice number. The tick
alone asks for nothing (the same file's "with the tick and the clocks agreeing, nothing asks for the
series until Proceed"), and **Proceed** stays disabled until the tick is given (the same file's
"Proceed is quiet and disabled until the details are ticked"). While the button reads **Proceed**,
the page shows "When you press Proceed, Waitron creates this box's invoice series." with an example of what
an invoice series is (the same file's "without the tick nothing asks for the series, and the page
says Proceed starts it"). A missing second clock found when the page opens is explained at once, as
in the list below (the same file's "%s found on load is explained, with no failure"); clocks that
differ are explained only after **Proceed** (the same file's "%s found on load show no clock step
until Proceed, then explain it with no failure"). Beside **Edit these details** the page has one main button; what it reads in each
state is the same file's "while %s the page's one button reads %s".

Each detail sits on its own row, its value beside its label (`first-hour.browser.test.ts`, "Check
this venue puts each detail on a row of its own, label then value"), and the list shows no clock time
(the same file's "when only the %s agrees, Check this venue shows no clock rows").
When the clocks differ, after **Proceed** the page says "It is very important that the server time
is set correctly. Which time is correct:", then shows a "Server time" row and a "This device" row (and
an "Internet" row when the internet was read), each one time to the minute (with seconds on every
row when another clock reads the server's minute), then **The server**, **This device** and
**Both times are wrong**. **The server** and **Both times are wrong** send nothing and say to correct
this device's time and reconnect (the same file's "%s: clocks that differ show one time per clock,
ask which is correct; The server and Both times are wrong send nothing"). **This device** sets the box's clock
from the device showing the page, under the owner's pass, and the page then makes the series with
nobody pressing (the same file's "after Proceed on clocks that differ, This device sets the server's
clock and the series are made with nobody pressing"); a refusal says what happened and what to do
(the same file's "in %s a refusal for %s says what happened and what to do, compares nothing and
keeps the choices"). It is not offered when the internet's time agrees with the box's (the same
file's "offers no This device when the internet's time agrees with the server's"). Each step
becomes an alert, handed to the managers' email duty, at the venue's first full start
(`apps/server/src/boot.box-emails.test.ts`, "boot raises and emails each clock step the setup
page noted, then deletes the note"). **Edit these details** sends nothing and asks the setup app for the venue step; while
the attempt is claimed the app shows its page saying the details are frozen, with **Start again**
(`apps/setup/src/setup-app-first-fiscal.test.ts`, "Edit these details on the series page asks for
the venue step, which a claimed attempt answers with its frozen-details page"). Once the series are
made the page shows "We've created these invoice series:", explains the recovery pack and offers
**Download recovery pack**, which makes the pack and starts the download.

After **Proceed** the page carries on by itself through its waits. It stops for a press only when it
shows **Compare the clocks again** (clocks that differ, a box time before this release, a date out of
range, or a box clock earlier than a time it already used) or **Try again** (a failed request). The box waits 90 to 150 seconds before it takes the
name, and the page counts down with no button; keep it open
(`packages/fiscal-verifactu/src/hour-selection.test.ts`, "setup checked at %s waits until %s";
`first-hour.browser.test.ts`, "explains a waiting setup with a countdown that goes back to the
server at zero"). Taking the tick away stops the page's countdown; ticking again asks nothing until
**Proceed** is pressed again (the same file's "taking the tick away during the box's wait stops the
page, and ticking again asks nothing until Proceed"). A reload during the wait shows the time the
box has left (`first-hour.browser.test.ts`, "a reload during a wait shows the server's time left"),
and at zero the page makes the series by itself, with no tick and no press
(`first-hour.browser.test.ts`, "a reload during the box's wait makes the series by itself at zero,
with no press or tick"). If no second clock answers at zero, or the box answers with a new wait, the
page carries on the same way (the same file's "a reload's wait whose second clock is missing at
zero makes the series by itself once a clock answers" and "a reload's wait that the box answers at
zero with a fresh wait makes the series by itself at that wait's zero"). If it stops for anything
else, such as clocks that differ, it needs the tick and **Proceed** (the same file's "a reload's
wait that stops at zero on clocks that differ needs the tick and Proceed, even after Compare the
clocks again waits for a second clock"). Changing the tick, or the page being taken off the screen,
ends that carrying-on for good (the same file's "a reload's wait ends for good once the tick
changes, so nothing more is asked without Proceed", "a reload's wait ends when the page is taken
off the screen" and "a recorded wait the load's preview shows only after the tick changed does not
carry on by itself"). With no wait recorded, a reloaded page shows no countdown and waits for the
tick and **Proceed** (the same file's "shows no countdown before the tick when no wait is
recorded"). What the page shows when it cannot go ahead, and what it asks for:

- **No second clock** (no internet, and the page is on the box itself): connect the box to the
  internet, or open the page on a phone or till on the venue's network and enter the setup
  password. It checks again about every 15 seconds from when the page opens, and carries on by
  itself once a second clock answers and **Proceed** has been pressed; **Proceed** can be pressed
  while it waits. After a reload during the box's wait, no tick or press is needed (see above)
  (`first-hour.browser.test.ts`, "with no second clock it explains itself and carries on when the
  internet arrives" and "with no second clock on load it explains itself before the tick, and makes
  the series once Proceed is pressed and a clock answers").
- **The clocks differ by more than 30 seconds**: after **Proceed** the page shows the server's time,
  this device's and, when it was read, the internet's, and asks which is correct; either answer says to correct this device's time and reconnect to the box.
  It does not retry by itself; press **Compare the clocks again**, which after **Proceed** carries on
  to the series once the clocks agree (`first-hour.browser.test.ts`, "a clock refusal shows each
  clock's reading and no countdown, and waits for Compare the clocks again" and "Compare the clocks again
  after Proceed carries on to the series once the clocks agree").
- **The minute this box would use is already taken**: the page says "This invoice series code has
  already been used. Waitron creates a new one by itself when the countdown ends." and "New invoice series in
  03:00", counting down in minutes and seconds to the next free minute with no button
  to press; it checks with the box again by itself and keeps the sentence up through the box's ordinary wait that follows (`first-hour.browser.test.ts`,
  "a minute in use shows one countdown, checks again quietly and keeps saying why"). If one of those
  checks is lost on the network, the countdown carries on and the page checks again about every 15
  seconds; once the countdown reaches 00:00 it stays there until a check gets through
  (`first-hour.browser.test.ts`, "a lost re-check during a taken minute keeps counting and checks
  again"; `clock-wait.browser.test.ts`, "a taken minute's figure stays at 00:00 while lost re-checks
  repeat"). An answer from the box the page cannot read still shows the page's failure message
  (`first-hour.browser.test.ts`, "an answer it cannot read during a taken minute shows the failure"). If this attempt
  has already chosen its name and that name then turns up in the box's records, the attempt is refused
  (`minute_in_use`, with no time; `packages/fiscal-verifactu/src/hour-selection.test.ts`, "a pick is
  refused when a record naming its own minute appears after it"). The page, and the setup app if
  it happens when the invoice series are made, say this is a fault in Waitron
  (`packages/fiscal-verifactu/src/setup/clock-wait.browser.test.ts`, "a minute in use with %j names
  no time and does not count down"; `apps/setup/src/setup-app.test.ts`, "shows a stored series
  pick found taken at activation as a fault in Waitron, without a retry, in both languages").
- **The box's clock is earlier than a time it has already used** (the page says "The invoice series
  cannot be created yet: this box's clock is earlier than a time it has already used for invoice
  series.", with no time given): the box's clock has gone back behind the name this attempt already
  chose. It does not retry by itself; once the box's clock reaches the moment this attempt chose its
  name, press **Compare the clocks again**
  (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a backward clock refuses existing
  material and retains its spent hour"; `first-hour.browser.test.ts`, "a later minute in use is
  explained and does not count down", and the "a later minute is already in use" row of "while %s
  the page's one button reads %s").

For example, a setup whose clocks are compared at 09:00:00 UTC on 24 October 2026 (11:00 Madrid
summer time) waits until 09:02:00 (`hour-selection.test.ts`, the setup test above), and that
minute's code is `0D0RY` (`hour-selection.test.ts`, "restore waits until a minute start 90 to 150
seconds after its check"). Prefixes `A`, `FF` and `R` become `A-0D0RY`, `FF-0D0RY` and `R-0D0RY`.
Correct clocks
and surviving history reduce accidental reuse; they cannot discover another box whose activity
you did not report.

## Keep recovery pack 1

Choose **Download recovery pack**, which makes `waitron-recovery-pack-1.pdf` and downloads it; the
page then offers it again to download or to print. Both
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

## After an interruption

Reconnect to inspect the attempt before starting another setup. A reloaded tab that still holds
the setup's key carries on with it until activation starts; any other tab, and every attempt past
that point, is shown **Start again** and **Recover from backup**, which the box refuses in the
cases below. Preserve the state and
venue folders when the page reports an uncertain or conflicting outcome. Do not delete records to
get past a refusal. On the ordinary setup server, either button first asks to stop the setup: the
stop deletes nothing and restarts the box into the repair page, which alone deletes.

**Start again** asks for no password: anyone who can open the repair page can use it and see what it shows — what the setup
reached and whether the setup database could be read. Pressing it
makes the box check what it would delete, and the page shows that before anything is deleted. The
box refuses, in the page's words, when the setup already finished, or when the setup database
holds an invoice or another record Waitron never deletes; when it cannot confirm that
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
AEAT or made a sale. Pressing **Start again**
says so, lists what the attempt's own record says it reached — whether it did not start, started
or finished activation — and offers **Recover from backup** there too. Start again then asks you to tick "Nothing was filed to AEAT and nothing was
sold." If the setup already finished, the box refuses instead, with "This setup already finished,
so deleting it is not offered. Reconnect to check the saved result." If the attempt's
recovery-key record is damaged, the page also says "This setup's recovery-key record is damaged and
cannot be read." above what Start again deletes, and you can still choose **Cancel**.


If a file cannot be deleted, or the disk fills part-way through, the page says "Deletion
interrupted. Reload the page to continue.", the box restarts, and the next start tries the deletion
again.

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
Choose an absolute `--recovery-pdf` destination outside the host-state and venue folders, naming a
file that does not exist yet. The command never writes over a file there, since it may be an earlier
setup's recovery pack; it says so and stops before it records or waits for anything
(`packages/provisioning/src/cli-first-setup.test.ts`, "a recovery-pack path that already holds a
file is refused, with what to do, before any wait or setup record"). After Start again, name a new
file or move the earlier pack to another folder.
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
time it carries on at, and waits in the same run; keep it running
(`packages/provisioning/src/cli-first-setup.test.ts`, "the venue command claims ownership, waits
out its settle wait saying why and until when, before any venue write, and carries on in the same
run"). If the command is stopped, or refused after the setup began, a later run asks nothing,
changes nothing, says what happened, and is refused with `setup.attempt_conflict`, or
`setup.attempt_uncertain` when activation stopped and the box could not tell whether it finished
(same file, "a retained setup (%s) is refused before any question, and nothing on disk changes").
Choose Start again on the box's setup page, then run the command again. Start again deletes what the
setup entered (`apps/server/src/first-setup-command-start-again.test.ts`, "a command refused before
activation leaves a setup Start again deletes, and the next command run completes"). It deletes
nothing, and the page says why, if the setup already recorded something that must be kept, such as
an invoice (`apps/server/src/first-setup-start-again-held.test.ts`, "an invoice record refuses the
summary and Start again setup.start_again_refused kept-records, and nothing changes"), or if the
box cannot confirm that deleting it is safe. A setup whose activation began but stopped before it
wrote anything to the venue database is deleted too, when nothing else of it is left beyond what
Start again deletes for a setup refused before activation (same file as the first, "a command cut
off at %s before its stamp, with an empty database and nothing outside it: Start again deletes it,
and the next command run completes"). `--yes` does not
answer the retention question. Production additionally needs the accepted readiness
receipt. Supply login secrets through their private prompts or supported environment variables,
never command arguments. `WAITRON_INITIAL_VENUE_INPUT` cannot supply Live activation authority.
The [provisioning reference](../../packages/provisioning/README.md) describes the options.

The [15 October procedure](first-live-fiscal-setup-2026-10-15.md) records the superseded
custodian protocol and its historical qualification; it is not a setup route on this candidate.
