# Workforce D2 — Scheduling (shifts/rosters + `convenio_config`): design brief

**Date:** 2026-08-02
**Status:** Design brief, for review. No code written. Read-only against the tree.
**Update (2026-08-02):** D2.0 + D2.1 have since been implemented on `feat/workforce-d2-scheduling`
(PR #50). The "No code written" status above describes this brief at authoring time, before the code
landed; it is left intact as the record of what was true then (CLAUDE.md §6).
**Scope:** Sub-project 16, deliverable **D2** — planned working time (shifts / rosters / absences /
swaps / templates / availability) + the `convenio_config` surface that supplies the overtime rule and
the ET/convenio guardrails. **D3 (payroll export)** is out of scope; **D1 (registro de jornada, #47)**
is the floor this extends.
**Predecessors:** plan `docs/superpowers/plans/2026-08-02-workforce.md`; design
`docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md` (§2.5, §4, §5, §6 D2 sections).

Every file:line below was read in the current tree, per CLAUDE.md §1.

---

## 1. What D1 (#47) already provides — verified from the code

D1 shipped **more than its plan gated**: the plan (`2026-08-02-workforce.md` §6) held the hash chain
(Slice 4) behind a topology decision, but the merged code carries it — Gap 1 was resolved to
"chain per (tenant, location), single active writer" and Slice 4 landed. So the workforce floor today
is **D0 + full D1 incl. tamper-evidence chain**.

### 1.1 Tables (all `packages/workforce`, English, `tenant_id` + `.enableRLS()`)

| Table | File | Mutability | App-role grant |
| --- | --- | --- | --- |
| `persons` (D0 identity stub: id, display_name, pin_hash, `role` enum, `status` enum) | `src/schema/persons.ts` | **Mutable** | `SELECT, INSERT, UPDATE` (`drizzle/0001_workforce_rls.sql:28`) |
| `employments` (person↔tenant, `contracted_minutes_per_week`, contract_type, start/end_date, pay_rate) | `src/schema/employments.ts` | **Mutable** | `SELECT, INSERT, UPDATE` (`drizzle/0003_workforce_d1a_rls.sql:33`) |
| `time_entries` (the append-only clock stream + corrections + chain columns) | `src/schema/time-entries.ts` | **IMMUTABLE** | `SELECT, INSERT` only (`drizzle/0003_workforce_d1a_rls.sql:42`) |
| `workforce_chains` (chain head, one row per (tenant, location)) | `src/schema/workforce-chains.ts` | Mutable (head pointer) | (managed by `appendToChain`) |

- **`persons` is the minimal identity stub** — a single `role` pgEnum
  (`staff`/`supervisor`/`manager`/`admin`, `persons.ts:23`). Full RBAC is #5's; relocating `persons`
  to a future `packages/identity` is a free pre-production rename (`persons.ts:36-37`).
- **`employments` deliberately dropped `convenio_ref`** — the plan §3 listed one, but `convenio` is a
  `SPANISH_WORDS` token forbidden in this generic package and had no Slice-2 consumer
  (`employments.ts:26-30`). **D2 adds any needed reference as an English-named column / FK.** This is
  the seam where an `employment → convenio_config` link lands.
- **Immutability floor:** `REVOKE ALL` + `GRANT SELECT, INSERT` + `reject_mutation()` BEFORE
  UPDATE/DELETE trigger + BEFORE TRUNCATE trigger, raising SQLSTATE `WT001`
  (`drizzle/0003_workforce_d1a_rls.sql:41-56`). Reuses core's shared `current_tenant_id()` /
  `reject_mutation()` — never redefined (`0003…rls.sql:6-12`).

### 1.2 The tamper-evidence chain (Slice 4, already landed)

`time_entries` carries generic English chain columns `entry_hash`, `prev_entry_hash`, `sequence_no`,
`is_first_entry` (`time-entries.ts:98-113`), keyed one chain per **(tenant, location)** via
`workforce_chains` (`workforce-chains.ts:6-18`). Appends go through `appendToChain` under a
`FOR UPDATE` row lock on the head (`src/chain.ts`, `src/chain-hash.ts`), with a
`time_entries_chain_position_uq` unique index as the race backstop (`time-entries.ts:180`).
The chain-writer scope decision — **single active writer per location** — is settled and documented
(`workforce-chains.ts:9-13`), so D2 inherits a resolved topology.

### 1.3 The overtime projection — and how it gets its "convenio" parameters TODAY

**There is NO `convenio_config` table yet.** The both-model projection is pure TypeScript in
`packages/workforce/src/projection.ts`, and its convenio-dependent inputs currently arrive as
**function arguments and two hard-coded floor-scope defaults**:

- `summarisePeriod(sessions, period, contracted: ContractedTerms, headlineModel = "daily-accrual")`
  (`projection.ts:288-293`) returns **both** figures side by side —
  `dailyAccrualOvertimeMinutes` (art. 35, `Σ max(0, worked_d − dailyTarget_d)`) and
  `periodNetOvertimeMinutes` (art. 34.2, `max(0, totalWorked − periodMinutes)`) — plus a per-day
  breakdown, and picks neither as authoritative (`projection.ts:99-117, 271-325`).
- `ContractedTerms` = `{ periodMinutes, dailyTargetMinutes }` is **supplied by the caller**
  (`projection.ts:88-97`).
- `WorkforceBackend.workSummary` builds `ContractedTerms` from `employments.contracted_minutes_per_week`
  alone: `periodMinutes = round(contractedPerWeek × periodDays / 7)` and
  `dailyTargetMinutes = dailyContractedTargetMinutes(contractedPerWeek)`
  (`src/clocking.ts:131-144`).
- `dailyContractedTargetMinutes(x) = round(x / DEFAULT_WORKING_DAYS_PER_WEEK)`, with
  `DEFAULT_WORKING_DAYS_PER_WEEK = 5` — **a documented floor-scope default explicitly flagged for D2
  to refine** (`projection.ts:251-269`).
- The **headline overtime model** defaults to `"daily-accrual"` — a documented conservative default,
  never authoritative; "which model binds is convenio/contract-driven — an asesor-laboral decision"
  (`projection.ts:280-286`).

**This is the whole of D2's `convenio_config` job on the overtime side:** the three quantities the
projection needs — (a) the per-day target / working-days-per-week, (b) the period-net baseline scaling,
(c) which model is the headline — are already isolated behind one function
(`dailyContractedTargetMinutes`) and one parameter (`headlineModel`). D2 replaces the hard-coded `5`
and the default `"daily-accrual"` with values **read from a `convenio_config` row**, changing exactly
those two call sites. Because today's defaults already equal a safe legal reading, **D2 can turn them
into config columns whose defaults reproduce current behaviour — landing the surface without waiting
on the asesor** (see §3, §7).

### 1.4 The registro export (Slice 3, `packages/workforce-es`)

`exportTimeRecord(sessions, periodo)` renders the reprojected sessions into the Spanish legal record
(`packages/workforce-es/src/registro-jornada.ts:64`): the three `TITULARES_ACCESO`
(`trabajador`/`representantes_legales`/`inspeccion_trabajo`, `:21-25`) and `ANOS_CONSERVACION = 4`
(`:28`). **`workforce-es` owns no tables, no `drizzle/` folder, and does not depend on `@waitron/db`
yet** (`packages/workforce-es/package.json:14-16`) — D2 makes it migration-owning for the first time
(§4, §Appendix). Note the deferred edge from the backlog: **the registro export does not surface
overtime** — that belongs to the payslip / D3, not D2.

---

## 2. The scheduling data model

### 2.1 The load-bearing distinction: planning data is NOT the legal record

`time_entries` is the immutable *registro de jornada* — what **actually happened**. Everything D2 adds
is **planned** working time: what was *intended*. The design's planned-vs-actual seam is explicit —
"`shifts` (planned) and the `work_sessions` projection (actual) link by **person + date**… the actual
side stands alone; the planned side is additive" (`2026-07-22…design.md:220-225`).

**Therefore the scheduling tables are ordinary mutable planning data**, NOT append-only and NOT
hash-chained:

- No `reject_mutation()` trigger, no `REVOKE UPDATE/DELETE`, no chain columns. A draft roster is
  edited and deleted freely; a shift is moved; an availability window changes.
- They follow the **`persons`/`employments` mutable-RLS pattern** — `FORCE ROW LEVEL SECURITY` +
  tenant-isolation policy on `current_tenant_id()` + `REVOKE ALL … GRANT SELECT, INSERT, UPDATE
  [, DELETE]` (`drizzle/0001_workforce_rls.sql:14-28`). Planning rows may take **DELETE** (a draft
  roster is discardable) — unlike `persons`/`employments`, which withhold DELETE to preserve the
  referent of the immutable history.
- **Rationale, stated for reviewers (§1 claim):** the legal tamper-evidence obligation (art. 34.9,
  RDL 8/2019) is on the *record of hours worked* — satisfied entirely by `time_entries`
  (`time-entries.ts:45-63`). No Spanish statute requires a **schedule** to be immutable. So imposing
  the append-only floor on rosters would be cost with no legal payoff and would break ordinary
  planning edits. If a venue later wants an audit trail of *published* rosters for labour-dispute
  purposes, that is a `roster_versions`-level snapshot (below), not row-immutability — and it is an
  owner call, not a legal one (§7).

### 2.2 Tables D2 adds (all `packages/workforce`, English, except `convenio_config` → `workforce-es`)

Names must be **English** — `turno`, `horario`, `ausencia`, `permiso`, `baja`, `vacaciones` are all in
`SPANISH_WORDS` (`english-only.ts:236-247`), so the generic tables use `shifts`, `absences`, etc.

- **`shifts`** — a planned shift: `id`, `tenant_id (RLS)`, `person_id → persons.id`,
  `location_id → locations.id`, `starts_at timestamptz` + `starts_offset_minutes`, `ends_at` +
  `ends_offset_minutes` (mirror the `time_entries.event_at`/`event_offset_minutes` wall-offset pattern,
  `time-entries.ts:73-76`), `role text null`, `roster_version_id → roster_versions.id null` (null while
  a draft, set on publish), `created_at`. Mutable, full DML. Link to actuals is **person + local date**
  (`2026-07-22…design.md:222`) — a read model, not an FK, since a worked session may have no planned
  shift and vice-versa.
- **`roster_versions`** — a published snapshot: `id`, `tenant_id (RLS)`, `location_id`,
  `period_start date`, `period_end date`, `published_at timestamptz null` (null = draft),
  `published_by_person_id → persons.id null`, `status` pgEnum (`draft`/`published`/`superseded`),
  `created_at`. Mutable. Publishing a version flips `status` and stamps `published_at`; a later publish
  supersedes. **Not immutable** — see §2.1; if the owner wants published snapshots frozen, that is an
  additive decision (§7).
- **`absences`** — vacaciones / baja / permisos: `id`, `tenant_id (RLS)`, `person_id`, `absence_kind`
  pgEnum (**English**: `holiday`/`sick_leave`/`leave`/`unpaid` — the Spanish `vacaciones`/`baja`/
  `permiso` mapping lives in `workforce-es` rendering), `starts_on date`, `ends_on date`,
  `status` pgEnum (`requested`/`approved`/`rejected`), `note text null`, `created_at`. Mutable.
- **`shift_templates`** — reusable shift shapes: `id`, `tenant_id (RLS)`, `location_id`, `label text`,
  `weekday smallint`, `starts_minute int`, `ends_minute int`, `role text null`. Mutable.
- **`availability`** — a person's stated availability windows: `id`, `tenant_id (RLS)`, `person_id`,
  `weekday smallint`, `available_from_minute int`, `available_to_minute int`, `effective_from date`,
  `effective_to date null`. Mutable.
- **`shift_swaps`** — a swap request between two people over two shifts: `id`, `tenant_id (RLS)`,
  `requested_by_person_id`, `from_shift_id → shifts.id`, `to_person_id`, `to_shift_id → shifts.id null`,
  `status` pgEnum (`requested`/`accepted`/`approved`/`rejected`), `created_at`. Mutable.
- **`convenio_config`** — **`packages/workforce-es`**, Spain-specific — see §3.

All FKs use the array `foreignKey({…})` form with `.onDelete("restrict")` (the coverage-driven
convention, `employments.ts:50-64`) — except planning rows that may cascade a draft cleanup, which is
an implementer call. All carry `tenant_id` + `.enableRLS()` and an RLS migration in the mutable-table
shape of `0001_workforce_rls.sql`.

### 2.3 Migration — confirmed against the actual wiring

- The **generic scheduling tables** go in `packages/workforce/drizzle` as the next migrations after
  `0006` — its own journal (`__drizzle_migrations_workforce`, `src/migrations.ts:13-16`), so **no
  collision** with `packages/db` fiscal or `packages/payments` (each package owns its journal —
  `migrations.manifest.json`). This is the whole point of the parallel lane.
- **`convenio_config` in `workforce-es` is a NEW migration-owning package** — the first table
  `workforce-es` owns. That is the one non-trivial wiring step (§Appendix): a new `drizzle/` folder, a
  `WORKFORCE_ES_MIGRATIONS` descriptor, a `@waitron/db` dependency, a new **`workforce-es` manifest
  entry**, and updates to the two hardcoded manifest tests. Place the entry **after `workforce`,
  before `fiscal`** so the RLS test's `last.name === "credentials"` assertion
  (`packages/provisioning/src/instance-apply.rls.test.ts:472`) stays green — `convenio_config` FKs only
  core `tenants`/`locations`, so it needs no ordering after `workforce`'s own tables.

---

## 3. The `convenio_config` surface

**Design principle (the backlog's boundary):** the overtime *projection* is convenio-**selectable**
and already exists; the overtime *rule* (thresholds, which reading binds) is an **asesor-laboral
decision, not code**. So `convenio_config` is a **configuration table an asesor's answer populates**,
and no code hard-codes a rule. Model it as: one row per (tenant, location) [or per convenio, referenced
from `employments`], every rule a **column with a documented default equal to the ET statutory floor or
to today's hard-coded default**. The engine reads the row; it never branches on "which convenio".

### 3.1 What the overtime projection needs from a convenio (replaces §1.3's hard-coded defaults)

| Field | Replaces | Default that lets D2 land now | Asesor-blocked? |
| --- | --- | --- | --- |
| `working_days_per_week` (or a per-weekday target set) | `DEFAULT_WORKING_DAYS_PER_WEEK = 5` (`projection.ts:254`) | `5` (today's value) | **No** — structural default; asesor/ schedule refines |
| `overtime_model` (`daily_accrual` / `period_net`) | `headlineModel = "daily-accrual"` (`projection.ts:292`) | `daily_accrual` (today's conservative default) | **YES** — which reading binds is the convenio/contract call |
| `reference_period_days` + `compensation_window_days` (only if `period_net`) | — (not modelled today) | null / unused while `daily_accrual` | **YES** — art. 34.2 *distribución irregular* terms |
| `daily_target_minutes` (optional explicit per-day override) | derived from weekly ÷ days | null → fall back to the derivation | **No** — optional refinement |

### 3.2 What the scheduling guardrails need (ET §2.5, encoded as validations against `convenio_config`)

These are **validations/warnings** the roster engine runs on publish; the **numeric floor is the ET
statute itself (verified, `2026-07-22…design.md:109-121`)**, so they ship with safe defaults and the
convenio only *tightens* or adds premiums:

| Field | Statutory default (safe, ships now) | Source | Asesor-blocked? |
| --- | --- | --- | --- |
| `max_weekly_minutes` | 2400 (40h/week avg, art. 34.1) | ET | No (convenio may lower) |
| `min_inter_shift_rest_minutes` | 720 (≥12h, art. 34.3) | ET | No |
| `max_ordinary_daily_minutes` | 540 (≤9h, art. 34.3) | ET | No |
| `break_threshold_minutes` / `min_break_minutes` | 360 / 15 (≥15min over 6h, art. 34.4) | ET | No |
| `weekly_rest_minutes` | 2160 (1.5 days, art. 37.1) | ET | No |
| `annual_overtime_cap_hours` | 80 (art. 35.2) | ET | No |
| `night_window_start` / `night_window_end` | 22:00 / 06:00 (art. 36) | ET | No |
| `night_premium_pct` (*plus de nocturnidad*) | **null / 0** | convenio | **YES** — provincial figure |
| `split_shift_premium` (*turno partido*) | **null / 0** | convenio | **YES** — provincial figure |
| `breaks_count_as_worked` (turno partido) | `false` (conservative) | convenio/interpretive | **YES** |

**Clean split of `convenio_config` columns:**
- **Ships with a safe default now (no asesor):** everything sourced from the ET statute (all
  guardrail limits), plus `working_days_per_week = 5` and `overtime_model = daily_accrual` — because
  those defaults reproduce today's verified behaviour.
- **Left null / zero pending the asesor:** `overtime_model` **may** need flipping to `period_net`
  (and its period/window), the two **premium** figures, `breaks_count_as_worked`, and any convenio
  limit that is *stricter than* the statutory floor. Null premiums mean "no premium computed yet",
  which is safe — it never invents a number (the `no-hardcoded-margin` discipline,
  `2026-07-22…design.md:338`).

### 3.3 Where the parameters cross the generic/Spain boundary

`convenio_config` is Spanish (`workforce-es`); the projection and guardrail **engine are generic**
(`packages/workforce`). Follow the pattern the overtime code already uses: the generic engine takes
neutral parameters (`ContractedTerms`, and a new `WorkTimeRuleset` value), and **`workforce-es`
resolves a `convenio_config` row → those neutral values and passes them in** — exactly as
`workforce-es` today calls the generic `exportTimeRecord` with the projection's output. No generic code
ever imports `convenio_config` or names a convenio.

---

## 4. Generic (`workforce`) vs Spain (`workforce-es`) split

Follows the existing, verified split (`english-only.ts:8-23`): `workforce` ∈ `GENERIC_PACKAGES`
(English-only guarded), `workforce-es` ∈ `EXEMPT_PACKAGES`.

**`packages/workforce` (generic, English, guarded) owns:**
- The regime-neutral scheduling tables: `shifts`, `roster_versions`, `absences`, `shift_templates`,
  `availability`, `shift_swaps` — they are structurally regime-neutral (a planned interval, an
  availability window), exactly as `payments` owns its own generic tables. English names dodge the
  `SPANISH_WORDS` guard.
- A generic **`WorkTimeRuleset`** value type (max weekly/daily minutes, min rest, break threshold,
  night window as neutral numbers) — the design already proposes this interface
  (`2026-07-22…design.md:303-310`); note it does **not** exist in code yet (grep: no `WorkTimeRuleset`
  outside comments).
- The generic **roster validation engine** (checks a proposed schedule against a `WorkTimeRuleset`) and
  the generic **planned-vs-actual read model** (joins `shifts` to `work_sessions` by person+date).
- Extending the overtime projection to accept the convenio-sourced `working_days_per_week` /
  `overtime_model` instead of the hard-coded defaults (§1.3, §3.1).

**`packages/workforce-es` (Spain, exempt) owns:**
- **`convenio_config`** — the only Spanish table, with its own `drizzle/` migration (first table this
  package owns; §Appendix).
- The resolver `convenio_config` row → generic `WorkTimeRuleset` + `ContractedTerms`.
- Spanish rendering of absences (`vacaciones`/`baja`/`permiso` labels over the English `absence_kind`
  enum) and any convenio-specific export framing.

This matches the design's own §6 statement — "`convenio_config`, which is Spain-specific and lives in
`packages/workforce-es`" (`2026-07-22…design.md:200-201, 216-218`) — and the `employments.ts:26-30`
note that the convenio figures live in `convenio_config` (D2, workforce-es).

---

## 5. Error codes

**Convention (CLAUDE.md §3, verified against `packages/shared/src/errors.ts`):** codes name the
**domain concept**, lowercase, dot-namespaced, never the package; `<entity>.not_found` is the dominant
shape. Codes are never renamed once shipped, so grep before adding.

**Siblings I grepped** (every registered key across `packages/*/src/errors.ts` + `apps/*/src/errors.ts`):
existing workforce codes are `person.*` (`not_found`, `pin_invalid`), `employment.not_found`,
`attendance.*` (`already_open`, `no_open_entry`, `append_contention`), `correction.*`
(`target_not_found`, `not_permitted`, `not_pending`) — all in `packages/workforce/src/errors.ts`.
Across the whole registry the `.not_found` family is `person/employment/payment/sale/series/till/
tenant.not_found`. **No `shift`, `roster`, `absence`, `swap`, `schedule`, or `convenio` prefix exists
yet** — all free for D2. Note the two taken prefixes to avoid: `clock.*` (fiscal trusted clock) and
`chain.*` (fiscal-verifactu encadenamiento) — which is precisely why D1 chose `attendance.*` for
clock-in failures (`packages/workforce/src/errors.ts:10-16`).

**Proposed D2 codes** (in `packages/workforce`, since the scheduling engine is generic):
- `shift.not_found`, `shift.overlaps` (a planned shift overlapping another for the same person)
- `roster.not_found`, `roster.already_published` (republishing a published version)
- `absence.not_found`, `absence.overlaps`
- `swap.not_found`, `swap.not_permitted`
- **Guardrail-breach codes** raised when validating/publishing a roster against the ruleset:
  `roster.rest_too_short`, `roster.exceeds_daily_max`, `roster.exceeds_weekly_max`,
  `roster.overtime_cap_exceeded` — grouped under `roster.*` because they gate the roster publish. (An
  alternative `schedule.*` domain is defensible; this is an owner naming call — §7 — decide once,
  because it is permanent.)

**In `packages/workforce-es`** (exempt, so a Spanish domain token is consistent with the
`fiscal.huella_divergente` precedent): `convenio.not_found` for a missing `convenio_config` row.
(English alternative `agreement.not_found` if the owner prefers to keep error-code domains English;
recommend `convenio.*` to match the module's vocabulary and the fiscal-verifactu precedent.)

Each throwing file must `import "./errors.js"` and augment `@waitron/shared`'s `ErrorParams` by
declaration merging (`packages/workforce/src/errors.ts:21-22`).

---

## 6. TDD implementation plan (ordered, failing-test-first)

Each slice an independently-reviewable PR; subagent-driven; `git commit -s`; coverage
**98/98/98/95** (`packages/fiscal-verifactu/vitest.config.ts` standard); run the package
**unfiltered** with `test:coverage` before believing a pass (CLAUDE.md §2, §4). Real Postgres via
`useRealPostgres`/`describeEachTarget` for RLS and any privilege assertion; PGlite for pure logic —
`TESTCONTAINERS_RYUK_DISABLED=true` locally.

**Slice D2.0 — `convenio_config` surface + overtime de-hard-coding (lands WITHOUT the asesor).**
1. *(fail)* Test: `workSummary` reads `working_days_per_week` and `overtime_model` from a
   `convenio_config` row (via the `workforce-es` resolver) rather than the hard-coded `5` /
   `"daily-accrual"`; with a default row it reproduces today's numbers exactly (a behaviour-preserving
   test — CLAUDE.md "preserve behavioural assertions").
2. Create `packages/workforce-es/drizzle` + `convenio_config` table (mutable RLS shape) + descriptor +
   manifest entry + the two manifest-test updates (§Appendix). Test the migration applies core-first
   (`runMigrationSets`).
3. Add the generic `WorkTimeRuleset` type + the `workforce-es` resolver (`convenio_config` →
   `WorkTimeRuleset` + `ContractedTerms`), defaulting every field to the ET/statutory value or today's
   default. Wire `workSummary` to it. Prove the daily/period divergence test still bites
   (`projection.test.ts` already has the 9h-then-7h case) and that flipping `overtime_model` in config
   changes only the headline, never the two underlying figures.
4. `convenio.not_found` code (workforce-es); reachability import.

**Slice D2.1 — planned working time: `shifts` + `roster_versions` + publish.**
1. *(fail)* Test: create/edit/delete a draft `shift` under `withTenant` as the app role; RLS isolates
   tenants (real Postgres — a PGlite pass here is false, superuser bypasses RLS, CLAUDE.md §4).
2. `shifts` + `roster_versions` tables + mutable RLS migration (`0001_workforce_rls.sql` shape:
   `GRANT SELECT, INSERT, UPDATE, DELETE`). `shift.not_found`, `roster.not_found`,
   `roster.already_published` codes.
3. `publishRoster(versionId)` flips draft→published, stamps `published_at`, attaches its `shifts`.
   Test republish throws `roster.already_published`.
4. **Teeth-test the mutability boundary** (the inverse of D1's immutability test): confirm a
   `shifts` row *can* be UPDATEd/DELETEd as the app role — proving these are planning data, not the
   legal record. Prove by asserting the D1 `time_entries` UPDATE still throws `WT001` in the same
   suite, so the two regimes are visibly different.

**Slice D2.2 — absences, availability, templates, swaps.**
1. *(fail)* per-table CRUD + RLS tests; `absence.overlaps`, `swap.*` codes.
2. Tables + migration. Absence-kind enum English; workforce-es renders the Spanish labels.

**Slice D2.3 — guardrail validation engine + planned-vs-actual read model.**
1. *(fail)* Test: a roster breaching `min_inter_shift_rest_minutes` (12h) is rejected on publish
   with `roster.rest_too_short`; prove by deletion the guard bites, and a negative control (an 11h59
   gap fails, a 12h01 gap passes — a test where both answers look alike proves nothing, CLAUDE.md §1).
2. Generic engine validating a proposed schedule against `WorkTimeRuleset`; **no hardcoded convenio
   numbers** (guard pattern: `packages/fiscal/src/no-hardcoded-margin.test.ts`).
3. Planned-vs-actual read model (join `shifts` to `work_sessions` by person+local-date): lateness,
   no-show, planned-vs-worked. Pure logic → PGlite/direct unit tests.

**English-only guard:** already armed — `workforce` ∈ `GENERIC_PACKAGES`, `workforce-es` ∈
`EXEMPT_PACKAGES`, and the labour tokens (`turno`, `horario`, `ausencia`, `convenio`, …) are in
`SPANISH_WORDS` (`english-only.ts:222-257`). So D2's English table names are *enforced* the moment
they land; **no `english-only.ts` edit is needed** unless a new Spanish schema token appears in
`workforce-es` (add it to `SPANISH_WORDS` then).

---

## 7. Open decisions for the owner

### (a) Genuine owner / product decisions
1. **Roster-version immutability.** Are *published* `roster_versions` an audit record that should be
   frozen (append-only snapshot on publish), or ordinary mutable planning data that a later publish
   supersedes? **Recommendation: mutable + supersede** (no legal requirement; §2.1). Decide before
   D2.1 — it changes the `roster_versions` grants.
2. **Guardrail codes domain name** — `roster.*` (recommended, they gate publish) vs a dedicated
   `schedule.*`/`worktime.*` domain. Permanent once shipped (codes never renamed); pick one at D2.0.
3. **`convenio.*` vs `agreement.*`** for the config-not-found code (recommend `convenio.*`, matching
   the module vocabulary and the fiscal-verifactu Spanish-code precedent).
4. **Are guardrail breaches errors or warnings?** The design says "validations/warnings"
   (`2026-07-22…design.md:111`). Owner call which are hard rejects on publish (throw) vs advisory
   (surface, allow override).
5. **Absence approval workflow depth** (request→approve, like corrections) vs direct manager entry.

### (b) Asesor-laboral-blocked — stub as config, do NOT guess
6. **Which overtime model binds** — daily-accrual (art. 35) vs period-net / *distribución irregular*
   (art. 34.2), and if the latter, its reference period + compensation window. Ships as
   `overtime_model = daily_accrual` (today's default); asesor flips the config field, no code change.
7. **The provincial convenio de hostelería figures** — `night_premium_pct`, `split_shift_premium`,
   `breaks_count_as_worked`, and any limit stricter than the ET floor. Ship null/statutory; asesor
   populates the row.
8. **The digital *registro horario* RD** — its Consejo-de-Ministros dates (21/28 Jul 2026) have
   passed; the plan verified 2026-08-02 it remains **unpublished** (negative Consejo de Estado opinion,
   23 Mar 2026). Its eventual fields/format are additive (pre-production drop/recreate); a fresh BOE
   check + asesor read gates final compliance sign-off, **not** the D2 build.

**The headline for the owner:** D2 lands the **entire schema + `convenio_config` surface + guardrail
engine now, without the asesor**, by making every convenio-driven rule a configuration field whose
default reproduces today's verified behaviour (daily-accrual headline, 5 working days, ET statutory
limits, null premiums). The asesor's answer later edits **rows, not code**. Items 6–8 are the only
things that must wait, and none of them block the surface.
