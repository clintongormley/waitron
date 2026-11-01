# Till notices

Some problems with the box stop staff from working, and the person at the till is often the first
to notice. So once someone has signed in, every till and handheld shows a line under its top bar
when the box needs attention. The line does not show on the sign-in, clock-in or attendance pages.
It says what is wrong and what to do. It never covers your work, and you never have to dismiss it.

## Read the notice line {#notice-line}

The line shows the most serious notice first, in its main words and then its hint after " · ".
For example, **Nothing can be saved: the box is out of space · Tell a manager**. A red line means
something cannot be saved, an amber line means something needs attention but work is still saved, and a blue line is for information.

When more than one notice is showing, the line ends with a count such as **+1**. Tap the line to
open the list of every notice, most serious first. The list sits under the line and pushes the
screen down, so it never covers the order. Tap the line again to close it.

There is no close button. A notice goes by itself once the box no longer has the problem. A kitchen
display shows no notice line.

## What each notice means {#notices}

**Nothing can be saved: the box is out of space · Tell a manager** is red. The box has no disk
space left, so orders, payments and other changes cannot be saved. A manager needs to free space
on the box, on the [Box status page](box-status.md#free-space). If the box had to use its spare
space to start, the notice stays, also after a restart, until about 24 MB is free again.

**Sales can't be recorded: the box's clock is wrong · Tell a manager** is red. The box's clock is
set too far in the past to record a sale for the tax agency. Until it is fixed, the box also
refuses payments and refunds. An administrator can set the clock from their own phone or computer,
on the [Box status page](box-status.md#clock-behind). Just after the box starts, the hint can read
**Check the time** instead, as described below.

**Payments stopped: the box's clock reads earlier than its last sale · Tell a manager** is red. The
box's clock reads more than a minute earlier than the last sale it recorded. Until it reads no more
than a minute earlier, or the box's clock is confirmed, the box refuses payments, refunds and
anything else that would record a sale or settle money: payments in cash or by card, at the counter
or at a table, refunds and retried refunds, a table leaving without paying, cancelling an order that
already has an invoice, and a change or a kitchen send that would finish paying a bill already paid
in part. On the dashboard, managers cannot sort out stuck or held payments and refunds either.

Other work carries on. For example, you can seat tables, take orders, send them to the kitchen,
clock in and out, reprint a receipt and print an invoice that was already made. A refused payment
leaves the order open.

When a payment is refused, the till shows the box's time and the time of the last sale. If you
already charged the customer on another card machine, do not charge again: record the payment once
payments are back.

If the till says a card was charged but the sale is not recorded, do not charge again. This can
happen when a card reader charges a card just as payments stop. What to do next depends on how the
card was taken:

- **At the counter, or a table's bill paid in one go from the presented bill:** once payments are
  back, pay that order again the same way. The payment is recorded without charging the card a
  second time.
- **From the bill's payment options (Whole bill, Pay items, Contribute or Split equally):** the
  payment stays waiting, and the box records it by itself once payments are back.

With the internet the box usually puts its clock right by itself. Otherwise an
administrator sets or confirms the clock on the [Box status page](box-status.md#clock-behind) with
their own phone or computer, never from the box's own screen. Just after the box starts, any staff
member can do it from a till with **Check the time**, as described below. If the box's clock is
right and it was the last sale that carried a wrong time, two tills or handhelds that agree with
the box also restart payments, unless the stop has lasted since the box started. They never set
the clock.

**Check the time** at the end of a red clock line, instead of **Tell a manager**, means the box
started with its clock in doubt and could not reach the tax agency's time. It ends either
of the two red clock lines above. A refused payment then says to use **Check the time** at the top
of the screen. Tap **Check the time** to open its dialog; when another notice shows first, open the
list and tap it there. Anyone signed in on the till can use it.

The dialog shows the box's time and this till's time. Nobody types a time: the till's own time is
what is sent, so if the till's time is wrong too, correct it in the till's own settings first, then
check again.

- When the two times are more than a minute apart, it asks **Use this device's time?** Press **Use
  this device's time** to set the box's clock to the till's time; payments start again. Press **Not
  now** to leave it.
- When they agree, it asks you to confirm that the box's time is right. Press **The time is right**
  if it is; payments start again on the box's clock. Press **Not now** to leave it.

Either way, every manager is told who confirmed the time and from which till. If the box refuses,
the dialog says why above its buttons and, where trying again can help, offers **Check again**.
If the box's [start-up](box-status.md#clock-at-start) ends while the dialog is open, a staff member can no longer set the clock from a till:
the dialog says so and offers **Administrator sign-in**, so that an administrator can sign in there
with their PIN and set the clock from the same till.

**The box is nearly out of space · Tell a manager** is amber. Work is still saved, but space is
running out. A manager should free space before it runs out, on the
[Box status page](box-status.md#free-space).

**12 sales not yet sent to the tax agency · Retried automatically** is blue. Sending sales to the
tax agency has failed, and the box keeps trying by itself. The sales are recorded on the box, so
you can keep selling. A sale that needs a person to sort it out is not retried, so while any of the
waiting sales needs one, the hint reads **Tell a manager** instead.

**Printer “Kitchen” not printing · since 21:16** is amber. A ticket sent to that printer at 21:16
has waited two minutes or more without printing, or the box has stopped trying to send it. A
kitchen printer's notice shows on every till and handheld; any other printer's only on the tills
and handhelds that print their receipts, payment slips or full invoices to it. Check the printer's
paper, power and cable. The notice goes once the printer prints anything sent to it after that
ticket; the ticket itself may still need reprinting from the table or resending from **Printers**.

**The box needs attention · Tell a manager** is a notice this till has no words for, perhaps from
a newer version of the box. Tell a manager so they can check the box.
