> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: fiscal filing and chain, card payments, adjustments

Area: Veri\*Factu filing and the fiscal chain (`fiscal-verifactu` set, plus `invoice_series`,
`daily_closes` and `daily_close_chain` from `core`), card payments (`payments` set), and
cancellations, comps and discounts (`adjustments` set). 34 current tables.

Read on `main` at `64eeabb036`, read-only. Every claim cites the file and line or the grep run.
Nothing here was run as a test; where a claim needs a measurement it is listed in section 8.

## 0. The owner's question: why ~15 fiscal tables, and does "3 or 4" hold?

The working proposal was: (1) the invoice records, unchanged; (2) one submissions row per record
holding sending state, AEAT's answer and any problem and its resolution; (3) one append-only fiscal
history log; (4) the box's fiscal identity and sending state as one row or settings.

Tested against the code, **(1), (2) and (3) hold with adjustments, and (4) breaks.** The result is
seven fiscal tables, not four, and each of the three extra ones is there for a reason the code
states:

| Proposal part | Verdict | Why |
| --- | --- | --- |
| (1) records | **Holds.** `registros_facturacion` unchanged. | — |
| Chain head `cadenas` read from the records | **Holds — derive it.** | See 0.1. |
| Next invoice number `invoice_series.next_number` read from sales | **Holds for the number; the series stays a table.** | See 0.2. |
| (2) submissions absorbs `envios`, `acks`, `filing_cases`, `filing_case_events` | **Holds** for `envios`, `acks`, `filing_cases`. `filing_case_events` has no writer and is deleted (R5). | `filing_cases` is one per record (unique `registro_id`), so it folds as columns; its append-only protection becomes a set-once trigger. See 0.3. |
| (2) absorbs `fiscal_conflict_evidence` | **Breaks** — it is many rows per record (one per sending attempt and cause). | Goes to (3) instead. |
| (3) one history log: clock checks and confirmations, conflicts, case notes | **Holds**, with every typed CHECK and unique index re-expressed per kind (section 5). | Read back on the sale path, so it needs its own indexes (section 8). |
| (3) absorbs certificate installs and reminders | **Breaks.** | Those two tables are classified `local` (`classification.ts:20-27`); the history log is `ledger`. A table has one classification. Reminders are also updated in place (claim, then report: `certificate-reminders.ts:87-150`), so they are not history. |
| (3) absorbs identity allocations | **Better elsewhere** — fold them into the identity table. | Each activation writes exactly one identity row and one allocation row in one transaction (`allocation.ts:434-462`); the two rows repeat the same NIF, software id and installation number (`allocation.ts:441-444` vs `:462-470`). |
| (4) identity as one row | **Breaks.** | Every record points at the identity that made it (`registros_facturacion.sif_id` → `registro_sif`), and setup, restore and promotion must refuse an installation name ever used before (`hour-history-reader.ts:225-259`; `docs/compliance/verifactu-findings.md:276-280`, "No puede repetirse nunca"). Past identities are rows, so identity is a table of identities. |
| (4) sending state as settings | **Breaks.** | It is machine state written after every AEAT reply in the same transaction as the submission rows (`drain.ts:481`, `:1182`, `:1199`), with a compare-and-clear on the incident token (`drain.ts:1199-1200`). A settings save bumps a revision and names a person; a background writer would collide with every owner save. It must also stay in `venue.db`: it commits with `envios` updates, and `node.db` is a separate file with its own write queue (CLAUDE.md §3). It stays a one-row state table. |

The fiscal tables in the target: `registros_facturacion`, `fiscal_submissions`, `fiscal_history`,
`fiscal_identities`, `fiscal_sending_state`, `fiscal_certificates`, `fiscal_certificate_reminders`.
Down from 16 in the `fiscal-verifactu` set. `invoice_series` (core) stays beside them.

### 0.1 Can the chain head be read from the records under concurrent sales? Yes.

- Writes are serial: "one write transaction runs on the venue file at a time"
  (`packages/fiscal-verifactu/src/chain.ts:84-89`, the comment on `selectHead`, which reads the head
  without a row lock for exactly this reason). A derived read inside the same write transaction is
  as safe as the current one.
- What actually refuses a forked chain is not `cadenas` but the unique index on the position,
  `registros_tenant_node_secuencia_uq (node_id, secuencia)` (`chain.ts:24-32`; drizzle snapshot
  `0013_snapshot.json`). That index stays, so a derived head loses no guarantee.
