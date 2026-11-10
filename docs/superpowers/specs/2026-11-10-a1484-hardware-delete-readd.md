# A1484: Delete hardware and add it again

**Proposal for owner approval; implementation must wait.**

The owner asked: “so why are receipt printers possible to disable, but A4 printers get deleted? All other devices and products etc we just delete them (even if they sometimes really just get saved as disabled)”, then “it is much more intuitive to just delete and readd”, adding “so we'd remove the status filter as well  for those”. Source: `~/waitron-campaign-shared/desk/done/20261110-1859-delete-and-readd.md`.

The desk recommended retaining registrations; that was its recommendation, not an approved design. Its A4 description matches the PATCH route (`apps/server/src/page-printers-api.ts:165`): deactivation, no direct reactivation. Products were checked: their action says Archive and archived rows refuse edits (`apps/dashboard/src/widgets/product-list.ts:1243`; `packages/catalogue/src/archive.ts:122`). Products and fiscal node identity stay outside this proposal.

**What you would see.** Receipt/kitchen printers, A4 printers, devices/tills/kitchen screens, card readers and print agents would all offer Delete and return through their usual Add flow. Remove their Active switches, Disable/Enable actions, active/disabled columns and status filters. Main lists show only added hardware; connection and job status remain useful.

**Recommendation: keep the registration and saved settings.** Delete would use the existing inactive flag and hide the item, preserving its id, name, calibration, profile, printer/reader assignments and defaults. This replaces today's settings-clearing Delete (`apps/server/src/device-delete.ts:198`). Re-adding restores configuration still present, including routing; it does not undo subsequent edits. A retired device profile requires a replacement. This avoids configuring the same equipment twice. Earlier permanently deleted registrations remain historical.

Reuse receipt discovery matching, `provenDisabledDevice` and returning-device pairing, reader adoption, and `registerPagePrinter`. Matching uses existing transport/address keys, browser proof, provider reference or A4 queue; no match means a new registration. A4 discovery already refreshes capabilities under the same id (`apps/server/src/page-printers.ts:69`). In Add a print agent, offer retained agents through the existing Allow operation, including the box's agent. Keep automatic self-enrolment unable to reverse Delete (`apps/server/src/join-requests.ts:690`).

Delete would retain payment-in-progress refusals, end device sign-ins and release equipment holds. Reuse `endDeletedPrinterJobs` and invoice-delivery ending for printers; adding them again must not restart ended work. Deleting an agent stops its transport; its printers remain added and queued work can resume after Add. Retain provider registration for readers; adoption verifies availability, and an already-unpaired reader still needs provider pairing. Update existing impact confirmations to describe these effects and retained settings.

History remains readable under its original ids: print jobs name printers and claiming agents (`packages/db/src/schema/print-jobs.ts:38`), A4 deliveries name page printers (`packages/db/src/schema/invoice-deliveries.ts:65`), and payments name readers (`packages/payments/src/schema/payments.ts:110`). Fiscal records keep their device reference untouched (`packages/fiscal-verifactu/src/schema/registros.ts:36`). No historical rows are relabelled or moved.

**Proposed replacement for CLAUDE.md §3:**

> Hardware offers Delete and Add, with no staff Disable/Enable controls or active/disabled filters. Delete hides and deactivates the registration while retaining its id, history and saved settings. Normal discovery, pairing or Add restores a matching retained registration; an unmatched item gets a new id. Historical references remain unchanged.

**Staff wording, EN / ES:** Delete / Eliminar; Add / Añadir; Added / Añadido; Stop / Detener. Confirmation: “Delete {name}? History and settings are kept. Add it again to restore it.” / “¿Eliminar {name}? Se conservan el historial y los ajustes. Vuelve a añadirlo para recuperarlo.” Replace the A4 guidance with “To add it again, use Add a printer.” / “Para volver a añadirla, usa Añadir una impresora.” Update hardware guides and help in both languages.

**Estimated build:** production +350–550/−300–500 lines; tests +300–450/−150–300. Server/database tests own retained references/settings, deletion effects and same-id matching; route tests own permissions and answers; dashboard tests own Delete/Add, hidden rows, removed filters and EN/ES copy. Reuse existing hardware suites; no migration or new state record.
