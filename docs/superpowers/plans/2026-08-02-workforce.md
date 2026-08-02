# Workforce & registro de jornada — build-ready implementation plan

**Date:** 2026-08-02
**Status:** Draft plan, for review. Supersedes nothing; refreshes and operationalises
`docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md` (the "2026-07-22 design").
**Sub-project:** 16 (Workforce). Runs as a **parallel lane** to the fiscal sequence, migration-isolated.

**Decisions ratified (2026-08-02, product owner) — build to these where the body leaves them open:**
- **Gap 1 (chain topology): SINGLE active writer now.** The venue's working-time chain has one active
  writer (warm standby for failover), NOT active-active — a shared chain across two writers is the
  multi-master-on-a-hash-chain landmine the fiscal design forbids, and a blocked clock-in is far less
  serious than a blocked sale. Active-active is a **later enrolment** into the fiscal app-level
  replication machinery (native replication was just proven unusable under FORCE RLS + the
  non-superuser role — see `docs/superpowers/specs/2026-08-02-replication-force-rls-prototype-findings.md`;
  the reusable sync layer is being designed separately). Pre-production, so the later move is additive
  (drop/recreate), not a migration. Only **Slice 4** (the hash chain) is affected; the legal floor is not.
- **Gap 2 (legal floor): build to RDL 8/2019, NOT the unpublished digital-registro RD.** Verified
  2026-08-02: the digital *registro de jornada* Royal Decree is still **not law** — the Consejo de
  Estado gave a negative opinion (23 Mar 2026) and it remains unpublished in the BOE. RDL 8/2019 (a
  reliable, per-employee, retained clock-in/out record) is the in-force obligation. Do **not** design
  around the unpublished RD's speculative fields/formats; if it lands, its extras are additive.
