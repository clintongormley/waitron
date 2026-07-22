# Reconcile resolution semantics — Design

**Date:** 2026-07-22
**Status:** Draft — brainstorming complete, pending user review
**Covers:** The plan-3b follow-up previously framed as "incident idempotency" — **reframed**. Replaces
`reconcile`'s per-sweep incident-raising for the two non-converging cases (`noTrace`, drift-`Anulada`)
with real *resolution* semantics, so those conditions resolve (or self-heal) instead of re-alarming
every sweep. This is the load-bearing prerequisite the plan-3b review flagged **before any
periodic-sweep scheduler** — the scheduler itself remains out of scope
([`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md) §1).

**Prerequisite landed:** plan 3b (PR #17, squash `b179177`). `reconcile(tenantId, period)`, the three
audit cases (lostAck / noTrace / drift), the ack contract + `acks` table, the ack↔estado invariant, and
the `isDrift` convergence fix are all on `main`. See
[`2026-07-22-plan-3b-reconciliation-design.md`](2026-07-22-plan-3b-reconciliation-design.md).

---

## 1. The problem (restated precisely)

`reconcile` is a periodic audit. As landed, it raises an incident **on every sweep** for a persistently
open condition, because `recordIncident` (packages/core/src/incidents.ts) is a bare `insert` and
reconcile re-detects the same condition each sweep. Two of the three cases never converge:

- **noTrace** (we believe `aceptado`/`aceptado_con_errores`; AEAT returns no trace for the record's
  `RefExterna` in the period) — reconcile raises an **error** incident but cannot correct local state
  (AEAT has nothing to reconcile *toward*), so it re-fires every sweep.
- **drift-`Anulada`** (alta `aceptado`; AEAT holds `Anulada`) — reconcile raises an **error** incident
  and cannot correct (there is no local estado meaning "annulled"), so it re-fires every sweep.

The other two cases self-correct and converge: **lostAck** and **drift-`AceptadaConErrores`** update
local estado (+ write an ack), and #17's `isDrift` fix stops drift-`AceptadaConErrores` re-firing once
corrected (agreement is treated as clean).

Left as-is, the **first cadence run of a scheduler would flood `incidents`** with a fresh row per
open condition per sweep. That is why the plan-3b review gated a scheduler on this fix.

---

## 2. The reframe: resolve, don't re-alarm

Investigating *how each condition actually resolves* shows the fix is **not** "dedup the incidents" but
"handle the conditions correctly" — after which the flood disappears at the source, and a light
idempotency guard is enough for the rare residual.

### 2.1 drift-`Anulada` is the **expected** state of a voided sale

`recordVoid` (packages/fiscal-verifactu/src/backend.ts) creates a **separate** anulación registro — its
own `pendiente`→`aceptado` `envios` row — and leaves the original **alta**'s `envios` row at `aceptado`
(it only `insert`s the anulación row; the alta is untouched). AEAT, on receiving the anulación, marks the
**alta** as `Anulada` in its store. So reconcile querying the alta by `RefExterna` sees local `aceptado`
vs AEAT `Anulada` → drift-`Anulada` — **for every voided sale**. AEAT never annuls on its own (an
`Anulada` at AEAT is only ever produced by a `RegistroAnulacion` we submitted), so an AEAT `Anulada`
*always* has a matching local anulación. → It is not an incident; it is the expected post-void state.

### 2.2 noTrace **self-heals** via idempotent re-submission

We believe accepted, AEAT has no trace: either **consulta lag** (the record appears on a later sweep) or
a **real gap** (a lost response left us believing accepted when AEAT never stored it). A real gap resolves
by **re-submitting**, which is safe because the drainer's error-3000 path is idempotent (re-submit →
3000-duplicate → Route B huella-match → `aceptado` if AEAT actually had it; a fresh accept otherwise —
both landed + tested in plan 3a). The chain/huella are immutable and unchanged; only the `envios`
delivery-state flips.

---

## 3. Resolved decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | drift-`Anulada` | **Recognize the annulment.** If a sibling anulación registro exists (`sale_id` match, `tipo_registro = 'anulacion'`) → clean/expected, no incident, no correction. Else (no local anulación — anomalous) → error incident (idempotent). |
| 2 | noTrace | **Auto-remediate** — reset the record to `pendiente` so the drainer re-submits (idempotent via 3000). Bounded to **one** attempt via a marker; escalate to an incident only if it is *still* missing after remediation. |
| 3 | noTrace trigger | **Reset on the first detection** (re-submit is a harmless no-op under lag). |
| 4 | Incident idempotency | A shared `recordIncidentOnce` in `@waitron/core`, keyed `(tenant_id, till_id, code, sale_id)` among **unacknowledged** incidents. **No** auto-close — the residuals are rare and genuinely warrant a human, who acknowledges them. |

---

## 4. Design

### 4.1 Per-case handling (in reconcile's existing T2 `withTenant` tx)

| Case (local vs AEAT) | Handling |
| --- | --- |
| **lostAck** (pending; AEAT holds it) | *unchanged* — correct to the AEAT state + write ack (converges) |
| **drift-`AceptadaConErrores`** (aceptado; AEAT `AceptadaConErrores`) | *unchanged* — correct to `aceptado_con_errores` + ack + one warning incident (converges via `isDrift`) |
| **drift-`Anulada`** (alta aceptado; AEAT `Anulada`) | **NEW** — sibling anulación exists → **clean, no incident**; else → error incident via `recordIncidentOnce` |
| **noTrace** (accepted; AEAT no trace) | **NEW** — the remediation lifecycle (§4.2) |
| record found **clean** (present + `EstadoRegistro` consistent with local) | **NEW** — clear its `reconciled_resubmit_at` marker (resets the cycle for any future recurrence) |

The sibling-anulación check is **not** period-scoped (an anulación's expedition date may differ from
its alta's): `exists (select 1 from registros_facturacion where sale_id = <alta.sale_id> and
tipo_registro = 'anulacion')`, under `withTenant`. `recordVoid` gives the anulación the *same* `sale_id`
as the alta, so `sale_id` + `tipo_registro` is the join.

### 4.2 The noTrace remediation lifecycle

A new nullable `envios.reconciled_resubmit_at` timestamp separates "we've already tried once" from
"escalate":

1. **noTrace, `reconciled_resubmit_at IS NULL`** → reset the record: `estado = 'pendiente'`, clear
   `csv` / `confirmado_en` / `codigo_error` / `mensaje_error`, `proximo_intento_en = now` (so it is due),
   `reconciled_resubmit_at = now`; and **delete the stale `accepted` ack** (see the invariant below). The
   drainer re-submits on its next pass. **No incident** — this is usually just consulta lag, and it
   self-heals silently.
2. **noTrace, `reconciled_resubmit_at IS NOT NULL`** → we already re-submitted and it is *still* missing →
   **error incident** via `recordIncidentOnce`; do **not** reset again (bounds it to one attempt — no loop).
3. **later sweep, the record is clean at AEAT** → clear `reconciled_resubmit_at`. So a transient lag heals
   with **zero** incidents, and only a genuinely-stuck record ever alarms.

**The ack↔estado invariant.** Resetting an `aceptado` record to `pendiente` would make its committed
`accepted` ack disagree with the estado (invariant: an ack never disagrees with the committed
`envios.estado` it reflects). `ackStateOf('pendiente')` is `null` (non-terminal), so `writeAck` would not
overwrite it — the reset therefore **deletes** the `acks` row (in the same tx). When the drainer
re-accepts, it writes a fresh `accepted` ack. A test asserts the invariant holds across a reset.

### 4.3 Incident idempotency — `recordIncidentOnce`

`recordIncidentOnce(tx, input)` inserts an incident **only if** no unacknowledged incident already exists
for `(tenant_id, till_id, code, sale_id)`. Implemented as a **guarded insert** (`insert … select … where
not exists (select 1 from incidents where tenant_id = … and till_id = … and code = … and sale_id = … and
acknowledged_at is null)`) so it is race-safe by construction (reconcile sweeps for one tenant are already
serialized by the caller, but a guarded insert needs no such assumption). It lives beside `recordIncident`
in `@waitron/core` — one place owns the "same open condition" rule. reconcile's two residual paths use it;
`recordIncident` (the unconditional insert) stays for callers that intend one row per event.

`sale_id` is always present for reconcile's residual incidents (a registro's `sale_id` is `NOT NULL`), so
the key is well-defined. (A future adoption by the drainer's own ad-hoc "flag, don't duplicate" sites is
out of scope — see §6.)

### 4.4 New / changed files

| Path | Change |
| --- | --- |
| `packages/fiscal-verifactu/src/schema/envios.ts` | **+ column** `reconciled_resubmit_at` (nullable timestamptz) |
| `packages/fiscal-verifactu/drizzle/NNNN_*.sql` | generated column migration + a custom migration for the app-role column-GRANT (envios is already tenant-isolated + mutable — no new policy/trigger) |
| `packages/core/src/incidents.ts` | **+ `recordIncidentOnce`** (guarded, idempotent raise) |
| `packages/fiscal-verifactu/src/reconcile.ts` | drift-`Anulada` recognition; the noTrace lifecycle; clear-marker-on-clean; residual incidents via `recordIncidentOnce`; delete-ack-on-reset |
| `packages/fiscal-verifactu/src/reconcile.test.ts` | the scenarios in §7 |

---

## 5. Schema note

`envios.reconciled_resubmit_at` is reconcile-owned mutable state on an already-mutable, tenant-isolated
table. It needs the app role's `UPDATE` privilege (the reconcile correction path already updates `envios`
under `withTenant`, so the existing `GRANT UPDATE ON envios TO app_user` likely already covers it — the
migration adds only the column; confirm the grant covers the new column, else add a column-level GRANT).
No append-only trigger (envios is the mutable sidecar).

---

## 6. Out of scope

- **The scheduler** that drives periodic sweeps (an `apps/*` concern; the whole sub-project defers it).
- **Retrofitting the drainer's** ad-hoc "flag, don't duplicate" sites (`haltOpenChainClaims`,
  `recoverStaleClaims`) onto `recordIncidentOnce` — they already avoid duplication their own way; folding
  them in is a separate cleanup.
- **Incident auto-close / a `resolved_at` column** — the residual incidents are rare and human-worthy;
  idempotency (no re-raise while open) + human acknowledgment is sufficient. Revisit only if the residuals
  turn out to be common.
- **The other two plan-3b perf follow-ups** — the `acks` partial index and the sargable reconcile period
  filter — are separate mechanical tasks.

---

## 7. Testing

- **drift-`Anulada` with a local anulación** → clean, **no incident**, no correction (the voided-sale
  common case).
- **drift-`Anulada` without a local anulación** → one error incident (anomalous path).
- **noTrace, first detection** → record reset to `pendiente`, `reconciled_resubmit_at` set, the stale
  `accepted` ack **deleted**, and **no incident**; then a drain re-submits it (3000-duplicate → `aceptado`)
  and the next reconcile finds it clean and clears the marker.
- **noTrace, already remediated (marker set), still missing** → one error incident, and the record is
  **not** reset again.
- **The ack↔estado invariant** holds across a noTrace reset (no `accepted` ack pointing at a `pendiente`
  row at any committed point).
- **`recordIncidentOnce` idempotency** — two sweeps of the same open (anomalous drift-`Anulada` or
  persistent-noTrace) condition produce **one** incident row, not two; acknowledging it and re-detecting
  raises a fresh one.
- **Real Postgres** for the `envios` migration + the reconcile `withTenant`/RLS path (mirroring
  `reconcile.rls.test.ts`); PGlite for the unit diff/lifecycle logic. Per-test isolation (fresh tenants /
  truncation), not `drain.test.ts`'s shared-db debt.

---

## 8. Carried risks

- noTrace remediation relies on the drainer's error-3000 Route B (huella compare) resolving a re-submitted
  already-accepted record — landed + tested in plan 3a, but exercised here in a new caller shape.
- `reconciled_resubmit_at` is reconcile-owned mutable state: a reconcile bug that *false-positives*
  noTrace would reset genuinely-accepted records (a harmless re-submit via 3000, but churn). Bounded to one
  attempt per condition by the marker, and reconcile's `RefExterna` match + verified period logic (§2 of
  the plan-3b design) make a false noTrace unlikely.
- `recordIncidentOnce`'s key assumes `sale_id` discriminates the condition; true for reconcile (registro
  `sale_id` is `NOT NULL` and `code` distinguishes the case). A null-`sale_id` caller cannot dedup on this
  key — out of scope here (reconcile always supplies one).
