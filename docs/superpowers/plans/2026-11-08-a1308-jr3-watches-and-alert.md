# A1308 jr3 — the `job.failing` alert, and the six watches on the runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6). The tamper watch guards `verifactu_records`' triggers but sends
nothing to AEAT and writes no record: it only changes how its 10-second check is scheduled. It is a
risk-trigger diff (fiscal invariant), so it takes the full review path.

**Goal:** A job that keeps failing raises one dashboard alert, `job.failing`, worded in English and
Spanish; and six jobs that poll on fixed timers move onto the runner: the tamper watch (R9), the
clock watch (R10), the free-space watch (R11), the Cloud connection (R15), translation suggestions
(R17) and the practice printer (R18), which now wakes on a print job instead of every half second.

**Architecture:** An ongoing alert source in `apps/server/src/alert-sources.ts` reads the runner's
views (jr1 `JobRunner.views()`); one alert code with one parameter, the job's name, which the
dashboard turns into words through a word list (`{job:job_name}`, the mechanism at
`packages/dashboard-kit/src/alert-messages.ts:8-18`). Each watch becomes a `JobDefinition` built
beside its code; its self-re-arming timer goes.

**Spec:** [jobs.md §2 R0 ("raises one `job.failing` alert per job"), R9, R10, R11, R15, R17, R18; §3 rows "Fiscal tamper watch", "Clock watch", "Free-space watch", "Waitron Cloud connection refresh", "Menu translation suggestions", "Demo printer"; §4 "Data loss"](../specs/2026-11-02-rationalisation/jobs.md);
CLAUDE.md §3 (alert wording in English and Spanish). Slice rules apply.

**Timings:** where this plan writes `timings.x`, read env1's `DutyTimings`
(`2026-11-08-a1308-env1-tuning-constants.md`); if env1 has not landed, `config.x`.

## What it builds

1. `job.failing`: raised for a job that has failed at least 3 passes in a row **and** has been
   failing for at least 10 minutes **and** at least one of those passes threw (its view's
   `lastErrorCode` is set); cleared by its next clean pass. A run of passes that only report undone
   work (`degraded`: the drain's skips, reconcile's parked runs) raises nothing here, because each
   such cause has its own alert (for example `fiscal.awaiting_certificate`). Severity `error` for a judged job,
   `warning` otherwise. Not raised for a job with `ownFailureAlert`. Area `box`, permission
   `system.manage`, screen `box-status` (as `storageAlertSource`, `alert-sources.ts:312-327`).
2. English and Spanish words for every one of the 20 catalogue names, so no later PR touches the
   dashboard's wording.
3. R9, R10, R11, R15, R17, R18 on the runner.

## What it leaves out

Cloud snapshots (`cloudSnapshots`, `boot.ts:3827-3862`) stay on `cloudController` until jr10;
`job.failing` is not emailed (R7 emails disk, space, incidents and module notices only).

## Files

- Modify: `apps/server/src/alert-sources.ts`, `alert-sources.test.ts` (or a new
  `alert-sources.job-failing.test.ts`), `apps/dashboard/src/i18n/alert-messages.ts` (`ALERT_MESSAGES`
  and `ALERT_WORDS`, `:455`), `scripts/ongoing-alert-codes.test.ts`,
  `apps/server/src/append-only-watch.ts` (`:78-118`), `append-only-watch.test.ts`,
  `clock-watch.ts` (`:50-467`), `clock-watch.test.ts`, `free-space-watch.ts` (`:62-130`),
  `free-space-watch.test.ts`, `cloud-worker.ts`, `cloud-worker.test.ts`,
  `content-suggestion-runner.ts` (`:183-229`), `content-suggestion-runner.test.ts`,
  `demo-printer.ts` (`:205-233`), `demo-printer.test.ts`, `boot.ts` (`:2508-2512`, `:2957-2979`,
  `:3030-3046`, `:3047` alert sources, `:3564-3577`, `:3799-3826`, `:3864-3870`, `:3909-3925`),
  `background-duties.ts`, `background-duties.test.ts`, `handover-stepdown.test.ts`

## Size

