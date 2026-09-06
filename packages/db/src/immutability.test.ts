import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { usePgliteDb } from "./testing/lifecycle.js";
import { CORE_MIGRATIONS } from "./migrations.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.execute(sql`drop table if exists immutability_probe`);
});

/*
 * The pattern is proved against a table this task owns outright, created and
 * protected here in one statement sequence.
 *
 * Deliberately NOT `sales`. That table belongs to Task 8, which applies this
 * same pattern in the migration that creates it; testing the pattern through
 * `sales` would mean this task and that one both owning the same schema, and
 * an earlier draft of this plan did exactly that — two CREATE TABLE statements
 * for one table across two migrations. A dedicated probe also keeps this file
 * honest: it fails when the PATTERN is wrong, not when a sale column changes.
 *
 * Created per test rather than by a migration, because it is scaffolding for
 * the proof rather than part of the product schema.
 */
async function createProtectedProbe(db: Database): Promise<void> {
  await db.execute(sql`
    create table immutability_probe (
      id uuid primary key,
      tenant_id uuid not null,
      note text not null
    )
  `);
  await db.execute(sql`revoke update, delete, truncate on immutability_probe from app_user`);
  await db.execute(sql`grant select, insert on immutability_probe to app_user`);
  await db.execute(sql`
    create trigger immutability_probe_immutable
      before update or delete on immutability_probe
      for each row execute function reject_mutation()
  `);
  await db.execute(sql`
    create trigger immutability_probe_no_truncate
      before truncate on immutability_probe
      for each statement execute function reject_mutation()
  `);
}

describe("immutability", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const rowId = "22222222-2222-4222-8222-222222222222";
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await createProtectedProbe(db);
    await db.execute(
      sql`insert into immutability_probe (id, tenant_id, note)
          values (${rowId}, ${tenantId}, 'original')`,
    );
  });

  it("rejects an UPDATE from the table owner on trigger grounds", async () => {
    // The owner has every privilege, so the second, independent reason is the
    // only thing left. Run as owner deliberately — this is the ONE place in
    // the suite where the role must NOT be switched, because the owner is the
    // actor whose behaviour is under test.
    const error = await captureError(() =>
      db.execute(sql`update immutability_probe set note = 'tampered' where id = ${rowId}`),
    );

    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(/append-only/);
  });

  it("rejects a DELETE from the table owner on trigger grounds", async () => {
    const error = await captureError(() =>
      db.execute(sql`delete from immutability_probe where id = ${rowId}`),
    );

    expect(pgErrorCode(error)).toBe("WT001");
  });

  it("rejects a TRUNCATE from the table owner", async () => {
    // The hole this test exists for: a FOR EACH ROW trigger does not fire on
    // TRUNCATE, so without the statement-level trigger the owner empties the
    // table with no error at all.
    const error = await captureError(() => db.execute(sql`truncate table immutability_probe`));

    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(/TRUNCATE is not permitted/);

    // TRUNCATE is transactional in Postgres, so a rolled-back one leaves no
    // trace — but this one never committed anything to roll back. Read the
    // rows to prove the rejection was real rather than a message on the way
    // out.
    const result = await db.execute(sql`select id from immutability_probe`);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("names the offending table in the rejection", async () => {
    // reject_mutation() is shared by every protected table in the package, so
    // it reports TG_TABLE_NAME rather than a literal. A hardcoded name here
    // would be invisible until the second table adopted the pattern and
    // started blaming the first one for its own rejections.
    const error = await captureError(() =>
      db.execute(sql`delete from immutability_probe where id = ${rowId}`),
    );
    expect(pgErrorMessage(error)).toMatch(/immutability_probe is append-only/);
  });

  it("reports the operation that was attempted", async () => {
    // TG_OP, not a fixed string: an incident report saying "UPDATE" when
    // someone ran TRUNCATE sends the reader after the wrong actor.
    const update = await captureError(() =>
      db.execute(sql`update immutability_probe set note = 'x' where id = ${rowId}`),
    );
    expect(pgErrorMessage(update)).toMatch(/UPDATE is not permitted/);

    const truncate = await captureError(() => db.execute(sql`truncate table immutability_probe`));
    expect(pgErrorMessage(truncate)).toMatch(/TRUNCATE is not permitted/);
  });
});
