# Servers

Open the box’s address for the dashboard, or add `/till/` to open the till. Update any older till bookmark or home-screen shortcut to end in `/till/`. Your enrolled browser keeps its device sign-in.

On an Android phone or tablet the page may first say it cannot be found; when Chrome then asks
whether it can reach devices on your local network, allow it. A VPN switched on in the device, such
as Google VPN, can stop it opening `waitron.local`: switch the VPN off on devices that run the till.

## When you open the spare box {#spare}

If you see **This is the venue’s spare box**, open the main box to reach the restaurant screens
and data, with **Open the main box** when the page shows it. The spare takes no sales and offers no dashboard sign-in.

The spare’s page also tells you how the main box looks from the spare. If the main box has stopped
answering, it says for how long and links to the [switch page](servers.md#emergency). If it says the spare
cannot reach the main box, check the network cable of each box: until the spare can reach the
main box, it could not take over if the main box failed.

## Add a spare box {#adding-a-spare}

While a joined spare is switched off, the main box waits at each start until an administrator
[lets it carry on without the spare](servers.md#carry-on) or
[removes it](servers.md#remove-a-spare).

Before you start, check two things on the main box:

- It has a backup encryption key, which the spare needs. If backups have never been turned on, open
  **Backups** and choose **Turn on backups**.
- **Continuous copy to your bucket** is off. The venue copies its changes to one place at a time,
  and a spare takes that place. To add a spare anyway, choose **Turn off** under that heading; your
  bucket then stops receiving the venue's changes, and in this version it cannot receive them again
  while the spare is there.

You also need a device signed in to the main box with an account that can open **System →
Servers**.

Connect the new box to the venue's network and switch it on; it needs no internet connection.
Because `waitron.local` reaches the main box, open the address that the new box's screen lists
after **Use this box's own address**. You do not need to install the new box's certificate: accept
your browser's warning once, choose **Join or recover** on the first screen, then **Add a mirror node**.
If you choose **Continue to setup** there instead, "Set up this box" says when it finds another
Waitron box running a restaurant on the network and offers **Join it as a spare** first, which opens
the same join page.

Enter the main box's address by its name, `https://waitron.local`, and choose **Join**; its IP
address, such as `https://192.168.1.10`, is refused. The new box shows a six-digit code and a link
to the main box's Servers page.

On the main box, open **System → Servers** (the link opens it) and choose **Check** beside the
request. If both boxes show the same code, choose **Join** on the new box and **Add as spare** on the
main box, in either order. If the codes differ, choose **No**.

Leave the new box's join page open. The new box then takes its first copy over the venue's network
and restarts as the spare. Its page asks you to save the box key, then to print its own
[switch label](servers.md#switch-label) and stick it on the box.

On the main box, open **System → Servers** and find the **Main box** and **Spare box** rows. On the spare's row, check its delay in seconds and **Last copy received**.
Keep both boxes switched on. If the copy is more than a minute behind or **Freshness unknown** stays on screen,
check that the spare is connected to the restaurant's network. **Rebuilding the copy** means you should leave both boxes on while the copy is restored.

A switch first brings this spare's copy up to date. Check the copy offered on the handover page before switching.
The bell and **Box status** warn when sending or applying changes is delayed, or the spare cannot be reached for two minutes.

## Print a switch label for each box {#switch-label}

A new restaurant's box offers its label on its **Setup complete** page, and a spare on its own page:
choose **Print label** and stick the label on that box. To print one again, open **System → Servers** on the main box, open the box's row menu, choose
**Print switch label**, then **Print**. If the main box fails, scan the spare's label with any till or phone on the venue's
network to open its [switch page](servers.md#emergency).

## Remove a spare box {#remove-a-spare}

On the main box, open **System → Servers**, open the spare's row menu and choose **Remove from venue**. For a
spare that has finished joining, first switch it off and make sure nobody is restoring the venue from a backup or switching it to another box, then turn on both statements. Once it is removed, the main box stops waiting for it at
each start, and you can save your bucket or add another spare. To use that machine again, reset
it from a terminal and add it as a new spare. The old main box this one took over from is wiped
from its row ([read more](servers.md#old-box-returns)).

## Start here when the main box has failed {#emergency}

Use a spare that has finished joining this venue. Switch off the old main box and keep it off,
because two running main boxes could take payments and file separately. A switch cannot
be undone.

If your till or handheld turns red, keep it open. When the main box answers again, you can
carry on with your basket. If the spare is answering, choose **Switch to the spare box**.
Sign in on the spare with **Manage boxes** to take over. Once the main box has been silent for about half a minute, a
till, phone or dashboard that reloads the venue’s usual address also lands on this page. A main
box that restarts for longer than about 20 seconds, during an update for example, brings a
reloading device here too; if you did not mean to switch, do not switch, and reload the
page once the main box is back. From any other device,
open the spare’s HTTPS address with `/handover/emergency` at the end, for example
`https://spare.example/handover/emergency`, or scan the spare's [switch label](servers.md#switch-label).

The page first checks whether the main box answers your device. If it does, the page says **The
main box is answering**: choose **Go back to the till** (**Go back** when you did not come from a
till) and carry on. If you still need to move the venue, open **I still need to move the venue
to this box** for the link to the main box's Servers page and [hand over](servers.md#hand-over)
from there; if the main box is broken, switch it off and choose **Check again**.

If the main box is silent, the page says what switching does and, when the spare knows, for how
long. Check that the main box is plugged in and its network cable is connected; if it starts
working again, keep using it. Until you choose **Switch to this box**, **Go back to the till** (**Go back** when you did
not come from a till) leaves without switching.

Choose **Start switching**, enter an administrator’s email and choose **Continue**, or pick a
saved passkey offered in the email field. If you typed the email, choose **Use your passkey**, or enter your password
and current authenticator code, if set up, and choose **Sign in with password**. Type the password
carefully: a wrong one restarts the spare, which then brings its copy up to date before you can try
again.

**Preparing the venue** applies the changes the spare already received from the main box, then
checks the copy. The spare may restart; keep the page open. If that takes more than a minute or
cannot be done, **Use the copy this spare holds** offers the copy already on it, usually the one
from when it joined, with nothing newer. When the copy is checked, read **Latest sale or order in
this copy** in the venue’s time zone. Anything newer may be missing. Then choose **Proceed**.

If automatic preparation fails, you can use an encrypted backup. On **Preparing the venue**,
choose **Upload a backup file instead**, choose the file and select **Use this backup**. If asked, enter that backup's **Backup
encryption key**. The box keeps its saved key. Keep this page open while the spare restarts, then
check **Selected backup** and its latest sale or order before you choose **Proceed**. Choose a
backup made after this spare joined its current main box.

If the page reports too little temporary space, free disk space on the spare before choosing
the backup again.

On **Ready to switch**, tick all three statements and say why you are switching. Choose **Switch to this box**. **Switching to this box** then checks this box's time and starts the
venue by itself; keep the page open while this box restarts. Only if this box cannot check its time
over the internet does it show **Check the time** with this box's time and this device's. If both
are right, choose **Confirm the time**. If only this device's is right, choose **Your device is
correct**; otherwise correct this device's time and choose **Check again**. You enter your password and code once; if the code expires, enter its
current replacement when asked and try the step again. With a passkey, the page asks for it when
you choose a step and the spare needs it, usually once, and again only if the page waits 15 minutes for you to choose a step; if instead it
says your passkey sign-in needs checking again, choose the step again (after **Switch to this
box**, choose **Try again**, or use your password). Your reason and statements
stay in place.

If the copy changes before you switch, the page goes back to **Preparing the venue**: check its
latest sale or order, choose **Proceed** and tick the three statements again. If the copy fails its
check when you choose **Switch to this box**, the page goes back there too: choose **Try again** or
**Upload a backup file instead**.

Once you have chosen **Switch to this box**, reloading or
opening the address on another device finds the switch; sign in and choose **Try again**. An unfinished controlled handover offers its own progress page. If the copy cannot be verified
against the saved switch, stop and keep both boxes’ data intact.

When the venue has started, **This box now runs the venue** says not to reset the old main box: it
may hold data this box does not have. When it is switched on again, it sends its invoice records
here by itself and stands down. Afterwards, choose [**Wipe and remove**](servers.md#old-box-returns) for it on this
box's Servers page in the dashboard.

If emergency hosting is available for your venue, the red screen also offers **Start the venue in the cloud**, even without a spare. The option is visible on the sign-in screen and to all staff. [Check what you need](servers.md#cloud-emergency) before opening it.

## Keep the failed box’s data {#old-box-returns}

Use the new main box after it starts. Keep the failed box and its data for the return flow.
Invoice records and their recorded payment facts can return to the new main box; this does not
replay orders, stock changes, printing or drawer openings. Do not wipe the old box while you
still need its data.

Switch the old box on and keep it connected: it returns its invoice records by itself. Until they
arrive, its row in **System → Servers** on the new main box says **Waiting for the old main box to
return its invoice records**, and the venue cannot be handed over again or that box removed.

If the old box will never come back with its data, choose **Will not return** in its row menu.

While its invoice records are still awaited, or after **Will not return**, its row menu also offers
**Wipe and remove**. Its dialog warns that the old box has not returned all its invoice records:
before it wipes itself it tries once more to send them, then its databases are set aside on it
instead of deleted, and are no longer used. Tick that you have downloaded its data, or that you
accept this, before you confirm.

Once its invoice records are back, **Wipe and remove** needs no tick. The dialog says the old
main box may hold data that this box does not have and gives the old box's address when its row
has one: open it and [download that data](servers.md#handed-over) before you confirm, because once
the wipe starts it can no longer be downloaded. A **CAUTION** line in the dialog means the recovered
records exist only on this box until a backup is made. Once you confirm, the row says
**Wipe asked**. The old main box wipes itself and leaves the list the next time it is on and can
reach this box, then restarts on setup's first page:
[re-add it as a spare](servers.md#adding-a-spare) from there, comparing the code it shows with the
one on this box. If it was already wiped by hand, choose **Remove from venue**. If this main box is
itself replaced before the old one has wiped itself, the old one never receives the wipe: choose
**Remove from venue** on the new main box and wipe it from a terminal.

To remove an old main box without wiping it, choose **Remove from venue** in its row menu. If it has
not returned its invoice records, tick that it has been wiped or will never be switched on again. If
it does come back, wipe it from a terminal, and never choose **Carry on as the main box** on it.

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
new invoice series by itself, including after any wait, and lists each with what it is for. If
the spare cannot check its time over the internet, the page first shows the spare's time and this
device's: check that both are right (both are shown in the venue's time zone), then choose **Confirm the time**. If the clocks differ, the page asks which time is correct: **This device** sets the spare's time from
the device you are using and the page carries on; after **The box** or **Both times are wrong**,
correct this device's time and reconnect. Choose **Continue** to start the venue on the spare.
An authenticator code lasts under a minute. If yours runs out before the page uses it, the page asks
you to check your password and code: enter a fresh code and choose **Try again** to carry on.
Before **Proceed**, **Edit these details** goes back to the sign-in.
If the page says this box is restarting, keep it open until **Continue to this box** appears.
Payments already recorded remain in the transferred copy.

If an answer is lost on the Servers page, keep the dialog open and choose **Check handover progress**.
On the spare’s handover page, you can reload to read progress. Do not start another handover.
A waiting message describes the last attempt; keep both boxes connected while they try again.
If the copy check keeps failing, read [how to switch to a spare](servers.md#emergency).

## After the handover {#after-hand-over}

Use the new box’s address. If the old box’s page offers **Progress**, follow it to resume the
handover on the spare. Keep the old box and its data, switched on and connected: it returns its
invoice records to the new box by itself, and until they arrive the venue cannot be handed over
again ([read more](servers.md#old-box-returns)).

On a till, keep the screen open; it follows the main box once that box is taking sales.

## When a box no longer runs the venue {#handed-over}

If you open a box's address, or its till or dashboard, and see a page titled **This box no longer
runs the venue**, that box has stepped down. It takes no sales and sends nothing to the tax agency.
Use **Open the dashboard on the new main box.**, when the page shows it, to go to the box that runs
the venue.

While something needs you, the page also shows a line that says what to do. While a
[handover](servers.md#hand-over) is unfinished it can also offer **Progress**: use it to finish the
handover on the spare.

Keep this box running while it returns its invoice records to the main box. Filing with the tax
agency continues on the main box.

Before the main box wipes this box, download its data under **Download this box's data**. Enter the
email and password of an administrator, or of an account with **Manage boxes**, as they were when
this box stopped running the venue, and the authenticator code if the account uses one; passkeys and
Google sign-in do not work here. Choose **Download**. The file's **Invoices** tab lists the invoice
records; its first line says whether they are only those the main box did not have or every one this
box holds. After an [emergency handover](servers.md#emergency), the file also has **Orders**,
**Payments and cash**, **Working hours** and **Activity** tabs. Each tab's first line says what it
lists, normally from shortly before the last sale or order in the copy
the new main box started from.

When someone chooses **Wipe and remove** on the main box, this box wipes itself. The
page then says so, and the box restarts shortly on setup's first page, ready to [join again as a
spare](servers.md#adding-a-spare). The wipe removes this box's venue data, including sale lines
and local backups, which this return does not carry; keep the old box's data if you need them. If Wipe and remove
was chosen before its invoice records were all back, or the main box lacks invoice records this
box holds, it sets its databases aside instead of deleting them.

If the return stops because an invoice record clashes with one on the main box, continue using
the main box and keep the old box's data if you still need it. The return is not confirmed.
Once you have downloaded this box's data, you can still choose **Wipe and remove** on the main box:
this box then sets its databases aside instead of deleting them, including the records it could
not return.

If other returned facts differ, keep both boxes running with their data intact. Only eligible
payment differences can be accepted through the internal API. An administrator can inspect them
with GET `/management-api/return-clashes` on the main box and accept one with POST `/management-api/return-clashes/:clashId/accept`, giving `actionKey` and `reason`.
There is no screen for this yet. Then switch the stopped box off and on to retry. Each newly
reached clashing batch needs its own acceptance; only the exact accepted group counts.

If the page reports a clock difference, check the clocks on both boxes and keep both running
while the return retries. Do not wipe the old box.

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
to resend.

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
other box's address, says so. While it waits it takes no sales and sends nothing to the tax agency.
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

Keep this box running with its data while it returns records. A reset from a terminal remains
possible, but it deletes this box's venue data even if the return has stopped or is unfinished.

After a box becomes the main box, open **Backups** and check that each backup folder is on this box.

## Connect a test box during setup {#setup-cloud-sign-in}

On a test box prepared for Cloud sign-in, enter the administrator’s details first in **Prepare**
or when starting empty in a development rehearsal of **Start a new restaurant**. Then choose **Sign in to Waitron Cloud**
and sign in or create an account. Setup resumes at the venue form in the same tab. Waitron files
the venue after you save it and the box restarts. Check **System → Cloud services** for the connection.

If your test Cloud account has one Spanish business with no tax number or venues, choose a
suggestion in **Find the registered address** or **Find the address**. Check the filled fields
and correct them before continuing. If you add a venue to an existing Cloud business or the
search is unavailable, enter the addresses by hand.

In Prepare, [choose Cloud for staff email](email.md#cloud-staff-email) to continue with the mail
server blank. If you choose **Skip** before opening Cloud or import a configuration, fill in the
addresses by hand, enter your mail server, and connect later from **Cloud services**.

If your Cloud session expires or you sign out before the venue is registered, finish saving the
venue. Then go to **System → Cloud services**, choose **Sign in to Waitron Cloud** and use the
same Cloud account to finish registering the venue. If Cloud still refuses the connection, ask
the pilot operator for help.

## Turn remote staff access on or off {#remote-access}

On a test box set up for Cloud sign-in, open **System → Cloud services** and choose **Sign in to
Waitron Cloud**. Sign in with your existing Cloud account. The same browser tab returns to the
box to connect your venue. Keep that tab open. If the connection stops, choose **Sign in to
Waitron Cloud** again in the same tab. If you closed it and Waitron says the previous request is
still active, wait for that request to expire before trying again.

If Waitron asks you to check the connection details, review the saved name, address and tax details
in **Venue settings → Venue details**, then try again.

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

## Send automatic error reports {#error-reports}

You can opt in on **Review and provision** during setup or in **System → Cloud
services**. Choose **Turn on error reports** to help Waitron identify errors in a
release. Your choice takes effect on this box. A new or replacement box
starts with reporting off.

Once the box is connected to Waitron Cloud, it sends error codes, their
sources, the Waitron version, times and incident counts under this box’s Cloud
registration. If the same open incident repeats, it counts once. The box holds
reports while it cannot reach Cloud. Choose **Turn off error reports** to discard
the reports still waiting to be sent.

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

If the main box stops answering, keep the till open. When the red screen offers **Start the venue in the cloud**, choose it to see the emergency address and a QR code. Scan it with your phone, or choose **Open here** to leave the till and open it in this browser. **Close** returns to the till.

Have the emergency code, your Waitron password and an authenticator or recovery code ready. The dialog lists the roles allowed to start the venue; Cloud checks availability before continuing. The option stays hidden until Cloud has made emergency hosting available for your venue.

From **Backups**, choose **Make recovery pack** on the main box while Cloud is available. With permission to manage the box, the pack includes the emergency address and code, their QR codes, and the code’s issue date. Keep it locked away off the box. The code starts a locked copy; you still need your password and your authenticator or a recovery code. Passkeys do not work there. If the emergency page is missing or failed, make a new pack when it is available.

Choose **Print recovery pack** on the Cloud card to open the maker on **Backups**. If the code changed, make a new pack before you need it. If the code could not be checked, try again later; this alone does not mean you need another pack.

On the locked copy, sign in with your Waitron email, password and authenticator code, or choose **Use a recovery code**. After signing in, check your name, the copy’s stop time and when Cloud last heard from the old box. If Cloud status is unavailable, choose **Check again**. This page does not yet offer the declaration or start the venue.
