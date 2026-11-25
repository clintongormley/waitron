# Full-screen disk warning

Show **Disk full. Waitron cannot operate.** / **Disco lleno. Waitron no puede funcionar.** on the
red layout of `apps/till/src/widgets/main-server-strip.ts`. The owner’s request is recorded in
`docs/backlog/box.md`. Build after the owner approves the pictures and resolves till sign-in and
sign-out, and the watcher clears the reviewed plan in Lane I’s `questions.md`.

- **Shared window.** Add a small `wt-stop-screen` extending `WtDialog` in `packages/ui`. Reuse
  its native modal, Escape guard and focus handling. Borrow the outage’s full-bleed danger colors,
  centered scrollable column and inverse button using existing tokens. Document the primitive in
  `design-system.md`. Its browser and axe tests cover full viewport size, accessible name,
  Escape, text-only and action states, and token painting in both themes.
- **Till and handheld.** In `till-app.ts` and `screens/till-lock-screen.ts`, use the existing
  box-owned equipment notice and polling. Keep **Tell a manager** / **Avisa al encargado**, the
  existing exception in `conventions-ui.md`. Proposed for owner review: put the modal on trading
  tills with **Log out** / **Cerrar sesión** using the current leave and sign-out flow. Keep the
  PIN screen and its disk notice available. The modal covers open orders and bills. Keep KDS and
  standalone attendance/clock screens on their current notice treatment. Let no-answer recovery,
  in-flight or unresolved payment/refund controls, their result, and the leave question remain
  above or ahead of the disk window. In `till-app.notices.test.ts` and the existing payment/refund
  suites, verify the reader Stop and charged-card message stay usable, plus both languages,
  phone, low space, a failed notice read and clearing the stop.
- **Dashboard.** Replace the long bar in `dashboard-app.ts` with the modal at shell level. Keep
  the passive status read and permissions. Use **Open Box status** or **Sign in as a manager**,
  with **This signs you out.** / **Se cerrará tu sesión.** on the second path. Exempt Box status,
  sign-in, and Check card payments, which a till’s charged-card message links to directly. Keep
  the existing leave decision above the warning and focus the destination after navigation.
  In `dashboard-app.disk-stop.test.ts`, `dashboard-app.test.ts` and the app’s axe suite, test both
  actions, the three exemptions, the dirty draft, recovery after a successful passive read, and
  that the red window covers Floor plan whether the editor opens before or during the stop.
- **Words and checks.** Update both apps’ strings, both languages of Box status and Till notices,
  `conventions-ui.md`, and the backlog entry and pointer. Remove the dashboard bar formatter,
  its copy-only tests and their entry in `apps/dashboard/test-durations.json`. Keep the dashboard
  word guard on the new strings and keep the backup alert in the bell. Leave the HTTP response
  shape and stop calculation intact to keep this change in the UI. A failed read holds the last
  stop until a successful refresh. Run the focused Chromium suites and guide/link guards, then
  inspect the built warning in English and Spanish, light and dark, at phone and desktop widths.

Estimate 155 added product lines and 245 test lines, plus words and docs. Reuse existing fixtures
and retain behavior assertions when replacing checks of the old bar.
