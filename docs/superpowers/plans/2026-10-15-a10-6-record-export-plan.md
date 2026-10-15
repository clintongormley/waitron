# A10-6 Working-Time Record Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` for native inline execution, task by task. Read `superpowers:test-driven-development` before writing implementation or tests. No implementer dispatch or per-task external review. The root driver reviews and publishes this documentation first, then owns execution and the authorised finish/land workflow. This invocation writes this plan only: no implementation, tests, commits or pushes.

**Goal:** You can download your working-time record from dashboard My Schedule, or an authorised manager can download everyone's or one person's record for any range, as PDF or CSV, including a representatives' version.

**Architecture:** Capture the rich `TimeRecord`, names and workplace through the public reader inside the existing authenticated transaction. The workforce-es provider returns a pure formatter that calls existing `exportTimeRecord` after that transaction commits. Separate server serializers consume its selected document. One dashboard dialog serves both Hours surfaces.

**Tech stack:** TypeScript, Hono, Drizzle/venue SQLite, Lit/`wt-*`, installed PDFKit 0.20.2, embedded Noto Sans, Vitest/Chromium, existing `pdfjs-dist` and canvas test dependencies. No planned dependency, manifest, lockfile or migration change.

**Specs:** Read the FULL [October A10 design](../specs/2026-10-12-a10-clocking-in-and-out-design.md) and FULL [July workforce design](../specs/2026-07-22-workforce-and-time-record-design.md), then the [part 5 plan](2026-10-15-a10-5-hours-screens-plan.md) and actual implementation. Current conventions and October decisions supersede July's historical database/tenant/role/offline language. Implement **part 6 only**.

## Global constraints

- Planning orientation: `git rev-parse HEAD` returned `d2107e4a12cfb107efda52aa13a8544ec2bda30b`; `git status --short` returned no entries before this document. These are checkout receipts, not runtime or remote-main verification.
- Before execution reread Lane F `RUNNER.md`, `queue.md`, standing `questions.md`, `CLAUDE.md`, both workforce backlogs and developer conventions for UI, design system, data/module seams, testing, writing claims, workflow, CI and dashboard live updates. Follow H2/H4/H8/H11/H12 and the changed-test ruling. Every implementation commit uses `git commit -s`; never bypass hooks.
- Automatic ends **count immediately** and remain automatic, never unconfirmed. Worker acknowledgment is separate. Preserve stored admin self-approval, originals, requests, decisions, disputes, frozen closures and later impacts. Do not infer historical approval from today's role.
- No legal research/changed legal claim, inspector remote access, payroll, period-read optimisation, writer/hash/numbering change, migration, fiscal work or root-guard edit. Export neither closes periods, reconciles attendance, sends email, appends records nor queues printing.
- Any range has **no new day/year/row cap**. Four years is not a truncation policy. Keep complete scoped-history selection and late/cross-boundary links. Do not materialise one row per empty date.
- Preserve Hours/Time corrections routes, permissions, actions, pending-work behavior and uncertain-result recovery. Existing behavioral assertions stay unless the assertion inventory explicitly authorises an additive change.
- Standing `questions.md:232–236` (2026-10-14 14:40) permits DIFFERENT translation keys/docs passages. A shared filename alone does not block independent work. B A689-5 touches boot/client/strings at other seams; E A679 setup/boot/lock; C A663 printer rendering. The driver audits committed, dirty and untracked hunks before integration. Ask the driver only about exact conflicting code hunks after independent work. Never edit foreign trees or stop foreign processes.
- Reuse installed PDF/font facilities read-only. Create attendance-specific renderers; do not refactor invoice/receipt/printer code reserved by C. Put document types in an existing shared dependency rather than changing package manifests/lockfiles.
- Focused local tests, normal pre-push hook once, package coverage/merge checks in current-head CI. Keep `98/98/98/95`, mutation floors and existing assertions; no whole-workspace local run solely to finish.

## Source map and responsibilities

These observations come from reading source, not running behavior. Recheck after main moves.

| Landed seam | Implementation consequence |
| --- | --- |
| `workforce/src/clocking.ts:276`, `record-reads.ts:20`, `record-period.ts:12` | Public `WorkforceBackend.timeRecord(tx,query)` loads scoped complete history through the internal reader, including person-filtered snapshots. No new raw event-date filter or public-reader export. |
| `workforce-es/src/registro-jornada.ts:175` | Rich overload adds `entradas`, `cierres`, `cambiosPeriodosCerrados`; sessions-only loses history. Keep this implementation and its assertions unedited. |
| `workforce/src/{record-types,projection}.ts` | Attribution, flags, snapshots, impacts and endpoint offsets exist. `Period` is `[start,end)` by local session-start date. Sessions are completed work only. |
| `module/src/module.ts:1262`, `composition/src/modules.ts` | Inspected descriptors have no time-record export seat. Add a typed seat; only composition names the Spain provider. |
| `apps/server/src/boot.ts:1817`, `management-attendance-api.ts` | Attendance already mounts for workforce-enabled singleton primary. Pass enabled descriptors' selected provider at that same mount. |
| `attendance-own-scope.ts:8`, identity `permissions.ts:26,68`, server `report-api.ts:65` | Reuse own current/historical-location checks. Own export is role-blind. Manager export uses existing `report.export`, held by manager/admin; supervisor's `workforce.correct` still controls Hours/corrections. |
| Dashboard `api/hours.ts`, `widgets/my-hours-panel.ts:80`, `screens/attendance-corrections-screen.ts:118` | Both receive authenticated `DashboardRequest`; manager screen already has Hours/corrections modes. Add a sibling API/dialog, leaving base `api/client.ts` alone. |
| `dashboard-kit/src/request.ts:24,130` | Typed blob requests carry cookies/decode refusals. Explicit download is active; options read passive. Blob GETs have no ordinary read timeout, so invalidate late completions. |
| Server `invoice-{pdf,font}.ts`, `invoice-pdf.test.ts`, `package.json` | PDFKit, embedded `assets/invoice-noto-sans.ttf`, PDF.js and canvas are installed. Test actual bytes using existing dependencies. |

