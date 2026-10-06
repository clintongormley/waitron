import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  UNIQUE_VIOLATION,
  captureError,
  refusalOn,
  triggerRaised,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import {
  heldRecords,
  listFilingCases,
  openFilingCase,
  recordCaseEvent,
  type FilingCaseEvidence,
} from "./filing-cases.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const OPENED_AT = new Date("2026-07-21T00:00:00.000Z");
const LATER = new Date("2026-07-21T01:00:00.000Z");
const MUCH_LATER = new Date("2026-07-21T02:00:00.000Z");
const PERSON = "33333333-3333-4333-8333-333333333333";
const OTHER_PERSON = "44444444-4444-4444-8444-444444444444";
const UNKNOWN_CASE = "55555555-5555-4555-8555-555555555555";
const EVIDENCE: FilingCaseEvidence = { codigo: 1161, mensaje: "Rechazado", csv: "CSV-1" };

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function rowCount(table: string): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)}`,
  );
  return rows[0]!.n;
}

async function setEstado(registroId: string, estado: string): Promise<void> {
  await suite.db.execute(
    sql`update envios set estado = ${estado} where registro_id = ${registroId}`,
  );
}

async function openCaseOnFirstRecord() {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const registroId = seeded.registroIds[0]!;
  const opened = await inTx((tx) =>
    openFilingCase(tx, {
      registroId,
      cause: "fiscal.registro_rechazado",
      evidence: EVIDENCE,
      now: OPENED_AT,
    }),
  );
  return { seeded, registroId, opened };
}

function appErrorCode(error: unknown): string | undefined {
  return isAppError(error) ? error.code : undefined;
}

describe("openFilingCase", () => {
  it("opens one case per record, and a second open returns that case and writes nothing", async () => {
    const { registroId, opened } = await openCaseOnFirstRecord();
    expect(opened).toEqual({
      id: expect.any(String),
      registroId,
      cause: "fiscal.registro_rechazado",
      evidence: EVIDENCE,
      openedAt: OPENED_AT,
    });

    const again = await inTx((tx) =>
      openFilingCase(tx, {
        registroId,
        cause: "fiscal.huella_divergente",
        evidence: { codigo: 3000, mensaje: null, csv: null },
        now: LATER,
      }),
    );

    expect(again).toEqual(opened);
    expect(await rowCount("filing_cases")).toBe(1);
  });
});

describe("recordCaseEvent", () => {
  it("returns the stored event for a retry with the same key and content, writing no second row", async () => {
    const { opened } = await openCaseOnFirstRecord();
    const first = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      }),
    );
    expect(first).toEqual({
      id: expect.any(String),
      caseId: opened.id,
      actionKey: "note-1",
      kind: "note",
      personId: PERSON,
      action: "Called the asesor",
      remedyRegistroId: null,
      recordedAt: LATER,
    });

    const retry = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: MUCH_LATER,
      }),
    );

    expect(retry).toEqual(first);
    expect(await rowCount("filing_case_events")).toBe(1);
  });

  it("returns the stored resolution for a retry of that resolution, rather than refusing it", async () => {
    const { opened } = await openCaseOnFirstRecord();
    const input = {
      caseId: opened.id,
      actionKey: "resolve-1",
      kind: "resolved" as const,
      personId: PERSON,
      action: "Filed a corrective record",
    };
    const first = await inTx((tx) => recordCaseEvent(tx, { ...input, now: LATER }));
    const retry = await inTx((tx) => recordCaseEvent(tx, { ...input, now: MUCH_LATER }));
    expect(retry).toEqual(first);
    expect(await rowCount("filing_case_events")).toBe(1);
  });

  it("keeps the corrective record a resolution names", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [original, remedy] = seeded.registroIds as [string, string];
    const opened = await inTx((tx) =>
      openFilingCase(tx, {
        registroId: original,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      }),
    );
    const event = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Filed a corrective record",
        remedyRegistroId: remedy,
        now: LATER,
      }),
    );
    expect(event.remedyRegistroId).toBe(remedy);
  });

  it.each([
    ["action", { action: "Something else" }],
    ["kind", { kind: "resolved" as const }],
    ["person", { personId: OTHER_PERSON }],
  ])(
    "refuses the same key with a different %s: filing_case.action_mismatch",
    async (_what, change) => {
      const { opened } = await openCaseOnFirstRecord();
      const input = {
        caseId: opened.id,
        actionKey: "note-1",
        kind: "note" as "note" | "resolved",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      };
      await inTx((tx) => recordCaseEvent(tx, input));

      const error = await captureError(() =>
        inTx((tx) => recordCaseEvent(tx, { ...input, ...change })),
      );

      expect(appErrorCode(error)).toBe("filing_case.action_mismatch");
      expect(await rowCount("filing_case_events")).toBe(1);
    },
  );

  it("refuses the same key naming a different corrective record: filing_case.action_mismatch", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [original, remedy] = seeded.registroIds as [string, string];
    const opened = await inTx((tx) =>
      openFilingCase(tx, {
        registroId: original,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      }),
    );
    const input = {
      caseId: opened.id,
      actionKey: "resolve-1",
      kind: "resolved" as const,
      personId: PERSON,
      action: "Filed a corrective record",
      now: LATER,
    };
    await inTx((tx) => recordCaseEvent(tx, input));

    const error = await captureError(() =>
      inTx((tx) => recordCaseEvent(tx, { ...input, remedyRegistroId: remedy })),
    );

    expect(appErrorCode(error)).toBe("filing_case.action_mismatch");
  });

  it("refuses an event for a case that does not exist: filing_case.not_found", async () => {
    const error = await captureError(() =>
      inTx((tx) =>
        recordCaseEvent(tx, {
          caseId: UNKNOWN_CASE,
          actionKey: "note-1",
          kind: "note",
          personId: PERSON,
          action: "Called the asesor",
          now: LATER,
        }),
      ),
    );
    expect(appErrorCode(error)).toBe("filing_case.not_found");
    expect(await rowCount("filing_case_events")).toBe(0);
  });

  it("refuses a second resolution under another key: filing_case.already_resolved", async () => {
    const { opened } = await openCaseOnFirstRecord();
    await inTx((tx) =>
      recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Filed a corrective record",
        now: LATER,
      }),
    );

    const error = await captureError(() =>
      inTx((tx) =>
        recordCaseEvent(tx, {
          caseId: opened.id,
          actionKey: "resolve-2",
          kind: "resolved",
          personId: OTHER_PERSON,
          action: "Accepted as filed",
          now: MUCH_LATER,
        }),
      ),
    );

    expect(appErrorCode(error)).toBe("filing_case.already_resolved");
    expect(await rowCount("filing_case_events")).toBe(1);
  });

  it("still accepts a note on a resolved case", async () => {
    const { opened } = await openCaseOnFirstRecord();
    await inTx(async (tx) => {
      await recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Filed a corrective record",
        now: LATER,
      });
      await recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Told the owner",
        now: MUCH_LATER,
      });
    });
    expect(await rowCount("filing_case_events")).toBe(2);
  });
});

describe("listFilingCases", () => {
  it("reports each case's derived status beside its record's current submission state", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [rejected, conflicted] = seeded.registroIds as [string, string];
    await setEstado(rejected, "rechazado");
    await setEstado(conflicted, "detenido");
    const [resolvedCase, openCase] = await inTx(async (tx) => [
      await openFilingCase(tx, {
        registroId: rejected,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      }),
      await openFilingCase(tx, {
        registroId: conflicted,
        cause: "fiscal.huella_divergente",
        evidence: { codigo: 3000, mensaje: null, csv: "CSV-2" },
        now: LATER,
      }),
    ]);
    const [note, resolution] = await inTx(async (tx) => [
      await recordCaseEvent(tx, {
        caseId: resolvedCase.id,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      }),
      await recordCaseEvent(tx, {
        caseId: resolvedCase.id,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Accepted as filed",
        now: MUCH_LATER,
      }),
    ]);

    const listed = await inTx((tx) => listFilingCases(tx));

    expect(listed).toEqual([
      {
        ...resolvedCase,
        estado: "rechazado",
        status: "resolved",
        events: [note, resolution],
      },
      { ...openCase, estado: "detenido", status: "open", events: [] },
    ]);
  });

  it("changes no submission row when a case is resolved", async () => {
    const { registroId, opened } = await openCaseOnFirstRecord();
    await setEstado(registroId, "rechazado");
    const before = await suite.db.execute(sql`select * from envios order by registro_id`);

    await inTx((tx) =>
      recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Accepted as filed",
        now: LATER,
      }),
    );

    const after = await suite.db.execute(sql`select * from envios order by registro_id`);
    expect(after.rows).toEqual(before.rows);
  });
});

describe("heldRecords", () => {
  it("lists every held record with no case of its own, beside the nearest earlier case on its chain", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 5 });
    const [first, heldAfterFirst, second, heldAfterSecond, waiting] = seeded.registroIds as [
      string,
      string,
      string,
      string,
      string,
    ];
    for (const id of [first, heldAfterFirst, second, heldAfterSecond]) {
      await setEstado(id, "detenido");
    }
    // A later position than every case above, on ANOTHER chain: a lookup blind to the chain would
    // pin this record to the first chain's latest case.
    const otherChain = await seedSecondChain(suite.db, seeded, 10);
    await setEstado(otherChain.registroId, "detenido");
    const [firstCase, secondCase] = await inTx(async (tx) => [
      await openFilingCase(tx, {
        registroId: first,
        cause: "fiscal.huella_divergente",
        evidence: EVIDENCE,
        now: OPENED_AT,
      }),
      await openFilingCase(tx, {
        registroId: second,
        cause: "fiscal.duplicado_anulado",
        evidence: EVIDENCE,
        now: LATER,
      }),
    ]);

    const held = await inTx((tx) => heldRecords(tx));

    expect(held).toHaveLength(3);
    expect(held).toEqual(
      expect.arrayContaining([
        { registroId: heldAfterFirst, caseId: firstCase.id },
        { registroId: heldAfterSecond, caseId: secondCase.id },
        { registroId: otherChain.registroId, caseId: null },
      ]),
    );
    expect(held.map((record) => record.registroId)).not.toContain(waiting);
  });
});

describe("the case tables are append-only", () => {
  async function caseWithEvent() {
    const { opened } = await openCaseOnFirstRecord();
    const event = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      }),
    );
    return { opened, event };
  }

  it("refuses an update and a delete of a case", async () => {
    const { opened } = await caseWithEvent();
    const update = await captureError(() =>
      suite.db.execute(sql`update filing_cases set cause = 'x' where id = ${opened.id}`),
    );
    expect(triggerRaised(update, "filing_cases is append-only")).toBe(true);
    const remove = await captureError(() =>
      suite.db.execute(sql`delete from filing_cases where id = ${opened.id}`),
    );
    expect(triggerRaised(remove, "filing_cases is append-only")).toBe(true);
  });

  it("refuses an update and a delete of a case event", async () => {
    const { event } = await caseWithEvent();
    const update = await captureError(() =>
      suite.db.execute(sql`update filing_case_events set action = 'x' where id = ${event.id}`),
    );
    expect(triggerRaised(update, "filing_case_events is append-only")).toBe(true);
    const remove = await captureError(() =>
      suite.db.execute(sql`delete from filing_case_events where id = ${event.id}`),
    );
    expect(triggerRaised(remove, "filing_case_events is append-only")).toBe(true);
  });

  it("refuses a replacing insert over an existing case and an existing event", async () => {
    const { opened, event } = await caseWithEvent();
    const replaceCase = await captureError(() =>
      suite.db.execute(sql`
        insert or replace into filing_cases (id, registro_id, cause, evidence, opened_at)
        values (${opened.id}, ${opened.registroId}, 'fiscal.huella_divergente', '{}',
          ${OPENED_AT.toISOString()})
      `),
    );
    expect(triggerRaised(replaceCase, "filing_cases is append-only")).toBe(true);
    const replaceEvent = await captureError(() =>
      suite.db.execute(sql`
        insert or replace into filing_case_events
          (id, case_id, action_key, kind, person_id, action, remedy_registro_id, recorded_at)
        values (${event.id}, ${opened.id}, 'note-1', 'note', ${PERSON}, 'x', null,
          ${LATER.toISOString()})
      `),
    );
    expect(triggerRaised(replaceEvent, "filing_case_events is append-only")).toBe(true);
    const { rows } = await suite.db.execute<{ action: string }>(
      sql`select action from filing_case_events`,
    );
    expect(rows.map((row) => row.action)).toEqual(["Called the asesor"]);
    const cases = await suite.db.execute<{ cause: string }>(sql`select cause from filing_cases`);
    expect(cases.rows.map((row) => row.cause)).toEqual(["fiscal.registro_rechazado"]);
  });

  it("refuses a second resolution of one case written straight to the table, and not a second note", async () => {
    const { opened } = await caseWithEvent();
    const insert = (actionKey: string, kind: string) =>
      suite.db.execute(sql`
        insert into filing_case_events
          (id, case_id, action_key, kind, person_id, action, remedy_registro_id, recorded_at)
        values (${actionKey + "-id"}, ${opened.id}, ${actionKey}, ${kind}, ${PERSON}, 'x', null,
          ${LATER.toISOString()})
      `);
    // The control: a second note on the same case is accepted, so the index is partial.
    await insert("note-2", "note");
    await insert("resolve-1", "resolved");

    const error = await captureError(() => insert("resolve-2", "resolved"));

    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "filing_case_events", columns: ["case_id"] }),
    ).toBe(true);
  });
});
