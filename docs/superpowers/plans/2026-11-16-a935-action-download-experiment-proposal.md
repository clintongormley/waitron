# A935: proposed action-download experiment

**Status:** proposal only, prepared under the watcher's 16 November 14:15 clearance
of the [qualification slice](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-16-ci-routing-post-3514-qualification.md).
The watcher parked it at 14:56 pending a natural setup-download stall. Build no new
guest capability now. On a captured recurrence, bring the capture and this proposal back.
Neither the mechanism nor a fault run is cleared. No guest was changed or started.

**Question:** does a one-minute job limit deliver cancellation to the listener and end its worker
while setup is waiting for the action archive's initial HTTPS request?
Use runner **2.338.2** and `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`.
Record the eventual workflow commit, checked-out source, run, attempt, job and runner IDs.
This measures setup; a step timeout cannot substitute for the job limit.

## Proposed mechanism and its gate

Use one owned guest occupying one normal pool lease, with two sequential jobs: a
successful-download control, then the stall. Use the same immutable runner and action
bytes, an empty action cache for each job, `contents: read`, and no repository secrets.
The workflow needs only that checkout action and a shell step that prints the source SHA.
The control must pass before the fault job is dispatched.

The candidate maps **only `codeload.github.com` inside that guest** to a loopback
listener on port 443. The listener accepts the connection, records its monotonic time
and TLS ClientHello server name, and sends nothing. This targets the TLS handshake
inside the initial GET, before an HTTP response or archive body. It needs no replacement
certificate or trust-store change. This is a proposed mechanism, not a demonstrated stall.

| Receipt, 16 November                                                                                                                                             | Source words                                                                                                                  | What this establishes                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Public API HEAD](https://api.github.com/repos/actions/checkout/tarball/3d3c42e5aac5ba805825da76410c181273ba90b1), saved locally as `public-archive-headers.txt` | `HTTP/2 302`; `location: https://codeload.github.com/actions/checkout/legacy.tar.gz/3d3c42e5aac5ba805825da76410c181273ba90b1` | This public request redirects to codeload; it does not establish the runner's broker-supplied URL. |

The control must retain its sanitized archive URL/redirect evidence and show that this hostname serves
the archive, while listener polling and job updates use other reachable hosts. If that gate
fails, stop with the concrete mismatch; do not intercept `api.github.com`, change shared DNS,
or add a broader proxy. Retain host/path only, never authorization or signed query values.

## Missing capability and smallest build

Cloud's inspected `deploy/disposable-tests/guest-exec.py:89-96` launches the ordinary
listener directly. There is no cleared pre-listener interception hook. The proposal must also establish how the existing cleanup path can cover two
sequential jobs in one explicitly owned qualification turn; retaining the control guest is unverified.

Before any build, have the watcher settle one test-only qualification entry point in the
trusted recipe: reserve the existing pool lease, register each sequential listener through
the existing privileged path, and arm guest-local setup before the second listener starts.
Keep registration credentials in that path. Do not add a pool, persistent service, general
fault framework or shared configuration change. If this cannot reuse the existing lease
and registration paths, return that specific gap before expanding the proposal.

Candidate files in Cloud are `scripts/disposable-tests/action-download.proof.mjs`,
`scripts/disposable-tests/action-download.test.mjs` and
`.github/workflows/disposable-action-download.yml`; the exact trusted-recipe integration is unresolved. Forecast: production changes **0**,
qualification driver **80–120** lines, workflow **25–35**, tests **50–80**. These are estimates
for a later reviewed plan, not an executable or approved implementation plan.

## Evidence, independent stop and cleanup

Arm the existing host turn-deadline destruction before dispatch, outside the guest and
its network path, at ten minutes for the whole qualification turn. Give each job a
one-minute limit. Keep the archive connection open until normal worker exit or the outer
stop; retain listener cancellation receipt, worker exit code/time and process snapshots.
Use guest monotonic times alongside UTC so the phases can be joined.

The passing control, accepted TLS connection and continuing control traffic must all be
visible. Record whether the job limit delivered cancellation, when the worker ended, and
whether download retry/refusal intervened. Manual cancellation, fast refusal, the outer
stop, or an absent connection leaves the job-limit proof open. Collect sanitized runner
diagnostics before destruction. Remove only this turn's listener, name mapping, registrations
and guest; independently inspect guest absence before releasing its pool lease. No other
lane is paused. The deadline triggers destruction at ten minutes; the normal slot stays
occupied until cleanup independently confirms guest absence.

**Next action:** retain a natural action-download setup stall with its run, attempt,
job and runner diagnostics, then return this proposal to the watcher. Do not build the
setup hook or two-job lease reuse solely to stage this failure. The hostname and
control-traffic gate remain unverified.
