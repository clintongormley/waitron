import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  checkFailed,
  isRefusal,
  newId,
  refusalOn,
  restrictRefused,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import { seedNode, seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../../test/migrations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const at = "2026-10-19T21:40:00.000Z";
const validData = { source: "admin", reason: "start", confirmedAt: at, stepMs: 0, proof: {} };
let nodeId: string;
let personId: string;

beforeEach(async () => {
  await withTransaction(suite.db, async (tx) => {
    nodeId = await seedNode(tx);
    personId = await seedPerson(tx);
  });
});

function insert(
  overrides: {
    seq?: number;
    kind?: string;
    node?: string;
    person?: string | null;
    data?: string;
  } = {},
) {
  return withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into verifactu_history (id, seq, kind, node_id, person_id, at, data)
      values (${newId()}, ${overrides.seq ?? 1}, ${overrides.kind ?? "clock.confirmed"},
        ${overrides.node ?? nodeId}, ${overrides.person === undefined ? personId : overrides.person},
        ${at}, ${overrides.data ?? JSON.stringify(validData)})`),
  );
}

it("keeps verified administrator and staff evidence", async () => {
  await insert();
  await insert({
    seq: 2,
    data: JSON.stringify({ ...validData, source: "staff", reason: "unusable" }),
  });
  const { rows } = await suite.db.execute(sql`
    select seq, person_id, json_extract(data, '$.source') as source,
      json_extract(data, '$.reason') as reason from verifactu_history order by seq`);
  expect(rows).toEqual([
    { seq: 1, person_id: personId, source: "admin", reason: "start" },
    { seq: 2, person_id: personId, source: "staff", reason: "unusable" },
  ]);
});

it.each([
  ["malformed JSON", { data: "{" }, "data"],
  ["an array", { data: "[]" }, "data"],
  ["an undeclared kind", { kind: "clock.unknown" }, "kind"],
  ["a missing person", { person: null }, "confirmed_person"],
  ["a blank person", { person: "" }, "confirmed_person"],
] as const)("refuses %s with the named check", async (_name, row, check) => {
  expect(checkFailed(await captureError(() => insert(row)), `verifactu_history_${check}_ck`)).toBe(
    true,
  );
});

it.each([
  ["source", "authority", "source"],
  ["reason", "behind_chain", "reason"],
  ["confirmedAt", 1, "shape"],
  ["stepMs", 1.5, "shape"],
  ["proof", [], "shape"],
] as const)("refuses a wrong or missing %s", async (field, wrong, check) => {
  const wrongData = JSON.stringify({ ...validData, [field]: wrong });
  const missingData = JSON.stringify({ ...validData, [field]: undefined });
  const checkName = `verifactu_history_confirmed_${check}_ck`;
  expect(checkFailed(await captureError(() => insert({ data: wrongData })), checkName)).toBe(true);
  expect(checkFailed(await captureError(() => insert({ data: missingData })), checkName)).toBe(
    true,
  );
});

it("refuses to reuse a sequence", async () => {
  await insert();
  const error = await captureError(() => insert());
  expect(refusalOn(error, UNIQUE_VIOLATION, { table: "verifactu_history", columns: ["seq"] })).toBe(
    true,
  );
});

it.each([{ node: "missing" }, { person: "missing" }])("rejects missing parent %j", async (row) => {
  expect(isRefusal(await captureError(() => insert(row)), FOREIGN_KEY_VIOLATION)).toBe(true);
});

it("refuses to delete the person named by history", async () => {
  await insert();
  const refused = await captureError(() =>
    withTransaction(suite.db, (tx) => tx.execute(sql`delete from persons where id = ${personId}`)),
  );
  expect(restrictRefused(refused)).toBe(true);
});

it("keeps written evidence append-only", async () => {
  await insert();
  for (const statement of [
    sql`update verifactu_history set seq = 2`,
    sql`delete from verifactu_history`,
  ]) {
    const refused = await captureError(() =>
      withTransaction(suite.db, (tx) => tx.execute(statement)),
    );
    expect(triggerRaised(refused, "verifactu_history is append-only")).toBe(true);
  }
  expect((await suite.db.execute(sql`select seq from verifactu_history`)).rows).toEqual([
    { seq: 1 },
  ]);
});
