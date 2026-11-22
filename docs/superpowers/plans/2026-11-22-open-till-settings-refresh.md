# Refresh settings on an open till

Managers can change an idle logout interval or clock controls and have the signed-in
till pick them up when the operator has no order open. The counter uses the current
zone payment flow for an empty or unsaved basket and the recorded flow for a saved order.

The owner said “when the till is empty” in Lane F’s 22 November 13:07 queue item.
The watcher’s 13:24 answer defines a started order as one the server has saved.
On main at a7c4f7e555, both a combined profile save and a starting-screen-only
save reached the till’s profile read. My schedule opened at the next sign-in
after the combined save. A timeout-only save reached the response but left
the old timer running. Enabling Clock in reached the capabilities without a
usable clock control. The server refused the assigned profile’s form-factor
change. The zone change reached the box, while a signed-in basket still offered
Send under the old flow. Its first save recorded the current flow instead.

1. **Counter.** Start with the observed failing “updates the payment controls without
   dropping the dishes in an unsaved counter basket” in
   `apps/till/src/till-app-setup-refresh.test.ts`. Reuse the selected zone’s mode from
   the existing device-zone poll. Before first Send or tender, refresh that zone’s
   flow through the existing device-zone read, using `#onPlaceOrder` and
   `#onCheckBeforeTender`. If it changed, show the new choices and leave the basket
   alone. Reuse those handlers’ session and basket guards so a late read acts only on
   the original basket. Keep the server’s existing first-save decision.
2. **Saved orders.** Put the recorded mode beside the zone in the existing held and
   placed basket responses (`apps/server/src/working-order.ts`, `readBasketOrder`;
   `apps/till/src/api/client.ts`, `HeldOrder`). Reuse the recorded-context read and
   the counter’s existing flow override when loading a saved basket. Keep the
   override with that order and clear it for a new basket. Test that the real read
   still returns the saved mode after a settings edit, and that retrieved orders
   retain their controls while an empty basket follows the live zone.
3. **Profile.** In `apps/till/src/till-app.ts`, give both live setup reads the same
   pending profile slot and freshness check. Apply it when there are no counter
   items or saved basket, visible table draft lines, or order/payment requests out.
   Recheck after poll, clearing/settling work and sign-out. On sign-out adopt the
   profile for the next sign-in and keep clock controllers stopped. On a server
   change discard the old profile. Keep the zone choice and access checks separate
   from the profile wait. Apply capabilities and starting-screen values together;
   open the starting screen at sign-in. Reuse idle timer configuration and the
   prompt-free attendance/clock start. Stop them and close Hours on disable.
   Keep a server refusal effective until an actual eligibility change or sign-in.
4. **Checks and guides.** In the till file test timeout-only longer/shorter/off
   with its injected session clock, apply-after-clear/sign-out, and clock enable
   and disable without a clock write. Keep the table and request checks where
   they distinguish a wait. Add one real recorded-mode assertion in
   `apps/server/src/working-order.test.ts`. Update the linked English and Spanish
   Staff and counter guides and the developer setup-read description. Retire A787
   and the service-settings entry after the checks pass. Finish with the changed
   tests, normal hook and scoped PR CI.

Estimate +105/−25 production lines and +175/−0 test lines. No new endpoint, schema,
profile permission or sale rule. Direct changes to an assigned device’s form factor
and live navigation to a starting screen are outside the measured gaps.