- `cadenas.secuencia` is never reset; only the pointer is, and only when a new identity is
  registered (`registro-sif.ts:49-66`, `allocation.ts:445-451`). So:
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
- Readers to change: `chain.ts` (`selectHead`, `readChainHead`), `registro-sif.ts:191-197`
  (`esPrimerRegistro`), `apps/server/src/chain-height.ts:15-21` (Box status: height = max
  `secuencia`, last-at = the latest record's `creado_en`), and `backup-verification-chain.ts:55-140`,
  whose head-matches-records check disappears with the copy.

### 0.2 Can the next invoice number be read from the sales? Yes; the series row stays.

- Every number allocated becomes a `sales` row (`record-sale.ts:270`, `record-correction.ts:259`,
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
| The node owns the fiscal identity, chain and series | `fiscal_identities.node_id`, `registros_facturacion.node_id`, `invoice_series.node_id` — unchanged. |
| `registros_facturacion` is immutable; triggers are the whole enforcement | Unchanged table and triggers. |
| One minute behind the latest record: no record, no money, unless a confirmation covers it | Reads `registros_facturacion` (latest by generation time, `clock-behind.ts:18-28`, index `registros_generado_idx`) and the latest confirmation naming that record (`clock-behind.ts:116-126`), now `fiscal_history` rows of kind `clock.confirmed` with `registro_id`. Section 8 lists the index it needs. |
| Never put our metadata into a hash | Unchanged (`chain.ts:47-56`). |
| Restore and promotion start a new chain under a new installation name; a name already in history is never taken | New identity row in `fiscal_identities`, with the never-reuse unique index; chain head derived per identity (0.1). The history reader reads one table instead of three. |
| Every filing-node start resets "being sent" to waiting | `fiscal_submissions.estado`, unchanged logic. |
| Nothing external blocks a sale; filing is an outbox | `fiscal_submissions` is that outbox. |

What the clock-stop rules read back, exactly: the latest record by generation time and its id
(`clock-behind.ts:18-33`); per node, the largest `secuencia` (`clock-behind.ts:38-45`); the latest
confirmation that names the latest record, by `seq` — its `confirmed_at`, `record_at` and the chain
heads stored in its proof (`clock-behind.ts:116-140`); and the open check, i.e. the check with the
largest `seq` that no confirmation names (`clock-checks.ts:38-56`). `seq`, not time, orders these,
"because the clock is what is in doubt" (`schema/clock-confirmations.ts`, the `seq` column comment).
`fiscal_history` keeps a `seq` for the same reason.

**Not the legal event log.** AEAT's *registro de eventos* is required only for non-Veri\*Factu
systems (`docs/compliance/verifactu-findings.md:419-424`). `fiscal_history` is our own audit, not
that log; a future non-Veri\*Factu module brings its own.

## 1. Target tables

The reference venue is one restaurant taking 250 bills a day of 4 lines each, open 360 days a year.

Several columns below are **set-once**: the column may go from empty to a value once, and never
change after that. A guard trigger enforces it. The same kind of trigger already guards
`bill_payments` (`packages/db/drizzle/0024_bill_payment_triggers.sql`), and each new one gets pinned
in `scripts/behavioural-triggers.test.ts`.

### 1.1 Fiscal (`fiscal-verifactu` set, `venue.db`)

**`registros_facturacion`** — the legal, hash-chained invoice record. `ledger`, append-only.

- **Unchanged:** the same 34 columns and the same 11 CHECKs.
- **Unchanged foreign keys:** `device_id` → devices (restrict), `node_id` → nodes,
  `sif_id` → `fiscal_identities`, `sale_id` → sales.
- **Unchanged unique indexes:** `registros_tenant_node_secuencia_uq (node_id, secuencia)` and
  `registros_identidad_uq (id_emisor_factura, num_serie_factura, fecha_expedicion_factura,
  tipo_registro)`.
- **Unchanged plain indexes:** `registros_sale_idx` and `registros_generado_idx`.
- **One change proposed:** drop `registros_node_secuencia_idx (node_id, secuencia)`. It is a plain
  index on exactly the columns of the unique index above (`schema/registros.ts:115` and `:126`), so
  the unique index serves every query it serves.
- **Rows:** about 250–260 a day, about 92,000 a year.

**`fiscal_submissions`** (was `envios`; absorbs `filing_cases` and `acks`) — one row per record,
holding its sending state, AEAT's answer, and the problem case if one was opened. `ledger`, not
append-only, with a guard trigger.

| Column | Type | Key / null | From |
| --- | --- | --- | --- |
| `registro_id` | text | PK, FK → registros_facturacion | envios |
| `estado` | text | not null, CHECK in (pendiente, enviando, aceptado, aceptado_con_errores, rechazado, detenido, retenido) | envios |
| `intentos` | integer | not null | envios |
| `proximo_intento_en` | text | not null | envios |
| `incidencia`, `technical_incidence` | integer flag | not null | envios |
| `csv`, `codigo_error`, `mensaje_error` | text | null | envios |
| `enviado_en`, `confirmado_en`, `reconciled_resubmit_at` | text | null | envios |
| `case_cause` | text | null, set-once, CHECK `<> ''` | filing_cases.cause |
| `case_evidence` | JSON text | null, set-once | filing_cases.evidence |
| `case_opened_at` | text | null, set-once; CHECK: the three case columns are all null or all set | filing_cases.opened_at |

- **Protections kept:** `envios_estado_ck`, `envios_drenaje_idx (estado, proximo_intento_en)` and
  `envios_confirmado_idx (confirmado_en)`.
- **New partial index** on `(case_opened_at) WHERE case_opened_at is not null`, for the alert read
  and the sale-path read (section 8).
- **New guard trigger:** `registro_id` is fixed, and the three case columns are set-once.
  - This replaces `filing_cases`' append-only triggers.
  - It also replaces `filing_cases`' unique index on `registro_id`; the primary key now does that
    job.
- **The case's own id goes.** Its readers use `registro_id` instead (`conflict-recovery.ts:31,58,75`,
  `conflict-recovery-routes.ts:39`).
- **Resolution columns are not added now.** These would record who resolved a case and which
  corrective record fixed it. No product code writes a resolution today (see `filing_case_events` in
  section 4). A1089 (`docs/backlog.md:224`) brings them, as further set-once columns on this table.
- **Rows:** about 92,000 a year, one per record.

**`fiscal_history`** — the fiscal module's own append-only log. It holds clock checks, clock
confirmations and conflicts AEAT reported, and case notes once A1089 is built. `ledger`, append-only.

| Column | Type | Key / null | Notes |
| --- | --- | --- | --- |
| `id` | text | PK | |
| `seq` | integer | not null, UNIQUE | `max(seq)+1` in the write transaction, as `clock-checks.ts:60-70` does today. `seq` orders the log, not time, because the clock is what is in doubt |
| `kind` | text | not null, CHECK in (`clock.check_opened`, `clock.confirmed`, `conflict.observed`, `aeat.answer_cleared`) | A1089 adds `case.note` |
| `event_key` | text | null, UNIQUE | Natural idempotency key: `clock.confirmed:<check id>` (one confirmation per check), `conflict:<registro>:<attempt>:<cause>` |
| `node_id` | text | not null, FK → nodes | |
| `at` | text | not null | The box's time when written |
| `registro_id` | text | null, FK → registros_facturacion | The record a confirmation, conflict or cleared answer names |
| `ref_id` | text | null, FK → fiscal_history(id) | A confirmation's check |
| `person_id` | text | null | No FK, as today: `persons` is in identity's set |
| `data` | JSON text | not null | The kind's own fields, listed in section 3 |

- **Protections:** the append-only triggers, `seq` unique and `event_key` unique.
- **Per-kind CHECKs,** written with `json_extract`, re-create every current CHECK (section 5).
- **Indexes:**
  - `(kind, seq)`, to find the open check.
  - `(registro_id, kind, seq)`, for the clock stop's "latest confirmation naming this record".
- **Rows:** normally a handful a year; tens after a clock or restore incident.

**`fiscal_identities`** (was `registro_sif`; absorbs `fiscal_allocations`, and `fiscal_reservations`
if you keep it — decision 1). It lists every installation identity this box has signed under, and the
approval that granted each one. `ledger`, not append-only, with a guard trigger.

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

- In product code, every identity row is written by `activate` (`allocation.ts:434-470`), together
  with exactly one allocation row naming it.
- `registro_sif` has two other writers, `registerSif` and `writeReservedSif`. Neither has a non-test
  caller: `git grep -n "\bregisterSif\b\|\bwriteReservedSif\b" -- 'packages/*.ts' 'apps/*.ts'
  ':!*.test.ts'` finds only their definitions and test fixtures.

**`fiscal_sending_state`** (was `envio_flujo`) — AEAT's flow-control gate. `ledger` (as today), one
row. It holds:

- when the next send may go;
- the wait AEAT last set (Orden HAC/1177/2024 art. 16.2, `docs/compliance/verifactu-findings.md:459-461`);
- the token of an open technical incident.

- **Columns:** `id` integer PK, CHECK `= 1`; `proximo_envio_en` text not null; `tiempo_espera_seg`
  integer not null; `technical_incident_token` text null.
- **Protections:** `envio_flujo_singleton_ck`.
- **Rows:** 1.
- It is not a settings document; section 0 explains why.

**`fiscal_certificates`** (was `fiscal_certificate_installs`) — one row per AEAT certificate installed
on this box. The newest is the one in use (`certificate-record.ts:8-13`). `local`, append-only.

- **Unchanged:** all 14 columns.
- **Protections unchanged:** the three CHECKs (source, kind, proof of a dashboard install) and the
  index on `(node_id, installed_at)`.
- **The sealed certificate itself** stays in `tenant_credentials` (`certificate-install.ts:237-244`,
  another area).
- **Rows:** 1–2 a year.

**`fiscal_certificate_reminders`** — one row per expiry email, per certificate, stage and recipient, so
the same email never goes twice. `local`, and not append-only: a row is claimed, then marked sent or
failed, and a failed one may be claimed again (`certificate-reminders.ts:87-150`).

- **Unchanged:** all columns and protections — the stage and status CHECKs, the unique index on
  `(install_id, stage, person_id)`, and the FK `install_id` → `fiscal_certificates`.
- **Rows:** 3–10 per certificate.

### 1.2 Invoice numbering (`core` set)

**`invoice_series`** — a numbering series a node issues from. `state`.

- **Columns:** `id` PK, `node_id` FK → nodes, `code`, `purpose`, `retired_at` null.
- **`next_number` is dropped.** The next number is `max(invoice_number)+1` over `sales` for the
  series (section 0.2).
- **Protections kept:** `invoice_series_node_code_key (node_id, code)`, `invoice_series_purpose_ck`
  and `invoice_series_code_ck`.
- **`invoice_series_next_number_ck` goes with its column.** Its guarantee (`>= 1`) is now held by
  `sales_invoice_number_ck` (`sales.ts:148`).
- **Rows:** 3, plus 3 per restore.

### 1.3 Card payments (`payments` set)

**`payments`** (absorbs `payment_resolutions`, `payment_holds` and `payment_hold_outcomes`) — one
row per card payment, moving through its states. `ledger`, not append-only, with a new guard trigger.

- **Kept: 20 of the 21 columns** — `id`, `working_order_id`, `source`, `device_id`, `sale_id`,
  `reader_id`, `provider`, `payment_ref`, `external_ref`, `card_scheme`, `card_last4`,
  `card_entry_mode`, `card_auth_code`, `amount`, `state`, `settled_at`, `reconcile_remediated_at`,
  `created_at`, `updated_at` and `bill_payment_id`.
- **Dropped: `node_id`.** The schema says "no writer sets it yet"
  (`packages/payments/src/schema/payments.ts:57`): `insertPayment` (`store.ts:81-97`) leaves it out,
  and no non-test code reads it.

Added columns, all null and set-once:

| Columns | From | Extra CHECK |
| --- | --- | --- |
| `resolution_outcome` (captured/failed), `resolution_cancelled_at_provider`, `resolution_provider_status`, `resolved_by`, `resolved_at` | payment_resolutions | Outcome and `resolved_at` both null or both set; `cancelled_at_provider = 0 or outcome = 'failed'` (`0008:13-14`) |
| `hold_provider_amount`, `held_at` | payment_holds | Amount > 0 (`0009:20`); both set or neither |
| `hold_outcome` (refunded_at_provider/kept), `hold_note`, `hold_decided_by`, `hold_decided_at` | payment_hold_outcomes | An outcome only on a held row; note null or non-blank (`0009:9-10`) |
| — | the race guard in `holds.ts:48` and `store.ts:820` | New CHECK `held_at is null or reconcile_remediated_at is null` |

- **Protections kept:** every current CHECK and foreign key (listed in section 5), the unique
  `payments_provider_ref_key`, the partial uniques `payments_provider_external_ref_key` and
  `payments_bill_payment_key`, and the four plain indexes.
- **One resolution, one hold and one hold outcome per payment** was three unique indexes. It is now
  built into the shape of the table, because each is a set of columns on the one row.
- **The three tables' append-only triggers** become the set-once guard.
- **Rows:** about 150–200 a day, about 60,000 a year.

**`payment_refunds`** — one row per refund attempt at the provider, succeeded or failed. `ledger`, and
**now declared append-only**: it is already insert-only, since no product code updates or deletes it.

- **Columns:** `id`; `payment_id` FK → payments (restrict); `amount`, CHECK > 0; `state`, CHECK in
  (succeeded, failed); `authorized_by` null; `provider_refund_ref` null; `created_at`.
- **Dropped: `provider` and `payment_ref`.** They copy the parent payment's own columns.
- **The index on `payment_id` stays.** The refund ceiling sums over it (`store.ts:238-264`,
  `:667-680`).
- **Rows:** about 400–1,000 a year.

**`card_readers`** (absorbs `card_reader_holders`) — one row per registered card terminal. `state`.

- **Columns:** `id` PK, `provider`, `provider_ref`, `name`, `prints_own_slip_automatically`,
  `created_at`, `disabled_at` null, `unpaired_at` null, `deleted_at` null.
- **New column `held_by_device_id`:** null, FK → devices ON DELETE SET NULL. It was
  `card_reader_holders.device_id`.
- **Dropped: `active`.** Every writer sets it together with `disabled_at`, so it is just
  `disabled_at is null`. The sites, from the payments research: `payments-api.ts:569` and
  `:626-627`; `card-reader-delete.ts:219-220`, `:252` and `:284-286`; `boot.ts:496`.
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

**`device_profile_card_readers`** — which readers a device profile may use, in order, with one
default. `state`.

- **Unchanged:** PK `(device_profile_id, reader_id)`; FKs (profile cascade, reader restrict); a
  partial unique allowing one default per profile.
- It is a link table with a foreign key on both sides, and people see and edit it
  (`payments-api.ts:976-1027`), so R7 keeps it.
- **Rows:** about 4–12.

**`device_card_readers` becomes the column `devices.card_reader_id`.** Null means "use the profile's
default". FK → card_readers, ON DELETE restrict. It sits beside `devices.receipt_printer_id`
(`packages/db/src/schema/devices.ts:30-56`). This puts a payments column on a core table — decision 4.

### 1.4 Adjustments (`adjustments` set)

**`adjustment_reasons`** — the list of reasons staff pick from. `state`.

- **Unchanged:** the 12 columns, the unique `name`, and the seven CHECKs.
- **Role lists stay JSON arrays** of the role enum (`staff`, `supervisor`, `manager`, `admin`). These
  are enum values guarded by a CHECK, not row ids, so R4 does not apply.
- **Rows:** 9–15.

**`adjustments`** — one row per cancellation, comp or discount. `ledger`, append-only.

- **Dropped: `comped_extras`.** It is a JSON list of `working_order_lines` ids that no product code
  reads: it is built at `adjustments-apply.ts:931-936` and written at `record.ts:61` (from the
  adjustments research). The extras it names already get their own `adjustment_lines` rows
  (`adjustments-apply.ts:1302-1327`).
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

The 34 current tables become **16 target tables**: 7 fiscal, 1 for numbering, 4 for payments and 4
for adjustments. The design also adds one settings row (`adjustments`) and one new column on
`devices`.

## 2. Settings documents

**`settings` row `adjustments`.** It comes from `adjustment_settings`, a one-row table (CHECK
`id = 1`).

| Field | Type | Default | From |
| --- | --- | --- | --- |
| `maxBillComp` | integer cents or null | null (no limit) | `adjustment_settings.max_bill_comp`; its CHECK `> 0` moves to validation |
| `billApproverRoles` | array of role enum | `["manager", "admin"]` (`schema/settings.ts:17-19`) | `adjustment_settings.bill_approver_roles`; its "non-empty" CHECK moves to validation |

**No `payments` row** if `payment_policy` is deleted (decision 3). If you keep offline acceptance
instead, it becomes `settings.payments` with two fields:

- `offlineMode`: `cash_only` or `accept_offline`. Default `cash_only`, which is today's behaviour
  when there is no row (`policy.ts:41`).
- `offlineAmountCap`: cents, 0 or more. Default null.

**No `fiscal` row.** None of the fiscal tables holds configuration; `fiscal_sending_state` is machine
state (section 0). **No `box_settings` row.**

## 3. History

### Typed history the product reads back

**`fiscal_history`** is read by:

- `clock-behind.ts:116-140` — whether a confirmation covers this clock reading. It runs on every
  record write while the clock is behind.
- `clock-checks.ts:38-70` — the open check, and the next `seq`.
- `clock-misdated.ts:52-64` and `clock-stop-incidents.ts:205-216`.
- `readActiveConflicts` in `conflict-evidence.ts`. It runs on every sale, through
  `refuseNewIssuance` (`backend.ts:185-187`).

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
- **`aeat.answer_cleared`** (new; decision 6) keeps the values a submission row held — `csv`,
  `codigo_error`, `mensaje_error` and `confirmado_en` — written just before they are cleared:
  - by reconcile, for a resubmission (`reconcile.ts:378-388`);
  - by a hold, which clears the CSV (`drain.ts:900`).

  Today those values are overwritten and lost, yet AEAT says the CSV "no podrá ser recuperado a
  través de consultas posteriores": it cannot be fetched again later (`schema/envios.ts`, the
  comment on `csv`).

