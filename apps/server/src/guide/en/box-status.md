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
one. The stop lasts until the clock reads no more than a minute earlier than that sale. Taking
orders, the kitchen and clocking in carry on, though a change or a kitchen send that would finish
paying a part-paid bill, and cancelling an order that already has an invoice, are refused. The [till
notices guide](till-notices.md#notices) lists what staff can and cannot do meanwhile.

The tills show **Payments stopped: the box's clock reads earlier than its last sale**. The alerts
bell says so too, with both times in it: the time on the box's clock and the time of the latest
sale. On this page, **Sales** and **Clock** turn red with the tills' words, and the **Clock** row
adds what to do: **Connect the box to the internet so it can correct its clock, or call whoever
installed it.** Where the box can tell, the row also says whether it is **Kept in time over the
internet**.

There are two ways out:

- **Set the clock right.** On a box that keeps its clock in time over the internet, connecting it to
  the internet lets it correct the clock by itself. Otherwise, call whoever installed the box: the
  box has no page for setting its clock. This ends the stop unless the latest sale itself carries a
  wrong, later time.
- **Wait.** Once the box's clock reaches a minute before the time of the latest sale, the box takes
  payments again. This is the only way out when the clock is right but the latest sale was recorded
  with a wrong time, for example while the clock was running fast.

You do not need to restart the box or the tills. Each payment is checked when it is made, so once
the clock reads no more than a minute before the latest sale, the next payment is no longer refused
for the clock. The tills' notice and this page's red rows clear within about 15 seconds. The bell,
and the bell's alert shown under the **Clock** row, clear within about a minute.

A card taken from a bill's payment options just as payments stop can show in the bell as a card
payment that Waitron could not record. The box records that payment by itself once payments are
back, but the alert stays in the bell until a manager presses **Mark handled** on it.

If the clock reads a date before 28 October 2024, the tills show **Sales can't be recorded: the
box's clock is wrong** instead. The way out is the same: set the clock right.

## Emails about the box {#emails}

The box emails everyone who can manage the system and has an email address when:

- its disk has less than 2 GB free;
- its disk is full, so nothing can be saved;
- its clock is set before 28 October 2024, so no sale can be recorded.

Each person gets one email per problem, in their own language, or the venue's if they have not
chosen one. If it cannot be sent, because the box has no internet or the mail server refuses it (for
example, because the mail server settings have a wrong password), the box tries again each minute
while the problem lasts, until the mail server accepts it. So the email arrives once the connection
or the settings are fixed. If the problem ends first, for example because space was freed or the
clock was set right, the box stops trying and sends nothing. A restart while the problem lasts can
send the same email again. While no mail server is set up, nothing is sent.

A box whose clock reads before 28 October 2024 usually cannot send its email: with a date that
early it cannot check the mail server's certificate.
