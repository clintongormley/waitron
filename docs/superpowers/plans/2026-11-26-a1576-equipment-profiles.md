# A1576 · Choose device profiles after adding equipment

**Finish line.** After adding a card reader or printer, a manager can choose which device profiles
can use it. Show the owner the proposed picker before building. The request and default ticks are
in [A1576](../../backlog/payments.md#a1576-adding-a-card-reader-or-a-printer-asks-which-device-profiles-can-use-it).

1. **Save the chosen profiles.** In `apps/server/src/payments-api.ts`, remove automatic assignment
   from new reader pairing and adoption. Reuse the existing card-payment eligibility check for reader
   choices and `appendReaderToProfiles` for saving them. In `apps/server/src/print-api.ts`, reuse
   `readProfilePrinterLists` and `setProfilePrinterLists`. For a receipt printer, append it to the
   receipt and payment-slip lists. For an office printer, append it to the invoice list. Use narrow
   equipment-specific writes. In each transaction, check the existing equipment and profile edit
   permissions, confirm the equipment and selected profiles are live and eligible, and apply the
   selection once. Preserve list order, other equipment and existing defaults. Kitchen screens have
   no equipment lists. Keep printer calibration, drawer, prep-station and per-device choices outside
   this step. A manager with hardware permission alone can still add equipment.
2. **Ask after Add.** Reuse `listDeviceProfiles`, `wt-dialog` and `draftScopeFor` in one shared
   Dashboard picker. Use named checkboxes. For a reader, start with the profiles that take reader
   payments ticked. For a printer, start with none. Save profiles offers the equipment to the
   selected profiles. Skip for now leaves the equipment added and saves no assignments. Keep the
   picker open with its choices after a failed save. Hook it up in `payments-screen.ts` for adopted
   and newly paired readers and in `printers-screen.ts` after receipt and A4 registration. Keep
   the existing receipt calibration path after the picker. Leave a move to another agent and a
   re-pair of already registered equipment alone. Pass the registered id/name through the existing
   `dashboard-kit` provider callback and the Stripe and SumUp add panels. Add the two writes in the
   Dashboard API clients and the shared picker text in English and Spanish. Update both printer
   guides and remove A1576 from `docs/backlog.md` and `docs/backlog/payments.md`.
3. **Prove what changed.** In `payments-api.test.ts`, prove pairing and adoption add no profile
   assignments before Save and a selected profile receives the reader with its default intact. In
   `print-api.test.ts`, prove the two printer kinds go on their own lists, the untouched profiles
   and defaults stay put, and a refused selection saves nothing. Browser cases in
   `payments-screen.test.ts`, `printers-screen.test.ts` and the picker's unsaved suite cover the
   different initial ticks, explicit save, skip, and retry without adding the equipment again.
   Run each targeted suite after seeing its new case fail, plus the existing Stripe and SumUp panel
   cases for the changed callback. Verify the local picture at phone width, in English and Spanish.

**Expected size.** About 450 lines of product code and translations, plus about 240 test lines.
