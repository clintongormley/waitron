import { sql, type Query } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { captureError, triggerRaised, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createClient, type RespuestaLinea, type VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { collideAtAeat, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { readFilingOverview } from "./filing-overview.js";
import * as conflicts from "./conflict-evidence.js";
import type { ConflictEvidence } from "./conflict-evidence.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const FIRST = new Date("2026-07-21T00:01:00Z");
const SECOND = new Date("2026-07-21T00:02:00Z");
const fake = () => createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const clientFor = (aeat: ReturnType<typeof fake>) =>
  createClient({ endpoint: "https://aeat.invalid/", fetch: aeat.fetch });
const run = (client: VerifactuClient, now = FIRST) =>
  drain(
    {
      db: suite.db,
      resolveClient: staticResolver(client),
      environment: "production",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    now,
  );

const observationRows = `
  select h.id, h.registro_id, c.id as case_id, json_extract(h.data, '$.attempt') as attempt,
    json_extract(h.data, '$.cause') as cause, json_extract(h.data, '$.evidence') as evidence,
    h.at as recorded_at
  from verifactu_history h join filing_cases c on c.registro_id = h.registro_id
  where h.kind = 'conflict.observed' order by h.at, h.id`;

async function observations() {
  const { rows } = await suite.db.execute<{
    id: string;
    registro_id: string;
    case_id: string;
    attempt: number;
    cause: string;
    evidence: string;
    recorded_at: string;
  }>(sql.raw(observationRows));
  return rows.map((row) => ({ ...row, evidence: JSON.parse(row.evidence) as ConflictEvidence }));
}

const active = (nodeId: string) =>
  withTransaction(suite.db, (tx) => conflicts.readActiveConflicts(tx, nodeId));

it("looks up observed and lookup evidence through the history record index", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  await withTransaction(suite.db, async (tx) => {
    type Session = { prepareQuery(query: Query, ...rest: unknown[]): { all(): unknown } };
    const session = (tx as unknown as { session: Session }).session;
    const prepare = vi.spyOn(session, "prepareQuery");
    const query = await conflicts
      .readActiveConflicts(tx, seeded.nodeId)
      .then(() =>
        prepare.mock.calls.map(([query]) => query).find(({ sql }) => sql.includes("filing_cases")),
      )
      .finally(() => prepare.mockRestore());
    expect(query).toBeDefined();
    const rows = session
      .prepareQuery(
        { sql: `explain query plan ${query!.sql}`, params: query!.params },
        undefined,
        "all",
        false,
      )
      .all() as { detail: string }[];
    for (const alias of ["observed", "lookup"]) {
      expect(rows.map(({ detail }) => detail)).toContainEqual(
        expect.stringContaining(
          `SEARCH ${alias} USING INDEX verifactu_history_registro_kind_seq_idx (registro_id=? AND kind=?)`,
        ),
      );
    }
  });
});

async function retry(registroId: string) {
  await suite.db.execute(sql`
    update verifactu_submissions set estado = 'pendiente', proximo_intento_en = ${SECOND.toISOString()}
    where registro_id = ${registroId}
  `);
}

describe("durable conflict observations", () => {
  it("later_conflict_survives_existing_case", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const registroId = seeded.registroIds[0]!;
    const rejected = fake();
    rejected.reject(seeded.facturaKeys[0]!, 1100, "Missing required field");
    await run(clientFor(rejected));
    const original = await suite.db.execute(sql`select * from verifactu_records`);
    const oldCase = await suite.db.execute<{ id: string }>(sql`select * from filing_cases`);
    expect(oldCase.rows).toHaveLength(1);
    expect(await observations()).toEqual([]);

    const conflicting = fake();
    await collideAtAeat(suite.db, conflicting, seeded, registroId);
    const real = clientFor(conflicting);
    let reply: { line: RespuestaLinea; csv: string | null } | undefined;
    const client: VerifactuClient = {
      submit: async (...args) => {
        const result = await real.submit(...args);
        reply = { line: result.RespuestaLinea[0]!, csv: result.CSV ?? null };
        return result;
      },
      consultar: (...args) => real.consultar(...args),
    };
    await retry(registroId);
    const outcome = await run(client, SECOND);

    expect(outcome.recordsHalted).toBe(1);
    expect(await suite.db.execute(sql`select * from verifactu_records`)).toEqual(original);
    expect(await suite.db.execute(sql`select * from filing_cases`)).toEqual(oldCase);
    expect((await suite.db.execute(sql`select state from acks`)).rows).toEqual([
      { state: "rejected" },
    ]);
    expect(await observations()).toEqual([
      expect.objectContaining({
        registro_id: registroId,
        case_id: oldCase.rows[0]!.id,
        attempt: 2,
        cause: "fiscal.huella_divergente",
        recorded_at: SECOND.toISOString(),
        evidence: {
          ...reply,
          comparison: {
            kind: "lookup-mismatch",
            storedFingerprint: "D".repeat(64),
            storedSystem: { taxId: "89890001K", softwareId: "WT", installation: "1" },
          },
        },
      }),
    ]);
    const observed = (await observations())[0]!;
    expect(await active(seeded.nodeId)).toEqual([
      {
        registroId,
        caseId: oldCase.rows[0]!.id,
        sifId: seeded.sifId,
        installationIdentity: "1",
        invoiceIdentity: "S1/1",
        observedAt: SECOND.toISOString(),
        evidence: observed.evidence,
        cause: "fiscal.huella_divergente",
        evidenceId: observed.id,
      },
    ]);
    await withTransaction(suite.db, (tx) =>
      conflicts.recordConflictEvidence(tx, {
        registroId,
        attempt: 2,
        cause: "fiscal.huella_divergente",
        evidence: observed.evidence,
        now: SECOND,
      }),
    );
    expect(await observations()).toEqual([observed]);
    await withTransaction(suite.db, (tx) =>
      conflicts.recordConflictEvidence(tx, {
        registroId,
        attempt: 3,
        cause: "fiscal.huella_divergente",
        evidence: observed.evidence,
        now: new Date("2026-07-21T00:03:00Z"),
      }),
    );
    expect(await observations()).toHaveLength(2);
    expect(await active(seeded.nodeId)).toEqual([
      expect.objectContaining({
        evidenceId: observed.id,
        observedAt: SECOND.toISOString(),
      }),
    ]);
  });

  it("retains a nonnull reply CSV without changing a same-batch successor's acceptance", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const aeat = fake();
    await collideAtAeat(suite.db, aeat, seeded, seeded.registroIds[0]!);
    await run(clientFor(aeat));
    const [observed] = await observations();
    const accepted = await suite.db.execute<{ csv: string | null; estado: string }>(sql`
      select csv, estado from verifactu_submissions where registro_id = ${seeded.registroIds[1]}
    `);
    expect(accepted.rows[0]).toEqual({ estado: "aceptado", csv: expect.any(String) });
    expect(observed!.evidence.csv).toBe(accepted.rows[0]!.csv);
  });

  it("keeps the annulled observation first when both causes share an attempt", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const registroId = seeded.registroIds[0]!;
    const aeat = fake();
    await collideAtAeat(suite.db, aeat, seeded, registroId);
    await run(clientFor(aeat));
    const [first] = await observations();
    expect(first!.cause).toBe("fiscal.huella_divergente");
    const evidence = { ...first!.evidence, comparison: { kind: "annulled" as const } };
    await withTransaction(suite.db, (tx) =>
      conflicts.recordConflictEvidence(tx, {
        registroId,
        attempt: first!.attempt,
        cause: "fiscal.duplicado_anulado",
        evidence,
        now: SECOND,
      }),
    );
    expect(await active(seeded.nodeId)).toEqual([
      expect.objectContaining({
        registroId,
        cause: "fiscal.duplicado_anulado",
        observedAt: SECOND.toISOString(),
        evidence,
      }),
    ]);
  });

  it("uses the stored cause that the database checked", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const registroId = seeded.registroIds[0]!;
    await withTransaction(suite.db, async (tx) => {
      await openFilingCase(tx, {
        registroId,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: null, mensaje: null, csv: null },
        now: FIRST,
      });
      const evidence = {
        line: {
          IDFactura: {
            IDEmisorFactura: seeded.nif,
            NumSerieFactura: "S1/1",
            FechaExpedicionFactura: "20-07-2026",
          },
        },
        comparison: { kind: "annulled" },
        csv: null,
      };
      const data = `{"attempt":1,"cause":"fiscal.duplicado_anulado","cause":"fiscal.huella_divergente","evidence":${JSON.stringify(evidence)}}`;
      await tx.execute(sql`insert into verifactu_history (id, seq, kind, node_id, at, data, event_key, registro_id)
        values ('observation', 1, 'conflict.observed', ${seeded.nodeId}, ${SECOND.toISOString()},
          ${data}, ${`conflict:${registroId}:1:fiscal.duplicado_anulado`}, ${registroId})`);
    });
    expect(await active(seeded.nodeId)).toEqual([
      expect.objectContaining({
        registroId,
        cause: "fiscal.duplicado_anulado",
        evidenceId: "observation",
      }),
    ]);
    const overview = await withTransaction(suite.db, (tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: null }),
    );
    expect(overview.cases[0]?.conflicts[0]?.cause).toBe("fiscal.duplicado_anulado");
  });

  it("retains a mismatching fingerprint when the stored software identity is absent", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    await collideAtAeat(suite.db, aeat, seeded, seeded.registroIds[0]!);
    const real = clientFor(aeat);
    await run({
      submit: (...args) => real.submit(...args),
      consultar: async (...args) => {
        const result = await real.consultar(...args);
        for (const row of result.registros) delete row.DatosRegistroFacturacion.SistemaInformatico;
        return result;
      },
    });
    expect((await observations())[0]!.evidence.comparison).toEqual({
      kind: "lookup-mismatch",
      storedFingerprint: "D".repeat(64),
      storedSystem: null,
    });
  });

  it.each(["update", "delete", "replace"])(
    "refuses %s of a recorded conflict observation",
    async (kind) => {
      const seeded = await seedPendingEnvios(suite.db, { count: 1 });
      const aeat = fake();
      await collideAtAeat(suite.db, aeat, seeded, seeded.registroIds[0]!);
      await run(clientFor(aeat));
      const before = await observations();
      const statement =
        kind === "update"
          ? sql`update verifactu_history set data = json_set(data, '$.attempt', 9) where kind = 'conflict.observed'`
          : kind === "delete"
            ? sql`delete from verifactu_history where kind = 'conflict.observed'`
            : sql`insert or replace into verifactu_history select * from verifactu_history where kind = 'conflict.observed'`;
      const error = await captureError(() => suite.db.execute(statement));
      expect(triggerRaised(error, "verifactu_history is append-only")).toBe(true);
      expect(await observations()).toEqual(before);
    },
  );

  it("retains annulled Route A without inventing lookup facts", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    await run(clientFor(aeat));
    aeat.annul(seeded.facturaKeys[0]!);
    await retry(seeded.registroIds[0]!);
    await run(clientFor(aeat), SECOND);
    expect(await observations()).toEqual([
      expect.objectContaining({
        attempt: 2,
        cause: "fiscal.duplicado_anulado",
        evidence: expect.objectContaining({ comparison: { kind: "annulled" } }),
      }),
    ]);
    expect(await active(seeded.nodeId)).toEqual([
      expect.objectContaining({
        cause: "fiscal.duplicado_anulado",
        registroId: seeded.registroIds[0],
      }),
    ]);
  });

  it("retains an equal fingerprint with a different software installation", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    const real = clientFor(aeat);
    await run(real);
    await retry(seeded.registroIds[0]!);
    const client: VerifactuClient = {
      submit: (...args) => real.submit(...args),
      consultar: async (...args) => {
        const result = await real.consultar(...args);
        for (const row of result.registros)
          row.DatosRegistroFacturacion.SistemaInformatico = {
            NIF: "89890001K",
            IdSistemaInformatico: "WT",
            NumeroInstalacion: "other-installation",
          };
        return result;
      },
    };
    await run(client, SECOND);
    expect(await observations()).toEqual([
      expect.objectContaining({
        cause: "fiscal.huella_divergente",
        evidence: expect.objectContaining({
          comparison: {
            kind: "lookup-mismatch",
            storedFingerprint: "0".repeat(63) + "1",
            storedSystem: {
              taxId: "89890001K",
              softwareId: "WT",
              installation: "other-installation",
            },
          },
        }),
      }),
    ]);
  });

  it.each([
    "matching",
    "missing-fingerprint",
    "missing-system",
    "missing-invoice",
    "throwing",
    "unrelated-refusal",
  ] as const)("%s does not create a conflict observation or active stop", async (mode) => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    const real = clientFor(aeat);
    if (mode === "unrelated-refusal")
      aeat.reject(seeded.facturaKeys[0]!, 1100, "Missing required field");
    else {
      await run(real);
      await retry(seeded.registroIds[0]!);
    }
    const client: VerifactuClient = {
      submit: (...args) => real.submit(...args),
      consultar: async (...args) => {
        if (mode === "throwing") throw new Error("Lookup unavailable");
        const result = await real.consultar(...args);
        if (mode === "missing-invoice") return { ...result, registros: [] };
        for (const row of result.registros) {
          if (mode === "missing-fingerprint") delete row.DatosRegistroFacturacion.Huella;
          if (mode === "missing-system") delete row.DatosRegistroFacturacion.SistemaInformatico;
        }
        return result;
      },
    };
    await run(client, SECOND);
    expect(await observations()).toEqual([]);
    expect(await active(seeded.nodeId)).toEqual([]);
    expect((await suite.db.execute(sql`select estado from verifactu_submissions`)).rows).toEqual([
      {
        estado:
          mode === "matching"
            ? "aceptado"
            : mode === "unrelated-refusal"
              ? "rechazado"
              : "pendiente",
      },
    ]);
  });

  it.each(["fiscal.huella_divergente", "fiscal.duplicado_anulado"] as const)(
    "historical %s remains active even after a case resolution note",
    async (cause) => {
      const seeded = await seedPendingEnvios(suite.db, { count: 1 });
      const registroId = seeded.registroIds[0]!;
      const opened = await withTransaction(suite.db, (tx) =>
        openFilingCase(tx, {
          registroId,
          cause,
          evidence: { codigo: 3000, mensaje: "Historical conflict", csv: "CSV-OLD" },
          now: FIRST,
        }),
      );
      await withTransaction(suite.db, (tx) =>
        recordCaseEvent(tx, {
          caseId: opened.id,
          actionKey: "resolved-without-switch",
          kind: "resolved",
          personId: "33333333-3333-4333-8333-333333333333",
          action: "note",
          now: SECOND,
        }),
      );
      expect(await active(seeded.nodeId)).toEqual([
        {
          registroId,
          caseId: opened.id,
          sifId: seeded.sifId,
          installationIdentity: "1",
          invoiceIdentity: "S1/1",
          observedAt: FIRST.toISOString(),
          evidence: null,
          cause,
          evidenceId: null,
        },
      ]);
      expect(await active("44444444-4444-4444-8444-444444444444")).toEqual([]);
    },
  );

  it("keeps retired evidence but does not stop the replacement identity", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    await collideAtAeat(suite.db, aeat, seeded, seeded.registroIds[0]!);
    await run(clientFor(aeat));
    expect(await active(seeded.nodeId)).toHaveLength(1);
    const before = await observations();
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update verifactu_identities set revocado_en = ${SECOND.toISOString()} where id = ${seeded.sifId}`,
      );
      await tx.execute(sql`insert into verifactu_identities (id, node_id, nif, id_sistema_informatico, numero_instalacion, registrado_en)
        values ('44444444-4444-4444-8444-444444444444', ${seeded.nodeId}, ${seeded.nif}, 'WT', '2', ${SECOND.toISOString()})`);
    });
    expect(await active(seeded.nodeId)).toEqual([]);
    expect(await observations()).toEqual(before);
  });

  it("backs out the reply, case, acknowledgement and evidence when an after-insert write fails", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    await collideAtAeat(suite.db, aeat, seeded, seeded.registroIds[0]!);
    await suite.db.execute(sql`create trigger fail_after_conflict after insert on verifactu_history
      when new.kind = 'conflict.observed' begin select raise(abort, 'test_evidence_failure'); end`);
    try {
      const result = await run(clientFor(aeat));
      expect(result.recordsHalted).toBe(0);
      expect(await observations()).toEqual([]);
      expect((await suite.db.execute(sql`select * from filing_cases`)).rows).toEqual([]);
      expect((await suite.db.execute(sql`select * from acks`)).rows).toEqual([]);
      expect(
        (await suite.db.execute(sql`select estado, csv from verifactu_submissions`)).rows,
      ).toEqual([{ estado: "pendiente", csv: null }]);
    } finally {
      await suite.db.execute(sql`drop trigger fail_after_conflict`);
    }
    await retry(seeded.registroIds[0]!);
    await run(clientFor(aeat), SECOND);
    expect(await observations()).toHaveLength(1);
    expect(await active(seeded.nodeId)).toHaveLength(1);
  });

  it("retains a committed conflict across a new process and a later failed transaction", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = fake();
    await collideAtAeat(suite.db, aeat, seeded, seeded.registroIds[0]!);
    const identities = await suite.db.execute(sql`select * from verifactu_identities`);
    await run(clientFor(aeat));
    const before = await observations();
    const response = await suite.db.execute(sql`select * from verifactu_submissions`);
    await expect(
      withTransaction(suite.db, async (tx) => {
        await tx.execute(
          sql`update verifactu_identities set revocado_en = ${SECOND.toISOString()} where id = ${seeded.sifId}`,
        );
        throw new Error("Later recovery failed");
      }),
    ).rejects.toThrow("Later recovery failed");
    expect(await observations()).toEqual(before);
    expect(await suite.db.execute(sql`select * from verifactu_submissions`)).toEqual(response);
    expect(await suite.db.execute(sql`select * from verifactu_identities`)).toEqual(identities);
    const files = await suite.db.execute<{ name: string; file: string }>(sql`pragma database_list`);
    const file = files.rows.find((row) => row.name === "main")!.file;
    const read = execFileSync(
      process.execPath,
      [
        "-e",
        `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1], {readOnly:true});
      process.stdout.write(JSON.stringify(db.prepare(${JSON.stringify(observationRows)}).all()));
      db.close();`,
        file,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(JSON.parse(read)).toEqual(
      before.map((row) => ({ ...row, evidence: JSON.stringify(row.evidence) })),
    );
    expect(await active(seeded.nodeId)).toHaveLength(1);
  });
});
