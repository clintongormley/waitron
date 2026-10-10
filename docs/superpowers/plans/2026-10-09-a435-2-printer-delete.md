# A435 step 2: Printer Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Owner authorised autonomous execution and review; no approval pause at handoff. The campaign controller owns campaign state, publication and landing.

**Goal:** Add permanent Delete beside printer Disable, end its live work, clear its settings and retain history, with a reusable impact contract and confirmation dialog.

**Architecture:** Keep the printer row with `deleted_at`; guard live operations while leaving history joins unfiltered. A server-owned printer ruleset supplies both the impact read and the deletion transaction. Put the browser-safe contract in `@waitron/shared` and the presentation-only dialog in `@waitron/ui`; neither imports a server, database or dashboard app.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest with real venue databases and Chromium, Playwright/axe.

**Spec:** [Approved delete/archive design](../specs/2026-10-08-delete-and-archive-design.md), only Build order step 2 and the shared pieces it requires.

## Global Constraints

- “Deletion is a permanent deleted state, not row removal.”
- “Disable stays beside Delete for hardware only”: retain printer Disable and Enable behaviour for records whose `deleted_at` is null.
- “A deleted record cannot be enabled, edited or brought back.” Live operations naming a deleted printer answer `printer.not_found`.
- “The delete recomputes the same impact inside ONE `withTransaction` and acts on it.” Never trust the displayed counts as execution input.
- “No fiscal, sales or hash-chained table is touched, and no history column loses its database link.” No weakened assertions, goldens, guards, exclusions or coverage/mutation bars.
- “This can't be undone.” appears in the shared dialog; refusals, ended work and removed settings appear in that order.
- All implementation/test code follows failing-test-first TDD. Read the TDD skill before code. Catch expected rejected writes outside `withTransaction`; await statements in a transaction in order.
- Each task is one reviewable deliverable, expected well below 100 tool calls. Stop at a failed assertion, repair its cause, and keep independent existing assertions. Signed-off task commits only; no bypassed hooks.

## Review Focus

1. A receipt's authenticated late invoice report must not turn a deletion-ended job back into `done`; test latest and superseded generations in Task 2.
2. A printer used only as a profile's cash-drawer default must be named in impact and disappear from that role after deletion; test implicit devices as well as explicit choices in Task 3.
3. A deleted USB/Bluetooth registration followed by a new registration of the same key must not be overwritten by an old worker report; test distinct ids and old/new jobs in Tasks 2 and 5.
4. A stale form can resubmit a deleted printer without changing its stored choice/list; test unchanged-value and empty-patch bypasses in Task 4.
5. An impact request finishing after close/reopen or another printer's request must not enable deletion of the wrong printer; test request generations and native focus in Tasks 6–7.

## Scope, starting point and ordering

