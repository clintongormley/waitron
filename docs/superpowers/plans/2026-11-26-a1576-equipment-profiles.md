# A1576 · Choose device profiles after adding equipment

**Finish line.** After adding a card reader or printer, a manager can choose which device profiles
can use it. Show the owner the proposed picker before building. The request and initial ticks are
in [A1576](../../backlog/payments.md#a1576-adding-a-card-reader-or-a-printer-asks-which-device-profiles-can-use-it).

1. **Save only the selected equipment.** In `apps/server/src/payments-api.ts`, remove the automatic
   assignment for new readers. Reuse the card-payment eligibility check and `appendReaderToProfiles`.
   Under the existing `hardware.manage` and payments write gates, return the live profile IDs, names
   and eligibility for the reader picker, and allow saving selected eligible IDs. For printers,
   reuse `listDeviceProfiles`, `readProfilePrinterLists` and `setProfilePrinterLists`. Add a narrow
   write in `print-api.ts` requiring both `hardware.manage` and `venue.configure`. In one transaction,
   check the equipment and selected profiles are live and eligible and append only missing entries.
   A receipt printer goes on the receipt and payment-slip lists. An office printer goes on the
   invoice list. Use the same printer eligibility as Device profiles. Keep existing order and
   defaults. Leave drawers, stations and devices alone. Add an `outcome` to reader adoption and to
   receipt `createPrinter` in `packages/printing/src/printers.ts`, using `created`, `restored` and
   `enabled` to distinguish the three results. Reuse the office route's existing outcome.
2. **Ask after registration.** In `apps/dashboard/src`, add one shared `wt-dialog` with
   `draftScopeFor`, named checkboxes and English and Spanish wording. Start a new reader with its
   eligible profiles ticked. Start a restored reader and either printer with every tick clear.
   Explain an unavailable reader profile beside its disabled tick. Leave kitchen-screen profiles
   out of printer choices. Save profiles applies the ticks. Leave unassigned closes the picker.
   Failed saves keep the choices for retry.
   In `payments-screen.ts`, show it for a newly paired reader or for Add that creates or restores
   a reader. Keep an open discovery form and its other drafts below the picker. Wait for the pair
   form to close, and skip the popup if someone already left that workflow. Pass the ID and name
   through `dashboard-kit` and the Stripe and SumUp add callbacks. In `printers-screen.ts`, show it
   after receipt registration creates or restores a printer, before continuing to calibration when
   calibration would have followed. Show it for a newly registered office printer from the named
   Add dialog. Use the registration result to distinguish creation/restoration from enabling or
   moving an existing device. Hardware-only managers get the reader picker and keep their current
   printer Add success, with printer profiles editable in Device profiles under Change venue settings.
3. **Test and document.** In `payments-api.test.ts`, cover both reader add routes leaving assignments
   empty until Save, the hardware-only scope and a selected profile keeping its previous default.
   In `print-api.test.ts`, cover both printer list mappings, a repeated Save, and a refused selection
   leaving all lists as they were. Dashboard cases in `payments-screen.test.ts`, `printers-screen.test.ts`
   and the shared picker's unsaved suite cover the post-add hand-off, the starting ticks, leaving
   unassigned and retry. Assert the added ID and name in the providers' existing
   `stripe-add-reader.test.ts` and `sumup-add-reader.test.ts`, including a SumUp pair that completes
   during Add and one that completes during polling. Keep the late-close coverage in the unsaved suites.
   See each changed behaviour test fail first. Update Add and Card readers in both `printers.md`
   guides and remove A1576 from `docs/backlog.md` and `docs/backlog/payments.md`.

**Expected size.** About 500 lines of product code and translations, plus about 250 test lines.
