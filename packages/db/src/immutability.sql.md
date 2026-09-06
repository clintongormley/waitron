# The append-only recipe

An immutable row must survive both application writes and an owner's accidental update. Restrict
the application role's grants and attach `reject_mutation()` to both row changes and truncation.
Core defines that shared function in `drizzle/0001_db_baseline_sql.sql`.

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

The application role lacks UPDATE, DELETE and TRUNCATE privileges. The owner holds those
privileges, so the triggers provide a separate refusal with SQLSTATE `WT001`.
Truncation needs its own statement trigger because it does not fire row triggers. `ENABLE ALWAYS`
also keeps these triggers active when a session uses replica mode.

Keep mutable delivery state in a separate table. Correcting a delivery attempt must not require
editing the immutable fact it describes. Keep the application's connection separate from the
owner's connection: an owner can alter or disable the triggers.
