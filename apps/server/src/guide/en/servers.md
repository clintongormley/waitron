# Servers

## When you open the spare box {#spare}

If you see **This box is the spare**, open the main box’s address to use the restaurant screens
and data. The spare’s page shows its status; it takes no sales and offers no dashboard sign-in.

## Add a spare box {#adding-a-spare}

A venue set up in Spain cannot add a spare yet.

A spare that has finished joining cannot be removed in this version. Do not add one to a venue
that is open for business until an update lets you remove it.

While a joined spare is switched off, the main box waits at each start until an administrator
[lets it carry on without the spare](servers.md#carry-on).

Before you start, check two things on the main box:

- It has a recovery key, which the spare needs. If backups have never been turned on, open
  **Backups** and choose **Turn on backups**.
- **Continuous copy to your bucket** is off. The venue copies its changes to one place at a time,
  and a spare takes that place. To add a spare anyway, choose **Turn off** under that heading; your
  bucket then stops receiving the venue's changes, and in this version it cannot receive them again
  while the spare is there.

You also need an account that can open **Settings → Servers** on the main box, with the email it
signs in with, its password and its current authenticator code, if set up.

Connect the new box to the venue's network and switch it on; it needs no internet connection.
Because `waitron.local` reaches the main box, open the address that the new box's screen lists
after **Use this box's own address**. Choose **Join or recover**, then **Add a mirror node**.

Enter the main box's HTTPS address and choose **Continue**. On a device already signed in to the
main box's dashboard, open **Settings → Servers** and compare **This server's public certificate
fingerprint** with the one the new box shows. Choose **It matches** only if they are the same.
Then enter the account's details and choose **Connect**. The new box takes its first copy over the
venue's network and restarts by itself as the spare.

## Start here when the main box has failed {#emergency}

Use a spare that has finished joining this venue. Switch off the old main box and keep it off,
because two running main boxes could take payments and file separately. This declaration cannot
be undone.

Open the spare’s HTTPS address with `/handover/emergency` at the end, for example
`https://spare.example/handover/emergency`. Sign in with an administrator account’s password and
current authenticator code, if set up, then choose **Check this copy**. Read its latest dated
activity. Anything newer may be missing; if no date is available, the page says so.

Read the warnings, tick all three statements and give your reason. Choose **Declare the old main
box switched off**. At the clock check, tick **These details are correct.** and choose **Proceed**:
the page compares the clocks, creates the new invoice series and starts the venue on this box by
itself. If the clocks differ, the page asks which time is correct: **This device** sets this box's time from
the device you are using and the page carries on; after **The server** or **Both times are wrong**,
correct this device's time and reconnect. Keep the page open through the restart. You enter your password and code once; if the code expires, enter its
current replacement when asked and try the step again. Your reason and statements stay in place.

If the copy changes before you declare, review the new activity and tick the three statements
again.

If an answer is lost, keep the page open and check the copy again before retrying. Reloading or
opening the address on another device finds your saved declaration; sign in and continue with the
clock check. An unfinished controlled handover offers its own progress page. If the old main box
answers, open its **Servers** link or switch it off and check again. If the copy cannot be
verified against the declaration, stop and keep both boxes’ data intact.

## Keep the failed box’s data {#old-box-returns}

Use the new main box after it starts. Keep the failed box and its data for the return flow.
Invoice records and their recorded payment facts can return to the new main box; this does not
replay orders, stock changes, printing or drawer openings. Do not reset the old box while you
still need its data.

## Hand over to a spare box {#hand-over}

Use this flow only with a spare that has finished joining the venue.

On the main box, open **Settings → Servers**. Open the spare’s row menu and choose **Hand over the
venue**. Read the explanation. Choose **Stop** to keep the venue on this box, or **Hand over the
venue** to stop sales here and move the final copy. If asked, [confirm your sign-in](staff.md#account-access).
A recent confirmation is reused; a recovery-code confirmation must be replaced with your current
authenticator code. You need an account with a password, and that password and your current
authenticator code, if set up, ready to sign in on the spare. A passkey cannot complete that step.

Keep both boxes connected. The handover page opens on the spare and follows the transfer. Once the
copy is ready, enter the same administrator account and choose **Continue to clock check**. Tick
**These details are correct.** and choose **Proceed**: the page compares the clocks and creates the
new invoice series by itself, including after any wait, and then starts the venue on the spare. If the clocks differ, the page asks which time is correct: **This device** sets the spare's time from
the device you are using and the page carries on; after **The server** or **Both times are wrong**,
correct this device's time and reconnect.
An authenticator code lasts under a minute. If yours runs out before the page uses it, the page asks
you to check your password and code: enter a fresh code and choose **Try again** to carry on.
Before **Proceed**, **Edit these details** goes back to the sign-in.
If the page says this box is restarting, keep it open until **Continue to this box** appears.
Payments already recorded remain in the transferred copy.

If an answer is lost in Servers, keep the dialog open and choose **Check handover progress**.
On the spare’s handover page, you can reload to read progress. Do not start another handover.
A waiting message describes the last attempt; keep both boxes connected while they try again.

## After the handover {#after-hand-over}

Use the new box’s address. If the old box’s page offers **Progress**, follow it to resume the
handover on the spare. Keep the old box and its data.

## When a box no longer runs the venue {#handed-over}

If you open a box's address in a browser and see a page titled **This box no longer runs the
venue**, that box has stepped down. It takes no sales and sends nothing to the tax agency. The
page names, in bold, the box taking over the venue.

Below that, the page lists each step of the handover that this box has recorded, in the order it
recorded them, with the date and time of each in the venue's time zone.

If the page offers **Progress**, use it to finish the handover on the spare.

Keep this box running while it returns its invoice records to the main box. Refresh the page to
check progress. Card refunds still in progress go with their original payments so the main box
can check their outcome. Filing with the tax agency continues on the main box. Confirmation means
every returned fact was either received or covered by a specifically accepted payment difference;
for an accepted difference, the main box keeps its own payment facts.
Resetting the old box deletes its venue data, including sale lines and local backups. Those are
not included in this return; keep the old box's data if you need them.

If the return stops because an invoice record clashes with one on the main box, continue using
the main box and keep the old box's data if you still need it. The return is not confirmed.
Reset remains available, but deletes the old box's venue data, including any records still waiting.

If other returned facts differ, keep both boxes running with their data intact. Only eligible
payment differences can be accepted through the internal API. An administrator can inspect them
with GET `/management-api/return-clashes` on the main box and accept one with POST `/management-api/return-clashes/:clashId/accept`, giving `actionKey` and `reason`.
There is no screen for this yet. Then switch the stopped box off and on to retry. Each newly
reached clashing batch needs its own acceptance; only the exact accepted group counts.

If the page reports a clock difference, check the clocks on both boxes and keep both running
while the return retries. Do not reset the old box.

The page is in Spanish when your browser prefers Spanish, and in English otherwise.

## Check handover intervals {#reconciliation}

After an emergency handover, open **Reporting**, then **Handover intervals**, to check the period
whose activity may be missing. You need permission to view reports. The list shows the previous
and new main boxes, the latest sale or order time in the copy, the declaration and activation times, and
the reason entered at takeover. All times use the venue's time zone. **Unknown** means the copy
held no dated sale or order; it does not mean that no money is missing.

Sales, cash-up, category reports and VAT show a handover warning with a link to this list. Check
the handover dates before deciding whether the figures cover the period you need. Use **Refresh
handover status** to check again. The warning stays after an inventory is received.

Use **Refresh intervals** to check the inventory receipt. **Inventory receipt confirmed** means
the new box accounted for all batches in an inventory advertised by the old box. It does not
confirm missing activity or amounts, or reconstruct cash-ups. An unconfirmed receipt needs a
complete return; if the old box already stopped sending, restart it while it remains restricted
to resend. If the old box returns, check the return status on its page before deciding whether
to reset it.

Below the intervals, **Returned invoices** shows each newly received invoice with its source
box, generating installation, original issue date and recorded amounts. Invoice rows show a
readable kind beside their original type code. Corrections and cancellations appear separately.
**Not recorded** means that amount is absent from the record. Use **Next** and **Previous** to
read more; **Refresh invoices** returns to the first page.

Tracking starts with this feature. Invoices already held in a copy are not added, so an empty
list is not a complete history of earlier returns. The list does not identify duplicates.

The report notice also tells you when returned invoices are recorded, independently of the dates
you select. Follow the notice’s **Check handover intervals** link; **Returned invoices** is below
the intervals. Check the invoices’ original issue dates. Use the figures displayed in each report;
do not add the list’s amounts to report totals.

## When a box is waiting for another box {#waiting}

When a box starts and cannot reach the other box the venue runs on, it waits instead of selling,
because the other box may have taken over. Its page, titled **This box is waiting for** and the
other box's name, says so. While it waits it takes no sales and sends nothing to the tax agency.
It asks again every 15 seconds; once the other box answers, this box starts normally or, if the
other box has taken over, says so.

## Carry on as the main box {#carry-on}

If you know the other box is switched off, you can let this box carry on without it. Open the box
at its `https://` address, sign in as an administrator under **Carry on as the main box**, and
tick both statements. This box then runs the venue until it next restarts, when it asks the other
box again.

If the other box answers first, its answer wins. A box that has already handed over cannot carry
on; its page says so instead of showing the form.

If the backup confirms that another box has taken over, this box refuses to carry on. Open the
other box using the link. If that evidence appears after you carry on, this box stops taking sales.
Use the new main box. Older boxes may share an address: check which box you opened.

Keep this box running with its data while it returns records. Reset remains available, but it
deletes this box's venue data even if the return has stopped or is unfinished.

## Turn remote staff access on or off {#remote-access}

Turning remote access on asks for the [shared sign-in confirmation](staff.md#account-access).
Turning it off needs no new sign-in confirmation.

To stop staff reaching your dashboard from outside the venue, open **Cloud services** in **Settings**
on the main box and choose **Turn off remote access**. If you are using the staff address,
confirm **Turn off remote access** to disconnect yourself too, or choose **Stop** to keep it on. Keep the box's local address available. Your Cloud pairing and other
Cloud services stay in place. Choose **Turn on remote access** to let the box reconnect.

The status beside this button is your saved choice. Open your staff address to check whether
you can connect; this page does not test that connection. If a change fails, check the saved choice and choose **Refresh status** to retry the connection. **Stop Cloud access** is the separate permanent stop for all Cloud services.
