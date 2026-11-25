# Till address suggestions and attribution

Implement ADDRESS-TILL and ADDRESS-WORDS from the [finish plan](2026-11-24-address-lookup-finish.md).
A cashier can find a Spanish address in the full-invoice window, edit the filled fields and save
as usual, or type the address while suggestions are unavailable. The four forms identify Google
Maps beside suggestions and beside an address they fill. ADDRESS-PROOF covers the live service.

1. **Till route.** Share the dashboard route's body handling, Cloud error statuses and bridge in
   Server's `address-lookup-api.ts`. Always mount `POST /api/address-lookup` from `till-api.ts` and
   pass its `STATUS` in. Use the connection and primary check from `boot.ts`. With no configuration,
   availability returns false. Use the invoice-choice route's `requireSession` with `take-orders`
   and matching device proof. Rerun the session check passively and recheck primary when the bridge
   asks. The lookup names no order and reads no zone. First fail `address-lookup-api.test.ts` for
   a signed-in till reaching the bridge and a sign-out during lookup. Keep the dashboard route's
   stepdown check. Update `till-api.profile-actions`, `till-api.profile-zones`, `till-api.session-person`,
   `till-device-proof` and Diagnostics' `path-patterns.ts`.
2. **Open the search without delaying the invoice.** Add `TillApi.addressLookup(operation)` in
   `apps/till/src/api/client.ts` using its signed-in request path. In `till-app.ts` pass this
   function to `widgets/invoice-recipient-dialog.ts`. Read the saved recipient before checking
   availability. Use `cloudAddressProvider` for Spain and keep the existing injected provider.
   Show the manual form immediately and drop late answers after a country change or dialog close.
   The availability check stays in the dialog. Keep the current caps on till-app.ts, boot.ts and
   api/client.ts. Reuse the address mapping and draft confirmation. First fail `api/client.test.ts` for the POST and a
   `till-app-bill-payments.test.ts` case that opens the real dialog and finds search only after
   availability succeeds. Use `invoice-recipient-dialog.address-lookup.test.ts` for switching
   away from Spain during the check and keeping manual entry on refusal.
3. **Attribute the filled address.** Keep the list's existing **Google Maps** labels. Carry that
   name on the resolved address from `packages/country-packs/src/cloud-address-provider.ts` through
   the result types in `packages/country/src/country.ts` and `wt-address-lookup.ts`. Render one visible
   credit above the filled fields when the form accepts a choice. A manual address or country edit,
   reset or successful save ends the credit. A refused save or a provider that disappears leaves it.
   In setup's `venue-screen.ts`, clear the venue and registered credits separately. Switching
   on **Same as venue** clears the registered credit. Wire the existing handlers in dashboard's
   `venue-details-panel.ts` and `registered-address-dialog.ts`, and the till's recipient dialog.
   First fail `wt-address-lookup.test.ts` for showing the applied credit without a provider. Use
   the form tests to cover applying and editing, including the setup switch, and the till's
   save-state test for a refused save. Check keyboard choice and manual entry in Chromium. Take
   full till-window pictures with the list open and after filling, in both languages, both themes
   and at desktop and phone widths. For each other form, take a filled picture in desktop English
   light and phone Spanish dark.
4. **Tell staff and customers.** Update both languages of `apps/server/src/guide/*/table-service.md`
   and `data-protection.md`, plus `i18n/invoice-email-notice.ts`. Say that when staff use search,
   Cloud sends the typed search and selected suggestion to Google. Cover the adaptable notice,
   its email explanation and the full notice's recipients. Use the same conditional sentence
   with and without a tax record. Put it in one entry per language in `INVOICE_EMAIL_NOTICE_WORDS` and
   update the notice check in `boot.invoice-delivery.test.ts`. Assert the literal wording only in
   `invoice-email.test.ts`. Update the design system's Addresses section and remove A1171 from both backlog files.
   - EN: If staff searched for your address, Waitron Cloud sent the search text and the selected
     suggestion to Google Maps.
   - ES: Si el personal buscó su dirección, Waitron Cloud envió el texto de la búsqueda y la
     sugerencia seleccionada a Google Maps.

Estimate about 230 production lines and 250 test lines, plus the guide and backlog edits.
Run each touched test file and the till app files that open the recipient window. The watcher
wrote in lane E's `questions.md` (25 November, 00:07), "Build ADDRESS-TILL on a branch stacked on
feat/e-address-box in the meantime; it rebases once #4277 lands." Move only this slice's commits
to main before finishing.

The watcher cleared the plan with these edits at 00:19 on 25 November. Send the owner both
email sentences with the pictures. Explain that every emailed full invoice with a privacy contact
includes the sentence, even where address search is off. Lane E lands only after the owner's yes
to both and green CI.