**The other typed tables read back:**

- **`fiscal_certificates`** — `latestInstall` (`certificate-record.ts:8-13`), read by the certificate
  card, the alerts, diagnosis and the reminders.
- **`fiscal_identities`** — the history reader refuses an installation name that was already used
  (`hour-history-reader.ts:225-259`).
- **`adjustments`, `adjustment_lines` and `adjustment_refunds`** — the reports and the per-bill
  limits (`reports.ts:283-345`, `record.ts:101-124`, `refund-links.ts:57-68`).
- **`payment_refunds`** — the refund ceiling (`store.ts:238-264`).

### To `activity_log`

These are audit only: nothing reads them back on a hot path. Today they leave no trace at all,
because the row is overwritten.

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
| `daily_close_chain` | delete | No product writer — only `apps/server/scripts/daily-close-z-demo.ts` writes it. It is also a copy of the latest close's sequence and hash (R6). |
| `daily_closes` | delete (decision 2) | No product writer: `git grep -n recordDailyClose -- apps` finds only the demo script. Two readers only check whether any row exists (`business-day-start.ts:122`, `venue-details.ts:98`). Our own question to the tax adviser describes it as an internal cash-control document, not a declaration (`docs/compliance/asesor-questions.md:2859`). |
| `card_reader_holders` | merge into `card_readers` | One row per reader (PK `reader_id`), so it becomes `held_by_device_id`. |
| `card_readers` | keep (drop `active`) | A real thing; `active` is just `disabled_at is null`. |
| `device_card_readers` | merge into `devices` (`card_reader_id`) | One row per device (PK `device_id`); decision 4. |
| `device_profile_card_readers` | keep | A two-key link table, with an order and one default. |
| `payment_hold_outcomes` | merge into `payments` | One per hold (unique `hold_id`), and one hold per payment; set-once columns. |
| `payment_holds` | merge into `payments` | One per payment (unique `payment_id`); set-once columns. |
| `payment_policy` | delete (decision 3) | No product writer; only the configuration import copies it in and out. |
| `payment_refunds` | keep, append-only | The provider's record of each refund attempt; drop two columns copied from the payment. |
| `payment_resolutions` | merge into `payments` | One per payment (unique `payment_id`); set-once columns. |
| `payments` | keep | A real thing; drop the unused `node_id`. Gains a guard trigger. |
| `acks` | delete | No product reader (the brief's grep), and its `state` and `csv` repeat `envios`. |
| `cadenas` | delete (derive) | The chain head is the latest record on the node (0.1). |
| `clock_checks` | → fiscal history | Append-only events, read back in `seq` order. |
| `clock_confirmations` | → fiscal history | The same; "one per check" becomes the unique `event_key`. |
| `clock_stop_restarts` | delete | Written by nothing (`schema/clock-stop-restarts.ts:6`). |
| `envio_flujo` | rename to `fiscal_sending_state` | Machine state that commits together with the submission rows; not a setting. |
| `envios` | rename to `fiscal_submissions` | One per record. It changes over time, so it cannot fold into the unchangeable record. |
| `filing_case_events` | delete | No product writer: `recordCaseEvent` has no non-test caller. A1089 brings resolution columns and a `case.note` history kind. |
| `filing_cases` | merge into `fiscal_submissions` | One per record (unique `registro_id`); set-once columns. |
| `fiscal_allocations` | merge into `fiscal_identities` | One per identity, written in the same transaction, and repeats the identity's NIF, software id and installation number. |
| `fiscal_certificate_installs` | rename to `fiscal_certificates` | Classified `local`, so it cannot join the `ledger` history log. |
| `fiscal_certificate_reminders` | keep | Classified `local`, and updated in place (claimed, then reported). |
| `fiscal_conflict_evidence` | → fiscal history | Many rows per record: one per attempt and cause. |
| `fiscal_reservations` | merge into `fiscal_identities`, or delete (decision 1) | Serves only a second box. |
| `registro_sif` | rename to `fiscal_identities` | Records point at past identities, and the never-reuse rule needs all of them. |
| `registros_facturacion` | keep | The legal record. |
| `adjustment_reasons` | keep | A list people edit. |
| `adjustments` | keep (drop `comped_extras`) | The ledger of every adjustment. |
| `adjustment_settings` | → `settings.adjustments` | A one-row settings table. |
| `adjustment_refunds` | keep | A link table with foreign keys on both sides, plus an amount. |
| `adjustment_lines` | keep | A different lifetime: copies are added as lines are split. |

## 5. Protections

The append-only trigger pairs come from `appendOnly()` in each set's `classification.ts`. They are
pinned by name in `scripts/append-only-triggers.test.ts`, from line 34 onwards. No table in these
three sets has a hand-written trigger: `grep -i trigger` over the three `drizzle/` folders, and the
payments and adjustments research, found none.

| Current protection | Home in the target |
| --- | --- |
| **registros_facturacion**: append-only pair; 11 CHECKs; uniques `…_secuencia_uq` and `…_identidad_uq`; FKs to devices (restrict), nodes, registro_sif, sales | Unchanged; the `sif_id` FK now points at `fiscal_identities`. |
| registros: index `registros_node_secuencia_idx` | **Dropped:** it duplicates the unique index on the same columns. |
| **cadenas**: `cadenas_puntero_ck` (the pointer is both null or both set); FKs to nodes and registros | Dropped with the table. The pointer no longer exists, and "first record" (`PrimerRegistro`) follows from whether the latest record on this node is under the current identity (0.1). That cannot be half-set. |
| **envios**: `envios_estado_ck`, `envios_drenaje_idx`, `envios_confirmado_idx`; FK to registros | `fiscal_submissions`, unchanged. |
| **acks**: `acks_state_ck`; FK to registros | Dropped with the table; nothing reads it. |
| **envio_flujo**: `envio_flujo_singleton_ck` | `fiscal_sending_state`. |
| **filing_cases**: append-only pair; unique `registro_id`; `filing_cases_cause_ck`; FK to registros | The set-once guard on the case columns. Uniqueness comes from the submission row's primary key, the cause CHECK moves to `case_cause`, and the FK is the row's own. |
| **filing_case_events**: append-only pair; unique `action_key`; a partial unique allowing one resolution per case; kind CHECK; FKs | Dropped with the table: nothing writes it. A1089 re-creates "one resolution" as set-once columns, and the idempotency key as `fiscal_history.event_key`. |
| **fiscal_conflict_evidence**: append-only pair; unique `(registro_id, attempt, cause)`; attempt CHECK `> 0`; cause CHECK; FKs to registros and filing_cases | `fiscal_history`: the append-only pair, the unique `event_key`, `json_extract` CHECKs for attempt and cause on kind `conflict.observed`, and the FK to registros. The case FK is dropped, because the case is now the same record's submission row. |
| **clock_checks**: append-only pair; unique `seq`; reason CHECK; FK to nodes | `fiscal_history`: the shared unique `seq`, the reason CHECK on kind `clock.check_opened`, and the FK to nodes. |
| **clock_confirmations**: append-only pair; unique `seq`; unique `check_id`; index on `registro_id`; CHECKs on source, reason, person pairing and record pairing; FKs to nodes, clock_checks, registros | `fiscal_history` (see the note after this table). |
| **clock_stop_restarts**: append-only pair; unique `registro_id`; FKs | Dropped with the table; nothing writes it. |
| **registro_sif**: numero CHECK; uniques `…_instalacion_uq` and partial `…_activo_uq`; FK to nodes | `fiscal_identities`, unchanged, plus a new guard trigger: only `revocado_en` may change, and only once. |
| **fiscal_allocations**: append-only pair; uniques on `allocation_key` and on `(taxpayer_nif, software_id, environment, installation_identity)`; FKs to nodes and registro_sif | `fiscal_identities`: the guard trigger holds these columns fixed, and both uniques are kept. The FK to registro_sif is now the row itself. |
| **fiscal_reservations**: append-only pair; the same two uniques; two FKs to nodes | If kept (decision 1): reserved rows in `fiscal_identities`, covered by the same uniques. If deleted: dropped with the feature. |
| **fiscal_certificate_installs**: append-only pair; three CHECKs; one index | `fiscal_certificates`, unchanged. |
| **fiscal_certificate_reminders**: two CHECKs; unique `(install_id, stage, person_id)`; FK | Unchanged. |
| **invoice_series**: unique `(node_id, code)`; purpose and code CHECKs; FK to nodes | Unchanged. |
| invoice_series: CHECK `next_number >= 1` | Dropped with the column; `sales_invoice_number_ck` (`>= 1`) holds the same guarantee. |
| **daily_closes**: append-only pair; uniques `(node_id, business_day)` and `(node_id, sequence_no)`; FK to nodes. **daily_close_chain**: PK and FK | Dropped with the feature (decision 2). If kept, the two uniques stay and the chain table still goes. |
| **payments**: CHECKs on amount, last four digits, entry mode, state, source, and the source/device pairing; six FKs (four restrict, two no action); uniques on provider ref, partial external ref and partial bill payment; four indexes | Unchanged, except that the `node_id` FK goes with its column. Gains a new guard trigger. |
| **payment_resolutions**: append-only pair; unique `payment_id`; CHECKs on outcome and cancelled-at-provider; FKs to payments and working_orders | Set-once columns on `payments`, with both CHECKs on the new columns. "One per payment" is now built into the shape. The working-order FK is the payment's own; the old one was a copy (`resolutions.ts:46-53`). |
| **payment_holds**: append-only pair; unique `payment_id`; amount CHECK; FK | Set-once columns, with the amount CHECK; "one per payment" built into the shape. Adds the new "hold or remediation, never both" CHECK. |
| **payment_hold_outcomes**: append-only pair; unique `hold_id`; outcome and note CHECKs; FK | Set-once columns, with both CHECKs; "one per hold" built into the shape. |
| **payment_policy**: singleton, mode and cap CHECKs | Dropped with the table (decision 3). If kept, they become validation in the settings document. |
| **payment_refunds**: amount and state CHECKs; FK (restrict); one index | Unchanged; gains the append-only pair. |
| **card_readers**: partial unique on the provider ref | Unchanged. |
| **card_reader_holders**: PK `reader_id`; FKs to reader (cascade) and device (cascade) | "One holder per reader" is built into the shape. The device FK becomes `SET NULL`, because a cascade would now delete the reader. Readers and devices are only ever soft-deleted (`device-delete.ts:207-217`, `card-reader-delete.ts:281-289`), so neither action fires today. |
| **device_card_readers**: PK `device_id`; both FKs restrict | `devices.card_reader_id`, FK restrict; "one per device" built into the shape. |
| **device_profile_card_readers**: PK pair; FKs; partial unique default | Unchanged. |
| **adjustment_reasons**: unique name; seven CHECKs | Unchanged. |
| **adjustments**: append-only pair; FK to working_orders (restrict); seven CHECKs; three indexes | Unchanged. |
| **adjustment_lines**: append-only pair; FK (restrict); unique pair; one index | Unchanged. |
| **adjustment_refunds**: append-only pair; FKs (restrict); unique pair; one index; amount CHECK | Unchanged. |
| **adjustment_settings**: singleton; cap `> 0`; non-empty role list | Validation of `settings.adjustments`. |

How `clock_confirmations`' protections land in `fiscal_history`:

- **`seq` and "one confirmation per check":** the shared unique `seq`, and
  `event_key = clock.confirmed:<check>`.
- **The `registro_id` index** becomes `(registro_id, kind, seq)`.
- **The four CHECKs are rewritten per kind.**
  - The person pairing goes on the `person_id` column.
  - The record pairing becomes `(registro_id is null) = (json_extract(data,'$.recordAt') is null)`.
- **The FKs:** to nodes, to registros, and `ref_id` → fiscal_history in place of the FK to
  clock_checks.
- **Weaker in one way:** `ref_id` cannot check that it names a clock check rather than an entry of
  another kind. Add a trigger if that matters.

## 6. Duplicates removed

| Same thing stored twice | One home |
| --- | --- |
| The chain position, the predecessor's id and its huella, in both `cadenas` and the latest record | The record. |
| The next invoice number, in both `invoice_series.next_number` and `max(sales.invoice_number)` | `sales`. |
| AEAT's answer, in both `acks.state`/`acks.csv` and `envios.estado`/`envios.csv` | `fiscal_submissions`. |
| The identity's NIF, software id and installation number, in both `registro_sif` and `fiscal_allocations` | `fiscal_identities`. |
| A payment's working order, in both `payment_resolutions.working_order_id` and `payments.working_order_id` | `payments`. |
| A refund's provider and payment reference, in both `payment_refunds.provider`/`payment_ref` and the parent `payments` row | `payments`. |
| Whether a reader is enabled, in both `card_readers.active` and `disabled_at` | `disabled_at`. |
| The extras a comp zeroed, in both `adjustments.comped_extras` and their `adjustment_lines` rows | `adjustment_lines`. |
| Two indexes on `registros_facturacion (node_id, secuencia)` | The unique one. |

**Kept on purpose, or another area's call:**

- **The invoice's number, date, totals and VAT breakdown** are in both `sales` and
  `registros_facturacion`. The record has to be complete on its own, because its fields are what gets
  hashed and filed (`chain.ts:47-56`). Keep both.
- **`sales.fiscal_backend` and `sales.fiscal_state`** repeat facts the fiscal module holds. The schema
  says so and justifies it (`packages/db/src/schema/sales.ts:58-61`). That is the orders-and-sales
  area's call.
- **A completed refund is recorded twice:** once on the till side, in `tender_refunds` or
  `bill_payment_refunds`, and once on the provider side, in `payment_refunds`.
  - The amount, who authorised it, and the provider's refund reference appear in both
    (`tender-refund-sends.ts:100,178-197`; `bill-refunds.ts:325,766`).
  - `payment_refunds` cannot be removed. It also holds rows that have no till-side partner: failed
    attempts, and reconcile's orphan reversals (`reconcile.ts:536`).
  - Proposed one home: the provider's refund reference and the attempt's outcome live in
    `payment_refunds`, and the till-side row points at it instead of copying them. This needs the
    orders-and-sales area to agree.
- **Some `payments` columns repeat the bill payment's** when `bill_payment_id` is set: `amount`
  (= applied + tip, `bill-payments.ts:1500`), `working_order_id`, `source` and `device_id`. They stay,
  because a payment for a whole order has no bill payment to read them from.
- **The taxpayer's tax number** appears in `tenants.tax_id`, `fiscal_identities.nif`,
  `registros_facturacion.id_emisor_factura` and `fiscal_certificates.tax_id`. Each is fixed at the
  moment its row was written: a later change of tax number does not rewrite a past identity, record or
  certificate. Keep them all.

## 7. Depends on other areas

- **Venue and box** (`nodes`, `tenants`, `tenant_credentials`, `incidents`):
  - `node_id` foreign keys on the records, identities, series, history and sending state.
  - The certificate's sealed secret lives in `tenant_credentials`.
  - `chain.ts:257` records incidents.
  - This design assumes `nodes` survives A1301, which removes locations but not nodes.
- **Devices** (`devices`, `device_profiles`):
  - `registros_facturacion.device_id` and `payments.device_id`.
  - The new columns `devices.card_reader_id` and `card_readers.held_by_device_id`.
  - `device_profile_card_readers.device_profile_id`.
  - The devices area has to accept the new column on `devices` (decision 4).
- **Orders and sales:**
  - `sales`: the next invoice number is now read from it (0.2), and `registros_facturacion.sale_id`
    and `payments.sale_id` point at it.
  - `working_orders`: the `payments` and `adjustments` foreign keys point at it.
  - `working_order_lines`: its ids appear in `adjustments.line_id`, in `adjustment_lines.line_id` and
    in `splits`, with no foreign key, because a cancel deletes the line.
  - `bill_payments`: `payments.bill_payment_id` points at it.
  - `tender_refunds`: `adjustment_refunds.tender_refund_id` points at it.
  - The duplicated refund described in section 6.
- **People** (`persons`): every `person_id`, `resolved_by`, `hold_decided_by`, `authorized_by`,
  `requested_by` and `approved_by` column. None has a foreign key today, because `persons` is in
  another migration set, and this design keeps it that way.
- **Shared tables:** `settings` (the `adjustments` row) and `activity_log` (the kinds in section 3).
- **Business day:** `apps/server/src/business-day-start.ts:122` refuses some changes once a day has
  been closed, and it finds closed days in `daily_closes`. If that table is deleted, the check loses
  that first condition.
- **Email:** both `fiscal_certificate_reminders` and the people area's `attendance_mail` are small
  queues that stop the same email going out twice. If the merged design adds a shared outgoing-mail
  table, both could move into it. This design does not propose that.

## 8. Measure before building

1. **The chain head and the next invoice number read from records and sales, not pointer rows.**
   - Both reads are on the sale path.
   - Measure: time `appendToChain` and `allocateInvoiceNumber` against 100,000 and 500,000 records
     and sales, comparing the current code with the derived reads. Run `EXPLAIN QUERY PLAN` on the
     derived reads.
   - Failing result: a plan that shows `SCAN` instead of `SEARCH … USING INDEX`, or a sale's write
     transaction that gets measurably slower. Either one keeps `cadenas` and `next_number`.
2. **The case check now reads a table with one row per record.**
   - `readActiveConflicts` runs on every sale (`backend.ts:185-187`). Today it joins the small
     `filing_cases` table; in this design it reads `fiscal_submissions`, which has a row for every
     record.
   - Measure: plan and time it with 500,000 submission rows and the partial index on
     `case_opened_at`.
   - Failing result: a scan of `fiscal_submissions`. That keeps cases as their own table.
3. **The clock stop's confirmation read moves into the history log.**
   - Measure: plan the query at `clock-behind.ts:116-126` against `fiscal_history` with the
     `(registro_id, kind, seq)` index.
   - Failing result: a scan.
4. **The CHECKs written with `json_extract`.**
   - Measure: on the app's own engine (`node:sqlite`, never the `sqlite3` command line — CLAUDE.md
     §3), insert one row that breaks each CHECK, and confirm every one is refused. Also run
     `scripts/schema-constraints.test.ts` against the new schema.
   - Failing result: a check that does not fire. That field then becomes a typed column on
     `fiscal_history`.
