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
import { seedPendingEnvios } from "../../test/drain-fixtures.js";
import { TEST_MIGRATIONS } from "../../test/migrations.js";
import { appendHistory, historyNodeForRecord } from "../history.js";

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

function insertWithLinks(row: {
  kind: string;
  seq?: number;
  registroId: string | null;
  eventKey: string | null;
  personId?: string;
  data: Record<string, unknown> | string;
}) {
  return withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into verifactu_history
        (id, seq, kind, node_id, person_id, at, data, event_key, registro_id)
      values (${newId()}, ${row.seq ?? 1}, ${row.kind}, ${nodeId}, ${row.personId ?? null},
        ${at}, ${typeof row.data === "string" ? row.data : JSON.stringify(row.data)},
        ${row.eventKey}, ${row.registroId})`),
  );
}

const cause = "fiscal.huella_divergente";
function observed(registroId: string) {
  return {
    kind: "conflict.observed",
    registroId,
    eventKey: `conflict:${registroId}:1:${cause}`,
    data: { attempt: 1, cause, evidence: {} },
  };
}

function lookup(registroId: string) {
  return {
    kind: "conflict.lookup",
    registroId,
    eventKey: `lookup:${registroId}`,
    data: { evidence: {} },
  };
}

async function recordForConflict() {
  const fixture = await seedPendingEnvios(suite.db, { count: 1 });
  return fixture.registroIds[0]!;
}

it.each([
  ["missing action", { data: {} }, "note"],
  ["non-text action", { data: { action: 1 } }, "note"],
  ["missing record", { registroId: null }, "note"],
  ["missing person", { personId: undefined }, "note"],
  ["missing key", { eventKey: null }, "note"],
  ["unprefixed key", { eventKey: "action" }, "note"],
  ["bare prefix", { eventKey: "case.note:" }, "note"],
  ["malformed JSON", { data: "{" }, "data"],
])("refuses a case note with %s", async (_label, overrides, check) => {
  const row = {
    kind: "case.note",
    registroId: await recordForConflict(),
    personId,
    eventKey: "case.note:action",
    data: { action: "reviewed" },
    ...overrides,
  };
  expect(
    checkFailed(await captureError(() => insertWithLinks(row)), `verifactu_history_${check}_ck`),
  ).toBe(true);
});

it("keeps a case note whose action key matches later lookup evidence", async () => {
  const registroId = await recordForConflict();
  const actionKey = `lookup:${registroId}`;
  await withTransaction(suite.db, async (tx) => {
    const nodeId = await historyNodeForRecord(tx, registroId);
    await appendHistory(tx, {
      kind: "case.note",
      nodeId,
      registroId,
      personId,
      at: new Date(at),
      actionKey,
      data: { action: "reviewed" },
    });
    await appendHistory(
      tx,
      {
        kind: "conflict.lookup",
        nodeId,
        registroId,
        at: new Date(at),
        data: {
          evidence: {
            source: "consulta",
            invoice: {
              IDEmisorFactura: "89890001K",
              NumSerieFactura: "T/1",
              FechaExpedicionFactura: "19-10-2026",
            },
            reference: null,
            state: "Correcto",
            fingerprint: null,
            system: null,
          },
        },
      },
      { ifAbsent: true },
    );
  });
  expect(
    (await suite.db.execute(sql`select event_key, kind from verifactu_history order by seq`)).rows,
  ).toEqual([
    { event_key: `case.note:${actionKey}`, kind: "case.note" },
    { event_key: actionKey, kind: "conflict.lookup" },
  ]);
});

it.each([
  ["text attempt", { data: { attempt: "1", cause, evidence: {} } }],
  ["missing attempt", { data: { cause, evidence: {} } }],
  ["missing cause", { data: { attempt: 1, evidence: {} } }],
  ["missing evidence", { data: { attempt: 1, cause } }],
  ["missing record", { registroId: null }],
  ["wrong event key", { eventKey: "conflict:wrong" }],
  ["missing event key", { eventKey: null }],
])("refuses an observed conflict with %s", async (_name, overrides) => {
  const row = { ...observed(await recordForConflict()), ...overrides };
  const error = await captureError(() => insertWithLinks(row));
  expect(checkFailed(error, "verifactu_history_observed_ck")).toBe(true);
});

it.each([
  ["missing evidence", { data: {} }],
  ["missing record", { registroId: null }],
  ["wrong event key", { eventKey: "lookup:wrong" }],
  ["missing event key", { eventKey: null }],
])("refuses a lookup conflict with %s", async (_name, overrides) => {
  const row = { ...lookup(await recordForConflict()), ...overrides };
  const error = await captureError(() => insertWithLinks(row));
  expect(checkFailed(error, "verifactu_history_lookup_ck")).toBe(true);
});

it.each([
  ["observed", observed],
  ["lookup", lookup],
] as const)("enforces the parent and event key for %s", async (kind, conflict) => {
  const row = conflict(await recordForConflict());
  const missing = await captureError(() => insertWithLinks(conflict("missing")));
  expect(isRefusal(missing, FOREIGN_KEY_VIOLATION)).toBe(true);
  expect(
    checkFailed(
      await captureError(() => insertWithLinks({ ...row, personId })),
      `verifactu_history_${kind}_ck`,
    ),
  ).toBe(true);
  await insertWithLinks(row);
  const repeated = await captureError(() => insertWithLinks({ ...row, seq: 2 }));
  expect(
    refusalOn(repeated, UNIQUE_VIOLATION, { table: "verifactu_history", columns: ["event_key"] }),
  ).toBe(true);
});

it.each([
  [0, cause],
  [1, "other"],
])(
  "refuses observed attempt %s and cause %s even with their matching key",
  async (attempt, cause) => {
    const registroId = await recordForConflict();
    const error = await captureError(() =>
      insertWithLinks({
        ...observed(registroId),
        eventKey: `conflict:${registroId}:${attempt}:${cause}`,
        data: { attempt, cause, evidence: {} },
      }),
    );
    expect(checkFailed(error, "verifactu_history_observed_ck")).toBe(true);
  },
);

it("keeps observations for successive attempts", async () => {
  const registroId = await recordForConflict();
  const first = observed(registroId);
  await insertWithLinks(first);
  await insertWithLinks({
    ...first,
    seq: 2,
    eventKey: `conflict:${registroId}:2:${cause}`,
    data: { ...first.data, attempt: 2 },
  });
  expect(
    (await suite.db.execute(sql`select seq from verifactu_history order by seq`)).rows,
  ).toEqual([{ seq: 1 }, { seq: 2 }]);
});

it("keeps the conflict links off clock confirmations", async () => {
  const registroId = await recordForConflict();
  const clock = {
    kind: "clock.confirmed",
    data: validData,
    personId,
    registroId: null,
    eventKey: null,
  };
  for (const row of [
    { ...clock, registroId },
    { ...clock, eventKey: "lookup:wrong" },
  ]) {
    expect(
      checkFailed(
        await captureError(() => insertWithLinks(row)),
        "verifactu_history_confirmed_links_ck",
      ),
    ).toBe(true);
  }
  await insertWithLinks(clock);
  await insertWithLinks({ ...clock, seq: 2 });
});
