import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureError,
  checkFailed,
  triggerRaised,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendCancellation,
  appendPendingAlta,
  seedPendingEnvios,
  seedSecondChain,
} from "../test/drain-fixtures.js";
import {
  heldRecords,
  listFilingCases,
  openFilingCase,
  recordCaseEvent,
  type FilingCaseEvidence,
} from "./filing-cases.js";

import { SUBMISSION_CHANGE_REFUSAL, SUBMISSION_DELETE_REFUSAL } from "./trigger-refusals.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
beforeEach(async () => {
  await seedPerson(suite.db, { id: PERSON });
});

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

async function eventCount(): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(sql`
    select (select count(*) from verifactu_submissions where case_resolved_at is not null)
      + (select count(*) from verifactu_history where kind = 'case.note') as n
  `);
  return rows[0]!.n;
}

async function setEstado(registroId: string, estado: string): Promise<void> {
  await suite.db.execute(
    sql`update verifactu_submissions set estado = ${estado} where registro_id = ${registroId}`,
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
    const { rows } = await suite.db.execute(
      sql`select case_opened_at from verifactu_submissions where case_opened_at is not null`,
    );
    expect(rows).toEqual([{ case_opened_at: OPENED_AT.toISOString() }]);
  });
});

describe("recordCaseEvent", () => {
  it("returns the stored event for a retry with the same key and content, writing no second row", async () => {
    const { opened } = await openCaseOnFirstRecord();
    const first = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      }),
    );
    expect(first).toEqual({
      id: expect.any(String),
      registroId: opened.registroId,
      actionKey: "note-1",
      kind: "note",
      personId: PERSON,
      action: "Called the asesor",
      remedyRegistroId: null,
      recordedAt: LATER,
    });

    const retry = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: MUCH_LATER,
      }),
    );

    expect(retry).toEqual(first);
    expect(await eventCount()).toBe(1);
  });

  it("returns the stored resolution for a retry of that resolution, rather than refusing it", async () => {
    const { opened } = await openCaseOnFirstRecord();
    const input = {
      caseRegistroId: opened.registroId,
      actionKey: "resolve-1",
      kind: "resolved" as const,
      personId: PERSON,
      action: "Filed a corrective record",
    };
    const first = await inTx((tx) => recordCaseEvent(tx, { ...input, now: LATER }));
    const retry = await inTx((tx) => recordCaseEvent(tx, { ...input, now: MUCH_LATER }));
    expect(retry).toEqual(first);
    expect(await eventCount()).toBe(1);
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
        caseRegistroId: opened.registroId,
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
        caseRegistroId: opened.registroId,
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
      expect(await eventCount()).toBe(1);
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
      caseRegistroId: opened.registroId,
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

  it("refuses a note that names a corrective record: filing_case.remedy_invalid", async () => {
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

    const error = await captureError(() =>
      inTx((tx) =>
        recordCaseEvent(tx, {
          caseRegistroId: opened.registroId,
          actionKey: "note-1",
          kind: "note",
          personId: PERSON,
          action: "Called the asesor",
          remedyRegistroId: remedy,
          now: LATER,
        }),
      ),
    );

    expect(appErrorCode(error)).toBe("filing_case.remedy_invalid");
    expect(await eventCount()).toBe(0);
  });

  it("refuses a resolution naming the case's own record as its remedy: filing_case.remedy_invalid", async () => {
    const { registroId, opened } = await openCaseOnFirstRecord();

    const error = await captureError(() =>
      inTx((tx) =>
        recordCaseEvent(tx, {
          caseRegistroId: opened.registroId,
          actionKey: "resolve-1",
          kind: "resolved",
          personId: PERSON,
          action: "Filed a corrective record",
          remedyRegistroId: registroId,
          now: LATER,
        }),
      ),
    );

    expect(appErrorCode(error)).toBe("filing_case.remedy_invalid");
    expect(await eventCount()).toBe(0);
  });

  it("refuses an event for a case that does not exist: filing_case.not_found", async () => {
    const error = await captureError(() =>
      inTx((tx) =>
        recordCaseEvent(tx, {
          caseRegistroId: UNKNOWN_CASE,
          actionKey: "note-1",
          kind: "note",
          personId: PERSON,
          action: "Called the asesor",
          now: LATER,
        }),
      ),
    );
    expect(appErrorCode(error)).toBe("filing_case.not_found");
    expect(await eventCount()).toBe(0);
  });

  it("refuses a second resolution under another key: filing_case.already_resolved", async () => {
    const { opened } = await openCaseOnFirstRecord();
    await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
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
          caseRegistroId: opened.registroId,
          actionKey: "resolve-2",
          kind: "resolved",
          personId: OTHER_PERSON,
          action: "Accepted as filed",
          now: MUCH_LATER,
        }),
      ),
    );

    expect(appErrorCode(error)).toBe("filing_case.already_resolved");
    expect(await eventCount()).toBe(1);
  });

  it("still accepts a note on a resolved case", async () => {
    const { opened } = await openCaseOnFirstRecord();
    await inTx(async (tx) => {
      await recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Filed a corrective record",
        now: LATER,
      });
      await recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Told the owner",
        now: MUCH_LATER,
      });
    });
    expect(await eventCount()).toBe(2);
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
        caseRegistroId: resolvedCase.registroId,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      }),
      await recordCaseEvent(tx, {
        caseRegistroId: resolvedCase.registroId,
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

  it("lists a case's events in the order they were recorded, whatever time each caller gave", async () => {
    const { opened } = await openCaseOnFirstRecord();
    const first = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "note-first",
        kind: "note",
        personId: PERSON,
        action: "first",
        now: MUCH_LATER,
      }),
    );
    // A clock set back between the two calls stamps the later event with the earlier time.
    const second = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "note-second",
        kind: "note",
        personId: PERSON,
        action: "second",
        now: LATER,
      }),
    );

    const [listed] = await inTx((tx) => listFilingCases(tx));

    expect(listed!.events.map((event) => event.action)).toEqual(["first", "second"]);
    expect(listed!.events).toEqual([first, second]);
  });

  it("lists cases in the order they were opened, whatever time each caller gave", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [firstRecord, secondRecord] = seeded.registroIds as [string, string];
    const first = await inTx((tx) =>
      openFilingCase(tx, {
        registroId: firstRecord,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: MUCH_LATER,
      }),
    );
    // A clock set back between the two calls stamps the later case with the earlier time.
    const second = await inTx((tx) =>
      openFilingCase(tx, {
        registroId: secondRecord,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: LATER,
      }),
    );

    const listed = await inTx((tx) => listFilingCases(tx));

    expect(listed.map((filingCase) => filingCase.registroId)).toEqual([
      first.registroId,
      second.registroId,
    ]);
  });

  it("records the resolution without changing delivery state", async () => {
    const { registroId, opened } = await openCaseOnFirstRecord();
    await setEstado(registroId, "rechazado");
    const delivery = sql`select registro_id, estado, intentos, proximo_intento_en, incidencia,
      technical_incidence, csv, codigo_error, mensaje_error, enviado_en, confirmado_en,
      reconciled_resubmit_at from verifactu_submissions order by registro_id`;
    const before = await suite.db.execute(delivery);

    await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Accepted as filed",
        now: LATER,
      }),
    );

    const after = await suite.db.execute(delivery);
    expect(after.rows).toEqual(before.rows);
    const { rows } = await suite.db.execute(sql`select case_resolved_at, case_resolved_by,
      case_resolution_key, case_resolution_action, case_remedy_registro_id
      from verifactu_submissions where registro_id = ${registroId}`);
    expect(rows).toEqual([
      {
        case_resolved_at: LATER.toISOString(),
        case_resolved_by: PERSON,
        case_resolution_key: "resolve-1",
        case_resolution_action: "Accepted as filed",
        case_remedy_registro_id: null,
      },
    ]);
  });
});