- **Tip → employee attribution: OUT of this lane.** Name the dependency (needs a sale→server link, the
  till's job #7) and do not build it; the tip distribution policy is a #13 (tip-payroll) + advisor call.
- **Advisor items parked** — provincial convenio de hostelería figures, retención/SS rates, biometric
  DPIA — route to the *asesor laboral* (distinct from the fiscal asesor); not blockers for the floor.

---

## 0. What is on the ground today (verified, not assumed)

- **No workforce code exists.** `grep -rilE 'workforce|jornada|time.?record|clock.?in|clock.?out|time_entr|work_session|employment'` over `packages/`, `apps/`, `scripts/` returns one coincidental hit (`packages/fiscal-verifactu/src/acks.test.ts:31`, a `CLOCK_INSTANT` fixture). No `pgTable("persons"|"employments"|"time_entries"|"work_sessions"|"shifts"|"roles")` anywhere. Backlog's "Nothing below has any code" for #16 is confirmed.
- **Identity (#5) is also unstarted** — `docs/backlog.md` "Not started". D0 (persons + PIN + minimal role) is therefore net-new and this lane must build the minimal stub.
- **The generic+Spanish split pattern is real and copyable.** `packages/fiscal` (generic, interface-only) + `packages/fiscal-verifactu` (Spain, owns tables/migrations/RLS). But the closer precedent for a **table-owning generic package** is `packages/payments` / `packages/scheduler` / `packages/credentials` — each is an English `GENERIC_PACKAGES` member that owns its own `drizzle/` migrations, tables, and RLS. Workforce follows *that* precedent, not fiscal's interface-only one (see §3).
- **Migration wiring is manifest-driven** (`packages/migrations/migrations.manifest.json`, applied in-order under an advisory lock by `packages/migrations/src/apply.ts:44`). A new package registers in **one** JSON file plus two hardcoded tests (§3, §6). Each migration-owning package has its **own** `drizzle/meta/_journal.json` and its own `__drizzle_migrations_<pkg>` bookkeeping table, so journals never collide — this is what makes Workforce a safe parallel lane.
- **The tip already lives on `tenders.tip_amount`**, attributed to the payer (`packages/db/src/schema/sales.ts:148-184`), landed by #39. It is **not** attributed to the serving employee (there is no sale→person link on `tenders`). This matters for §5.

---

## 1. Design-readiness verdict

**The 2026-07-22 design is build-ready for the legal floor (D0 + D1) and needs a *targeted refresh*, not a redesign.** Its legal foundation (§2), package split (§4/§6), immutability model (§5), and advisor gaps (§10) are sound and match the codebase conventions. Four things need attention before or during build; two are genuine gaps opened by decisions that post-date the design, one is a freshness check, one is a confirmation.

### Gap 1 (architecture, LEAVES OPEN) — the per-location central hash chain collides with server-as-SIF active-active

The design (§5) specifies **"one chain per location (centro de trabajo), computed on the central server at ingest."** It predates the server-as-SIF + failover decision (`docs/superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`, merged #33), which decided a venue runs **two active-active servers, each its own SIF, each its own chain, with disjoint write-sets and asynchronous cross-replication** (that design §3–§4). That design explicitly rejects a **shared** append-only chain across two writers as the "symmetric multi-master on an append-only, hash-chained ledger" landmine (§4, lines 134-145: *"LWW on an append-only, hash-chained fiscal ledger means silently discarding a filed record. Conflict resolution must never come near the chain."*).

A **per-location** workforce chain is exactly a shared chain that **both** servers would write to → it forks on a split-brain, the same failure class §4 forbids for the fiscal chain. So "central server ingest" is now ambiguous (there are two co-equal servers), and the chain-writer scope is undecided.

**This does not block the legal floor.** The role-revocation floor (REVOKE UPDATE/DELETE + append-only triggers, §3 below) is the mandatory tamper-evidence and satisfies the current (2019) obligation on its own; the hash chain is a **detection** escalation. So the chain lands as a **separately-gated slice (Slice 4)**, and only that slice is blocked by this decision. Resolution options for the chain-writer scope:

- **(a) Chain per writer/server** (mirror the fiscal resolution): each server chains its own clock events on its own chain; `location_id` becomes a queryable attribute, not the chain key. Correct under active-active; structurally cannot fork. Recommended if the deli runs two active-active servers.
- **(b) Chain per location with a single active writer**: pin a location's clock ingest to one server. Simpler, but a clock-in blocks during that server's death. This is **far less catastrophic than a sale blocking** (a missed clock-in is recorded on recovery from the till's buffered event; a sale that cannot complete is a shop that cannot trade), so (b) is defensible for the launch deli.

The launch deli is small, and the server-as-SIF design (§4 Note, lines 161-168) permits a small venue to run **"a warm complete-copy standby with instant promotion"** (single-writer) rather than full active-active, reserving active-active "for larger multi-till venues." **Recommendation: state the deli's launch topology in the refresh** (warm-standby single-writer is the likely answer), take option (b) for the deli, and design the chain columns generically enough that (a) is a re-key not a rewrite (pre-production drop/recreate is free — `CLAUDE.md` §3). Decide before Slice 4, not before Slice 1.

### Gap 2 (freshness, LEAVES OPEN) — the digital-registro RD date has passed

The design (§2.3) records the *registro horario digital* RD as pushed for Consejo de Ministros **21 July 2026 (fallback 28 July)** and **"not in the BOE as of 2026-07-22."** Today is **2026-08-02** — both dates are in the past. The RD may now be published, which per the design's own warning "may add required fields or a specific export format." This is a **research + labour-advisor** item (analogous to the fiscal-advisor gap): confirm the published text, data fields, immutability spec, Inspección-access mechanism, and pymes adaptation calendar. **Design DECIDES to build-to-target (digital/interoperable/immutable); the OPEN part is the published text.** Because the schema is pre-production (drop/recreate), added fields are absorbable without migration — so this gates final compliance sign-off, not the start of the floor.

### Gap 3 (seam, LEAVES OPEN) — tip-income→employee attribution is under-specified post-#39

The design predates the sale-settlement model (#39). The card tip is now on `tenders.tip_amount` attributed to the **payer** (`packages/db/src/schema/sales.ts:160-184`), not to the employee who earned it. The new payroll duty in the backlog ("Card-collected tips are business income… *rendimiento del trabajo* with retención for the employee") needs the tip attributed to the **serving employee**, which requires a sale/tender→person link that **does not exist** and is the till's job (#7, unstarted) plus D0 persons. See §5 — this is integrate-not-build and a dependency to name, not build.

### Confirm 1 (DECIDED) — storage + currency/localisation assumptions hold

- **Storage:** a workforce record is **local venue data**, chained locally/synchronously, with **no AEAT submission** (unlike fiscal — the registro is retained locally 4 years and made available to Inspección, not filed to an outbox). The server-as-SIF design (§2, lines 72-74) only relocates "local" from the till to the server; the cloud is archive/sync-root, "never in the critical path" (memory: server-as-SIF). The design's §5 "single-node collapse" already covers the standalone case. **Consistent — no change.**
- **Currency:** the only money column is the employment pay rate → `numeric(12, 2)`, tenant currency, **no currency column** (matches the single-currency-per-tenant convention, e.g. `sales.total` at `sales.ts:97`).
- **Localisation:** the registro export and any staff-facing strings are **structured/localised, never stored formatted/English** (currency-and-localisation memory). The Spanish registro export *format* is regime-specific → `packages/workforce-es`.

**Distinguishing "decides" from "leaves open":** the design **decides** the immutability model, the package split, PIN/card clock-in (biometrics off + DPIA-gated), integrate-not-build payroll, single unified append-only stream, and per-location-vs-per-till chain rationale. It **leaves open** (now, because of post-dating decisions): the chain-writer scope under active-active (Gap 1), the digital-RD published text (Gap 2), and the tip→employee link (Gap 3). It also leaves open, as it always did and correctly routes to the **asesor laboral**: the provincial convenio figures, whether pauses must be recorded, exact LISOS cuantías/SS rates, the gestoría's export layout, and the DPIA (§10).

---

## 2. Minimal legally-compliant v1 of the registro de jornada

### What the law actually requires to be recorded (current binding 2019 regime, ET art. 34.9)

From the design §2.1 (verified against primary sources it cites — BOE-A-2015-11430, BOE-A-2019-3481):

- **Content:** *"el horario concreto de inicio y finalización de la jornada de trabajo de cada persona trabajadora"* — **start and end clock time, per worker, per day.** Applies to all workers, all company sizes, no SME exemption.
- **Retention:** **4 years.**
- **Access-holders (three):** the **worker**, their **legal representatives**, and the **Inspección de Trabajo y Seguridad Social (ITSS)**.
- **Overtime (art. 35.5):** computed **day by day**, **totalised per pay period**, a **resumen handed to the worker with the payslip** → requires a **contracted-hours baseline** on the employment (overtime = actual − ordinary jornada).
- **Method:** free under the 2019 regime (paper is permitted); set by convenio/company agreement, or employer decision after consulting worker reps.
- **Tamper-evidence / immutability:** **not** an explicit requirement of the 2019 statute text (format-free, paper allowed). It **is** an expected requirement of the imminent digital RD (§2.3), and the design correctly builds to that target.

### The smallest thing that satisfies it

1. **`persons`** — who worked (identity; D0).
2. **`employments`** — the contracted-hours baseline, so overtime is computable (art. 35.5).
3. **`time_entries`** — an **append-only** stream of `in`/`out` (and `break_start`/`break_end`) events, per person per day, each with a trusted timestamp.
4. **`work_sessions`** — a derived projection (start/end/worked/overtime per person per day), rebuildable from `time_entries`; this is what the registro export renders.
5. **Tamper-evidence floor:** the **role-revocation floor** — `REVOKE UPDATE, DELETE` from the app role + `reject_mutation()` append-only trigger + a TRUNCATE-blocking trigger, reusing the shared functions core already installs. This is cheap, well-precedented (`registros_facturacion`), lives **below** the app, and is a defensible reading of "immutability" without the hash chain.
6. **Corrections as append rows** (people forget to clock out): a correction is a new attributable row referencing the original, supervisor-gated, never an `UPDATE` — satisfies the art. 34.9 worker right to see and contest.
7. **Access/export surface:** `exportTimeRecord(period)` for the three access-holders + a 4-year-retention posture (no deletion path; retention is the default of an append-only table).

**The hash chain is NOT in the minimal v1.** It is the tamper-*detection* escalation and is gated on Gap 1's topology decision (Slice 4). The role-revocation floor is the mandatory piece.

### What genuinely needs the LABOUR advisor (asesor laboral / graduado social — a different person from the fiscal asesor)

These are the analogues of the fiscal-advisor gap and must not be guessed:

- **The digital-registro RD's published text** (Gap 2) — fields, immutability spec, Inspección-access mechanism, pymes calendar. **Run a fresh BOE check now** (dates passed).
- **Whether pauses/breaks must be recorded** — the statute mandates only inicio/fin; recording pauses is *advisable* for turnos partidos (an unrecorded interval is presumptively worked time) but interpretive. Build the `break_start`/`break_end` event kinds regardless (cheap, design §2.1); the *obligation* is advisor territory.
- **The applicable provincial convenio de hostelería** and its figures (nocturnidad %, split-shift plus, overtime cap, rest rules) → `convenio_config`, D2, never hardcoded.
- **Exact LISOS cuantías** (grave, 751–7.500 €, art. 7.5) and **SS rates/tramos** — gestoría territory, time-varying.
- **The gestoría's package + import layout** — the single fact that fixes the D3 export format.
- **DPIA** before any biometric clock-in is ever enabled (AEPD, §2.4). Default is PIN/card; biometrics off.
- **The correction approval flow** (worker-requests → manager-approves) — the worker's right to contest is legal; the exact workflow is part product decision.

---

## 3. Package structure + schema

### Two packages, mirroring the fiscal split but following the *payments* (table-owning) precedent

**`packages/workforce` — regime-neutral core, English, IN the English-only guard.** Owns:
- The `WorkforceBackend` and `WorkTimeRuleset` interfaces + generic English types (`Person`, `Employment`, `TimeEntry`, `WorkSession`, `Correction`, …).
- The generic engine: the append-only immutable time-entry stream, the work-session projection, and (Slice 4) the generic hash-chain — note the chain here is a **generic** mechanism (English `entry_hash`/`prev_entry_hash`/`sequence_no`), *unlike* `packages/fiscal` where chaining is a regime concept forbidden by `no-regime-vocabulary.test.ts`. Workforce needs **no** such guard; its chain is generic by design (2026-07-22 §6).
- The **tables** persons, employments, time_entries, work_sessions (+ role enum) and its **own** `drizzle/` migrations + RLS + `errors.ts`.

**`packages/workforce-es` — the Spain module, EXEMPT from the English-only guard.** Owns:
- The `WorkTimeRuleset` populated with the ET numbers (§2.5), the registro-de-jornada **export rendering** (three access-holders, 4-year framing, digital-RD fields), the PIN/card clock-in defaults, and (D2) the `convenio_config` table + its own migration, and (D3) the payroll-export adapters (a3/ContaPlus/Sage).
- Depends on `@waitron/workforce` + `@waitron/db` + `@waitron/shared` + `@waitron/core`.

Why table-owning-generic and not interface-only-like-fiscal: `persons`/`employments`/`time_entries` are genuinely regime-neutral English tables (not AEAT-shaped the way `registros_facturacion` is), so they belong in the generic package exactly as `payments` owns its own generic tables. Only `convenio_config` is Spain-shaped → `workforce-es`. (This is what the 2026-07-22 design §4 already says; this plan confirms it against the `payments` precedent.)

### `package.json` / config skeleton (copy from `packages/fiscal-verifactu`)

Scripts `test`/`test:coverage`/`typecheck`/`lint`/`db:generate`; `vitest.config.ts` with coverage `exclude` of `drizzle.config.ts`, `drizzle/**`, `src/testing/**` and **thresholds 98/98/98/95** (the repo standard — `packages/fiscal-verifactu/vitest.config.ts:25`). `main: ./src/index.ts`, no build step.

### Tables (D0 + D1), all English, all `tenant_id` + `.enableRLS()`, FK to core `tenants`/`tills`/`locations` (imported from `@waitron/db`)

**D0 — `packages/workforce`:**

- **`persons`** — `id uuid pk`, `tenant_id uuid → tenants.id (RLS)`, `display_name text`, `pin_hash text` (hashed — argon2/bcrypt, never plaintext), `role` (pgEnum `workforce_role`: `staff`/`supervisor`/`manager`/`admin`), `status` (pgEnum: `active`/`suspended`), `created_at`. **Mutable** (PIN, role, status change): app role `SELECT, INSERT, UPDATE`. RLS tenant isolation.
  - *Role model:* a single `role` column on `persons` is the minimal floor (the only workforce-internal role-gated action is a time correction). Full RBAC / multi-role / per-employment roles → #5.

**D1 — `packages/workforce`:**

- **`employments`** — `id`, `tenant_id (RLS)`, `person_id → persons.id`, `contracted_minutes_per_week integer` (the overtime baseline), `contract_type text`, `start_date date`, `end_date date null`, `convenio_ref text null` (a *reference*; the numbers live in `convenio_config`, D2), `pay_rate numeric(12,2)` (tenant currency, no currency column), `created_at`. Mutable. RLS.
- **`time_entries`** — the **single append-only stream** (events + corrections):
  - `id`, `tenant_id (RLS)`, `person_id → persons.id`, `location_id → locations.id` (the centro de trabajo), `entry_kind` (pgEnum: `in`/`out`/`break_start`/`break_end`/`correction`), `event_at timestamptz mode:string` (the trusted event timestamp — pattern from `sales.issued_at`), `event_offset_minutes integer` (preserve the wall offset — pattern from `sales.issued_offset_minutes`), `captured_by_till_id → tills.id null`, `recorded_by_person_id → persons.id` (who recorded it), `ingest_seq integer` (ingest/chain order, assigned centrally).
  - Correction columns: `corrects_entry_id → time_entries.id null` (self-ref), `correction_reason text null`, `correction_status` (pgEnum `requested`/`approved` null), `correction_actor_id → persons.id null`.
  - **Slice 4 chain columns (generic English):** `sequence_no integer`, `entry_hash text`, `prev_entry_hash text null`, `is_chain_head boolean` — with the CHECK-constraint shape of `registros_facturacion` (`registros_encadenamiento_ck`). Deferred until Gap 1 resolves.
  - **Immutability:** `REVOKE ALL … FROM app_user; GRANT SELECT, INSERT` + `BEFORE UPDATE OR DELETE` `reject_mutation()` trigger + `BEFORE TRUNCATE` trigger, reusing the shared `current_tenant_id()` and `reject_mutation()` created by core migrations `0001_tenancy_rls.sql`/`0002_immutability.sql` — **do not redefine them** (exact pattern: `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql`). Hand-written SQL migration (`db:generate:custom`), because triggers/policies/REVOKE are invisible to `drizzle-kit`.
- **`work_sessions`** — derived projection: `id`, `tenant_id (RLS)`, `person_id`, `location_id`, `work_date date`, `started_at`, `ended_at`, `break_minutes integer`, `worked_minutes integer`, `overtime_minutes integer`. **Mutable/rebuildable** (app role full DML) — it is *not* the legal record (`time_entries` is); it is the queryable/exportable view, reprojected as corrections arrive, latest-correction-wins, rebuildable from `time_entries`.

**D2 (deferred, framed):** `shifts`, `roster_versions`, `absences`, `shift_swaps`, `shift_templates`, `availability` (`packages/workforce`) + `convenio_config` (`packages/workforce-es`, Spanish, own migration → second manifest entry).

### Error codes (domain-named, never the package — `CLAUDE.md` §3)

Augment `@waitron/shared`'s `ErrorParams` by declaration merging, `import "@waitron/shared"` + a domain-named code, every throwing file `import "./errors.js"` (pattern: `packages/fiscal/src/errors.ts`). Proposed domains:

- `person.*` — `person.not_found`, `person.pin_invalid`
- `employment.*` — `employment.not_found`
- `attendance.*` — `attendance.already_open` (clock-in while an entry is open), `attendance.no_open_entry` (clock-out with none open)
- `correction.*` — `correction.not_permitted` (non-supervisor), `correction.target_not_found`

**Trap (`CLAUDE.md` §3 "grep the siblings"):** `clock.*` is already taken by `packages/fiscal` for the trusted clock (`clock.degraded`, `clock.jump_detected` — `packages/fiscal/src/errors.ts:30,33`). **Do not reuse `clock.*` for clock-in/out** — that is why the attendance domain is `attendance.*`. Grep the registry before finalising every code; error codes are never renamed once shipped.

### English-only guard implications (concrete edits)

- **Add `"workforce"` to `GENERIC_PACKAGES`** — `packages/db/src/english-only.ts:8-16`.
- **Add `"workforce-es"` to `EXEMPT_PACKAGES`** — `packages/db/src/english-only.ts:19`.
- **Update the two hardcoded `toEqual` assertions** in `scripts/english-only.test.ts:37-47` (the seven→eight generic list) and `:49-55` (the two→three exempt list). These are exact-match; they fail otherwise.
- **Add the Spanish LABOUR tokens to `SPANISH_WORDS`** (`packages/db/src/english-only.ts:104`) so the generic `workforce` package is actually guarded against leaking Spanish labour vocabulary — the current list has fiscal/POS terms but **no** labour terms. Candidates: `jornada(s)`, `convenio(s)`, `nomina(s)`, `trabajador(es)`, `trabajo`, `centro`, `presencia`, `fichaje(s)`, `descanso(s)`, `ausencia(s)`, `turno(s)`, `horario(s)`, `nocturnidad`, `festivo(s)`, `vacaciones`, `permiso(s)`, `baja(s)`, `finiquito`, `empleado(s)`, `contrato(s)`, `salario(s)`, `retribucion`. (`hora`, `fecha` already present.)
  - **Verify before committing:** the tokeniser matches whole tokens (`packages/db/src/english-only.ts:248-257`), so English words that merely *contain* a token are safe (`contract` ≠ `contrato`, `permission` ≠ `permiso`). But adding tokens re-scans **all** generic packages — run `findSpanish` over `db`/`core`/`fiscal`/`shared`/`payments`/`scheduler`/`credentials` with the extended list first, to catch any pre-existing English identifier that tokenises to one of these (e.g. confirm no `centro`/`turno`/`baja` collision). This is the "a measurement where both answers look alike measures nothing" discipline — prove the new tokens fire on `workforce-es` fixtures and stay silent on the existing generics.

*(Note: `SPANISH_WORDS`/`GENERIC_PACKAGES`/`EXEMPT_PACKAGES` live in `packages/db/src/english-only.ts` — a shared file. This is a small, additive touch and the only `packages/db` source edit the lane needs, but it is a shared-file edit; coordinate with the fiscal lane. It is not a migration and carries no journal-collision risk.)*

---

## 4. The write path (clock-in / clock-out)

**Recording a clock event:**
1. A person authenticates at a till: the till UI collects `person` + PIN → verifies against `persons.pin_hash` (a single `verifyPin` function in `packages/workforce`).
2. The till calls `WorkforceBackend.clockIn(personId, locationId, tillId, trustedTimestamp)` (and `clockOut`/`breakStart`/`breakEnd`).
3. The backend, inside `withTenant(db, tenantId, …)` **as the app role** (`asAppUser` in tests), **INSERTs** an `in` event into `time_entries`. It first checks the open/closed state (reject `attendance.already_open` / `attendance.no_open_entry`). `ingest_seq` comes from a per-writer counter; under Slice 4 the chain hash is computed under a row lock (pattern: `lockChainHead`/`appendToChain`, `packages/fiscal-verifactu/src/chain.ts`).
4. The **trusted timestamp** is supplied by the same `createTrustedClock` the sale path uses (`packages/fiscal` — generic, no regime, safe to import). Offline capture buffers events locally and appends on sync **in ingest order**, projecting by `event_at` (design §5) — the projection sorts by trusted timestamp, the chain commits to ingest order.

**Who can record:**
- **Clock events:** the person themselves (self-service via PIN). Attributed via `recorded_by_person_id`.
- **Corrections:** **supervisor-gated** (`persons.role ∈ {supervisor, manager, admin}`), append-only, with actor + reason + approval status. Optional worker-request → manager-approve flow (art. 34.9 right to contest).

**Identity dependency (#5 unstarted) and how to stub it minimally:**
- **D0 in `packages/workforce` IS the minimal identity stub** — `persons` + `pin_hash` + `role` enum + `verifyPin`. No invitations, no SSO, no full RBAC.
- **#5 later absorbs D0** and extends the same `person` entity (invitations, full RBAC). Relocating `persons` to a future `packages/identity` is a **free** rename (pre-production drop/recreate — `CLAUDE.md` §3), so building it in `workforce` now costs nothing later.
- **No app consumes the write path yet** — there is no `apps/till` (backlog: "there is no application a person can use"). The write path is exercised through the `WorkforceBackend` API and its test suites; a provisioning/CLI fixture seed can create a person for manual testing. This is the same posture as the rest of the system.

---

## 5. Payroll integration seam (integrate-not-build)

**The seam, not an engine.** `packages/workforce` computes the **authoritative** hours/overtime/absences per worker per pay period (from `work_sessions` + the `employments` contracted baseline). `packages/workforce-es` **adapts** that to a specific external format:

- `WorkforceBackend.exportPayroll(period)` / `exportTimeRecord(period)` → **structured** data (never formatted/English strings — localisation memory). No cotización computation, no SS/AEAT filing.
- The concrete adapter (CSV/Excel + optional a3/ContaPlus/Sage import layout) is **D3, deferred** until the gestoría's package is known — "the single fact that fixes the export format" (design §2.7/§11).
- **Finiquito hand-off** at termination (accrued vacaciones, pagas extras) — D3, uses the `employments` start/end boundary.

**The tip-income sub-seam (from the backlog, Gap 3).** Card tips are business income requiring per-employee *rendimiento del trabajo* + retención. But the tip is on `tenders.tip_amount` attributed to the **payer**, not the employee (`packages/db/src/schema/sales.ts:160-184`). To feed payroll, the tip must be attributed to the **serving employee**, which needs a sale/tender→person link that:
- does not exist today, and
- is the **till's** job (#7, unstarted) plus **D0 persons**.

**Recommendation: do not build tip→employee attribution in the workforce floor.** Name the dependency: when #7 attributes a sale to a serving person and D0 persons exist, the **tip-payroll track (#13)** sums card tips per employee and feeds the payroll export. The **distribution policy** (tronc / reparto — does a card tip go to the server, get pooled, or split?) is a **labour + product decision** (advisor + owner), not something this lane determines.

---

## 6. Phasing (subagent-driven, TDD-first, legal floor first)

Each slice is an independently-reviewable PR. **Order puts the legally-required registro de jornada first**; the hash chain is gated last.

| Slice | Deliverable | Key work | Blocks / gated by |
| --- | --- | --- | --- |
| **1 — Scaffold + D0 identity stub** | `packages/workforce` skeleton; `persons` + `role` enum + `verifyPin` | package.json/vitest/tsconfig (98/98/98/95); `src/errors.ts` (`person.*`); `persons` table + RLS + own `drizzle/` migration; **register in `migrations.manifest.json`** (after `core`, **before `credentials`**) + update `manifest.test.ts` + `instance-apply.rls.test.ts` last-set assertion + `packages/migrations/package.json` devDep; wire English-only (add `workforce` to `GENERIC_PACKAGES`, add labour tokens to `SPANISH_WORDS`, update the two `toEqual` assertions) | none |
| **2 — D1a Time & attendance (THE LEGAL FLOOR)** | `employments` + `time_entries` (append-only, **role-revocation floor**) + clock in/out/break + `work_sessions` projection (worked + overtime vs contracted) | hand-written immutability SQL (REVOKE + `reject_mutation`/block-truncate triggers, reusing core functions); `WorkforceBackend` clocking methods; projection engine; `attendance.*` codes; teeth-tests | Slice 1 |
| **3 — D1b Corrections + registro export** | correction events (supervisor-gated, request→approve), reprojection (latest-wins, history retained); **create `packages/workforce-es`** rendering `exportTimeRecord` for the three access-holders + 4-year framing | `correction.*` codes; add `workforce-es` to `EXEMPT_PACKAGES` + update assertion; workforce-es package skeleton (no tables yet) | Slice 2 |
| **4 — D1c Hash chain (tamper-detection escalation, GATED)** | generic per-writer/per-location hash chain over `time_entries` | chain columns + CHECK; `appendToChain`/`lockChainHead` under a row lock; teeth-test: detect inserted/removed/reordered entry; concurrency test on **real Postgres only** | **Gap 1 topology decision** (chain-writer scope + deli topology) |
| **D2 — Scheduling** | shifts/rosters/absences/swaps/templates/availability + `convenio_config` (workforce-es, second manifest entry) + ET-guardrail validations against `convenio_config` | own later spec | asesor laboral: convenio figures |
| **D3 — Payroll export** | export adapter + finiquito hand-off | own later spec | gestoría package known |

**Legal-floor completeness:** after **Slice 3** the 2019 registro de jornada obligation is satisfiable (record inicio/fin per worker per day, immutable via role-revocation, corrections attributable, 4-year retention, export to the three access-holders). Slices 1–3 do **not** depend on Gap 1 or Gap 2.

**Parallel-lane safety (the whole point of #16 running beside the fiscal sequence):** Workforce owns its own `drizzle/` journal and `__drizzle_migrations_workforce` table — **no collision** with the fiscal sequence's `packages/db`/`packages/fiscal-verifactu` journals. The only shared-file touches are `migrations.manifest.json`, the two hardcoded migration tests, and `packages/db/src/english-only.ts` (additive). Coordinate those small edits; nothing else overlaps the fiscal lane.

---

## 7. Test strategy (PGlite vs real Postgres — `CLAUDE.md` §4)

**Real Postgres (Testcontainers; `useRealPostgres`/`describeEachTarget`; `TESTCONTAINERS_RYUK_DISABLED=true` locally) — required for:**
- **RLS tenant isolation** on every table (PGlite connects as superuser and bypasses RLS — a false pass).
- **The role-revocation floor** — `UPDATE`/`DELETE`/`TRUNCATE` on `time_entries` denied **as the app role** (`asAppUser`), asserting SQLSTATE `WT001`. PGlite's superuser can `DISABLE TRIGGER` and bypasses RLS, so this MUST run on real Postgres or it is theatre (pattern: `packages/fiscal-verifactu/src/inmutabilidad.test.ts`, whose first assertion proves it is actually running as the non-owner role).
- **Chain concurrency (Slice 4)** — two concurrent appends racing one chain position. PGlite serialises every query onto one backend, so a contention test on it is a **false pass, not a weak one** — mirror `packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts` and pin the reason in a comment.

The harness runs migrations **core-first**: `runMigrationSets(uri, [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS])` (pattern: `packages/fiscal-verifactu/src/testing/postgres.ts`), because cross-package ordering is the runtime's responsibility and nothing in Drizzle enforces it.

**PGlite (`usePgliteDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS], setup })`) — the lighter, hermetic target for logic that does not touch privileges/RLS/concurrency:**
- work-session projection + overtime computation (actual − contracted, totalised per pay period).
- `verifyPin` hashing.
- correction reprojection ordering (latest-correction-wins, original stays visible).
- **offline out-of-order timestamps: project by `event_at`, chain by `ingest_seq`** (design §7).

**Teeth-tests (design §7 — each must bite; prove by deletion, `CLAUDE.md` §4):**
- the chain detects an inserted / removed / reordered entry (Slice 4);
- `UPDATE`/`DELETE` on `time_entries` denied as the app role;
- a correction reprojects the work-session while the original stays visible;
- overtime = actual − contracted, per pay period;
- (D2) scheduling validations read `convenio_config` — no hardcoded convenio numbers (guard pattern: `packages/fiscal/src/no-hardcoded-margin.test.ts`);
- biometrics off by default (clock-in is PIN/card unless DPIA-gated).

Coverage **98/98/98/95**. Run each package **unfiltered** before believing a pass (a name-filtered run skips cross-cutting guard suites — `CLAUDE.md` §2), and use `test:coverage` not `test` (CI's shards run coverage).

---

## Appendix — exact wiring receipts (for the implementer)

- **Central manifest (one edit):** `packages/migrations/migrations.manifest.json` — add `{ "name": "workforce", "table": "__drizzle_migrations_workforce", "from": "../workforce/drizzle" }` **after `core`, before `credentials`** (D2 later adds a `workforce-es` entry for `convenio_config`). Runtime (`apps/server/src/boot.ts:116`), provisioning (`packages/provisioning/src/instance-apply.ts:183`), status readers, and both `copy-migrations.mjs` scripts are all manifest-driven and pick it up automatically.
- **Descriptor:** `packages/workforce/src/migrations.ts` exporting `WORKFORCE_MIGRATIONS = { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)), migrationsTable: "__drizzle_migrations_workforce" }`, re-exported from `index.ts` (pattern: `packages/fiscal-verifactu/src/migrations.ts:9-15`).
- **Tests that hardcode the set list and WILL fail until updated:** `packages/migrations/src/manifest.test.ts:21-27` (the `byName` `toEqual` map + import the descriptor) and `packages/provisioning/src/instance-apply.rls.test.ts:462-471` (asserts the **last** manifest set is `credentials` — placing `workforce` before it keeps this green; its own comment anticipates a sixth set). Add `"@waitron/workforce": "workspace:*"` to `packages/migrations/package.json` devDependencies.
- **Immutability SQL to copy verbatim (adapt names):** `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql` — `FORCE ROW LEVEL SECURITY`, tenant-isolation `POLICY` using `current_tenant_id()`, `REVOKE ALL … GRANT SELECT, INSERT`, `reject_mutation()` UPDATE/DELETE trigger + block-truncate trigger. Do **not** redefine `current_tenant_id()`/`reject_mutation()` — core installs them.
- **English-only:** `packages/db/src/english-only.ts:8` (`GENERIC_PACKAGES`), `:19` (`EXEMPT_PACKAGES`), `:104` (`SPANISH_WORDS`); assertions at `scripts/english-only.test.ts:37-55`.
- **Commit convention:** `git commit -s` (DCO); coverage via `test:coverage`; run the gate `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` plus `pnpm --filter @waitron/workforce test:coverage`.
