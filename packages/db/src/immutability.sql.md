# The append-only recipe

An immutable row must survive both application writes and an owner's accidental update. Restrict
the application role's grants and attach `reject_mutation()` to both row changes and truncation.
Core defines that shared function in `drizzle/0001_db_baseline_sql.sql`.

For a new immutable table, apply the complete protection in the **same migration that creates
the table — never a later one**. A separate later migration leaves a gap in which the table can be
mutated, including if deployment stops between the two. Core's generated and custom baselines must
both finish before an application is given access.

Use this pattern for an append-only table, substituting its actual name:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON "<table>" FROM app_user;
GRANT SELECT, INSERT ON "<table>" TO app_user;

CREATE TRIGGER "<table>_immutable"
  BEFORE UPDATE OR DELETE ON "<table>"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER "<table>_no_truncate"
  BEFORE TRUNCATE ON "<table>"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

ALTER TABLE "<table>" ENABLE ALWAYS TRIGGER "<table>_immutable";
ALTER TABLE "<table>" ENABLE ALWAYS TRIGGER "<table>_no_truncate";
```

The REVOKE is not redundant with withholding a GRANT: it removes an earlier blanket grant and
states the intended boundary. A later `GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user` would
restore these mutation privileges, so provisioning must not issue it after the revocations.

The application role lacks UPDATE, DELETE and TRUNCATE privileges. The owner holds those
privileges, so the triggers provide a separate refusal with SQLSTATE `WT001`.
Truncation needs its own statement trigger because it does not fire row triggers. The measured
control is an owner TRUNCATE with only the row trigger present: it succeeds and leaves zero rows;
adding the statement trigger makes the same operation fail with `WT001`. Receipt: Task 4 fix report,
real-PG truncate probe, and `immutability.test.ts`'s owner-TRUNCATE case. `ENABLE ALWAYS`
also keeps these triggers active when a session uses replica mode.

Keep mutable delivery state in a separate table. Correcting a delivery attempt must not require
editing the immutable fact it describes. Keep the application's connection separate from the
owner's connection: an owner can alter or disable the triggers.

Each schema-owning module applies the recipe to its own tables. Core owns `reject_mutation()`;
module migrations must not install protection on another module's tables, because that introduces
migration-order dependencies. Mutable counters such as `invoice_series.next_number` do not use
this recipe: `allocateInvoiceNumber` must UPDATE the counter in place, so `reject_mutation()`
would prevent the operation the table exists to support.
