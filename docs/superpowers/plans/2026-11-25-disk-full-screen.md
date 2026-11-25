# Full-screen disk warning

Staff see **Disk full** and **Waitron cannot operate.** on the same red, full-viewport layout as
`till-main-server-strip` when the box stops for lack of space. In Spanish, use **Disco lleno** and
**Waitron no puede funcionar.** The till adds **Tell a manager** / **Avisa al encargado**. The
owner’s 24 November 22:15 wording is recorded in `docs/backlog/box.md` under DISK-FULL-SCREEN.
The owner sees the English and Spanish till and dashboard previews, at phone and desktop widths
in light and dark, before any build. The watcher clears the reviewed plan.

- **Shared window.** Add a `viewport` size to `packages/ui/src/components/wt-modal.ts`. Reuse its
  native modal, named heading and non-dismissible setting. Match the outage’s centered column,
  danger colors, full bleed and scrollable content. Use the current UI tokens and button. In
  `wt-modal.test.ts` and `wt-modal.a11y.test.ts`, check screen coverage, name, focus containment,
  Escape and both themes. Keep the outage widget’s restart and spare actions intact.
- **Till.** In `apps/till/src/till-app.ts` and `screens/till-lock-screen.ts`, replace the full-disk
  row on trading tills, handhelds and their PIN screen using the same box-owned equipment notice.
  Keep the equipment polls, low-space and other notices, and payment/write responses. Let the
  existing no-answer panel take precedence while it offers recovery. In `till-app.notices.test.ts`,
  pin both languages, phone, the PIN screen, an unavailable notice source, and resumed reads clearing
  the window. Assert a low-space reading alone never opens it.
- **Dashboard.** In `apps/dashboard/src/dashboard-app.ts`, replace the bar with the modal at the
  shell level, including when Floor plan is open. Keep the passive stop read and current permission
  routing. **Open Box status** takes an eligible user to that page. **Sign in as a manager** tells
  other users that it signs them out, then opens the existing sign-in with Box status as destination.
  The window stays off Box status and sign-in. Preserve the current unsaved-changes question and
  focus after navigation. Remove the long bar’s formatter and obsolete copy tests, while retaining
  the alert text and the Box status recovery rows. In `dashboard-app.disk-stop.test.ts` and the
  app’s accessibility suite, check both actions, Box status, sign-in, a dirty draft, an already
  open editor, and recovery without a reload.
- **Words and verification.** Update both apps’ `i18n/strings.ts`, the EN/ES `box-status.md` and
  `till-notices.md` guides, the current convention, and the DISK-FULL-SCREEN entries in the two
  backlog files. Keep the existing disk stop API and its response, login rules, recovery work and
  fiscal/payment gates. Use the existing focused Chromium suites and guide/link checks, then look
  at the actual built screens in EN/ES, both themes and both widths before finishing.

Estimate about 130 added product lines and 200 test lines, plus strings and docs. Reuse the existing
fixtures and replace the assertions that specifically pinned the old bar and its copy.
