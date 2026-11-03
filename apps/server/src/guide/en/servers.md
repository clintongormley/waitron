# Servers

## When a box no longer runs the venue {#handed-over}

If you open a box's address in a browser and see a page titled **This box no longer runs the
venue**, that box has stepped down. It takes no sales and sends nothing to the tax agency. The
page names, in bold, the box taking over the venue.

Below that, the page lists each step of the handover that this box has recorded, in the order it
recorded them, with the date and time of each in the venue's time zone.

The page has no buttons, because nothing on it needs you: the box is meant to be in this state.

The page is in Spanish when your browser prefers Spanish, and in English otherwise.

## When a box is waiting for another box {#waiting}

When a box starts and cannot reach the other box the venue has run on, it waits rather than sell
beside a box that may have taken over. If you open its address in a browser, you see a page titled
**This box is waiting for** and the other box's name. While it waits it takes no sales and sends
nothing to the tax agency, and it asks the other box again every 15 seconds. As soon as the other
box answers, the box carries on by itself.

## Carry on as the main box {#carry-on}

If you know the other box is switched off, you can let this box carry on without it. Over the
box's `https://` address, the page shows the **Carry on as the main box** form:

- Sign in with your email and password. If your account uses an authenticator app, the page then
  asks for your password again and its code. Only an administrator can carry on.
- Tick **{other box} is switched off** and **No other recovery of this venue is in progress**.
  The button stays greyed out until both are ticked.

The box then takes sales and sends records to the tax agency again. This lasts until the box next
starts: when it starts again, it asks the other box again, and waits again if it gets no answer.

If this box has already handed over to another box, the page says so instead of showing the form:
a box cannot carry on once it has handed over.
