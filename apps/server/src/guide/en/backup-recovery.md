# Recover from backup

## When first setup was interrupted {#interrupted-setup}

If the repair page cannot continue your setup, choose **Recover from backup**. You can use this
route even if the old setup password cannot be checked. You need the selected backup's named
node recovery key. The old attempt and its files stay in their own folders; opening a backup
does not give you access to those local records.

Use the box's secure connection. If your browser does not trust it, choose **Set up secure
connection** on the repair page first. **Check again** rereads the connection without running
a repair. **Stop** ends this attempt; you can close the tab or check again. If repair keeps
failing, stop here. This page cannot repair every saved certificate layout or replace a separately
installed certificate. For a separately installed certificate, check the server’s HTTPS address
and stop if it shows a warning. If your device blocks certificate installation, use a venue
device that allows it. Enter passwords and recovery keys only after HTTPS opens without warnings.

Stop the former box and coordinate with the other venues:
only one person should recover this taxpayer at a time.

While a recovery from backup is running on another device, the repair page says so, with when it
started and when it was last active. Until it stops, the page offers only **Reconnect** and **Set
up secure connection**, and it checks again by itself. A recovery counts as running while one of
its steps is in progress and for five minutes after its last activity. Those five minutes end early
if the recovery fails or the box restarts.

If a recovery from backup started and did not finish, the repair page says so, and **Start again**
deletes it along with the interrupted setup. The page does not offer **Recover from backup** beside
it. If the page says the setup database is missing, it shows the stopped recovery after you enter
the administrator password you chose during setup, and Start again deletes it once you tick
"Nothing was filed to AEAT and nothing was sold." and choose **Start again** once more. Otherwise
the page shows **Start again** beside the stopped recovery. Start again then asks for the
administrator password and shows the recovery again. If the setup's database already holds saved
items, it also says how many, and that none is an invoice. It deletes them all once you tick
"Delete the old attempt and start again." and choose **Start again** once more. Start again is not
offered if the database holds an invoice or another item Waitron never deletes, if the setup
already saved the settings the box trades with, or if it already finished.

If that recovery used a Waitron Cloud copy, its approval in Waitron Cloud closes by itself within an
hour of when it was given. Until then, Waitron Cloud cannot approve a new recovery for this box's
venue.

If one of the setup's records of its invoice series names is damaged, **Start again** still works,
after a warning. If the page says the setup database is missing, the warning appears after you
enter the administrator password you chose during setup. Otherwise this applies only to the box's
record of the names it chose, and Start again asks for that password first. The page names
each damaged record, for example "This box's record of the invoice series names it chose is damaged
and cannot be read.", and says from when new series names can start: usually a few minutes after
you entered the password. If you set up again before then, the setup waits until that time or, if
it is more than two and a half minutes away, tells you when you can carry on.

If the page says that Start again has not finished, reload it to see what is left to do. If the box
is restarting, wait until it answers.

If the recovery filled the box's disk, Start again still works: the box keeps about 8 MB of its disk
spare, and gives that space up so it can delete the recovery. If even that is not enough, the page
says the disk is full. Restarting the box deletes old logs and crash reports as it starts, which can
make enough room to try again.

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

Choose **Backup file**, **Bucket copy** or **Cloud copy** and the matching environment.
For an archive, choose the file and enter its archive key. For a bucket copy, paste its recovery
kit. For Cloud, request approval, approve it in Cloud and check the approval here. Cloud recovery
requires a supported recovery service; this route does not enable production Cloud recovery.

The archive key, bucket credentials and Cloud approval give access to a copy. You still need that
copy's named node recovery key to authenticate recovery. Keep production and preproduction separate.

## Prove access to the selected backup {#proof}

Enter the grouped recovery key from the sheet you kept for this backup, or choose its saved
recovery PDF. A newer replacement sheet may not open an older backup.

Confirm that the old box stays offline and that you are the only person recovering this taxpayer.
Choose **Open backup**. Only after the key is accepted does the page show the backup's taxpayer,
location, date and key name. Check those details before continuing.

Opening a backup pauses ordinary setup even if the key is refused. You can retry recovery here.
To return to ordinary setup, restart the box; going back or refreshing the page does not resume it.

If **Backups** cannot confirm the saved key, keep both the previous key and the key you just
saved. While changing a key, you can still copy or download both displayed keys after this
refusal. Stop changing keys and leave the page without another submission. This page cannot
diagnose conflicting backup-key settings or confirm which key opens a particular backup; do not
replace either key record on the strength of this message.

Open **Backups** and read the error beside the backup status. Choose the destinations and schedule
again. **Turn on backups** replaces the saved settings; leave without applying to keep them.
If a folder is refused, correct it before applying again. A successful save can still report a
loading error, so check the resulting status before relying on a new backup. This page cannot
diagnose every persistent host or key failure; keep your recovery keys and existing backup files.

If the bucket copy says its settings could not be used safely, choose **Change bucket** in
**Backups**. Correct the fields it marks. **Test** checks the bucket without saving settings;
**Save and turn on** applies them. **Cancel** leaves the saved settings as they were. This form
cannot diagnose a failure in the box's own configuration. Keep your recovery keys and existing
copies if the refusal persists.

## Make the new series {#series}

Use the recovery controls below the authenticated details. Enter the matching key again, confirm
the recovery conditions and choose **Compare clocks**. Follow the clock and waiting instructions;
there is no installation code to type. Choose **Recover** once the new series is selected.

A key that opens the backup does not bypass the history and clock checks. If a check refuses,
resolve its cause and try again. Do not delete the retained attempt's files by hand or edit its
recovery records.

## If a recovery is interrupted {#resume}

While the recovery page stays open and can reach the box, continue where you left off. The recovery
stops if the box restarts. Leaving the page or closing its tab also stops it, within five minutes.
If the recovery had saved progress, the repair page then shows it as stopped and does not offer
**Recover from backup** beside it; **Start again** deletes it, as described above. Otherwise, open
the backup again.
If recovery is already saved, reconnect to the box rather than proving or placing it again.

Changing the source or environment clears the page's authenticated controls. It does not delete
the saved operation or select a different backup for it. After **Recovery saved**, reconnect to
the box. If the result is uncertain, keep the files and investigate before starting another recovery.
