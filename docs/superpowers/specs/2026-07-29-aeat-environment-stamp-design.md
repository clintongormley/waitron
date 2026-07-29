# The AEAT environment stamp — design

**Date:** 2026-07-29
**Status:** designed, not implemented
**Depends on:** nothing. **Depended on by:** the provisioning tool
([2026-07-29-provisioning-tool-design.md](./2026-07-29-provisioning-tool-design.md)).

## 1. The problem

A database that has been used against AEAT pre-production and is then pointed at production is
**indistinguishable from one that was always production**, and the damage is permanent.

Four facts, each verified against the code rather than assumed:

1. **Nothing records which environment a record was filed to.** `envios` carries `estado`,
   `intentos`, `csv`, `codigo_error`, `mensaje_error` and timestamps. Neither it nor
   `registros_facturacion` has an environment column.
2. **Invoice numbering carries straight across.** `invoice_series.next_number` is independent of the
   chain. Five pre-production sales leave it at 6, so the first production filing is invoice `A/6`
   with `A/1`–`A/5` never filed. AEAT sees a series beginning at 6, and detecting exactly that kind
   of gap is what Veri*Factu exists to do.
3. **Re-registering the till does not rescue it.** `registerSif` resets the chain head and starts a
   fresh chain with `PrimerRegistro="S"`, but `registro-sif.ts` deliberately leaves `secuencia`
   alone and never touches `next_number`. The result is a clean chain with a numbering hole.
4. **One host process is one environment, for every tenant it serves.** `WAITRON_AEAT_ENV` is
   host-level: `aeatEnvironment(env)` reads it in `config.ts`, and `aeat-transport.ts` selects
   `SOAP_ENDPOINTS[aeatEnv]`. The `fiscal.aeat` credential holds `pfxBase64`, `passphrase` and
   `certKind` only — no environment — so `certKind` chooses between the `SOAP_ENDPOINTS` and
   `SOAP_ENDPOINTS_SELLO` families, both indexed by the host's single setting.

Fact 4 is why mixing is not something an operator does deliberately. It happens when a host is
pointed at the wrong database — a copied `DATABASE_URL`, a restored backup, a staging host aimed at
production storage. Today that silently files `A/6` to a tax authority.

Facts 2 and 3 are why this cannot be repaired after the event, and why the remedy is prevention
rather than cleanup. The architecture spec states that chains "cannot be merged or migrated";
`registros_facturacion` additionally carries `REVOKE ALL`, an append-only trigger and a
TRUNCATE-blocking trigger, so there is deliberately no supported way to delete the offending rows.

## 2. What this does NOT solve

It does not make a mixed database usable. Once pre-production records exist in a series, that series
has a hole no stamp can fill. The stamp converts a **silent, permanent, discovered-by-AEAT** failure
into a **loud, immediate, discovered-at-boot** one. The correct operational rule is unchanged and is
documented alongside: **one database per environment, and a pre-production database is never
promoted.**

## 3. Design

Two levels, because they fail at different moments and catch different mistakes.

### 3.1 A deployment-level stamp — fails at boot

One row recording the AEAT environment this database belongs to, written once when the database is
provisioned and never updated.

`startServer` compares it to the host's resolved `aeatEnvironment(env)` and refuses to start on a
mismatch. A staging host pointed at the production database dies immediately with a structured error
naming both values, rather than running a pass.

**Ordering, which is not free.** The stamp lives in a table a migration creates, so it cannot simply
be read "before migrating" — on a first-ever boot that table does not exist. The check is therefore:
*if the table exists, read it and compare before running migrations; if it does not, proceed.* That
keeps the guard ahead of any write on every boot after the first, and makes the first boot — against
an empty database, where there is nothing to corrupt — the only unguarded one. `boot.ts` already
calls `loadKeyRing` before `applyMigrations`, so this slots in beside an existing pre-migration step
rather than introducing the concept.

An **absent** stamp on an already-migrated database is likewise not an error — every database that
exists today predates this — and is treated as "unstamped", which the record-level guard below still
covers. `instance` in the provisioning tool writes it for every new database.

### 3.2 A record-level column — fails at submission

`registros_facturacion` gains a nullable `entorno` column, written at record creation from the host's
configured environment.

It belongs on `registros_facturacion` rather than `envios` because it is an **immutable fact about
the record** — the environment the record was generated for — and that table is already append-only
and immutable by construction. `envios` is mutable submission state (`estado`, `intentos`,
`proximo_intento_en`) and the wrong home for a fact that must never change.

`drain` refuses to submit a record whose `entorno` disagrees with the host's, and reports it rather
than retrying — a mismatch is never transient. Two distinct outcomes:

- `entorno` **disagrees** → refuse, raise an incident. This is the real defect.
- `entorno` **is NULL** (written before this migration) → refuse, with a different code. We cannot
  know where such a record was destined, and guessing is what this design exists to prevent.

Both leave the `envios` row unsent rather than marking it failed, so nothing is lost if the operator
corrects the host's configuration and restarts.

### 3.3 Migration and existing data

The column is nullable with no backfill. No production deployment exists, so the only affected rows
are in development and throwaway databases, and NULL is the honest value for them: nothing recorded
where they were destined. A throwaway database that starts refusing to drain is behaving correctly
and costs nothing to recreate.

## 4. Error codes

Domain-concept prefixes, per `packages/shared/src/errors.ts`:

| Code | Where | Params |
| --- | --- | --- |
| `fiscal.environment_mismatch` | drain, per record | `recordId`, `recordEnvironment`, `hostEnvironment` |
| `fiscal.environment_unknown` | drain, per record | `recordId`, `hostEnvironment` |
| `deployment.environment_mismatch` | `startServer`, once | `databaseEnvironment`, `hostEnvironment` |

`deployment.*` rather than `server.*`: it is a fact about which deployment this database belongs to,
not about the process. `server.*` is reserved for process facts by that file's own doc comment.

## 5. Testing

- The boot guard: a real container stamped `preproduction`, a host configured `production`, assert
  `startServer` rejects with `deployment.environment_mismatch` and that no migration ran.
- The absent stamp: same, unstamped, assert the host starts.
- The drain guard: a record with a mismatched `entorno` is not submitted, raises an incident, and the
  `envios` row stays `pendiente`. Prove by deletion — remove the check and the test fails.
- A NULL `entorno` is refused with `fiscal.environment_unknown`, distinctly from a mismatch.
- Chain-integrity tests continue to pass with the new column, confirming it is not hashed. `entorno`
  is **our** metadata, never AEAT's: it must not enter `computeHuella`'s input, or two otherwise
  identical records would hash differently by environment.

## 6. Rejected alternatives

**Per-tenant environments in a shared database.** A column on `tenants` saying which AEAT each files
to, letting one deployment host both. Rejected: `WAITRON_AEAT_ENV` is host-level, so a single process
cannot honour it, and making it per-tenant means the endpoint becomes a per-request lookup on the hot
submission path. It would also make the mixed database a supported state, which §1 shows is
unrecoverable.

**Refusing to write, rather than refusing to submit.** Blocking `recordSale` on an environment
mismatch. Rejected: spec §4 is explicit that nothing may block a sale on anything but the sale
itself. A record written in the wrong environment is recoverable-ish; a till that cannot sell is a
shop that cannot trade.

**Deriving the environment from the certificate.** The `certKind` in the vault distinguishes
`representante` from `sello`, not pre-production from production — the same certificate is valid
against both.