5. **The new guard triggers on `payments` and `fiscal_submissions`.**
   - Measure: run every writer in `packages/payments/src/store.ts` and in
     `drain.ts`/`reconcile.ts` under the new triggers (`store.test.ts`, the `drain.*.test.ts` files
     and `reconcile*.test.ts`).
   - Failing result: a writer that legitimately changes a column the trigger holds fixed. That
     column comes off the fixed list, with the reason written at the trigger.
   - Not established here: whether `associatePaymentWithSale` (`store.ts:296-305`) ever
     overwrites a `reader_id` that is already set.
6. **Moving `adjustments.splits` into `adjustment_lines`.**
   - Not established here: whether every split's new line already has an `adjustment_lines` row.
   - Measure: read `adjustments-apply.ts:476`, `:949-971` and `:1287-1327`, and test it.
   - If every split has a row, `splits` becomes a `split_from_line_id` column on
     `adjustment_lines`. If not, `splits` stays and is recorded as the one place this area keeps row
     ids inside JSON.

## 9. Decisions for the owner

1. **`fiscal_reservations` (second box).**
   - What it is: the reserved, inactive identity a standby box gets when it joins. It rests on your
     decision of 2026-09-03: "a standby node gets its full dormant identity at join/adopt time".
   - The code that writes it is wired into the mirror and promotion routes
     (`apps/server/src/mirror-bundle.ts:190`, `promote.ts:272`).
   - But the backlog says allocated standby adoption "still needs the primary's venue copy and fresh
     establishment authority" (`docs/backlog.md:393-396`), and CLAUDE.md §5 says a venue has one node
     today.
   - **Recommendation: delete it now (R11),** and let the failover design bring it back.
   - If you keep it instead, it becomes reserved rows in `fiscal_identities` with a set-once
     activation time, so one never-reuse index covers both reserved and activated names.
