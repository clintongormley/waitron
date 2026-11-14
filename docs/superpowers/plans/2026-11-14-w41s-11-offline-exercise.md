# W41s-11: the old-backup, new-hardware exercise — re-mapped plan (draft)

**Status:** draft for the watcher, 2026-11-14, written on `main` at `a0dac8fea6`. No product code
or test was written. What was run and what was only read is listed at the end.

**Source.** [Task 11 of the approved W41s plan](2026-10-04-fiscal-prevention-and-offline-recovery.md#task-11-full-offline-exercise-and-operator-instructions),
written 2026-10-04. Since then the paper/Cloud "allocation" and short-series vocabulary was replaced
by minute-named installations (A679, then A947 slice 4a), W41s-10b was retired (9 November), and
the missing-history lists landed on **Reporting → Fiscal filing** (W41s-9, #2752 and #3077).

## Outcome

An owner who loses the box can follow the guide to restore an old backup on new hardware with no
internet, get back to issuing invoices on new series, and see on **Reporting → Fiscal filing** what
history may be missing — including, once the box is back online, invoices AEAT holds under the old
series that the backup does not. One end-to-end test drives that journey through the restore's
start-time entry point, the real sale path, the real reconciliation sweep (with a fake AEAT) and the
real Fiscal filing route.

## What the plan's words mean today

- **"Fresh allocation" / "new short series"** = a new installation name, five symbols for the box's
  UTC minute, and a new series set `A-`, `FF-`, `R-` plus that name; the backup's series are
  retired with their counters kept, and its identity revoked
  (`apps/server/src/restore-emergency.test.ts:16`, "restores a staged %s with the selected copy's
  older key and a durably selected current hour"). There is nothing to "obtain", "consume" or
  "exhaust": no allocation pool, paper register or Cloud registry remains on the restore path
  (`docs/operations/hour-recovery.md`, "Keep the resulting evidence").
- **"Switch to a new short series"** = W41s-7's administrator conflict switch, which picks a fresh
  minute name; automatic switching is permanently excluded (owner, 2026-11-01).
- **"Fencing"**: A1342 (#2654) stops a returning old main only on a **two-box** venue: its check
  returns nothing when the bucket's pointer names this box's own node id
  (`apps/server/src/stream-host.ts:135`) or when no other member is endorsed by this box. A restore
  keeps the node id (A1425 part 3, which changes that, is unbuilt). A1418 part 1 (the stop mark and
  the start-up bucket check for a one-box venue) is a **plan only**
  (`docs/superpowers/plans/2026-11-07-a1418-part-1-stop-marks.md`; `rg "stopMark|stop-mark"` finds
  no product code). So today **nothing stops an old one-box box that is switched back on**. The
  backlog's "A1418 with A1425 cover a one-box venue restored from its backup" overstates this.

## Re-map

| Task 11 bullet | Already proved (receipts) | Remains | Dropped, and why |
| --- | --- | --- | --- |
| 1. Issue, back up, issue more offline, lose the box, restore offline; new allocation, original bytes kept, a visible missing-history interval | Real invoice in the backup, kept unchanged through archive and stream restores, new minute series active, old ones retired: `restore-emergency-crash.e2e.test.ts:294` and `:305`. Offline restore, no internet clock, no network, sale on the new series, retired series refused `sale.series_retired`: `device-after-offline-restore.test.ts:48` "pairs a new device after offline %s recovery over %s…" (asserts at `:191`). Sale with no network after recovery: `hour-restore-retired-inputs.test.ts:291`. The missing-history read itself: `packages/fiscal-verifactu/src/filing-overview.history.test.ts:145` and `:169`, on **seeded rows**, not a real restore | (a) Nothing reads **Fiscal filing** after a real restore, so "a visible interval" is unproved. (b) **Gap, by reading:** after a restore, AEAT invoices under the old series are never recorded. `retainUnheldSeriesConflicts` keeps only numbers matching a **live** series (`reconcile-series.ts:18` `i.retired_at is null`; `:54-59` `continue`), and the restore retired the old series before any check could run. So **Invoices AEAT holds that this box did not issue** stays empty in exactly the restore case, although the guide (`guide/en/fiscal-filing.md`, "Possibly missing history") describes it | "Device evidence unavailable" is already the harness default (no devices) |
| 2. Same backup again, backward time, interrupted activation, new short series; no reuse, no old-series continuation, no automatic change when online, surviving transaction replays once | Second restore of the same backup refused for a spent minute: `hour-restore-retired-inputs.test.ts:335`. Backward clock: `packages/fiscal-verifactu/src/hour-selection.test.ts:506`. Forgotten earlier attempt still names a later minute: same file `:931`. Interrupted activation keeps the spent minute and takes a fresh one: `restore-emergency-crash.e2e.test.ts:321`. Killed at each later phase, completes once: same file `:354`. Retired identity's lookup observation neither stops nor allocates: `reconcile.conflicts.test.ts:196` | "No automatic series change when connectivity returns" after a **restore** (the existing case seeds a retirement by hand) | "New short series": the conflict switch is W41s-7's, tested in `apps/server/src/live-conflict-recovery.test.ts`. "Replays once" needs the till's sales route on a booted restored server; deferred with the booted-server item (open question 2) |
| 3. Reconnect the original box under fencing, later recover its history; the manual-assurance limit; queue restart after a lost response; approved remedies | Queue restart after a lost response: `apps/server/src/restart-reset.test.ts:23` and `boot.test.ts:2723`. Two-box returning main: A1342 (#2654, #2770, #2857) | The **real** reconnect event that remains: the old box filed invoices AEAT now holds. The restored box should list them (gap 1b), keep selling on its own series, and the guide should state the limit that nothing stops the old box on a one-box venue | Fencing a one-box box: A1418's, unbuilt; no test for a mechanism that does not exist. "Recover its history" = importing or matching records, waiting for Q41. "Approved remedies": none are approved, `ENABLED_REMEDIES` is empty (`record-remedy-routes.ts:21`) |
| 4. History before the oldest month W41s-10a looks up | — | The sweep starts at the oldest month this box holds a sent record for (`reconcile-sweep.ts:50`), so earlier months are never checked. Name the evidence needed: AEAT's own records for those months, which the tax adviser can check. Docs only | Any code: the backup bucket records no invoice range, and no product read can see a period the box never held |
| 5. Printable procedure: isolate, allocate, keep paper, activate, resume, investigate, reconnect; no subscription, exhaustion, lost pack | The restore journey is already in the guide `apps/server/src/guide/en/backup-recovery.md` (and `es`), with "Stop the former box…" and the recovery sheet; replacing a lost pack while the box runs: `docs/operations/recovery-document.md` | One guide section, **After a recovery**, in EN and ES: check Fiscal filing, export for the adviser, keep the old box off (the stated limit), never re-enter its sales, earlier months | New `docs/operations/fiscal-recovery.md`: the owner has no terminal and reads the guide; a second copy would drift. "Allocation", "no subscription", "exhaustion": no longer exist. Box and pack both lost: no restore is possible with that backup; the guide already requires the matching key |
| 6. Focused suite, CI, owner review; record adviser-gated actions | — | As stated | — |

## Proposed cut

Three tasks. No migration. Nothing in the fiscal core is touched: not `computeHuella`, the chain,
invoice-number allocation, `registros_facturacion` or the alta builders. Task 1 changes which AEAT
observations a reconciliation keeps as evidence (`fiscal_series_conflicts`), inside
`packages/fiscal-verifactu`, so the branch takes the full review path (fiscal risk trigger).

### Task 1: AEAT invoices under a retired identity's series become missing-history evidence

**Modify:** `packages/fiscal-verifactu/src/reconcile-series.ts`. **Test:**
`packages/fiscal-verifactu/src/reconcile.unheld.test.ts` (its fixture already has a `foreign` record).

- [ ] Failing test first: "keeps an invoice AEAT holds under a series of an identity this box
  retired and revoked, which this box did not issue". Stamp the deployment first
  (`stampDeployment(suite.db, "production")`; without it `readMissingHistory` returns empty lists).
  Retire the series **and** revoke the identity, as a restore does (one activation does both with one
  timestamp, `allocation.ts:436-457`); AEAT returns `S1/123`. Expect one `fiscal_series_conflicts`
  row and `readFilingOverview(...).missingHistory.notIssuedHere` naming it. Failing case prints `[]`
  (the plan review's throwaway emulation printed exactly that on a0dac8fea6).
- [ ] Rule: read the retired series of this node's revoked identities **inside
  `retainUnheldSeriesConflicts` only**; leave `readLiveReconciliationSeries` unchanged, because
  `reconcile.ts:145` and `reconcile-sweep.ts:68` use it to decide which months to ask AEAT about.
  Pair each retired series with the identity whose activation retired it: `invoice_series` names
  only the box, not the identity, so a plain join pairs every revoked identity with every retired
  series (the review's probe: 6 pairs after two recoveries, the first identity paired with a later
  one's series). Pair through the activation record (`fiscal_allocations.result` series ids →
  `sif_id`), or failing that `i.retired_at = s.revocado_en`. One combined read keeps
  `reconcile-series.test.ts:45`'s two-read limit.
- [ ] Second case: two recoveries in a row; the row for an invoice under the FIRST identity's series
  stores the first identity's `sif_id`, never the second's.
- [ ] Third case: retired **and** revoked while a lookup is in flight (as a real recovery is):
  the row is recorded and is not an active conflict. The existing case `reconcile.unheld.test.ts:195`
  ("rechecks the %s after a lookup overlaps a recovery") sets only one of the two and stays unchanged
  — no existing assertion changes.
- [ ] Also assert: `readActiveConflicts` stays `[]` and `assertNoActiveConflict` passes (the active
  reader filters `isNull(invoiceSeries.retiredAt)`, `conflict-evidence.ts:120`); a number this box
  holds is not recorded; another node's retired series is not recorded.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reconcile.unheld.test.ts
  src/reconcile-series.test.ts src/reconcile.conflicts.test.ts src/filing-overview.history.test.ts
  src/conflict-recovery.test.ts src/inmutabilidad.test.ts`. Read the `Tests` count.

About 25–40 production lines and 120–150 test lines.

### Task 2: one end-to-end test of the whole journey

**Create:** `apps/server/src/fiscal-offline-recovery.e2e.test.ts`. Reuse
`apps/server/src/testing/staged-hour-crash.ts` (the backup holds one real invoice under `A-0CNNW`,
counters at 123); no new harness. For `archive` and `stream`:

- [ ] Stub `fetch` to reject (the harness's clock comparison is synthetic, so no internet-clock
  stub is needed; `fetch` never being called is the evidence of no network). Run `f.run()` (`runStagedRestore`, what a start
  runs for a staged restore). Expect the original records unchanged and one new active identity.
- [ ] Open the restored venue; seed an administrator and a management session as
  `device-after-offline-restore.test.ts:86-92` does; mount `mountFilingOverview`
  (`packages/fiscal-verifactu/src/filing-overview-routes.ts`) and `GET /management-api/fiscal-filing`.
  Expect one identity change: the new name, earlier `0CNNW`, last held invoice the backup's invoice;
  `notIssuedHere` empty.
- [ ] Sell through `recordSale` with a client that throws: `A-0CNQR/1` (the harness runs as
  `preproduction` and its restore takes the name `0CNQR`); the retired series refuses
  `sale.series_retired`.
- [ ] The internet returns: run `createReconciliationSweep` (`reconcile-sweep.ts`) with a fake client
  whose `consultar` returns, for the requested month only, the backup's invoice `A-0CNNW/1` echoed
  exactly (its stored fingerprint, `RefExterna` and `SistemaInformatico` naming `0CNNW`, or the month
  reads "unknown" and raises `fiscal.huella_divergente`) and the old box's `A-0CNNW/123`. Not the
  new box's `A-0CNQR/1`: it was never filed, so AEAT cannot hold it. Expect the route to list
  `A-0CNNW/123` under `notIssuedHere`; no active conflict; the same active series and
  `fiscal_allocations` count (no automatic switch); the next sale is `A-0CNQR/2`; `fetch` never
  called.
- [ ] Deletion control: revert Task 1's rule locally and see the `A-0CNNW/123` assertion fail.
- [ ] Run: `pnpm --filter @waitron/server exec vitest run src/fiscal-offline-recovery.e2e.test.ts
  src/device-after-offline-restore.test.ts src/restore-emergency-crash.e2e.test.ts`. Add the new
  file to `apps/server/test-durations.json` only if `scripts/test-durations.mjs` asks for it.

About 200–240 test lines, no production lines.

### Task 3: the guide, the backlog and the old plan

- [ ] Before writing the reason for keeping the old box off, check (by a test or a cited code
  path, not by reading alone) whether an old one-box box switched back on, with the same box id and
  bucket settings, writes into the restored box's backup bucket; state what was found.
- [ ] `apps/server/src/guide/en/backup-recovery.md` and `es`: a section **After a recovery**
  `{#after-recovery}`: open **Reporting → Fiscal filing**; **Identity changes without a handover**
  names the last invoice the backup holds, and invoices after it may exist; once the box is online,
  AEAT's invoices under the old series appear under **Invoices AEAT holds that this box did not
  issue**; export them for the tax adviser and do not enter those sales again; keep the old box off
  and disconnected, because nothing stops it selling if it is switched back on.
- [ ] `apps/server/src/guide/en/fiscal-filing.md` and `es`, **Possibly missing history**: the check
  starts at the oldest month this box holds; before trusting earlier months, ask the tax adviser to
  check AEAT's records for them.
- [ ] `docs/backlog.md` W41s and `docs/backlog/fiscal.md` W41s: delete what this finishes ("Account
  for history before the oldest known month", the W41s-11 sentence); keep the two deferred
  qualifications as their own short entries; correct the A1418 sentence (plan only; one-box venue
  unfenced). Dated pointer under Task 11 of the old plan; one row in
  `docs/operations/operator-procedures.md` pointing at the guide section.
- [ ] Run: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
  src/guide-backup-recovery.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.

About 60–90 lines of docs and guide text.

## Size estimate

| | Production | Test | Docs |
| --- | --- | --- | --- |
| Task 1 | 25–40 | 120–150 | — |
| Task 2 | 0 | 200–240 | — |
| Task 3 | 0 | 0–60 | 60–90 |
| **Total** | **25–40** | **320–450** | **60–90** |

Inside the lane's "small" item. Each task fits one implementer well under 100 tool calls.

## Deferred or dropped

- **Booted restored server, fresh till paired, payment through `/api/sales`, replay once** (fiscal.md
  "Take a till payment through a booted restored server"): the parts are proved separately (pairing
  `device-after-offline-restore.test.ts:48`; first start of a restored venue `boot.restore.test.ts:252`;
  the start's clock wait then a sale through `/api/sales`, `boot.start-clock-gate.test.ts:195` and
  `:231`), but not together. Joining them needs a backup a real boot can open; the staged harnesses
  ship a stand-in sealed node key (`secrets/node-key.enc` is "synthetic sealed node key",
  `staged-hour-restore.ts`), which I believe a real start cannot use (not checked). Estimate: 250–400
  test lines plus harness work. Defer to its own item.
- **Production TLS** and **live AEAT reconciliation**: need a real box or the owner's certificate
  session; keep as their own qualification entries.
- **Fencing a returning one-box box**: A1418 part 1's work.
- **Importing, matching or reconciling recovered history; any missing-history remedy**: Q41.
- **`docs/operations/fiscal-recovery.md`, allocation exhaustion, subscription-free allocation, paper
  allocation evidence**: retired concepts or duplicated by the guide.

## Open questions, each with a recommended default

1. **Should a restore's lookup keep AEAT invoices under the old series (Task 1)?** Without it the
   W41s-11 journey cannot show the old box's later invoices, and the guide's description of that list
   says more than the code does for a restore. *Default: yes, with the "retired and revoked" rule,
   which changes no existing assertion.* If declined, Task 3 narrows the guide sentence instead.
2. **Defer the booted-server till payment and replay to its own item?** *Default: yes*; the parts are
   proved separately, and joining them is more than this item's size.
3. **Is the guide the printable procedure?** *Default: yes*, no new operations file and no change to
   the printed recovery sheet.
4. **Order against A1308 fi1, which renames `fiscal_series_conflicts` and `registro_sif`?** *Default:
   build now*; the new code names the drizzle objects, which fi1's rename map rewrites. Check fi1 is
   not in flight in `reconcile-series.ts` first.
6. **Do the owner's "interrupted activation" and "explicit return to a fresh short series" count as
   met by existing tests** (`restore-emergency-crash.e2e.test.ts:321` and `:354`;
   `hour-restore-retired-inputs.test.ts:335` with the harness's `freshStage()`,
   `staged-hour-crash.ts:300`), rather than by this journey test? *Default: yes*; folding them in
   would repeat a child-process kill those tests already run.
7. **After a conflict switch** (which also revokes and retires), Task 1's rule keeps adding later
   invoices another system issues under the collided code to the same list. *Default: wanted* — they
   are invoices AEAT holds that this box did not issue, which is what the list says.
5. **Say in the guide that nothing stops a returning old box on a one-box venue?** *Default: yes*, as
   an instruction (keep it off and disconnected), until A1418 part 1 lands and changes it.

## What was run and what was only read

**Run, on this worktree at `a0dac8fea6`:**
`pnpm exec vitest run src/reconcile.unheld.test.ts src/filing-overview.history.test.ts
src/reconcile-series.test.ts` in `packages/fiscal-verifactu`: 3 files, 39 tests passed.
`pnpm exec vitest run src/device-after-offline-restore.test.ts src/restore-emergency.test.ts
src/hour-restore-retired-inputs.test.ts` in `apps/server`: 3 files, 14 tests passed. Searches: no
`stopMark`/`stop-mark` code; no test outside `filing-overview*` reads the overview; `git log` on the
A1342, A1418, A1425 and W41s-9 commits.

**Only read, not run:** gap 1b (the lookup drops AEAT invoices under a retired series), the A1342
check ignoring a same-node pointer, the restore's approval being version 1 so it shows as an identity
change, the stand-in node key blocking a real boot, and every "covered by" in the table beyond the
six files run above. Task 1's failing test is the probe for gap 1b: if it prints a row before the
change, the gap is not real and Task 1 shrinks to the end-to-end assertion.

**Plan review (fresh context, 2026-11-14):** no Critical findings. It confirmed gap 1b by a
throwaway emulation (revoke and retire by SQL, AEAT returning `S1/99`: no row, empty list; a
hand-inserted row under the retired series did show) and that a real restore both revokes and
retires (`allocated-lifecycle.ts:48-61` → `allocation.ts:437-440`, `:454-457`). Its corrections are
folded in above: pair series to identity through the activation, keep the shared live-series reader
unchanged, stamp the deployment, the fake AEAT's five fixes, the two new questions, the bucket check.