Package paths above are under `packages/` unless prefixed otherwise. Exact new/modified files are assigned to tasks below. Shared types define data only; the module selector chooses the provider; Spain builds the document; the server owns HTTP/serialization; dashboard owns staged selection/download lifecycle.

## Decisions and cross-task contracts

**Range/defaults:** retain the half-open local-date contract in both UI and API. Required date labels are **From / Before** and **Desde / Antes de**, with an explanation that Before is excluded. Seed from the displayed Hours period, allow arbitrary valid four-digit calendar dates with `from < before`, and never convert through browser timezone. Default PDF/standard; manager defaults to its selected person or Everyone. Own mode has no person selector. These are routine defaults, not new legal/owner rulings.

**Document types:** create `packages/shared/src/record-export-types.ts`, exporting these types through type-only barrel exports:

```ts
type RecordExportValue = string | number | boolean | null;
type RecordExportAudience = "standard" | "representatives";
type RecordExportFormat = "pdf" | "csv";
interface RecordExportInput {
  locationId: string; personId?: string;
  period: { start: string; end: string };
  audience: RecordExportAudience; locale: "en" | "es";
}
interface RecordExportSection {
  key: string; title: string; layout: "table" | "details";
  columns: readonly { key: string; label: string }[];
  rows: readonly { key: string; cells: Readonly<Record<string, RecordExportValue>> }[];
}
interface RecordExportDocument {
  title: string; locale: "en" | "es"; audience: RecordExportAudience;
  period: { start: string; end: string };
  notes: readonly string[]; sections: readonly RecordExportSection[];
}
```

Only selected scalars enter the document, never raw records, actors, persons, origins, snapshots or HTML. Field keys are stable English machine names; labels/titles/notes are EN/ES. Renderers neither query the database nor interpret workforce/Spanish types.
Empty records include a localized empty message. Explain that only completed shifts contribute to totals; an unmatched start/break stays in history without an invented finish or elapsed total.

**Seat:** new `packages/module/src/record-export.ts` exports
`ModuleTimeRecordExport = {prepare(tx:Transaction,input:RecordExportInput):Promise<()=>Promise<RecordExportDocument>>}` and
`selectTimeRecordExport(modules:readonly WaitronModule[]):ModuleTimeRecordExport|undefined`.
Add `timeRecordExport?:ModuleTimeRecordExport` to `WaitronModule`; re-export both from its barrel.
Zero providers means unavailable, one is selected, multiple throw existing `module.config_invalid` with a fixed reason.
Do not choose the first provider or default to Spain. This handles today's enabled-module deployment; no new per-location regime column/policy.

**Provider:** `packages/workforce-es/src/record-export.ts` exports
`prepareTimeRecordExport(tx:Transaction,input:RecordExportInput):Promise<()=>Promise<RecordExportDocument>>` and
`WORKFORCE_ES_RECORD_EXPORT = {prepare:prepareTimeRecordExport}` through its barrel.
Composition assigns this object to workforce-es's descriptor. Existing dependencies suffice.
The preparer captures `new WorkforceBackend().timeRecord(tx,{locationId,personId,period})`, all referenced names and the location label. It copies input values and retains these detached snapshots, then returns `async () => formatTimeRecordExport(record,input,people,locationName)`. Invoking that closure performs no database reads. Define the file's exported pure helper
`formatTimeRecordExport(record:TimeRecord,input:RecordExportInput,people:ReadonlyMap<string,string>,locationName:string):RecordExportDocument`.
The helper calls `exportTimeRecord(record,period)` once for live history and separately for each frozen snapshot using that snapshot's stored entries/sessions and full saved period. Do not reproject frozen flags from live history.
Query only referenced `persons.id/displayName`, once for subjects/actors, and location id/name; no profile fetch or per-entry lookup.
Unknown historical actor names get localized “Unknown person” plus their internal reference, not dropped provenance.

**Field allowlist:** build literal rows, never spread raw objects and delete fields afterwards. Include:

