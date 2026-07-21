# The append-only recipe

Every immutable table in this plan applies this pattern, in full, in the
**same migration that creates the table** — never in a later one. See
`0002_immutability.sql`'s header comment and `immutability.test.ts` for why:
a table protected by a later migration is unprotected for however long
passes between the two, and a deployment can be interrupted in that gap.

`reject_mutation()` itself is defined once, in `0002_immutability.sql`, and
referenced by every table below rather than redefined per table.

Four parts, and **they are not four independent choices** — each covers a
hole a different one leaves open (see the per-part comments), and Part 4
additionally _depends on_ something none of the four statements below issues:
`ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY` must already be in effect
before Part 4 runs, or `FORCE ROW LEVEL SECURITY` and `CREATE POLICY` both
succeed while doing nothing at all. See Part 4's comment for what "nothing at
all" means concretely and where `ENABLE` is expected to come from. Substitute
`<table>` for the real table name.

```sql
-- 1. The control. The REVOKE is not redundant with "never granting":
--    provisioning scripts routinely carry
--    GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user, and a blanket grant
--    issued after this migration would hand back exactly the privileges being
--    withheld. Stating the revocation makes the intent legible and undoes any
--    prior blanket grant in the same breath.
REVOKE UPDATE, DELETE, TRUNCATE ON "<table>" FROM app_user;
GRANT SELECT, INSERT ON "<table>" TO app_user;

-- 2. The row-level backstop, for the owner — who has every privilege, and
--    against whom the grants above do nothing.
CREATE TRIGGER "<table>_immutable"
  BEFORE UPDATE OR DELETE ON "<table>"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- 3. The TRUNCATE hole. TRUNCATE is not a row event: the FOR EACH ROW trigger
--    above does NOT fire on it — verified, with only the row trigger in place
--    `TRUNCATE <table>` as the owner succeeded and emptied the table while the
--    trigger sat there. RLS does not cover TRUNCATE either, so a statement-level
--    trigger is the only mechanism that catches it.
CREATE TRIGGER "<table>_no_truncate"
  BEFORE TRUNCATE ON "<table>"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- 4. Tenant isolation. REQUIRES "<table>" to already have
--    ENABLE ROW LEVEL SECURITY in effect — this step does not issue it, and
--    does not check for it either. Without ENABLE already in place, the two
--    statements below are silently inert: both run to completion with no
--    error and no warning, but FORCE and the policy do nothing, and a SELECT
--    by a non-superuser app_user returns another tenant's row exactly as if
--    this part of the recipe had never been applied. Verified live against
--    PostgreSQL 18.
--
--    In this codebase, ENABLE normally comes for free from `.enableRLS()` on
--    the table's Drizzle definition (see e.g. `packages/db/src/schema/
--    tenants.ts`): `drizzle-kit generate` emits
--    `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;` into the same
--    CREATE TABLE migration automatically, with no line in this recipe
--    needed for it. A hand-written `--custom` migration — the kind
--    `drizzle-kit generate --custom` produces, and what
--    `0002_immutability.sql` is — has no Drizzle table definition to draw
--    ENABLE from, and MUST issue it explicitly, before the two statements
--    below:
--        ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
--
--    FORCE is required on top of ENABLE: without it the table owner bypasses
--    the policy, and migrations run as owner.
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
CREATE POLICY "<table>_tenant_isolation" ON "<table>"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
```

## Which control is the real one

The privilege revocation (part 1) is the control: the application connects as
`app_user`, a non-owner role that was never granted `UPDATE`, `DELETE` or
`TRUNCATE`, so a mutation from the application is refused with `42501` before
any row is examined and before any trigger could fire.

The triggers (parts 2 and 3) are the backstop, not the primary mechanism.
Framing it the other way round is wrong, not merely a style preference: the
table owner can `ALTER TABLE ... DISABLE TRIGGER`, so a trigger alone reduces
the guarantee to "the application does not misbehave" — exactly the guarantee
the privilege model exists to replace. Migrations run as owner; the
application never does. The trigger earns its place by covering the case the
privileges do not: an operator or a future migration running as owner and
reaching for a one-line "correction".

Because these tables are immutable, submission state cannot live on them —
there is no `submitted_at` and no attempt counter on a `sales` row or a
`registro_facturacion`. That state goes in a 1:1 sidecar (`envios`, Task 12):
immutable fact, mutable delivery state.

## Who applies this, and when

`packages/db` owns the shared function and this recipe, and creates no
business table itself. Each schema task applies all four parts, verbatim, in
the same migration that creates its own table:

- `sales`, `sale_lines`, `tenders` — Task 8
- `registros_facturacion` — Task 12, in `packages/fiscal-verifactu`'s own
  migration folder, using its own copy of this recipe (core migrations must
  not reach into a module's schema, or the two packages' migration journals
  become order-dependent).
- `sale_voids` — Task 17. A void is a fact recorded once, never revised in
  place, so it takes the full recipe rather than `invoice_series`'s
  tenant-isolation-only subset — see the table's own doc comment
  (`packages/db/src/schema/sale-voids.ts`).

`invoice_series` (Task 6) is the one exception, not an omission: it applies
Part 4 only (tenant isolation), never parts 1-3. `next_number` is a live
counter the application advances in place, so the table is mutable by design
— attaching `reject_mutation()` would make `allocateInvoiceNumber`'s own
`UPDATE` fail on the table it exists to update. It is not under audit and
carries no fiscal record, so the immutability argument this recipe exists to
enforce does not apply to it in the first place.
