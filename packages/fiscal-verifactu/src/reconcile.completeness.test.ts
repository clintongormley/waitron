import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { ConsultaFiltro, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { reconcile } from "./reconcile.js";

const PERIOD = { year: "2026", month: "07" };
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
type Cursor = NonNullable<ConsultaFiltro["ClavePaginacion"]>;

async function submitted() {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const aeat = createFakeAeat({
    serverNow: new Date("2026-07-21T00:00:00Z"),
    consultaPageSize: 1,
  });
  const client = aeat.client();
  await drain(
    {
      db: suite.db,
      resolveClient: staticResolver(client),
      environment: "production",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    new Date("2026-07-21T00:01:00Z"),
  );
  return { seeded, client };
}

async function snapshot() {
  return {
    deliveries: (await suite.db.execute(sql`select * from envios order by registro_id`)).rows,
    acknowledgements: (await suite.db.execute(sql`select * from acks order by registro_id`)).rows,
    incidents: (await suite.db.execute(sql`select * from incidents order by id`)).rows,
    cases: (await suite.db.execute(sql`select * from filing_cases order by id`)).rows,
    events: (await suite.db.execute(sql`select * from filing_case_events order by id`)).rows,
    records: (await suite.db.execute(sql`select * from registros_facturacion order by id`)).rows,
  };
}

async function loseAcknowledgements() {
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`update envios set estado = 'pendiente'`);
    await tx.execute(sql`delete from acks`);
  });
}

