# Alerts, logging and diagnostics — detail

The open entries are listed in [the backlog](../backlog.md), under "Alerts, logging and diagnostics". This file holds
their full text.

## `redact-secrets.ts` was written against the PostgreSQL connection-string parser

- Found by #620 (`apps/server` part h1), not fixable in a comments-only change.
  `redact-secrets.ts` was written against the PostgreSQL connection-string parser, and `pg` is now
  installed only for `bench/pglite-throughput`; whether a credential-bearing URL can still reach
  the log is unchecked. `apps/server/vitest.config.ts`'s `coverage.exclude` lists `scripts/**`,
  which its `src/**/*.ts` include already leaves out (read only). The adoption-pending entry below
  still gives PostgreSQL's SQLSTATE 23503 on `nodes_location_id_locations_id_fk` as evidence; this
  engine reports `FOREIGN KEY constraint failed` and names no constraint. Test titles #620 could
  not touch: "(design §3b(2))" in `set-table-status.test.ts`, "(owner decision 2026-08-02)" in
  `workforce-api.test.ts`, "(guard by deletion)" in `seed-sales.test.ts`.

## Logging, diagnostics & one-touch bug report (A9; Slice 1 landed #192)

[Design](../superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md). Eventual vendor destination
is GitHub issues; for now a bundle only needs to be copy-pastable.

- **Slice 2 — one-touch bug report.** A `bug_reports` table (`local`, grants in its
  module's set), a capture endpoint that FREEZES a self-contained bundle (client trail `snapshot()` +
  `LogReader.byRequestIds()` + environment), a `wt-report-dialog` and "Report a problem" trigger in
  the till and dashboard chrome, and a GitHub-ready markdown serialiser.
- **Slice 3 — triage and forwarding.** A dashboard _Problem reports_ screen and automated GitHub-issue
  creation (through Waitron Cloud — see below).
- **Hardening carried out of Slice 1, for Slice 2:** a key-name allowlist on the client trail's
  redaction (it filters by value TYPE only, so a secret string under any key passes) and scrub
  `message`/`stack` from rejected Errors; `maskPath` masks UUID and all-numeric segments only — mask
  slugs and emails too; route the dashboard's boot-probe-fail, post-login and logout transitions
  through the nav trail; roll the trail and report button out to `apps/setup`.
- **Owner decisions 2026-09-24 — crash and freeze reports, and where reports go.** These extend
  Slices 2 and 3 and replace one part of Slice 3; design them together before building:
  - **Reports go to Waitron Cloud, which files the GitHub issue.** The box holds no GitHub
    credential (this replaces Slice 3's stored token in `@waitron/credentials`). The box sends
    through its signed-in Cloud client (`apps/server/src/cloud-client.ts`, #582); Cloud (the
    separate `waitron-cloud` repository, being built) files the issue and groups reports with the
    same stack into one issue with a count. Open: what a venue not connected to Cloud is offered.
  - **The repository is public**, so the public issue carries only the stack, the Waitron version and
    the error code. The venue's identity and anything a person typed stay private in Cloud, linked
    from the issue.
  - **Automatic reports as well as the manual button.** A crash that reaches the recovery page, an
    unexpected server error, and a frozen process stopped by its watchdog (A18d writes one JSON
    report file per event on a persistent volume, outside the venue database) each become a
    pending report. After the box is back up, a signed-in manager is offered it on the dashboard —
    never on the unauthenticated recovery page — with an optional description of what they were
    doing, and a setting to send them automatically. The owner's aim: the more bugs reported, the
    better.
  - **Where the freeze reports are (#608).** One JSON file per process the watchdog kills, in
    `<logDir>/crash-reports/` — on a box `/var/lib/waitron/logs/crash-reports/` on the persistent
    `logs` volume, outside the venue database. Nothing reads or deletes them yet.

## The Alerts table makes long station warnings hard to read on a phone

- **The Alerts table makes long station warnings hard to read on a phone.** A 390 px mounted
  dashboard fixture for `route.released_at_closed_station` showed only the start of its warning at
  first; its 340 px table viewport had 906 px of scrollable content, and a 566 px horizontal pan
  reached the remaining text. Give the alert text more room at phone width while keeping its
  handling action reachable.
