# Printer configuration

You reach printing setup through **Printer configuration**, with the same shared tab strip as
Venue operations: **Print Queue**, **Printers**, and **Print Agents**. On a fresh visit, you start
with Print Agents if none are active, Printers if there are active agents but no active printers,
and Print Queue otherwise. A selected tab takes precedence over these defaults, survives live
updates, and travels in `/manage/printers/view/<key>` for browser navigation.

Print Queue includes every queued, printing and failed job, plus the latest 100 completed jobs
selected by delivery time, with missing delivery times ordered last. Rows remain ordered by creation time, newest first. Each status has
text and a coloured dot: grey for queued, blue for printing, green for done and red for failed.
The endpoint keeps its existing tenant filter and omits job payloads.

Both Add dialogs are about 50% wider on desktop, with viewport limits on smaller screens.
Add printer starts discovery automatically and offers one Scan button with a spinner during its
listening period. You can add results while discovery continues.

Opening Add print agent opens the pairing window automatically. The dialog listens for join
requests, renews the window while open, and closes it when dismissed or when you leave the screen.
Open and close requests execute in order so a slow opening request cannot reopen the window after
you close the dialog. The Scan button starts a ten-second listening indication and can be used
again afterwards. Automatic join reads use the passive API client. Renewal uses an authenticated
`POST /management-api/pairing-mode/renew` that opens or extends the window while authorizing without extending the session; the
background client also avoids reporting user activity to the dashboard shell. Pairing remains the existing venue-wide window shared with device setup; this
change does not introduce a separate print-agent window or change number matching. The dialog retains the recent refused-request count so you can see earlier attempts to join.

Use **Disable**, **Disabled**, and **Enable** for retained agents. Printer Disable retains the
registration, and discovery offers it as **Add again**. This preserves settings, routing references,
print history and pending work. Actual deletion would need explicit handling of these references;
it is not part of this change. The add/disable/re-add regression exercises the same screen instance.

Only the primary box currently registers its print agent automatically. Mirror auto-registration
and cross-box TLS trust remain the separate follow-up recorded in `docs/backlog.md`. The dialog
explains this and remains the entry point for independent agents.

Validation covers tab defaults and navigation, every tab's accessibility, scan feedback and passive
reads, pairing lifetime and late replies, modal dimensions and small-screen controls, re-adding
retained printers, and unfinished jobs older than the completed-history limit. Physical discovery
and paper output require a connected box and are outside these browser/API fixtures.

Validation completed on 2026-09-12: `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and
`TESTCONTAINERS_RYUK_DISABLED=true pnpm test` passed. Complete `test:coverage` runs passed for
`@waitron/dashboard` (1,593 tests), `@waitron/ui` (379 tests) and `@waitron/server` (2,974 tests),
with their configured thresholds enforced. Chromium snapshots of the queue and both Add dialogs
were inspected. The temporary snapshot probe was removed before the full workspace run.
