# Recover from backup

## When first setup was interrupted {#interrupted-setup}

If the repair page cannot continue your setup, it offers **Start again** and **Recover from
backup**. Both delete the setup that stopped part way in the same way, and **Recover from backup**
then leads to the restore a new box uses. Neither asks for a password: anyone who can open the
repair page can use them, and can see what the page shows when one is pressed. When you choose one,
the box checks what it would delete and the page shows it.

When you choose **Start again**, the page shows "Start again deletes what was entered in the setup
that stopped part way. No invoice was sent to AEAT.", and deletes it all once you tick "Delete the
old attempt and start again." and choose **Start again** once more. When you choose **Recover from
backup**, it shows "Recover from backup first deletes what was entered in the setup that stopped
part way. No invoice was sent to AEAT. Then you choose the backup.", and deletes it all once you
tick "Delete the old attempt and recover from a backup." and choose **Recover from backup** once
more.

If the page says the setup database is missing, either one shows what the setup's own record says
it reached, leaves out "No invoice was sent to AEAT.", and deletes it all once you tick "Nothing was
filed to AEAT and nothing was sold." and press the same button once more. If part of the setup
database cannot be read, the page says "The previous setup process was unsuccessful." and leaves
out "No invoice was sent to AEAT.", because the box may not have been able to check that database
for invoices. Start again and Recover from backup still delete it.

Neither is offered, and the page says why in the same words for both, if the setup already saved
the settings the box sells with (continue with your setup password to finish it), if the setup
already finished, or if the setup database holds an invoice or another record Waitron never
deletes. If the box cannot confirm that deleting the setup is safe, the page says so and offers
neither. That includes a setup whose own record cannot be read, or carries a mark that needs
repair: then the only way out is to reinstall Waitron, unless the setup had saved nothing yet, in
which case **Continue with your setup password** repairs the record and carries on.

Once the setup is deleted the box restarts. After **Recover from backup**, **Reconnect** opens "Join
or recover an existing restaurant", where you choose **Restore a backup** or **Restore from my
bucket**, as on a new box; restoring needs the backup's own key and its node recovery key. After
**Start again**, **Reconnect** opens "Set up this Waitron server", where you choose how to set up
this box. If the page is reloaded before you press **Reconnect**, it does not remember which you
chose and opens its first screen. If that screen asks "Is this page secure?", press **Continue to
setup**; then, to restore, choose **Join or recover**.

Use the box's secure connection. If your browser does not trust it, choose **Set up secure
connection** on the repair page first. **Check again** rereads the connection without running
a repair. **Stop** ends this attempt; you can close the tab or check again. If repair keeps
failing, stop here. This page cannot repair every saved certificate layout or replace a separately
installed certificate. For a separately installed certificate, check the server’s HTTPS address
and stop if it shows a warning. If your device blocks certificate installation, use a venue
device that allows it. Enter passwords and recovery keys only after HTTPS opens without warnings.

Stop the former box and coordinate with the other venues:
only one person should recover this taxpayer at a time.

The next paragraphs describe a recovery from backup begun on the repair page before this version
of Waitron, which no longer starts one there.

While a recovery from backup is running on another device, the repair page says so, with when it
started and when it was last active. Until it stops, the page offers only **Reconnect** and **Set
up secure connection**, and it checks again by itself. A recovery counts as running while one of
its steps is in progress and for five minutes after its last activity. Those five minutes end early
if the recovery fails or the box restarts.

If a recovery from backup started and did not finish, **Start again** or **Recover from backup**
deletes it along with the interrupted setup, and the page shows the stopped recovery when either is
pressed.

If that recovery used a Waitron Cloud copy, its approval in Waitron Cloud closes by itself within an
hour of when it was given. Until then, Waitron Cloud cannot approve a new recovery for this box's
venue.

If the page says that Start again has not finished, reload it to see what is left to do. If the box
is restarting, wait until it answers.

If the recovery filled the box's disk, Start again still works: the box keeps about 8 MB of its disk
spare, and gives that space up so it can delete the recovery. If even that is not enough, the page
says the disk is full. Where the page can tell, it says whether restarting the box can free space.

If a Start again was cut off and the box then finds files that Start again did not create, such as
a venue copied from a backup, the box does not start. If its page lists the files, it also asks,
over the box's secure connection, for the administrator password you chose during setup. **Keep everything
and stop** leaves the files as they are, and the page then stays until Waitron is reinstalled.
**Move these files aside and finish Start again** moves the files, unchanged, into a new folder on
the box and finishes Start again; the box then starts a new first setup. If files are added, removed or
written to after the page opens, the box refuses the choice and changes nothing: press **Retry a normal boot** to
see them again. From the sixth wrong password on, the page makes you wait before the next try,
never more than 15 minutes, and each 15 minutes without a wrong password forgives one. If the page
says that Start again was moving files aside and has not finished, press **Retry a normal boot** to
finish moving them; the box then starts a new first setup.