- Metadata: workplace id/name, requested period, audience, `conservarHasta`, each `titularesAcceso` value, completed worked total and range/empty/minimization notes. Add no new legal prose. Say names are current display names, not stored historical identity snapshots.
- Sessions: `personId`, `personName`, `fecha`, `horaInicio`, `horaFin`, `minutosTrabajados`, `minutosDescanso`, plus rich session start/end offsets. Split shifts remain separate. Sum completed session minutes once; never sum history rows into totals.
- History: all `EntradaJornada` scalars: `entryId`, `personId`, `locationId`, `tipo`, `tipoEntradaFaltante`, `direccionCorreccion`, `estadoCorreccion`, `instante`, `offsetMinutes`, `corrigeEntradaId`, `respondeEntradaId`, `efectiva`, `automatica`, `sinConfirmar`, `confirmadaPorTrabajador`, `autoaprobada`, `corregida`, `disputada`. Expand `autor` to `authorKind`, `authorPersonId`, `authorName`; add selected rich-entry `recordedAt`, `nodeId`, `sequenceNo`. Emit `periodosCerrados` relations separately. Standard includes `motivo`; representatives omits its column/value entirely.
- Closures: `closureId`, `locationId`, saved period start/end, `closedAt`, `closureHash`; separate frozen-session, frozen-entry, frozen-summary and marked-automatic relation rows keyed by closure id. Frozen entries use the SAME history allowlist. Frozen summaries map `workedMinutes`, `contractedMinutes`, `dailyAccrualOvertimeMinutes`, `periodNetOvertimeMinutes`, `overtimeMinutes`; daily rows map `workDate`, `workedMinutes`, `contractedTargetMinutes`, `overtimeMinutes`. Preserve null summaries. Impacts carry `closureId`, `personId`, `beforeWorkedMinutes`, `afterWorkedMinutes`, `deltaWorkedMinutes`. Label the full saved period even when only partly overlapping the request.
- Retain worker/actor names and internal person/entry/node/closure UUIDs in both versions. These references allow you to follow originals/decisions; they are not government/personal ID numbers. Do not remove every identifier and destroy provenance.
- Neither version fetches contact/profile/login data or personal ID numbers. Representatives additionally omits free-form reasons and unselected origin/device data everywhere, including frozen entries, notes, metadata and filenames. Unknown future fields are excluded. Do not regex-scrub reasons and claim minimization.

**Machine keys:** the Spanish names above identify source fields, not output keys. Use this exact mapping in live and frozen sections: `fecha→date`, `horaInicio→startedAtLocal`, `horaFin→endedAtLocal`, `minutosTrabajados→workedMinutes`, `minutosDescanso→breakMinutes`, `tipo→entryKind`, `tipoEntradaFaltante→missingEntryKind`, `direccionCorreccion→correctionDirection`, `estadoCorreccion→correctionStatus`, `instante→eventAtLocal`, `corrigeEntradaId→correctsEntryId`, `respondeEntradaId→respondsToEntryId`, `efectiva→effective`, `automatica→automatic`, `sinConfirmar→unconfirmed`, `confirmadaPorTrabajador→confirmedByWorker`, `autoaprobada→selfApproved`, `corregida→corrected`, `disputada→disputed`, `motivo→reason`, `conservarHasta→retainUntil`, `titularesAcceso→accessHolder`. Other named English fields retain their names. Expand `autor` as specified above; relation rows use `entryId` and `closureId`. Tests assert these English keys. CSV headers retain these keys across locales; localized PDF labels remain EN/ES.

Representatives lose free-form explanations but retain structured decisions, authors, timestamps, links, flags and totals.
Names/workplace labels remain text and may contain personal information. Do not claim anonymity or that scrubbing guarantees no personal data.
The advisor's exact minimization policy remains open separately.

**Browser types:** add type-only definitions to `workforce/src/attendance-contract.ts`, re-export via `dashboard-modules/src/index.ts`:
`AttendanceExportSelection = {locationId:string;from:string;before:string;format:RecordExportFormat;audience:RecordExportAudience;locale:"en"|"es"}`;
`ManagerAttendanceExportSelection = AttendanceExportSelection & {personId?:string}`;
`AttendanceExportOptions = {available:boolean;canExportAll:boolean}`.

| Endpoint | Authority/result |
| --- | --- |
| `GET /management-api/me/attendance/export-options?locationId=UUID` | Active management session; real location; own current/historical location unless viewer holds `report.export`. Return provider availability/export capability only, no roster/profile/record. Passive. |
| `GET /management-api/me/attendance/export?locationId=UUID&from=YYYY-MM-DD&before=YYYY-MM-DD&format=pdf\|csv&audience=standard\|representatives&locale=en\|es` | Session-derived own person; `assertOwnAttendanceLocation`; no caller-supplied person/authorizer. Authenticated file bytes. |
| `GET /management-api/attendance/export?<same keys>[&personId=UUID]` | `authorizeManager(...,{permission:"report.export"})`; absent person means everyone at location, present means exactly that existing person. No additional correction/fiscal/PIN authority. |

Server `attendance-export-request.ts` defines
`parseAttendanceExportQuery(query:URLSearchParams,mode:"own"|"manager"):{selection:AttendanceExportSelection;personId?:string}`.
Reject unknown/repeated keys, missing/empty values, wrong-case enums, invalid UUIDs, impossible dates; use `requirePeriod` and `from < before`.
Normalize UUID case. Never accept `null`/`all` as a person id. Options uses a separate exact one-key parser.
Authority precedes requested-subject resolution. Invalid query: `management.request_invalid` naming the field.
Unknown person/location: `attendance.invalid`, `{reason:"record_scope_or_period"}`, 400.
Absent provider: explicitly return JSON `{error:{code:"attendance.invalid",params:{reason:"export_unavailable"}}}` with 404 after authentication. Options returns `available:false`; other `attendance.invalid` refusals keep their existing 400 status.

