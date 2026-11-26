# Step through printouts from Print Queue (A1588)

Open **View printout** and step to the previous or next job using the arrows or the Left and Right
keys. See the printer, status and any queue reason, with the delivery time when recorded or the
queued time otherwise. **Reprint** offers the same picker as the queue row, including for A4 invoices
(#4375).

**Before building:** Show the owner a printed receipt, a failed receipt and an A4 invoice at desktop
and phone widths. Claude reviewed the plan. The watcher cleared it at 09:11 on 26 November 2026
and relayed the owner's 09:39 answer in Lane D's questions: "if you fix those two things the a1588
can land". Remove the two general preview notices in both languages and draw rolls and A4 at a
common scale, with an edge around each A4 page. Send the implementation pictures to the watcher.

## Build

- In `apps/dashboard/src/screens/printers-screen.ts`, take the opening order from the table's
  existing `shownKeys()`, using the same View printout eligibility as the row. Stay on the current
  page with no wrap. Look up rows again by ID for live status and eligibility. Skip neighbours
  that have left the page and keep the selected job's last row if it leaves, as the picker does.
- Put selection and preview reads in `apps/dashboard/src/screens/print-queue-preview.ts` to keep
  the screen within its cap. Preserve the initial open and its page error. For a step, show the
  selected job with a loading message and clear the old paper. Use `getPrintJobPreview`, ignore a
  late response after another step or close, and show a failed step's message in the preview.
  Stepping away and back or reopening retries the read. Ignore keyboard repeat.
- In `apps/dashboard/src/widgets/print-job-preview.ts`, keep the existing `wt-modal` and paper
  renderers. Use the screen's existing status, reason and time wording. Keep labelled arrows and
  Close/Reprint in the footer. Left and Right work inside the preview and keep horizontal scrolling
  available when overflowing receipt paper has focus. At an end, keep focus inside the window.
- Call the same Reprint handler from the row and preview and keep its sending state. Keep the
  preview underneath the picker. After a successful send, restore preview focus and put the
  existing confirmation inside the preview while open. Show a send refusal there if its picker is
  already closed. Check that Cancel or Escape returns focus with the existing dialog behavior.
- Translate new labels in `apps/dashboard/src/i18n/strings.ts` and update Print Queue in
  `apps/server/src/guide/{en,es}/printers.md`. Keep destination and copy rules. The drawer action
  and paper-out presentation belong to A1581. This slice changes no server or till behavior.

## Test and check

- Start red in `apps/dashboard/src/screens/printers-screen.test.ts`. Filter and sort distinct jobs.
  Step by button and keyboard between a receipt, a failed job and an A4 invoice. Check the order,
  skipped rows, end behavior and that an older answer cannot replace the selected job's paper.
  Check that Reprint sends the selected job, displays confirmation in the preview, and leaves focus
  where the arrows still work. Keep the existing failed-open and ineligible-action assertions.
- In `apps/dashboard/src/widgets/print-job-preview.test.ts`, verify arrow names, keyboard scrolling
  when receipt paper overflows, and controls that fit on a phone in the existing accessibility
  checks. Keep the multi-page rendering checks. Run both changed Chromium files, dashboard
  typecheck and guide-link guards. Look at the built window in both languages and themes.
- Allow about 220 added product lines and 180 test lines, plus guide edits.
