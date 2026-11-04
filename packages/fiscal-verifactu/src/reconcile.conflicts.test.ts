import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, triggerRaised, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendCancellation, collideAtAeat, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { assertNoActiveConflict, readActiveConflicts } from "./conflict-evidence.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { openFilingCase } from "./filing-cases.js";
import { reconcile } from "./reconcile.js";
import { retainLookupConflict } from "./reconcile-conflicts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const PERIOD = { year: "2026", month: "07" };

async function fixture(sent = true) {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const aeat = createFakeAeat({ serverNow: NOW });
  const client = aeat.client();
  if (sent)
    await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(client),
        environment: "production",
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      },
      NOW,
    );
  const real = await client.consultar(
    { ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } },
    {
      Ejercicio: "2026",
      Periodo: "07",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
    },
  );
  return { seeded, client, real, aeat };
}

async function immutableSnapshot() {
  const tables = [
    "registros_facturacion",
    "cadenas",
    "registro_sif",
    "invoice_series",
    "fiscal_allocations",
    "fiscal_reservations",
    "envios",
    "acks",
  ];
  const result: Record<string, unknown> = {};
  for (const table of tables)
    result[table] = (
      await suite.db.execute(
        sql.raw(`select * from "${table.replaceAll('"', '""')}" order by rowid`),
      )
    ).rows;
  return result;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function run(f: Fixture, client = f.client) {
  return reconcile(
    {
      db: suite.db,
      clock: f.seeded.clock,
      resolveClient: staticResolver(client),
      scope: { nodeId: f.seeded.nodeId, taxpayerId: f.seeded.nif, environment: "production" },
    },
    PERIOD,
  );
}

describe("runtime lookup conflicts use the administrator stop without changing filing facts", () => {
  it.each(["pending", "filed"] as const)(
    "keeps an invoice's own %s cancellation distinct from conflicting contents",
    async (state) => {
      const f = await fixture();
      await appendCancellation(suite.db, f.seeded, f.seeded.registroIds[0]!, 2);
      if (state === "filed")
        await drain(
          {
            db: suite.db,
            resolveClient: staticResolver(f.client),
            environment: "production",
            skipRetryMs: DEFAULT_SKIP_RETRY_MS,
          },
          new Date("2026-07-21T00:02:00Z"),
        );
      const before = await immutableSnapshot();

      const result = await run(f);

      expect(result).toEqual({
        year: "2026",
        month: "07",
        checked: 2,
        lostAck: [],
        noTrace: [],
        drift: [],
        incidentsRaised: 0,
      });
      expect(await immutableSnapshot()).toEqual(before);
      expect(
        await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
      ).toEqual([]);
      expect((await suite.db.execute(sql`select * from fiscal_lookup_conflicts`)).rows).toEqual([]);
    },
  );
  it.each(["IDEmisorFactura", "NumSerieFactura"] as const)(
    "does not attach another invoice's conflicting contents by %s",
    async (field) => {
      const f = await fixture();
      const before = await immutableSnapshot();
      const original = f.real.registros[0]!;
      const client: VerifactuClient = {
        submit: f.client.submit.bind(f.client),
        consultar: async () => ({
          ...f.real,
          registros: [
            ...f.real.registros,
            {
              ...original,
              IDFactura: {
                ...original.IDFactura,
                [field]: field === "IDEmisorFactura" ? "B87654324" : "OTHER/1",
              },
              DatosRegistroFacturacion: {
                ...original.DatosRegistroFacturacion,
                RefExterna: "foreign-copy",
                Huella: "D".repeat(64),
              },
            },
          ],
        }),
      };
      expect(await run(f, client)).toEqual({
        year: "2026",
        month: "07",
        checked: 1,
        lostAck: [],
        noTrace: [],
        drift: [],
        incidentsRaised: 0,
      });
      expect(await immutableSnapshot()).toEqual(before);
      expect(
        await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
      ).toEqual([]);
    },
  );
  it.each(["update", "delete", "replace"] as const)(
    "keeps retained lookup evidence append-only (%s)",
    async (operation) => {
      const f = await fixture();
      await withTransaction(suite.db, (tx) =>
        retainLookupConflict(
          tx,
          f.seeded.registroIds[0]!,
          {
            source: "consulta",
            invoice: f.real.registros[0]!.IDFactura,
            reference: null,
            state: "Correcto",
            fingerprint: "D".repeat(64),
            system: null,
          },
          NOW,
        ),
      );
      const before = await suite.db.execute(sql`select * from fiscal_lookup_conflicts`);
      const error = await captureError(() =>
        suite.db.execute(
          operation === "update"
            ? sql`update fiscal_lookup_conflicts set evidence = '{}'`
            : operation === "delete"
              ? sql`delete from fiscal_lookup_conflicts`
              : sql`insert or replace into fiscal_lookup_conflicts select * from fiscal_lookup_conflicts`,
        ),
      );
      expect(triggerRaised(error, "fiscal_lookup_conflicts is append-only")).toBe(true);
      expect(await suite.db.execute(sql`select * from fiscal_lookup_conflicts`)).toEqual(before);
    },
  );

  it("retains a retired identity's observation without stopping or allocating for the current identity", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update registro_sif set revocado_en = ${NOW.toISOString()} where id = ${f.seeded.sifId}`,
      );
      await tx.execute(
        sql`insert into registro_sif (id,node_id,nif,id_sistema_informatico,numero_instalacion,registrado_en) select 'new-sif',node_id,nif,id_sistema_informatico,'new-installation',registrado_en from registro_sif where id=${f.seeded.sifId}`,
      );
    });
    const before = await immutableSnapshot();
    const client: VerifactuClient = {
      submit: f.client.submit.bind(f.client),
      consultar: async () => ({
        ...f.real,
        registros: f.real.registros.map((r) => ({
          ...r,
          DatosRegistroFacturacion: { ...r.DatosRegistroFacturacion, Huella: "D".repeat(64) },
        })),
      }),
    };
    await run(f, client);
    expect(
      (await suite.db.execute(sql`select registro_id from fiscal_lookup_conflicts`)).rows,
    ).toEqual([{ registro_id: f.seeded.registroIds[0] }]);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
    await withTransaction(suite.db, (tx) => assertNoActiveConflict(tx, f.seeded.nodeId));
    expect(await immutableSnapshot()).toEqual(before);
  });

  it("rolls back the case when lookup-evidence persistence is refused", async () => {
    const f = await fixture();
    const before = await immutableSnapshot();
    const client: VerifactuClient = {
      submit: f.client.submit.bind(f.client),
      consultar: async () => ({
        ...f.real,
        registros: f.real.registros.map((r) => ({
          ...r,
          DatosRegistroFacturacion: { ...r.DatosRegistroFacturacion, Huella: "D".repeat(64) },
        })),
      }),
    };
    await suite.db.execute(
      sql`create trigger refuse_lookup_evidence before insert on fiscal_lookup_conflicts begin select raise(abort, 'lookup evidence refused'); end`,
    );
    try {
      await expect(run(f, client)).rejects.toThrow("lookup evidence refused");
      expect((await suite.db.execute(sql`select * from filing_cases`)).rows).toEqual([]);
      expect((await suite.db.execute(sql`select * from fiscal_lookup_conflicts`)).rows).toEqual([]);
      expect((await suite.db.execute(sql`select * from incidents`)).rows).toEqual([]);
      expect(await immutableSnapshot()).toEqual(before);
    } finally {
      await suite.db.execute(sql`drop trigger refuse_lookup_evidence`);
    }
  });
  it.each([
    "fingerprint",
    "empty-fingerprint",
    "system",
    "taxId",
    "softwareId",
    "installation",
  ] as const)(
    "leaves a missing %s unknown instead of confirming a pending record",
    async (missing) => {
      const f = await fixture();
      await withTransaction(suite.db, async (tx) => {
        await tx.execute(sql`update envios set estado = 'pendiente'`);
        await tx.execute(sql`delete from acks`);
      });
      const before = await immutableSnapshot();
      const client: VerifactuClient = {
        submit: f.client.submit.bind(f.client),
        consultar: async () => ({
          ...f.real,
          registros: f.real.registros.map((r) => {
            const data = { ...r.DatosRegistroFacturacion };
            if (missing === "fingerprint") delete data.Huella;
            else if (missing === "empty-fingerprint") data.Huella = "";
            else if (missing === "system") delete data.SistemaInformatico;
            else {
              const system = { ...(data.SistemaInformatico as Record<string, unknown>) };
              delete system[
                {
                  taxId: "NIF",
                  softwareId: "IdSistemaInformatico",
                  installation: "NumeroInstalacion",
                }[missing]
              ];
              data.SistemaInformatico = system;
            }
            return { ...r, DatosRegistroFacturacion: data };
          }),
        }),
      };

      const result = await run(f, client);

      expect(result.lostAck).toEqual([]);
      expect(result.deferred).toEqual(f.seeded.registroIds);
      expect(await immutableSnapshot()).toEqual(before);
      expect(
        await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
      ).toEqual([]);
    },
  );

  it("retains a real lookup conflict before this box has attempted submission", async () => {
    const f = await fixture(false);
    await collideAtAeat(suite.db, f.aeat, f.seeded, f.seeded.registroIds[0]!);
    const before = await immutableSnapshot();

    await run(f);

    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([
      expect.objectContaining({
        registroId: f.seeded.registroIds[0],
        evidence: expect.objectContaining({ source: "consulta", fingerprint: "D".repeat(64) }),
      }),
    ]);
    expect(await immutableSnapshot()).toEqual(before);
    expect((await suite.db.execute(sql`select intentos from envios`)).rows).toEqual([
      { intentos: 0 },
    ]);
    expect((await suite.db.execute(sql`select * from fiscal_conflict_evidence`)).rows).toEqual([]);
  });

  it("accepts the exact stored contents under another reference without changing confirmed filing facts", async () => {
    const f = await fixture();
    const before = await immutableSnapshot();
    const client: VerifactuClient = {
      submit: f.client.submit.bind(f.client),
      consultar: async () => ({
        ...f.real,
        registros: f.real.registros.map((r) => ({
          ...r,
          DatosRegistroFacturacion: {
            ...r.DatosRegistroFacturacion,
            RefExterna: "another-reference",
          },
        })),
      }),
    };
    const result = await run(f, client);
    expect(result).toEqual({
      year: "2026",
      month: "07",
      checked: 1,
      lostAck: [],
      noTrace: [],
      drift: [],
      incidentsRaised: 0,
    });
    expect(await immutableSnapshot()).toEqual(before);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
  });

  it("keeps a partial page's conflict uncommitted when the next page fails", async () => {
    const f = await fixture();
    const before = await immutableSnapshot();
    const client: VerifactuClient = {
      submit: f.client.submit.bind(f.client),
      consultar: async (_header, filter) => {
        if (filter.ClavePaginacion !== undefined) throw new Error("later page unavailable");
        return {
          ...f.real,
          IndicadorPaginacion: "S",
          ClavePaginacion: f.real.registros[0]!.IDFactura,
          registros: f.real.registros.map((r) => ({
            ...r,
            DatosRegistroFacturacion: { ...r.DatosRegistroFacturacion, Huella: "D".repeat(64) },
          })),
        };
      },
    };
    await expect(run(f, client)).rejects.toThrow("later page unavailable");
    expect(await immutableSnapshot()).toEqual(before);
    expect((await suite.db.execute(sql`select * from fiscal_lookup_conflicts`)).rows).toEqual([]);
    expect((await suite.db.execute(sql`select * from filing_cases`)).rows).toEqual([]);
    expect((await suite.db.execute(sql`select * from incidents`)).rows).toEqual([]);
  });
  it.each(["fingerprint", "taxId", "softwareId", "installation", "different-date"] as const)(
    "retains a confirmed %s conflict even when its reference belongs to another copy",
    async (changed) => {
      const f = await fixture();
      const original = f.real.registros[0]!;
      const system = original.DatosRegistroFacturacion.SistemaInformatico!;
      const observed = {
        ...original,
        IDFactura: {
          ...original.IDFactura,
          ...(changed === "different-date" ? { FechaExpedicionFactura: "19-07-2026" } : {}),
        },
        DatosRegistroFacturacion: {
          ...original.DatosRegistroFacturacion,
          RefExterna: "another-copy",
          ...(changed === "fingerprint" ? { Huella: "D".repeat(64) } : {}),
          SistemaInformatico: {
            ...system,
            ...(changed === "taxId" ? { NIF: "B87654324" } : {}),
            ...(changed === "softwareId" ? { IdSistemaInformatico: "OTHER" } : {}),
            ...(changed === "installation" ? { NumeroInstalacion: "OTHER" } : {}),
          },
        },
      };
      const client: VerifactuClient = {
        submit: f.client.submit.bind(f.client),
        consultar: async () => ({ ...f.real, registros: [observed] }),
      };
      const before = await immutableSnapshot();

      const result = await run(f, client);

      const active = await withTransaction(suite.db, (tx) =>
        readActiveConflicts(tx, f.seeded.nodeId),
      );
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        registroId: f.seeded.registroIds[0],
        sifId: f.seeded.sifId,
        cause: "fiscal.huella_divergente",
        evidence: {
          source: "consulta",
          invoice: observed.IDFactura,
          reference: "another-copy",
          state: "Correcto",
          fingerprint: observed.DatosRegistroFacturacion.Huella,
          system: {
            taxId: changed === "taxId" ? "B87654324" : "89890001K",
            softwareId: changed === "softwareId" ? "OTHER" : "WT",
            installation: changed === "installation" ? "OTHER" : "1",
          },
        },
      });
      expect(active[0]!.evidenceId).toEqual(expect.any(String));
      expect(result).toMatchObject({ lostAck: [], noTrace: [], drift: [], incidentsRaised: 1 });
      expect(await immutableSnapshot()).toEqual(before);
      await expect(
        withTransaction(suite.db, (tx) => assertNoActiveConflict(tx, f.seeded.nodeId)),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "conflict_requires_administrator" },
      });
      const repeated = await run(f, client);
      expect(repeated.incidentsRaised).toBe(0);
      expect(
        await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
      ).toEqual(active);
      expect(await immutableSnapshot()).toEqual(before);
    },
  );

  it("records a lookup conflict after an unrelated case without replacing that case", async () => {
    const f = await fixture();
    const existing = await withTransaction(suite.db, (tx) =>
      openFilingCase(tx, {
        registroId: f.seeded.registroIds[0]!,
        cause: "fiscal.aceptado_con_errores",
        evidence: { codigo: 2000, mensaje: "Original stored warning", csv: "original-csv" },
        now: f.seeded.clock.now().instant,
      }),
    );
    const before = await suite.db.execute(sql`select * from filing_cases`);
    const client: VerifactuClient = {
      submit: f.client.submit.bind(f.client),
      consultar: async () => ({
        ...f.real,
        registros: f.real.registros.map((r) => ({
          ...r,
          DatosRegistroFacturacion: { ...r.DatosRegistroFacturacion, Huella: "D".repeat(64) },
        })),
      }),
    };

    await run(f, client);

    expect(await suite.db.execute(sql`select * from filing_cases`)).toEqual(before);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([
      expect.objectContaining({
        caseId: existing.id,
        cause: "fiscal.huella_divergente",
        evidence: expect.objectContaining({ source: "consulta" }),
      }),
    ]);
  });
});

it.each(["original", "cancellation"] as const)(
  "keeps a cancelled invoice's known %s fingerprint out of the conflict stop",
  async (fingerprintSource) => {
    const f = await fixture();
    await appendCancellation(suite.db, f.seeded, f.seeded.registroIds[0]!, 2);
    await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(f.client),
        environment: "production",
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      },
      new Date("2026-07-21T00:02:00Z"),
    );
    const records = (
      await suite.db.execute<{ tipo_registro: string; huella: string }>(
        sql`select tipo_registro, huella from registros_facturacion order by secuencia`,
      )
    ).rows;
    const fingerprint = records.find(
      (row) => row.tipo_registro === (fingerprintSource === "original" ? "alta" : "anulacion"),
    )!.huella;
    const client: VerifactuClient = {
      ...f.client,
      consultar: async (...args) => {
        const response = await f.client.consultar(...args);
        return {
          ...response,
          registros: response.registros!.map((record) => ({
            ...record,
            DatosRegistroFacturacion: { ...record.DatosRegistroFacturacion, Huella: fingerprint },
          })),
        };
      },
    };
    const before = await immutableSnapshot();
    const result = await run(f, client);
    expect(result.conflicts ?? []).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
    expect(await immutableSnapshot()).toEqual(before);
    expect((await suite.db.execute(sql`select * from fiscal_lookup_conflicts`)).rows).toEqual([]);
  },
);

it.each([false, true])(
  "keeps an external cancellation on the existing drift path (scoped %s)",
  async (scoped) => {
    const f = await fixture();
    f.aeat.annul(f.aeat.stored()[0]!.key);
    const client: VerifactuClient = {
      ...f.client,
      consultar: async (...args) => {
        const response = await f.client.consultar(...args);
        return {
          ...response,
          registros: response.registros.map((record) => ({
            ...record,
            DatosRegistroFacturacion: {
              ...record.DatosRegistroFacturacion,
              Huella: "E".repeat(64),
            },
          })),
        };
      },
    };
    const before = await immutableSnapshot();
    const result = await reconcile(
      {
        db: suite.db,
        clock: f.seeded.clock,
        resolveClient: staticResolver(client),
        ...(scoped
          ? {
              scope: {
                nodeId: f.seeded.nodeId,
                taxpayerId: f.seeded.nif,
                environment: "production" as const,
              },
            }
          : {}),
      },
      PERIOD,
    );
    expect(result.drift).toEqual([
      { recordId: f.seeded.registroIds[0], localState: "aceptado", reportedState: "Anulado" },
    ]);
    expect(result.conflicts ?? []).toEqual([]);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
    expect(await immutableSnapshot()).toEqual(before);
  },
);