Server `attendance-export-api.ts` defines
`mountAttendanceExportApi(app:Hono,deps:{db:Database;cfg:{locationId:string};exporter?:ModuleTimeRecordExport},log:Logger):void`.
Call it inside `mountManagementAttendanceApi`; add optional `exporter` to that adapter's deps.
Boot passes `selectTimeRecordExport(setsToMigrate)` at the existing workforce/singleton-primary mount. This small boot hunk is deliberate; generic code adds no Spain import.
Call `exporter.prepare` under the authenticated transaction, await statements sequentially, and commit before awaiting its returned formatter or invoking either serializer. Recheck active session and own/export scope with `touch:false` before any bytes leave. The second read exists because formatting/rendering can outlive authority; it splits no record write.

**Capture cost remains:** `withTransaction` holds the writer lock (`packages/db/src/tenancy.ts:19–20`, `packages/store/src/write-queue.ts:51–59`). The existing rich reader performs complete-history reads and projection during capture, so that phase may still delay sales. Pure export formatting and PDF/CSV work run after release. This plan does not introduce a read-only snapshot API or claim fully nonblocking exports; retain the separate period-read-cost backlog item.
Return PDF or `text/csv; charset=utf-8`, attachment filename `time-record-<from>-<before>-<audience>.<ext>`, `Cache-Control:no-store`, `X-Content-Type-Options:nosniff`.
No person text in filenames/logs. Refusals keep JSON envelopes, never successful empty attachments.

## Review focus

1. Scope/late authority: own access works, all-person access requires export permission, expired/suspended/revoked viewers receive no bytes (Tasks 1/3/4).
2. Boundary history: late corrections/decisions, recorded DST offsets and frozen totals survive without moving/recounting time (Tasks 1/3).
3. Nested minimization: frozen actors/reasons, arbitrary extra fields and metadata cannot bypass the allowlist; names/links remain useful (Tasks 1/2/3).
4. Hostile/long text: spreadsheet-leading text cannot become formulas; Unicode and multi-page PDF content cannot disappear/overlap (Task 2).
5. Staged input/late downloads: changed selection, logout, disconnect/reopen and late refusals cannot download or relabel another scope's bytes (Tasks 4/5).

## Task 1: Build the module-owned document

**Files:** create shared `src/record-export-types.ts`; module `src/record-export.ts`, `record-export.test.ts`;
workforce-es `src/record-export.ts`, `record-export.test.ts`. Modify their `src/index.ts` barrels, module `src/module.ts`,
composition `src/modules.ts`/`src/composition.test.ts`, workforce-es `src/index.test.ts`.
Keep existing `registro-jornada.ts` and its tests unedited.

**Interfaces:** produces the document types, selector, preparer and pure formatter above.
Composition's assignment checks the structural seat type; workforce-es adds no module dependency.

- [ ] **RED:** selector cases assert zero unavailable, one identical provider, two exact `module.config_invalid` refusals.
  Real `useVenueDb` preparer tests invoke the returned formatter after capture and assert rich live/closure history, person-filtered snapshots, empty/open records and no invented finish.
  Distinct worker/manager/other-worker names and contact canaries must distinguish correct/wrong scope.
  Assert automatic worked minutes `480`, `automatic===true`, `unconfirmed===false`, worker acknowledgment false then true after answering.
  Stored self-approval survives a later role change. Use public writer APIs only for fixture setup. Representative assertions include:
  `expect(automatic.cells.unconfirmed).toBe(false)`, `expect(total.cells.workedMinutes).toBe(480)` and
  `expect(ownFrozenPersonIds).toEqual([workerId])`, paired with distinct all-person output.
- [ ] **Run RED:** separately run `pnpm --filter @waitron/module exec vitest run src/record-export.test.ts --reporter=dot`
  and `pnpm --filter @waitron/workforce-es exec vitest run src/record-export.test.ts --reporter=dot`.
  Expect missing selector/provider behavior; use sibling dynamic-import patterns to avoid import/setup accidents masquerading as RED.
- [ ] Implement the minimal types/selector/provider/composition binding. Use rich exports and explicit row mapping.
  Give rows stable collision-free keys across split shifts, people and closures. No per-day queries or live recomputation of saved snapshots.
- [ ] Add named boundary cases: `late correction enters and leaves the month`, `late decision keeps frozen 480/current 540`.
  Assert original/request/approval ids/authors, `recordedAt`, both boundary records, saved hash, original frozen values and `deltaWorkedMinutes===60`.
  Add overnight/DST/break fixture with different endpoint offsets and exact elapsed minutes, plus partially overlapping closure period labels.
- [ ] Pure formatter tests inject synthetic extra fields into live/frozen record/actor objects. Assert exact output row/column keys,
  no representative reason/contact/ID-number canaries, retained subject/actor names and UUID links; standard retains complete reasons.
  Empty output has metadata/zero total; unmatched in/break keeps history without a synthetic session or elapsed minutes.
- [ ] **GREEN:** rerun RED commands, workforce-es `src/index.test.ts src/registro-jornada-record.test.ts src/registro-jornada.test.ts`,
  and composition `src/composition.test.ts` with their package's `pnpm --filter <pkg> exec vitest run <paths> --reporter=dot`.
  Inspect Tests counts; commit exact paths with `git commit -s -m "feat: expose module-owned time-record export documents"`.

## Task 2: Render safe CSV and complete PDF