## Choose your copy {#source}

On "Join or recover an existing restaurant", choose **Restore a backup** for a backup file, or
**Restore from my bucket** for the continuous copy in your own storage bucket. For a Waitron Cloud
copy, choose **Restore a backup** and then **Restore from Waitron Cloud**.

For a backup file, choose it in **Backup file**, enter the key that unlocks it in **Recovery key**,
and choose its **Backup environment**. For your bucket, choose your recovery pack or kit file in
**Recovery pack or kit file**, or paste the kit in **Recovery kit**, and choose the **Environment**
the old box ran in. If the pack was made before the box had a bucket copy, is not a Waitron recovery
pack, or is damaged or was changed after it was made, the page says so under the field. For Waitron
Cloud, choose **Start Cloud recovery**, enter the code the page shows in your Waitron Cloud account
(**Open Waitron Cloud**), then choose **Check approval**. Cloud recovery requires a supported
recovery service.

Then choose **Review backup**. The page shows the selected backup: its source, business, location,
date, node and node recovery key. Check those details before continuing. Keep production and
preproduction separate.

The backup's key, the bucket kit and the Cloud approval give access to a copy. You still need that
copy's named node recovery key to authenticate recovery.

## Prove access to the selected backup {#proof}

Below the review, under "Recover this box", choose your recovery pack, or an older recovery PDF,
that holds the server key for this backup in **Recovery PDF**; or type the grouped key printed on it
in **Recovery key**. If the pack does not hold the server key, the page says so and, when the pack
records it, names the pack or the key name to look for. A pack or sheet with a newer server key may
not open an older backup. Tick "The old box is stopped and will stay offline." and "I am the only
person recovering this taxpayer, across all venues."

If **Backups** cannot confirm the saved key, keep both the previous key and the key you just
saved. While changing a key, you can still copy or download both displayed keys after this
refusal. Stop changing keys and leave the page without another submission. This page cannot
diagnose conflicting backup-key settings or confirm which key opens a particular backup; do not
replace either key record on the strength of this message.

Open **Backups** and read the error beside the backup status. Choose the destinations and schedule
again. **Turn on backups** replaces the saved settings; leave without applying to keep them.
If a folder is refused, correct it before applying again. A successful save can still report a
loading error, so check the resulting status before relying on a new backup.

When **Backups** says the saved settings can't be used, choose **What the box recorded**. The panel
lists the times the box could not use its saved backup settings since it last started, newest first
and at most five, each with what went wrong: for example, the key number the settings were locked
with and the key numbers this box holds. It then describes the saved record as it is now: when it
was last written and, if it reads, the folders and buckets it names and whether each folder exists.
If the box's environment sets its backups, the panel says so instead of naming them. It says whether
the box holds a usable backup recovery key. It shows a bucket's access key ID but never its secret,
and the recovery key only by its fingerprint. The panel reads and changes nothing: **Read again**
reads the facts again and does not turn backups on, and **Stop** closes the panel. It repairs
nothing either; to replace the saved settings, choose the destinations again and apply them. Keep
your recovery keys and existing backup files.

If the bucket copy says its settings could not be used safely, choose **Change bucket** in
**Backups**. Correct the fields it marks. **Test** checks the bucket without saving settings;
**Save and turn on** applies them. **Cancel** leaves the saved settings as they were. This form
cannot diagnose a failure in the box's own configuration. Keep your recovery keys and existing
copies if the refusal persists.

## Make the new series {#series}

Choose **Compare clocks**. Follow the clock and waiting instructions; there is no installation code
to type. Choose **Make the series** once the page allows it; it then shows the new series name.
Tick the confirmation the page shows — "I confirm no other running server has newer restaurant
data." for a backup file or bucket copy (for a bucket copy, also "This is my business. Restore it
onto this server."), or "I confirm the old server and surviving peers are stopped, and I accept
losing changes after this snapshot." for a Waitron Cloud copy — and choose **Restore backup**,
**Restore from my bucket** or **Restore this snapshot**.

If the backup holds sales dated more than a minute after the box's time, the box stops taking
payments once the recovery finishes, until its clock catches up or is confirmed: see
[When payments stop because of the clock](box-status.md#clock-behind).

A key that opens the backup does not bypass the history and clock checks. If the clock check
refuses, resolve its cause and try again.

## If a recovery is interrupted {#resume}

Until you choose the restore button, the page keeps what you entered only while it stays open.
Changing the file, key or environment discards what it checked, and a reload opens the page's
first screen; from there choose **Join or recover** and start the restore again. If the box refuses the
restore, the page returns to the form and you enter the node recovery key again.

Once you choose the restore button, the page says "Provisioning this server" and asks you to keep it
open. The box saves the request and restarts. If it stops after saving the request, the next start
runs it; if it stops while writing the backup into place, every later start runs it again.
