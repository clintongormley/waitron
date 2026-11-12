# Box status

**Box status** shows, on one page, whether each part of the box is working: sales, the tax agency,
the bucket copy, printers, card readers, the clock and disk space. It is also where you free space
on the box when its disk fills up, and where a Manager or Admin restarts Waitron on the box when
an alert says to. To read the box's log, use **Diagnostics** instead.

## Open the page {#open}

To keep a file about a problem in the dashboard, choose **Report a problem** in the top banner.
You can use it before signing in too. Open the dashboard over HTTPS if the button is missing.
On a phone, use the speech-bubble button with an exclamation mark.
During setup, choose **Report a problem** in the page header. You can keep a report even if
the box cannot answer or this already-open page loses its connection.
Describe what happened, check the preview, then choose **Download report**. The file contains
this browser's recent activity, rather than the box's log. Nothing is sent or saved on the box.
Keep passwords, payment details and personal information out of your description.

Open **Settings → Box status**, just above **Diagnostics**. Only people who can manage the system
see it.

The page reads the box again about every 15 seconds, so you can leave it open. These automatic
reads do not count as activity, so an open page does not keep you signed in.

On a box that only keeps a read-only copy of another box, the **Free** button cannot be pressed,
and the page says why under **Disk space**.

## Read the rows {#rows}

Each part has a row with a coloured dot:

- **Green** means the part is fine.
- **Amber** means it needs attention, but everything still works.
- **Red** means something can't be saved: the disk is full, or the clock is too wrong to record a
  sale. Each of these also turns **Sales** red.

A row shows the alerts the bell shows for that part, in the bell's words. The **Bucket copy**,
**Printers** and **Card readers** rows have a **Go to …** button, such as **Go to Backups**, that
opens their own page when you can open it, and an alert that has a page of its own adds a button for
that page too. Alerts that belong to none of the rows are counted below the rows, beside **See all
alerts**.

When nothing is wrong, each row says:

