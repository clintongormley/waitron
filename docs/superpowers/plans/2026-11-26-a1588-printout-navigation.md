# Step through printouts from Print Queue (A1588)

Open **View printout** and step to the previous or next job using the arrow buttons or Left and
Right. The window shows the printer, current status, queue reason when present, and the delivery
time when recorded or the queued time otherwise. The **Reprint** button uses the same picker and
eligibility as the row, for receipt jobs and A4 invoices. A1583 added A4 invoice previews in #4375.

## Build

- In `apps/dashboard/src/screens/printers-screen.ts`, take the opening order from the queue table's
  existing `shownKeys()`, limited to rows with **View printout**. Use that order on the current page
  until the window closes, with no wrap. As the queue refreshes, use current row status and print
  eligibility. Skip jobs that have left the page. Keep the open document if its source row leaves,
  hiding its print action and keeping the last displayed status.
- Keep preview reads in the dashboard using `getPrintJobPreview`. In `apps/dashboard/src/screens/`
  add a small `print-queue-preview.ts` for selection and read state to keep `printers-screen.ts`
  within its cap. Open the existing modal with the clicked row as its opener. On a step, show the
  selected job's status and load its paper in place. A failed read shows its message and Retry inside
  the modal. Closing or stepping away prevents an older read from replacing the current paper.
- In `apps/dashboard/src/widgets/print-job-preview.ts`, reuse the receipt and A4 paper renderers and
  existing `wt-modal`. Keep labelled arrow controls and Close/Reprint visible while paper scrolls.
  Left and Right act inside the preview only, leaving horizontal paper scrolling available when its
  region has focus. Use the same status/reason wording and time formatting as the queue. The action
  opens the existing `dashboard-print-job-reprint-dialog` for the selected row through the screen's
  shared action. Closing that picker returns focus to the preview action when it remains available.
- Update `apps/dashboard/src/i18n/strings.ts` and the English and Spanish Print Queue sections in
  `apps/server/src/guide/{en,es}/printers.md`. Keep the existing request, destination, and copy rules.
  A1581 owns the drawer action and paper-out presentation changes. Server and till are outside this slice.

## Test and check

- Start red in `apps/dashboard/src/screens/printers-screen.test.ts`. Filter and sort visibly different
  jobs. Open a receipt, step by arrow and keyboard across a failed receipt and an A4 invoice, and
  check that filtered and non-previewable rows are skipped and the arrows stop at the ends. Check
  that the selected row's Reprint opens its own picker with the expected target and that an ineligible
  job offers no action. Resolve a superseded preview late and check the selected paper stays put.
- In `apps/dashboard/src/widgets/print-job-preview.test.ts`, check that focused receipt paper keeps its
  scrolling keys, and that the new controls have accessible names and fit alongside the A4 and receipt
  content on a phone. Keep the existing paper and multi-page checks. Run the two focused Chromium
  files, dashboard typecheck and guide-link guards.
- Show the owner a pre-build picture for a printed receipt, a failed receipt and an A4 invoice at
  desktop and phone widths. After the build, capture the actual window in both themes and languages
  for the owner's landing decision. Estimate 220 added product lines and 160 test lines, plus the guides.
