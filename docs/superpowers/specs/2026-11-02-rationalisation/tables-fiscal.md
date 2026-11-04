> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: fiscal filing and chain, card payments, adjustments

Area: Veri\*Factu filing and the fiscal chain (`fiscal-verifactu` set, plus `invoice_series`,
`daily_closes` and `daily_close_chain` from `core`), card payments (`payments` set), and
cancellations, comps and discounts (`adjustments` set today, core after README §5 U1). 36 current
tables: 18 in `fiscal-verifactu`, 3 from `core`, 10 in `payments` and 5 in `adjustments`, from each
set's latest drizzle snapshot at `main` e0da0ad18a. The earlier count of 34 predates
`fiscal_lookup_conflicts` and `fiscal_series_conflicts`, which W41s-10a (#2449) added.

Brought into line with the owner's review of 4 November 2026. Every passage this update wrote was
checked at `main` e0da0ad18a, and so was every cite kept into a file that changed since
`68732329c1`. Everything else was last read at `68732329c1` or earlier, with a `git diff` as the
receipt. Reading only: where a claim needs a measurement it is listed in section 8.

**In one line:** 36 tables become 16: 7 for filing, 1 for numbering, 1 for the daily close, 3 for cards and 4 for adjustments.

## 0. The owner's question: why ~15 fiscal tables, and does "3 or 4" hold?

The working proposal was: (1) the invoice records, unchanged; (2) one submissions row per record
holding sending state, AEAT's answer and any problem and its resolution; (3) one append-only fiscal
history log; (4) the box's fiscal identity and sending state as one row or settings.

Tested against the code, **(1), (2) and (3) hold with adjustments, and (4) breaks.** The result is
six fiscal tables, not four, and each of the two extra ones is there for a reason the code states.
W41s-10a added two more after this question was asked: the lookup conflict folds into (3), and the
series conflict stays a seventh table (1.1).

| Proposal part | Verdict | Why |
| --- | --- | --- |
| (1) records | **Holds.** The record is unchanged, under the name `verifactu_records`. | — |
| Chain head `cadenas` read from the records | **Holds — derive it.** | See 0.1. |
| Next invoice number `invoice_series.next_number` read from sales | **Holds for the number; the series stays a table.** | See 0.2. |
| (2) submissions absorbs `envios`, `acks`, `filing_cases`, `filing_case_events` | **Holds** for `envios`, `acks`, `filing_cases`. `filing_case_events` splits: its one resolution per case folds into the submission row; its notes go to (3). | `filing_cases` is one per record (unique `registro_id`), so it folds as columns; its append-only protection becomes a set-once trigger. A case has at most one resolution (`filing_case_events_one_resolution_uq`), so that folds too. See 1.1. |
| (2) absorbs `fiscal_conflict_evidence` | **Breaks** — it is many rows per record (one per sending attempt and cause). | Goes to (3) instead. |
| (3) one history log: clock checks and confirmations, conflicts, case notes | **Holds**, with every typed CHECK and unique index re-expressed per kind (section 5). | Read back on the sale path, so it needs its own indexes (section 8). |
| (3) absorbs certificate installs and reminders | **Breaks.** Installs stay a table; reminders go to `outgoing_mail`. | Installs are classified `local` (`packages/fiscal-verifactu/src/classification.ts:22-26`); the history log is `ledger`. A table has one classification. Reminders are updated in place (claim, then report: `certificate-reminders.ts:87-150`), so they are not history: they are a mail queue, and fold into `outgoing_mail` (README U4). See 1.1. |
| (3) absorbs the conflicts W41s-10a added | **Holds for the lookup conflict, breaks for the series conflict.** | A lookup conflict is one per record and names it, so it folds. A series conflict names no record, and `readActiveConflicts` joins on its series on every sale, so it stays a table. See 1.1. |
| (3) absorbs identity allocations | **Better elsewhere** — fold them into the identity table. | Each activation writes exactly one identity row and one allocation row in one transaction (`allocation.ts:437-465`); the two rows repeat the same NIF, software id and installation number (`allocation.ts:444-447` vs `:465-473`). |
| (4) identity as one row | **Breaks.** | Every record points at the identity that made it (`sif_id`), and setup, restore and promotion must refuse an installation name ever used before (`hour-history-reader.ts:225-259`; `docs/compliance/verifactu-findings.md:276-280`, "No puede repetirse nunca"). Past identities are rows, so identity is a table of identities. |
| (4) sending state as settings | **Breaks.** | It is machine state written after every AEAT reply in the same transaction as the submission rows (`drain.ts:505`, `:1244`, `:1261`), with a compare-and-clear on the incident token (`drain.ts:1261-1262`). A settings save bumps a revision and names a person; a background writer would collide with every owner save. It must also stay in `venue.db`: it commits with `envios` updates, and `node.db` is a separate file with its own write queue (CLAUDE.md §3). It stays a one-row state table. |

The fiscal tables in the target: `verifactu_records`, `verifactu_submissions`, `verifactu_history`,
`verifactu_identities`, `verifactu_sending_state`, `verifactu_certificates` and
`verifactu_series_conflicts`. Down from
18 in the `fiscal-verifactu` set. `invoice_series` (core) stays beside them.

**The names (owner, 2026-11-04).** A table in a swappable module is named after the module, not the
slot, so these are `verifactu_`, with no hyphen, because hyphens need quoting in a table name. The
slot's other module, `fiscal-none`, owns no tables (`packages/fiscal-none/src/migrations.ts`), so
nothing clashes today. `invoice_series` and `sales.fiscal_*` stay generic, because they serve either
module. Column names stay Spanish, because they are AEAT's. Every index, CHECK and trigger takes its
table's new name. This file keeps today's constraint names so they can be searched, and the mapping
in section 4 gives each table's old name.

Renaming `registros_facturacion` is the wide part. `git grep -l registros_facturacion` outside the
module and `docs/` prints 139 files at e0da0ad18a, 116 of them under `apps/`, and CLAUDE.md §5 names
it. Its append-only triggers follow by themselves: their names and bodies are built from the table
name in the classification list (`appendOnlyTriggers`, `packages/store/src/append-only.ts:68-84`),
so a rename there renames them. `scripts/append-only-triggers.test.ts` pins the list by name and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` must be re-pointed. The rename is a fiscal
slice, so the owner lands it.

### 0.1 Can the chain head be read from the records under concurrent sales? Yes.

- Writes are serial: "one write transaction runs on the venue file at a time"
  (`packages/fiscal-verifactu/src/chain.ts:85-90`, the comment on `selectHead`, which reads the head
  without a row lock for exactly this reason). A derived read inside the same write transaction is
  as safe as the current one.
- What actually refuses a forked chain is not `cadenas` but the unique index on the position,
  `registros_tenant_node_secuencia_uq (node_id, secuencia)` (`chain.ts:24-32`; drizzle snapshot
  `packages/fiscal-verifactu/drizzle/meta/0015_snapshot.json:1858-1865`). That index stays, so a derived head loses no guarantee.
- `cadenas.secuencia` is never reset; only the pointer is, and only when a new identity is
  registered (`registro-sif.ts:49-66`, `allocation.ts:448-454`). So:
  - next `secuencia` = `max(secuencia) + 1` over the node's records (the unique index serves it);
  - the predecessor = the node's record with the largest `secuencia`, **if** its `sif_id` is the
    current identity; otherwise this is the chain's first record (`PrimerRegistro = S`). This holds
    because a new identity's records always come after every earlier identity's records on the same
    node (one monotonic `secuencia` per node).
- `cadenas` is a second copy of the predecessor's huella (`cadenas.ultima_huella`). Orden HAC/1177/2024
  art. 7.i requires checking "the stored predecessor huella" before each new record
  (`docs/compliance/verifactu-findings.md:272-274`); reading it from the record itself removes the
  copy that could drift, which the `cadenas` schema comment already argues for its other four values
  (`schema/cadenas.ts:6-13`).
- A correction is a chain record like any other. W41s-8's internal correction appends a new
  `alta` through `appendToChain`, naming the record it replaces in `corrects_registro_id`
  (`chain.ts:215-249`), so it takes the next `secuencia` and the derivation above covers it. Read, not run.
- Readers to change: `chain.ts` (`selectHead`, `readChainHead`), `registro-sif.ts:191-197`
  (`esPrimerRegistro`), `apps/server/src/chain-height.ts:15-21` (Box status: height = max
  `secuencia`, last-at = the latest record's `creado_en`), and `backup-verification-chain.ts:55-140`,
  whose head-matches-records check disappears with the copy.

### 0.2 Can the next invoice number be read from the sales? Yes; the series row stays.

- Every number allocated becomes a `sales` row (`record-sale.ts:270`, `record-correction.ts:265`,
  `record-substitution.ts:171`, each followed by an insert into `sales`), and `sales` is append-only
  (`scripts/append-only-triggers.test.ts` EXPECTED list) with `UNIQUE (series_id, invoice_number)`
  (`packages/db/src/schema/sales.ts:122`). Every series starts at 1
  (`packages/db/src/reserved-identity.ts:131`, `schema/series.ts:30`).
- So next = `coalesce(max(invoice_number), 0) + 1` for the series, an index seek on that unique key,
  inside the same serial write transaction (`allocate-number.ts:14-18` gives the same reasoning for
  the current counter). A rollback returns the number exactly as today (`allocate-number.ts:20-28`).
- The series itself stays a table: sales point at it, it has a code and purpose, and a retired series
  is kept (`schema/series.ts:31-34`). It is core, not fiscal: the `fiscal-none` path numbers sales
  too.
- One consumer reads `next_number` as a consistency check, `packages/db/src/backup-evidence.ts:282`
  (`s.invoice_number >= i.next_number`). That check exists only because there is a counter to drift;
  it goes with it.
- Recommendation: derive, after the measurement in section 8 (it is a sale-path read).

### 0.3 What CLAUDE.md §5 fixes, and where each lands

| §5 invariant | Where it lives in the target |
| --- | --- |
| The node owns the fiscal identity, chain and series | `verifactu_identities.node_id`, `verifactu_records.node_id`, `invoice_series.node_id` — unchanged. |
| `registros_facturacion` is immutable; triggers are the whole enforcement | Unchanged table and triggers, under the name `verifactu_records`. |
| One minute behind the latest record: no record, no money, unless a confirmation covers it | Reads `verifactu_records` (latest by generation time, `clock-behind.ts:18-28`, index `registros_generado_idx`) and the latest confirmation naming that record (`clock-behind.ts:116-126`), now `verifactu_history` rows of kind `clock.confirmed` with `registro_id`. Section 8 lists the index it needs. |
| Never put our metadata into a hash | Unchanged (`chain.ts:47-56`). |
| Restore and promotion start a new chain under a new installation name; a name already in history is never taken | New identity row in `verifactu_identities`, with the never-reuse unique index; chain head derived per identity (0.1). The history reader reads one table instead of three. |
| Every filing-node start resets "being sent" to waiting | `verifactu_submissions.estado`, unchanged logic. |
| Nothing external blocks a sale; filing is an outbox | `verifactu_submissions` is that outbox. |

What the clock-stop rules read back, exactly: the latest record by generation time and its id
(`clock-behind.ts:18-33`); per node, the largest `secuencia` (`clock-behind.ts:38-45`); the latest
confirmation that names the latest record, by `seq` — its `confirmed_at`, `record_at` and the chain
heads stored in its proof (`clock-behind.ts:116-140`); and the open check, i.e. the check with the
largest `seq` that no confirmation names (`clock-checks.ts:38-56`). `seq`, not time, orders these,
"because the clock is what is in doubt" (`schema/clock-confirmations.ts`, the `seq` column comment).
`verifactu_history` keeps a `seq` for the same reason.

**Not the legal event log.** AEAT's *registro de eventos* is required only for non-Veri\*Factu
systems (`docs/compliance/verifactu-findings.md:419-424`). `verifactu_history` is our own audit, not
that log; a future non-Veri\*Factu module brings its own.

## 1. Target tables

The reference venue is one restaurant taking 250 bills a day of 4 lines each, open 360 days a year.

Several columns below are **set-once**: the column may go from empty to a value once, and never
change after that. A guard trigger enforces it. The same kind of trigger already guards
`bill_payments` (`packages/db/drizzle/0024_bill_payment_triggers.sql`), and each new one gets pinned
in `scripts/behavioural-triggers.test.ts`.

### 1.1 Fiscal (`fiscal-verifactu` set, `venue.db`)

**`verifactu_records`** (was `registros_facturacion`) — the legal, hash-chained invoice record.
`ledger`, append-only.

- **Unchanged:** the same 38 columns and the same 11 CHECKs.
- **Unchanged foreign keys:** `device_id` → devices (restrict), `node_id` → nodes,
  `sif_id` → `verifactu_identities`, `sale_id` → sales, and `corrects_registro_id` →
  `verifactu_records` (a correction names the record it replaces).
- **Unchanged unique indexes:** `registros_tenant_node_secuencia_uq (node_id, secuencia)`;
  `registros_identidad_uq (id_emisor_factura, num_serie_factura, fecha_expedicion_factura,
  tipo_registro)`, which applies only where `corrects_registro_id is null`, so a correction may
  share its original's invoice identity; and `registros_corrects_registro_uq (corrects_registro_id)`,
  so a record is replaced at most once.
- **Unchanged plain indexes:** `registros_sale_idx` and `registros_generado_idx`.
- **One change proposed:** drop `registros_node_secuencia_idx (node_id, secuencia)`. It is a plain
  index on exactly the columns of the unique index above (`schema/registros.ts:121` and `:128`), so
  the unique index serves every query it serves.
- **Rows:** about 250–260 a day, about 92,000 a year.

**`verifactu_submissions`** (was `envios`; absorbs `filing_cases` and `acks`) — one row per record,
holding its sending state, AEAT's answer, and the problem case if one was opened. `ledger`, not
append-only, with a guard trigger.

| Column | Type | Key / null | From |
| --- | --- | --- | --- |
| `registro_id` | text | PK, FK → verifactu_records | envios |
| `estado` | text | not null, CHECK in (pendiente, enviando, aceptado, aceptado_con_errores, rechazado, detenido, retenido) | envios |
| `intentos` | integer | not null | envios |
| `proximo_intento_en` | text | not null | envios |
| `incidencia`, `technical_incidence` | integer flag | not null | envios |
| `csv`, `codigo_error`, `mensaje_error` | text | null | envios |
| `enviado_en`, `confirmado_en`, `reconciled_resubmit_at` | text | null | envios |
| `case_cause` | text | null, set-once, CHECK `<> ''` | filing_cases.cause |
| `case_evidence` | JSON text | null, set-once | filing_cases.evidence |
| `case_opened_at` | text | null, set-once; CHECK: the three case columns are all null or all set | filing_cases.opened_at |
| `case_resolved_at`, `case_resolved_by` (FK → persons), `case_resolution_action` | text | null, set-once; all null or all set, and only on a row whose case is open | filing_case_events `recorded_at`, `person_id`, `action` (kind `resolved`) |
| `case_resolution_key` | text | null, set-once, UNIQUE; set with the three above | filing_case_events.action_key (kind `resolved`) |
| `case_remedy_registro_id` | text | null, set-once, FK → verifactu_records; never this row's own record | filing_case_events.remedy_registro_id |

- **Protections kept:** `envios_estado_ck`, `envios_drenaje_idx (estado, proximo_intento_en)` and
  `envios_confirmado_idx (confirmado_en)`.
- **New partial index** on `(case_opened_at) WHERE case_opened_at is not null`, for the alert read
  and the sale-path read (section 8).
- **New guard trigger:** `registro_id` is fixed, and the case and resolution columns are set-once.
  - This replaces the append-only triggers of `filing_cases` and `filing_case_events`.
  - "One resolution per case" (`filing_case_events_one_resolution_uq`) is now built into the shape.
  - It also replaces `filing_cases`' unique index on `registro_id`; the primary key now does that
    job.
- **The case's own id goes.** Its readers use `registro_id` instead: `conflict-recovery.ts:79,93`, the
  join in `readActiveConflicts` (`conflict-evidence.ts:58`), each remedy request's `caseId`
  (`record-remedy.ts:42`), `releaseBrakeHold`'s join (`drain.ts:1033`), and the `case_id` columns of
  `filing_case_events` and `fiscal_lookup_conflicts`. Read, not run.
- **Resolution columns are added.** Four of W41s-8's five remedy actions record a `resolved` event
  through `recordCaseEvent` (`record-remedy.ts:184`, `record-remedy-absent.ts:158`,
  `record-remedy-corrective.ts:151`, `record-remedy-held.ts:100`); the fifth, releasing the first
  brake-held record, records a `note` (`record-remedy-brake.ts:62`). The server's set of enabled
  remedies is empty (`record-remedy-routes.ts:20`), and `admitRecordRemedy` refuses a remedy not in
  that set before anything is written (`record-remedy.ts:37`). So no production box writes these rows
  yet; the writers exist, so the table is folded, not deleted.
- **Weaker in one way:** today one unique index on `action_key` covers notes and resolutions
  together (`filing_case_events_action_key_uq`). Split, the resolution's key is unique among
  submission rows and a note's key among `verifactu_history` rows, so the database no longer refuses
  one key reused across the two. `recordCaseEvent` would have to look in both places.
- **Rows:** about 92,000 a year, one per record.

**`verifactu_history`** — the fiscal module's own append-only log. It holds clock checks, clock
confirmations, conflicts AEAT reported, lookup conflicts, and case notes. `ledger`, append-only. This is the module's
own log, not `activity_log` (README §3): product code decides from it on the sale path.

| Column | Type | Key / null | Notes |
| --- | --- | --- | --- |
| `id` | text | PK | |
| `seq` | integer | not null, UNIQUE | `max(seq)+1` in the write transaction, as `clock-checks.ts:60-70` does today. `seq` orders the log, not time, because the clock is what is in doubt |
| `kind` | text | not null, CHECK in (`clock.check_opened`, `clock.confirmed`, `conflict.observed`, `conflict.lookup`, `aeat.answer_cleared`, `case.note`) | `case.note` from `filing_case_events` kind `note` |
| `event_key` | text | null, UNIQUE | Natural idempotency key: `clock.confirmed:<check id>` (one confirmation per check), `conflict:<registro>:<attempt>:<cause>`, `lookup:<registro>` (one lookup conflict per record), and a note's `action_key` |
| `node_id` | text | not null, FK → nodes | |
| `at` | text | not null | The box's time when written |
| `registro_id` | text | null, FK → verifactu_records | The record a confirmation, conflict or cleared answer names |
| `ref_id` | text | null, FK → verifactu_history(id) | A confirmation's check |
| `person_id` | text | null, FK → persons | Identity folds into core, so the key is possible now (README U1, U11) |
| `data` | JSON text | not null | The kind's own fields, listed in section 3 |

- **Protections:** the append-only triggers, `seq` unique and `event_key` unique.
- **Per-kind CHECKs,** written with `json_extract`, re-create every current CHECK (section 5).
- **Indexes:**
  - `(kind, seq)`, to find the open check.
  - `(registro_id, kind, seq)`, for the clock stop's "latest confirmation naming this record".
- **Rows:** normally a handful a year; tens after a clock or restore incident.

**`verifactu_identities`** (was `registro_sif`; absorbs `fiscal_allocations`). It lists every
installation identity this box has signed under, and the approval that granted each one. `ledger`,
not append-only, with a guard trigger. A1018 slice 5a (#2428) changed what an `approval` may hold, not
the schema: a promotion whose old box gave up filing stores a version 2 approval saying so
(`packages/fiscal-verifactu/src/allocation-envelope.ts:402-404`).

| Column | Type | Key / null | From |
| --- | --- | --- | --- |
| `id` | text | PK | registro_sif.id (= fiscal_allocations.sif_id) |
| `node_id` | text | not null, FK → nodes | both |
| `nif` | text | not null | registro_sif.nif = fiscal_allocations.taxpayer_nif |
| `id_sistema_informatico` | text | not null | = fiscal_allocations.software_id |
| `numero_instalacion` | text | not null, CHECK length 1–30 | = fiscal_allocations.installation_identity |
| `environment` | text | not null | fiscal_allocations.environment |
| `event_key` | text | not null, UNIQUE | fiscal_allocations.event_key (was its PK) |
| `allocation_key` | text | not null, UNIQUE | fiscal_allocations.allocation_key |
| `allocation`, `approval`, `bases`, `result` | JSON text | not null | fiscal_allocations |
| `registrado_en` | text | not null | registro_sif.registrado_en (= activated_at, same transaction) |
| `revocado_en` | text | null, set-once | registro_sif |

- **Protections kept:**
  - `registro_sif_numero_ck`.
  - `registro_sif_instalacion_uq (nif, id_sistema_informatico, numero_instalacion)`.
  - `fiscal_allocations_identity_uq (nif, id_sistema_informatico, environment, numero_instalacion)`,
    kept as its own unique index. It is the backstop that stops an installation number being reused
    in any environment.
  - `registro_sif_activo_uq (node_id) WHERE revocado_en is null`.
- **New guard trigger:** every column is fixed except `revocado_en`, which is set-once.
- **`revocado_en` stays a column** rather than being derived. Readers across the package filter on
  it (`git grep -n "revocadoEn\|revocado_en"` in `packages/fiscal-verifactu/src` lists them), and the
  partial unique index depends on it.
- **Start again** is allowed only while no record exists (`start-again-holdings.ts:13-27`). It deletes
  these rows the way it deletes `fiscal_allocations` today (`FISCAL_START_AGAIN_DELETABLE`,
  `start-again-holdings.ts:6`).
- **Rows:** 1, plus one per restore or promotion.

Why the fold is sound:

- In product code, every identity row is written by `activate` (`allocation.ts:437-473`), together
  with exactly one allocation row naming it.
- `registro_sif` has two other writers, `registerSif` and `writeReservedSif`. Neither has a non-test
  caller: `git grep -n "\bregisterSif\b\|\bwriteReservedSif\b" -- 'packages/*.ts' 'apps/*.ts'
  ':!*.test.ts'` finds only their definitions and test fixtures.

**`verifactu_sending_state`** (was `envio_flujo`) — AEAT's flow-control gate. `ledger` (as today), one
row. It holds:

- when the next send may go;
- the wait AEAT last set (Orden HAC/1177/2024 art. 16.2, `docs/compliance/verifactu-findings.md:459-461`);
- the token of an open technical incident.

- **Columns:** `id` integer PK, CHECK `= 1`; `proximo_envio_en` text not null; `tiempo_espera_seg`
  integer not null; `technical_incident_token` text null.
- **Protections:** `envio_flujo_singleton_ck`.
- **Rows:** 1.
- It is not a settings document; section 0 explains why.

**`verifactu_certificates`** (was `fiscal_certificate_installs`) — one row per AEAT certificate installed
on this box. The newest is the one in use (`certificate-record.ts:8-13`). `local`, append-only.

- **Unchanged:** all 14 columns.
- **Protections unchanged:** the three CHECKs (source, kind, proof of a dashboard install) and the
  index on `(node_id, installed_at)`.
- **`person_id` keeps no key, unlike the other person columns here.** A `local` table may not hold a
  key to a `ledger` or `state` one (CLAUDE.md §3).
- **The sealed certificate itself** stays in `venue_credentials`, today `tenant_credentials`
  (`certificate-install.ts:235-242`, another area).
- **Rows:** 1–2 a year.

**`fiscal_certificate_reminders` goes: its rows become `outgoing_mail` rows** (README U4). It is a
queue with a dedupe rule, and `outgoing_mail` must carry what it does today:

- one mail per certificate, stage and person, which is today's unique index;
- a mail claimed or reported `unknown` is never sent again, and a `failed` one is retried once its
  report is a day old (`certificate-reminders.ts:54-56`, `:12`);
- the rule that no email address is stored here: the row names the person
  (`schema/certificate-reminders.ts`, the `person_id` comment), so the address is read at sending.

The deciding half stays in this module: `claimReminder` works out the stage and queues the mail
(`jobs.md` R6). Three points follow, and `outgoing_mail` has no column design yet:

- `outgoing_mail` needs a unique key that can hold (certificate, stage, person). It cannot be a
  foreign key: `verifactu_certificates` is `local` and `outgoing_mail` is not.
- These rows were `local`, kept per node, and `outgoing_mail` lives in the copy a second box takes.
  Whether that box could send a reminder twice is not settled here: the `outgoing_mail` design must
  say.
- `packages/handover/src/manifest.ts:95`, `backup-verification-secrets.ts:17` and
  `backup-verification-history.ts:443` name the table and lose it.

**`verifactu_series_conflicts`** (was `fiscal_series_conflicts`) — an invoice in one of our series that
this box has no record of, learned by asking AEAT. W41s-10a (#2449) added it; `ledger`, append-only.
It stays a table: the row names no record, so it has no `registro_id`, and `readActiveConflicts` joins
on its series on every sale (`conflict-evidence.ts:104-121`), which from `verifactu_history` would be a
read from JSON on the sale path. It keeps today's shape under the naming rule, with its unique
`(sif_id, invoice_identity)` and its keys.
- **Rows:** none normally: one row per conflict the reconciliation finds.

**The lookup conflict folds into `verifactu_history`** (was `fiscal_lookup_conflicts`, also from
W41s-10a): a record of ours whose stored copy differs from AEAT's. It becomes kind `conflict.lookup`
(section 3).
- Its `event_key`, `lookup:<registro>`, does the job of the unique `registro_id`: `reconcile-conflicts.ts:19-21`
  inserts with "do nothing on a conflict", now targeting `event_key`.
- `case_id` goes, because the case is now the same record's submission row.
- Readers: `readActiveConflicts` (`conflict-evidence.ts:48`, `:66`, `:73`), `conflict-recovery.ts:87-95`,
  and the list of keys at `backup-verification-history.ts:437-438`, which loses both rows. Read, not run.

### 1.2 Invoice numbering and the daily close (`core` set)

**`invoice_series`** — a numbering series a node issues from. `state`.

- **Columns:** `id` PK, `node_id` FK → nodes, `code`, `purpose`, `retired_at` null.
- **`next_number` is dropped.** The next number is `max(invoice_number)+1` over `sales` for the
  series (section 0.2).
- **Protections kept:** `invoice_series_node_code_key (node_id, code)`, `invoice_series_purpose_ck`
  and `invoice_series_code_ck`.
- **`invoice_series_next_number_ck` goes with its column.** Its guarantee (`>= 1`) is now held by
  `sales_invoice_number_ck` (`sales.ts:148`).
- **Rows:** 3, plus 3 per restore.

**`daily_closes`** — the frozen end-of-day cash close, one row per node and business day. `ledger`,
append-only, hash-chained per node. It stays (owner, 2026-11-04), with `recordDailyClose`,
`computeDailyClose` and the chain columns. No route calls `recordDailyClose` yet: only
`apps/server/scripts/daily-close-z-demo.ts` does. Backlog A1325 lists the feature that will, and the
question of whether the chain is wanted sits in its design.

- **Unchanged:** every column, the FK to nodes, and the uniques `(node_id, business_day)` and
  `(node_id, sequence_no)`. `closed_by` gains a key to `persons` (README U11).
- **`daily_close_chain` goes,** as a copy (R6). The head is the node's close with the largest
  `sequence_no`, read inside the same write transaction, as for the fiscal chain. That read is served
  by the `(node_id, sequence_no)` unique index, which also refuses two closes in one position.
- **Readers to change:** `selectHead` and `readChainHead` (`packages/reporting/src/record-daily-close.ts:228-260`),
  the update at `:82`, `verifyDailyCloseChain`, the backup check
  (`packages/reporting/src/backup-verification.ts:36-92`) and `CORE_BACKUP_TABLE_POLICIES`
  (`packages/db/src/backup-evidence.ts:101`).
- **What this costs:** the walk can no longer see a deleted tail. Today the head table catches the
  newest closes being deleted (`tail_truncation`, `missing_head`,
  `packages/reporting/src/verify-daily-close-chain.ts`), because the survivors still link up. The
  append-only triggers refuse that delete, and they are what stops it; the head table was a second
  look. Anyone able to drop the triggers could also edit the head row in the same file.
- `business-day-start.ts:121` and `venue-details.ts:98` keep their checks, unchanged.
- **Rows:** 0 until A1325; then one a day per node.

### 1.3 Card payments (`payments` set)

**`payments`** (absorbs `payment_resolutions`, `payment_holds` and `payment_hold_outcomes`) — one
row per card payment, moving through its states. `ledger`, not append-only, with a new guard trigger.

- **Kept: all 21 columns** — `id`, `working_order_id`, `source`, `device_id`, `sale_id`,
  `node_id`, `reader_id`, `provider`, `payment_ref`, `external_ref`, `card_scheme`, `card_last4`,
  `card_entry_mode`, `card_auth_code`, `amount`, `state`, `settled_at`, `reconcile_remediated_at`,
  `created_at`, `updated_at` and `bill_payment_id`.
- **New column `requested_by`:** null, FK → persons, fixed once written: who started the card payment
  (owner, 2026-11-04; `tables-people.md` §7). It replaces the attendance poller's in-flight snapshot.
- **`node_id` stays.** Since A764, #2422, it is the
  payment's collection owner, the box that started it (`packages/payments/src/schema/payments.ts:57`).
  `insertPayment` writes it (`store.ts:87`), and the card sweep's `listAttempting` reads only
  rows whose owner is in the set `sweepOwners` builds: this box, and on the primary, rows with no
  owner (`packages/payments/src/store.ts:515-521`, `apps/server/src/boot.ts:544-546`).
  `listAttempting` also takes a list of boxes taken over from, which `sweepOwners` leaves empty
  (`boot.ts:541`: "Taking over from another box is not built yet"). Read, not run.

Folded in (owner, 2026-11-04), all null and set-once, with `resolved_by` and `hold_decided_by` as keys to `persons`:

| Columns | From | Extra CHECK |
| --- | --- | --- |
| `resolution_outcome` (captured/failed), `resolution_cancelled_at_provider`, `resolution_provider_status`, `resolved_by`, `resolved_at` | payment_resolutions | Outcome and `resolved_at` both null or both set; `cancelled_at_provider = 0 or outcome = 'failed'` (`0008:13-14`) |
| `hold_provider_amount`, `held_at` | payment_holds | Amount > 0 (`0009:20`); both set or neither |
| `hold_outcome` (refunded_at_provider/kept), `hold_note`, `hold_decided_by`, `hold_decided_at` | payment_hold_outcomes | An outcome only on a held row; note null or non-blank (`0009:9-10`) |
| — | the race guard in `holds.ts:48` and `store.ts:831` | New CHECK `held_at is null or reconcile_remediated_at is null` |

- **Protections kept:** every current CHECK and foreign key (listed in section 5), the unique
  `payments_provider_ref_key`, the partial uniques `payments_provider_external_ref_key` and
  `payments_bill_payment_key`, and the four plain indexes.
- **One resolution, one hold and one hold outcome per payment** was three unique indexes. It is now
  built into the shape of the table, because each is a set of columns on the one row.
- **The three tables' append-only triggers** become the set-once guard, which is new on `payments`.
  It also turns the "hold or reversal, never both" race guard into a database check.
- **Rows:** about 150–200 a day, about 60,000 a year.

**`payment_refunds`** — one row per refund attempt at the provider, succeeded or failed. `ledger`, and
**now declared append-only**: it is already insert-only, since no product code updates or deletes it.

- **Columns:** `id`; `payment_id` FK → payments (restrict); `amount`, CHECK > 0; `state`, CHECK in
  (succeeded, failed); `authorized_by` null; `provider_refund_ref` null; `created_at`.
- **Dropped: `provider` and `payment_ref`.** They copy the parent payment's own columns.
- **The index on `payment_id` stays.** The refund ceiling sums over it (`store.ts:241-267`,
  `:678-691`).
- **Rows:** about 400–1,000 a year.

**`card_readers`** (absorbs `card_reader_holders`) — one row per registered card terminal. `state`.

- **Columns:** `id` PK, `provider`, `provider_ref`, `name`, `prints_own_slip_automatically`,
  `created_at`, `disabled_at` null, `unpaired_at` null, `deleted_at` null.
- **New column `held_by_device_id`:** null, FK → devices ON DELETE SET NULL. It was
  `card_reader_holders.device_id`.
- **Dropped: `active`.** Every writer sets it together with `disabled_at`, so it is just
  `disabled_at is null`. The sites, from the payments research: `payments-api.ts:569` and
  `:626-627`; `card-reader-delete.ts:219-220`, `:252` and `:284-286`; `boot.ts:529-530`.
- **Dropped: `card_reader_holders.held_at`.** It is written but never read.
- **Protections:**
  - Kept: the partial unique `card_readers_provider_ref_key (provider, provider_ref) WHERE
    deleted_at is null`.
  - "One holder per reader" was the holders table's primary key. It is now built into the shape,
    because the holder is a single column on the reader's row.
  - No unique index on `held_by_device_id`. One device holding two readers is not refused today.
    A unique index would also refuse the takeover, which takes the new reader at
    `device-readers.ts:350` before releasing the old one at `:413`.
- **Rows:** 2–4.

**A profile's card readers become a list on the profile** (owner, 2026-11-04):
`device_profiles.card_readers`, `{ids: [...], defaultId}`, under README's exception to R4 for short
lists owned by one row (`tables-devices.md` §1). `device_profile_card_readers` goes.

- It stays the same list: in order, with at most one default, and people see and edit it
  (`payments-api.ts:976-1027`).
- Reads go by profile. The searches by reader are the delete impact and the delete itself
  (`card-reader-delete.ts:120-137`, `:278`), which walk the lists instead.
- The writer takes over what the keys did: "the default is on the list" is already there
  (`setProfileReaderList`, `device-readers.ts:68-69`), and the route's `requireKnownReader`
  (`payments-api.ts:1013`) moves into it, along with no duplicates, which the route also checks.
- `card_readers` is not exported in a configuration today, so this column goes in `device_profiles`'
  `omit` list.

**`device_card_readers` becomes the column `devices.card_reader_id`** (owner, 2026-11-04). Null means
"use the profile's default". It sits beside `devices.receipt_printer_id`
(`packages/db/src/schema/devices.ts:30-56`). This puts a payments column on a core table.

- **It has no foreign key, unlike the printer columns.** `packages/db` cannot name a table of the
  switchable `payments` set, and in trading mode a box migrates only its enabled sets. A stand-in test
  showed that a key to an absent table refuses every insert into `devices`, even with a null reader
  (`tables-devices.md` §1.1). This reverses README U11's first bullet, which kept the link table for
  this reason. The owner's decision came later, and is what this file applies.
- **What replaces `restrict`:** `selectDeviceReader` already checks the reader
  (`device-readers.ts:325-338`), and the delete clears the column (`card-reader-delete.ts:277`). Readers
  are only ever soft-deleted, so the restriction has never fired.
- `device-readers.ts`, `payments-api.ts:773-782`, `device-delete.ts` and `card-reader-delete.ts` read
  or write the column instead of the table. All of them are in `packages/payments` or `apps/server`.

### 1.4 Adjustments (core set after U1; the code stays in `packages/adjustments`)

**`adjustment_reasons`** — the list of reasons staff pick from. `state`.

- **Unchanged:** the 12 columns, the unique `name`, and the seven CHECKs.
- **`apply_roles` and `approver_roles` stay JSON arrays,** under the R4 exception for short lists
  owned by one row (owner, 2026-11-04). Today they hold the role enum (`staff`, `supervisor`,
  `manager`, `admin`). Once A1002 lands they hold role ids (A1002 §4 and §7), so they need what every
  other JSON id list needs: the configuration import must rewrite ids inside them, and deleting or
  retiring a role must clear it from them (A1002 §6).
- **Rows:** 9–15.

**`adjustments`** — one row per cancellation, comp or discount. `ledger`, append-only.

- **Dropped: `comped_extras`.** It is a JSON list of `working_order_lines` ids that no product code
  reads: it is built at `adjustments-apply.ts:930-935` and written at `record.ts:61` (from the
  adjustments research). The extras it names already get their own `adjustment_lines` rows
  (`adjustments-apply.ts:1301-1326`).
- **`splits` breaks R4.** It is a JSON list of `{from, to}` line ids, read by
  `receipt-adjustments.ts:107,155-156`. Section 8 says what must be checked before it can move into
  `adjustment_lines`.
- **Unchanged:** the other 27 columns, the FK to working_orders (restrict), the seven CHECKs and the
  three indexes.
- **Rows:** about 15–30 a day, 5,000–11,000 a year.

**`adjustment_lines`** — which bill lines a comp or discount lowered, and by how much. `ledger`,
append-only.

- When a line is split or copied, copies of its rows are inserted, so the table tracks where
  reductions sit now (`apps/server/src/order-portions.ts:203-230`).
- **Unchanged:** the FK (restrict), the unique `(adjustment_id, line_id)` and the index on `line_id`.
- **Rows:** 7,000–20,000 a year.

**`adjustment_refunds`** — links a refund to the cancelled dishes it paid back, and the amount each
covered. `ledger`, append-only.

- **Unchanged:** both FKs (restrict), the unique pair, and the CHECK that the amount is above zero.
- It is a link table with a foreign key on both sides, so R7 keeps it.
- **Rows:** a few hundred a year.

### Count

The 36 current tables become **16 target tables**: 7 fiscal, 1 for numbering, 1 daily close, 3 for payments and 4 for adjustments. The design also adds
one settings row (`adjustments`), and two columns outside this area: `devices.card_reader_id` and
`device_profiles.card_readers`. `refunds` is the orders area's.

## 2. Settings documents

**`settings` row `adjustments`.** It comes from `adjustment_settings`, a one-row table (CHECK
`id = 1`).

| Field | Type | Default | From |
| --- | --- | --- | --- |
| `maxBillComp` | integer cents or null | null (no limit) | `adjustment_settings.max_bill_comp`; its CHECK `> 0` moves to validation |
| `billApproverRoles` | array of role enum, role ids once A1002 lands | `["manager", "admin"]` (`schema/settings.ts:17-19`) | `adjustment_settings.bill_approver_roles`; its "non-empty" CHECK moves to validation. Under A1002 it needs the same handling as the reason lists (1.4), through the settings path of the configuration import (README U2) |

**`payment_policy` adds nothing to a settings document.** It is deleted (owner, 2026-11-04): the
owner chose to drop taking cards while the card network is down. `settings.payments` exists for other
reasons (`environment.md`).

**No `fiscal` row.** None of the fiscal tables holds configuration; `verifactu_sending_state` is
machine state (section 0).

## 3. History

### Typed history the product reads back

**`verifactu_history`** is read by:

- `clock-behind.ts:116-140` — whether a confirmation covers this clock reading. It runs on every
  record write while the clock is behind.
- `clock-checks.ts:38-70` — the open check, and the next `seq`.
- `clock-misdated.ts:52-64` and `clock-stop-incidents.ts:205-216`.
- `readActiveConflicts` in `conflict-evidence.ts`. It runs on every sale, through
  `refuseNewIssuance` (`backend.ts:187`) and `assertNoActiveConflict` (`conflict-evidence.ts:25`).
- For `case.note`: `listFilingCases` (`filing-cases.ts:180`), which lists each case with its events,
  and `recordCaseEvent` (`filing-cases.ts:109`), which looks up an earlier event by its action key so
  a retried request returns it.

Its kinds, and what each one's `data` holds:

- **`clock.check_opened`** (from `clock_checks`): `reason` (start, change, behind_chain, disagrees)
  and `detail`.
- **`clock.confirmed`** (from `clock_confirmations`):
  - In `data`: `boxClockAt`, `confirmedAt`, `stepMs`, `source` (authority, devices, admin, staff,
    elapsed), `reason` (start, change, behind_chain, disagrees, unusable), `proof` and `recordAt`.
    `proof` holds the chain heads as `{node id: secuencia}` (`clock-behind.ts:51-62`).
  - As columns: `registro_id`, `ref_id` (the check) and `person_id`.
- **`conflict.observed`** (from `fiscal_conflict_evidence`): `attempt`, `cause`
  (fiscal.huella_divergente, fiscal.duplicado_anulado) and `evidence`, with `registro_id` as a column.
  Its old `case_id` is dropped: the case is now the same record's submission row.
- **`conflict.lookup`** (from `fiscal_lookup_conflicts`): `evidence` in `data`, `registro_id` and `at`
  (its `recorded_at`) as columns, and `event_key` `lookup:<registro>`. Its `case_id` is dropped the same
  way.
- **`case.note`** (from `filing_case_events` kind `note`): `action` in `data`; `registro_id` (the
  case's record), `person_id` and `event_key` (the action key) as columns.
- **`aeat.answer_cleared`** (new; owner, 2026-11-04) keeps the values a submission row held — `csv`,
  `codigo_error`, `mensaje_error` and `confirmado_en` — written just before they are cleared:
  - by reconcile, for a resubmission (`remediateNoTrace`, `reconcile.ts:535-548`);
  - by a hold, which clears the CSV (`drain.ts:934`).

  Today those values are overwritten and lost, yet AEAT says the CSV "no podrá ser recuperado a
  través de consultas posteriores": it cannot be fetched again later (`schema/envios.ts`, the
  comment on `csv`). It writes a few rows a year at most.

**The other typed tables read back:**

- **`verifactu_certificates`** — `latestInstall` (`certificate-record.ts:8-13`), read by the certificate
  card, the alerts, diagnosis and the reminders.
- **`verifactu_identities`** — the history reader refuses an installation name that was already used
  (`hour-history-reader.ts:225-259`).
- **`adjustments`, `adjustment_lines` and `adjustment_refunds`** — the reports and the per-bill
  limits (`reports.ts:283-345`, `record.ts:101-124`, `refund-links.ts:57-68`).
- **`payment_refunds`** — the refund ceiling (`store.ts:238-264`).

### To `activity_log`

For people to read: product logic never decides from these (README §3). Today they leave no trace at
all, because the row is overwritten. They are follow-ups, not built in this work (README U11).

| `kind` | Subject | Written by today |
| --- | --- | --- |
| `card_reader.added`, `card_reader.renamed`, `card_reader.disabled`, `card_reader.enabled`, `card_reader.unpaired`, `card_reader.deleted` | card_readers | `apps/server/src/payments-api.ts:564,597,624,841`; `card-reader-delete.ts:217,251,281`. Re-enabling clears `disabled_at`, so the earlier disable is lost |
| `device_profile.card_readers_changed` | device_profiles | `setProfileReaderList`, which deletes and re-inserts the list (`device-readers.ts:71-83`) |
| `adjustment_reason.created`, `.changed`, `.deleted`, `.reordered` | adjustment_reasons | `packages/adjustments/src/operations.ts:173-258`; a delete is a hard delete (`:233-237`) |

Saves to `settings.adjustments` are logged however the shared `settings` table logs saves.

## 4. Mapping

| Current table | Fate | Why |
| --- | --- | --- |
| `invoice_series` | keep (drop `next_number`) | Sales point at the series; the next number is `max(invoice_number)+1` over sales (0.2). |
| `daily_close_chain` | delete | A copy of the latest close's sequence and hash (R6): the head is read from `daily_closes` (1.2). |
| `daily_closes` | keep | Built and sound, and A1325 plans to use it (owner, 2026-11-04). `recordDailyClose`, `computeDailyClose` and the chain columns stay. |
| `card_reader_holders` | merge into `card_readers` | One row per reader (PK `reader_id`), so it becomes `held_by_device_id`. |
| `card_readers` | keep (drop `active`) | A real thing; `active` is just `disabled_at is null`. |
| `device_card_readers` | merge into `devices` (`card_reader_id`) | One row per device (PK `device_id`) (owner, 2026-11-04). A plain id, with no foreign key (1.3). |
| `device_profile_card_readers` | fold into `device_profiles.card_readers` | A list owned by one profile, under the R4 exception (owner, 2026-11-04). |
| `payment_hold_outcomes` | merge into `payments` | One per hold (unique `hold_id`), and one hold per payment; set-once columns. |
| `payment_holds` | merge into `payments` | One per payment (unique `payment_id`); set-once columns. |
| `payment_policy` | delete | The owner chose to drop taking cards while the card network is down (2026-11-04). It has no product writer; only the configuration import copies it in and out. See below. |
| `payment_refunds` | keep, append-only | The provider's record of each refund attempt; drop two columns copied from the payment. |
| `payment_resolutions` | merge into `payments` | One per payment (unique `payment_id`); set-once columns. |
| `payments` | keep | A real thing. Gains a guard trigger and `requested_by`. |
| `acks` | delete | No product reader (the brief's grep), and its `state` and `csv` repeat `envios`. |
| `cadenas` | delete (derive) | The chain head is the latest record on the node (0.1). |
| `clock_checks` | → fiscal history | Append-only events, read back in `seq` order. |
| `clock_confirmations` | → fiscal history | The same; "one per check" becomes the unique `event_key`. |
| `clock_stop_restarts` | delete | Written by nothing (`schema/clock-stop-restarts.ts:6`). |
| `envio_flujo` | rename to `verifactu_sending_state` | Machine state that commits together with the submission rows; not a setting. |
| `envios` | rename to `verifactu_submissions` | One per record. It changes over time, so it cannot fold into the unchangeable record. |
| `filing_case_events` | split: the resolution → set-once columns on `verifactu_submissions`; notes → fiscal history (`case.note`) | One resolution per case (partial unique on `case_id`), so it folds as columns. `recordCaseEvent` writes it for W41s-8's five remedy actions, all disabled in production until a remedy is enabled (1.1). |
| `filing_cases` | merge into `verifactu_submissions` | One per record (unique `registro_id`); set-once columns. |
| `fiscal_allocations` | merge into `verifactu_identities` | One per identity, written in the same transaction, and repeats the identity's NIF, software id and installation number. |
| `fiscal_certificate_installs` | rename to `verifactu_certificates` | Classified `local`, so it cannot join the `ledger` history log. Named after the module. |
| `fiscal_certificate_reminders` | → `outgoing_mail` | A mail queue with a dedupe rule (README U4; 1.1). |
| `fiscal_conflict_evidence` | → fiscal history | Many rows per record: one per attempt and cause. |
| `fiscal_lookup_conflicts` | → fiscal history | One per record, so it fits `event_key`; loses `case_id`. |
| `fiscal_series_conflicts` | rename to `verifactu_series_conflicts` | Named after the module. It names no record, and every sale reads it by series. |
| `fiscal_reservations` | delete (U5) | Serves only a second box, and A947 does not use it. Fiscal, so the owner lands it. See below. |
| `registro_sif` | rename to `verifactu_identities` | Records point at past identities, and the never-reuse rule needs all of them. |
| `registros_facturacion` | rename to `verifactu_records` | The legal record, unchanged but for its name. |
| `adjustment_reasons` | keep | A list people edit. |
| `adjustments` | keep (drop `comped_extras`) | The ledger of every adjustment. |
| `adjustment_settings` | → `settings.adjustments` | A one-row settings table. |
| `adjustment_refunds` | keep | A link table with foreign keys on both sides, plus an amount. |
| `adjustment_lines` | keep | A different lifetime: copies are added as lines are split. |

**What goes with `fiscal_reservations`** (README U5). It is the reserved, inactive identity a standby
box got when it joined. A947 §4 item 3: "No fiscal identity is reserved at joining. Under A679 the
spare joins dormant, with no series and no installation code (§2); its name is chosen when it is
switched on (§6.5)." The table's only writer is `establishDormantAllocation`
(`packages/fiscal-verifactu/src/standby-allocation.ts:184`), reached only from
`allocated-standby.ts:209`. Removing it removes the paper-standby path with it
(`allocation-preparation.ts:28`, the fallback in `allocated-standby.ts:163-210`, `activateDormant`'s
read at `allocation.ts:274-279`), its name-history and backup-check readers
(`hour-history-reader.ts:247-259`, `backup-verification.ts:56`,
`backup-verification-history.ts:477`), and the paper-standby case #2428 added to
`dormant-takeover.test.ts`. Nothing A947 or A1018 needs reads it: A947 joins through the dormant path,
which reserves nothing (`hour-dormant-standby.ts:247-277`). The code that writes it is wired into the
mirror and promotion routes (`apps/server/src/mirror-bundle.ts:190`, `promote.ts:276`).

**What goes with `payment_policy`.** Its reader `getPaymentPolicy`, `resolveOfflineDecision` and the
Stripe branch that uses them (`packages/payments-stripe/src/device-provider.ts:67-75`). With no policy,
`offlineAllowed` is always false, so the till's staff-consent switch
(`apps/till/src/widgets/tender-pay.ts:1163`), `allowOffline` and the `accepted_offline` state have
nothing left to serve on Stripe. Those three were not traced to their ends. The slice lists what else
goes. `PAYMENTS_CONFIGURATION_TRANSFER` is left with no tables
(`packages/payments/src/configuration-transfer.ts:3`).

## 5. Protections

The append-only trigger pairs come from `appendOnly()` in each set's `classification.ts`. They are
pinned by name in `scripts/append-only-triggers.test.ts`, from line 34 onwards. No table in these
three sets has a hand-written trigger: `grep -i trigger` over the three `drizzle/` folders, and the
payments and adjustments research, found none.

| Current protection | Home in the target |
| --- | --- |
| **registros_facturacion**: append-only pair; 11 CHECKs; uniques `…_secuencia_uq`, partial `…_identidad_uq` (originals only) and `…_corrects_registro_uq`; FKs to devices (restrict), nodes, registro_sif, sales and itself (`corrects_registro_id`) | `verifactu_records`, unchanged; the `sif_id` FK now points at `verifactu_identities`. The trigger pair is rebuilt from the new name. |
| registros: index `registros_node_secuencia_idx` | **Dropped:** it duplicates the unique index on the same columns. |
| **cadenas**: `cadenas_puntero_ck` (the pointer is both null or both set); FKs to nodes and registros | Dropped with the table. The pointer no longer exists, and "first record" (`PrimerRegistro`) follows from whether the latest record on this node is under the current identity (0.1). That cannot be half-set. |
| **envios**: `envios_estado_ck`, `envios_drenaje_idx`, `envios_confirmado_idx`; FK to registros | `verifactu_submissions`, unchanged. |
| **acks**: `acks_state_ck`; FK to registros | Dropped with the table; nothing reads it. |
| **envio_flujo**: `envio_flujo_singleton_ck` | `verifactu_sending_state`. |
| **filing_cases**: append-only pair; unique `registro_id`; `filing_cases_cause_ck`; FK to registros | The set-once guard on the case columns. Uniqueness comes from the submission row's primary key, the cause CHECK moves to `case_cause`, and the FK is the row's own. |
| **filing_case_events**: append-only pair; unique `action_key`; a partial unique allowing one resolution per case; kind CHECK; FKs to filing_cases and registros (`remedy_registro_id`) | A resolution: the set-once guard on `verifactu_submissions`' resolution columns, "one per case" built into the shape, its key unique as `case_resolution_key`, and the remedy FK as `case_remedy_registro_id`. A note: a `verifactu_history` row of kind `case.note`, its key as `event_key`. The kind CHECK goes: the kind is now which table holds the row. One unique key across both kinds is lost (1.1). |
| **fiscal_lookup_conflicts**: append-only pair; unique `registro_id`; FKs to registros and filing_cases | `verifactu_history`: the append-only pair; the unique `event_key` (`lookup:<registro>`) in place of the unique `registro_id`; the FK to records. The case FK goes with `case_id`. |
| **fiscal_series_conflicts**: append-only pair; unique `(sif_id, invoice_identity)`; FKs to registro_sif and invoice_series | `verifactu_series_conflicts`, unchanged. |
| **fiscal_conflict_evidence**: append-only pair; unique `(registro_id, attempt, cause)`; attempt CHECK `> 0`; cause CHECK; FKs to registros and filing_cases | `verifactu_history`: the append-only pair, the unique `event_key`, `json_extract` CHECKs for attempt and cause on kind `conflict.observed`, and the FK to registros. The case FK is dropped, because the case is now the same record's submission row. |
| **clock_checks**: append-only pair; unique `seq`; reason CHECK; FK to nodes | `verifactu_history`: the shared unique `seq`, the reason CHECK on kind `clock.check_opened`, and the FK to nodes. |
| **clock_confirmations**: append-only pair; unique `seq`; unique `check_id`; index on `registro_id`; CHECKs on source, reason, person pairing and record pairing; FKs to nodes, clock_checks, registros | `verifactu_history` (see the note after this table). |
| **clock_stop_restarts**: append-only pair; unique `registro_id`; FKs | Dropped with the table; nothing writes it. |
| **registro_sif**: numero CHECK; uniques `…_instalacion_uq` and partial `…_activo_uq`; FK to nodes | `verifactu_identities`, unchanged, plus a new guard trigger: only `revocado_en` may change, and only once. |
| **fiscal_allocations**: append-only pair; uniques on `allocation_key` and on `(taxpayer_nif, software_id, environment, installation_identity)`; FKs to nodes and registro_sif | `verifactu_identities`: the guard trigger holds these columns fixed, and both uniques are kept. The FK to registro_sif is now the row itself. |
| **fiscal_reservations**: append-only pair; the same two uniques; two FKs to nodes | Dropped with the table (U5). |
| **fiscal_certificate_installs**: append-only pair; three CHECKs; one index | `verifactu_certificates`, unchanged. |
| **fiscal_certificate_reminders**: two CHECKs; unique `(install_id, stage, person_id)`; FK to the install | `outgoing_mail`: the stage and status CHECKs become its own; the unique becomes its dedupe key (1.1). The FK cannot follow: `verifactu_certificates` is `local`. |
| **invoice_series**: unique `(node_id, code)`; purpose and code CHECKs; FK to nodes | Unchanged. |
| invoice_series: CHECK `next_number >= 1` | Dropped with the column; `sales_invoice_number_ck` (`>= 1`) holds the same guarantee. |
| **daily_closes**: append-only pair; uniques `(node_id, business_day)` and `(node_id, sequence_no)`; FK to nodes | Unchanged. |
| **daily_close_chain**: PK and FK | Dropped with the table. The `tail_truncation` and `missing_head` checks go with it (1.2). |
| **payments**: CHECKs on amount, last four digits, entry mode, state, source, and the source/device pairing; six FKs (four restrict, two no action); uniques on provider ref, partial external ref and partial bill payment; four indexes | Unchanged, including the `node_id` FK. Gains a new guard trigger. |
| **payment_resolutions**: append-only pair; unique `payment_id`; CHECKs on outcome and cancelled-at-provider; FKs to payments and working_orders | Set-once columns on `payments`, with both CHECKs on the new columns. "One per payment" is now built into the shape. The working-order FK is the payment's own; the old one was a copy (`resolutions.ts:46-53`). |
| **payment_holds**: append-only pair; unique `payment_id`; amount CHECK; FK | Set-once columns, with the amount CHECK; "one per payment" built into the shape. Adds the new "hold or remediation, never both" CHECK. |
| **payment_hold_outcomes**: append-only pair; unique `hold_id`; outcome and note CHECKs; FK | Set-once columns, with both CHECKs; "one per hold" built into the shape. |
| **payment_policy**: singleton, mode and cap CHECKs | Dropped with the table. |
| **payment_refunds**: amount and state CHECKs; FK (restrict); one index | Unchanged; gains the append-only pair. |
| **card_readers**: partial unique on the provider ref | Unchanged. |
| **card_reader_holders**: PK `reader_id`; FKs to reader (cascade) and device (cascade) | "One holder per reader" is built into the shape. The device FK becomes `SET NULL`, because a cascade would now delete the reader. Readers and devices are only ever soft-deleted (`device-delete.ts:207-217`, `card-reader-delete.ts:281-289`), so neither action fires today. |
| **device_card_readers**: PK `device_id`; both FKs restrict | `devices.card_reader_id`; "one per device" built into the shape. The device FK is the row itself. **The reader FK is given up** (1.3): the writer checks the reader and the delete clears it. |
| **device_profile_card_readers**: PK pair; FKs; partial unique default | **Given up** for `device_profiles.card_readers`: one default is the shape, and the writer holds "on the list", no duplicates and a known reader (1.3). The delete clears the id. |
| **adjustment_reasons**: unique name; seven CHECKs | Unchanged. Under A1002 role deletion must clear the lists, and an empty approver list stays refused. |
| **adjustments**: append-only pair; FK to working_orders (restrict); seven CHECKs; three indexes | Unchanged. |
| **adjustment_lines**: append-only pair; FK (restrict); unique pair; one index | Unchanged. |
| **adjustment_refunds**: append-only pair; FKs (restrict); unique pair; one index; amount CHECK | Unchanged. |
| **adjustment_settings**: singleton; cap `> 0`; non-empty role list | Validation of `settings.adjustments`. |

How `clock_confirmations`' protections land in `verifactu_history`:

- **`seq` and "one confirmation per check":** the shared unique `seq`, and
  `event_key = clock.confirmed:<check>`.
- **The `registro_id` index** becomes `(registro_id, kind, seq)`.
- **The four CHECKs are rewritten per kind.**
  - The person pairing goes on the `person_id` column.
  - The record pairing becomes `(registro_id is null) = (json_extract(data,'$.recordAt') is null)`.
- **The FKs:** to nodes, to registros, and `ref_id` → verifactu_history in place of the FK to
  clock_checks.
- **Weaker in one way:** `ref_id` cannot check that it names a clock check rather than an entry of
  another kind. Add a trigger if that matters.

## 6. Duplicates removed

| Same thing stored twice | One home |
| --- | --- |
| The chain position, the predecessor's id and its huella, in both `cadenas` and the latest record | The record. |
| The next invoice number, in both `invoice_series.next_number` and `max(sales.invoice_number)` | `sales`. |
| AEAT's answer, in both `acks.state`/`acks.csv` and `envios.estado`/`envios.csv` | `verifactu_submissions`. |
| The identity's NIF, software id and installation number, in both `registro_sif` and `fiscal_allocations` | `verifactu_identities`. |
| A payment's working order, in both `payment_resolutions.working_order_id` and `payments.working_order_id` | `payments`. |
| A refund's provider and payment reference, in both `payment_refunds.provider`/`payment_ref` and the parent `payments` row | `payments`. |
| Whether a reader is enabled, in both `card_readers.active` and `disabled_at` | `disabled_at`. |
| The extras a comp zeroed, in both `adjustments.comped_extras` and their `adjustment_lines` rows | `adjustment_lines`. |
| Two indexes on `registros_facturacion (node_id, secuencia)` | The unique one. |

**Kept on purpose, or another area's call:**

- **The invoice's number, date, totals and VAT breakdown** are in both `sales` and
  `verifactu_records`. The record has to be complete on its own, because its fields are what gets
  hashed and filed (`chain.ts:47-56`). Keep both.
- **`sales.fiscal_backend` and `sales.fiscal_state`** repeat facts the fiscal module holds. The schema
  says so and justifies it (`packages/db/src/schema/sales.ts:58-61`). That is the orders-and-sales
  area's call.
- **A completed refund is recorded twice:** once on the till side, in `refunds` (today `tender_refunds`
  or `bill_payment_refunds`), and once on the provider side, in `payment_refunds`.
  - The amount, who authorised it, and the provider's refund reference appear in both
    (`tender-refund-sends.ts:100,178-197`; `bill-refunds.ts:317,761`).
  - `payment_refunds` cannot be removed. It also holds rows that have no till-side partner: failed
    attempts, and reconcile's orphan reversals (`reconcile.ts:536`).
  - Proposed one home: the provider's refund reference and the attempt's outcome live in
    `payment_refunds`, and the till-side row points at it instead of copying them. This needs the
    orders-and-sales area to agree, and neither area has settled it.
- **Some `payments` columns repeat the bill payment's** when `bill_payment_id` is set: `amount`
  (= applied + tip, `bill-payments.ts:1490`), `working_order_id`, `source` and `device_id`. They stay,
  because a payment for a whole order has no bill payment to read them from.
- **The taxpayer's tax number** appears in `taxpayer.tax_id`, `verifactu_identities.nif`,
  `verifactu_records.id_emisor_factura` and `verifactu_certificates.tax_id`. Each is fixed at the
  moment its row was written: a later change of tax number does not rewrite a past identity, record or
  certificate. Keep them all.

## 7. Depends on other areas

- **Venue and box** (`nodes`, `taxpayer`, `venue_credentials`, `incidents`):
  - `node_id` foreign keys on the records, identities, series, history and `payments`.
  - The certificate's sealed secret lives in `venue_credentials`.
  - `chain.ts:257` records incidents.
  - This design assumes `nodes` survives A1301, which removes locations but not nodes.
- **Devices** (`devices`, `device_profiles`):
  - `verifactu_records.device_id` and `payments.device_id`.
  - `devices.card_reader_id`, `device_profiles.card_readers` and `card_readers.held_by_device_id`.
    The first two are read and written only from `packages/payments` and `apps/server`, and hold no
    key (1.3; `tables-devices.md` §1).
- **Orders and sales:**
  - `sales`: the next invoice number is now read from it (0.2), and `verifactu_records.sale_id`
    and `payments.sale_id` point at it.
  - `working_orders`: the `payments` and `adjustments` foreign keys point at it.
  - `working_order_lines`: its ids appear in `adjustments.line_id`, in `adjustment_lines.line_id` and
    in `splits`, with no foreign key, because a cancel deletes the line.
  - `bill_payments`: `payments.bill_payment_id` points at it.
  - `refunds`: `adjustment_refunds.tender_refund_id` becomes `refund_id` (`tables-ordersales.md` §1.11).
  - The duplicated refund described in section 6.
- **People** (`persons`): identity folds into core (README U1), so `person_id`, `resolved_by`,
  `hold_decided_by`, `authorized_by`, `requested_by`, `approved_by` and `closed_by` get keys to
  `persons` (README U11), which refuse a delete until A980's erasure design says otherwise. The one
  exception is `verifactu_certificates.person_id`, which is on a `local` table. Test fixtures that
  invent a person id create the person first.
- **A1002 (one role list):** the reason lists and `billApproverRoles` become role ids (1.4, section 2).
- **Shared tables:** `settings` (the `adjustments` row), `activity_log` (the kinds in section 3) and
  `outgoing_mail` (certificate reminders, 1.1).
- **Other designs:** A1018's plan names `registros_devueltos` and `envios_devueltos` for its later
  slices. Those are tables in this module, so the naming rule applies to them too.

## 8. Measure before building

1. **The chain head and the next invoice number read from records and sales, not pointer rows.**
   - Both reads are on the sale path.
   - Measure: time `appendToChain` and `allocateInvoiceNumber` against 100,000 and 500,000 records
     and sales, comparing the current code with the derived reads. Run `EXPLAIN QUERY PLAN` on the
     derived reads.
   - Failing result: a plan that shows `SCAN` instead of `SEARCH … USING INDEX`, or a sale's write
     transaction that gets measurably slower. Either one keeps `cadenas` and `next_number`.
   - `daily_closes` needs no measurement: one row a day, and the read is on a close, not on a sale.
2. **The case check now reads a table with one row per record.**
   - `readActiveConflicts` runs on every sale (`backend.ts:187`, `conflict-evidence.ts:25`). Today it
     starts from the small `filing_cases` table; in this design it reads `verifactu_submissions`,
     which has a row for every record, and left-joins the history log for `conflict.observed` and
     `conflict.lookup`.
   - Measure: plan and time it with 500,000 submission rows and the partial index on
     `case_opened_at`.
   - Failing result: a scan of `verifactu_submissions`. That keeps cases as their own table.
3. **The clock stop's confirmation read moves into the history log.**
   - Measure: plan the query at `clock-behind.ts:116-126` against `verifactu_history` with the
     `(registro_id, kind, seq)` index.
   - Failing result: a scan.
4. **The CHECKs written with `json_extract`.**
   - Measure: on the app's own engine (`node:sqlite`, never the `sqlite3` command line — CLAUDE.md
     §3), insert one row that breaks each CHECK, and confirm every one is refused. Also run
     `scripts/schema-constraints.test.ts` against the new schema.
   - Failing result: a check that does not fire. That field then becomes a typed column on
     `verifactu_history`.
5. **The new guard triggers on `payments` and `verifactu_submissions`.**
   - Measure: run every writer in `packages/payments/src/store.ts` and in
     `drain.ts`/`reconcile.ts` under the new triggers (`store.test.ts`, the `drain.*.test.ts` files
     and `reconcile*.test.ts`), and W41s-8's remedy writers, which update the submission row
     (`record-remedy-held.ts:95-98`, `releaseBrakeHold` at `drain.ts:1033`) and record case events
     (`record-remedy*.test.ts`).
   - Failing result: a writer that legitimately changes a column the trigger holds fixed. That
     column comes off the fixed list, with the reason written at the trigger.
   - Not established here: whether `associatePaymentWithSale` (`store.ts:299-308`) ever
     overwrites a `reader_id` that is already set.
6. **Moving `adjustments.splits` into `adjustment_lines`.**
   - Not established here: whether every split's new line already has an `adjustment_lines` row.
   - Measure: read `adjustments-apply.ts:475`, `:948-970` and `:1286-1326`, and test it.
   - If every split has a row, `splits` becomes a `split_from_line_id` column on
     `adjustment_lines`. If not, `splits` stays and is recorded as the one place this area keeps row
     ids inside JSON.

## 9. Decisions for the owner

The owner settled this area on 4 November: `verifactu_` names, keep `daily_closes` and drop its chain
copy, delete `payment_policy`, `devices.card_reader_id`, fold card follow-ups into `payments`, keep
cleared AEAT answers (`aeat.answer_cleared`), and a profile's readers as a list. `fiscal_reservations`
was settled by README U5. The lookup conflict folds into `verifactu_history` and the series conflict
stays a table (1.1). No question is open in this area.