**Files:** create server `src/attendance-export-csv.ts`, `attendance-export-csv.test.ts`, `attendance-export-pdf.ts`,
`attendance-export-pdf.test.ts`, `test/attendance-export-fixture.ts` (under `apps/server/`). Read-only reuse of `invoice-font.ts`.

**Interfaces:** `renderAttendanceCsv(document:RecordExportDocument):Uint8Array` and
`renderAttendancePdf(document:RecordExportDocument):Promise<Buffer>`. Both accept only Task 1's selected document.

- [ ] **RED:** CSV round-trip tests parse every section/row/cell: comma, quote, CR/LF, accents, null/empty/boolean/numeric values.
  Formula cases cover names AND standard reasons starting `=`, `+`, `-`, `@`, tab and CR, including after whitespace.
  Assert ordinary text unchanged, dangerous text prefixed and trusted numeric `-60` still numeric:
  `expect(parsedName).toBe("'=HYPERLINK(1)")` and `expect(parsedDelta).toBe("-60")`.
- [ ] **RED:** PDF tests parse actual bytes with existing PDF.js (`useSystemFonts:false`), check every unique row/paragraph marker exactly once,
  page count >1 and text within A4 bounds. Include a reason longer than a page, an unbroken long token, `María Muñoz`, `José`, `niñez`,
  Unicode punctuation, unsupported glyphs, HTML/PDF-like text and controls. Assert no executable actions/attachments/unintended links.
  Empty/open documents remain readable. Assert counts as well as text so skipping a section fails.
- [ ] **Run RED:** `pnpm --filter @waitron/server exec vitest run src/attendance-export-csv.test.ts src/attendance-export-pdf.test.ts --reporter=dot`.
  Expect missing renderers. Implement CSV as UTF-8 BOM + CRLF, fixed `section,row` followed by first-seen union of document column keys;
  title/notes/period are metadata rows. Quote every cell and double quotes. Apostrophe-prefix text whose first significant character is `= + - @`
  or whose leading whitespace contains tab/CR. Apply to ALL textual cells; quoting alone is insufficient. Keep trusted numbers numeric;
  serialize booleans as `true`/`false`, null as `null`, empty text as empty text. Assert parsed CSV spellings, not recovery of JavaScript types.
  Document the deliberate spreadsheet-safe text spelling. Do not truncate long values.
- [ ] Implement PDFKit A4 with embedded font, fixed margins, measured wrapping, compact sessions and labelled detail blocks for wide history.
  Repeat headings on continuation pages; split paragraphs/tokens larger than a page without looping/clipping. Preserve supported Unicode/line breaks;
  normalize unsafe non-printing controls. Unsupported glyphs become visible `[U+XXXX]` escapes, with a localized note, rather than disappearing.
  Add page numbers without trailing blank pages. No invoice/receipt renderer changes.
- [ ] Add byte-output minimization assertions to BOTH formats, including PDF metadata and frozen sections. No forbidden canaries/reasons in representatives;
  names, offsets, decision provenance and closure links remain. Standard includes the long reason's final marker and every selected field.
- [ ] **GREEN:** rerun the command. At the actual artifact step read/apply the PDF skill; generate multi-page standard/representatives PDFs,
  render all pages to images and LOOK at every page, accents, page breaks and final markers. Extraction alone is not visual verification.
  Keep PDFs/images outside git. Commit exact paths with `git commit -s -m "feat: render working-time PDF and spreadsheet-safe CSV"`.

## Task 3: Authenticate and mount binary routes

**Files:** create server `src/attendance-export-request.ts`, `attendance-export-request.test.ts`, `attendance-export-api.ts`,
`attendance-export-api.test.ts`, `boot.attendance-export.test.ts`; modify `src/management-attendance-api.ts` deps/internal mount,
existing `src/boot.ts` attendance call; erased types in workforce `src/attendance-contract.ts`, dashboard-modules `src/index.ts`.

**Interfaces:** produces the exact parser/options/file routes above; optional provider leaves existing fixtures/callers valid.
Use enabled/migrated descriptors, never select from `ALL_MODULES`. No existing route rename or shared parser meaning change.

- [ ] **RED:** parser tables cover a valid >four-year range, leap day, adjacent windows without duplication; refuse equal/reversed endpoints,
  `2026-02-29`, `2026-02-30`, malformed/timestamp dates, missing/empty/duplicate/unknown keys, wrong-case enums, invalid UUIDs and own person injection.
  Assert exact result or `management.request_invalid` field, not merely “throws”. No length cap.
- [ ] **RED:** actual-cookie `useVenueDb` route fixtures reproduce passive middleware. Active staff own export works; staff/supervisor all-person
  refuses `authorization.not_permitted`; manager/admin all/selected works through `report.export`. Suspended viewer 403, expired/missing session 401;
  suspended subject with history remains exportable. On initial auth refusal assert provider/renderer never called, catching omission of an early gate.
  Pair every refused class with an allowed control: `expect(staffAll.status).toBe(403)`,
  `expect(body.error.code).toBe("authorization.not_permitted")`, `expect(provider.prepare).not.toHaveBeenCalled()`.
- [ ] **Run RED:** `pnpm --filter @waitron/server exec vitest run src/attendance-export-request.test.ts src/attendance-export-api.test.ts src/boot.attendance-export.test.ts --reporter=dot`.
  Expect absent parser/routes/wiring. Implement minimal parser, existence/scope/options checks, transactional prepare, post-commit formatter/serialization and final recheck.
  Driver audits exact B/E boot overlap before wiring that mount hunk; independent parser/adapter tests continue first.
