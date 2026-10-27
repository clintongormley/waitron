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

## The alert registry's per-source savepoint has no test that fails without it

Found by A798-B slice 4 (#1958). `readOpenAlerts` (`apps/server/src/alerts.ts`) asks
each source inside a savepoint so a failed source's writes go with it, but removing the savepoint
left every test file that reaches `readOpenAlerts` passing: their failing
sources fail a query or throw before writing anything, so nothing is left for the savepoint to
undo. A failing source that writes before it throws would pin it, as
`apps/server/src/staff-notices.test.ts` does. It also reads each source's answer after the
savepoint closes, so an answer that throws part way keeps the alerts before the bad one beside
`alert.source_unavailable`, and a `null` becomes `{ kind, area }`; `readStaffNotices` reads its
answer inside the savepoint.

## Logging, diagnostics & one-touch bug report (A9; Slice 1 landed #192)

[Design](../superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md). Eventual vendor destination
is GitHub issues; for now a bundle only needs to be copy-pastable.

**A982 plan, 2026-10-22:** follow the
[implementation plan](../superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md) for the
owner's “button now, Cloud later” scope. Its three implementation PRs remain unbuilt. The manual
report capture, manager read/download list and carried privacy/setup hardening belong to A982;
Cloud forwarding, automatic crash/freeze intake and the remaining triage workflow stay open.
The plan proposes client-only downloads for setup, signed-out and offline screens, without public
server-log access. The older slice descriptions and decisions below retain their original context.

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
  - **What a report may carry (owner, 2026-10-22, A980 O9 (a)).** An automatic report carries only
    the error, the Waitron version and log lines with personal details masked. Anything a person
    typed travels only in a report a manager has read and chosen to send. See the
    [A980 design](../superpowers/specs/2026-10-22-a980-data-protection-design.md), §5.3.
    The log's own mask (A980 S10, `apps/server/src/log-personal-data.ts`) covers only listed
    detail names, so a report's masking must not rely on it for free text such as an error's
    message.
  - **Automatic reports as well as the manual button.** A crash that reaches the recovery page, an
    unexpected server error, and a frozen process stopped by its watchdog (A18d writes one JSON
    report file per event on a persistent volume, outside the venue database) each become a
    pending report. After the box is back up, a signed-in manager is offered it on the dashboard —
    never on the unauthenticated recovery page — with an optional description of what they were
    doing, and a setting to send them automatically. The owner's aim: the more bugs reported, the
    better.
  - **Where the freeze reports are (#608).** One JSON file per process the watchdog kills, in
    `<logDir>/crash-reports/` — on a box `/var/lib/waitron/logs/crash-reports/` on the persistent
    `logs` volume, outside the venue database. Nothing reads them yet. A start that finds under
    256 MiB free, or that failed on a full disk, deletes those more than a week old
    (`apps/server/src/start-space.ts:119-133`; `deploy/README.md:254-258`), and since A798-B
    slice 7 so does the Box status page's Free button (`deleteLeftovers`,
    `apps/server/src/free-space-now.ts`).

## The Alerts table makes long station warnings hard to read on a phone

- A 390 px mounted
  dashboard fixture for `route.released_at_closed_station` showed only the start of its warning at
  first; its 340 px table viewport had 906 px of scrollable content, and a 566 px horizontal pan
  reached the remaining text. Give the alert text more room at phone width while keeping its
  handling action reachable.
  W41s-3d qualification (2026-10-11) also shows the repeated-refusals message's line ends
  cut beside pinned Actions in mounted 390 px fixtures, in English and Spanish and both themes.
  Desktop 1280 px fixtures show the complete message. These are controlled alert-data fixtures,
  not an authenticated server session; the table's phone readability remains open.

## A1047. Send a problem report to Waitron Cloud

(owner, 2026-10-24). The follow-up A982
leaves open. Cloud's approved [monitoring design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md) (section 11) has its triage agent
sort reports by urgency. A report's errors, version and installation details go at once; the
typed description goes only when someone with the venue's admin permission sends it (owner:
"make it an admin decision to send", keeping A980's O9). A box that cannot reach Cloud keeps
the report and sends it later, and the sender sees which.

## A1048. Opt-in automatic error reports to Waitron Cloud

(owner, 2026-10-24: "Should be opt
in"). Setup asks plainly, unticked; settings can change it. A report holds only the error's
code and source, the version, counts and masked log lines (A980 O9; the log's own mask covers only listed detail names, not
free text), is signed with the box's
Cloud installation credentials, and is kept while Cloud cannot be reached. Cloud groups them
by version to catch a bad release (design section 10).

## The alert pop-up can split a written time across two lines

- The Box status page's rows, its
  clock check dialog and its list of wrongly dated sales, the bell and the Alerts screen keep each
  `YYYY-MM-DD HH:MM` whole (`wholeTimes`, `apps/dashboard/src/widgets/alert-format.ts`); the pop-up
  (`wt-toast`) takes a plain string, so keeping times whole there needs `wt-toast` to take more than
  a string, or no-break characters in the text. The page's 'Updated' line does not use `wholeTimes`
  either (`apps/dashboard/src/screens/box-status-screen.ts`). Left open by A798-B slice 9 (#2025).
