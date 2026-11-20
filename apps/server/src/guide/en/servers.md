# Servers

Open the box’s address for the dashboard, or add `/till/` to open the till. Update any older till bookmark or home-screen shortcut to end in `/till/`. Your enrolled browser keeps its device sign-in.

## When you open the spare box {#spare}

If you see **This box is the spare**, open the main box’s address to use the restaurant screens
and data. The spare’s page shows its status; it takes no sales and offers no dashboard sign-in.

The spare’s page also tells you how the main box looks from the spare. If the main box has stopped
answering, it says for how long and links to the [switch page](servers.md#emergency). If it says the spare
cannot reach the main server, check the network cable of each box: until the spare can reach the
main box, it could not take over if the main box failed.

## Add a spare box {#adding-a-spare}

While a joined spare is switched off, the main box waits at each start until an administrator
[lets it carry on without the spare](servers.md#carry-on) or
[removes it](servers.md#remove-a-spare).

Before you start, check two things on the main box:

- It has a recovery key, which the spare needs. If backups have never been turned on, open
  **Backups** and choose **Turn on backups**.
- **Continuous copy to your bucket** is off. The venue copies its changes to one place at a time,
  and a spare takes that place. To add a spare anyway, choose **Turn off** under that heading; your
  bucket then stops receiving the venue's changes, and in this version it cannot receive them again
  while the spare is there.

You also need an account that can open **System → Servers** on the main box, with the email it
signs in with, its password and its current authenticator code, if set up.

Connect the new box to the venue's network and switch it on; it needs no internet connection.
Because `waitron.local` reaches the main box, open the address that the new box's screen lists
after **Use this box's own address**. Choose **Join or recover**, then **Add a mirror node**.

Enter the main box's address by its name, `https://waitron.local`, and choose **Continue**; its IP address, such as `https://192.168.1.10`, is refused. On a device already signed in to the
main box's dashboard, open **System → Servers** and compare **This server's public certificate
fingerprint** with the one the new box shows. Choose **It matches** only if they are the same.
Then enter the account's email and password and choose **Connect**. If the account uses an
authenticator, the page then asks for its current code: enter it and choose **Connect** again. The
new box takes its first copy over the venue's network and restarts by itself as the spare. The new
box's page stays on **This server is joining** and does not change.

On the main box, open **System → Servers** to check the spare's delay in seconds and **Last copy received**.
Keep both boxes switched on. If the copy is more than a minute behind or **Freshness unknown** stays on screen,
check that the spare is connected to the restaurant's network. **Rebuilding the copy** means you should leave both boxes on while the copy is restored.

A switch first brings this spare's copy up to date. Check the copy offered on the handover page before switching.
The bell and **Box status** warn when sending or applying changes is delayed, or the spare cannot be reached for two minutes.

## Print a switch label for each box {#switch-label}

When a spare has finished joining, open **System → Servers** on the main box. For the main box and
for the spare, open its row menu, choose **Print switch label**, then **Print**, and stick the label
on that box. If the main box fails, scan the spare's label with any till or phone on the venue's
network to open its [switch page](servers.md#emergency).

## Remove a spare box {#remove-a-spare}

On the main box, open **System → Servers**, open the spare's row menu and choose **Remove**. For a
spare that has finished joining, first switch it off and make sure nobody is restoring the venue from a backup or switching it to another box, then turn on both statements. Once it is removed, the main box stops waiting for it at
each start, and you can save your bucket or add another spare. To use that machine again, reset
it and add it as a new spare.

## Start here when the main box has failed {#emergency}

Use a spare that has finished joining this venue. Switch off the old main box and keep it off,
because two running main boxes could take payments and file separately. This declaration cannot
be undone.

On a till or handheld, the red **The main server is not answering** strip offers **Switch to the
spare server** on the sign-in screen, and to anyone with **Manage boxes**. It opens this page on the
spare, and **Stop** or **Continue to this box** brings you back to the till. Once the main box has
been silent for about half a minute, a till, phone or dashboard that reloads the venue’s usual
address also lands on this page. A main box that restarts for longer than about 20 seconds, during
an update for example, brings a reloading device here too; if you did not mean to switch, do not
declare anything, and reload the page once the main box is back. From any other device,
open the spare’s HTTPS address with `/handover/emergency` at the end, for example
`https://spare.example/handover/emergency`, or scan the spare's [switch label](servers.md#switch-label). Sign in with an administrator account’s password and
current authenticator code, if set up, or choose **Use your passkey**; then choose **Check this
copy**, and with a passkey, use it when the page asks. Type the password
carefully: a wrong one restarts the spare, which then brings its copy up to date before you can try
again. The spare first brings its
copy up to date and restarts; keep the page open. If that takes more than a minute or cannot be done, **Use the copy this spare holds**
offers the copy already on it, usually the one from when it joined, with nothing newer. Read the copy's latest dated
activity. Anything newer may be missing; if no date is available, the page says so.

If the page reports too little temporary space, free disk space on the spare before choosing
the backup again.

To use an encrypted backup instead, choose its file and select **Use this backup**. If asked,
enter that backup's recovery key; this leaves the box's saved key unchanged. Keep this page open while the spare
restarts, then review **Selected backup** and its latest activity before declaring. Choose a backup
made after this spare joined its current main box.

Read the warnings, tick all three statements and give your reason. Choose **Declare the old main
box switched off**. At the clock check, tick **These details are correct.** and choose **Proceed**:
the page compares the clocks, creates the new invoice series and starts the venue on this box by
itself. If this box cannot check its time over the internet, the page first shows this box's time
and this device's: check that both are right, then choose **Confirm the time**. If the clocks differ, the page asks which time is correct: **This device** sets this box's time from
the device you are using and the page carries on; after **The server** or **Both times are wrong**,
correct this device's time and reconnect. Keep the page open through the restart. You enter your password and code once; if the code expires, enter its
current replacement when asked and try the step again. With a passkey, the page asks for it when
the spare needs it, usually once, and again after 15 minutes. Your reason and statements stay in place.

If the copy changes before you declare, review the new activity and tick the three statements
again.

If an answer is lost, keep the page open and check the copy again before retrying. Reloading or
opening the address on another device finds your saved declaration; sign in and continue with the
clock check. An unfinished controlled handover offers its own progress page. If the old main box
answers, open its **Servers** link or switch it off and check again. If the copy cannot be
verified against the declaration, stop and keep both boxes’ data intact.

If emergency hosting is available for your venue, the strip also offers **Start the venue in the cloud**, even without a spare. The option is visible on the sign-in screen and to all staff. [Check what you need](servers.md#cloud-emergency) before opening it.

## Keep the failed box’s data {#old-box-returns}

Use the new main box after it starts. Keep the failed box and its data for the return flow.
Invoice records and their recorded payment facts can return to the new main box; this does not
replay orders, stock changes, printing or drawer openings. Do not reset the old box while you
still need its data.

## Hand over to a spare box {#hand-over}

Use this flow only with a spare that has finished joining the venue.

On the main box, open **System → Servers**. Open the spare’s row menu and choose **Hand over the
venue**. Read the explanation. Choose **Stop** to keep the venue on this box, or **Hand over the
venue** to stop sales here and move the final copy. If asked, [confirm your sign-in](staff.md#account-access).
A recent confirmation is reused; a recovery-code confirmation must be replaced with your current
authenticator code. You need an account with a password, and that password and your current
authenticator code, if set up, ready to sign in on the spare. A passkey cannot complete that step.

If the spare reports too little disk space when you hand over, choose **Stop**, make room on the spare and
hand over again. The main box keeps selling. If an encryption key is missing or different, choose
**Stop** and join the spare again before handing over.

Before sales stop, this box checks its venue data. If the check refuses the handover, choose **Stop**
and keep selling here. Keep this box and its data. You can try the handover again later. If it still
refuses, keep the venue on this box. For an urgent switch, follow the [emergency procedure](servers.md#emergency) with a working backup.

Keep both boxes connected. The handover page opens on the spare and follows the transfer. Once the
copy is ready, enter the same administrator account and choose **Continue to clock check**. Tick
**These details are correct.** and choose **Proceed**: the page compares the clocks and creates the
new invoice series by itself, including after any wait, and then starts the venue on the spare. If
the spare cannot check its time over the internet, the page first shows the spare's time and this
device's: check that both are right, then choose **Confirm the time**. If the clocks differ, the page asks which time is correct: **This device** sets the spare's time from
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
If the copy check keeps failing, read [how to switch to a spare](servers.md#emergency).

## After the handover {#after-hand-over}

Use the new box’s address. If the old box’s page offers **Progress**, follow it to resume the
handover on the spare. Keep the old box and its data.

On a till, keep the screen open; it follows the main server once that server is taking sales.

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
**Not recorded** means that amount is absent from the record. Use the search box to find returned invoices, sort by **First received**, and use the page buttons to
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
box again. If the other box is a spare you no longer need, [remove it](servers.md#remove-a-spare)
once this box is running, so it stops waiting for that spare at each start.

If the other box answers first, its answer wins. A box that has already handed over cannot carry
on; its page says so instead of showing the form.

If the backup confirms that another box has taken over, this box refuses to carry on. Open the
other box using the link. If that evidence appears after you carry on, this box stops taking sales.
Use the new main box. Older boxes may share an address: check which box you opened.

Keep this box running with its data while it returns records. Reset remains available, but it
deletes this box's venue data even if the return has stopped or is unfinished.

After a box becomes the main box, open **Backups** and check that each backup folder is on this box.

## Turn remote staff access on or off {#remote-access}

On a test box set up for Cloud sign-in, open **System → Cloud services** and choose **Sign in to
Waitron Cloud**. Sign in with your existing Cloud account. The same browser tab returns to the
box and connects your venue. If the connection stops before it finishes, choose **Sign in to
Waitron Cloud** again from the same tab.

Pair your test box with Waitron Cloud and start the venue’s free trial in **Billing** to open your
assigned staff address. **Cloud services** shows when remote access needs the trial. After
starting it, choose **Refresh status** to check the connection again.

Turning remote access on asks for the [shared sign-in confirmation](staff.md#account-access).
Turning it off needs no new sign-in confirmation.

If you restore a backup made before connecting to Cloud, open **Cloud services** in **System** and choose **Connect to Cloud** again.

If Cloud access has ended, because someone chose **Stop Cloud access** on the box or removed the venue in Waitron Cloud, **Cloud services** says so. On the main box, choose **Connect again** to add the venue to Waitron Cloud as a new venue.

To stop staff reaching your dashboard from outside the venue, open **Cloud services** in **System**
on the main box and choose **Turn off remote access**. If you are using the staff address,
confirm **Turn off remote access** to disconnect yourself too, or choose **Stop** to keep it on. Keep the box's local address available. Your Cloud pairing and other
Cloud services stay in place. Choose **Turn on remote access** to let the box reconnect.

The status beside this button is your saved choice. Open your staff address to check whether
you can connect; this page does not test that connection. If a change fails, check the saved choice and choose **Refresh status** to retry the connection. **Stop Cloud access** is the separate stop for all Cloud services.

## Approve Cloud owner recovery {#cloud-owner-recovery}

If you are recovering a Cloud owner account, verify your email on Cloud’s recovery page first.
At the venue, open **System → Cloud services** on the paired main box and choose **Load recovery requests**.
A box administrator must be signed in; use **Sign in as administrator** if asked.

Check the email, account, organisation and venue ID. **Approve recovery** lets you finish on the same
recovery page in Cloud and set up sign-in again. **Refuse recovery** ends that request permanently.
**Cancel** sends no decision. After approval is recorded, return to the same Cloud recovery page to finish.

## Check emergency start in Cloud {#cloud-emergency}

Open **System → Cloud services** on the main box to check **Emergency start in Cloud**.
The card shows the emergency address, when the details were checked and when the current code
was issued.

If emergency start is switched off, your Connected plan is inactive or a payment method is
missing, open the Cloud account to put it right. **Cloud cannot start this venue yet** means the
hosting path is not available for this venue. Earlier details are labelled as such; Cloud checks
again before starting. The daily price is an estimate excluding VAT.

With permission to manage the box, choose **Show code** to fetch the current code. Check its
issuance date before using a saved copy. **Hide code** removes it from the card; leaving this
screen does too. The address beside the revealed code belongs to that code.
The card also lists people with permission and an authenticator, and people who need to set
one up in their profile. The card does not start the venue.

If the main box stops answering, keep the till open. When the red strip offers **Start the venue in the cloud**, choose it to see the emergency address and a QR code. Scan it with your phone, or choose **Open here** to leave the till and open it in this browser. **Close** returns to the till.

Have the emergency code, your Waitron password and an authenticator or recovery code ready. The dialog lists the roles allowed to start the venue; Cloud checks availability before continuing. The option stays hidden until Cloud has made emergency hosting available for your venue.

From **Backups**, choose **Make recovery pack** on the main box while Cloud is available. With permission to manage the box, the pack includes the emergency address and code, their QR codes, and the code’s issue date. Keep it locked away off the box. The code starts a locked copy; you still need your password and your authenticator or a recovery code. Passkeys do not work there. If the emergency page is missing or failed, read its cover line and make a new pack when it is available.

Choose **Print recovery pack** on the Cloud card to open the maker on **Backups**. Its status shows the printed code’s issue date. If the code changed, make a new pack before you need it. If the code could not be checked, try again later; this alone does not mean you need another pack.

On the locked copy, sign in with your Waitron email, password and authenticator code, or choose **Use a recovery code**. After signing in, check your name, the copy’s stop time and when Cloud last heard from the old box. If Cloud status is unavailable, choose **Check again**. This page does not yet offer the declaration or start the venue.