- [ ] Pin current/historical own location allowed, unrelated/unknown location refused, unknown selected person refused after auth, all/one disjoint data,
  headers/MIME/no-store/nosniff/fixed filename. Use real serializers for rich standard/representatives HTTP output, not only fake buffers.
  Assert own/selected frozen snapshots exclude the other worker, offsets and late decisions survive, and before/after time rows/heads/closures/questions/mail
  are unchanged (normal management-session activity excepted). Renderer failure yields JSON, never a partial attachment.
- [ ] In the route test wrap the real provider's prepared async formatter with a controlled gate, without adding a test-only production hook; pause it after snapshot capture has committed. While paused, complete a real sale or attendance append through the normal writer queue before releasing formatting; then assert the export retains the captured values and excludes that later append. Pair with the normal current export. Moving formatter invocation back inside `withTransaction` must fail the ordering assertion. Use controlled gates and assert the writer-completion event before formatter release; an outer deadline only bounds a broken wait. This qualifies lock placement, not a bound on capture/projection cost.
- [ ] Delay rendering, expire/suspend/demote viewer, then release: final check returns refusal/no bytes; valid unchanged control downloads.
  Passive options must not renew inactivity; deliberate download follows existing activity semantics. No document text in headers/logs.
- [ ] Real `startServer` HTTP tests cover workforce+provider enabled, workforce enabled/provider disabled, workforce disabled and existing
  mirror/secondary/fenced/setup modes. Availability agrees with actual mount; disabled cases do not query workforce tables.
  Seed before starting; mutate fixture data only while stopped, using `boot.hours.test.ts`'s fixture discipline. Bare Hono mounts alone do not qualify this.
- [ ] **GREEN:** rerun RED command plus `pnpm --filter @waitron/server exec vitest run src/management-hours-api.test.ts src/management-attendance-api.test.ts src/boot.hours.test.ts --reporter=dot`.
  Preserve old session/scope/correction/boot assertions. Commit exact paths with `git commit -s -m "feat: serve authenticated working-time downloads"`.

## Task 4: Add typed downloads and a scoped staged dialog

**Files:** create dashboard `src/api/attendance-export.ts`, `attendance-export.test.ts`, `widgets/attendance-export-dialog.ts`,
`attendance-export-dialog.test.ts`, `attendance-export-dialog.unsaved.test.ts`, `attendance-export-dialog.a11y.test.ts`;
add distinct `attendance_export.*` EN/ES keys in `src/i18n/strings.ts`. No base `api/client.ts`/request changes.

**Interfaces:** `AttendanceExportApi(request:DashboardRequest)` exposes
`options(locationId:string):Promise<AttendanceExportOptions>`, `own(selection:AttendanceExportSelection):Promise<Blob>`,
`manager(selection:ManagerAttendanceExportSelection):Promise<Blob>`. Options passive; files use typed `request<Blob>(...,"GET",undefined,{as:"blob"})`.
`dashboard-attendance-export-dialog` properties: `open:boolean`, `request:DashboardRequest`, `scopeKey:string`, `mode:"own"|"manager"`,
`locationId:string`, `period:{start:string;end:string}`, `people:readonly {personId:string;displayName:string}[]`, `personId:string|undefined`.
Own mode gets no roster. Parent scopeKey is `${personId}:${generation}` in own Hours and `${lookups.viewer.personId}:${generation}`
in manager Hours, using each parent's existing `#generation`; request changes and disconnect also invalidate it. Close emits `export-close`, no record payload.

- [ ] **RED:** API tests use real `createRequest`/fake fetch: exact encoded paths, no own person, omitted everyone/person present when selected,
  cookies, passive options/active files, untouched bytes and decoded JSON 401/403. No direct fetch/window-open bypass.
- [ ] **RED:** browser dialog defaults/selection tests assert editable range, own/manager selectors, audiences/formats, exact sent selection/filename.
  Invalid first submission marks all bad fields, focuses first, and shows one bottom message; corrected fields re-enable. Server refusal permits retry
  and survives unrelated read recovery. Action quiet awaiting scope/options/selection, primary when actionable and while sending.
- [ ] **Run RED:** `pnpm --filter @waitron/dashboard exec vitest run src/api/attendance-export.test.ts src/widgets/attendance-export-dialog.test.ts src/widgets/attendance-export-dialog.unsaved.test.ts --reporter=dot`.
  Implement shared `wt-dialog`/date inputs/comboboxes, semantic `exportFrom`, `exportBefore`, `exportPerson`, `exportAudience`, `exportFormat` names,
  required marks, declared tokens, explicit locale and bottom `wt-form-actions`. No screen-owned native fields/HTML injection.
- [ ] Staged export selection uses `draftScopeFor`: detached opening baseline, `changed()` on edit/revert, commit exact sent selection only after valid
  download. Stable close guard; Cancel/Escape/navigation/locale Keep/Discard and dirty-before-detach/reconnect cases in unsaved suite.
  Forced logout/disconnect clears sensitive state, disposes scope, invalidates work; reopen owns a new generation. Ordinary Hours filters remain unchanged.
