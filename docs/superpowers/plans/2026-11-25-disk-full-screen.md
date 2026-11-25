# Full-screen disk warning

Show **Disk full. Waitron cannot operate.** on trading tills, handhelds and the dashboard when
the box reports a full-disk stop. The owner asked for “A modal like when the server is down - red
covering the whole screen. Disk Full. Waitron cannot operate. or similar” on 24 November at 22:15.
Lane I's questions record the watcher clearing the plan with seven corrections at 06:24 on
25 November and the owner approving the first boards with “Remove ‘This signs you out’” at 10:24.

- Add `wt-stop-screen` to `packages/ui`, using `WtDialog` for the native modal, keyboard handling
  and focus. Use the outage panel's danger colors and centered scrollable layout. The primitive's
  tests check size, colors and the text and action states with axe in both themes.
- Use the existing box-owned disk notice and polls in `till-app.ts`, with a small renderer beside it
  to fit the app's file cap. The window says **Tell a manager** and covers the PIN screen and open
  bills. Kitchen and standalone attendance screens keep their notices. The outage and leave
  question take priority. Let a payment or refund being sent and its result or refusal finish
  first. An unanswered payment kept after its dialog closes does not hold the window off.
  Till tests check those priorities, recovery, language and the existing low-space strip.
- Replace the dashboard bar in `dashboard-app.ts`. Use the Floor plan editor's existing notices
  slot so its modal opens underneath the warning even when opened during a stop. Keep Box status,
  sign-in and Check card payments reachable. **Open Box status** respects the leave question and
  focuses the destination. **Sign in as a manager** uses the existing in-place sign-in and only
  proceeds with the new session after it succeeds. The failed sign-in path must preserve the
  current session. Dashboard tests cover those paths and the existing passive stop read.
- Leave the stop calculation and backup alert in place. Remove the backup deletion details from
  `disk-stop-api.ts`, its boot wiring, dashboard client and bar formatter. Route and client tests
  cover the remaining status response. Update the English and Spanish guides, UI conventions,
  design system and backlog. Inspect both languages and themes at desktop and phone widths.

Estimate about 155 product lines and 245 test lines added, plus words and docs.
