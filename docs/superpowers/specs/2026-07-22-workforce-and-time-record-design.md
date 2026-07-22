# Workforce & time-record — design

**Date:** 2026-07-22
**Status:** Draft — brainstorming complete, pending user approval
**Sub-project:** 16 (Workforce) in the architecture design §2 phasing table. Introduces a launch
slice of sub-project 5 (Identity) as its foundation — see §3 D0.

---

## 1. Scope and framing

The deli **employs staff from opening day** (~Oct 2026 – Jan 2027, Verifactu obligation from
1 Jan 2027). That makes the *registro de jornada* — the mandatory daily working-time record — a
**launch-day legal obligation**, not a Restaurant-phase nicety. This spec covers the whole
workforce area but draws the launch line deliberately:

- **D0 — Identity core** (launch slice of sub-project 5): the `person` entity + PIN auth + a
  minimal role, shared by till login and clock-in.
- **D1 — Time & attendance** (the legal floor): the immutable *registro de jornada*.
- **D2 — Scheduling** (full: rota + swaps + templates + convenio guardrails): built **on top of**
  D1, never in front of it.
- **D3 — Payroll export** (deferred, framed): hours/overtime/absences → the gestoría. Integrate,
  don't build.

**Advisor split.** Labour, payroll and Seguridad Social compliance is the domain of an **asesor
laboral / graduado social**, distinct from the fiscal-SIF *asesor fiscal*. Labour questions do NOT
belong in `docs/compliance/asesor-questions.md` (that doc is Verifactu-scoped). §11 lists the items
for the asesor laboral.

**Sequencing discipline.** Even though full scheduling is in launch scope, we build so the legal
floor (D0 + D1) **stands alone and ships first**. The Jan-2027 obligation must not be gated behind
the rostering engine.

**Pluggable by jurisdiction.** The module is a regime-neutral core plus a jurisdiction-specific
module bound per location — mirroring `packages/fiscal` + `packages/fiscal-verifactu`, so divisions
in other countries, under different labour law, bind their own module. This is a requirement, not a
future maybe; see §6.

---

## 2. Legal foundation

Sourced from the workforce-compliance research (2026-07-22), primary sources below. Verbatim quotes
for the load-bearing rules; a VERIFIED / UNVERIFIED split closes the section. **None of this is
legal advice — the load-bearing items are confirmed with the asesor laboral before go-live.**

### 2.1 Registro de jornada — Estatuto de los Trabajadores art. 34.9

Introduced by RD-ley 8/2019 (in force 12 May 2019). Consolidated ET: BOE-A-2015-11430.

> **9.** La empresa garantizará el registro diario de jornada, que deberá incluir el horario
> concreto de inicio y finalización de la jornada de trabajo de cada persona trabajadora […] La
> empresa conservará los registros […] durante **cuatro años** y permanecerán a disposición de las
> personas trabajadoras, de sus representantes legales y de la Inspección de Trabajo y Seguridad
> Social.

Fixed points (VERIFIED): applies to **all workers, all company sizes** (no SME exemption); content
= **start/end clock time per worker per day**; **4-year retention**; access by **the worker, their
legal representatives, and the Inspección de Trabajo y Seguridad Social (ITSS)**. The *method* is
set by collective/company agreement or, failing that, employer decision after consulting worker
representatives.

**Breaks/pauses:** the statute mandates only inicio/fin. Recording pauses is advisable (an
unrecorded interval is presumptively effective working time) — especially for hospitality split
shifts (*turnos partidos*). Interpretive, not a statutory rule.

### 2.2 Overtime — ET art. 35.5

> A efectos del cómputo de horas extraordinarias, la jornada de cada trabajador se registrará día a
> día y se totalizará en el periodo fijado para el abono de las retribuciones, entregando copia del
> resumen al trabajador en el recibo correspondiente.

Overtime is computed **day by day**, **totalised per pay period**, and a **resumen handed to the
worker with the payslip**. This is why each employment needs a **contracted-hours baseline** —
overtime = actual − ordinary jornada.

### 2.3 The imminent digital-registro Real Decreto — design target

As of **2026-07-22** the binding regime is still the 2019 one above (format-free, paper allowed,
4-year retention, three access-holders). But a standalone **Real Decreto for a *registro horario
digital*** is at the point of approval:

- The 37.5h *reducción de jornada* bill was **rejected in Congreso on 10 Sep 2025**; the statutory
  max remains **40h/week de promedio en cómputo anual** (ET art. 34.1).