- [ ] Capture immutable selection/generation before awaiting. Invalidate on scopeKey/request/mode/person/location/period/locale/range/audience/format change,
  close/logout/disconnect. Check connected/open/current generation before creating/clicking a blob URL; old errors cannot replace a new scope's error.
  Disable submission controls while sending, still guard parent/programmatic changes. Revoke every created URL in `finally` and at teardown;
  never cache/reuse it. Filename uses validated sent values, not mutable current controls.
- [ ] **GREEN:** rerun RED command plus `pnpm --filter @waitron/dashboard exec vitest run src/widgets/attendance-export-dialog.a11y.test.ts --reporter=dot`.
  Deferred A, switch/reopen B, B success, then A success/refusal yields exactly one B download. Logout/disconnect and each changed selector yield no stale
  click; current-generation control works: `expect(clicked).toHaveLength(1)` and `expect(createdBlobs).toEqual([blobB])`.
  Spy exact URLs/create/revoke/click. Axe/keyboard cover own/manager, loading/invalid/refused, both themes.
  Commit exact paths with `git commit -s -m "feat: add scoped working-time export dialog"`.

## Task 5: Connect Hours and qualify the complete feature

**Files:** modify dashboard `src/widgets/my-hours-panel.ts`, `src/screens/attendance-corrections-screen.ts`;
create `widgets/my-hours-panel.export.test.ts`, `screens/attendance-corrections-screen.export.test.ts`; extend existing parent unsaved/a11y suites,
`src/screens/my-schedule-screen.hours.test.ts`, `src/dashboard-app.attendance.test.ts` where integration needs them.
Implementation docs: `docs/backlog.md`, `docs/backlog/workforce.md`, dated pointer in October A10 spec. No legal-table rewrite.

**Interfaces:** own parent supplies request/current session-generation scopeKey, workplace and period, never a roster;
manager supplies existing lookups people and chosen person/Everyone. Options load passively on scope entry/change.
Own button requires `available`; manager requires `available && canExportAll`. No new app-core screen/Calendar contribution/permission/lookup.
Preserve `/manage/my-schedule/view/hours`, `/manage/hours`, `/manage/time-corrections` and the existing correction mode.

- [ ] **RED:** own Hours opens own export without people; manager opens all or its selected person; displayed range is editable default, never a cap.
  Supervisor still reads/corrects Hours but has no manager export, staff cannot export all. Provider-disabled hides export while Hours works.
  Refresh retains dirty selection; scope removal/logout invalidates downloads. Time corrections keeps its queue/actions.
