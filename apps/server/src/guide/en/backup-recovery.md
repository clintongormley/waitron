# Recover from backup

Keep the previous recovery pack when you change the recovery key. Until the new bucket copy is ready, the previous pack still matches the copy offered for recovery. If the page says the pack does not match the copy or the bucket login cannot read it, try the matching pack, or correct the bucket access and try again.

Scheduled backups and the bucket copy each use the folder you choose, with no extra venue folder. Choose separate folders for scheduled backups and the bucket copy. Neither folder can be inside the other.

Once scheduled backups are on, choose **Back up now** on **Backups** to make a copy at your saved destinations. Watch the status on that page for the result. It counts as one of your saved copies, so with a limit of two, two manual backups replace the older copies.

Use a bucket-copy folder that holds no other stream's copy. When Waitron says “this bucket folder holds another copy”, choose **Change bucket** and enter a different prefix.

You can share an archive folder between boxes: each box removes only its own backups. After a restore, choose a new folder if you want to keep all previous copies, because the restored box can still remove them. Waitron leaves other boxes’ archives and files it does not recognise alone; manage those files yourself when you need more room.

## When first setup was interrupted {#interrupted-setup}

Reloading the tab that was doing the setup carries on with it, until the setup starts activation.
Otherwise the page offers **Start again** and **Recover from backup**. Both delete the setup that stopped part way in the same way, and **Recover from backup**
then leads to the restore a new box uses. Neither asks for a password: anyone who can open the
repair page can use them, and can see what the page shows when one is pressed. When you choose one,
the box checks what it would delete and the page shows it.

If the box is still showing its setup screens rather than the repair page, either one first asks
you to stop the setup. **Stop this setup** ends the setup for whoever is doing it, which cannot be
undone, deletes nothing, and restarts the box; after **Reconnect**, **Start again** and **Recover
from backup** show what they would delete. **Cancel** keeps everything as it is.

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

Neither is offered, and the page says why in the same words for both, if the setup already
finished, or if the setup database holds an invoice or another record Waitron never deletes. If the
box cannot confirm that deleting the setup is safe, the page says so and offers neither. That
includes an unreadable setup record unless the page offers the damaged-record confirmation below.
Over a plain connection neither works: set up the secure connection first.

If the setup’s own record is damaged, the page may offer a warned **Start again** or **Recover from backup** after checking that the database holds no sales or fiscal records. Waitron cannot tell whether that setup reached AEAT. Either choice deletes the setup database, including any menu or staff details, once you tick the confirmation and press the same button again. Choose **Cancel** to keep everything. After **Recover from backup**, you choose a backup to replace it.

Once the setup is deleted the box restarts. After **Recover from backup**, **Reconnect** opens "Join
or recover an existing restaurant", where you choose **Restore from backup** or **Restore from my
bucket**, as on a new box; restoring needs the recovery key (for a backup file) or the recovery kit
(for your bucket), and that backup's server key. After
**Start again**, **Reconnect** opens "Set up this Waitron server", where you choose how to set up
this box. If the page is reloaded before you press **Reconnect**, it does not remember which you
chose and opens its first screen. If that screen asks "Is this page secure?", press **Continue to
setup**; then, to restore, choose **Join or recover**.

If the page says "Deletion interrupted", after **Start again** or after **Recover from backup**,
reload it to continue.

If a Start again was cut off and the box then finds files that Start again did not create, such as
a venue copied from a backup, the box does not start. If its page lists the files, it also asks,
over the box's secure connection, for the administrator password you chose during setup. **Keep everything
and stop** leaves the files as they are, and the page then stays until Waitron is reinstalled.
**Move these files aside and finish Start again** moves the files, unchanged, into a new folder on
the box and finishes Start again; the box then starts a new first setup. It also keeps a copy of the
box's key file in the set-aside folder: anyone who copies that folder off the box can open the
secrets saved in those files. If files are added, removed or
written to after the page opens, the box refuses the choice and changes nothing: press **Retry a normal boot** to
see them again. From the sixth wrong password on, the page makes you wait before the next try,
never more than 15 minutes, and each 15 minutes without a wrong password forgives one. If the page
says that Start again was moving files aside and has not finished, press **Retry a normal boot** to
finish moving them; the box then starts a new first setup.

Use the box's secure connection. If your browser does not trust it, choose **Set up secure
connection** on the repair page first. **Check again** rereads the connection without running
a repair. **Stop** ends this attempt; you can close the tab or check again. If repair keeps
failing, stop here. This page cannot repair every saved certificate layout or replace a separately
installed certificate. For a separately installed certificate, check the server’s HTTPS address
and stop if it shows a warning. If your device blocks certificate installation, use a venue
device that allows it. Enter passwords, recovery keys and server keys only after HTTPS opens without warnings.

Stop the former box and coordinate with the other venues:
only one person should recover this taxpayer at a time.

## Choose your copy {#source}

