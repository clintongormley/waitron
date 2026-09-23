# The append-only recipe

An immutable row must still be the row that was written after anything the application does to it.
There is no SQL to copy into a migration any more: a table becomes append-only by being **declared**,
and the triggers are installed for it.

## How a table becomes append-only

Declare it with `appendOnly()` in its own module's classification list, instead of the plain
`classify()` beside it. The helper is `packages/sync-enrolment/src/classification.ts`; the list is
the module's, for example `packages/fiscal-verifactu/src/classification.ts:25`:

```ts
appendOnly("registros_facturacion", "ledger", LEDGER),
```

`appendOnlyTablesIn` collects those names onto the set's `MigrationSet.appendOnlyTables`, and
`applyMigrations` (`packages/migrations/src/apply.ts:105`) calls `installAppendOnlyTriggers`
(`packages/store/src/append-only.ts`) after each set migrates — the one place that knows the set's
tables now exist. Every migrating path in the product goes through it, so there is no install step a
new table can miss and no gap between creating a table and protecting it.

Re-running it over a database that already carries the triggers is a no-op, which is why it sits on
the boot path rather than in a one-shot install.

Guard: `scripts/append-only-triggers.test.ts`.

**Append-only is not the same as the `ledger` class**, in either direction. Several `ledger` tables
are updated by ordinary product code — the payment store and the two chain heads among them — and
`order_amendments` is classified `state` and must refuse both. `ClassifiedTable.appendOnly` carries
the receipt per table.

## What the triggers refuse, and what they cannot

`installAppendOnlyTriggers` puts a `BEFORE UPDATE` and a `BEFORE DELETE` `RAISE(ABORT)` trigger on
each declared table. Between them they cover a plain `UPDATE`, a plain `DELETE`, `INSERT OR REPLACE`
and `INSERT … ON CONFLICT DO UPDATE`; a plain `INSERT` and `ON CONFLICT DO NOTHING` are untouched,
which is what append-only means. The replace case depends on `PRAGMA recursive_triggers`, which
`packages/store/src/index.ts` turns on — the measurements for all of that are on
`installAppendOnlyTriggers`' own docstring and are not repeated here.

**They cannot refuse DDL.** SQLite has no trigger event for `DROP TABLE` and no `TRUNCATE` statement
at all, and it has no roles: one process opens one file, so every caller is the owner-equivalent.
The PostgreSQL shape this replaces protected a table twice over, and only the trigger has an
equivalent here. What that costs, measured one statement at a time, is recorded at the top of
`packages/db/src/immutability.test.ts`.

## Two things that did not change with the engine

**Keep mutable delivery state in a separate table.** Correcting a delivery attempt must not require
editing the immutable fact it describes.

**A mutable counter is not declared append-only.** `invoice_series` is classified `state`
(`packages/db/src/classification.ts:46`), because `allocateInvoiceNumber` has to UPDATE
`next_number` in place — the operation the table exists to support.