- The digital-registry RD **decoupled** and advanced via the RD route (no passage through
  Congreso). Consejo de Estado issued a critical dictamen (Q1 2026), forcing a redraft. Pushed for
  Consejo de Ministros **21 July 2026** (fallback 28 July). **Not confirmed approved / not in the
  BOE as of 2026-07-22.**
- Expected requirements (per reporting — **draft, not yet law**): **digital, automatic,
  interoperable**; **remote real-time Inspección access**; **immutability** ("las empresas no
  podrán manipular los registros"); a **staggered pymes adaptation period**.

**Consequence for the design: we build to the digital / interoperable / immutable target now** —
the business opens after the likely effective date. This is a documented absence turning into a
documented rule imminently, not a stable gap. **Confirm the published text, data fields, and
adaptation dates with the asesor laboral before go-live.**

### 2.4 Clock-in method — AEPD (data protection)

AEPD *Guía sobre tratamientos de control de presencia mediante sistemas biométricos* (23 Nov 2023,
criteria reaffirmed 2025): biometrics (fingerprint/face) for presence control are **special-category,
high-risk data**; **consent is not a valid basis in the employment relationship** (power
imbalance); a **DPIA is mandatory before processing**; and **less-intrusive alternatives (PIN,
card) must be preferred** — which, existing for time-tracking, makes biometrics disproportionate in
most cases.

**Design: default to PIN or card. Biometrics are off by default and DPIA-gated at most.**

### 2.5 Working-time guardrails for scheduling (ET, VERIFIED)

Encode as validations/warnings; the numeric premiums come from the convenio (§2.7), never
hardcoded:

- **40h/week** de promedio en cómputo anual (art. 34.1). *(37.5h is not law — §2.3.)*
- **≥12h** inter-shift rest; ≤9h ordinary daily work unless the convenio redistributes respecting
  the 12h (art. 34.3).
- **≥15-min** break when the continuous daily jornada exceeds 6h (art. 34.4).
- **1.5-day** uninterrupted weekly rest, accumulable over 14 days (art. 37.1).
- **≤80h/year** overtime; overtime compensated with rest within 4 months doesn't count (art. 35.2).
- **Night work** 22:00–06:00 (art. 36): trabajador nocturno ≤8h daily average, no overtime, *plus
  de nocturnidad* per convenio.

### 2.6 Penalty — LISOS (RD-leg 5/2000) art. 7.5

Failing to keep the registro de jornada is a **grave** infraction (art. 7.5), band per art. 40.1.b:
**751 – 7.500 €** (mínimo 751–1.500, medio 1.501–3.750, máximo 3.751–7.500). Exact current cuantías
to confirm at go-live.

### 2.7 Payroll — integrate, not build (VERIFIED market reality)

A small hospitality SL **overwhelmingly outsources** payroll + Seguridad Social to a gestoría /
graduado social, who runs the nómina engine (a3nom, Sage), files the Sistema de Liquidación Directa
(**RNT/RLC** via **SILTRA / Sistema RED**), and submits IRPF **modelos 111 (quarterly) + 190
(annual)**. The nómina model is the Orden ESS/2098/2014 *recibo*; finiquito basis is ET art. 49.2.

**Design: the module is the authoritative source of hours/shifts/overtime/absences and *exports* to
the gestoría (CSV/Excel + optional a3/ContaPlus import layout). It does NOT compute cotizaciones or
file SS/AEAT.** Support finiquito data hand-off (accrued vacaciones, pagas extras) at termination.

### 2.8 VERIFIED vs UNVERIFIED

**VERIFIED (primary sources):** ET art. 34.9 text, 4-year retention, three access-holders; art.
35.5 overtime; ET 34.1/34.3/34.4/35.2/36/37.1 limits; LISOS art. 7.5 = grave (751–7.500 €); AEPD
biometrics stance; nómina/SLD/SILTRA/111/190 machinery; finiquito ET 49.2; the decoupled reform
status (37.5h rejected 10 Sep 2025; digital RD pending Consejo de Ministros 21/28 Jul 2026, not in
BOE as of 22 Jul 2026); per-package integration reality.

**UNVERIFIED — route to asesor laboral / gestoría:** the final published text, data fields,
immutability spec, Inspección-access mechanism and pymes calendar of the digital RD; exact current
LISOS cuantías; the specific provincial **convenio de hostelería** and its figures; SS
rates/tramos/bonificaciones; the **gestoría's package and preferred import layout** (the single fact
that fixes the export format — get it before building D3).

