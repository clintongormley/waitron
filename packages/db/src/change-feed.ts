import type { Database, Transaction } from "./client.js";
import { sql } from "drizzle-orm";
import { quoteLiteral, type ChangeSource } from "@waitron/shared";

/**
 * A plain SQL identifier. None of the statements below can be parameterised — SQLite binds no
 * identifier, and `pragma table_info(?)` is refused at prepare — so every name is checked and
 * refused rather than escaped, which is the shape `CLAUDE.md` §3 asks for. The names themselves
 * come from the modules' own descriptors, not from a request.
 */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function plainName(kind: string, name: string): string {
  if (!PLAIN_IDENTIFIER.test(name)) {
    throw new Error(`change feed: ${name} is not a plain ${kind} name`);
  }
  return name;
}

/**
 * A fresh UUID, generated in SQL.
 *
 * `change_log.id` is a plain `text` primary key whose default is a JavaScript call
 * (`newId`, `./schema/columns.ts`), and a trigger's INSERT never goes through Drizzle, so the
 * value has to be built here. SQLite has no UUID function; `randomblob` plus the version and
 * variant nibbles is the usual spelling of a version-4 one. `random() & 3` rather than
 * `abs(random()) % 4`: `abs()` on the smallest 64-bit integer is an overflow error in SQLite, and
 * a mask cannot be.
 */
const NEW_ID_SQL =
  `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || ` +
  `substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || ` +
  `substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

/**
 * The changed row's own identity, as a JSON object. A table with no `id` column and a row whose
 * `id` is null both produce `{"type": …}` alone, but the two have to be told apart before the
 * statement is built, because `new."id"` on a table with no such column is a PREPARE error rather
 * than a null.
 */
function identitySql(row: "new" | "old", type: string, hasId: boolean): string {
  const literal = quoteLiteral(type);
  if (!hasId) return `json_object('type', ${literal})`;
  return (
    `case when ${row}."id" is null then json_object('type', ${literal}) ` +
    `else json_object('type', ${literal}, 'id', ${row}."id") end`
  );
}

/**
 * The whole `resources` array for one version of a row, built as text and parsed back with
 * `json()`.
 *
 * Concatenation rather than `json_group_array` over a subquery, because this one is a single
 * expression with no row ordering to reason about. `json()` is what makes the result land as an
 * ARRAY rather than as a string — SQLite's JSON functions carry a subtype that `json_object`
 * honours.
 */
function resourcesSql(row: "new" | "old", source: ChangeSource, hasId: boolean): string {
  const related = (source.related ?? []).map((relation) => {
    const column = plainName("column", relation.column);
    const object = `json_object('type', ${quoteLiteral(relation.type)}, 'id', ${row}."${column}")`;
    return ` || case when ${row}."${column}" is not null then ',' || ${object} else '' end`;
  });
  return `json('[' || ${identitySql(row, source.type, hasId)}${related.join("")} || ']')`;
}

/** One change row, written into the caller's own transaction. */
function recordSql(row: "new" | "old", source: ChangeSource, hasId: boolean): string {
  return (
    `insert into "change_log" ("id", "payload") values (${NEW_ID_SQL}, ` +
    `json_object('resources', ${resourcesSql(row, source, hasId)}));`
  );
}

/**
 * Events identify changed resources; business values stay in the DB.
 *
 * The triggers write their event into `change_log` inside the caller's own transaction and signal
 * nothing out of the database. Who takes those rows out again, and when a listener may hear about
 * them, is `withTransaction`'s half of this and is stated there (`./tenancy.ts`).
 *
 * `change_log` is never one of `sources`: `CORE_CHANGE_SOURCES` in `./classification.ts`.
 *
 * **Three triggers per source, with the source's arguments baked in**, because SQLite has neither
 * stored functions nor a trigger covering more than one event.
 *
 * **An update writes two rows, old then new, and an update that changes nothing writes none.** A
 * SQLite row trigger fires either way, so the silence is bought with a `when` clause comparing
 * every column with `is not`, which treats null the way `is distinct from` does. The column list is
 * read back from the database rather than from the schema, because what the trigger has to compare
 * is what the table actually has.
 *
 * **Dropped and recreated rather than created if absent**, so a source whose declared type or
 * related columns change gets the new definition on the next boot rather than keeping the old one
 * for the life of the file.
 */
export async function installChangeFeed(
  db: Database | Transaction,
  sources: readonly ChangeSource[],
): Promise<void> {
  for (const source of sources) {
    const table = plainName("table", source.table);
    const columns = db
      .execute<{ name: string }>(sql.raw(`pragma table_info("${table}")`))
      .rows.map((column) => plainName("column", column.name));
    // A source naming a table that does not exist yet would otherwise install three triggers that
    // each fail at prepare, one boot later and with nothing naming the source.
    if (columns.length === 0) throw new Error(`change feed: no table named ${table}`);
    const hasId = columns.includes("id");
    const changed = columns.map((column) => `new."${column}" is not old."${column}"`).join(" or ");
    const bodies = {
      insert: recordSql("new", source, hasId),
      update: recordSql("old", source, hasId) + recordSql("new", source, hasId),
      delete: recordSql("old", source, hasId),
    } as const;
    for (const [event, body] of Object.entries(bodies)) {
      const name = `waitron_change_${table}_${event}`;
      await db.execute(sql.raw(`drop trigger if exists "${name}"`));
      await db.execute(
        sql.raw(
          `create trigger "${name}" after ${event} on "${table}" for each row ` +
            `${event === "update" ? `when ${changed} ` : ""}begin ${body} end`,
        ),
      );
    }
  }
}

/**
 * Drops every trigger whose name begins `waitron_change_`, the prefix {@link installChangeFeed}
 * gives its triggers.
 *
 * The update trigger names each column the table had when it was installed, and SQLite refuses to
 * drop a column a trigger names, so a migration dropping such a column fails once the feed is
 * installed. Migrating runs without the feed; `installChangeFeed` in `apps/server/src/boot.ts`
 * installs it again.
 */
export function removeChangeFeed(db: Database | Transaction): void {
  const names = db
    .execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'trigger' and name glob 'waitron_change_*'`,
    )
    .rows.map((row) => plainName("trigger", row.name));
  for (const name of names) db.execute(sql.raw(`drop trigger "${name}"`));
}
