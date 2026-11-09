# W41s-9: the Fiscal filing screen — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development` (or
> `superpowers:executing-plans` inline). Dispatch each task as `subagent_type: "implementer"`. Steps
> use checkbox (`- [ ]`) syntax. Every task is test-first: write the named failing check, run it and
> see it fail for the stated reason, then write the smallest code that passes it.

**Status:** plan for review, 2026-11-09. Written on `main` at `1252e2b6b3`. No product code was
written or run to produce it; what was read and what was run is listed at the end.

**Approved source.** This plan carries out Task 9 of the
[approved W41s plan](2026-10-04-fiscal-prevention-and-offline-recovery.md#task-9-fiscal-filing-screen-and-missing-history-investigation)
and decision D6 of its [approved design](../specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
(§5, "D6: Fiscal filing screen under Reporting … Show unresolved invoices separately from queue
progress"). The owner approved that design ("lgtm") and that plan ("plan approved") on 2026-10-04;
the record is `~/waitron-campaign-l/queue.md`, "Lane J's W41s rules". This plan narrows Task 9 to
what today's code still needs. Where it departs from Task 9's text, the departure and its reason are
in "What changed since Task 9 was written" below.

## Goal

A manager (anyone holding `report.export`) opens **Reporting → Fiscal filing**, the item right after
**VAT return (modelo 303)**, and sees, as four separate parts of one page:

1. **Sending progress**: how many invoice records are waiting, being sent, accepted, accepted with
   errors, refused, held or set aside, and how old the oldest waiting one is.
2. **Open filing cases**: each invoice record that needs a person's decision, with its invoice
   number and date, why the case opened, what the tax agency (AEAT) said at the time, the record's
   fingerprint and, for a conflict, the fingerprint AEAT holds. Each case says how many later records
   are held behind it.
3. **Held records with no case**: a count, so nothing held is invisible.
4. **Possibly missing history**: invoices AEAT holds under this box's series that this box does
   not have, and each change of fiscal identity after which the old box may have issued invoices
   this box does not hold.

One **Export** button saves all of it as one file for the venue's tax adviser. The file carries no
passwords, keys, certificates, session data or customer details.

The screen changes nothing. It offers no correction, release or retry button: every correction is
switched off in production today (see item 5 below), and retrying is already on Box status. When
this box is stopped by an invoice identity conflict, the screen links to the existing recovery page,
which asks for the box's recovery key whoever is signed in.

## Should this exist?

- **The need.** Today a person sees the bell's "N fiscal record(s) need someone to decide what to
  do. Contact support." (`apps/dashboard/src/i18n/alert-messages.ts:313-316`) and has nowhere to see
  which invoices, why, or what AEAT said. The facts exist only in database tables. W41s-11's
  approved exercise also needs "a visible missing-history interval"
  ([Task 11](2026-10-04-fiscal-prevention-and-offline-recovery.md#task-11-full-offline-exercise-and-operator-instructions)),
  and only this item makes one visible.
- **The simplest thing that meets it.** One read-only page and one read route inside the fiscal
  module, reusing the case readers that already exist, and saving the export in the browser from
  the same read. Considered and rejected: changing nothing (the evidence stays unreadable, and the
  W41s-11 exercise has nothing to check); a download only, with no page (the approved outcome is to
  see it, and an adviser cannot be handed what the owner has not seen); adding the cases to Box
  status (D6 placed the screen in Reporting under `report.export`; Box status needs
  `system.manage`).
- **What it leaves out on purpose.** Everything in "Out of scope" below, most importantly every
  action button and any way to import recovered history.
- **True size (estimate).** About **715 lines of production code** and **about 560 lines of new tests**,
  plus about **90 lines of guide prose** (English and Spanish) and documentation edits. No generated
  files, no migration. Per-task figures are in the size table near the end. The plan itself is
  documentation.
- **Later changes.** A1308's fiscal slices fi6 and fi9 will rename the tables this screen reads. All
  of the screen's database reads live in one file (`filing-overview.ts`) and go through the case
  readers fi6 already plans to rewrite, so fi6 and fi9 gain one file to fold, not several.

## What changed since Task 9 was written

Task 9 was written on `main` at `3881303f1` (2026-10-04). Each line below is checked against
`1252e2b6b3`.

1. **The file map no longer fits the module rules.** Task 9 proposed
   `apps/server/src/fiscal-filing-api.ts`, `apps/dashboard/src/screens/fiscal-filing-screen.ts` and
   `boot.ts` changes. A module now brings its own routes (`FISCAL_ROUTES`,
   `packages/fiscal-verifactu/src/routes.ts:23-47`) and its own dashboard screens
   (`moreScreens`, `packages/dashboard-kit/src/contract.ts:135`; mounted and permission-gated "exactly
   as `screen` is"). The adjustments module already puts a screen in Reporting this way
   (`packages/adjustments/src/dashboard/index.ts:10-15`). Generic code must not name a module
   (CLAUDE.md §3, "A new product domain lands as a MODULE"), so everything here lives in
   `packages/fiscal-verifactu`; `boot.ts` and `apps/dashboard` are not touched.
2. **The case tables and their readers exist (W41s-3).** `filing_cases` and `filing_case_events`
   (`packages/fiscal-verifactu/src/schema/filing-cases.ts:30-76`), `listFilingCases`
   (`filing-cases.ts:180-209`), `openFilingCasesSummary` (`:212-231`) and `heldRecords` (`:244-304`).
   `git grep` finds no production caller of `listFilingCases` or `heldRecords`; only
   `openFilingCasesSummary` is used, by the bell's alert (`submission-alerts.ts:64`). The backlog note
   "For Task 9 (the filing screen): `listFilingCases` reads every case … `heldRecords` reads every
   `rechazado`/`detenido` row" (`docs/backlog.md:317-319`) asks this item to filter them.
3. **Conflict evidence exists (W41s-7, W41s-10a).** `fiscal_conflict_evidence`,
   `fiscal_lookup_conflicts` and `fiscal_series_conflicts` (`schema/conflict-evidence.ts:12-32`,
   `schema/lookup-conflicts.ts:7-21`, `schema/series-conflicts.ts:6-21`), read together by
   `readActiveConflicts` (`conflict-evidence.ts:36-129`). The reconciliation (#2449) writes a
   `fiscal_series_conflicts` row for each invoice AEAT holds under one of this box's live series that
   this box does not have (`reconcile-series.ts:33-86`).
4. **"Manual activation with re-authentication" is already built, differently.** Task 9 said to use
   Task 6's administrator recovery. W41s-7 (#2373) replaced that with a public recovery page,
   `/manage/recovery/fiscal-conflict` (`packages/fiscal-verifactu/src/dashboard/index.ts:12-18`;
   route `conflict-recovery-routes.ts:126-170`), which demands the box's current recovery key; a
   dashboard sign-in does not replace it (`apps/server/src/guide/en/box-status.md:89-90`). A sale
   refused for a conflict already names that page (`conflict-evidence.ts:25-32`). The screen only
   links to it. Reading permission cannot reach the switch, because the page asks for the key, and
   W41s-7's own suites test that page.
5. **Corrective filings are built (W41s-8, #2399) and switched off.** `POST
   /management-api/fiscal-records/remedy` (`record-remedy-routes.ts:48-95`) needs `fiscal.remedy`,
   granted to administrators only (`permissions.ts:3-7`; checked at `record-remedy.ts:33-37`), and a
   server policy whose production set is empty (`record-remedy-routes.ts:20`). Every remedy kind is
   therefore refused at a venue. Buttons for them would only ever show a refusal, so this item builds
   none. Because remedies are the only writers of case events (`git grep "recordCaseEvent("` finds
   only the five `record-remedy*.ts` files), no case can be resolved at a venue today either. Task
   9's "all successful action retries display the saved result", "slow reloads after successful
   actions" and "wrong-field refusals" have no action to apply to on this screen.
6. **Retry now exists.** Box status's tax row has **Retry now** (A798-B, #2030;
   route `routes.ts:29-46`, client `apps/dashboard/src/api/client.ts:4612`) and an unsent-records
   line (`apps/dashboard/src/screens/box-status-rows.ts:186-200`, from `staff-notices.ts:41-69`). Not
   rebuilt here.
7. **Alerts can now carry a "Go to" screen** (`packages/module/src/alerts.ts:16`, `:50`;
   `apps/dashboard/src/widgets/alert-format.ts:34-39`), and the most specific incident claim wins
   (`apps/server/src/alerts.ts:41-42`). Linking the fiscal alerts to this screen is therefore a
   one-field change, but existing exact assertions pin those alerts (Task 6 and the questions below).
8. **`fiscal.view` exists and gates the fiscal alerts** (`packages/identity/src/permissions.ts:29`,
   granted to managers at `:56`; `packages/fiscal-verifactu/src/alerts.ts:12`). It predates the
   design (#368, 2026-09-15), which still chose `report.export`. This plan keeps `report.export`.
   Both are held by exactly the manager and administrator roles today (`permissions.ts:46-57`), so a
   person who sees a fiscal alert can open the screen.
9. **No table records a missing period, and nothing computes one.** `git grep -i` for "missing
   history", "lost period" and similar finds only two comments. The evidence that does exist: series
   conflicts (item 3), and `fiscal_allocations` (`schema/allocations.ts:10-40`, written at
   `allocation.ts:465`, W41s-4 #1700), one row per activated fiscal identity, whose approval records
   whether the old machine handed over its records (`allocation-types.ts:16-37`; true only for a
   controlled handover, `apps/server/src/handover-preparation.ts:48`; false for a restore,
   `apps/server/src/recovery-preparation.ts:188`). The missing-history part is built from these two,
   with no schema change.
10. **There is no way to bring recovered history in.** Task 9 asked to "record later-recovered source
    records separately … flag possible duplicate accounting and require reconciliation". Nothing
    imports recovered records today, so there is nothing to record or flag. Bringing them in is part
    of the remedy that adviser question Q41 gates (`docs/compliance/asesor-questions.md`). Out of
    scope.
11. **A1308 will reshape these tables.** The A1308 fiscal plans fi6 and fi9 (2026-11-08) fold
    `filing_cases` into a submissions table and `fiscal_allocations` into an identities table. fi6
    expects to fold "any part of A1089's filing-case route that has landed"
    (`2026-11-08-a1308-fi6-cases-into-submissions.md:404-407`) and keeps `heldRecords` and the other
    readers' names and arguments (`:217`). This plan adds no table, so A1308's table hold does not
    apply, and keeps its reads in one file.
12. **A1089's four evidence branches are not on `main`.** Lane E's `feat/a1089-reply-evidence`,
    `-integrity-evidence`, `-reconcile-evidence` and `-environment-evidence` built read-only panels
    for other fiscal alerts. Nothing here relies on them, and this item does not take over their
    scope (reply mismatches, integrity warnings, reconciliation drift, environment refusals).

## Scope

In:

- A read model in `@waitron/fiscal-verifactu` that returns the four parts above in one transaction,
  with an explicit list of the fields it returns.
- One read route, `GET /management-api/fiscal-filing`, checking `report.export`.
- A dashboard screen contributed by the fiscal module through `moreScreens`, in the `reports`
  group, ordered right after VAT return, needing `report.export`, with an Export button.
- A link to `/manage/recovery/fiscal-conflict` when this box has an active conflict.
- A guide page in English and Spanish.
- Gated on the owner's approval of exact lines (Task 6): the fiscal alerts' "Go to Fiscal filing".

Out:

- Any correction, release, cancellation or retry button. They wait for the remedy enablement that
  Q35/Q37/Q38/Q40 gate; that change brings its own controls.
- Importing, matching or reconciling recovered history (Q41).
- Resolved cases and case notes: none can be written at a venue today (item 5).
- Live updates. The page reads when it opens and when **Refresh** is pressed; no live subscription.
- Rewording the bell's "Contact support" sentences. That stays with A1089's audit entry
  "fiscal filing-case alerts need a real decision route"; this item gives it the evidence page.
- Reply mismatches, integrity warnings, reconciliation drift, environment refusals (A1089 branches),
  history before the oldest reconciled month (W41s-10b/W41s-11), and any AEAT request.

**No migration and no schema change.** Every fact shown is already stored (items 2, 3 and 9). If an
implementer finds a fact that cannot be shown without a new column, that is a stop: write it in
`~/waitron-campaign-l/questions.md` with the receipt, and do not add one.

**Protected fiscal core (RUNNER H2) not touched.** No change to `computeHuella`, the hash chain
(`Encadenamiento`), invoice-number allocation, `registros_facturacion` or its append-only triggers,
or the alta builders (`recordSale`, `recordCorrection`, `recordSubstitution`). No change to what is
sent to AEAT, which records are held, probed or set aside, or which identity or series a sale uses.
The golden huella suite and `inmutabilidad` pass **unedited** in every task.

## Rules every task follows

- Fiscal area: FULL review path with two run-it reviews; the pull request ends `needs-owner-review`
  and the owner lands it. Show the owner the screen (light and dark, English and Spanish, phone and
  desktop widths) before landing; screenshots stay out of the repository.
- No existing assertion changes except the lines the owner approves in Task 6. Adding a new case
  to an existing test file is not a change to an existing assertion.
- Each property is tested once, where it is decided (owner, 2026-11-09): the field list and every
  database fact in the read model's tests; the permission in the route's tests; drawing and
  saving in the screen's tests. Do not repeat a case in another layer.
- Plain English in every string, comment and commit. Product text as short as the meaning allows.
  Never present equal dates, totals or tax as proof that two records are the same sale: the screen
  shows fingerprints and AEAT's words, and compares nothing itself.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and returns a handover.

## File map

| Path | Change |
| --- | --- |
| `packages/fiscal-verifactu/src/filing-overview-types.ts` | **New.** The payload types, shared by server and screen; types only, so the browser bundle takes no database code. |
| `packages/fiscal-verifactu/src/filing-overview.ts` | **New.** `readFilingOverview(tx, scope)`: the one read model. |
| `packages/fiscal-verifactu/src/filing-overview.test.ts` | **New.** Progress, open cases, held records, field list. |
| `packages/fiscal-verifactu/src/filing-overview.history.test.ts` | **New.** Possibly missing history. |
| `packages/fiscal-verifactu/src/filing-cases.ts` | Add `openFilingCases(tx)`; share the "no resolution yet" condition with `openFilingCasesSummary`. |
| `packages/fiscal-verifactu/src/filing-overview-routes.ts` | **New.** `mountFilingOverview(app, ctx, log)`. |
| `packages/fiscal-verifactu/src/filing-overview-routes.test.ts` | **New.** |
| `packages/fiscal-verifactu/src/routes.ts` | Call `mountFilingOverview` in `FISCAL_ROUTES.mount`. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts` | **New.** `<vf-fiscal-filing-screen>`. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-client.ts` | **New.** One `read()` call. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.test.ts` | **New.** Browser behaviour. |
| `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.a11y.test.ts` | **New.** Axe, both themes, both languages, two widths. |
| `packages/fiscal-verifactu/src/dashboard/strings.ts` | English and Spanish strings, including `nav.fiscal_filing`. |
| `packages/fiscal-verifactu/src/dashboard/index.ts` | Add the `moreScreens` entry. |
| `packages/dashboard-modules/src/registry.test.ts` | One new case pinning the placement. |
| `apps/server/src/guide/en/fiscal-filing.md`, `apps/server/src/guide/es/fiscal-filing.md` | **New** guide page. |
| `apps/server/src/guide-catalogue.ts` | Add `"fiscal-filing"` to `GUIDE_PAGES`. |
| `docs/backlog.md`, `docs/backlog/fiscal.md`, `docs/backlog/self-service-refusals.md` | Update in the same change (Task 5). |
| Task 6 only: `packages/fiscal-verifactu/src/alerts.ts`, `submission-alerts.ts`, and the approved lines of `alerts.test.ts` and `submission-alerts.cases.test.ts` | Alert links. |

## Task 1: sending progress, open cases and held records (read model)

**Files:** `filing-overview-types.ts`, `filing-overview.ts`, `filing-overview.test.ts`,
`filing-cases.ts`.

**What it returns.** `readFilingOverview(tx, { nodeId })` (where `nodeId` is `string | null`) returns:

- `readAt` (ISO time of the read).
- `progress`: one count per submission state in `ENVIO_STATES` (`handover-summary.ts:7-15`), the
  generation time of the oldest `pendiente` or `enviando` record (or null), and the latest
  `confirmado_en` (or null). One grouped query over `envios` joined to `registros_facturacion`.
- `openCases`: from a new `openFilingCases(tx)` in `filing-cases.ts`, which reads cases with no
  `resolved` event, oldest first by `rowid` as `listFilingCases` does, and reads no events. Move the
  existing `notExists(...)` condition of `openFilingCasesSummary` (`filing-cases.ts:218-226`) into a
  shared helper both use; `openFilingCasesSummary`'s behaviour does not change. For each case:
  - the case: `caseId`, `cause`, `openedAt`, and its saved AEAT answer `evidence` (`codigo`,
    `mensaje`, `csv`) — the answer as it was when the case opened;
  - the record, by an explicit field list: `registroId`, `tipoRegistro`, `idEmisorFactura`,
    `numSerieFactura`, `fechaExpedicionFactura`, `tipoFactura`, `importeTotal`, `cuotaTotal`,
    `huella`, `anteriorHuella`, `fechaHoraHusoGenRegistro`, and the installation name
    (`registro_sif.numero_instalacion`);
  - the current submission: `estado`, `codigoError`, `mensajeError`, `enviadoEn`;
  - `conflicts`: each `fiscal_conflict_evidence` row for the record (`attempt`, `cause`,
    `evidence`, `recordedAt`) and its `fiscal_lookup_conflicts` row if any (`evidence`,
    `recordedAt`);
  - `heldBehind`: how many records `heldRecords` names this case for.
- `heldWithoutCase`: how many records `heldRecords` returns with a null `caseId`.
- `activeConflict`: true when `nodeId` is not null and `readActiveConflicts(tx, nodeId)`
  (`conflict-evidence.ts:36`) returns any row; false otherwise.

Recipients (`destinatarios`), the operation description, the tax breakdown, device, sale and
person ids, and every column of every other table are left out. The adviser who needs an invoice's
lines opens the invoice itself.

**On the backlog note about unfiltered readers.** `openFilingCases` reads only open cases and no
events, which settles the `listFilingCases` half. `heldRecords` is used as it is: it reads only
records in the `detenido` and `rechazado` states, both of which exist only after AEAT refused
something, and the route returns counts, not its rows. Say this in the pull request, and delete the
note in Task 5.

- [ ] **Failing test first** (`filing-overview.test.ts`, `useVenueDb` with `TEST_MIGRATIONS`, seeded
  through `test/drain-fixtures.ts` and `openFilingCase` as `filing-cases.test.ts` does). One fixture:
  a chain with an accepted record, a pending one, a refused one with a `fiscal.registro_rechazado`
  case and two records held behind it, a set-aside cancellation with its `fiscal.anulacion_retenida`
  case, a record with a `fiscal.huella_divergente` case and one `fiscal_conflict_evidence` row, a
  held record with no case, and a case resolved through `recordCaseEvent` (synthetic, to prove the
  filter). Cases:
  1. `progress` counts each state and gives the oldest waiting generation time.
  2. `openCases` lists the three open cases oldest first, leaves out the resolved one, and gives
     `heldBehind` 2 for the refusal; `heldWithoutCase` is 1.
  3. The conflict case carries its evidence row; `activeConflict` is true for that record's node
     and false for a null node.
  4. **No more than the field list.** `Object.keys` of a case, of its `record` and of its
     `submission` equal the listed names exactly; and with the fixture's recipient name set to a
     distinctive string, `JSON.stringify(overview)` does not contain it.

  Before the code exists the import fails; then make each case fail for its own reason once (for
  case 4, temporarily spread the whole row and watch it fail).
- [ ] Write `filing-overview-types.ts`, `openFilingCases` and `readFilingOverview`. Keep every SQL
  statement of this item in `filing-overview.ts` or `filing-cases.ts`. Await queries in turn on the
  one transaction, never `Promise.all`.
- [ ] Run, and read the `Tests` count:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview.test.ts src/filing-cases.test.ts src/submission-alerts.cases.test.ts`
- [ ] Guards, unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  and `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts`.
- [ ] Commit (`git commit -s`).

## Task 2: possibly missing history (read model)

**Files:** `filing-overview.ts`, `filing-overview-types.ts`, `filing-overview.history.test.ts`.

**What it adds** to the overview, as `missingHistory`, scoped to the venue's taxpayer
(`readTenant(tx)`) and the box's deployment environment (`readDeploymentEnvironment`):

- `notHeldHere`: every `fiscal_series_conflicts` row, oldest first — invoice number, issue date,
  AEAT's state and fingerprint, the system AEAT names, when it was found, the series code, and
  whether that series is still in use (`invoice_series.retired_at` is null). Rows stay listed after
  a switch retires the series: the invoice is still missing from this box.
- `identityChanges`: one entry for each `fiscal_allocations` row of that taxpayer and environment
  for which (a) this database holds at least one record of that taxpayer and environment under a
  different identity generated before `activated_at`, and (b) the approval does not record a handover
  (`approval.version === 2 && approval.oldMachineRelinquished === true` is a handover). The entry
  gives `activatedAt`, the new installation name, and the last record held under an earlier
  identity before it: invoice number, installation name and generation time. A first setup has no
  earlier record, and a controlled handover moved the whole chain, so neither appears.

The screen words an identity change as a fact plus its limit: the identity changed at that time
without a handover, the last invoice this box holds from before is the one shown, and the earlier
box may have issued invoices this box does not hold. It does not claim that any are missing.

- [ ] **Failing test first** (`filing-overview.history.test.ts`). Cases:
  1. A series-conflict row on a live series and one on a retired series both appear, with their
     AEAT facts and the right `seriesInUse`.
  2. Three activations — the first identity (no entry), a restore after records on the first
     identity (an entry naming the last of them), and a handover (`version: 2`,
     `oldMachineRelinquished: true`, no entry).
  3. A record of another environment is never named as the last record held.
- [ ] Implement, inside `readFilingOverview`. The activations reader follows the column use of
  `hourHistorySource`'s allocation rows (`hour-history-reader.ts:63-77`); do not add an index.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview.history.test.ts src/filing-overview.test.ts`,
  then the two unedited guards from Task 1.
- [ ] Commit.

## Task 3: the read route

**Files:** `filing-overview-routes.ts`, `filing-overview-routes.test.ts`, `routes.ts`.

`GET /management-api/fiscal-filing`, mounted from `FISCAL_ROUTES.mount` (`routes.ts:24`) before the
`fiscalDrain` early return, so a box that is not filing still shows its evidence. It sets
`Cache-Control: no-store`, takes the session with `requireManagementSession`, and inside one
`withTransaction` checks `authorizeManager(tx, { managementSessionId, permission: "report.export" })`
before reading `readFilingOverview(tx, { nodeId: ctx.liveOperations?.node.nodeId ?? null })`.
The conflict page is mounted only when `ctx.liveOperations` exists
(`conflict-recovery-routes.ts:114-115`), so this offers the link exactly when the page exists. It
adds `filing` and `awaitingCertificate` from `ctx.fiscalDrain` (false when absent). Error boundary:
the four session and permission codes of `routes.ts:12-16`, log tag `fiscal-filing.failed`; no new
error code. Follow the certificate card's read (`apps/server/src/fiscal-certificate-api.ts:52-66`)
for the session handling.

- [ ] **Failing test first.** Cases: a manager session gets 200 with the overview and
  `no-store`; a supervisor session (holds `report.view`, not `report.export`) gets 403
  `authorization.not_permitted`; no session gets 401. One case only for the payload (that it is the
  read model's): its content is Task 1's.
- [ ] Implement; mount it.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-overview-routes.test.ts src/routes.test.ts src/record-remedy-routes.test.ts`
  and `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts`.
- [ ] Commit.

## Task 4: the screen

**Files:** `dashboard/fiscal-filing-screen.ts`, `dashboard/fiscal-filing-client.ts`,
`dashboard/strings.ts`, `dashboard/index.ts`, `dashboard/fiscal-filing-screen.test.ts`,
`dashboard/fiscal-filing-screen.a11y.test.ts`, `packages/dashboard-modules/src/registry.test.ts`.

**Placement.** A `moreScreens` entry `{ id: "fiscal-filing", navLabelKey: "nav.fiscal_filing",
group: "reports", order: -1, requiresPermission: "report.export" }`. Module screens are sorted by
`order` (default 0) after the group's core items (`apps/dashboard/src/dashboard-app.ts:2509-2516`),
and VAT return is Reporting's last core item (`:229-238`), so `-1` puts Fiscal filing right after
VAT return and before Adjustment report. Use `moreScreens`, not `screen`: the existing assertion
`expect(VERIFACTU_DASHBOARD.screen).toBeUndefined()` (`dashboard/index.test.ts:9`) stays true and
unedited.

**Drawing.** Read first: `docs/developers/design-system.md` and `conventions-ui.md`. Use `wt-*`
primitives and declared `--wt-*` tokens only. The screen holds no input, so no form fields, no
draft scope and no `*.unsaved.test.ts`.

- A one-sentence intro. **Refresh** and **Export** in the page's action row.
- When `filing` is false or `awaitingCertificate` is true, a `wt-notice` says so (the reason's words
  only; Box status and Venue settings already handle both).
- **Sending progress**: the seven counts with plain names (Waiting, Sending, Accepted, Accepted
  with errors, Refused, Held, Set aside), the oldest waiting time and the last acceptance.
- **Open filing cases**: a `wt-data-table` (opened, invoice number and date, reason, AEAT code,
  records held behind it), client-side paging. A **View** row action (column keyed `actions`,
  `pinned: "end"`) opens a plain-text details panel, as Products' archived-row View does
  (design-system "Products: Active and Available are two different words"): the invoice facts, the
  record's fingerprint and the previous one, AEAT's answer at the time and now, each conflict
  observation with AEAT's fingerprint beside ours, and one line on what is true now for that reason.
  These lines say what Waitron does (for example, that later records keep being sent after a refusal,
  or that a set-aside cancellation is not sent), that no correction can be made in Waitron yet, and
  that the export holds this case. Write them from the drain's code, not from this plan. The wording
  of the next step waits on owner question 1.
- When `activeConflict` is true, a `wt-notice` above the cases: this box stopped issuing invoices
  because of an identity conflict; recovery needs the box's recovery key; a link to
  `/manage/recovery/fiscal-conflict`.
- **Held with no case**: a line with the count, shown only when it is not 0.
- **Possibly missing history**: the two lists from Task 2, each with an empty state.
- Read failure: one message under the action row; Refresh clears it once a read succeeds. The
  screen has no action that can fail, so there is no second message to keep apart. The first read on open and every Refresh are passive GETs
  (`{ passive: true }`), so an unattended page does not keep the session alive.
- **Export**: reads again (not passive: the person asked), then saves the answer as
  `fiscal-filing-<YYYY-MM-DD>.json`, pretty-printed, with a Blob and a temporary link as the VAT
  return screen does (`apps/dashboard/src/screens/vat-return-screen.ts:122-127`). The file is
  exactly the route's answer, so Task 1's field list is the whole of what it can hold.
- English and Spanish strings in `dashboard/strings.ts`; Spanish uses AEAT's own terms where the
  fiscal package's exception allows (CLAUDE.md §3, "General code is English only").

- [ ] **Failing test first** (`fiscal-filing-screen.test.ts`, real Chromium, the client stubbed at
  `DashboardRequest`). Cases, each once:
  1. With the fixture overview, the four parts show their figures; View on the conflict case shows
     both fingerprints.
  2. `activeConflict` shows the recovery link with that exact path; false shows none.
  3. Export saves one file whose parsed content equals the second read's answer (spy on the
     temporary link's `download` and the Blob), and the first read was passive.
  4. A refused read shows the read message; Refresh after success clears it.
- [ ] **Accessibility** (`fiscal-filing-screen.a11y.test.ts`, copying the pattern of
  `dashboard/conflict-recovery.a11y.test.ts:12-40`): light and dark, English and Spanish, 390 and
  1280 pixels wide, for a page with cases and an empty page; `expectNoA11yViolations` each time.
- [ ] **Placement** (`packages/dashboard-modules/src/registry.test.ts`, one new case beside the
  adjustment report's): the fiscal module's `moreScreens` placement equals the object above.
- [ ] Before the browser runs, check headroom (`memory_pressure | grep free`); run beside other
  browser work only well above 15% free.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/fiscal-filing-screen.test.ts src/dashboard/fiscal-filing-screen.a11y.test.ts src/dashboard/index.test.ts src/dashboard/strings.test.ts`
  and `pnpm --filter @waitron/dashboard-modules exec vitest run src/registry.test.ts`.
- [ ] Guards: `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/pinned-actions-column.test.ts scripts/live-subscriptions.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`
  and `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts` only if the task
  touched `packages/ui` (it should not).
- [ ] Look at it: screenshots in both themes, both languages, at phone width, kept in the worktree's
  untracked working folder and shown to the owner, never committed.
- [ ] Commit.

## Task 5: guide page and documentation

**Files:** `apps/server/src/guide/en/fiscal-filing.md`, `apps/server/src/guide/es/fiscal-filing.md`,
`apps/server/src/guide-catalogue.ts`, `docs/backlog.md`, `docs/backlog/fiscal.md`,
`docs/backlog/self-service-refusals.md`, `docs/superpowers/plans/2026-11-08-a1308-fi6-cases-into-submissions.md`.

- [ ] Guide page, English and Spanish, each heading with the same `{#id}`: what each part shows,
  that the page changes nothing, how to export for the adviser, and the identity-conflict link.
  Write each sentence from the code built in Tasks 1–4; keep only sentences that change what staff
  do (CLAUDE.md §3, "A guide sentence earns its place"). Add `"fiscal-filing"` to `GUIDE_PAGES`.
  The screen links to no guide section, so `apps/dashboard/src/help-guide.ts` is unchanged.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] Backlog, in the same change: the W41s line in `docs/backlog.md` (`:300-308`) no longer lists
  W41s-9 as queued; delete the note at `docs/backlog.md:317-319` (with the reasoning from Task 1 in
  the pull request); in `docs/backlog/fiscal.md`'s W41s section, a dated paragraph saying what
  landed and what stays out; in the A1089 lines (`docs/backlog.md:211-212` and
  `self-service-refusals.md` "fiscal-cases"), that the evidence page exists and the decision step
  still waits for remedy enablement.
- [ ] In fi6's plan, add `filing-overview.ts` and `openFilingCases` to its "Needs" paragraph, as
  that paragraph asks of any landed filing-case route.
- [ ] Commit.

## Task 6 (only after the owner approves the exact lines): alerts go to the screen

The bell's "Go to" needs `screen: "fiscal-filing"` on the alerts. Every way to add it changes
existing exact assertions in the fiscal package, which the W41s rules allow only with the owner's
approval of the exact changed lines. Until that approval is recorded, skip this task; the screen
lands without it.

The changes, and the existing assertions each one alters:

| Change | Existing assertion that changes |
| --- | --- |
| `alerts.ts:11-16`: add five claims, `{ prefix: "fiscal.registro_rechazado" \| "fiscal.huella_divergente" \| "fiscal.duplicado_anulado" \| "fiscal.aceptado_con_errores" \| "fiscal.anulacion_retenida", area: "fiscal", permission: "fiscal.view", screen: "fiscal-filing" }` | `alerts.test.ts:7-15`: the `events` list gains those five lines. |
| `submission-alerts.ts:66-72`: `screen: "fiscal-filing"` on `fiscal.filing_cases_open` | `submission-alerts.cases.test.ts:71-79`: the object gains `screen: "fiscal-filing",`. |
| `submission-alerts.ts:145-150`: the same on `fiscal.refusals_repeated` | `submission-alerts.cases.test.ts:179-187`: the object gains the same line. |
| `submission-alerts.ts:55-61`: the same on `fiscal.submission_stopped` | none (`submission-alerts.test.ts:133-137` uses `toMatchObject`). |

- [ ] Once approved: make exactly those changes; run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts src/submission-alerts.test.ts src/submission-alerts.cases.test.ts src/drain.probe.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts.brake-probe.test.ts`,
  `pnpm exec vitest run scripts/alert-codes.test.ts`, and the two unedited fiscal guards.
- [ ] Commit.

## Size estimate

Lines are estimates, before review. Test lines count only new tests.

| Task | Production | Tests | Other |
| --- | --- | --- | --- |
| 1. Progress, open cases, held records | 160 | 150 | — |
| 2. Possibly missing history | 80 | 110 | — |
| 3. Read route | 50 | 70 | — |
| 4. Screen, client, strings (EN+ES), placement | 400 | 230 | — |
| 5. Guide page and catalogue | 1 | 0 | ~90 guide prose, ~30 docs |
| 6. Alert links (if approved) | 25 | ~8 changed | — |
| **Total** | **~715** | **~560 new, ~8 changed** | **~120** |

No generated files and no migration. Every task fits well under 100 tool calls; Task 4 is the
largest and can split into "screen and client" and "a11y and placement" if it grows.

## Questions for the owner

1. **What may an open case's details say about the next step while every correction is switched
   off?** The rule is never to send the person to somebody else (CLAUDE.md §3), but the corrections
   are gated on the tax adviser's answers (Q35/Q37/Q38/Q40). **Default:** each case says what
   happened, what Waitron keeps doing, that no correction can be made in Waitron yet, and "Export
   these cases for your tax adviser". Without an answer, the implementer writes the default and the
   pull request names it.
2. **Approve the exact assertion lines in Task 6** so the bell's fiscal alerts can open this screen.
   **Default if unanswered:** Task 6 is skipped; the screen lands without alert links.

Not a question, a default for the watcher: build now rather than after A1308's fi6/fi9, since this
adds no table and fi6 already expects to fold whatever filing-case route lands first.

## How this plan was checked

Read: the files and lines cited above at `1252e2b6b3`; the W41s plan, design and backlog sections;
the lane-L queue's W41s rules and RUNNER H2; A1308's fi6 plan; the self-service refusal audit.
Run (read-only, in this worktree): `git grep` for the callers of `listFilingCases`, `heldRecords`,
`openFilingCasesSummary` and `recordCaseEvent`, for "missing history" and similar, and for tests
pinning the fiscal alerts and the verifactu dashboard contribution; `git log -S` for when
`fiscal.view` and the retry route were added. No test, server or browser was run, so every
behaviour claim above about code is a reading of it, and the tasks' failing tests are where each is
first exercised.