describe("reconciliation requires a complete paged lookup", () => {
  it.each(["adjacent", "cycle"] as const)(
    "refuses a repeated cursor (%s) without applying a partial authority view",
    async (shape) => {
      const { seeded, client } = await submitted();
      await loseAcknowledgements();
      const before = await snapshot();
      let calls = 0;
      let first: Cursor | undefined;
      const paged: VerifactuClient = {
        submit: client.submit.bind(client),
        consultar: async (header, filter) => {
          calls += 1;
          const repeatsAt = shape === "adjacent" ? 2 : 3;
          if (calls > repeatsAt) throw new Error("test lookup budget exceeded");
          const response = await client.consultar(header, filter);
          if (calls === 1) first = response.ClavePaginacion!;
          if (calls === repeatsAt) {
            return {
              ...response,
              IndicadorPaginacion: "S",
              ClavePaginacion: {
                FechaExpedicionFactura: first!.FechaExpedicionFactura,
                NumSerieFactura: first!.NumSerieFactura,
                IDEmisorFactura: first!.IDEmisorFactura,
              },
            };
          }
          return response;
        },
      };

      await expect(
        reconcile(
          { db: suite.db, resolveClient: staticResolver(paged), clock: seeded.clock },
          PERIOD,
        ),
      ).rejects.toThrow("consulta repeated a ClavePaginacion");
      expect(calls).toBe(shape === "adjacent" ? 2 : 3);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["accepted", "pending"] as const)(
    "keeps %s deliveries and records when a later page is unavailable",
    async (state) => {
      const { seeded, client } = await submitted();
      if (state === "pending") await loseAcknowledgements();
      const before = await snapshot();
      const unavailable = new Error("authority unavailable after page one");
      const paged: VerifactuClient = {
        submit: client.submit.bind(client),
        consultar: (header, filter) =>
          filter.ClavePaginacion === undefined
            ? client.consultar(header, filter)
            : Promise.reject(unavailable),
      };

      await expect(
        reconcile(
          { db: suite.db, resolveClient: staticResolver(paged), clock: seeded.clock },
          PERIOD,
        ),
      ).rejects.toBe(unavailable);
      expect(before.acknowledgements).toHaveLength(state === "accepted" ? 3 : 0);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["IDEmisorFactura", "NumSerieFactura", "FechaExpedicionFactura"] as const)(
    "does not certify a matching reference whose %s names another invoice",
    async (field) => {
      const { seeded, client } = await submitted();
      await loseAcknowledgements();
      const before = await snapshot();
      const mismatched: VerifactuClient = {
        submit: client.submit.bind(client),
        consultar: async (header, filter) => {
          const response = await client.consultar(header, filter);
          return {
            ...response,
            registros: response.registros.map((record) => ({
              ...record,
              IDFactura: {
                ...record.IDFactura,
                [field]: {
                  IDEmisorFactura: "B87654324",
                  NumSerieFactura: "OTHER/1",
                  FechaExpedicionFactura: "21-07-2026",
                }[field],
              },
            })),
          };
        },
      };

      await expect(
        reconcile(
          { db: suite.db, resolveClient: staticResolver(mismatched), clock: seeded.clock },
          PERIOD,
        ),
      ).rejects.toThrow("consulta identity does not match stored record");
      expect(await snapshot()).toEqual(before);
    },
  );

  it("finishes a genuine three-page lookup without flagging later pages as missing", async () => {
    const { seeded, client } = await submitted();
    const before = await snapshot();

    expect(
      await reconcile(
        { db: suite.db, resolveClient: staticResolver(client), clock: seeded.clock },
        PERIOD,
      ),
    ).toEqual({
      year: "2026",
      month: "07",
      checked: 3,
      lostAck: [],
      noTrace: [],
      drift: [],
      incidentsRaised: 0,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("recovers lost acknowledgements only after all three pages have arrived", async () => {
    const { seeded, client } = await submitted();
    await loseAcknowledgements();
    const before = await snapshot();

    const result = await reconcile(
      { db: suite.db, resolveClient: staticResolver(client), clock: seeded.clock },
      PERIOD,
    );

    expect(result.lostAck.map((row) => row.recordId).sort()).toEqual(
      [...seeded.registroIds].sort(),
    );
    expect(result.lostAck.every((row) => row.localState === "pendiente")).toBe(true);
    expect(result.lostAck.every((row) => row.reportedState === "Correcto")).toBe(true);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    const after = await snapshot();
    expect(after.acknowledgements).toHaveLength(3);
    expect(after.deliveries.map((row) => row.estado)).toEqual(["aceptado", "aceptado", "aceptado"]);
    expect(after.records).toEqual(before.records);
    expect(after.incidents).toEqual([]);
    expect(after.cases).toEqual([]);
    expect(after.events).toEqual([]);
  });

  it.each(["IDEmisorFactura", "NumSerieFactura", "FechaExpedicionFactura"] as const)(
    "accepts distinct continuation identities that differ only in %s",
    async (field) => {
      const { seeded, client } = await submitted();
      const before = await snapshot();
      const cursor: Cursor = {
        IDEmisorFactura: "B12345674",
        NumSerieFactura: "A/1",
        FechaExpedicionFactura: "20-07-2026",
      };
      const next: Cursor = {
        ...cursor,
        [field]: {
          IDEmisorFactura: "B87654324",
          NumSerieFactura: "A/2",
          FechaExpedicionFactura: "21-07-2026",
        }[field],
      };
      const requested: ConsultaFiltro["ClavePaginacion"][] = [];
      let realCursor: ConsultaFiltro["ClavePaginacion"];
      const paged: VerifactuClient = {
        submit: client.submit.bind(client),
        consultar: async (header, filter) => {
          requested.push(filter.ClavePaginacion);
          if (requested.length > 3) throw new Error("test lookup budget exceeded");
          const response = await client.consultar(header, {
            ...filter,
            ClavePaginacion: realCursor,
          });
          realCursor = response.ClavePaginacion;
          return response.IndicadorPaginacion === "N"
            ? response
            : { ...response, ClavePaginacion: requested.length === 1 ? cursor : next };
        },
      };

      const result = await reconcile(
        { db: suite.db, resolveClient: staticResolver(paged), clock: seeded.clock },
        PERIOD,
      );

      expect(result).toEqual({
        year: "2026",
        month: "07",
        checked: 3,
        lostAck: [],
        noTrace: [],
        drift: [],
        incidentsRaised: 0,
      });
      expect(requested).toEqual([undefined, cursor, next]);
      expect(await snapshot()).toEqual(before);
    },
  );
});
