# Till notices

When the box needs attention, your till or handheld shows a notice under its top bar. The PIN
screen also warns about low disk space and payments waiting for the box's time. After sign-in,
you can read notices on the clock-in and attendance pages. Go back to the till to use
**Open drawer** or **Check the time**.

If Waitron cannot verify this device for an action, reload or reopen Waitron on this device, then try again.

## When the till cannot reach the box {#cannot-open}

If you see **Can't reach the box**, check that this phone is on the venue's WiFi. Leave the
page open. The till opens by itself when the box is ready.

If you are already on the venue's WiFi, check that the box is switched on. If it is, you may
need to [install its certificate again](table-service.md#certificate-trust).

If the till is already open and says **Can't reach the box**, check that this device is on the
venue's WiFi. Keep the screen open while the till checks again. On the PIN screen, scroll the
notice above the keypad if needed, then press **Check again** to check now. In **Check your times**,
press **Retry read** if the read failed.

## Read the notice line {#notice-line}

The line shows the most serious notice first, in its main words and then its hint after " · ".
A red line means something cannot be saved. An amber line means something needs attention and
you can still save your work. A blue line is for information.

When more than one notice is showing, the line ends with a count such as **+1**. Tap that count to
open the list of the other notices, most serious first. The list sits under the line and pushes the
screen down, so it never covers the order. While it is open, the count reads **Hide**: tap it to
close the list.

There is no close button for a notice. On a prep station display, look for the connection line if
the box stops answering. The staff-notice list is on the till and handheld.

## What each notice means {#notices}

**Drawer didn’t open** means the request expired before it could be sent. Check the printer’s
power and connection, then use **Open drawer** if you still need it open. If asked, choose someone
who can authorise opening it and enter their PIN.

**Disk full. Waitron cannot operate.** covers the till or handheld, including the PIN screen.
Follow **Tell a manager** so they can free space on the [Box status page](box-status.md#free-space).
If a payment is in progress, check its result first. Follow any payment advice the warning shows
and stay signed in while space is freed.
On the clock-in and attendance pages, the notice reads **Nothing can be saved: the box is out of space**.

**Sales can't be recorded: the box's clock is wrong · See Box status in the dashboard** is red. The box's clock is
set too far in the past to record a sale for the tax agency. Until it is fixed, the box also
refuses payments and refunds. With **Manage boxes**, you can set the clock from your phone or computer
on the [Box status page](box-status.md#clock-own-device). Just after the box starts, the hint can read
**Check the time** instead, as described below.

**Payments wait: the box is waiting for devices to connect and agree with its time (0 of 2 so
far) · Check the time** is red. When the box starts without the internet's time, payments wait.
They start again by themselves once two tills or handhelds are switched on and connected, even at
the sign-in screen, and agree with the box's time. Otherwise, use **Check the time**: keep the
box's time if it is right, or use this device's time if that is. The sign-in, clock-in and attendance
pages show the same words, without **Check the time**: move past them to use it.

**Payments wait: the box's clock jumped and it cannot check the time over the internet. Waiting
for devices to agree with its time (0 of 2 so far) · Check the time** is red. The box's clock
moved by more than a minute while it was not kept in time over the internet, so payments wait. They
start again in the same ways.

**The tax agency refused a sale because the box's date was ahead. Payments wait until someone
checks the time. · Check the time** is red. Devices agreeing with the box do not start payments
again: use **Check the time**.

**Payments wait: the box must open new invoice numbering first, once its time is confirmed ·
Check the time** is red. Devices agreeing with the box do not start payments again: use **Check the
time**, and pay once the line has gone. If the line stays, a manager or administrator can restart the box on the [Box status
page](box-status.md#restart).

While payments wait for the box's time, a button that starts a payment opens **Payments are paused**
instead. The order stays open. Use **Check the time** there when it shows, or **Close** it and pay
once the red line has gone.

**Check the time** at the end of a red clock line, instead of **See Box status in the dashboard**, means the box's
clock is in doubt and the box could not confirm it by itself. Tap **Check the time** to open its dialog; when another notice shows first, open the
list and tap it there. Anyone signed in on the till can use it once past the clock-in and attendance pages.

The dialog shows the box's time and this till's time. Nobody types a time: the till's own time is
what is sent.

- When the two times are more than a minute apart, it asks which is correct. Press **This device**
  if the till's time is right: the box's clock is set to it. Press **The
  box** if the box's time is right: when a red clock line says payments wait and **Sales
  can't be recorded** is not shown, the box keeps its time; otherwise the dialog asks you to correct the
  till's time, as it does for **Both times are wrong**. Press **Both times are wrong** if neither
  is.
- When they agree, it asks whether the time is correct. Press **Yes** if it is. Press **No**
  if it is not.

If the dialog asks you to correct the time on the till, correct it in the till's own settings, then
open **Check the time** again: the dialog reads the till's time afresh each time it opens.

The people who manage the system are told when the box's clock is set from a till. If the box refuses,
the dialog says why above its buttons and, where trying again can help, offers **Check again**.
If the box's [start-up](box-status.md#clock-at-start) ends while the dialog is open, and the internet has confirmed the box's time, a staff member can no longer set the clock from a till:
the dialog offers **Administrator sign-in**. Choose someone with **Manage boxes** and ask them to
enter their PIN to set the clock from that till.

**This device's time is wrong · Correct it in this device's settings** is amber: the box keeps its
time over the internet, and this till's clock is more than a minute away from it.

**The box is nearly out of space · See Box status in the dashboard** is amber. Work is still saved, but space is
running out. Free space before it runs out, on the
[Box status page](box-status.md#free-space).

**12 sales not yet sent to the tax agency · Retried automatically** is blue. Sending sales to the
tax agency has failed, and the box keeps trying by itself. The sales are recorded on the box, so
you can keep selling. A sale that needs a person to sort it out is not retried, so while any of the
waiting sales needs one, the hint reads **Tell a manager** instead.

**Printer “Kitchen” not printing · since 21:16** is amber. A ticket sent to that printer at 21:16
has waited two minutes or more without printing, or the box has stopped trying to send it. A
station printer's notice shows on every till and handheld; any other printer's only on the tills
and handhelds that print their receipts, payment slips or full invoices to it. Check the printer's
paper, power and cable. The notice goes once the printer prints anything sent to it after that
ticket. If the box stopped trying to send a ticket, the tills then show **Printer “Kitchen”
could not print a ticket · Reprint it** in amber until a reprint of it (a station ticket from the
table, a receipt from its sale) or a resend from **Printers** has printed. An original receipt that did
not print is also tried again by itself about every 10 minutes for a day after the sale, so to print
it now, open its sale and press **Retry original** rather than printing a copy.

**The box needs attention · See Box status in the dashboard** is a notice this till has no words for, perhaps from
a newer version of Waitron on the box.

If an action says **Not saved: the box is out of disk space. Tell a manager.**, tell a manager
and wait for space to be freed before trying again. A refused receipt print, payment-slip print or
drawer opening does not undo a payment; do not take it again. If the message says a card was charged,
follow its recovery instructions instead of charging again.

## When invoices stop after an identity conflict {#invoice-conflict}

Choose **Open recovery** beside the refusal to open this box's recovery page in a separate tab.
Keep the payment window available. If it says the card was charged, do not charge again. Use the
current master key and follow [Recover an invoice identity](box-status.md#invoice-conflict).
You can close the payment window without starting a recovery. A completed switch leaves existing
filing results and cases unchanged.

## When the till is waiting for the main box {#not-main-server}

When the till says **This box is no longer the main box**, wait for the till to move to the
main box, then try again. If you already charged a card on the terminal, refund it there first.

If the till says **The box is checking its backup before taking sales** or **No box is taking
sales right now**, keep it open. The till carries on as soon as a box takes sales. On the sign-in
screen, press **Check again** to check now. In **Check your times**, use **Retry read** once the
box is ready.

## Keep a report about a problem {#problem-report}

If the till behaves unexpectedly, choose **Report a problem** from **☰**. Before sign-in or while
the clock or attendance page is open, use the button above the page. Open the till over HTTPS if
the button is missing.

If **Send to Waitron Cloud** is available, review the Cloud attachment before sending it. It
contains error codes, the Waitron version and basic details about the installation. The box tells
you when Cloud receives it or when it has saved the report to try again later. If you add a
description, it waits on the box for an administrator to review. As an administrator, you can
send your own description directly.

To keep a file yourself, describe what happened, check the download preview, then choose
**Download report**. The file includes your description and this browser’s recent activity.
Keep passwords, payment details and personal information out of your description.