On "Join or recover an existing restaurant", choose **Restore from backup** for a backup file, or
**Restore from my bucket** for the continuous copy in your own storage bucket. For a Waitron Cloud
copy, choose **Restore from backup** and then **Restore from Waitron Cloud**.

**Add a mirror node**: this server joins the primary and keeps a copy of the restaurant's data.
Once it has joined, it can take over: see [Hand over to a spare box](servers.md#hand-over) and
[Start here when the main box has failed](servers.md#emergency). A new server cannot join a primary
that is already gone: to recover then, choose a restore option.

For a backup file, choose it in **Backup file**, enter the key that unlocks it in **Recovery key**,
and choose its **Backup environment**. For your bucket, choose your recovery pack or kit file in
**Recovery pack or kit file**, or paste the kit in **Recovery kit**, and choose the **Environment**
the old box ran in. If the pack was made before the box had a bucket copy, is not a Waitron recovery
pack, or is damaged or was changed after it was made, the page says so under the field. For Waitron
Cloud, choose **Start Cloud recovery**, enter the code the page shows in your Waitron Cloud account
(**Open Waitron Cloud**), then choose **Check approval**. Cloud recovery requires a supported
recovery service.

Choose a box with enough free disk space for the recovered database and the temporary copies
needed to open the backup.

For a large backup, connect your device by cable or to the venue's network before uploading.
Choose a file no larger than 4 GiB. A slow upload can take up to 12 hours.
If the upload does not finish, keep your selected file, improve the connection and try again.

Then choose **Review backup**. The page shows the selected backup: its source, business, venue,
date, node and server key. Check those details before continuing. Keep production and
preproduction separate. If the manifest is damaged or incomplete, choose another complete backup.
If the format is unsupported, install a Waitron version that supports it before trying again.

The recovery key, the bucket kit and the Cloud approval give access to a copy. You still need that
copy's named server key to authenticate recovery.

On a test server restored from Waitron Cloud, if **Cloud services** says the saved reconnection
request cannot be read, choose **Get a fresh reconnection request**, then ask the Cloud owner to
approve the new request in Cloud.

## Prove access to the selected backup {#proof}

At the end of Preparation, choose **Download recovery pack (PDF)**. Print the pack or keep it
somewhere other than the server. If setup offers **Save as a file**, keep that file with your
other recovery documents. Open **Backups** from the dashboard alert to set up your copies.

Below the review, under "Recover this box", choose your recovery pack, or an older recovery PDF,
that holds the server key for this backup in **Recovery PDF**; or type the grouped key printed on it
in **Server key**. If the pack does not hold the server key, the page says so and, when the pack
records it, names the pack or the key name to look for. A pack or sheet with a newer server key may
not open an older backup. Tick "The old box is stopped and will stay offline.", "I am the only
person recovering this taxpayer, across all venues." and "These details are correct."

If **Backups** cannot confirm the saved key, keep both the previous key and the key you just
saved. While changing a key, you can still copy or download both displayed keys after this
refusal. Stop changing keys and leave the page without another submission. This page cannot
diagnose conflicting backup-key settings or confirm which key opens a particular backup; do not
replace either key record on the strength of this message.

If scheduled backups are off because their saved settings cannot be used, open **Backups** and
read the error beside the backup status. Choose the destinations and schedule again.
**Turn on backups** replaces the saved settings; leave without applying to keep them.
Choose a backup folder outside the box's scratch folder; starts empty scratch to remove temporary copies. If a folder is refused, correct it before applying again. A successful save can still report a
loading error, so check the resulting status before relying on a new backup.

When **Backups** says the saved settings can't be used, choose **What the box recorded**. The panel
lists the times the box could not use its saved backup settings since it last started, newest first
and at most five, each with what went wrong: for example, the key number the settings were locked
with and the key numbers this box holds. It then describes the saved record as it is now: when it
was last written and, if it reads, the folders and buckets it names and whether each folder exists.
It says whether the box holds a usable recovery key. It shows a bucket's access key ID but never its secret,
and the recovery key only by its fingerprint. The panel reads and changes nothing: **Read again**
reads the facts again and does not turn backups on, and **Stop** closes the panel. It repairs
nothing either; to replace the saved settings, choose the destinations again and apply them. Keep
your recovery keys and existing backup files.

If the bucket copy says its settings could not be used safely, choose **Change bucket** in
**Backups**. Correct the fields it marks. **Test** checks the bucket without saving settings;
**Save and turn on** also checks that a test file can be read with its matching key and that reads with a wrong key or no key are refused before applying the settings. If Save refuses the bucket, follow the message to enable those keys or choose another provider. Save can allow customer-supplied encryption keys in your bucket’s settings. That change remains if a later check fails. **Cancel** leaves the saved settings as they were. This form
cannot diagnose a failure in the box's own configuration. Keep your recovery keys and existing
copies if the refusal persists.

If the box says the bucket copy is not running, open **Backups** and press **Start the copy again**,
which starts it with the settings it already has. If it stops again, choose **Change bucket** and
press **Test** to check the bucket.

If the bell or **Box status** says old copies in the bucket or on the standby server are not being
tidied, they are being kept. Waitron retries daily while the copy is running normally and clears the
warning when it finds the marker. To request a
fresh marker sooner, a Manager or Admin can use **Box status**, **Restart the box** when you are not
serving. This starts a full copy with a fresh marker, and tills stop selling during the restart.

If the bucket copy says another box is writing this venue's copy to the same bucket and that box
replaced this one, switch this box off: two boxes must never sell for one venue.

## Make the new invoice series {#series}

If this browser kept invoice observations for the selected taxpayer and environment, the recovery
form shows **Invoices seen on this device**. Each entry gives the last invoice number the browser
kept for that series, its issue date and its fingerprint. Compare these with the history you have:
the list may be incomplete, and clearing browser data removes it. You can recover with a fresh device or when
browser storage is unavailable. The observations stay in this browser and are not sent with the
recovery request. The report reads the storage available at this Waitron address; it does not
fetch observations from other devices.

Restoring replaces the database already on this server.

Enter the server key, tick both statements and "These details are correct.", then choose
**Proceed**. The invoice series is
the code at the start of every invoice number; recovery creates new ones so the box never repeats
the old box's numbers. After **Proceed** the page compares the clocks and creates the invoice series
by itself, including after any wait it shows; there is no installation code to type. If the box
cannot check its time over the internet, the page first shows the box's time and this device's:
check that both are right, then choose **Confirm the time**. It then shows
**We've created these invoice series:** with the new invoice series. If you change the key or untick a box,
the page stops until you choose **Proceed** again. Before **Proceed**, **Edit these details** goes
back to choosing the backup.

Tick the confirmation the page shows — "I confirm no other running server has newer restaurant
data." for a backup file or bucket copy (for a bucket copy, also "This is my business. Restore it
onto this server."), or "I confirm the old server and surviving peers are stopped, and I accept
losing changes after this snapshot." for a Waitron Cloud copy — and choose **Restore backup**,
**Restore from my bucket** or **Restore this snapshot**.

A key that opens the backup does not bypass the history and clock checks. If the clock check
refuses, resolve its cause and choose **Compare the clocks again**. If the server cannot check its time over the internet and the
clocks differ, after **Proceed** the page shows the server's time and this device's and asks which is correct: **The
server**, **This device** or **Both times are wrong**. **This device** sets the server's time from
the device you are using, and the page carries on by itself. After either of the other two, correct
this device's time, reconnect to the box, then choose **Compare the clocks again**.

If, after you choose the restore button, the server needs its time confirmed again, the page where
you chose it shows the server's time and this device's: check that both are right, then choose
**Confirm the time**, or **This device** if the server's time is wrong. If that page was closed, open
any of the server's pages on a phone, computer or till on the venue's network and enter the selected
backup's server key to see the same step. The restore then carries on by
itself. If the server instead shows a page saying it could not make its new invoice series, choose
**Retry a normal boot**, or **Throw this restore away** where that page offers it and restore again.

If the backup has no active administrator with a password, choose another backup.

## If a recovery is interrupted {#resume}

If the downloaded copy did not pass its checks, try again or choose another backup.

If an earlier restore choice is still saved, it will run when the server starts. Choose another restore to replace it.

Until you choose the restore button, the page keeps what you entered only while it stays open.
Changing the file, key or environment discards what it checked, and a reload opens the page's
first screen; from there choose **Join or recover** and start the restore again. If the box refuses the
restore, the page returns to the form and you enter the server key again.

Once you choose the restore button, the page says "Provisioning this server" and asks you to keep it
open. The box saves the request and restarts. If it stops after saving the request, the next start
runs it; if it stops while writing the backup into place, every later start runs it again.

## After a recovery {#after-recovery}

Keep the old box switched off and disconnected from the network. If it is switched on again,
it can go on selling and issuing invoices under its old series.

Open **Reporting → Fiscal filing** and look at
[Possibly missing history](fiscal-filing.md#missing-history). Under **Identity changes without a
handover**, the restore is listed with the last invoice the backup holds, if it holds any. The old
box may have issued later invoices that the backup does not have.

Once the box is online, it checks AEAT's records. Invoices AEAT holds under the old series that this
box did not issue then appear under **Invoices AEAT holds that this box did not issue**. Choose
**Export these cases for your tax adviser** and give them the file. Do not enter those sales again:
AEAT already has them.

## An invoice conflict on a running box {#invoice-conflict}

If the box still has your orders and payments but stops issuing invoices after an identity
conflict, use [Recover an invoice identity](box-status.md#invoice-conflict) with its current recovery
key. That procedure switches the live identity without restoring a backup. It keeps the rejected
record and its open case. Take any old or copied box offline before continuing.
