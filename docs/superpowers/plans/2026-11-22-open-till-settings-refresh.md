# Refresh settings on an open till

A signed-in till picks up the profile’s idle timeout and clock controls once it
has no order open. New and unsaved baskets use the current zone payment flow.
Saved orders keep their recorded flow.

The owner said “when the till is empty” in Lane F’s 22 November 13:07 queue item.
The watcher’s 13:24 answer defines a started order as one the server has saved.
On main at a7c4f7e555, a timeout-only save reached the response and left the old
timer running. Enabling Clock in reached the profile without a usable control.
My schedule opened at the next sign-in after a combined save. Saving only the
starting screen back to the first tab then returned the expected null on the
live read. The server refused the assigned profile’s form-factor edit. A zone
change left Send visible while first save recorded Pay before preparation.

1. **New and unsaved baskets.** Start with the observed red “updates the payment
   controls without dropping the dishes in an unsaved counter basket” in
   `apps/till/src/till-app-setup-refresh.test.ts`. Use the selected zone’s mode
   from the device-zone poll. Defer updates while a tender, Send or payment
   attempt is in progress using the existing order stage and request checks.
   Test a zone poll while a tender is in flight. Keep the existing payment
   preflight and retry behaviour. The payment route already sends the dishes
   when a counter order is paid. The poll corrects the controls afterward.
2. **Saved baskets.** Return the recorded mode on park, including its retry,
   and on reading a held basket (`apps/server/src/working-order.ts`,
   `apps/till/src/api/client.ts`). Reuse the venue-service recorded context.
   Use the counter’s flow override for every saved basket and clear it for
   the next basket. Check the mode returned by first park before calling
   Place. If the mode changed during the save, retain the saved basket and
   show its Pay choices. Test this using an old preflight and a park response
   with prepay. The server test checks the recorded mode on park/retry and
   held read after a policy change. Keep the existing placed-order collection
   controls. Land both payment steps together.
3. **Profile.** In `apps/till/src/till-app.ts` use one pending profile for the
   revision and device-zone reads, ordered by the existing request counter.
   A newer explicit profile switch takes precedence. Equal-revision polls
   keep a pending answer. Reuse the profile-switch basket and draft
   checks and the shared in-flight check. Include the visible table draft.
   Recheck when work settles and at sign-out. At sign-out keep the latest
   profile for sign-in and leave clock controllers stopped. Discard the
   old server’s profile on switch. Apply capabilities and starting screen
   together and keep zone access decisions on their existing path. Reuse
   the idle timer and prompt-free clock and attendance start/stop. Close
   Hours on disable. Keep a server refusal until eligibility changes or
   the next sign-in. Test the timeout-only change with the injected clock,
   clock enable/disable, and a changed profile across an order or sign-out.
4. **Checks and guides.** Run the changed till and server tests, the existing
   idle and clock cases, the normal hook and scoped PR CI. Update the English
   and Spanish Staff and Table service guides and the developer setup-read
   description. CLAUDE.md §3 requires both guide languages for a screen change.
   Retire the two backlog entries after the behaviour passes.

Estimate +120/−25 production lines and +230/−0 test lines. The layout of an assigned
profile is locked by `device_profile.in_use`. Starting screens open at sign-in.