| Hand-written | Lines |
| --- | --- |
| Code: alert source 35, wording (message + 20 word pairs) 95, guard 15, six job adapters 170, clock-watch halt 15, `boot.ts` 60, `background-duties.ts` 15 | **~405** |
| Tests: alert source 70, guard 10, re-pointed watch suites 300, stepdown and duties 30 | **~410** |
| Total | **~815** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/append-only-watch.test.ts src/clock-watch.test.ts src/clock-watch.start-up.test.ts src/free-space-watch.test.ts src/cloud-worker.test.ts src/content-suggestion-runner.test.ts src/demo-printer.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/start-full-disk.e2e.test.ts` — passes, `Tests` count printed.
2. `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts` from the root — passes.
3. `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` — passes.
4. Typecheck, format clean; protection list EQUAL.

## Expected protection-list difference

**EQUAL.** Any line is a stop.

## Stop points (beyond rules §5)

1. A re-pointed watch test needs a changed assertion. The only timing changes this plan makes on
   purpose: the practice printer wakes on `print_jobs` (its 500 ms poll goes), and the Cloud
   connection and suggestions back off on the runner. Any other changed assertion is a stop.
2. The tamper watch's refusal (`refuseTrading`, `append-only-watch.ts:61-76`) would run more than
   once, or not at all, for one fault.

## Needs

jr1, jr2.

## Global Constraints

- A watch that keeps running at a stepdown (tamper, free space) keeps its signal until the close
  (jr1 catalogue); the others stop at the signal.
- Alert wording never sends a person to somebody else (CLAUDE.md §3, refusals; owner, "no support
  path"); it says what happens and that the box keeps trying.
- Every timer value keeps today's number: tamper 10 s (`APPEND_ONLY_CHECK_MS`), clock 15 s
  (`CLOCK_WATCH_MS`), free space 60 s (`FREE_SPACE_CHECK_MS`), Cloud 60 s (`cloud-worker.ts:36`),
  suggestions 5 s / 60 s with back-off 5 s to 60 s (`content-suggestion-runner.ts:25-28`).
- Every first check keeps its delay: tamper, clock one interval after start; free space at once.

## Review Focus

1. **A job failing on and off** (fails twice, succeeds, fails twice). No alert: the run of failures
   restarts. Task 1's "a success in between clears the count".
2. **The box restarting while a job is failing.** The alert's `since` restarts with the process;
   that is accepted (the view lives in memory), and the wording claims nothing about how long.
3. **A `job.failing` for a name the dashboard has no words for.** The word list's `otherwise`
   entry ("one of its background tasks") is used. Task 1's guard makes that unreachable for catalogue names.
4. **The clock watch stopped by a stepdown mid-check.** Its own "stopped" flag must be set before
   the abort returns, as today's `stop()` sets it first (`handover-stepdown.test.ts:265-282`).
5. **Many print jobs written at once on a practice box.** One wake, one pass that delivers them all
   (`PULL_BATCH_LIMIT`, `demo-printer.ts:180-203`), not one pass per job.

---

### Task 1: The `job.failing` alert and its wording

**Interfaces:**
- Produces: `jobFailingAlertSource(deps: { views: () => Readonly<Record<string, JobView>>; now: () => Date }): AlertSource`
  in `alert-sources.ts`; `JOB_FAILING_MIN_FAILURES = 3`, `JOB_FAILING_MIN_MS = 600_000`.
  The alert: `{ key: \`job.failing:${name}\`, code: "job.failing", params: { job: name }, severity, since: view.failingSince, screen: "box-status" }`.
- Wording (`ALERT_MESSAGES["job.failing"]`), exact copy:
  - en: "The box keeps failing at {job:job_name}. It keeps trying by itself, and sales continue."
  - es: "El equipo sigue fallando en {job:job_name}. Lo sigue intentando por sí solo y las ventas continúan."
- `ALERT_WORDS.job_name` (lowercase, read inside the sentence), exact copy:

| Name | en | es |
| --- | --- | --- |
| `fiscal.drain` | sending invoices to the tax agency | el envío de facturas a la Agencia Tributaria |
| `payments.reconcile` | checking card payouts | la comprobación de los abonos de tarjeta |
| `card.follow_up` | following up card payments and refunds | el seguimiento de pagos y devoluciones con tarjeta |
| `attendance.end_of_day` | closing staff working days | el cierre de las jornadas del personal |
| `mail.send` | sending emails | el envío de correos |
| `fiscal.certificate_reminders` | reminders about the tax certificate | los avisos sobre el certificado digital |
| `box.alert_mail` | alert emails to managers | los correos de aviso a los responsables |
| `menu.activation` | putting scheduled menus live | la publicación de las cartas programadas |
| `fiscal.tamper_watch` | checking the invoice record's protections | la comprobación de las protecciones del registro de facturas |
| `clock.watch` | checking the box's clock | la comprobación del reloj del equipo |
| `storage.free_space` | checking disk space | la comprobación del espacio en disco |
| `backups.scheduled` | scheduled backups | las copias de seguridad programadas |
| `backups.sealed_state` | saving the box's locked keys with its data | el guardado de las claves cifradas del equipo con sus datos |
| `stream` | the bucket copy | la copia en el bucket |
| `cloud.connection` | the connection to Waitron Cloud | la conexión con Waitron Cloud |
| `housekeeping` | the daily tidy-up | la limpieza diaria |
| `cloud.suggestions` | translation suggestions from Waitron Cloud | las sugerencias de traducción de Waitron Cloud |
| `demo.printer` | the practice printer | la impresora de prácticas |
| `tunnel` | the remote-access tunnel | el túnel de acceso remoto |
| `fiscal.reconciliation` | checking what the tax agency holds | la comprobación de lo que tiene la Agencia Tributaria |
| `otherwise` | one of its background tasks | una de sus tareas de fondo |

- [ ] **Step 1: Failing tests** (`alert-sources.test.ts`, fixed `now`, hand-built views):
  `"raises nothing for a job that failed twice"`; `"raises nothing for three failures inside ten minutes"`;
  `"raises one warning for a reported job failing three times over ten minutes, since its first failure"`;
  `"raises an error for a judged job"`; `"raises nothing for a job with its own failure alert"`;
  `"raises nothing for a run of degraded passes with no throw"` (`lastErrorCode: null`);
  `"a success in between clears the count"` (a view with `consecutiveFailures: 0` after failures);
  `"one alert per job, keyed by the job's name"`.
  `scripts/ongoing-alert-codes.test.ts`: add `"every job in the catalogue has words"` — imports
  `JOB_NAMES` (`apps/server/src/job-catalogue.ts`) and `ALERT_WORDS`; every name is a key of
  `ALERT_WORDS.job_name.words` with `en` and `es`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; push `jobFailingAlertSource({ views: () => jobRunner.views(), now })`
  onto `serverAlertSources` (`boot.ts:3047`). **Step 4: Run** — PASS. Commit: "Raise one alert for a background job that keeps failing".

### Task 2: The tamper watch and the free-space watch

**Interfaces:**
- `tamperWatchJob(deps: { db: Database; tables: readonly string[]; intervalMs: number; refuse: (faults: Faults) => Promise<void> }): JobDefinition` —
  name `fiscal.tamper_watch`; `applies: () => true`; `firstPassAfterMs = minSleepMs = maxSleepMs = intervalMs`;
  `backoff { firstMs: intervalMs, maxMs: intervalMs }` (a read that throws is checked again next
  interval, `:100-103`, and keeps logging `append_only.check_failed` before rethrowing); `pass`:
  faults found → `await deps.refuse(faults)`, return `{ nextDueAt: null, finished: true }`; none →
  `{ nextDueAt: null }`. `startAppendOnlyWatch` is deleted; `assertAppendOnlyIntact`,
  `missingBeforeMigration` and `refuseTrading` stay.
- `freeSpaceJob(deps: <startFreeSpaceWatch's deps minus timer and intervalMs> & { intervalMs: number }): JobDefinition` —
  name `storage.free_space`; `applies: () => true`; first pass at once; `minSleepMs = maxSleepMs = intervalMs`;
  `pass`: today's `read()` (`:79-95`) with `ctx.signal` handed to `freeOldBackups` in place of the
  watch's own `stopping` signal, and every `stopped` check reading `ctx.signal.aborted`; it never
  throws (its own catches log, as today), so `backoff` is `{ firstMs: intervalMs, maxMs: intervalMs }`.
  `startFreeSpaceWatch` is deleted.

- [ ] **Step 1: Re-point** `append-only-watch.test.ts:119-190` and `free-space-watch.test.ts:191-500`
  onto a runner with fake timers. Assertions unchanged. "stop()" cases become `stopJobs()` cases;
  "stop() aborts the deletion step's signal and answers once the step has finished" (`:459`) keeps
  its assertion, the signal now being the job's.
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Run the tamper and free-space watches on the job runner".

### Task 3: The clock watch

**Interfaces:**
- `startClockWatch` becomes `createClockWatch(deps)` (same deps minus `intervalMs`), returning
  `{ stepComing, reanchor, check(): Promise<void>, halt(): void }`. `check` is today's `check`
  (`:285-437`); `halt()` sets `stopped = true` and does nothing else; the self-re-arming
  `scheduled`/`armed` (`:438-449`) and `stop()` (`:461-465`) go.
- `clockWatchJob(watch: ClockWatch, intervalMs: number): JobDefinition` — name `clock.watch`;
  `applies: () => true`; `firstPassAfterMs = minSleepMs = maxSleepMs = intervalMs`; `backoff` both
  `intervalMs` (today a throw is logged and the next check armed, `:439-443`); on its first pass it
  adds `ctx.signal.addEventListener("abort", () => watch.halt(), { once: true })`, so the stop flag is
  set inside `signalStepdown()` before it returns.
- `correction.addAnchor(clockWatch)` (`boot.ts:3046`) keeps the watch object.

- [ ] **Step 1: Re-point `clock-watch.test.ts`** (and `clock-watch.start-up.test.ts` if it starts the
  watch) onto the job; assertions unchanged. Add `"aborting the job's signal halts the watch before the abort returns"`.
  In `handover-stepdown.test.ts`, drop `clock-watch.ts` from the five-files text check (`:268-274`)
  and `clockWatch` from `AT_STEPDOWN`.
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Run the clock watch on the job runner".

### Task 4: The Cloud connection, suggestions and the practice printer

**Interfaces:**
- `cloudConnectionJob(options: Omit<Parameters<typeof runCloudWorker>[0], "signal" | "sleep">): JobDefinition` —
  name `cloud.connection`; added only when `cloudConnection` exists; `applies: () => true`;
  `pass`: today's loop body (`cloud-worker.ts:15-32`) with `ctx.signal`; `onError` keeps logging
  `cloud.refresh_failed`, then the pass rethrows; `min = max = 60_000`; `backoff` both `60_000`.
  `onStaffCertificate` (`boot.ts:3806-3818`) reads the job's signal through a `signal` argument
  passed to it, in place of `cloudController.signal`. `runCloudWorker` is deleted.
- `suggestionsJob(runner: ContentSuggestionRunner, isPrimary: () => boolean): JobDefinition` —
  name `cloud.suggestions`; `applies: isPrimary` (the same `cloudPrimary` the runner was built with,
  `boot.ts:3286-3290`); `pass`: `step(ctx.signal)` → `"again"` gives `nextDueAt: now`, `"wait"`
  now + 5 s, `"idle"` now + 60 s; `minSleepMs: 0`; `maxSleepMs: 60_000`; `backoff { firstMs: 5_000, maxMs: 60_000 }`;
  `onError` keeps logging `content.suggestion_runner_failed`. `mountContentSuggestionsApi`'s `wake`
  becomes `() => jobRunner.wake("cloud.suggestions")`. The runner's own `run` and `wake` go; `step` stays.
- `demoPrinterJob(db: Database, identity: DemoPrinterIdentity, log: Logger): JobDefinition` — name
  `demo.printer`; `applies: () => true`; `wakeOn: ["print_jobs"]`; `minSleepMs: 500` (no faster
  than today's poll); `maxSleepMs: 60_000` (the safety net); `backoff { firstMs: 500, maxMs: 60_000 }`;
  `pass`: `deliverDemoPrinterJobs` and logs `demo_printer.delivery_failed` before rethrowing a
  failure. `startDemoPrinterLoop` is deleted.

- [ ] **Step 1: Re-point** `cloud-worker.test.ts`, `content-suggestion-runner.test.ts` (its `run`
  cases) and `demo-printer.test.ts` (its loop cases) onto jobs. Add
  `"a print job written on a practice box is delivered within a second, with no poll"` (fake timers:
  emit a `print_jobs` change; the pass runs at once, held to the 500 ms floor) and
  `"many print jobs written together are delivered in one pass"`. In `handover-stepdown.test.ts`,
  drop `demo-printer.ts` from the five-files text check and `demoPrinterLoop` from `AT_STEPDOWN`.
- [ ] **Step 2: Wire boot and the duties.** Each `jobRunner.add` sits where today's start was. In
  `background-duties.ts` remove `appendOnlyWatch`, `freeSpaceWatch`, `clockWatch`, `cloudWorker`,
  `suggestionLoop`, `demoPrinterLoop`; keep `cloudController` (Cloud snapshots still use it until
  jr10). `stopWork`'s first item (`boot.ts:3914-3922`) becomes
  `async () => { try { await jobRunner.stopJobs(); } finally { await staffListener?.close(); } }`
  (the runner's `stopJobs` is idempotent, so `stopBackgroundDuties` calling it again is harmless),
  keeping today's order: the Cloud connection stops before the staff listener closes.
- [ ] **Step 3–4:** Run the Finish line — PASS. `rg -n "startAppendOnlyWatch|startFreeSpaceWatch|startClockWatch|runCloudWorker|startDemoPrinterLoop" apps packages docs`
  finds nothing but history. Commit: "Run the Cloud connection, suggestions and the practice printer on the job runner".
