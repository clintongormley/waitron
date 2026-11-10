# Servers

## When you open the spare box {#spare}

If you see **This box is the spare**, open the main box’s address to use the restaurant screens
and data. The spare’s page shows its status; it takes no sales and offers no dashboard sign-in.

## When a box no longer runs the venue {#handed-over}

If you open a box's address in a browser and see a page titled **This box no longer runs the
venue**, that box has stepped down. It takes no sales and sends nothing to the tax agency. The
page names, in bold, the box taking over the venue.

Below that, the page lists each step of the handover that this box has recorded, in the order it
recorded them, with the date and time of each in the venue's time zone.

The page has no buttons, because nothing on it needs you: the box is meant to be in this state.

The page is in Spanish when your browser prefers Spanish, and in English otherwise.

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

Keep this box’s data until the new main confirms it holds every invoice record. Sending those
records to the new main is not available yet. Do not reset this box now.

## Turn remote staff access on or off {#remote-access}

Turning remote access on asks for the [shared sign-in confirmation](staff.md#account-access).
Turning it off needs no new sign-in confirmation.

To stop staff reaching your dashboard from outside the venue, open **Cloud services** in **Settings**
on the main box and choose **Turn off remote access**. If you are using the staff address,
confirm **Turn off remote access** to disconnect yourself too, or choose **Stop** to keep it on. Keep the box's local address available. Your Cloud pairing and other
Cloud services stay in place. Choose **Turn on remote access** to let the box reconnect.

The status beside this button is your saved choice. Open your staff address to check whether
you can connect; this page does not test that connection. If a change fails, check the saved choice and choose **Refresh status** to retry the connection. **Stop Cloud access** is the separate permanent stop for all Cloud services.
