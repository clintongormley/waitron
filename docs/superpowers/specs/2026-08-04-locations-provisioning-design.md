# Locations (sub-project 6) — provision a sellable venue — Design

**Date:** 2026-08-04
**Status:** Approved in brainstorming
**Scope:** The production path that takes a tenant from "exists" to **sellable**: an idempotent operator
flow that creates a location (venue) → till → node (SIF) → registers the SIF internally → creates the
`standard` + `rectificative` series, deriving the location's **fiscal regime from its territory**. It
also reshapes the tenant/location schema so fiscal identity is country/territory-driven rather than
Spain-hardcoded, and retires the stale `bootstrap-tenant.sql`. **Veri\*Factu (common-territory Spain) is
the only regime wired**; other territories resolve to no implemented module set and are refused. Single
node per location; active-active / failover / multi-SIF stay deferred (the #33 follow-ups).

This is the till track's foundational unblocker: nothing can currently provision a node, and the
bootstrap script cannot produce a venue you could ring a sale on. Everything downstream (the counter
POS, a real reporting demo, a January venue) waits on it.

---

## 0. Why this exists, and what is already there

The backlog names sub-project 6 as venue/till/node registration and series assignment. The **tables**
exist (`tenants`, `locations`, `tills`, `nodes`, `invoice_series` in `@waitron/db`; `registro_sif`,
`contadores_instalacion` in `@waitron/fiscal-verifactu`), and SIF registration exists (`registerSif`).
What is missing:

- **No production path creates a `node`.** `seedNode` is test-only; `apps/server/src/provision-till.ts`
  registers an *already-existing* node as a SIF but does not create one. `nodes` is SELECT-only for
  `app_user` and owner-provisioned by design (`0017_nodes_rls.sql`).
- **`apps/server/sql/bootstrap-tenant.sql` is stale** — it inserts `invoice_series.till_id` (dropped by
  migration `0018`, now `node_id NOT NULL`) and creates no node, so it cannot produce a sellable venue.
- **Fiscal identity is Spain-hardcoded** — `tenants.nif` assumes a Spanish NIF, and nothing records a
  location's country or territory, though those decide the tax-ID scheme and the fiscal regime.

Two things are **already in place and inherited, not built here** (verified in the tree):

- **Environment separation.** A database is *stamped* for one environment and never re-stamped
  (`stampDeployment`/`readDeploymentEnvironment`, `deployment.already_stamped` — "A database already
  belongs to a different environment"); each fiscal record carries `entorno` and the drain refuses a
  cross-environment submission (`fiscal.environment_mismatch`); `WAITRON_ENV` selects the AEAT endpoint.
  Venue provisioning runs inside an already-stamped database and cannot cross environments — it need only
  **assert the stamp exists** before running.
- **The AEAT certificate** is per-tenant (per-obligado): `@waitron/credentials` keys by
  `(tenantId, purpose)` and holds it under purpose `fiscal.aeat` (`[pfxBase64, passphrase, certKind]`).
  One obligado, one certificate, shared by all its shops. Installing it is a separate onboarding step;
  the submit path already errors `credentials.missing` if absent. **Provisioning a location does not
  touch certificates.**

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| D1 | **Fiscal identity lives at three levels.** *Tenant* = the obligado (`country` + `tax_id`), regime-agnostic. *Location* = a shop whose **territory selects the regime**. *Node* = the SIF at that shop, chaining/numbering under that regime. One tenant can hold shops under different regimes; each node is an independent SIF. Confirmed on primary source: AEAT FAQ v1.3 §4 — distinct *centros de facturación* of one OEF "se consideran SIF independientes, como si fueran «SIF virtuales»" ([verifactu-faq-notes.md §4](../../compliance/verifactu-faq-notes.md)). |
| D2 | **`tenants.nif` → `country` (ISO-3166 alpha-2) + `tax_id` (text).** For an ES tenant `tax_id` *is* the NIF; the Veri\*Factu backend reads `tax_id` as the NIF. Can't ask for a NIF before knowing the country. No backfill (pre-production). |
| D3 | **Regime is per-location, resolved from a free-text `fiscal_territory` via a lookup to a *list of modules*** — a **filing** module (Veri\*Factu / TicketBAI / …) and a **tax** module (IVA / IGIC / IPSI / …), because these are independent: Canarias files under Veri\*Factu but with IGIC (FAQ §23), the Basque Country uses TicketBAI with IVA-foral (FAQ §21). Free text + data-driven lookup, **not** a fixed enum, so a territory's rules can change without a schema change. |
| D4 | **Only `común` → `{ filing: verifactu, tax: iva }` is populated.** Every other territory resolves to no implemented module set. **Both** guards fire: provisioning **refuses** such a territory at input, and the fiscal path **hard-errors** if one ever reaches it (defense in depth). |
| D5 | **SIF registration is internal — no AEAT call.** Confirmed on primary source: there is no *alta/censo* of the SIF with AEAT; compliance is the manufacturer's Declaración Responsable (FAQ §5). The step mints `numero_instalacion` and writes `registro_sif`. `id_sistema_informatico` is a **Waitron product constant, ≤ 2 chars** (FAQ §4). Re-registration mints a new installation number and **forks the chain** (§5 fiscal invariant), so the idempotency guard here is fiscally load-bearing. |
| D6 | **Home: extend `@waitron/provisioning`**, mirroring its `instance-plan.ts` / `instance-apply.ts` structure with a `venue` (or `location`) subcommand. A later extract to `packages/locations` is a free rename if the surface grows. |
| D7 | **Privileged operator flow, run as the provisioning admin** (not `app_user` — `tenants`/`nodes` aren't app-writable). The exact node-creation privilege is **verified against a real `postgres:18-alpine` container in the plan**, not asserted here (see §7). |
| D8 | **Idempotent via insert-and-catch-unique**, never look-up-by-NIF — RLS hides a tenant from a connection that has not yet said which tenant it is, so a lookup preceding that knowledge cannot work. |
| D9 | **Location carries `time_zone` (IANA) + `day_cutover` (`time`)** — the config `@waitron/reporting`'s `computeDailyClose` already takes as inputs (its D5). This closes that loop. |
| D10 | **Environment is inherited, not modelled here** — venue provisioning asserts the database is stamped and runs within it (see §0). Retire `bootstrap-tenant.sql`. |
| D11 | **Single node per location.** Active-active, failover, two concurrent SIFs + disjoint series, and the relocatable submitter stay deferred (the #33 SIF-topology follow-ups). No update/rename/deactivate of entities this slice. |

D1 and D3 are load-bearing. The alternative to D3 — a fixed `territory → regime` enum — bakes in that a
territory's rules never change and that "regime" is one thing rather than a composition of filing + tax;
both are false (FAQ §§21, 23).

---

## 2. The fiscal-identity model

```
tenant (obligado)         country + tax_id                         regime-agnostic
  └─ location (shop)       address → fiscal_territory → modules      regime decided here
       ├─ till(s)          where a sale rings                        physical POS
       └─ node (SIF)        registered under the location's regime    chains / numbers / signs
            └─ series       standard + rectificative                  per node
```

`fiscal_backend` is already per-sale and chains/series are already per-node (#54), so a Madrid node under
Veri\*Factu and a Bilbao node under TicketBAI, both under one tenant, need no structural change — only the
provisioning and the tenant/location schema were Spain-hardcoded.

## 3. Schema changes (one `packages/db` migration; no backfill, pre-production)

- **`tenants`**: drop `nif`; add `country text NOT NULL` (ISO-3166 alpha-2) + `tax_id text NOT NULL`. A
  uniqueness constraint on `(country, tax_id)` replaces `tenants_nif_key`. The Veri\*Factu backend reads
  `tenant.tax_id` where it currently reads `nif`; `registro_sif.nif` / `contadores_instalacion.nif` stay
  named `nif` (they are Veri\*Factu-specific and Spanish by design) and are populated from `tax_id`.
- **`locations`**: add `fiscal_territory text NOT NULL` (free text, e.g. `"ES-common"`), `time_zone text
  NOT NULL` (IANA), `day_cutover time NOT NULL`, and an **address** (at least the fields an invoice must
  show; the territory is what the resolver keys on). Keep the existing `invoice_locales` /
  `operation_description`.
- **`nodes`**: add the resolved **regime/module identifiers** (e.g. `filing_module text`, `tax_module
  text`) recorded at provision time from the location's territory, so the running SIF knows which backend
  it is without re-resolving. `fiscal_backend` on `sales` continues to carry the filing module per sale.

All new tenant-scoped columns follow the existing RLS pattern (FORCE RLS + tenant-isolation policy +
grants) via a custom migration; `nodes` stays SELECT-only for `app_user` (owner-provisioned).

## 4. The territory → modules resolver

A free-text `fiscal_territory` resolves, through a **lookup**, to a module set:

```ts
interface FiscalModules {
  filing: string;   // e.g. "verifactu" — selects the FiscalBackend; written to sales.fiscal_backend
  tax: string;      // e.g. "iva"       — the tax regime (iva / igic / ipsi)
}
function resolveFiscalModules(territory: string): FiscalModules; // throws if not implemented
```

- **Populated:** `"ES-common"` → `{ filing: "verifactu", tax: "iva" }`. Nothing else.
- **Data-driven, not hardcoded in the fiscal path** — a config registry now, designed to move to a
  **time-effective table** (territory + effective-date → modules) when a real rule change must be modelled
  without a deploy. This is the one sub-decision the owner left with me: **config-registry now, table
  later** (recommended), so a territory's rules can change (D3) without over-building a temporal store
  before any rule has changed.
- **Unimplemented territory → clean error** (`fiscal.regime_not_implemented`, a new domain error code —
  named for the *fiscal regime* concept, never the throwing package). D4's "both": provisioning refuses
  it at the `fiscal_territory` input; and any runtime fiscal path re-checks and hard-errors, so a
  mis-configured location can never mis-file under Veri\*Factu.

The `tax` module is recorded and drives the desglose `Impuesto` (01=IVA), but a full IGIC/IPSI tax module
is **not** built here (común is IVA); it is the seam other territories will fill.

## 5. The provisioning flow (`waitron-provision venue …`)

Country/territory-first, idempotent (D8), run as the provisioning admin (D7):

1. **Assert environment** — `readDeploymentEnvironment` succeeds (the DB is stamped); refuse otherwise.
2. **Tenant** — ensure `(country, tax_id)` exists; insert-and-catch-unique, reuse if present.
3. **Location** — insert with `address`, `fiscal_territory`, `invoice_locales`, `operation_description`,
   `time_zone`, `day_cutover`. `resolveFiscalModules(fiscal_territory)` — **refuse here** if unimplemented.
4. **Till(s)** — at least one under the location.
5. **Node** — create the node under the location, stamping the resolved `filing_module` / `tax_module`.
6. **SIF registration (internal, D5)** — allocate `numero_instalacion` from `contadores_instalacion`
   (keyed `(nif, id_sistema_informatico)`), write `registro_sif` with `nif = tenant.tax_id`,
   `id_sistema_informatico` = the Waitron product constant. **Exactly once** — the idempotency guard is
   fiscal here, since re-registration forks the chain.
7. **Series** — a `standard` and a `rectificative` series on the node (`recordSale` needs standard,
   `recordCorrection` needs rectificative).

Output: a venue that `recordSale` can immediately chain a sale on.

## 6. Architecture, home & privilege

- **Home (D6):** extend `@waitron/provisioning` — add `venue-plan.ts` / `venue-apply.ts` mirroring
  `instance-plan.ts` / `instance-apply.ts`, and a `venue` subcommand to `cli.ts` / `bin.ts`. It reuses the
  package's admin-connection machinery, the plan/apply idempotency shape, and the role handling.
- **Privilege (D7):** the flow runs as the **provisioning admin** (the database owner
  `@waitron/provisioning` already uses), because `tenants` (INSERT held only by `tenant_provisioner`,
  `0011`) and `nodes` (SELECT-only for every login role, `0017`) are not app-writable. **Two specifics
  are proven by container test in the plan, not asserted here** (the house rule: privilege claims need a
  receipt run against `postgres:18-alpine`):
  1. **How a node is inserted.** `nodes` is FORCE-RLS'd and SELECT-only; the plan tests whether the
     owner-admin can INSERT it under the tenant GUC (`current_tenant_id()` set first) versus adding a
     narrow INSERT grant to a provisioning role. Lean: keep nodes owner-provisioned, insert under the
     GUC — but that is a container result, not a claim.
  2. Whether the flow reuses `tenant_provisioner` or the owner-admin creates tenants directly.
- **Idempotency (D8):** insert-and-catch-unique on each step, catching the relevant unique violation
  (`tenants (country, tax_id)`, `invoice_series (tenant, node, code)`, `registro_sif`'s installation
  uniqueness), treating a conflict as already-present. Never a NIF lookup.

## 7. Testing

- **Real Postgres via Testcontainers** for the privilege/RLS behaviour (PGlite is superuser and cannot
  show the non-superuser provisioning role) — `TESTCONTAINERS_RYUK_DISABLED=true` locally. The
  node-insert-privilege question (§6) is a container test with an explicit failing-case control.
- **PGlite** for the pure logic: `resolveFiscalModules` (común resolves, everything else throws), the
  provisioning plan/apply idempotency (run twice → no duplicates, second run a no-op), the environment
  assertion (unstamped DB → refused), and the series/node wiring (`recordSale` succeeds against a
  freshly-provisioned venue).
- **Prove-by-deletion** on the "both" guards (D4): remove the input refusal → an unimplemented territory
  provisions; remove the runtime re-check → it would reach the fiscal path. Restore each.
- A `*.rls.test.ts` proving cross-tenant isolation on the new columns/tables.
- After any tenant-scoped table/column change, run `pnpm --filter @waitron/fiscal-verifactu test
  inmutabilidad` (the FORCE-RLS scan lives there, keyed on `tenant_id` columns).

## 8. Scope boundaries (YAGNI)

**Single node per location; one `venue` invocation per shop.** Explicitly deferred (the #33 follow-ups):
active-active, failover, two concurrent SIFs + disjoint series, the relocatable submitter; update /
rename / deactivate of any entity; multiple locations created in one invocation; and a full IGIC/IPSI tax
module. Cross-country establishments (a location in a different country than the tenant's registration)
are **out of scope** — assume a location is in the tenant's country.

## 9. Open questions

- **Territory→modules store shape** — config-registry now vs a time-effective table (§4). Recommended:
  registry now, table when a rule change needs modelling.
- **`fiscal_territory` vocabulary** — the identifier scheme for territories (e.g. `"ES-common"`,
  `"ES-PV-bizkaia"`). A convention to settle in the plan; it is free text, so not schema-load-bearing.
- **`CLAUDE.md` §5's "nothing blocks a sale" rewrite** stays open and is *not* touched here — this slice
  changes no sale-blocking behaviour (that lands with the server-as-SIF *behaviour*, per the backlog).
- **A cloud server that *issues* invoices** operates the SIF abroad — the §8a hosting question the #33
  design raised; unaffected by this slice (single local node per venue) but noted for the asesor.