2. **The daily close (`daily_closes` and `daily_close_chain`).**
   - What it is: the frozen end-of-day cash close. It is fully built in `packages/reporting`, but no
     route calls it.
   - **Recommendation: delete both tables and the reporting code (R5).** The backlog's "Richer daily
     close" (`docs/backlog.md:5906`) brings its own design when it is built.
   - If you keep it instead: keep `daily_closes` alone, and read its chain head from it, as for the
     fiscal chain.
3. **`payment_policy` (taking cards while the card network is down).**
   - What it is: whether a card can be taken while the card network is unreachable, and up to what
     amount. Nothing in the product can switch it on, so today the till always refuses.
   - **Recommendation: delete the table, and the Stripe branch that reads it**
     (`device-provider.ts:67`).
   - If you want the feature, it becomes `settings.payments` (section 2), with a dashboard control.
4. **The device's chosen card reader as a column on `devices`.**
   - This puts a payments column on the core `devices` table, next to its printer choices.
   - **Recommendation: yes.** It has the same shape as `receipt_printer_id`, and it removes a table.
   - Keeping `device_card_readers` instead costs one table and changes nothing else.
5. **Card-payment resolutions, holds and hold outcomes folded into `payments`.**
   - Today these are three small append-only tables. Folding them in needs a new guard trigger on
     `payments`, which has none today, so those facts still cannot change once written.
   - **Recommendation: fold them in.** It also turns the "hold or reversal, never both" race guard
     into a database check.
   - The alternative keeps three tables and needs no new trigger.
6. **Keep the AEAT answers that reconcile clears** (the `aeat.answer_cleared` kind).
   - What happens today: when reconcile resubmits a record AEAT has no trace of, it clears that
     record's CSV and error fields, and the old values are lost. AEAT says it cannot return a CSV
     again.
   - **Recommendation: yes.** It writes a few rows a year at most.