- **Sales**: **Recorded normally**, and when the last sale was made.
- **Tax agency**: **Sent normally**, and when the box last had records accepted by the tax agency
  (the time, by the box's own clock, that the box began that round of sending). A box that does not
  send records to the tax agency says so instead.
- **Bucket copy**: **Up to date**, and when the last upload was confirmed. It says **Not set up**
  when no copy is set up, and how many minutes behind the copy is when it falls behind.
- **Printers**: **No problems reported**, and the names of the printers set up.
- **Card readers**: **No problems reported**, and the names of the readers set up. A reader its
  card provider reports as offline shows here, as **“Bar” is offline.** While the bell or this page
  is open, the box asks the provider at most every five minutes, so it can show a few minutes late.
  This row is not there when card payments are turned off.
- **Clock**: **Correct**, and when the box last compared its clock with the tax agency's. When it
  has no usable comparison, for example just after the box starts, it says **Not yet compared with
  the tax agency**.
- **Disk space**: how much space is free out of the total, and how much the database, the backups
  kept on the box, the logs and the rest of the disk take. The rest of the disk includes about 8 MB
  the box keeps spare so that, on a full disk, it can still start and delete what it no longer
  needs. After a start that used that space, the tills stay stopped until about 24 MB is free and
  the box has put the 8 MB aside again.

After a send to the tax agency has failed, the **Tax agency** row says how many records are
waiting, and whether the box is retrying them by itself or a manager needs to sort some of them
out.

If the alerts could not be read, the page still shows every row and says that a part may look
fine when it is not. If some checks could not be made, the page says it may not show every
problem.

## Check the network {#network}

When your box can report its network, **Network** shows the wired connection and its address,
the current Wi-Fi name and the saved Wi-Fi name. Use it to check which network the
box is using. The card refreshes about once a minute; you cannot change the network here.
If a read fails, wait for the next automatic attempt. If the card is missing, reopen
**Box status** to ask the box again.

## Try the waiting records again {#retry-now}

On a box that sends records to the tax agency, the **Tax agency** row has a **Retry now** button.
After a failed send, the box pauses before it tries the waiting records again. **Retry now** tries
them again without waiting out that pause. It can be pressed only while the row says records are
not yet sent.

After you press it, the row says how many records will be tried again. They may not go straight
away: the tax agency asks for a wait between two sends, and the records are tried when it allows
the next send, except that a full batch of 1,000 records may go at once. If the box still cannot
reach the tax agency, they wait again.

While the box has no certificate for the tax agency, nothing is sent, so **Retry now** cannot be
pressed and the row says why. Install the certificate in **Venue settings**. The box tries again
within five minutes, and after that the button can be pressed while records are still not sent.

Records stopped after the tax agency refused several records in a row for the same reason are not
released by **Retry now**. The box keeps trying the first of them every hour, and the bell's alert
says why they stopped.

## Recover an invoice identity conflict {#invoice-conflict}

If this box stops issuing invoices because its identity conflicts with a filing response or an
AEAT lookup, keep any old or copied box offline. A new identity does not stop another machine from selling.

Open `/manage/recovery/fiscal-conflict` on this box over HTTPS. You need its current server key;
signing in to the dashboard does not replace that key. Enter the key and choose **Check conflict**
to see the affected invoice and identity. Confirm that the old or copied box is offline and that
nobody else is recovering it, then choose **Compare clocks**.

If a minute is unavailable, wait for the countdown. The page checks again every five seconds.
When the wait ends, compare the clocks again. Check the selected identity, then choose **Switch
identity** yourself. The countdown never switches it for you. Your existing orders, payments and
history are kept. Existing filing results and cases stay unchanged. An invoice found by a lookup
may be missing from this box's history.

If the answer is lost, the page checks the same attempt's result. An unconfirmed result is not a
successful switch. Use **Check conflict** to check again with the current key. Choose **Start a new
attempt** only when the page offers it; enter the key again and repeat the clock comparison.
**Stop** clears your entered key and confirmations and stops this page's checks. It cannot undo
a switch already committed on the box, so reopen the page and check its result if you stopped
while it was sending.

## Free space on the box {#free-space}

The **Free** button on the **Disk space** row shows how much it can free before you press it, for
example **Free 120 MB**. When there is almost nothing to free, it reads **Nothing to free** and
cannot be pressed.

**Free** deletes only files the box no longer needs:

- crash reports older than a week
- log files older than the two newest
- what a backup that was cut off part way left behind

It never touches your sales, your settings or your backups. When it has finished, the page says how
much it freed.

While a backup is running, **Free** leaves the backup's working folder alone, including anything a
cut-off backup left there, and the page says those files are not counted.

The sizes under **Disk space** show what is filling the disk. On **Backups**, you can choose how
many archives to keep. Leave without changing the settings to stop. Keep your database, recovery
keys and saved backups.

Before each backup, when the disk is short of space, the box can delete its oldest backups on that
disk to make room. It never deletes the newest backup in a folder, a backup from before the box's
last restore or fresh setup, or a backup in a bucket. If that is still not enough, the backup is not
made, and the bell says how much room it needs. While backups are on, the box also deletes its
oldest backups on that disk, within the same limits, whenever the disk falls under about 2 GB free, until about
2.5 GB is free. When the box starts with its disk full, it can delete them in the same way so that
it has room to start and, once it is running, tells you on the bell and by
[email](box-status.md#emails), as it does for the others.

A backup's date comes from the box's clock when it was made. So for a while after the box [sets
its own clock](box-status.md#clock-own-device), when the box deletes old backups it keeps the newest of
the backups made before the change, as many as it keeps of the others, besides those it keeps as
usual; and when it makes room, it deletes the backups made before the change last. This lasts as many days as backups are kept, and covers only changes the box made itself,
not one its time service made. The start on a full disk does not do this yet: it still deletes by
the dates in the backups' names.

This page cannot remove other files or move your data to a larger disk.

When the bell says **Backup not made**, open **Box status** and check **Disk space**. Use **Free**
if it is available, or leave without pressing it to skip cleanup. Freeing space does not start a
backup. If the cleanup is not enough, **Free** cannot remove other files for you; keep your
database, recovery keys and saved backups.

## When the box is out of space {#out-of-space}

When the disk is full, nothing can be saved: tills cannot save orders, payments or other changes,
and they show **Nothing can be saved: the server is out of space**. On this page, **Sales** and
**Disk space** turn red.

While the disk is full, a red bar at the top of every dashboard page starts **Disk full: the tills
cannot save anything (sales, orders, clock-ins).** To managers and administrators it also names the
backups in the bell's alert about deleted backups, while that alert is less than a day old and not
marked handled. They press **Open Box status** on it; anyone else presses **Sign in as a
manager**, which signs them out first. The bar goes within about half a minute of the tills saving
again.

Press **Free** to free space. Once enough space is free, the tills can save again by themselves;
nobody needs to restart anything.

After you press **Free**, this page and the alerts bell in the same dashboard read the box again
straight away. A bell open on another computer catches up within about a minute.

If **Free** does not free enough, follow the line at the bottom of the page about freeing more
space.

## Restart the box {#restart}

**Restart the box** restarts Waitron on the box without switching the box off. Every till stops selling
until Waitron has started again, so the page asks first: choose **Restart** to go ahead or
**Stop** to leave it. Use it when an alert says to. The page catches up by itself once the box is
back.

Managers and Admins can restart the box.

## Set the clock from your own device {#clock-own-device}

Box administration, held by Admin by default, lets you set the clock from your own device or approve it on a till. Staff can still confirm it on a till while startup waits.

If the clock reads a date before 28 October 2024, the tills show **Sales can't be recorded: the
server's clock is wrong**, and the bell says so too, with the date the box's clock reads.
Nothing can confirm the clock then. The way out is to set the
clock right: on a box kept in time over the internet, by connecting it to the internet; otherwise
an administrator sets it with **Check with this device's time**, or, during
[start-up](box-status.md#clock-at-start), a staff member from a till.

The **Clock** row then shows administrators a **Check with this device's time** button.
Anyone else who can open this page sees **Only an administrator can check the box's clock with
this device's time. Signing in as one signs you out here first.** and a **Sign in as an
administrator** button. The button opens a dialog that shows both times: **The box's clock says …
This device says …**

- When they are further apart and the box can set its clock, the dialog asks **The box's clock
  says … Your device says … Use your device's time?** Press **Use this time**, and the box sets its
  clock to your device's time and payments restart. The dialog says **The box's clock is
  set.** The box can set its clock only while it is not kept in time over the internet.
- Otherwise it says **The box could not show that its clock is within a minute of your device's.
  Check that your device's time is right; if it is, connect the box to the internet so it can
  correct its clock.** and offers only **Close**. Because of the time the answer takes, two times a
  little under a minute apart can still get this message.

Setting the clock can sign you out of the dashboard. When the clock moves by more than half an
hour, either way, every dashboard session that was in use just before ends, so the dialog adds
**Sign in again to go on.** A smaller step forward shortens the time any dashboard session can sit
unused before it ends by the size of the step; a smaller step back ends no session. Tills and
handhelds stay signed in.

If the box refuses to set its clock, the dialog says why above its buttons. For example, when the
part of the box that sets its clock is not answering, it says **This box cannot set its own clock:
the part of the box that does that is not answering. If the box can reach the internet, its time
service may still put the clock right by itself. Once the box's clock is within a minute of your
device's, you can confirm it here.** When the box's clock changed while you were checking, or the
box had not finished recording what it found about its clock, close the dialog and check again.

The box takes your device's word for the time, so check that your phone or computer shows the
right time first. For the same reason this never works from the box's own screen: there, the
device's clock is the box's clock, and the box refuses with **This screen is the box itself, so its
clock is the box's own. Confirm from your phone or another computer.**

Each time the box sets its clock, whoever or whatever set it, the bell has an alert saying so, with
the time before and after and how far the clock moved, for example **The box's clock was set from
Ana's device: moved forward 2 days and 3 hours, from 2026-10-21 18:40 to 2026-10-23 21:40.**, and the box
[emails](box-status.md#emails) the people who manage the system. When the box set its clock but
could not confirm the change took, the alert says so and asks you to check the box's clock on this
page. If the box cannot write the change down at once (a full disk, for example) and restarts before
it can, that change has no alert and no email.

## Just after a start {#clock-at-start}

When the box starts with its clock in doubt and cannot confirm it by itself, a
staff member can set or confirm the clock from a till, so that the venue does not wait for an
administrator. A restart of the box counts as a start, whether after a power cut, an update,
**Restart the box** or by hand.

The time from the start until the clock no longer stops payments is called start-up here. Within about
half a minute of the start, once the box has found it cannot confirm its time by itself, every till
and handheld where someone is signed in ends its red clock line with **Check the time** instead of
**Tell a manager**. On a box whose clock reads before 28 October 2024, or one that does not send
records to the tax agency, it does so at the till's next check, within about 15 seconds. Any staff member signed in on the
till can press it; it needs no permission. The [till notices guide](till-notices.md#notices) says
what the till's dialog shows and what each button does.

The till sends its own time. When it is more than a minute from the box's, **This device** sets the
box's clock to it, and **The server** keeps the box's clock whatever the till's time while the box
waits for its time to be confirmed after a start and payments are not also stopped because the clock
reads before 28 October 2024; otherwise **The
server** asks the person to correct the till's time. When it is within a minute, **Yes** keeps the
box's clock. Each of these the box accepts restarts payments. When the box sets its clock, the bell and the email name the
staff member and the till. When the till's time is used, other devices' readings do not stop it.

Two tills or handhelds that agree with the box confirm its time after a start by themselves.

Start-up ends as soon as the box finds that the clock no longer stops payments. From then on, once
the internet has confirmed the box's time, a staff member can no longer set the clock from a till.

## The box's time service {#clock-service}

The box has a time service that keeps its clock right over the internet. Where the box can read
that service, the **Clock** row says **Kept in time over the internet** when the service is
running and has reached a time server, and **Not kept in time over the internet** otherwise. When
the box cannot read it, for example on a laptop, the row says neither.

When the service is not keeping the clock right, the bell warns the people who can manage the
system. The warning comes by the bell only, not by email, and says why:

- **The box's time service is switched off, so nothing keeps its clock right.**
- **The box's time service is on but not running, so nothing keeps its clock right.**
- **The box's time service has not reached a time server, so its clock may drift.** Check that the
  box can reach the internet.
- **This box cannot see or control its time service: the part of the box that does that is not
  answering. If the box can reach the internet, its time service may still keep the clock right by
  itself.** Only a live venue's box says this; a laptop or a test box stays silent.

Each warning asks you to look at the box's date and time on this page. While the part of the box that sets
its clock is not answering, the box cannot set its clock: it can then only confirm a clock that is already right.

## Devices as clock witnesses {#clock-witnesses}

A box can't tell by itself that its own clock is wrong, so it compares it with other clocks. Tills
and handhelds send their own clock to the box about every 15 seconds while someone is signed in on
them or while they show the sign-in screen. Kitchen screens do not send theirs. A till or handheld
running on the box itself does not count, and devices at one network address count as one.

When two or more devices agree with each other that the box's clock is more than a minute off, the
bell warns the people who can manage the system: **2 devices
agree that the time is 2026-10-23 21:40, but the box's clock reads 2026-10-23 21:10. Check the box's
date and time on the Box status page.** Staff on the tills see nothing for this.

Devices never set the box's clock by themselves.

## Emails about the box {#emails}

The box emails everyone who can manage the system and has an email address when:

- its disk has about 2 GB free or less, after deleting any old backups it may;
- its disk is full, so nothing can be saved;
- its clock is set before 28 October 2024, so no sale can be recorded;
- it set its own clock, or tried to and could not confirm the change took;
- it deleted old backups to make room;
- a backup was not made for lack of room.

Each person gets one email per problem, in their own language, or the venue's if they have not
chosen one. If it cannot be sent, because the box has no internet or the mail server refuses it
(for example, because the mail server settings have a wrong password), the box tries again a
minute later, then after longer and longer waits, for up to a day. So the email arrives once the
connection or the settings are fixed, if that happens within the day. If the connection breaks
after the mail server has been handed the email, the box cannot tell whether it went and does
not send it again. If the problem ends first, for example because the clock was
set right, the box stops trying and sends nothing. For
deleted backups, the box keeps trying while their alert is open in the bell, for up to a day. The
full-disk email cannot be saved on a full disk, so the box sends it straight away and tries again
each minute while the disk stays full; every other email waits until the disk has room again. A full disk that is only partly freed is still nearly out of space, so
anyone the full-disk email did not reach is sent the nearly-out-of-space email instead. A
restart while the disk, a backup or the clock stays in trouble can send the same email again.
While no mail server is set up, nothing is sent.

Each time the box sets its clock it sends its own email, even when it sets the clock again within a
minute, which marks the first change's alert handled. Once a change's alert is handled, the box
stops trying to send its email to a manager whose address the mail server refused outright after
that, and a restart in the minute before the email is queued loses it. The alert itself stays on the **Alerts** page, under
**Handled**.

A box whose clock reads before 28 October 2024 usually cannot send its email: with a date that
early it cannot check the mail server's certificate.

## When a card amount differs {#card-amount-mismatch}

If a card amount differs, read the alert's two figures before taking any more money: what Waitron
requested and what the card provider reported. Check the charge in the provider's dashboard.
