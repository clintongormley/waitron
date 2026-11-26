# Alerts, logging and diagnostics — detail

The open entries are listed in [the backlog](../backlog.md), under "Alerts, logging and diagnostics". This file holds
their full text.

## Logging, diagnostics & one-touch bug report (A9; Slice 1 landed #192)

[Design](../superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md). Eventual vendor destination
is GitHub issues; for now a bundle only needs to be copy-pastable.

**2026-11-10 update:** the [download-first plan](../superpowers/plans/2026-11-08-a982-client-only-report-first.md)
provides browser-only preview and download in the dashboard before sign-in and in setup, including
before discovery, after a refusal and while an already-loaded page is offline. Its opening
activity and environment stay fixed while description edits update the exact downloaded preview.
Nothing is submitted to or stored on the box.

**2026-11-14 update:** the till offers the same preview and download from its More menu and
above sign-in, enrolment, device choice, clock-in and attendance pages.
Setup API route names and stored capture with manager read/download remain open. The stored slices
need separate plans. The [2026-10-22 plan](../superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md) and older slice
notes below retain their original context. Cloud forwarding and automatic crash/freeze intake remain
separate follow-ups.

- **Slice 2 — one-touch bug report.** A `bug_reports` table (`local`, grants in its
  module's set), a capture endpoint that FREEZES a self-contained bundle (the projected client
  trail + `LogReader.byRequestIds()` + environment), a `wt-report-dialog`
  and "Report a problem" trigger in the till and dashboard chrome, and a GitHub-ready markdown
  serialiser. Send only the client trail fields projected by
  `captureClientReport` (`packages/diagnostics/src/client-report.ts`).
- **Slice 3 — triage and forwarding.** A dashboard _Problem reports_ screen and automated GitHub-issue
  creation (through Waitron Cloud — see below).
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

## Decisions and deliberate limits

- **Administrators decide which problem descriptions reach Cloud.** The owner made sending an
  administrator decision on 2026-10-24 (“make it an admin decision to send”). On 2026-11-22 the
  watcher confirmed that staff descriptions wait on the box for an administrator to review, send
  or discard. Administrators can send their own descriptions directly. See [Cloud’s monitoring design §11](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md).

- **A1048. Automatic reports are opt-in** (owner, 2026-10-24: “Should be opt in”).
  An opted-in box sends error-severity incident codes, sources, versions, times
  and counts through its Cloud registration. The Cloud receiver contract carries
  an empty log list from this sender. Masked log text and crash files remain in
  the logging and diagnostics work above. [Cloud receiver contract](https://github.com/waitron-io/waitron-cloud/blob/8a01c948da6abe35b03967e9e09b3e62bc2c7465/docs/box-error-reports.md#send-a-report).
