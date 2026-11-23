import { sql, type SQL } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  captureError,
  checkFailed,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  refusalOn,
  UNIQUE_VIOLATION,
  withTransaction,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPendingEnvios } from "../../test/drain-fixtures.js";
import { TEST_MIGRATIONS } from "../../test/migrations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const at = "2026-11-23T12:00:00.000Z";
const openCase = sql`case_cause = 'fiscal.registro_rechazado',
  case_evidence = '{}', case_opened_at = ${at}`;
const resolution = (personId: string) => sql`case_resolved_at = ${at},
  case_resolved_by = ${personId}, case_resolution_action = 'corrected', case_resolution_key = 'key'`;

function update(registroId: string, values: SQL) {
  return withTransaction(suite.db, (tx) =>
    tx.execute(sql`update verifactu_submissions set ${values} where registro_id = ${registroId}`),
  );
}

it("requires the case columns to be set together with a nonblank cause", async () => {
  const {
    registroIds: [id],
  } = await seedPendingEnvios(suite.db, { count: 1 });
  for (const values of [
    sql`case_cause = 'fiscal.registro_rechazado'`,
    sql`case_cause = 'fiscal.registro_rechazado', case_evidence = '{}'`,
    sql`case_cause = '', case_evidence = '{}', case_opened_at = ${at}`,
  ]) {
    const error = await captureError(() => update(id!, values));
    expect(checkFailed(error, "verifactu_submissions_case_ck")).toBe(true);
  }
  await update(id!, openCase);
});

it("ties a resolution to a case, a person and a distinct remedy record", async () => {
  const {
    registroIds: [id, other],
  } = await seedPendingEnvios(suite.db, { count: 2 });
  const personId = await withTransaction(suite.db, (tx) => seedPerson(tx));
  const resolve = resolution(personId);
  expect(
    checkFailed(
      await captureError(() => update(id!, resolve)),
      "verifactu_submissions_resolution_ck",
    ),
  ).toBe(true);
  await update(id!, openCase);
  for (const values of [
    sql`case_resolved_at = ${at}`,
    sql`case_remedy_registro_id = ${other!}`,
    sql`${resolve}, case_remedy_registro_id = ${id!}`,
  ]) {
    expect(
      checkFailed(
        await captureError(() => update(id!, values)),
        "verifactu_submissions_resolution_ck",
      ),
    ).toBe(true);
  }
  expect(
    isRefusal(await captureError(() => update(id!, resolution("missing"))), FOREIGN_KEY_VIOLATION),
  ).toBe(true);
  await update(id!, sql`${resolve}, case_remedy_registro_id = ${other!}`);
  await update(other!, openCase);
  expect(
    refusalOn(await captureError(() => update(other!, resolve)), UNIQUE_VIOLATION, {
      table: "verifactu_submissions",
      columns: ["case_resolution_key"],
    }),
  ).toBe(true);
});
