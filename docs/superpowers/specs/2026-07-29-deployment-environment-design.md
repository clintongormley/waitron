# The deployment environment — design

**Date:** 2026-07-29
**Status:** designed, not implemented
**Depends on:** nothing. **Depended on by:** the provisioning tool
([2026-07-29-provisioning-tool-design.md](./2026-07-29-provisioning-tool-design.md)).

## 1. The problem

Waitron talks to two external systems that each have a real mode and a rehearsal mode — AEAT
(production vs pre-production) and Stripe (live vs test keys). Nothing ties them together, nothing
records which one a given row belongs to, and in Stripe's case nothing states the intended mode at
all.

### 1.1 AEAT

A database used against pre-production and then pointed at production is **indistinguishable from one
that was always production**, and the damage cannot be undone. Four facts, each checked against the
code:

1. **Nothing records the environment.** `envios` carries `estado`, `intentos`, `csv`, `codigo_error`,
   `mensaje_error` and timestamps. Neither it nor `registros_facturacion` has an environment column.
2. **Invoice numbering carries straight across.** `invoice_series.next_number` is independent of the
   chain, so five pre-production sales leave it at 6 and the first production filing is `A/6` with
   `A/1`–`A/5` never filed. AEAT sees a series beginning at 6, and detecting exactly that is what
   Veri*Factu is for.
3. **Re-registering the till does not rescue it.** `registerSif` resets the chain head and starts a
   fresh chain with `PrimerRegistro="S"`, but deliberately leaves `secuencia` alone and never touches
   `next_number` — a clean chain with a numbering hole.
4. **One host is one environment.** `WAITRON_AEAT_ENV` is host-level, read by `aeatEnvironment(env)`
   in `config.ts` and used by `aeat-transport.ts` to pick `SOAP_ENDPOINTS[aeatEnv]`. The
   `fiscal.aeat` credential holds `pfxBase64`, `passphrase` and `certKind` only, so `certKind`
   chooses between the `SOAP_ENDPOINTS` and `SOAP_ENDPOINTS_SELLO` families — both indexed by that
   one host setting.

### 1.2 Stripe, which is worse

The `payments.stripe` credential is `secretKey`, `webhookSecret`, `successUrl`, `cancelUrl` — **no
mode field**. There is no host-level Stripe environment setting anywhere, and no mode column in the
payments schema. The mode exists only as the `sk_test_` / `sk_live_` prefix of a per-tenant secret,
and nothing validates it.

So a tenant provisioned with a test key on a production deployment takes card payments that never
settle, and `reconcile` then sweeps a test-mode Stripe account against live local rows, reporting
every one of them as missing upstream.

### 1.3 Why this is not an operator-discipline problem

Because one host is one environment (§1.1 fact 4), nobody chooses to mix. It happens when a host
meets the wrong database — a copied `DATABASE_URL`, a restored backup, a staging host aimed at
production storage — or when a credential is sealed from the wrong Stripe dashboard tab. Both are
ordinary mistakes with no feedback.

## 2. What this does NOT solve

It does not make a mixed database usable. Once pre-production records exist in a series, that series
has a hole no stamp can fill: the architecture spec states chains "cannot be merged or migrated", and
`registros_facturacion` carries `REVOKE ALL`, an append-only trigger and a TRUNCATE-blocking trigger,
so there is deliberately no supported way to delete the offending rows.

This design converts a **silent, permanent, discovered-by-AEAT** failure into a **loud, immediate,
discovered-at-boot** one. The operational rule is unchanged and documented alongside: **one database
per environment, and a pre-production database is never promoted.**

## 3. One setting

`WAITRON_ENV` — `production` | `preproduction` — **replaces** `WAITRON_AEAT_ENV`. Everything derives
from it.

There is no legitimate mixed pair. AEAT pre-production with live Stripe means taking real money
without filing it; AEAT production with test Stripe means filing invoices for money never taken. Two
independent settings would only create a way to express those.

`aeatEnvironment`'s existing safety property is preserved exactly: **unset means `preproduction`, and
`production` must be typed out.** `config.ts` calls that "the one default in the file whose mistake is
irreversible", because production numbering can never be reused. That reasoning now covers Stripe
too.

## 4. Three mechanisms

They fail at different moments and catch different mistakes.

### 4.1 A deployment stamp on the database — fails at boot

One row recording which environment this database belongs to, written when the database is
provisioned and never updated. `startServer` compares it to `WAITRON_ENV` and refuses to start on a
mismatch, so a staging host pointed at the production database dies immediately rather than running a
pass.

**Ordering, which is not free.** The stamp lives in a table a migration creates, so it cannot simply
be read "before migrating" — on a first-ever boot that table does not exist. The rule is: *if the
table exists, read and compare before running migrations; otherwise proceed.* That keeps the guard
ahead of every write on every boot after the first, and leaves only the first boot — against an empty
database, where there is nothing to corrupt — unguarded. `boot.ts` already calls `loadKeyRing` before
`applyMigrations`, so this slots in beside an existing pre-migration step.

An **absent** stamp on an already-migrated database is not an error; every database that exists today
predates this. It is treated as unstamped, and §4.2 and §4.3 still apply.

### 4.2 Credential validation at the read site — fails when a tenant's credential is used

