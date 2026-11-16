# Bucket pointer and stop implementation plan

Claude initial and corrections reads completed; watcher cleared this smaller route on 2026-11-16 at 15:52 CET (Lane J questions.md). No owner approval is claimed. Request: `BUCKET-POINTER-AND-STOP`, `/Users/clintongormley/waitron-campaign-j/queue.md:64`. Source reading only; no reproduction or tests run during drafting.

**Finish line:** recover a deleted `current.json` after either 412 or request-failed 404 without overwriting a competitor; explain failed recreation accurately; remove the Cloud snapshot wait from ahead of the stream stop while retaining database teardown safety.

1. **Pointer recovery.** Change `packages/stream/src/supervisor.ts`, using `pointer.ts` only if the existing byte helpers need exporting. Reuse `writePointer`, `SentPointers`, cancellation and retry waits; leave shared `putOwnBytes` semantics unchanged. A conditional refusal or `backup.stream_request_failed` with operation `put`, status 404 triggers a reread. Only a successful read answering absent proves absence, never the write's 404. Exact bytes of this proposed pointer mean success; exact bytes previously sent by this box require retry against their version, not success for an old generation. Other existing bytes mean `pointer_changed`. If absent after a replace, retry as create-only in the same generation. If that create is refused by 412/put-404 and still absent, stop as `pointer_missing`; an initial create followed by this same result stops directly. Failed reads stay retryable without repeating a refused create. On other create failures, reread before retrying: recognise this write, refuse competitors, otherwise retry conditionally with existing waits. Never trust node id alone or reset the refusal allowance on ordinary retries.

2. **Words and action.** In `apps/dashboard/src/screens/stream-settings-panel.ts` and `apps/dashboard/src/i18n/strings.ts`, give `pointer_missing` EN/ES status text explaining that the copy pointer disappeared and could not be recreated. Reuse existing `backup.stream_stopped` and its bucket/standby recovery actions; do not diagnose permissions from 412/404. The panel already shows that alert beside unknown refused reasons, and `apps/server/src/stream-api.ts:290` permits their existing restart action. No new alert, error code or guide addition.

3. **Small shutdown change.** Move only `cloudSnapshots` after `jobRunnerServices` in `apps/server/src/background-duties.ts`; retain every abort, stepdown mark, other ordering constraint and awaited result. The actual stream stop is `streamService` registered in `boot.ts:3630`, through `job-runner.ts`'s `stopServices`, not the scheduled `BackupSupervisor`. Reuse that path. Cloud remains awaited before database closure: `boot.ts:989` (`makeStartedServer`) awaits `stopWork`, listeners and requests before pools; `boot.ts:4738` adds job/staff waits before the duty table. Update the ordering explanations in `background-duties.ts` and `job-catalogue.ts` accurately. Keep `close-all.ts`, `run-server.ts`'s eight seconds and Litestream's 4500ms/5000ms limits unchanged.

   Cloud's remaining pass reads the database and writes its own state files, so it may finish after the stream stops, but must finish before pools close. **Watcher decision:** accept this Cloud-specific improvement rather than an unconditional 4.5-second reservation? From shutdown start, earlier waits must finish within 3.5 seconds: running jobs including scheduled backups, the archive supervisor, sending loop and pending services can still consume it. Never skip writers or close their database underneath them. Retain that narrower backlog limit.

4. **TDD and ownership.** Before implementation, observe each new regression fail, then pass:

   - Stream: `packages/stream/src/supervisor.test.ts` owns 412/404 recovery, persistent absence/initial create, competitor, failed-reread and uncertain-create outcomes; retain own-late-write and lost-answer checks. Run `pointer.test.ts` and `supervisor.cancel.test.ts` unchanged for sibling behavior.
   - Server: adjust the two existing order checks in `apps/server/src/background-duties.test.ts`, retaining sender-before-stream assertions; add one fake-time regression with Cloud held and a stream service taking 4500ms, finishing before 8000ms. Use existing recording handles and the real runner service path. Assert `stopBackgroundDuties` stays pending until Cloud is released. Retain `handover-stepdown.test.ts`; adjust `job-catalogue.test.ts` wording checks. Leave `run-server*` unchanged.
   - Presentation: `apps/server/src/alert-sources.test.ts` pins only the existing stopped alert for `pointer_missing`; `apps/dashboard/src/screens/stream-settings-panel.test.ts` pins specific EN/ES status, recovery words and actionable restart.

Run those focused suites; normal push hook/current-head CI and concurrency review follow. Record changed pointer/order checks in PR “Changed test checks”. Delete the completed pointer backlog entry, narrow the shutdown bullet and its bundle/index in `docs/backlog/box.md` and `docs/backlog.md`. Leave level-0 growth and status-400 work untouched. No records, migrations, frameworks or unrelated cleanup.

**Estimate:** production +65–100/−20–35 lines; tests +200–290/−25–45; documentation +15–25/−20–30.

_2026-11-16 build review: a refused write followed by the unchanged original version is retried
with the existing wait. Its presence alone does not establish that another box wrote._

_2026-11-16 at 16:12 CET: the watcher chose the reviewer's smaller route. Remove the extra
uncertain-create reread and exact-current-byte success check; the existing write helper continues
to recognise a landed write on its conditional retry. Keep the unchanged-version correction above._