- [ ] **Run RED:** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/my-hours-panel.export.test.ts src/screens/attendance-corrections-screen.export.test.ts src/screens/my-schedule-screen.hours.test.ts src/dashboard-app.attendance.test.ts --reporter=dot`.
  Add minimal Hours-only action/dialog bindings; reuse parent generation/security teardown. Opening export never silently discards a correction draft.
- [ ] **GREEN:** rerun RED command and existing own-panel `test`, `unsaved`, `a11y` suites, manager-screen `test`, `hours.test`, `unsaved`,
  `hours.unsaved`, `a11y`, `hours.a11y` suites through `pnpm --filter @waitron/dashboard exec vitest run <paths> --reporter=dot`.
  These are `src/widgets/my-hours-panel[.unsaved|.a11y].test.ts` and `src/screens/attendance-corrections-screen[.hours|.unsaved|.hours.unsaved|.a11y|.hours.a11y].test.ts`,
  including each unsuffixed `.test.ts`. Preserve Fix/propose/approve/decline, self-approval and uncertain-result assertions.
- [ ] Complete qualification below, then update root/detail backlog only when finished: delete A10's open entry/narrative; move retained owner decisions/defaults
  to workforce detail **Decisions and deliberate limits** with links. Keep separate root/detail entries for inspector remote access, final legal/advisor
  minimization check, payroll/gestoría format, period-read cost, cadence changes, manager live-removal draft check, staffing and wages.
  Update root priority/implementation/spec-status paraphrases that still say part 6 is unbuilt. Add a dated built pointer to the historical October spec.
  Do not remove A10 while publishing this docs-only plan.
- [ ] Commit exact UI/docs paths with `git commit -s -m "feat: export working-time records from dashboard Hours"`.
  Announce ready for `finish-branch`; the driver continues the authorised finishing workflow.

## Assertion inventory and final qualification

Inventory consumers before editing with `rg -n 'exportTimeRecord|RegistroDeJornada|TimeRecord|report.export|workforce.correct|exports exactly|time-corrections' packages apps`.
Trace consumers before altering gates/shared fields. Existing record/projection/Spanish-export assertions remain unedited.
Intentional old-assertion changes only:

| Check | Before/after and authority |
| --- | --- |
| workforce-es `src/index.test.ts` exact exports | Same names plus `WORKFORCE_ES_RECORD_EXPORT`, `prepareTimeRecordExport`. Part 6 requires provider exports. Pure formatter is exported from its file for tests, outside the package barrel. |
| Module/composition exact pins, if present | Add optional seat/selector and Spain binding; keep module ids, migrations, classifications, permissions and fiscal seats. |
| Exact Hours UI action counts, if present | Add functioning Export in eligible Hours mode; retain all correction/queue actions/refusals. Part 6 authorises this addition. |

Disclose actual changed assertion file:line, before/after and authority in driver receipts/PR **Changed test checks** and queue FYI.
No invented runtime tests for erased type exports. Further assertion changes need concrete spec authority/driver review.

- [ ] **Critical omission controls:** in one independently installed disposable complete candidate, omit individually: post-commit formatter placement, initial `report.export`, session-derived
  own person, own-location guard, selected-person/closure filtering, final authority recheck, enabled-provider filtering, representatives allowlist paths
  (including frozen reasons/actors), CSV formula neutralization and client generation check. Each owning test must fail at its named assertion, paired with
  an allowed control. Early auth omission is caught by provider-not-called assertions; final omission by authority lost during rendering.
  Omit cross-window inclusion only in the new consumer, never protected writers. Restore and rerun focused GREEN after each. Retain commands/statuses,
  Tests counts/failing assertions and owned candidate cleanup receipts. A non-failing omission remains unfinished qualification; never swap feature files.
- [ ] **Preserved record checks:** run unedited workforce `src/record-projection.test.ts src/record-reads.test.ts src/projection.test.ts src/pay-period-closure.test.ts src/automatic-entries.test.ts src/correction-lifecycle.test.ts`
  and workforce-es `src/registro-jornada-record.test.ts src/registro-jornada.test.ts src/work-summary.test.ts`, each with `pnpm --filter <pkg> exec vitest run <paths> --reporter=dot`.
  Investigate failures; no fiscal/root-test rewrite or unrelated fiscal sweep.
- [ ] **Existing focused guards:** `pnpm exec vitest run scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/workspace-cycles.test.ts scripts/english-only.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts --reporter=dot`.
  Mostly text scans, not runtime visibility/minimization evidence. Do not modify them to pass this branch.
- [ ] **Types/builds:** run individual package typechecks for shared, module, composition, workforce, workforce-es, dashboard-modules, server and dashboard.
  Build `pnpm --filter @waitron/dashboard build` and `pnpm --filter @waitron/server build`; inspect every exit status/package selection.
  Confirm the server bundle uses the already shipped font. No new dependencies/assets/refactor of printer paths. Broaden only for actual failures/changes.
- [ ] **LOOK at compiled UI:** after refreshing reservations launch the registered implementation worktree only:
  `WAITRON_DASHBOARD_APP_DIR="$PWD/apps/dashboard/dist" wa-wt demo <name>`.
  Use server origin from `wa-wt ls`, verify `/manage/` serves hashed built assets, not Vite.
  Open My Schedule Hours/export, manager Hours/export and preserved Time corrections in **EN/ES × light/dark × 390/1280**.
  Record viewport, computed root/dialog background/text colors, control/action bounds and overflow; light/dark colors must differ.
  Exercise long names, range errors, representatives explanation, refusal/retry, keyboard close/Keep/Discard and real downloads. Confirm actual boot's
  module-disabled/permission-hidden surfaces, not only component fixtures. Stop only recorded processes you started.
- [ ] Download actual multi-page standard/representatives PDFs and CSVs from authenticated routes. Compare row/marker counts, first/last records and
  closure/impact totals against fixtures. Through the PDF skill render and LOOK at every PDF page: accents, long final markers, headings/page breaks.
  Parse CSV and inspect spreadsheet-safe cells. Keep bytes/images/commands outside git. Screenshots or extraction alone do not establish both properties.
- [ ] **One review/CI:** finish-branch's initial rebase precedes ONE normal Claude whole-branch run-it through `claude-seat.sh review-run` in an independent
  installed complete candidate. Read completed findings, fix with focused RED/minimal/GREEN, retain report. No duplicate review for unrelated rebase.
  Normal pre-push hook runs once; inspect CI scope and actual current-head package coverage/merge checks, including consumers of shared/module changes.
  A green selection guard or stale SHA is not completion evidence.
- [ ] **Driver landing:** hold successfully acquired atomic H11 `~/waitron-campaign-shared/main.lock` throughout authorised land/main update/install/cleanup;
  retry every 30 seconds up to ten minutes and checkpoint if unavailable. Release only the owned lock. Verify merge SHA, installed clean main,
  owned worktree/local/remote feature cleanup, and H12's main CI run for that exact merge SHA. Pending H12 is pending, never green.
  Driver publishes the planning docs-only change first, separately from implementation finish.

## Self-review and uncertainty

Tasks 1–5 cover part 6's range/person/format/audience matrix; rich fields, attribution/statuses, originals/decisions, recorded offsets, frozen snapshots
and late impacts have document/route assertions and both serializers. Query ambiguity, authority, nested minimization, hostile text/pagination and
stale downloads have valid controls. Each Review Focus maps to its owning tasks; cross-task signatures/names match above.

Routine choices for driver review: From/Before half-open range, PDF/standard defaults, existing `report.export` for manager files, current display names,
representative reason omission and section-based CSV. No owner clarification needed. Advisor policy/final legal text, inspector remote access,
multi-country location binding and period-read cost remain separate. Font/layout, compiled UI/PDFs, omission controls and current-head CI await execution.
This planning document claims no implemented feature or passing runtime check.

Review resolution (2026-10-15): the fresh-context read identified formatter work under the sale writer lock and inconsistent machine keys. Capture now returns a pure formatter invoked after commit; Task 3 pins concurrent-write ordering and captured-data stability. The exact source-to-English mapping above aligns both serializers and tests. Complete-history capture/projection cost remains explicitly open. No implementation or runtime verification is claimed.