**Primary sources:** BOE-A-2015-11430 (ET consolidado); BOE-A-2019-3481 (RD-ley 8/2019);
BOE-A-2014-11637 (Orden ESS/2098/2014); RD-leg 5/2000 (LISOS); AEPD guía biométricos (aepd.es);
CJEU C-55/18 (registro fiable/objetivo/accesible); Seg-Social SLD manuals; AEAT modelos 111/190.

---

## 3. Deliverables

### D0 — Identity core (launch slice of sub-project 5)

The subject of both till login and clock-in, for largely the same people:

- **`persons`** — `tenant_id`, name, **hashed PIN**, status. *(Full invitations/SSO deferred to the
  fuller #5.)*
- **`roles`** — minimal: `staff` / `supervisor` / `manager` / `admin`, gating actions needing
  authority (voids, refunds, **time corrections**). Full permission matrix deferred to #5.

This reshuffles the roadmap: part of #5 lands **with** #16. The fuller Identity (#5) later absorbs
D0 and extends it (invitations, full RBAC) on the same `person` entity — not a rewrite.

### D1 — Time & attendance (the legal floor)

- **`employments`** — the labour relationship (separate from `person`; a contract can end and
  another begin, and finiquito needs the boundary): **contracted hours** (jornada ordinaria +
  distribution), contract type, start/end dates, convenio reference, pay rate.
- **`time_entries`** — the single append-only, hash-chained, role-revoked stream (§5).
- **work-session projection** — derived per person per day; the *registro de jornada* is its Spanish
  framing, exported by the Spain module (§5).
- **access/export surface** — worker / representantes / Inspección; 4-year retention.

### D2 — Scheduling (full: A + B + C)

- **`shifts`** (planned), **`roster_versions`** (published snapshots), **`absences`** (vacaciones /
  baja / permisos), **`shift_swaps`**, **`shift_templates`**, **`availability`**, **`convenio_config`**
  (§4). ET guardrails (§2.5) enforced as validations against `convenio_config`.

### D3 — Payroll export (deferred — trigger: gestoría package known)

Export hours/overtime/absences per worker per pay period (CSV/Excel + optional a3/ContaPlus layout)
plus finiquito hand-off. No cotización computation, no SS/AEAT filing.

---

## 4. Data model

Every table carries `tenant_id` + RLS (`withTenant` no-op standalone), consistent with the rest of
the system. **`packages/workforce` (regime-neutral core) owns every table below except
`convenio_config`, which is Spain-specific and lives in `packages/workforce-es`** (§6). Grouped by
layer:

**D0:** `persons`, `roles`.

**D1:**
- `employments` — person ↔ tenant labour relationship + contracted hours + convenio ref + dates + rate.
- `time_entries` — **one** append-only table, two entry kinds:
  - a **captured event**: `in` / `out` / `break_start` / `break_end`, trusted timestamp, capturing till;
  - a **correction**: references the entry/day it fixes, carries **actor, reason, approval status**.
  Chain columns (huella, prev huella, seq) assigned at **central ingest** (§5), not at device capture.
- `work_sessions` — derived projection (start/end, pauses, worked minutes, overtime vs contracted),
  materialised for query/export but **rebuildable from `time_entries`**. (The *registro de jornada*
  export is this projection, rendered by the Spain module.)

**D2:** `shifts`, `roster_versions`, `absences`, `shift_swaps`, `shift_templates`, `availability`,
`convenio_config` (per tenant/location: nocturnidad %, split-shift plus, max hours, rest rules,
overtime cap — **sourced from the provincial convenio, never hardcoded**).

### The planned-vs-actual seam

`shifts` (planned) and the `work_sessions` projection (actual) link by **person + date**. The comparison
(lateness, no-show, overtime, planned vs worked) is a **read model over both**. This seam is why
scheduling layers cleanly onto the time record: the actual side stands alone; the planned side is
additive.

---

## 5. Immutability and the location chain

**Immutability is of the *history*, not the *values*.** Times get corrected (people forget to clock
out); a correction is a **new, attributable append-only record**, never a silent overwrite — the
same shape as a fiscal *rectificativa* (new record referencing the original, never an `UPDATE`).

**Two stacked guarantees:**

1. **Role-revocation (floor).** `time_entries` grants the app role only `SELECT, INSERT`;
   `UPDATE`/`DELETE` are **revoked from the application role** (owner-only). The app physically
   cannot rewrite or delete a clock event — the guarantee lives below the app, exactly as
   `sales`/`registros`/`envios` are protected, and the reason the project runs Postgres/PGlite (not
   SQLite, which has no privilege system).
2. **Per-location hash chain (detection).** One chain **per location (centro de trabajo)**, computed
   on the **central server at ingest**: `huella_n = hash(huella_{n-1} ‖ entry_n)`. Any inserted,
   removed, or reordered entry breaks the chain.

**Why per-location central, not per-till.** The fiscal chain is per-till because a sale must be
completed and chained **on the device, offline, at sale time** (the customer leaves with a
QR-bearing receipt). Clock events have **no capture-time artifact** and aren't SIF records, so
nothing forces the chain onto the device — they can be chained centrally on ingest. Per-location
also matches the boundary the Inspección cares about (the workplace) and isolates locations.

**Offline capture handling:**
- Devices capture events **offline** and buffer them locally in a role-revoked table (immutable in
  the offline window). On sync the server appends them to the location chain **in ingest order** and
  assigns the huella.
- **Chain order = ingest order ≠ event-time order.** The **work-session projection sorts by each
  event's trusted timestamp**; the chain only commits to the set + order of what arrived. A till offline for
  hours appends its buffered events when it reconnects. Same separation the fiscal reconciliation
  draws between chain order and presentation order.
- **Threat model:** the chain defeats the *employer* silently rewriting the central record to hide
  overtime/underpayment — central chaining + role-revocation covers exactly that.

**Corrections** are append rows in the same stream (actor + reason + approval), so they can't dodge
the chain or the immutability. **Supervisor-gated** (D0 role), ideally with a **worker-requests →
manager-approves** flow (art. 34.9 gives the worker the right to see and contest). A correction is
itself immutable — you supersede it with another, never edit it.

**The work-session projection** is recomputed over events + corrections, latest-correction-wins, full
history retained — the shown end-time updates while every prior value stays visible to an inspector.

**Single-node collapse:** in the standalone deli (one PGlite node, or a local server + tills),
"central server" is that node — ingest is immediate, the location chain is local, no distributed
step. The distributed picture appears only in the multi-till + separate-server topology.

**Escalation (deferred — trigger: the published RD demands capture-window cryptographic
tamper-evidence):** add lightweight **per-device local chaining** so the offline buffer is itself
chained before sync. Off by default; the ingest chain is designed to fold device sub-chains in.

---

## 6. Packages, layering, and the pluggable interface

The module is **pluggable by jurisdiction**, mirroring the fiscal layer exactly: a regime-neutral
core with a country/division-specific module bound per location. A requirement, not a future maybe —
the same codebase will run divisions under different labour law. (This reverses an earlier draft's
"concrete package, no abstraction" call: YAGNI was the wrong lens, because there is a concrete second
use case and the fiscal layer already proves the pattern.)

**`packages/workforce` — regime-neutral core.** English-only, with a no-regime-vocabulary guard as
`packages/fiscal` has: no Spanish labour term (*jornada*, *convenio*, *nómina*, *registro*) appears
in an interface, field name, or doc comment.
- **`WorkforceBackend` interface** — the one seam the app depends on:
  - **Clocking:** `clockIn` / `clockOut` / `breakStart` / `breakEnd` (person, till, trusted timestamp) → append to the time-entry stream.
  - **Corrections:** `correct(entryOrDay, newValue, actor, reason)` (+ request/approve variants), supervisor-gated.
  - **Read/export:** `workSession(person, period)`, `exportTimeRecord(period)` for the access-holders.
  - **Scheduling:** roster CRUD + `publish(rosterVersion)`, swaps, templates, availability, absences.
- **Generic domain types, English-named:** `Person`, `Employment` (`contractedMinutesPerWeek`),
  `TimeEntry`, `WorkSession` (the projected workday: start/end, pauses, worked minutes, overtime),
  `Shift`, `Roster`, `Absence`, `Correction`.
- **The generic engine:** the append-only immutable chained time-entry stream + role-revocation +
  per-location chain (§5); the work-session projection; the scheduling engine; and a **rule-validation
  engine** that consumes an injected ruleset.
- **`WorkTimeRuleset` interface** — max weekly minutes, min inter-shift rest, break thresholds,
  weekly rest, overtime cap, night window + premium. The *engine* is generic; the *numbers and rules*
  come from the jurisdiction module.

**`packages/workforce-es` — the Spain module.** Implements the core for Spanish labour law; owns the
Spanish vocabulary and legal specifics, mapped onto the core's English types.
- Provides the **`WorkTimeRuleset`** with the ET numbers (§2.5) and loads the applicable **provincial
  convenio** into `convenio_config`.
- **Registro-de-jornada compliance:** 4-year retention, the three access-holders, the Inspección
  export format, the digital-RD fields (§2.3). The *registro de jornada* is `exportTimeRecord`
  rendered here.
- **Clock-in defaults:** PIN/card; biometrics off + DPIA-gated (§2.4).
- **Payroll export adapters** for Spanish packages (a3/ContaPlus/Sage) — D3.
- If the digital RD defines an interoperable export/API, that format lives here — the way
  `packages/verifactu` owns the AEAT protocol behind `fiscal-verifactu`.

**Regime selection is a per-location field**, resolved to the right module — mirroring the fiscal
"mode is a per-SIF field from the start" decision, so multi-jurisdiction is structural from day one,
not retrofitted. A Spanish location binds `workforce-es`; another country binds its own module.

**Sync shape:** clock events flow **up** (offline capture at tills → central ingest → chain);
rosters are authored **server-side and published down** (tills read the published roster, don't edit
it offline).

---

## 7. Testing posture

- **Real Postgres for RLS + role-revocation** (PGlite/superuser bypasses them); **PGlite for
  projection logic**. Per-test red phase; never a production NIF.
- **Teeth-tests (each must bite):**
  - the chain **detects an inserted / removed / reordered** entry;
  - `UPDATE`/`DELETE` on `time_entries` is **denied as the app role** (not merely as owner);
  - a **correction reprojects** the work-session while the **original stays visible** in history;
  - **overtime** = actual − contracted, totalised per pay period (art. 35.5);
  - scheduling validations read `convenio_config` — **no hardcoded** convenio numbers;
  - **biometrics off by default** (clock-in is PIN/card unless explicitly, DPIA-gated, enabled);
  - offline-captured events with out-of-order timestamps **project by timestamp**, chain by ingest.

---

## 8. Sequencing

1. **D0** — `persons` + PIN + minimal roles.
2. **D1** — `employments` (contracted hours) + `time_entries` (immutable, chained) + work-session
   projection + access/export. **Ships as the standalone legal floor.**
3. **D2** — scheduling on top of D1 (roster → publish → swaps/templates/availability → convenio
   validations).
4. **D3** — payroll export (deferred until the gestoría's package is known).

The legal floor (D0 + D1) is demonstrably complete before D2 begins, so the Jan-2027 obligation is
never gated behind rostering.

---

## 9. Decisions settled (2026-07-22 brainstorming)

| Decision | Answer |
| --- | --- |
| Spec scope | Frame all 3 subsystems; build time-record; **full scheduling in launch** (A+B+C) |
| Worker identity | **Slice of Identity #5 first** — one `person` + PIN + minimal role, shared by till login and clock-in |
| Immutability model | Immutable **history** not values; corrections = append rows referencing the original |
| Storage integrity | **Role-revocation floor + hash chain** (both, per user) |
| Chain scope | **Per location (centro de trabajo), central-server ingest** — not per-till |
| Offline | Events captured offline, buffered (locally role-revoked), chained at central ingest; project by timestamp |
| Time-entries shape | **Single unified append-only stream** (events + corrections) |
| Clock-in method | **PIN / card**; biometrics off by default (AEPD) |
| Payroll | **Integrate/export**, not an in-house engine |
| Module abstraction | **Pluggable by jurisdiction** (reverses the initial draft): regime-neutral `packages/workforce` (`WorkforceBackend` + `WorkTimeRuleset`) + `packages/workforce-es` Spain module, bound per location. Mirrors `fiscal` / `fiscal-verifactu` |
| Vocabulary | Generic core is **English-only** (no-regime-vocabulary guard); Spanish terms (*jornada*, *convenio*, *registro*, *nómina*) live in the Spain module |

---

## 10. Carried risks / open items for the asesor laboral

- **The digital-registro RD is not yet law** (§2.3). Design to its expected shape; confirm the
  published text, prescribed data fields, immutability/Inspección-access mechanism, and pymes
  adaptation calendar before go-live. This may add required fields or a specific export format.
- **Provincial convenio de hostelería** — select the applicable one and load its figures into
  `convenio_config`; never hardcode.
- **DPIA** required before any biometric clock-in is ever enabled.
- **Exact LISOS cuantías** and **SS rates/tramos** — gestoría territory, time-varying.
- **Gestoría's accounting/payroll package + import layout** — fixes the D3 export format.

---

## 11. Deferred, with triggers

| Item | Trigger |
| --- | --- |
| D3 payroll export detail | The client's gestoría package + import layout is known |
| Per-device offline chaining | The published RD demands capture-window cryptographic tamper-evidence |
| Full Identity #5 (invitations, full RBAC) | Its own sub-project; builds on D0's `person` |
| Biometric clock-in | A concrete business need **and** a passed DPIA |
| Multi-location worker records | A tenant runs >1 centro de trabajo (projection already spans chains) |
