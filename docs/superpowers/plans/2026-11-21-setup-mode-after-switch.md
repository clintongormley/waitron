# Restore the Live badge and configuration export on the main server

Lane D’s `SETUP-MODE-AFTER-SWITCH` asks that a box which becomes primary by switch, promotion or
restore show the same Live label and offer the same configuration export as its predecessor.

The join and emergency-copy writers omit the original setup choice from `trading.env`. Promotion
keeps the joined file and restore copies the saved file. `config.ts` accepts explicit Live in
production or development. The owner’s 20 November Lenovo rehearsal used ordinary preproduction
on both boxes, according to the [two-box rehearsal record](../specs/2026-10-21-a947-two-box-failover-design.md).
That record does not name the original setup choice. Ordinary preproduction supports Prepare and
Demo, so its environment alone cannot recover the missing choice.

**Proposed outcome.** On a configured production primary, show Live even when the original choice
is absent. A manager on a serving primary with no saved choice can download the usual encrypted
configuration export, including on the rehearsal box. Leave the badge absent on preproduction
copies with no saved choice. An explicit choice continues to determine the badge and Demo keeps
its export restriction. Confirm this wording for the rehearsal with the watcher before building.

- [ ] Extend the existing export-route matrix in `apps/server/src/boot.setup-routes.test.ts` with
  unmarked production and preproduction primaries. Assert the displayed mode in `/management-api/locales`
  and `/management-api/session/me` as well as the route’s existing sign-in refusal. Confirm a
  freshly signed-in manager can download and that explicit Demo still gets 404. Run the new cases
  and see the missing badge and route assertions fail before editing production code.
- [ ] In the full trading boot path in `apps/server/src/boot.ts`, pass `mountMeApi` a dashboard
  intent that falls back to Live only for a production primary. Compute export availability from
  the same route mount condition and publish it on the signed-in answer in `apps/server/src/me-api.ts`.
  Keep the export handler’s permission and fresh sign-in checks. Reuse the existing serving-primary
  check for the new unmarked case. Leave copy files, fiscal policy and the setup-mode parser alone.
- [ ] Carry `configurationExportAvailable` through `apps/dashboard/src/api/client.ts` and
  `dashboard-app.ts` to `screens/backup-screen.ts`. Use the existing export card and banner. In
  `dashboard-app.test.ts` test the reported flag with an unmarked rehearsal response and test the
  badge with the reported Live response. In `screens/backup-screen.test.ts` verify the flag selects
  the card and retain the existing download behaviour assertions. Run the affected files and inspect
  the banner and Backups in English and Spanish, light and dark, phone and desktop.
- [ ] Point to **Backups** on the main server in `apps/server/src/guide/{en,es}/backups.md` and take
  the resolved A496 export item out of `docs/backlog/setup.md`. Run the guide checks.

Estimate: 25–45 production lines across five files, 45–85 test lines across three files and three
small documentation edits. No migration or new data on disk.