Inventory below was **read, not runtime verified**, at `3c8ca2012aaab8ad7b8a25e675c61ba9efb40041` (A435-1, #1464). `git log -6 --oneline` and `git show --stat HEAD` identify the landed product archive change; the settled archive check is `packages/catalogue/src/operations.ts:1128`. Do not repeat A435-1 tests or alter its product dialogs. Its `docs/developers/design-system.md:3206` onwards is current product guidance.

The spec's **Shared model** distributes `deleted_at` among three hardware kinds, while **Build order** assigns each its own plan/PR. Interpret step 2's “`deleted_at` and the narrower uniqueness rules on hardware” as establishing the pattern **on printers only**. Do not add reader/device columns or keys, implement their refusals/unpair/revoke paths, or implement steps 3–6. Clear their existing printer settings as dependencies of deleting a printer. `page_printers` is the separate A4 table (`packages/db/src/schema/page-printers.ts:10`, `invoice-deliveries.ts:40`); this design's printer inventory names `printers`, `print_jobs`, receipt deliveries and ESC/POS hardware. Leave A4 deletion/identity/transport unchanged; document that scope, rather than quietly widening this PR.

**Execution prerequisite supplied by controller:** A366-3A is parked with venue-service migrations 0035/0036. Planning may proceed now; implementation migration generation cannot begin until it lands. Rebase/reorient the implementation worktree after that landing before Task 1. No other overlap creates a wait: owner waived waits based solely on shared files. A366-5A may remove watchers; A366-2 evolves hours. Re-run the inventory against then-current main, omit genuinely retired paths, and transfer their assertions to their replacement. Do not invent watcher-retirement or hours work in this branch.

Shared-file overlap: `apps/server/src/{management-api,device-api,device-equipment,print-api,kitchen-print}.ts`, `packages/layouts/src/{device-equipment,device-printers,device-profile-store}.ts`, `packages/venue-service/src/dashboard/{prep-stations-screen,live-queries,routing-client}.ts`, core migrations, dashboard API/i18n, design-system and backlog. Review the full base-to-tip paths after rebases, not just conflict hunks. Implementation agents use separate worktrees or take turns; no concurrent edits/tests in one checkout. Record spawned process ids; stop only those processes.

## Read inventory and required dispositions

Each citation below describes the inspected starting code, not a measured outcome. Every listed path is in scope for inspection; tasks specify changes. A retained historical name must come from the old row even if a new printer takes its physical key or name.

| Starting code and receipt | Required disposition / task |
| --- | --- |
| `packages/db/src/schema/printers.ts:28–67`: id, location, name, four transports, local key, host/port, poll id/hash, ticket scope, paper settings, drawer/portable and active; only physical uniqueness is `(location_id, local_key)` where key is non-null | Nullable `deletedAt` via `tsString`; partial index also requires null deletion. No new name/host/poll-id unique rule: none is declared here. T1 |
| `packages/db/src/schema/devices.ts:39–53`: receipt, payment-slip and drawer choices reference printers with RESTRICT | Clear matching columns independently, including inactive devices; leave all other device fields. T3 |
| `packages/db/src/schema/device-profile-printers.ts:7–41`: three roles, position, per-role default; printer FK RESTRICT | Remove matching role rows/defaults, leave surviving order/defaults; name profiles per role. T3 |
| `packages/db/src/schema/station-printers.ts:11–27`, `watchers.ts:73–85`: station/watcher printer links; `printer-holders.ts:15–25`: cascade holder FKs | Remove links, release holder, name stations/watchers/holding device. No parent hard delete or reliance on cascading. T3 |
| `packages/db/src/schema/print-jobs.ts:43–79`: printer FK, payload, kind, receipt facts, status/attempts/error, lease, resend and sale links | End only live jobs; retain ids, bytes, history and links. T2–3 |
| `packages/db/src/schema/drawer-opens.ts:27`, `packages/db/src/schema/receipt-reprints.ts:23–29` and `apps/server/src/orders-list.ts:826–836`: drawer audit and reprint history, reprints join jobs then printers | Preserve audit/reprints; retain history joins, old name and settings. T3, T5 |
| SQL: `packages/db/drizzle/0055_drop_printer_character_set.sql:28–32` rebuild/index; `0090_devices_lose_till.sql:21–22`, `0114_device_equipment.sql:5–12`, `0115_profile_drawer_role.sql:10–19`, `0000_baseline.sql:335–347`, `0088_history_origin_drop_till.sql:49` name incoming printer FKs | Cross-check current schema and all SQL; do not edit shipped files. RESTRICT/NO ACTION children can refuse a rebuild; holders can cascade away. T1 |
| `packages/db/src/classification.ts:29,82–83,102–113,130–144,233`: printers, holders, settings, jobs/deliveries classified state, drawer audit ledger, jobs emit related printer changes | Keep classifications and change sources; no new local table or local credentials. T1, T5 |
| `packages/db/src/configuration-transfer.ts:45–61`: printers reconnect, omit poll hash; settings exported, holders/jobs/drawer audit not listed. `apps/server/src/configuration-transfer.ts:240–309,680–719`: FK-based left-behind propagation, id/location remap, imported printers disabled | Exclude deletion rows with `leaveBehindWhenSet: "deleted_at"`; retain omission/remapping, active and disabled undeleted exports. No imported resurrection or dangling settings. T5 |
| `packages/store/src/archive.ts:9–24`, `apps/server/src/cloud-snapshot-archive.ts:32`, `restore.ts:45–62`: whole database archive/restore | Tombstones and historical rows stay in whole-database snapshots. Test actual archive readback; no record filtering in archive/restore. T5 |
| `packages/composition/src/modules.ts:93–100,119–133`, `packages/db/src/migrations.ts:16–19`: core owns printer storage; venue-service already requires core/catalogue | Migration stays core. Server coordinates core settings; do not add printing→venue-service or printing→layouts dependency. No changed migration dependency required absent new SQL targets. T1, T3 |
| `packages/printing/src/printers.ts:58–90,132–172,176–196`: create, empty-patch lookup, update/deactivate by id, list includes disabled | Null-deletion predicates on all live reads/writes, including no-op writes; list retains disabled only. T1, T4 |
| `packages/printing/src/outbox.ts:45–64,68–95`: active-only enqueue, resend eligibility is kind/status/attempts, resend returns to original printer | Reject deleted ids; deletion reason disables resend, and deleted target disables resend even for old completed jobs. T2, T5 |
| `packages/printing/src/runtime.ts:63–133,145–199,211–227`: queued/retryable failed/expired-printing claim, active printers; BT terminal paths; ordinary results require printing + same agent | End **all** printing claims regardless of age/agent, plus queued and failed under cap. Exclude deletion in raw SQL and BT updates; old results become no-ops. T2 |
| `apps/server/src/print-api.ts:402–413,558–636`: manager gate uses `printer.manage`, pull updates BT state, claims invoice jobs, result reports through invoice adapter | Impact/delete share edit gate. Filter BT physical-key updates to undeleted rows so tombstones remain immutable. T2–4 |
| `apps/server/src/invoice-print.ts:57–119,122–165`; `invoice-delivery.ts:255–320`: invoice receipts claim together with token; deactivate ends queued/claimed deliveries as failed/unknown; authenticated unknown latest success can update job to done | Separate deletion ending: failed/unknown delivery as today, permanently failed print job with deletion reason; no deletion state restoration by late token, expiry or generic report. Preserve nondeleted late-report cases. T2 |
| `packages/print-agent/src/agent.ts:184–208,543`, `client.ts:236–274,451`: resolve/send each pulled payload serially, then real HTTP result; `apps/print-agent/src/linux-devices.ts:223–247`: network target or USB/BT key resolution | Test real agent/client + local resolution. No deletion/cancel message exists in this read path; do not promise recall of buffered/sent bytes. T2, T5 |
| `apps/server/src/demo-printer.ts:31–57,89–161,172–180`: physical-key boot match/enable, profile/station setup, invoice-aware drain | Skip tombstones on demo match; newly recreated demo gets new id. Preserve practice-only routing. T4–5 |
| `apps/server/src/print-api.ts:800–858`: discovery matches all rows by local key or host and effective port (`null`→9100). `printers-screen.ts:1251–1264,1303–1323`: disabled match Enables same id | Exclude deleted on server; client stale matches cannot Enable deleted, refreshed discovery offers Add/new id. Keep disabled same-id Enable. T5, T7 |
| `packages/layouts/src/device-printers.ts:58–126`, `device-equipment.ts:98–184,282–310,426–440,528–547`; server `management-api.ts:658–678`, `device-api.ts:658–664`, `device-equipment.ts:324–348` | Prevent stale saved/unchanged deleted ids and portable no-op bypasses; preserve existing binding/held refusals for undeleted wrong-profile hardware. T4 |
| `apps/server/src/station-printers.ts:23–103`, `watchers.ts:286–350`: attach/replace/detach, existing-list skip optimisations, active-printer checks | Validate deleted ids even when retained in posted list; explicit printer-by-id list/detach is not_found when deleted. Disabled links remain detachable. T4 |
| `apps/server/src/receipt-print.ts:103–122`, `apps/server/src/orders-reprint.ts:24–33`, `apps/server/src/orders-api.ts:167–175`, `apps/server/src/report-api.ts:225,376–419`, `apps/server/src/receipt-preview-api.ts:148–150`: active-only print choice/layout reads; `till-api.ts:2141–2148`: resolved drawer | Explicit deleted id prints fail not_found; implicit cleared drawer may answer existing drawer.no_printer or use remaining default. Do not break sale/fire without output. T4–5 |
| `apps/server/src/kitchen-print.ts:115–164,1428–1433`, `station-outputs-down.ts:48–68`, `alert-sources.ts:290–305`, `print-job-trouble.ts:65–73` | Live routing and disabled-inclusive reprint target reads exclude deleted; history/problem joins remain intact. Deleted intentional failures do not raise actionable waiting alerts. T5 |
| `apps/server/src/print-api.ts:1178–1223,1248–1254`, `printers-screen.ts:1833–1835,3008–3055`: jobs expose printer id; screen resolves name from live printer list; preview joins retained printer | Add history `printerName` to job wire rows; prevent UUID fallback after hiding tombstone. Preserve bounded history and previews. T5, T7 |
| `apps/server/src/receipt-print.ts:341–369` projects original print status without lastError; `till-api.ts:2037–2055` uses canRetry; `apps/till/src/screens/till-ticket-view.ts:701,743–745` says automatic retry when failed + not manually retryable | Include deletion reason/retained printer availability in original-status projection; deleted is permanent, never shown as automatic retry. Keep ordinary disabled/retry states and completed handover history. T2, T5, T7 |
| `apps/server/src/invoice-email-worker.ts:48–81` runs shared expiry before email claim; `invoice-delivery.ts:325–355` creates email retry generations after updated reports; `invoice-choice-delivery.ts:118–131` stages email/A4 | Apply deletion fence only to linked receipt jobs/printers. Email/A4 continue and designation/history queries remain unfiltered. T2 |
| `apps/server/src/till-sale.ts:841–844`, `bill-payments.ts:1090–1106`, `device.ts:119–121`: sale/payment paths call receipt/drawer lookup; device snapshot copies choices | T4–5 guard the shared lookup and clear choices, preserving cash/card/profile permission and replay assertions; no sales/payment changes. T5 |
| `apps/server/src/station-health.ts:180`, `packages/venue-service/src/dashboard/station-health-table.ts:116–128`, `apps/till/src/screens/till-station-screen.ts:609–614`: station-down projections display supplied printer names. Till `widgets/equipment-dialog.ts:21–28` submits receipt/slip/drawer roles via shared equipment contract (`apps/till/src/api/client.ts:1404`) | Retire deleted live problems through shared server reads; stale till choices fail not_found. Keep rendered/history names supplied by server. T4–5 |
| `apps/print-agent/src/usb.ts:28–51`, `network.ts:4`, `packages/print-agent/src/host.ts:120–139`, `transport.ts:126–129`: physical listing/host contract and transport recording have no database registration lifecycle | Server matching owns deleted-vs-disabled identity. Keep hardware discovery/transport independent of database and test USB/BT/network resolution through T2/5. |
| `apps/dashboard/src/api/live-queries.ts:61–63,82,324`, `packages/venue-service/src/dashboard/live-queries.ts:12–32`, `routing-client.ts:154–183` | Wire impact dependencies to every table read; updated core lists flow into venue dashboard. Do not introduce unknown stream resources. T7 |

**Read-path limit:** No cloud-poll printer job route was found by `rg -n 'cloud_poll|pollToken' apps/server/src` outside fixtures during this inventory. Keep that transport's required fields and poll hash omission; do not build the old cloud-poll specs' unimplemented endpoints. Audit again if main has gained them.

## Interfaces and file boundaries

Create `packages/shared/src/delete-impact.ts`, export through `packages/shared/src/index.ts`. It contains data types only, reusable by later kinds, without importing a kind's registry:

```ts
export type DeleteTarget = { id: string; name: string };
export type DeleteImpactItem = {
  key: string;
  count: number;
  targets: DeleteTarget[];
};
export type DeleteImpactRefusal = {
  code: string;
  params: Record<string, string | number>;
  targets: DeleteTarget[];
};
export type DeleteImpact = {
  target: DeleteTarget;
  refusals: DeleteImpactRefusal[];
  ends: DeleteImpactItem[];
  removes: DeleteImpactItem[];
};
```

Printer item keys are fixed here: ends `print_jobs`, `invoice_receipts`, `portable_holder`; removes `device_receipt`, `device_payment_slip`, `device_cash_drawer`, `profile_receipt`, `profile_payment_slip`, `profile_cash_drawer`, `profile_receipt_default`, `profile_payment_slip_default`, `profile_cash_drawer_default`, `device_receipt_default`, `device_payment_slip_default`, `device_cash_drawer_default`, `station_printers`, `watcher_printers`. Counts count distinct affected rows for that item; names deduplicate by id within that item and sort by name/id. Profile-default items are explanatory subsets of role rows, **not additional deletions**. Device-choice items name only devices whose column is cleared. The three `device_*_default` items name/count devices of that profile/location currently resolving to the removed default, with unchanged null choice columns; they are explanatory effects, not additional writes. Each item contains one owner kind, so copy distinguishes profiles losing defaults, devices losing inherited defaults and devices losing explicit choices without guessing from ids. Surviving defaults are unchanged; removing a default leaves None, never silently picks another.

Create `apps/server/src/printer-delete.ts`. It owns cross-table rules and cleanup, accepts the caller's `Transaction`, and imports shared types, core tables, printing terminal helper and invoice adapter. It never opens a transaction. Produce:

```ts
readPrinterDeleteImpact(tx: Transaction, cfg: PrintConfig, id: string): Promise<DeleteImpact>
deletePrinter(tx: Transaction, cfg: PrintConfig, id: string, now?: Date): Promise<DeleteImpact>
```

Internally `printerDeleteRules(tx, cfg, id)` returns `{ impact, jobIds, invoiceJobIds }`; both exports call this exact function. All printer targets require null `deletedAt`; deleted/missing by-id yields `printer.not_found`. Printer `refusals` is empty by approved design; do not invent payment, holder or printing refusals. Later kinds reuse the contract/dialog and the recompute-within-transaction shape, not a fabricated generic printer refusal framework.

Create `packages/printing/src/printer-delete-jobs.ts` and export via `index.ts`:

```ts
export const PRINTER_DELETED = "printer.deleted";
readPrinterDeleteJobIds(tx: Transaction, printerId: string): Promise<string[]>
endDeletedPrinterJobs(tx: Transaction, printerId: string): Promise<string[]>
```

Both printing functions use one private `printerDeleteJobPredicate(printerId: string): SQL`; the impact rules call the read function, and the update uses the same predicate. The transaction prevents another writer changing the selected set between them.

Produce `endDeletedInvoicePrintDeliveries(tx: Transaction, jobIds: string[], now?: Date): Promise<void>` in server `invoice-print.ts`. Keep `endDeactivatedInvoicePrintDeliveries` and its existing call sites for Disable. _(2026-10-10: removed in the review fixes; the delete calls `endInvoicePrintDeliveries`.)_

Create `packages/ui/src/components/wt-delete-dialog.ts`, export `WtDeleteDialog` and `DeleteDialogCopy` via `packages/ui/src/index.ts`:

```ts
export type DeleteDialogCopy = {
  heading: string; refusals: string; ends: string; removes: string;
  irreversible: string; cancel: string; confirm: string; retry: string;
  loading: string;
  item: (item: DeleteImpactItem) => string;
  refusal: (item: DeleteImpactRefusal) => string;
};
// WtDeleteDialog public properties:
// open: boolean; impact: DeleteImpact | null; loading: boolean;
// submitting: boolean; readError: string; actionError: string;
// copy: DeleteDialogCopy; opener: HTMLElement | null (default null).
// Events: wt-delete-confirm / wt-delete-retry / wt-close,
// detail { id: string } on confirm, detail {} on retry/close,
// bubbles:true, composed:true. No HTTP or application translations inside UI.
```

Presentation uses `wt-modal size="compact"`, `wt-form-actions` and native focus support. Both dashboard app and venue-service already have UI dependencies (`packages/venue-service/package.json:35–38`, UI's shared dependency `packages/ui/package.json:18–21`). No new package, dependency cycle or venue module import. Future venue kinds supply their own copy and API handlers.

## Tasks

### Task 1: Printer tombstone and physical-key storage contract

**Deliverable:** Generated core schema change plus live printer CRUD recognising deletion, with disabled behaviour retained.

**Files:** Modify `packages/db/src/schema/printers.ts`, `packages/printing/src/printers.ts`, `packages/shared/src/index.ts`; create `packages/shared/src/delete-impact.ts`. Test `packages/db/src/schema/printing.test.ts`, `packages/printing/src/printers.test.ts`. Generated additions only in `packages/db/drizzle/` (SQL, new snapshot and `_journal.json` entries chosen by generator); inspect `packages/db/src/{classification,migrations}.ts`, `packages/migrations/migrations.manifest.json` without changing ownership/append-only lists.

**Interfaces:** Produces `printers.deletedAt: string | null`, shared types above and CRUD live predicates. Existing CRUD signatures stay unchanged; `listPrinters` contains undeleted active **and disabled** rows only.

- [ ] Add RED assertions using existing `setup`, `seedPrinter`, `asTx` fixtures in `printers.test.ts`. Explicitly seed deletion independently of active, so an active-only implementation fails:

```ts
it("deleted printer refuses empty patch and Enable, disabled can Enable", async () => {
  const cfg = await setup();
  const id = await seedPrinter(cfg);
  await asTx(cfg, tx => tx.update(printers)
    .set({ deletedAt: "2026-10-09T10:00:00.000Z", active: true })
    .where(eq(printers.id, id)));
  for (const patch of [{}, { active: true }, { name: "Renamed" }]) {
    await expect(asTx(cfg, tx => updatePrinter(tx, cfg, id, patch)))
      .rejects.toMatchObject({ code: "printer.not_found" });
  }
  expect(await asTx(cfg, tx => listPrinters(tx, cfg))).toEqual([]);
  const disabled = await seedPrinter(cfg, "Disabled control");
  await asTx(cfg, tx => deactivatePrinter(tx, cfg, disabled));
  await asTx(cfg, tx => updatePrinter(tx, cfg, disabled, { active: true }));
  expect((await asTx(cfg, tx => listPrinters(tx, cfg))).map(p => p.id)).toEqual([disabled]);
});
```

  In schema suite, for USB and Bluetooth, insert a disabled undeleted key twice and assert UNIQUE refusal; mark first deleted and insert same name/key at a new id; assert two retained rows and old FK child still names first. Keep null-key network duplicates and existing CHECK assertions. Add deletedAt null-default/readback column assertion; no schema guard skip.
- [ ] RED: `pnpm --filter @waitron/printing test src/printers.test.ts` and `pnpm --filter @waitron/db test src/schema/printing.test.ts` separately; missing column/predicate/new duplicate allowance must fail for the expected reason. Start the schema RED with raw pragma rather than a typed new field:

```ts
const result = await suite.db.execute<{ name: string }>(sql`
  select name from pragma_table_info('printers')`);
expect(result.rows.map(r => r.name)).toContain("deleted_at");
```

  It executes on the starting schema and fails that assertion. Add typed readback/reuse assertions as the minimal column exists; import/type failure alone is not a behavioural RED.
- [ ] After A366-3A prerequisite, implement `deletedAt: tsString("deleted_at")`, index predicate `local_key is not null and deleted_at is null`. No deleted-active CHECK: read guards test it independently and avoiding a new CHECK avoids deliberately requesting a rebuild. Add `isNull(printers.deletedAt)` to CRUD existence/update/deactivate/list predicates; inactive rows retain edit/Enable behaviour.

```ts
const liveId = and(eq(printers.id, id), isNull(printers.deletedAt));
// Use liveId for both empty-patch existence and the update/deactivate WHERE.
// Partial index:
uniqueIndex("printers_local_key_key").on(t.locationId, t.localKey)
  .where(sql`${t.localKey} is not null and ${t.deletedAt} is null`);
```

- [ ] Generate: `pnpm --filter @waitron/db db:generate --name printer_delete`. Do not predict numeric filenames or hand-edit generated SQL/snapshots. Inspect emitted ADD/index operations. If any table rebuild appears, inventory incoming FKs with `rg -n 'REFERENCES .*printers|foreignColumns: \[printers.id\]|references\(\(\) => printers.id' packages` and seeded `pragma_foreign_key_list`, including holder CASCADE and device/profile RESTRICT. Run upgrade with populated children. If a CHECK/type change is actually needed, generate column separately before rebuild, obey expression-index split, and re-run guards. Decide/reset requirement from actual SQL and upgrade result, record it in commit/PR; **no “safe/no reset” claim in advance**.
- [ ] GREEN: rerun both RED commands, then `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts scripts/module-graph-honesty.test.ts scripts/two-file-foreign-keys.test.ts scripts/classification-complete.test.ts scripts/workspace-cycles.test.ts`. Read tests counts and exit statuses. Compare shipped SQL byte diff to base: existing files must be unchanged. If regeneration follows rebase also run `pnpm --filter @waitron/fiscal-verifactu test src/inmutabilidad.test.ts`. Commit with `git commit -s` after task review.

### Task 2: Permanently end print jobs and fence late workers

**Deliverable:** One terminal reason and exhaustive worker tests; ordinary Disable/unpair/lease/late invoice reporting retains its assertions.

**Files:** Create `packages/printing/src/{printer-delete-jobs.ts,runtime.delete.test.ts}`; modify `packages/printing/src/{runtime,outbox,errors,index}.ts`, test `outbox.test.ts`. Modify `apps/server/src/{invoice-print,invoice-delivery,print-api}.ts`; extend `invoice-print-api.test.ts`, `invoice-delivery.test.ts`, `print-agent-e2e.test.ts`. Inspect `packages/print-agent/src/{agent,client}.ts`, `apps/print-agent/src/linux-devices.ts`; keep protocol/transport database-free.

**Interfaces:** Produces `readPrinterDeleteJobIds` and `endDeletedPrinterJobs` with the exact signatures above; `canResendPrintJob` adds optional `lastError?: string | null` so existing kind/status/attempt cases keep working, but deletion reason is false. Historical target availability is checked by server projection/insert too.

- [ ] RED: seed queued, printing with fresh/expired/null lease and another agent, retryable failed attempts 0/4, exhausted failed attempts 5, done; document **and drawer** kinds. Save complete rows. End them and assert exact affected ids, not a count alone: all queued/printing/retryable failed become `{status:"failed", attempts:5, lastError:"printer.deleted"}`, others byte-for-byte equal. Use `createPrinter`, `enqueuePrintJob`, real `useVenueDb({migrations:[CORE_MIGRATIONS]})`, seeded print-agent FKs, deterministic canonical claim times. Match assertions with the following terminal SQL, including more than `PULL_BATCH_LIMIT` jobs:

```ts
function printerDeleteJobPredicate(printerId: string): SQL {
  return sql`printer_id = ${printerId} and (
    status in ('queued', 'printing') or
    (status = 'failed' and attempts < ${MAX_DELIVERY_ATTEMPTS}))`;
}
export async function readPrinterDeleteJobIds(tx: Transaction, printerId: string): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`
    select id from print_jobs where ${printerDeleteJobPredicate(printerId)}`);
  return result.rows.map(row => row.id);
}
export async function endDeletedPrinterJobs(tx: Transaction, printerId: string): Promise<string[]> {
  const ended = await tx.execute<{ id: string }>(sql`
    update print_jobs set status = 'failed', attempts = ${MAX_DELIVERY_ATTEMPTS},
      last_error = ${PRINTER_DELETED}
    where ${printerDeleteJobPredicate(printerId)} returning id`);
  return ended.rows.map(row => row.id);
}
```

  Import `sql`/`SQL` from Drizzle, `Transaction` from db and `MAX_DELIVERY_ATTEMPTS` from `./runtime.js`; define `PRINTER_DELETED` in this new file. Leave claim identity/time intact as historical facts; never stamp a fake agent. Assert ordinary/unknown/other-agent late results return `{updated:false}` and cannot overwrite reason/time/attempts. A live second printer's job is claimed/reported normally. With old row deleted and new same-key row active, pulls return only new id's jobs; old reports touch neither.
- [ ] In existing invoice fixtures, claim receipt through real pull, capture token, end deletion, then report done/failed with valid/invalid/duplicate tokens before and after a newer receipt/email generation. Assert old job remains terminal with deletion reason; queued delivery failed, sending delivery unknown, never claimable. Preserve authenticated late **metadata** (`reportedOutcome`, `reportedAt`, `reportedFailureCode`) on the unknown delivery if valid, but do not change its terminal state/reason or the old print job. Sent deliveries unchanged. Keep deactivation/unpair late-success tests (`invoice-print-api.test.ts:885,1103`) independent and still passing. No blanket “unknown cannot finish” guard. For receipt reservation and direct `claimInvoiceDelivery`, test retained-printer deletion even with a test-seeded queued/printing job; preserve missing-job receipt_invalid and nondeleted replay behavior. Reservation explicitly targeting a deleted printer answers printer.not_found before request-key replay; claim returns undefined with no token/state writes.
- [ ] RED commands: `pnpm --filter @waitron/printing test src/runtime.delete.test.ts src/outbox.test.ts`; `pnpm --filter @waitron/server test src/invoice-print-api.test.ts src/invoice-delivery.test.ts src/print-agent-e2e.test.ts src/invoice-email.test.ts`. Run separately, retain expected failure output.
- [ ] Implement terminal helper, register `printer.deleted` in printing errors (Record<string,never>); explicit null-deletion in claim SQL and BT unprintable/unpaired update paths, and server BT by-key deactivation. Return false from resend eligibility for deletion reason; direct resend to any deleted original target answers `printer.not_found` before eligibility mutation/reservation, with zero new rows.

  Add undeleted-printer checks to receipt reservation/claim, without filtering historical designation queries. Add deletion invoice adapter instead of calling Disable adapter after ending jobs (it would overwrite reason). Capture correlated queued/sending receipt delivery job ids **before** mutation, including inconsistent live delivery on an already finished/exhausted job. End those live deliveries, but leave finished/exhausted jobs exactly as they were. Adapter uses failed for queued / unknown + expiredAt for sending, compatible `transport_failed` delivery reason; live jobs ended by deletion hold `printer.deleted`. In `reportInvoiceDelivery`, authenticate the claim first, then join the retained linked printer: a non-null `deletedAt` (or job deletion marker) permits late metadata only. Return `{updated:false,historical}` with the existing newer-generation calculation (`invoice-delivery.ts:275–285`); never update state/job or create a retry. Gate expiry's job update by undeleted printer and non-deletion marker too. Include the inconsistent finished-job case to prove the printer guard works without rewriting history. Keep nondeleted expiry/latest/superseded reporting unchanged.
- [ ] Before T3 exists, the T2 fixture performs helper ending plus printer timestamp/off write in one transaction; the full DELETE HTTP regression belongs to T5. Expand real agent/client E2E: pause transport completion with a promise after pull, delete in another completed transaction, release success/failure, observe HTTP result and saved terminal job. Then next tick claims no old work. Exercise `createLinuxDevices.resolve` USB/BT/network through injected hardware listings and actual client, and a second printer control. This pins **database cancellation**, not physical byte recall: the inspected agent sends already-held payloads (`agent.ts:543`); no new cancel protocol/kill switch is promised.
- [ ] GREEN: rerun RED commands; also `pnpm --filter @waitron/printing test src/runtime.active.test.ts src/runtime.reclaim.test.ts src/runtime.race.test.ts src/runtime.unpaired.test.ts src/runtime.unprintable.test.ts` and `pnpm --filter @waitron/server test src/print-api.unpair-kitchen.test.ts`. Deletion control: in a throwaway candidate checkout remove the deletion-only invoice branch, run new late-success case and see old job become done; remove terminal predicate and see exact-id assertion fail. Legitimate controls remain green. Record controls, restore only disposable edits, commit `-s` after review.

### Task 3: Recomputed impact and atomic server deletion

**Deliverable:** Manager-authorised impact/delete API with complete named cleanup and rollback evidence.

**Files:** Create `apps/server/src/printer-delete.ts`, `printer-delete.db.test.ts`; modify `apps/server/src/print-api.ts`; extend `print-api.test.ts`, `print-api.printer-wiring.test.ts`. Use existing full migration/manager fixtures in wiring suite; no cross-package fixture imports causing cycles.

**Interfaces:** Uses T1–2 types/helpers. `GET /management-api/printers/:id/delete-impact` returns DeleteImpact; `DELETE /management-api/printers/:id` returns the recomputed DeleteImpact (200). No body, version hash or expected-count parameter. Both use existing `gated(sessionId, fn, "printer.manage")`; deleted/missing target → 404 `printer.not_found`, malformed uuid → existing 400, unauthenticated/unpermitted → existing session/permission code and no writes.

- [ ] RED fixture: printer P (portable/drawer), printer Q control; device label “Handheld Ana” explicitly chooses P for receipt/slip/drawer; inactive device chooses P; device “Bar till” inherits P defaults; profile “Waiters” lists P in three roles with defaults, and Q surviving nondefault/default in a distinct role/profile. Station “Grill” and watcher “Pass” in separate link cases (writer forbids station+watcher jointly). Holder names Ana's device. Live jobs/deliveries from T2; finished job, drawer audit, receipt reprint and unrelated rows. Impact must name each id/label/profile/role; include zero-ref printer and disabled printer deletable, `refusals:[]`. Capture all tables before impact: no product/config writes, apart from existing `withTransaction` change-log draining (`packages/db/src/tenancy.ts:14–17,35–40`).
- [ ] Assert count agreement when state unchanged; add new job/holder/settings between GET and DELETE and assert DELETE returns/reconciles current impact and cleans **both** old/new work. If another worker completes a job first, it stays completed and is excluded from ended count. If delete commits first, old report is no-op (T2). Concurrent DELETE calls give one success, one not_found; second clears/writes nothing. No fabricated printer blocker: future refusal display is tested in T6; revalidation failures here are missing target and permission loss between read/action.
- [ ] Assert after delete: P row retained with canonical now and active false; matching choices null, profile rows/defaults gone, station/watcher links gone, holder gone. Only matching columns changed; unrelated default Q, order of surviving rows, other holder/settings/jobs, all sales, fiscal records, order/time chain heads, audits/reprints and kitchen job/line links exactly match pre-delete rows. Inactive setting owners are cleaned too.
- [ ] RED: `pnpm --filter @waitron/server test src/printer-delete.db.test.ts src/print-api.printer-wiring.test.ts src/print-api.test.ts`.
- [ ] Implement ruleset and writer; its jobs selector calls `readPrinterDeleteJobIds`. Use joins to obtain names and no `Promise.all` in tx. Include affected default devices by profile/location in impact without changing their otherwise-null choices. No promotion of a remaining printer to default, no acquire of another portable holder. Execution order:

```ts
export async function deletePrinter(tx: Transaction, cfg: PrintConfig, id: string,
  now = new Date()): Promise<DeleteImpact> {
  const rules = await printerDeleteRules(tx, cfg, id);
  await endDeletedPrinterJobs(tx, id);
  await endDeletedInvoicePrintDeliveries(tx, rules.invoiceJobIds, now);
  for (const column of [devices.receiptPrinterId, devices.paymentSlipPrinterId,
    devices.cashDrawerPrinterId]) {
    const property = column === devices.receiptPrinterId ? "receiptPrinterId"
      : column === devices.paymentSlipPrinterId ? "paymentSlipPrinterId" : "cashDrawerPrinterId";
    await tx.update(devices).set({ [property]: null }).where(eq(column, id));
  }
  await tx.delete(deviceProfilePrinters).where(eq(deviceProfilePrinters.printerId, id));
  await tx.delete(stationPrinters).where(eq(stationPrinters.printerId, id));
  await tx.delete(watcherPrinters).where(eq(watcherPrinters.printerId, id));
  await tx.delete(printerHolders).where(eq(printerHolders.printerId, id));
  await tx.update(printers).set({ active: false, deletedAt: now.toISOString() })
    .where(and(eq(printers.id, id), isNull(printers.deletedAt)));
  return rules.impact;
}
```

  `rules.jobIds` contains only queued/printing/retryable-failed jobs; `rules.invoiceJobIds` covers every linked receipt delivery still queued/sending, even if its linked job is already finished. The ended-jobs count is the former, the ended-deliveries count the latter, each deduplicated by row id. Do not change finished/exhausted print jobs to mark the delivery ended. T2's retained-printer guard fences their late tokens too. Reader and writer use the same selectors, never a UI-derived id list.
- [ ] Rollback test: in test DB install a temporary BEFORE UPDATE printers trigger for P that `RAISE(ABORT,'test_delete_failure')` when deleted_at becomes non-null, call **whole** withTransaction deletion and catch outside; assert all job/delivery/choice/link/holder rows exactly equal before and no published changes. Drop trigger in finally. Route denial/malformed/deleted-id assertions compare complete rows and no new queue/audit/resend rows. Legitimate disabled-target deletion succeeds; Disable alone keeps ordinary waiting jobs/settings/holder and allows same-id Enable.
- [ ] GREEN: rerun RED and `pnpm --filter @waitron/server test src/station-printers.test.ts src/watchers.test.ts src/device-equipment.test.ts`. Control in disposable checkout: omit cashDrawer column clear and profile drawer default row deletion separately; each corresponding DB assertion fails. Review/commit `-s`.

### Task 4: Close every live by-id writer and stale-draft bypass

**Deliverable:** A deleted id cannot be edited, enabled, assigned, calibrated, used for a print/drawer or re-held, even through unchanged inputs; disabled legitimate operations retain their behavior.

**Files:** Modify `packages/layouts/src/{device-printers,device-equipment}.ts`, `apps/server/src/{management-api,device-api,device-equipment,station-printers,watchers,print-api,demo-printer}.ts`. Inspect `packages/layouts/src/device-profile-store.ts` call sites. Extend `packages/layouts/src/{device-printers.db,device-equipment.db}.test.ts`, `apps/server/src/{management-api.device-profiles,device-equipment-api,station-printers,watchers,print-api,print-api.printer-wiring,demo-printer}.test.ts`.

**Interfaces:** Existing layout/route signatures retained. Explicit printer choice/assignment can throw existing `printer.not_found` for a deleted id after caller's authorisation; normal undeleted wrong-profile/disabled equipment retains `device.binding_invalid`/held behavior. Import `@waitron/printing` at layouts throwing sites to reach its existing registry through `packages/printing/src/index.ts`; layouts already declares that dependency (`packages/layouts/package.json:17`), so add no dependency or duplicate registry. Keep existing selection-result signatures for undeleted refusals; deletion throws `AppError("printer.not_found", {id})` before those paths. Server throwing sites import the owning registry too.

- [ ] RED table-driven API cases for P after T3 deletion: PATCH `{}`, `{active:true}`, `{active:false}`, rename/connection/paper/drawer/portable (unchanged portable included); deactivate; watcher set/null; station attach/detach/by-printer list; test-print, print-test-page, sample-receipt, test-drawer, original resend. Assert exact code and no writes/audit/job. Profile create/edit/stale saved lists in all three roles/defaults, station/watch replacement carrying P already stored, device choices resubmitted unchanged, direct portable setter no-op, scan/list/manage holder/takeover. For body references assert status 400 with `printer.not_found`, target path 404, adapting route boundary rather than global status map.
- [ ] Add control cases before deletion: disabled printer edit/Enable and detachable links, wrong-profile undeleted choice's existing code, fixed/portable ownership, cash-drawer not held. A stale device PATCH with P then Q must roll back all changed fields on refusal. Stale profile save compares profile/lists/device choices/holders; no partial rewrite. After cleanup, “default” choice and clearing a link with no deleted target remain allowed.
- [ ] RED: `pnpm --filter @waitron/layouts test src/device-printers.db.test.ts src/device-equipment.db.test.ts`; `pnpm --filter @waitron/server test src/management-api.device-profiles.test.ts src/device-equipment-api.test.ts src/station-printers.test.ts src/watchers.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/demo-printer.test.ts`.
- [ ] Add null-deletion predicates and validation **before** equality/empty/current-list fast paths. Profile-list storage must reject deleted ids on all roles, not only newly-added drawer items; server body check too. Device choice validation precedes `printerId === current[role]` skip. `setPrinterPortable` looks up undeleted target and refuses rather than silently returning for missing/deleted. Printer-target detach/list checks deletion while disabled detach remains permitted. Direct test/manual enqueue is guarded by T1–2; stale calibration and watcher updates must reach not_found before mutation. Do not reuse a live-only guard in history joins.

```ts
// Explicit selection guard, before no-change/role checks; preserve missing/disabled
// choice's existing binding refusal unless the target row is actually deleted.
const [target] = await tx.select({ deletedAt: printers.deletedAt }).from(printers)
  .where(eq(printers.id, selection.id));
if (target?.deletedAt != null) throw new AppError("printer.not_found", { id: selection.id });
```

- [ ] GREEN same commands. Remove one equality-bypass guard in disposable candidate and run the stale unchanged selection case: expect printer.not_found assertion to fail; direct active undeleted control still succeeds. Keep all existing takeover, binding, drawer permissions and unsaved/save-state assertions. Commit `-s` after review.

### Task 5: Discovery, live readers, retained history and transfers

**Deliverable:** Deleted hardware disappears from live surfaces and matches, is addable with a new id, while reports/history/archives still retain its old name and facts.

**Files:** Modify `apps/server/src/{print-api,orders-api,orders-reprint,receipt-print,receipt-preview-api,report-api,kitchen-print,station-outputs-down,alert-sources,demo-printer}.ts` only where live readers need guards/history projection; `packages/layouts/src/device-equipment.ts`, `packages/db/src/configuration-transfer.ts`, `apps/dashboard/src/api/client.ts`. Inspect `apps/server/src/{orders-list,print-job-trouble,configuration-transfer,device-equipment,till-api}.ts`, `packages/fiscal-verifactu/src/privileges.expected.ts:82` (do not expand history delete privileges), `packages/store/src/archive.ts`. Extend `apps/server/src/{print-api,orders-api,orders-list,orders-reprint,report-api,receipt-print,kitchen-print,print-problems,configuration-transfer,demo-printer}.test.ts`, `packages/db/src/configuration-transfer.test.ts`, `apps/server/src/print-agent-e2e.test.ts`. Create `apps/server/src/printer-delete-history.test.ts` for cross-path/archive checks with its own `useVenueDb` resource and existing server fixture factories. Extend `apps/till/src/widgets/equipment-dialog.test.ts` for a stale selected id refused/refreshed without a held or selected ghost; preserve its independent permission/error assertions. Inspect `apps/till/src/screens/till-station-screen.test.ts` and `packages/venue-service/src/dashboard/station-health-table.test.ts` for live output-name cases, extending only stale printer fixtures.

**Interfaces:** `PrintJobRow` gains required `printerName: string` from retained printer join. `canResend` returned by jobs API also requires original printer undeleted; keep its existing disabled-printer value, since Disable is unchanged. No deleted column sent in live list. `OriginalReceiptPrint` keeps its existing union and gains optional `failureCode?: "printer.deleted"` on the queued/printing/failed/done arm, emitted only for failed jobs whose retained target is deleted or error is the deletion marker; all undeleted exact wire bodies stay unchanged. Transfer declaration gains `leaveBehindWhenSet: "deleted_at"`, keeps `poll_token_hash` omitted. Use existing export/import pipeline, no new import version/compatibility code.

- [ ] RED discovery for USB serial, upper-cased Bluetooth MAC (existing `storedLocalKey` normalisation), network host with 9100 explicit/null default, and same host different port: disabled undeleted yields same printerId and Enable; deleted yields `alreadyRegistered:false, printerId:null`; new create returns different id; active replacement matches itself. Two active undeleted local keys still refuse duplicate; network duplicates retain current permissive schema. After replacement, stale pull/unpair/report cannot mutate tombstone or transfer old jobs to new id.
- [ ] RED historical receipt reprint with distinguishable old printer “Old kitchen” and replacement “New kitchen”: order detail old copy names Old kitchen; old job preview retains original payload and paper settings; bounded jobs API names old printer without live registration; no resend action for deleted original target. New receipt copy on another active chosen printer succeeds and adds correct reprint audit without filing sale again or a drawer kick. Finished/dead-end old jobs, drawer audits and kitchen-print link rows remain equal. Active history joins still work when tombstone has `active:false`.
- [ ] RED live reads: list active/disabled/all omits deleted; equipment snapshots/defaults/choices exclude P; report/order/reprint and receipt-layout picker excludes it; direct print names it → not_found with no new job/audit. Implicit receipt/drawer defaults resolved after clearing do not resurrect it and keep normal no-printer/fallback semantics. Kitchen fire/correction/HOLD/reprint continue with Q or no output; disabled-inclusive reprint-target/problem query excludes P. Deleted ended jobs no longer raise active waiting/station-down alerts; historical incident records stay. Original receipt status reads still show completed/handover facts, but `canRetry` is false for a deleted target and `failureCode:"printer.deleted"` explains a failed job permanently. Project lastError and join the retained printer without filtering the jobs out; keep done-original priority. Test the till receipt/retry route refuses without new job/delivery/audit; preserve nondeleted automatic retry/manual retry and confirmed handover assertions.
- [ ] RED configuration fixture exported through real exporter: active and disabled undeleted printers retained with absent poll hash; deleted printer and FK-linked profile/station/watcher rows absent, no holders/jobs/audits transferred, location/id remapped, imported undeleted hardware disabled/reconnectable. Malicious current bundle with a deleted printer plus setting targeting it is rejected atomically **before** insert (`setup.request_invalid`, field `printers.deleted_at`) since exporter never emits these rows. Compare before/after tables and staging outputs. Full archive via `db.archiveTo` outside tx, reopened through real venue opener, retains deleted timestamp, terminal jobs, names and historical FKs; `foreign_key_check` empty. No local/poll credentials enter config export.
- [ ] RED: `pnpm --filter @waitron/server test src/print-api.test.ts src/orders-list.test.ts src/orders-reprint.test.ts src/report-api.test.ts src/receipt-print.test.ts src/kitchen-print.test.ts src/print-problems.test.ts src/configuration-transfer.test.ts src/demo-printer.test.ts src/printer-delete-history.test.ts`; `pnpm --filter @waitron/db test src/configuration-transfer.test.ts`.
- [ ] Apply guards to live predicates from inventory, including `switchedOffToo` branch and demo match. Keep disabled inclusion, sale history and preview joins separate. Job history projection:

```ts
// In jobs list query, join retained printer without active/deleted filters.
printerName: printers.name
// In JSON projection (select deletedAt under a private alias):
canResend: printerDeletedAt === null && canResendPrintJob({ ...job, kind })
```

  Transfer declaration:

```ts
{ name: "printers", locationColumns: ["location_id"],
  omit: ["poll_token_hash"], reconnect: true, leaveBehindWhenSet: "deleted_at" }
```

  Add core configuration validation refusing supplied non-null `deleted_at` rows (null/absent valid). Existing archived product transfer is unchanged. Update fixtures expecting printer object columns only for new projected history name/null default, never erase byte/audit assertions.
- [ ] Real HTTP regression: extend `print-agent-e2e.test.ts` to serve its mounted Hono app on a loopback listener using existing `@hono/node-server` and one `freePorts(n)` draw for HTTP + hardware sink before either bind; use real client `fetch`, not app.request/fake client for this case. In `finally` close recorded listeners/agent and await close; no detached process. Assert create→impact→new queued work→delete→pull/late result→history→discover/create replacement over HTTP and DB. Keep its existing app.request cases too. Add successful undeleted agent send and disabled re-enable controls.
- [ ] GREEN same commands plus `pnpm --filter @waitron/till test src/widgets/equipment-dialog.test.ts` and `pnpm --filter @waitron/server test src/print-agent-e2e.test.ts src/invoice-print-api.test.ts src/till-api.receipt.test.ts src/till-api.reprint.test.ts src/till-api.print-problems.test.ts`. Control in disposable checkout: remove history name join → names assertion fails; remove deleted discovery predicate → new-id discovery assertion fails; remove transfer exclusion → exported tombstone assertion fails. Commit `-s` after review.

### Task 6: Shared browser-safe deletion dialog

**Deliverable:** Reusable token-styled confirmation primitive usable from both dashboard homes, including refusals for future kinds.

**Files:** Create `packages/ui/src/components/{wt-delete-dialog.ts,wt-delete-dialog.test.ts,wt-delete-dialog.a11y.test.ts}`; modify `packages/ui/src/index.ts`, `docs/developers/design-system.md`. Types from `packages/shared/src/delete-impact.ts`; use existing UI token/a11y helpers. No dashboard-kit→UI dependency, no application import into UI.

**Interfaces:** Properties/events/copy contract above. Parent owns requests and lifecycle generation; UI guards confirm against null/loading/refusals/submitting/readError itself; actionError alone does not disable it. Refusal is server data; textual request error alone does not permanently disable retry.

- [ ] RED browser fixture impact target Printer P, one refusal `{code:"reader.payment_in_progress",params:{},targets:[{id:"pay-1",name:"Payment 1"}]}` (fixture for **generic UI**, not a printer rule); ends 3 jobs and a holder; removes named profile/station/device. Assert DOM refusal group precedes ends precedes removes, irreversible sentence, all escaped names including `<script>`/long names, no empty headings for empty groups, loading/read-error no confirm, refusal confirm secondary+disabled, ready confirm danger, in-flight confirm keeps danger+loading and emits once. Use native button/inner dialog assertions, not host flags.

```ts
const confirm = el.shadowRoot!.querySelector<WtButton>('[data-test="delete-confirm"]')!;
expect(confirm.variant).toBe("secondary");
expect(confirm.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
el.impact = { ...el.impact!, refusals: [] };
await el.updateComplete;
expect(confirm.variant).toBe("danger");
confirm.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
expect(seen).toEqual([{ id: "printer-p" }]);
```

  `el` is the mounted `WtDeleteDialog`, `seen` records `wt-delete-confirm.detail`, using imports from `./wt-button.js` and UI test helpers. Add Cancel focus at initial native show, Escape closes, single composed events with source stopped, restored opener and detached-opener fallback. Busy native close cannot detach a pending request. No staged input means no draft scope needed; any form later introduced needs one and `.unsaved.test.ts`.
- [ ] RED: `pnpm --filter @waitron/ui test src/components/wt-delete-dialog.test.ts src/components/wt-delete-dialog.a11y.test.ts`.
- [ ] Implement render with token-only styling. Required enable condition:

```ts
const ready = this.impact !== null && !this.loading && this.readError === ""
  && this.impact.refusals.length === 0;
const variant = this.submitting || ready ? "danger" : "secondary";
const disabled = this.submitting || !ready;
```

  Footer `wt-form-actions.error` holds action/read error on its own line above controls; read loading status in body, refusal list is content rather than a top form-error summary. Retry available for failed impact read; success recovery clears only read error. Parent can refresh impact after action refusal without hiding it. Prevent confirm in handler too, stop source event then re-emit `wt-delete-confirm` with detail. Cancel/Retry secondary while unavailable; bind opener to inner modal.
- [ ] Token painting case sets host `--wt-space-3`, `--wt-color-text-muted`/danger and reads computed body/list style. Axe for open-ready, open-refused, loading, read failure, action failure, submitting, empty impact and closed, both themes. Native keyboard focus tests use real keypress, no timer-blocked animation frames. Import smoke from venue dashboard entry establishes UI available there without importing apps.
- [ ] GREEN RED command, `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/dashboard-browser-purity.test.ts scripts/style-token-names.test.ts scripts/native-form-fields.test.ts`; `pnpm --filter @waitron/ui test src/no-hardcoded-chrome.test.ts`. Disposable deletion control removes handler refusal check; dispatching `new MouseEvent("click", {bubbles:true, composed:true})` directly on the confirm host in the refused fixture fails the expected no-event assertion, while ready confirm control passes. Commit `-s` after review.

### Task 7: Printer UI, translation and live races

**Deliverable:** Delete on active/disabled printer rows/details, shared confirmation, correct history names, and responsive recovery from races.

**Files:** Modify `apps/dashboard/src/screens/printers-screen.ts`, `api/{client,live-queries}.ts`, `i18n/{strings,codes}.ts`; modify `apps/till/src/{api/client.ts,screens/till-ticket-view.ts,i18n/codes.ts}` and extend `apps/till/src/{screens/till-ticket-view.test.ts,i18n/codes.test.ts}`; create `apps/dashboard/src/widgets/printer-delete-copy.ts`. Extend `apps/dashboard/src/{api/live-queries.test.ts,screens/printers-screen.test.ts,screens/printers-screen.a11y.test.ts,screens/printers-screen.save-state.test.ts}` and existing `printer-{name,inline,calibration,address,pair}.unsaved.test.ts` only if deletion teardown changes their expectations. Inspect/retain `printer-agent.unsaved.test.ts` independently; deletion never revokes an agent. Extend `packages/venue-service/src/dashboard/prep-stations-screen.test.ts` for stale printer selections; also run `prep-stations-screen.printers-unsaved.test.ts` and `prep-stations-screen.settings-unsaved.test.ts` unmodified or with additional independent assertions. Its production screen changes only if refresh handling needs it. Update `docs/developers/{conventions-ui,design-system}.md`, `docs/backlog.md` with controller at landing; inspect `apps/till/src/{api/client.ts,widgets/equipment-dialog.ts,screens/till-station-screen.ts}` and preserve their equipment error rendering.

**Interfaces:** Consumes T5's history name and `OriginalReceiptPrint.failureCode` projection. Dashboard API adds `getPrinterDeleteImpact(id):Promise<DeleteImpact>` (GET, passive background refresh) and `deletePrinter(id):Promise<DeleteImpact>` (DELETE, active request). Copy adapter `printerDeleteCopy():DeleteDialogCopy` translates each fixed item key, role/default distinction and named targets. `PrintJobRow.printerName` displayed directly, no lookup solely through live list.

- [ ] RED native browser cases: Delete beside Disable/Enable for appropriate rows/detail, Delete includes disabled printer; no Delete on print-agent/A4 surfaces in this scope. Loading impact has quiet disabled confirm; ready has danger; double click sends one DELETE. Named drawer defaults/device inheritance visible; counts same as fixture response. Show deletion-ended job reason and old name even absent from printer list; resend hidden. Active/Disabled/All all hide deleted. Disabled rediscovery enables same id; deleted rediscovery Adds/new id. Label printing/test/calibration can't keep deleted target open.
- [ ] Deferred promises control: open P, close, open Q before P read resolves; Q starts immediately, P result/finally cannot clear Q gate/error or enable P action. Reopen P while its earlier request pending starts new generation. Live deletion by another tab invalidates status/detail/wizard/label and URL id through existing draft leave/forced teardown policy. Fresh live discovery wins over an older manual read. Successful DELETE closes first, disposes affected scopes and then refreshes; refresh failure shows read error and never leaves a second Delete available. Failed DELETE keeps dialog, action error, usable Retry; a later successful impact refresh clears only read error. Not-found closes stale target with visible refusal; no cross-target result applied.
- [ ] RED: `pnpm --filter @waitron/dashboard test src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts src/screens/printers-screen.save-state.test.ts src/api/live-queries.test.ts`; `pnpm --filter @waitron/venue-service test src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.printers-unsaved.test.ts src/dashboard/prep-stations-screen.settings-unsaved.test.ts`.
- [ ] Implement parent request generation/own in-flight state, separated read/action errors and handler busy guard. Use shared `wt-delete-dialog`; no `window.confirm`. For an already open dirty printer editor, existing leave coordinator decides discard/cancel before selecting Delete; successful external removal forces teardown, never saves into tombstone. Existing quiet save, calibration re-add cancellation and disabled Enable controls stay unchanged. Define API methods:

```ts
getPrinterDeleteImpact(id: string): Promise<DeleteImpact> {
  return this.#request(`/management-api/printers/${id}/delete-impact`, "GET");
}
deletePrinter(id: string): Promise<DeleteImpact> {
  return this.#request(`/management-api/printers/${id}`, "DELETE");
}
```

  Impact query depends on `printers`, `print_jobs`, `invoice_deliveries`, `printer_holders`, `devices`, `device_profiles`, `device_profile_printers`, `kitchen_stations`, `station_printers`, `watchers`, `watcher_printers`; read dependencies include names and implicit defaults. Keep automatic reads passive, mutations active. Include all in live query guard fixture and server stream resource inventory, using existing classified sources; if watchers retired reorient to replacements first.
- [ ] EN/ES copy includes: “Delete printer?” / “¿Eliminar la impresora?”, “This can't be undone.” / “Esta acción no se puede deshacer.”, “Work that will end” / “Trabajo que finalizará”, “Settings that will be removed” / “Configuración que se eliminará”, “Delete” / “Eliminar”, named receipt/payment-slip/cash-drawer roles and defaults, holder release, count of jobs (drawer jobs included) and receipt deliveries. Code `printer.deleted`: “The printer was deleted, so this job will not be retried.” / “La impresora se eliminó, por lo que no se volverá a intentar este trabajo.” Add refusal heading/retry/loading copy through supplied copy; no raw key/count lists or only UUIDs. Names are text, not HTML. Add both printer.deleted and existing printer.not_found wording in till codes; ticket view tests both locales with failureCode, no automatic retry claim, no retry button, and keep existing failed-but-retryable/automatic-retry cases. Render deletion message with `codeMessage("printer.deleted")` before the failed/!canRetry automatic-retry branch (`apps/till/src/screens/till-ticket-view.ts:701`). Restore test language after each case.
- [ ] GREEN RED commands; `pnpm --filter @waitron/till test src/screens/till-ticket-view.test.ts src/screens/till-ticket-view.a11y.test.ts src/i18n/codes.test.ts`; `pnpm --filter @waitron/dashboard test src/screens/printer-name.unsaved.test.ts src/screens/printer-inline.unsaved.test.ts src/screens/printer-calibration.unsaved.test.ts src/screens/printer-address.unsaved.test.ts src/screens/printer-pair.unsaved.test.ts`; preserve these independent assertions. Axe/loading/race cases plus keyboard focus. Verify actual EN/ES light/dark at desktop1280 and phone390 (T8); no viewport host-width assumptions. Commit `-s` after review.

### Task 8: Whole-branch review, documented receipts and controller landing

**Deliverable:** Full reviewed step 2 branch with normal push hook, current-head CI and visual receipts; controller lands under shared main.lock, using existing authorisation.

**Files:** Audit entire base-to-tip changed path set, plus prose under `CLAUDE.md`, `README.md`, `docs/developers/{conventions-ui,design-system,writing-claims,testing-guide}.md`, historical print specs/plans listed below, `docs/backlog.md`, `docs/backlog/printers.md`. Record execution receipts externally in controller's A435-2 receipt directory; no campaign state edits by task agents.

- [ ] Read final diff and repeat global printer reference search against current schema **and SQL**: `rg -n 'printers|printer_id|printerId|printerHolders|receiptPrinterId|paymentSlipPrinterId|cashDrawerPrinterId' packages apps -g '*.ts' -g '*.sql' -g '!**/node_modules/**'`. Classify every read/write as live/settings/history/discovery/transfer/local transport; compare with this inventory and account for additions. Inspect changed fixtures/guards/goldens: no weakening or silently abandoned assertions. Claims need run receipts or narrowed read labels.
- [ ] Update current prose: conventions-ui reactivation rule now says disabled same id, deleted new id; design-system defines Delete as permanent retained state while keeping Disable words; printing/schema comments stating “never delete” distinguish Disable from Delete and prune redundant narrative. Audit root README with `rg -n -i 'printer|print job|disable|enable|delete|resend' README.md`; change only actual stale statements. Historical `docs/superpowers/specs/{2026-08-17-printing-cloud-poll-transport-design,2026-08-17-printing-epson-server-direct-print-design,2026-08-26-failover-printing-design,2026-10-01-dashboard-orders-design,2026-10-03-invoice-pdf-email-and-office-printing-design}.md` and `docs/superpowers/plans/2026-10-05-printing-rules-and-drawer-policy-retirement.md` get dated pointer where their older no-Delete/history-resend claims need context; do not rewrite historical measurements. Keep step 3–6 backlog entries. Delete completed step2 backlog entry only as controller lands implementation, not while publishing this plan.
- [ ] Run focused checks outstanding from T1–7 and root guards `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/live-subscriptions.test.ts scripts/claude-md-pointers.test.ts scripts/id-columns-are-references.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/workspace-cycles.test.ts`; schema guard commands from T1 after any migration change. Check per-command status and `Tests` counts. No whole-workspace package run just for finish. Normal pre-push supplies local format/lint/root coverage/scoped types; CI supplies affected package coverage at `98/98/98/95` and existing mutation floors, unchanged.
- [ ] Visual run only from managed implementation worktree with `a435_worktree_name=$(basename "$PWD")` then `wa-wt demo "$a435_worktree_name"`; first confirm the directory name is registered with `wa-wt ls`. Measure memory before browser checks, no second coverage run sharing report dir. Look at ready/refused(shared fixture)/loading/error/delete-history/discovery dialogs in EN and ES, light and dark, viewport1280 and390, long names/many links. Save screenshots and note actual host dimensions, no clipping, reachable footer, native Cancel focus, Escape/opener return, keyboard Tab and text contrast. Close only recorded listeners/processes. Document physical-byte recall unverified/unsupported by protocol, not a hidden promise.
- [ ] Run FULL finish path through controller: initial needed rebase/reorientation; migration collisions resolved by generation; two **independent Claude run-it whole-branch reviews**, each with full candidate tree/dependencies in its own disposable checkout. First receives spec/plan and failure-path brief; second is **freeform**, receives complete diff/spec and repository conventions but not first findings as a prescribed checklist. Use `claude-seat.sh review-run` according to controller RUNNER/finish tooling; controller supplies actual registered branch/candidate arguments. Read completed findings and receipts, not wrapper exit. Apply valid findings in feature worktree with RED/GREEN, re-read full paths, rerun changed focused checks. Do not substitute per-task review or an earlier rebase's partial diff for either review.
- [ ] Controller commits sign-offs, publishes implementation PR with actual reset requirement first if needed, pushes through normal hook, waits required CI **on current head SHA**. Inspect scope selection and affected consumers, not aggregate green alone; if CI fails investigate relevant coverage run locally. Announce ready to run `finish-branch` if it has not begun; if underway finish it and report outcome. No extra owner approval at handoff or landing: authorisation supplied here overrides ordinary ask-again flow.
- [ ] Controller acquires existing shared `main.lock`, rechecks current-head checks/reviews/conversations, performs authorised landing, updates backlog atomically with completion and retains all later steps/residuals, verifies merged main has its own CI run, deletes/verifies remote feature branch and cleans managed worktree. Follow controller's existing lock protocol; do not create another lock convention. Report actual tested outcomes, review receipts, CI SHA, visual limits and any remaining failures. No detached processes.

## Test and fixture change forecast

Keep existing assertions for Disable/Enable, physical identity collision while disabled, no socket enqueue, drawer no-resend, agent identity/lease/reclaim, unpair behavior, authenticated ordinary invoice late reports, takeovers/profile choices, row-menu pinning, quiet saves and unsaved printer editors. Add delete-specific assertions alongside them. New public fields require exact fixture changes: printer schema `deletedAt:null`, history job `printerName`, deletion-only original receipt `failureCode`, delete API stubs/impact copy and live-dependency table. Do not alter fiscal QR bytes, sale totals, hash/golden files or name fixtures to make deletion tests pass.

Expected edited checks/fixtures: schema printing column/index cases; printing printers/outbox/runtime cases; server print API/wiring/agent/invoice/station/watchers/profile/equipment/history/reprint/report/kitchen/problem/transfer/demo cases listed in tasks; dashboard printer native/a11y/save/unsaved/live fixtures; venue prep station selection/unsaved fixture; till equipment, original invoice print-status and code wording fixtures; UI primitive token/axe fixtures. Root schema/constraint/classification/module/transfer-id/stream guards run unweakened. An assertion that printer lists include disabled rows remains valid; only assertions that deleted rows are live/matched/resendable change. This inventory is a forecast from source reading, not evidence those checks have run.

## Plan self-review

- [x] Spec step2/shared model covered by T1–7; later kinds/A4 excluded with explicit rationale.
- [x] Current-code inventory carries read receipts; no runtime/generation/no-reset claim invented.
- [x] Signatures/types/item keys match across server, contract, UI and API; no browser/server cycle.
- [x] Review Focus five failure classes mapped to tests; real DB/HTTP, rollback, stale impact, buffered-worker, history/name/identity and legitimate controls included.
- [x] Column/rebuild/incoming-FK risks, generated-only additions, immutable shipped hashes and migration prerequisite stated.
- [x] No approval pause at handoff; full two-review/hook/current-head-CI/visual/main.lock path left to controller.