describe("heldRecords", () => {
  it("lists every held record with no case of its own, beside the nearest earlier held record's case on its chain", async () => {
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
        { registroId: heldAfterFirst, caseRegistroId: firstCase.registroId },
        { registroId: heldAfterSecond, caseRegistroId: secondCase.registroId },
        { registroId: otherChain.registroId, caseRegistroId: null },
      ]),
    );
    expect(held.map((record) => record.registroId)).not.toContain(waiting);
  });

  it("names the nearest earlier HELD record's case, not a later rejected record's", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [conflict, rejected, held] = seeded.registroIds as [string, string, string];
    await setEstado(conflict, "detenido");
    await setEstado(rejected, "rechazado");
    await setEstado(held, "detenido");
    const conflictCase = await inTx(async (tx) => {
      const opened = await openFilingCase(tx, {
        registroId: conflict,
        cause: "fiscal.huella_divergente",
        evidence: EVIDENCE,
        now: OPENED_AT,
      });
      await openFilingCase(tx, {
        registroId: rejected,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: LATER,
      });
      return opened;
    });

    const listed = await inTx((tx) => heldRecords(tx));

    expect(listed).toEqual([{ registroId: held, caseRegistroId: conflictCase.registroId }]);
  });

  it("names a held cancellation's original's case, and the records held behind it the same case", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [original, unrelated] = seeded.registroIds as [string, string];
    await setEstado(original, "detenido");
    await setEstado(unrelated, "detenido");
    const originalCase = await inTx(async (tx) => {
      const opened = await openFilingCase(tx, {
        registroId: original,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      });
      await openFilingCase(tx, {
        registroId: unrelated,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: LATER,
      });
      return opened;
    });
    const cancellation = await appendCancellation(suite.db, original, 3);
    await setEstado(cancellation, "detenido");
    const behind = await appendPendingAlta(suite.db, seeded, 4);
    await setEstado(behind.registroId, "detenido");

    const held = await inTx((tx) => heldRecords(tx));

    expect(held).toEqual([
      { registroId: cancellation, caseRegistroId: originalCase.registroId },
      { registroId: behind.registroId, caseRegistroId: originalCase.registroId },
    ]);
  });

  it("names the case of the rejected record immediately before a held record that nothing earlier holds, and the records held behind it the same case", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 4 });
    const [earlierRefusal, lastRefusal, held, behind] = seeded.registroIds as [
      string,
      string,
      string,
      string,
    ];
    await setEstado(earlierRefusal, "rechazado");
    await setEstado(lastRefusal, "rechazado");
    await setEstado(held, "detenido");
    await setEstado(behind, "detenido");
    const lastRefusalCase = await inTx(async (tx) => {
      await openFilingCase(tx, {
        registroId: earlierRefusal,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      });
      return openFilingCase(tx, {
        registroId: lastRefusal,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: LATER,
      });
    });

    const listed = await inTx((tx) => heldRecords(tx));

    expect(listed).toEqual([
      { registroId: held, caseRegistroId: lastRefusalCase.registroId },
      { registroId: behind, caseRegistroId: lastRefusalCase.registroId },
    ]);
  });

  it("names no case for a held record whose immediate predecessor was accepted, though a rejected record sits before that", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [rejected, accepted, held] = seeded.registroIds as [string, string, string];
    await setEstado(rejected, "rechazado");
    await setEstado(accepted, "aceptado");
    await setEstado(held, "detenido");
    await inTx((tx) =>
      openFilingCase(tx, {
        registroId: rejected,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      }),
    );

    const listed = await inTx((tx) => heldRecords(tx));

    expect(listed).toEqual([{ registroId: held, caseRegistroId: null }]);
  });

  it("names what an earlier held record names, even when the record immediately before is a rejected one", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [heldFirst, rejected, heldLater] = seeded.registroIds as [string, string, string];
    await setEstado(heldFirst, "detenido");
    await setEstado(rejected, "rechazado");
    await setEstado(heldLater, "detenido");
    await inTx((tx) =>
      openFilingCase(tx, {
        registroId: rejected,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: OPENED_AT,
      }),
    );

    const listed = await inTx((tx) => heldRecords(tx));

    expect(listed).toEqual([
      { registroId: heldFirst, caseRegistroId: null },
      { registroId: heldLater, caseRegistroId: null },
    ]);
  });
});

