# Restore the Live badge and configuration export on the main server

Lane D’s `SETUP-MODE-AFTER-SWITCH` asks that a box which becomes primary by switch, promotion or
restore show the same Live label and offer the same configuration export as its predecessor.

The join and emergency-copy writers omit the original setup choice from `trading.env`. Promotion
keeps the joined file and restore copies the saved file. `config.ts` accepts Live on production and
development boxes. An ordinary preproduction box could have started in Prepare or Demo. The
[20 November rehearsal record](../specs/2026-10-21-a947-two-box-failover-design.md) says both
boxes were ordinary preproduction and does not name the original setup choice.

**Proposed production fix.** A serving production primary with no recorded setup choice shows Live
on the dashboard and offers its usual encrypted configuration export. An explicit choice takes
precedence. The watcher still needs to settle the outcome for the rehearsal Lenovo. Carrying the
original choice for future joins would also affect practice payments and fiscal test submission
policy. That requires a decision before including it in this item.

- [ ] Extend the export-route matrix in `apps/server/src/boot.setup-routes.test.ts` with a configured
  production primary whose choice is absent. Assert that `/management-api/locales` and
  `/management-api/session/me` report Live and a fresh manager session can download the encrypted
  export. Reuse the session and export request pattern from the configuration-import cases in the
  same file. An unsigned request still answers 401. Keep the Demo and unmarked preproduction
  controls at 404. Run the new case before editing boot. Expect it to see an absent choice and 404.
- [ ] In the full trading boot path in `apps/server/src/boot.ts`, derive one dashboard intent
  from the explicit choice or Live when `acceptingSales` is true and `config.environment` is
  `production`. Use it for the existing `mountMeApi` and export route condition. The dashboard
  banner and Backups card already consume the same intent. Keep the route’s existing permission
  and fresh sign-in checks. Leave the raw intent with the till, box name job and fiscal policy.
- [ ] Rerun the export matrix and `configuration-export-api.test.ts`. In a disposable Chromium
  dashboard, inspect the Live label and export card with the server's response in both languages,
  themes and phone and desktop widths. Keep the existing Backups guide instructions. Narrow the
  A496 note in `docs/backlog/setup.md` to the still-open case if the watcher takes this cut.

Estimate: 5–12 production lines in one file, 35–70 test lines in one file and a short backlog edit.
