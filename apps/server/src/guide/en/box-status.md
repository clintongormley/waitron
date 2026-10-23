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
- **Tax agency**: **Sent normally**. A box that does not send records to the tax agency says so
  instead.
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
  kept on the box, the logs and the rest of the disk take.

After a send to the tax agency has failed, the **Tax agency** row says how many records are
waiting, and whether the box is retrying them by itself or a manager needs to sort some of them
out.

If the alerts could not be read, the page still shows every row and says that a part may look
fine when it is not. If some checks could not be made, the page says it may not show every
problem.

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

At the bottom, the page always says how to free more: keep fewer backups on the box, on the
**Backups** page, or ask whoever installed the box to remove old versions of Waitron or fit a
bigger disk. The sizes under **Disk space** show what is filling the disk.

## When the box is out of space {#out-of-space}

When the disk is full, nothing can be saved: tills cannot save orders, payments or other changes,
and they show **Nothing can be saved: the box is out of space**. On this page, **Sales** and
**Disk space** turn red.

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
someone restarts payments, as this section explains further down. Taking orders, the kitchen and
clocking in carry on, though a change or a kitchen send that would finish paying a part-paid bill,
and cancelling an order that already has an invoice, are refused. The [till notices
guide](till-notices.md#notices) lists what staff can and cannot do meanwhile.

The tills show **Payments stopped: the box's clock reads earlier than its last sale**. The alerts
bell says so too, with both times in it: the time on the box's clock and the time of the latest
sale. On this page, **Sales** and **Clock** turn red with the tills' words, and the **Clock** row
adds what to do: **Connect the box to the internet so it can correct its clock, or call whoever
installed it.** Where the box can tell, the row also says whether it is **Kept in time over the
internet**.

There are three ways out:

- **Set the clock right.** On a box that keeps its clock in time over the internet, connecting it to
  the internet lets it correct the clock by itself. Otherwise, call whoever installed the box: the
  box has no page for setting its clock. This ends the stop unless the latest sale itself carries a
  wrong, later time.
- **Restart payments**, when the box's clock is right and it was the latest sale that was recorded
  with a wrong, later time, for example while the clock was running fast. The paragraphs after this
  list explain when the page offers it.
- **Wait.** Once the box's clock reaches a minute before the time of the latest sale, the box takes
  payments again.

When the page has fresh proof that the box's clock is right, the **Clock** row shows that proof and
a **Restart payments** button. The proof is one of these:

- **Tax agency: matches (checked 21:40)**: during a stop, a box that sends records to the tax agency
  asks it for its time each minute, and its answer was within a minute of the box's clock.
- **Devices: 2 read 21:40**: two or more tills or handhelds sent a clock within a minute of the
  box's. The [next section](box-status.md#clock-witnesses) explains which devices send their clock.

Only proof taken since payments stopped counts, and only for five minutes. A reading taken before a
change to the box's clock does not count either.

The page does not offer a restart, and says why under the **Clock** row, when:

- there is no fresh proof: **There is no fresh proof that the box's clock is right.**
- two or more devices agree with each other that the box's clock is more than a minute off, or the
  tax agency has disagreed with it at any time during this stop: **Other clocks say the box's clock
  is wrong.**
- the box's clock is more than 24 hours behind the latest sale: **The box's clock is more than 24
  hours behind the last sale.**

Only people who can manage the system can restart payments. Pressing **Restart payments** opens a
dialog that shows the time on the box's clock, the time of the latest sale and the proof. Press
**Restart payments** in the dialog to confirm. If two people confirm at about the same time, only
one restart is made, and the second person sees the first one.

After a restart, the box takes payments again straight away. No sale already recorded changes. The
next sale carries the box's clock, so it is recorded with an earlier time than the latest sale. The
**Clock** row turns amber and says who restarted payments and when, for example **Payments
restarted by Ana at 21:42**, and the bell keeps an alert naming that person, both times and the
proof.

A restart allows for one step back only. If the box's clock goes back again, so that it reads more
than a minute further behind than it did at the restart, or more than a minute earlier than a sale
made since the restart, payments stop again. That holds even when the clock goes back a little at a
time. The page then does not offer another restart. Instead the **Clock** row says **Payments were
already restarted, and the box's clock has gone back since. Get the clock checked.**

If the box later finds that the clock it trusted at the restart was wrong, because the tax agency's
time disagrees with it or the clock jumps forward by more than a minute, and sales were made under
the restart, the bell says so: **Sales recorded between 21:42 and 22:15 were dated by a clock that
proved wrong. They stay as recorded; ask your tax adviser.** The times in that alert are fixed when
it is raised, so sales made after it are not added to it.

You do not need to restart the box or the tills. Each payment is checked when it is made, so once
the clock reads no more than a minute before the latest sale, the next payment is no longer refused
for the clock. The tills' notice and this page's red rows clear within about 15 seconds. The bell,
and the bell's alert shown under the **Clock** row, clear within about a minute.

A card taken from a bill's payment options just as payments stop can show in the bell as a card
payment that Waitron could not record. The box records that payment by itself once payments are
back, but the alert stays in the bell until a manager presses **Mark handled** on it.

If the clock reads a date before 28 October 2024, the tills show **Sales can't be recorded: the
box's clock is wrong** instead, and the bell says so too, with the date the box's clock reads. The
page does not offer **Restart payments** then. The way out is to set the clock right.

## Devices as clock witnesses {#clock-witnesses}

A box can't tell by itself that its own clock is wrong, so it compares it with other clocks. Tills
and handhelds send their own clock to the box about every 15 seconds while someone is signed in on
them. Kitchen screens do not send theirs.

When two or more devices agree with each other that the box's clock is more than a minute off, the
bell warns the people who can manage the system, whether or not payments have stopped: **2 devices
agree that the time is 21:40, but the box's clock reads 21:10. Check the box's date and time on the
Box status page.** Staff on the tills see nothing for this.

The same readings are the device proof that the page needs before it offers **Restart payments**, as
[When payments stop because of the clock](box-status.md#clock-behind) explains.

## Emails about the box {#emails}

The box emails everyone who can manage the system and has an email address when:

- its disk has about 2 GB free or less;
- its disk is full, so nothing can be saved;
- its clock is set before 28 October 2024, so no sale can be recorded;
- its clock reads earlier than its last sale, so payments have stopped.

Each person gets one email per problem, in their own language, or the venue's if they have not
chosen one. If it cannot be sent, because the box has no internet or the mail server refuses it (for
example, because the mail server settings have a wrong password), the box tries again each minute
while the problem lasts, until the mail server accepts it. So the email arrives once the connection
or the settings are fixed. If the problem ends first, for example because the clock was set right,
the box stops trying and sends nothing. A full disk that is only partly freed is still nearly out of
space, so anyone the full-disk email did not reach is sent the nearly-out-of-space email instead. A restart while the problem lasts can
send the same email again. While no mail server is set up, nothing is sent.

A box whose clock reads before 28 October 2024 usually cannot send its email: with a date that
early it cannot check the mail server's certificate.