describe("the cause column", () => {
  const putCause = (registroId: string, cause: string) =>
    suite.db.execute(sql`
      update verifactu_submissions set case_cause = ${cause}, case_evidence = '{}',
        case_opened_at = ${OPENED_AT.toISOString()}, case_open_seq = 1
      where registro_id = ${registroId}
    `);

  it("accepts a cause the code does not name yet, and refuses an empty one", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [first, second] = seeded.registroIds as [string, string];

    await putCause(first, "fiscal.cause_added_later");
    const error = await captureError(() => putCause(second, ""));

    expect(checkFailed(error, "verifactu_submissions_case_ck")).toBe(true);
    expect(await inTx((tx) => listFilingCases(tx))).toHaveLength(1);
  });
});

describe("case evidence is retained", () => {
  async function caseWithEvent() {
    const { opened } = await openCaseOnFirstRecord();
    const event = await inTx((tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: opened.registroId,
        actionKey: "note-1",
        kind: "note",
        personId: PERSON,
        action: "Called the asesor",
        now: LATER,
      }),
    );
    if (event.kind !== "note") throw new Error("Expected a case note");
    return { opened, event };
  }

  it("refuses an update and a delete of a case", async () => {
    const { opened } = await caseWithEvent();
    const update = await captureError(() =>
      suite.db.execute(
        sql`update verifactu_submissions set case_cause = 'x' where registro_id = ${opened.registroId}`,
      ),
    );
    expect(triggerRaised(update, SUBMISSION_CHANGE_REFUSAL)).toBe(true);
    const remove = await captureError(() =>
      suite.db.execute(
        sql`delete from verifactu_submissions where registro_id = ${opened.registroId}`,
      ),
    );
    expect(triggerRaised(remove, SUBMISSION_DELETE_REFUSAL)).toBe(true);
  });

  it("refuses an update and a delete of a case event", async () => {
    const { event } = await caseWithEvent();
    const update = await captureError(() =>
      suite.db.execute(sql`update verifactu_history set data = '{}' where id = ${event.id}`),
    );
    expect(triggerRaised(update, "verifactu_history is append-only")).toBe(true);
    const remove = await captureError(() =>
      suite.db.execute(sql`delete from verifactu_history where id = ${event.id}`),
    );
    expect(triggerRaised(remove, "verifactu_history is append-only")).toBe(true);
  });

  it("refuses a replacing insert over an existing case and an existing event", async () => {
    const { opened, event } = await caseWithEvent();
    const replaceCase = await captureError(() =>
      suite.db.execute(sql`
        insert or replace into verifactu_submissions (registro_id, proximo_intento_en,
          case_cause, case_evidence, case_opened_at, case_open_seq)
        values (${opened.registroId}, ${OPENED_AT.toISOString()}, 'fiscal.huella_divergente',
          '{}', ${OPENED_AT.toISOString()}, 1)
      `),
    );
    expect(triggerRaised(replaceCase, SUBMISSION_DELETE_REFUSAL)).toBe(true);
    const replaceEvent = await captureError(() =>
      suite.db.execute(sql`
        insert or replace into verifactu_history
          (id, seq, kind, node_id, registro_id, event_key, person_id, data, at)
        select id, seq, kind, node_id, registro_id, event_key, person_id, '{"action":"x"}', at
        from verifactu_history where id = ${event.id}
      `),
    );
    expect(triggerRaised(replaceEvent, "verifactu_history is append-only")).toBe(true);
    const { rows } = await suite.db.execute<{ action: string }>(
      sql`select json_extract(data, '$.action') as action from verifactu_history`,
    );
    expect(rows.map((row) => row.action)).toEqual(["Called the asesor"]);
    const cases = await suite.db.execute<{ cause: string }>(
      sql`select case_cause as cause from verifactu_submissions`,
    );
    expect(cases.rows.map((row) => row.cause)).toEqual(["fiscal.registro_rechazado"]);
  });

  it("allows a second note and refuses a second resolution written straight to the database", async () => {
    const { opened } = await caseWithEvent();
    const resolve = (actionKey: string) =>
      suite.db
        .execute(sql`update verifactu_submissions set case_resolved_at = ${LATER.toISOString()},
        case_resolved_by = ${PERSON}, case_resolution_action = 'x', case_resolution_key = ${actionKey}
        where registro_id = ${opened.registroId}`);
    await suite.db.execute(sql`insert into verifactu_history
        (id, seq, kind, node_id, registro_id, event_key, person_id, data, at)
      select 'second-note', seq + 1, kind, node_id, registro_id, 'case.note:note-2', person_id, data, at
      from verifactu_history where event_key = 'case.note:note-1'`);
    await resolve("resolve-1");

    const error = await captureError(() => resolve("resolve-2"));

    expect(triggerRaised(error, SUBMISSION_CHANGE_REFUSAL)).toBe(true);
  });
});
