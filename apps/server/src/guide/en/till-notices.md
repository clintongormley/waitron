# Till notices

Some problems with the server stop staff from working, and the person at the till is often the first
to notice. So once someone has signed in, every till and handheld shows a line under its top bar
when the server needs attention. The sign-in page shows only the line saying payments wait for the
server's time; the clock-in and attendance pages show none. The line says what is wrong and what to
do. It never covers your work, and you never have to dismiss it.

If Waitron cannot verify this device for an action, reload or reopen Waitron on this device, then try again.

## Read the notice line {#notice-line}

The line shows the most serious notice first, in its main words and then its hint after " · ".
For example, **Nothing can be saved: the server is out of space · Tell a manager**. A red line means
something cannot be saved, an amber line means something needs attention but work is still saved, and a blue line is for information.

When more than one notice is showing, the line ends with a count such as **+1**. Tap that count to
open the list of every notice, most serious first. The list sits under the line and pushes the
screen down, so it never covers the order. Tap the count again to close it.

There is no close button for a notice. A kitchen display shows no notice line.

## What each notice means {#notices}

**Drawer didn’t open** means the request expired before it could be sent. Check the printer’s
power and connection, then use **Open drawer** if you still need it open. If asked, choose someone
who can authorise opening it and enter their PIN.

**Nothing can be saved: the server is out of space · Tell a manager** is red. The server has no disk
space left, so orders, payments and other changes cannot be saved. A manager needs to free space
on the server, on the [Box status page](box-status.md#free-space). If the server had to use its spare
space to start, the notice stays, also after a restart, until about 24 MB is free again.

**Sales can't be recorded: the server's clock is wrong · Tell a manager** is red. The server's clock is
set too far in the past to record a sale for the tax agency. Until it is fixed, the server also
refuses payments and refunds. An administrator can set the clock from their own phone or computer,
on the [Box status page](box-status.md#clock-own-device). Just after the server starts, the hint can read
**Check the time** instead, as described below.

**Payments wait: the server is waiting for devices to connect and agree with its time (0 of 2 so
far) · Check the time** is red. When the server starts without the internet's time, payments wait.
They start again by themselves once two tills or handhelds are switched on and connected, even at
the sign-in screen, and agree with the server's time. Otherwise, use **Check the time**: keep the
server's time if it is right, or use this device's time if that is. The sign-in page shows the same
words, without **Check the time**: sign in to use it.

**Check the time** at the end of a red clock line, instead of **Tell a manager**, means the server
started with its clock in doubt and could not confirm it by itself. It ends either of the two red
clock lines above. A refused payment then says to use **Check the time** at the top
of the screen. Tap **Check the time** to open its dialog; when another notice shows first, open the
list and tap it there. Anyone signed in on the till can use it.

The dialog shows the server's time and this till's time. Nobody types a time: the till's own time is
what is sent.

- When the two times are more than a minute apart, it asks which is correct. Press **This device**
  if the till's time is right: the server's clock is set to it and payments start again. Press **The
  server** if the server's time is right: when **Payments wait** is the only red clock line, the
  server keeps its time and payments start again; otherwise the dialog asks you to correct the
  till's time, as it does for **Both times are wrong**. Press **Both times are wrong** if neither
  is.
- When they agree, it asks whether the time is correct. Press **Yes** if it is; payments start
  again. Press **No** if it is not.

If the dialog asks you to correct the time on the till, correct it in the till's own settings, then
open **Check the time** again: the dialog reads the till's time afresh each time it opens.

The people who manage the system are told when the server's clock is set from a till. If the server refuses,
the dialog says why above its buttons and, where trying again can help, offers **Check again**.
If the server's [start-up](box-status.md#clock-at-start) ends while the dialog is open, and the internet has confirmed the server's time, a staff member can no longer set the clock from a till:
the dialog says so and offers **Administrator sign-in**, so that an administrator can sign in there
with their PIN and set the clock from the same till.

**The server is nearly out of space · Tell a manager** is amber. Work is still saved, but space is
running out. A manager should free space before it runs out, on the
[Box status page](box-status.md#free-space).

**12 sales not yet sent to the tax agency · Retried automatically** is blue. Sending sales to the
tax agency has failed, and the server keeps trying by itself. The sales are recorded on the server, so
you can keep selling. A sale that needs a person to sort it out is not retried, so while any of the
waiting sales needs one, the hint reads **Tell a manager** instead.

**Printer “Kitchen” not printing · since 21:16** is amber. A ticket sent to that printer at 21:16
has waited two minutes or more without printing, or the server has stopped trying to send it. A
kitchen printer's notice shows on every till and handheld; any other printer's only on the tills
and handhelds that print their receipts, payment slips or full invoices to it. Check the printer's
paper, power and cable. The notice goes once the printer prints anything sent to it after that
ticket. If the server stopped trying to send a ticket, the tills then show **Printer “Kitchen”
could not print a ticket · Reprint it** in amber until a reprint of it (a kitchen ticket from the
table, a receipt from its sale) or a resend from **Printers** has printed.

**The server needs attention · Tell a manager** is a notice this till has no words for, perhaps from
a newer version of the server. Tell a manager so they can check the server.

## When invoices stop after an identity conflict {#invoice-conflict}

Choose **Open recovery** beside the refusal to open this server's recovery page in a separate tab.
Keep the payment window available. If it says the card was charged, do not charge again. Use the
current server key and follow [Recover an invoice identity](box-status.md#invoice-conflict).
You can close the payment window without starting a recovery. A completed switch leaves existing
filing results and cases unchanged.

## When this server is no longer the main server {#not-main-server}

When the till says **This server is no longer the main server**, wait for the till to move to the
main server, then try again. If you already charged a card on the terminal, refund it there first.
