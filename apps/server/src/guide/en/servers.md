# Servers

## When you open the spare box {#spare}

If you see **This box is the spare**, open the main box’s address to use the restaurant screens
and data. The spare’s page shows its status; it takes no sales and offers no dashboard sign-in.

## Start here when the main box has failed {#emergency}

Use a spare that has finished joining this venue. Switch off the old main box and keep it off,
because two running main boxes could take payments and file separately. This declaration cannot
be undone.

Open the spare’s HTTPS address with `/handover/emergency` at the end, for example
`https://spare.example/handover/emergency`. Sign in with an administrator account’s password and
current authenticator code, if set up, then choose **Check this copy**. Read its latest dated
activity. Anything newer may be missing; if no date is available, the page says so.

Read the warnings, tick all three statements and give your reason. Choose **Declare the old main
box switched off**, compare the clocks and choose **Start the venue on this box**. Keep the page
open through the restart. You enter your password and code once; if the code expires, enter its
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

Keep both boxes connected. The handover page opens on the spare and follows the transfer. Once
the copy is ready, enter the same administrator account, compare the clocks and make the new
series. Choose **Start the venue on this box**. If the page says this box is restarting, keep it
open until **Continue to this box** appears. Payments already recorded remain in the transferred copy.

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

If the return stops because invoice or payment facts differ, keep both boxes running with their
data intact. An administrator can inspect and accept an eligible payment difference through the
main box's internal API; there is no screen for this yet. After acceptance, switch the stopped box
off and on to retry. Repeat if a later batch stops on another payment difference.
Invoice, chain-position and correction clashes still only warn and cannot be accepted yet.
Records after a clashing invoice may still be waiting on this box. Reset remains available, but
it deletes this box's venue data before the return is confirmed.

If the page reports a clock difference, check the clocks on both boxes and keep both running
while the return retries. Do not reset the old box.

The page is in Spanish when your browser prefers Spanish, and in English otherwise.

## Check handover intervals {#reconciliation}

After an emergency handover, open **Reporting**, then **Handover intervals**, to check the period
whose activity may be missing. You need permission to view reports. The list shows the previous
and new main boxes, the latest sale or order time in the copy, the declaration and activation times, and
the reason entered at takeover. All times use the venue's time zone. **Unknown** means the copy
held no dated sale or order; it does not mean that no money is missing.

Open this list yourself: cash-up and the other reports show no warning beside their figures.
Completeness and amounts stay unconfirmed in this list even after a complete return. If the old
box returns, check the return status on its page before deciding whether to reset it.

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
