# Restore the Live badge and configuration export on the main server

Lane D’s `SETUP-MODE-AFTER-SWITCH` asks that a box which becomes primary by switch, promotion or
restore show the same Live label and offer the same configuration export as its predecessor.

The join and emergency-copy writers omit the original setup choice from `trading.env`. Promotion
keeps the joined file and restore copies the saved file. Production accepts only Live.
The [20 November rehearsal record](../specs/2026-10-21-a947-two-box-failover-design.md) records
ordinary preproduction boxes and leaves their original setup choice unspecified.

Claude reviewed the initial plan. The Lane D watcher cleared the production-only change at
00:31 on 21 November 2026 in the lane's `questions.md`, with the scope below.

- [ ] Test `loadConfig` in `apps/server/src/config.test.ts`. Without a recorded choice, a production
  box gets Live and a preproduction box keeps no choice. Keep the existing explicit-choice cases.
- [ ] Test a real configured production primary with no saved choice in
  `apps/server/src/boot.setup-routes.test.ts`. The public locales and authenticated session responses
  report Live. A fresh manager session can download a bundle that opens with its passphrase.
  An unsigned request answers 401. The unmarked preproduction and Demo cases still answer 404.
- [ ] After observing the production failures, default the result of the existing intent parser to
  Live for production in `apps/server/src/config.ts`. Dashboard, till and box name jobs already use
  that result. Keep the existing export permissions and production setup validation.
- [ ] Run the export, setup and waiting-page tests. Record the preproduction question in the
  existing A496 section of `docs/backlog/setup.md`. Carrying the original choice at join would
  also affect practice mode, simulated payments and test fiscal submission and is outside this cut.

Estimate is one production line plus its field comment, about 75 new test lines and a short
backlog edit.