A `payments.stripe` `secretKey` beginning `sk_test_` is refused on a `production` deployment, and
`sk_live_` is refused on `preproduction`.

This is not a new convention. `stripe-account.ts` already validates the decrypted payload at the read
site, and its doc comment states it mirrors `aeat-transport.ts`'s `certMaterialFrom` doing the same.
This is one more read-site check in a place that already performs them, and it fails one tenant
loudly rather than letting the whole deployment proceed on a wrong assumption — the behaviour
`server.credential_unusable` already establishes.

The AEAT certificate gets **no equivalent check**, because there is nothing to check: the same
certificate is valid against both AEAT environments, and `certKind` distinguishes `representante`
from `sello`, not production from pre-production.

### 4.3 A record-level column on `registros_facturacion` — fails at submission

`registros_facturacion` gains a nullable `entorno`, written at record creation from `WAITRON_ENV`.
`drain` refuses to submit a record whose `entorno` disagrees with the host's, and reports rather than
retries — a mismatch is never transient.

- `entorno` **disagrees** → refuse, raise an incident.
- `entorno` **is NULL** (written before this migration) → refuse, with a distinct code. We cannot
  know where such a record was destined, and guessing is the thing this design prevents.

Both leave the `envios` row unsent rather than failed, so nothing is lost outright — but the two cases
recover differently, and only one of them recovers via configuration. A **disagreement** is a
configuration fact: fixing `WAITRON_ENV` and restarting is what releases the row, and the very next
`drain` pass reclaims it (and its chain) with no database repair. A **NULL** `entorno` has no such
fix — no value of `WAITRON_ENV` ever makes NULL agree, so the row (and everything behind it on its
chain) stays refused, pass after pass, until an operator either re-registers the till as a SIF
(starting a fresh chain and leaving the NULL record permanently unfiled) or reaches for superuser DDL.
"The operator fixes the host's configuration" is not a remedy for this second case, and this document
does not claim it is one.

**Why this is fiscal-only, and not a general pattern.** Fiscal has an outbox: a record is created now
and submitted later, possibly by a host configured differently in between. That gap is what the
column guards. Payments have no such gap — a Stripe charge is created and settled through one API
call with one key, and `reconcile` re-reads the same credential that §4.2 now validates. Adding a
mode column to the payments tables would guard a window that does not exist.

It belongs on `registros_facturacion` rather than `envios` because it is an **immutable fact about
the record** — the environment it was generated for — and that table is already append-only by
construction. `envios` is mutable submission state and the wrong home for a fact that must never
change.

## 5. Error codes

Domain-concept prefixes, per `packages/shared/src/errors.ts`:

| Code | Where | Params |
| --- | --- | --- |
| `deployment.environment_mismatch` | `startServer`, once | `databaseEnvironment`, `hostEnvironment` |
| `deployment.already_stamped` | `stampDeployment`, at provisioning | `stamped`, `requested` |
| `fiscal.environment_mismatch` | `drain`, per record | `registroId`, `recordEnvironment`, `hostEnvironment` |
| `fiscal.environment_unknown` | `drain`, per record | `registroId`, `hostEnvironment` |
| `payment.credential_environment_mismatch` | Stripe credential read, per tenant | `tenantId`, `keyEnvironment`, `hostEnvironment` |

`deployment.*` rather than `server.*`: it is a fact about which deployment a database belongs to, not
about the process, and `apps/server/src/errors.ts` reserves `server.*` for process facts by its own
doc comment. The Stripe code carries the key's *environment*, never the key or any prefix of it.

## 6. Testing

- Boot guard: a container stamped `preproduction` and a host set to `production` → `startServer`
  rejects with `deployment.environment_mismatch`, **and no migration ran**.
- Unstamped database → the host starts.
- Drain guard: a mismatched `entorno` is not submitted, raises an incident, and the `envios` row stays
  `pendiente`. Proven by deletion — remove the check and the test fails.
- A NULL `entorno` is refused with `fiscal.environment_unknown`, distinctly from a mismatch.
- A `sk_test_` key on a production host is refused for that tenant, and the refusal names no part of
  the key. `sk_live_` on preproduction likewise.
- Chain integrity is unaffected: `entorno` must **not** enter `computeHuella`'s input, or two
  otherwise identical records would hash differently by environment.
- `WAITRON_ENV` unset still yields `preproduction`, and `production` must be spelled exactly.

## 7. Rejected alternatives

**Separate `WAITRON_AEAT_ENV` and `WAITRON_STRIPE_ENV`.** Symmetrical and the smallest change, but
two switches that must agree is the shape of mistake this design exists to remove.

**Per-tenant environments in a shared database.** A column on `tenants` letting one deployment host
both. Rejected: the host cannot honour a per-tenant AEAT endpoint without making it a per-request
lookup on the submission path, and it would make the mixed database a supported state, which §2 shows
is unrecoverable.

**Refusing to write, rather than refusing to submit.** Spec §4 is explicit that nothing may block a
sale on anything but the sale itself. A record written in the wrong environment is recoverable-ish; a
till that cannot sell is a shop that cannot trade.

**Deriving the environment from the Stripe key alone, with no deployment setting.** The key prefix is
authoritative for what Stripe will do, but it is per-tenant: with no deployment-level statement of
intent there is nothing to validate the first tenant's key *against*.
