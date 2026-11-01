# Box status

**Box status** shows, on one page, whether each part of the box is working: sales, the tax agency,
the bucket copy, printers, card readers, the clock and disk space. It is also where you free space
on the box when its disk fills up. To read the box's log, use **Diagnostics** instead.

## Open the page {#open}

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
- **Red** means something can't be saved: the disk is full, the clock is too wrong to record a
  sale, or payments have stopped because the clock reads earlier than the last sale. Each of these
  also turns **Sales** red.

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
its own clock](box-status.md#clock-behind), when the box deletes old backups it keeps the newest of
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
and they show **Nothing can be saved: the box is out of space**. On this page, **Sales** and
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

## When payments stop because of the clock {#clock-behind}

When the box's clock reads more than a minute earlier than the latest sale recorded on the box, the
box stops taking payments and refunds. A sale recorded then would carry a time before that latest
one. The stop lasts until the clock reads no more than a minute earlier than that sale, or until
something confirms that the box's clock is right, as this section explains further down. Taking
orders, the kitchen and clocking in carry on, though a change or a kitchen send that would finish
paying a part-paid bill, and cancelling an order that already has an invoice, are refused. The [till
notices guide](till-notices.md#notices) lists what staff can and cannot do meanwhile.

The tills show **Payments stopped: the box's clock reads earlier than its last sale**. The alerts
bell says so too, with both times in it: the time on the box's clock and the time of the latest
sale. On this page, **Sales** and **Clock** turn red with the tills' words, and the **Clock** row
adds what to do: **With the internet the box corrects its clock by itself; otherwise an
administrator can use “Check with this device's time”.** Where the box can tell, the row also says
whether it is **Kept in time over the internet** or **Not kept in time over the internet**, as
[its time service](box-status.md#clock-service) explains.

While the box is running, a stop like this is also an alert in the bell and an
[email](box-status.md#emails) to everyone who can manage the system, administrators included. The
bell sends you to this page. The email says that an administrator can set the clock from their own
phone or computer on this page, and, if the box has just started, that any staff member can do it
from a till.

There are three ways out:

- **Set the clock right.** On a box that keeps its clock in time over the internet, connecting it to
  the internet lets it correct the clock by itself. Otherwise a box that sends records to the tax
  agency sets its clock from the tax agency's time by itself when it can reach it, an administrator can set it from their
  own phone or computer, and just after a start a staff member can set it from a till, as the
  paragraphs below explain. This ends the stop unless the latest sale itself carries a wrong, later
  time.
- **Confirm the box's clock**, when the box's clock is right and it was the latest sale that was
  recorded with a wrong, later time, for example while the clock was running fast. The box usually
  does this by itself, as the paragraphs after this list explain.
- **Wait.** Once the box's clock reaches a minute before the time of the latest sale, the box takes
  payments again.

A box cannot tell by itself whether its own clock is right, so during a stop it looks for another
clock that agrees with it. Any one of these confirms the clock, and payments then restart. The first
two need nobody to press anything:

- **The tax agency's time.** During a stop, a box that sends records to the tax agency asks it for
  its time about once a minute. An answer within a minute of the box's clock confirms it. The
  **Clock** row shows it as **Tax agency: matches (checked 2026-10-23 21:40)**.
- **Two tills or handhelds** at different network addresses, whose clocks are within a minute of the
  box's and of each other's. The row shows them as **Devices: 2 read 2026-10-23 21:40**. The [next
  section](box-status.md#clock-witnesses) explains which devices count. Just after the box starts,
  two devices are not enough on their own: a person confirms the time instead, as [Just after a
  start](box-status.md#clock-at-start) explains.
- **An administrator's own phone or computer**, as the paragraphs below explain.

Only a time taken while the box's clock already read more than a minute behind the last sale
counts, and only for five minutes. A time taken before a change to the box's clock does not count
either. There is no limit on how far behind the last sale the box's clock may be.

While the box waits, the **Clock** row says **Waiting for proof that the clock is right: the tax
agency's time (when the box sends it records), or two tills or handhelds.** Once the proof is in, it
says **Proof found: payments restart within a few seconds.**, and the box takes payments again
within about 15 seconds. [Just after a start](box-status.md#clock-at-start), two devices alone do
not restart payments, so while the tax agency's time does not agree the row says **Waiting for proof that
the clock is right: the tax agency's time (when the box sends it records), “Check the time” on a
till, or an administrator's device. The box has just started, so two tills or handhelds are not
enough.**

Sometimes the other clocks say the opposite: two or more tills or handhelds agree with each other
that the box's clock is more than a minute off, or the tax agency's time disagrees with it during
the stop. The row then lists each clock that disagrees, for example **Tax agency: does not match
(checked 2026-10-23 21:12)** or **Bar till: does not match (read 2026-10-23 21:13)**, and says
**Other clocks say the box's clock is wrong.** A clock that has answered both ways is listed once,
by its latest answer. Nothing can confirm
the clock, not even an administrator; it can only be set. The tax agency's answer counts first: when it agrees with the
box, disagreeing devices do not hold payments back. The box keeps the tax agency's disagreement
only in its memory, so it forgets it if the box itself restarts during the stop; while the tax
agency still disagrees, it comes back with the next answer.

When the tax agency's time disagrees with the box's during the stop, the box sets its own clock
from the tax agency's time, with nobody asked. Setting the clock this way, or in any of the ways
below, also confirms it: payments restart on the new time, even when that time is still earlier
than a latest sale that was dated by a clock running fast, and the box lists the sales dated
wrongly as for any confirmation. The box sets its clock only while it is **Not kept in time over
the internet**: a box whose time service keeps it in time leaves its clock to that service. If a
try fails, it tries again later. Devices that disagree never set the clock: they are listed on the
row and set nothing, and an administrator can still set the clock from their own device.

When no proof arrives, for example because the box has no internet and fewer than two tills are in
use, an administrator can confirm or set the clock from this page on their own phone or computer.
During a stop, the **Clock** row shows administrators a **Check with this device's time** button.
Anyone else who can open this page sees **Only an administrator can check the box's clock with
this device's time. Signing in as one signs you out here first.** and a **Sign in as an
administrator** button. The button opens a dialog that shows both times: **The box's clock says …
This device says …**

- When the two are within a minute of each other, counting half the time the box took to answer,
  the dialog asks **They agree. Confirm that the box's clock is right?** Press **Confirm**, and
  payments restart.
- When they are further apart and the box can set its clock, the dialog asks **The box's clock
  says … Your device says … Use your device's time?** Press **Use this time**, and the box sets its
  clock to your device's time and payments restart. The dialog says **The box's clock is
  set.** The box can set its clock only while it is not kept in time over the internet, and only
  while the tax agency has not answered during the stop: once it has, the box sets or confirms its
  clock from the tax agency's time itself.
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

When you press **Confirm**, the box reads its own time again and judges the two once more. If it
cannot show that they agree, the dialog shows the new times with the same message and only
**Close**. If by then payments are not stopped and no check waits, for example because something
else confirmed the clock or other clocks said it is wrong, it says **There is nothing left to
confirm. See the Clock row.** and offers only **Close**.

The box takes your device's word for the time, so check that your phone or computer shows the
right time first. For the same reason this never works from the box's own screen: there, the
device's clock is the box's clock, and the box refuses with **This screen is the box itself, so its
clock is the box's own. Confirm from your phone or another computer.**

The box takes payments again straight away. No sale already recorded changes. The next sale carries
the box's clock, so it is recorded with an earlier time than the latest sale. The **Clock** row
turns amber and says what confirmed the clock, for example **Payments restarted at 2026-10-23
21:42, confirmed by two tills or handhelds.** The bell keeps an alert with both times and what
confirmed the clock, and the box [emails](box-status.md#emails) the people who manage the system.

A confirmation covers one step back. If the box's clock goes back again, so that it reads more than
a minute further behind than when it was confirmed, or more than a minute earlier than a sale made
since, payments stop again until the clock is confirmed again, in any of the same ways. That holds
even when the clock goes back a little at a time.

A stop like this usually means the box's clock ran fast for a while, so some sales were recorded
with a time later than the real time. They stay as recorded: a sale recorded for the tax agency
cannot be changed. When the clock is confirmed, the box works out which ones they are: the sales
recorded before the stop with a time more than a minute after the moment the box noticed the stop.
It lists them on this page under **Sales dated wrongly**, with each sale's **Invoice** and **Time
recorded**, and says **Download each list for your tax adviser and go through it with them, then
mark it handled here with a note of what was done.** [Sales dated
wrongly](box-status.md#sales-dated-wrongly) explains the download and the note. The bell has an
alert with how many sales there are and the first and last times, and the box emails the people who
manage the system. If the box itself restarted during the stop, it cannot be sure when the stop
began, so the list may be short, and the alert says so. When no sale was dated wrongly, there is no
list and no alert.

The stop can also end by itself, because the clock was set right or reached the time of the last
sale. The box still needs a confirmation to know which sales were dated wrongly, so until it gets
one the **Clock** row stays amber, its line says **Not confirmed since the payment stop**, and it
says **The payment stop that began at 2026-10-23 21:10 has
ended, but nothing has confirmed the box's clock yet. The box asks the tax agency once a minute when
it sends it records; two tills or handhelds, or an administrator's own device, can confirm it too.**
Payments carry on meanwhile. A box that sends records to the tax agency keeps asking it for its time
about once a minute, and administrators see **Check with this device's time** under the row. Once
the tax agency, two tills or handhelds, or an administrator's device confirm the clock, the box
lists the sales dated wrongly as above.

If instead the tax agency or two tills or handhelds say the box's clock is wrong, or payments stop
for the clock again after more sales were recorded, the box cannot tell which sales were dated
wrongly. The bell, an email and the **Sales dated wrongly** section then say so: **The payment stop
that began at 2026-10-23 21:10 ended by itself, but nothing confirmed the box's clock, so the box
cannot tell which sales were dated wrongly. Check the box's clock, and go through the sales since
then with your tax adviser.**

If the box later finds that a clock it confirmed during a stop was wrong, because the tax agency's
time disagrees with it or the clock jumps forward by more than a minute, and sales were made after
the confirmation, the bell says so: **Sales recorded between 2026-10-23 21:42 and 2026-10-23 22:15
were dated by a clock that proved wrong. They stay as recorded; ask your tax adviser.** The times in
that alert are fixed when it is raised, so sales made after it are not added to it.

You do not need to restart the box or the tills. Each payment is checked when it is made, so once
the clock reads no more than a minute before the latest sale, or the clock is confirmed, the next
payment is no longer refused for the clock. The tills' notice and this page's red rows clear within
about 15 seconds. The bell, and the bell's alert shown under the **Clock** row, clear within about
a minute.

A card taken from a bill's payment options just as payments stop can show in the bell as a card
payment that Waitron could not record. The box records that payment by itself once payments are
back, but the alert stays in the bell until a manager presses **Mark handled** on it.

If the clock reads a date before 28 October 2024, the tills show **Sales can't be recorded: the
box's clock is wrong** instead, and the bell says so too, with the date the box's clock reads.
Nothing can confirm the clock then, and the box cannot ask the tax agency for its time, because
with a date that early it cannot check the tax agency's certificate. The way out is to set the
clock right: on a box kept in time over the internet, by connecting it to the internet; otherwise
an administrator sets it with **Check with this device's time**, or, just after a start, a staff
member from a till.

Each time the box sets its clock, whoever or whatever set it, the bell has an alert saying so, with
the time before and after and how far the clock moved, for example **The box's clock was set from
Ana's device: moved forward 2 days and 3 hours, from 2026-10-21 18:40 to 2026-10-23 21:40.**, and the box
[emails](box-status.md#emails) the people who manage the system. When the box set its clock but
could not confirm the change took, the alert says so and asks you to check the box's clock on this
page.

## Just after a start {#clock-at-start}

When the box starts with one of these clock problems and cannot reach the tax agency's time, a
staff member can set or confirm the clock from a till, so that the venue does not wait for an
administrator. A restart of the box counts as a start, whether after a power cut, an update or by
hand.

The time from the start until the clock no longer stops payments is called start-up here. Within about
half a minute of the start, once the box has asked the tax agency and had no answer, every till
and handheld where someone is signed in ends its red clock line with **Check the time** instead of
**Tell a manager**. On a box whose clock reads before 28 October 2024, or one that does not send
records to the tax agency, it does so at the till's next check, within about 15 seconds. Any staff member signed in on the
till can press it; it needs no permission. The [till notices guide](till-notices.md#notices) says
what the till's dialog shows and what each button does.

The till sends its own time. When it is more than a minute from the box's, the box sets its clock
to it; when it is within a minute, the box keeps its clock, and payments restart on it. Either way
the bell and the email name the staff member and the till. When the till's time is used, other
devices' readings do not stop it. When the till agrees with the box, two devices that disagree
with the box stop the confirmation, and the dialog says why. Two tills or handhelds that agree
with the box do not restart payments on their own during start-up; a person confirms instead.

Start-up ends as soon as the box finds that the clock no longer stops payments. From then on, a
staff member can no longer set the clock from a till. If payments stop for the clock again while
the box is running, the tills offer nothing: an administrator sets the clock from this page on
their own phone or computer. If the tax agency answers while **Check the time** is offered, the
offer ends and the box uses the tax agency's time itself.

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

Each warning but the last asks you to look at the box's date and time on this page. While the service is not
keeping the clock right, the box can still set its own clock during a stop, as [When payments stop
because of the clock](box-status.md#clock-behind) explains. While the part of the box that sets
its clock is not answering, it cannot: the box can then only confirm a clock that is already right.

## Sales dated wrongly {#sales-dated-wrongly}

A sale recorded with the wrong time stays as it was recorded, so what matters afterwards is what
your tax adviser makes of it, and keeping a record of what was decided. The **Sales dated wrongly**
section on this page helps with both: each list can be downloaded as a file for your adviser, and
each list can keep a note of what was done once you mark it handled.

Under each list, **Download for your adviser** saves a spreadsheet file (CSV) named after the day
of the first sale's recorded time, for example `misdated-sales-2026-10-23.csv`. An entry where the
box cannot tell which sales were dated wrongly has no list, so it has no download either. The file
is in the venue's language, English or Spanish, not the language you chose for the dashboard.

Its first line says what happened, for example: **Bar Sol: 3 sales were recorded with a time later
than the real one, from 23/10/2026 21:12 to 23/10/2026 21:40. Each was made before 23/10/2026
21:11. The clock was confirmed by two tills or handhelds on 23/10/2026 21:42.** The "made before"
time is when the payment stop began by the confirmed clock, plus the one minute a confirmation
allows, rounded up to a whole minute. If the box restarted during the stop, the line ends
with **The box restarted during the stop, so the list may be short.**

Then comes one row per sale, with these columns:

- **Series** and **Number**: the invoice shown in the section's **Invoice** column, split in two.
- **Invoice date**: the date on the invoice, as it was recorded.
- **Time recorded**: the time the sale was recorded with. The sales' times are written in the time
  zone the box recorded with each sale, as the section's lists and the box's email do, so a sale's
  time here is the clock time its list shows, and the first and last match the email.
- **Real time**: **Unknown** on every row. The box does not know when each sale was really made,
  only that it was made before the time in the first line.
- **Amount (EUR)**: the invoice's total as it was recorded, with two decimal places, the venue
  language's decimal mark and no currency sign. A cancellation shows **Cancellation** instead.
- **Different day**: **Yes** when, by the confirmed clock, the sale was made on an earlier day than
  its invoice date, so possibly in a different VAT period; ask your tax adviser about these.
  **Cannot tell** for any other sale, because it may still have been made on its invoice date.
  **Not applicable** for a cancellation, whose invoice date is the date of the invoice it cancels.
  The column never says "No", because the box does not know each sale's real time.

Once you have been through a list with your adviser, press **Mark handled** under it. A dialog
asks for a **Note**, for example what your adviser said or what was done. The note is optional and
can be up to 500 characters; **Mark handled** works with or without one. An entry where the box
cannot tell which sales were dated wrongly has **Mark handled** too. The bell and the **Alerts**
page also offer **Mark handled** on the alert, but they take no note.

A handled list leaves the open lists and moves under **Handled lists**, a fold at the end of the
section whose heading counts them, for example **Handled lists (2)**. Open it to see every handled
list, newest first. Each shows its sales and its download, unless the box could not tell which
sales they were, and usually says who handled it and when, for example
**Marked handled by Ana on 2026-10-24 10:05.**, and its note, as **Note: …**. The time it was
marked handled is shown in your own device's time zone, while the sales' times are the clock times
they were recorded with. When a later check also cannot tell which sales were dated wrongly, and
its payment stop began earlier than that of an open "cannot tell" entry, the new entry covers the
sales the old one asked about, so the box marks the old entry handled itself. That entry says
**Marked handled by the box on …**

A handled list that has no note, whoever handled it, offers **Add note**, so you can add the one
note it may take. Its dialog, **Add a note**, needs a note before **Save** works. Once a list has a
note, it cannot be changed or replaced. If the list was marked handled elsewhere while you were
writing a note for it, **Mark handled** says **This alert was already marked handled, so the note
was not saved. Add it from Handled lists on the Box status page.**

## Devices as clock witnesses {#clock-witnesses}

A box can't tell by itself that its own clock is wrong, so it compares it with other clocks. Tills
and handhelds send their own clock to the box about every 15 seconds while someone is signed in on
them. Kitchen screens do not send theirs. A till or handheld running on the box itself does not
count, and devices at one network address count as one.

When two or more devices agree with each other that the box's clock is more than a minute off, the
bell warns the people who can manage the system, whether or not payments have stopped: **2 devices
agree that the time is 2026-10-23 21:40, but the box's clock reads 2026-10-23 21:10. Check the box's
date and time on the Box status page.** Staff on the tills see nothing for this.

The same readings are the device proof that confirms the box's clock during a stop, as [When
payments stop because of the clock](box-status.md#clock-behind) explains, except [just after a
start](box-status.md#clock-at-start). Devices never set the box's clock by themselves.

## Emails about the box {#emails}

The box emails everyone who can manage the system and has an email address when:

- its disk has about 2 GB free or less, after deleting any old backups it may;
- its disk is full, so nothing can be saved;
- its clock is set before 28 October 2024, so no sale can be recorded;
- its clock reads earlier than its last sale, so payments have stopped;
- its clock was confirmed during such a stop, so payments restarted;
- it set its own clock, or tried to and could not confirm the change took;
- it found sales dated wrongly after such a stop, or found that it cannot tell which ones were;
- it deleted old backups to make room;
- a backup was not made for lack of room.

Each person gets one email per problem, in their own language, or the venue's if they have not
chosen one. If it cannot be sent, because the box has no internet or the mail server refuses it (for
example, because the mail server settings have a wrong password), the box tries again each minute
while the problem lasts, until the mail server accepts it. So the email arrives once the connection
or the settings are fixed. If the problem ends first, for example because the clock was set right,
the box stops trying and sends nothing. For a confirmed clock, sales dated wrongly and deleted
backups, the box keeps trying while their alert is open in the bell. A full disk that is only partly
freed is still nearly out of space, so anyone the full-disk email did not reach is sent the
nearly-out-of-space email instead. A restart while the problem lasts can send the same email again.
While no mail server is set up, nothing is sent.

Each time the box sets its clock it sends its own email, even when it sets the clock again within a
minute, which marks the first change's alert handled. Once a change's alert is handled, the box
stops trying to send its email to a manager whose address the mail server refused outright, and a
restart before the email is sent loses it. The alert itself stays on the **Alerts** page, under
**Handled**.

A box whose clock reads before 28 October 2024 usually cannot send its email: with a date that
early it cannot check the mail server's certificate.
