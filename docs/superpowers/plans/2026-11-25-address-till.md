# Till address suggestions and attribution

Implement ADDRESS-TILL and ADDRESS-WORDS from the [finish plan](2026-11-24-address-lookup-finish.md).
A cashier can find a Spanish address in the full-invoice window, edit the filled fields and save
as usual, or type the address while suggestions are unavailable. The four forms identify Google
Maps beside suggestions and beside an address they fill. ADDRESS-PROOF covers the live service.

1. **Till route.** In Server's `address-lookup-api.ts`, share the dashboard route's body handling,
   error mapping and signed Cloud bridge with `POST /api/address-lookup`. Mount it in `till-api.ts`
   with the connection and primary check from `boot.ts`. Use the invoice-choice route's
   `requireSession` with `take-orders` and matching device proof. The lookup names no order and
   reads no zone. Add the path to the diagnostics and till route inventories. Start with
   `address-lookup-api.test.ts` cases for a signed-in till reaching the bridge and refusal
   without the profile action. Use the existing person and device inventories for those
   refusals. The existing dashboard and bridge tests own parsing, refusal and retry behavior.
2. **Open the search without delaying the invoice.** Add `TillApi.addressLookup(operation)` in
   `apps/till/src/api/client.ts` using its signed-in request path. In `till-app.ts` pass this
   function to `widgets/invoice-recipient-dialog.ts`. The dialog uses `cloudAddressProvider` when
   Spain is selected, checks availability without waiting to show the manual form, and drops a
   late result after a country change or dialog close. Reuse the existing address mapping and
   draft confirmation. First fail a client test for the POST and a
   `till-app-bill-payments.test.ts` case that opens the real dialog and finds search only after
   availability succeeds. Use `invoice-recipient-dialog.address-lookup.test.ts` for switching
   away from Spain during the check and keeping manual entry on refusal.
3. **Attribute the filled address.** Use one optional provider attribution on the
   `packages/country/src/country.ts` and `packages/ui/src/components/wt-address-lookup.ts` interfaces.
   Set it to **Google Maps** in `packages/country-packs/src/cloud-address-provider.ts` and render
   one visible label in the shared field beside the list or above the filled fields. A form marks
   an address as filled only after accepting it and clears the mark on address edit, save or
   reset. Wire the existing handlers in setup's `venue-screen.ts` (both searches), dashboard's
   `venue-details-panel.ts` and `registered-address-dialog.ts`, and the till's recipient dialog.
   First fail `wt-address-lookup.test.ts` for list and applied credit, then extend each form's
   address tests to prove credit clears when that draft changes. Check keyboard choice and
   manual entry in Chromium and send English and Spanish, light and dark, desktop and phone
   pictures to the watcher before landing.
4. **Tell staff and customers.** Update both languages of `apps/server/src/guide/*/table-service.md`
   and `data-protection.md`, plus `i18n/invoice-email-notice.ts`. Say that when staff use search,
   Cloud sends the typed search and selected suggestion to Google. Use conditional wording
   and test the plain and filed notice variants in `invoice-email.test.ts`. Update the
   Addresses section of the design system and remove A1171 from both backlog files.

Estimate about 230 production lines and 250 test lines, plus the guide and backlog edits.
Run each touched test file in its own package. Keep the branch on ADDRESS-BOX until #4277
lands, then move only this slice's commits to main before finishing the branch.
