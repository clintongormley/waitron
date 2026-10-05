import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RegistroAlta } from "@waitron/verifactu";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, RECUPERACION_ENVIANDO_MS, drain } from "./drain.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const RETRY_AT = new Date("2026-07-21T00:03:00Z");

describe("drain chain ordering", () => {
  it("does not accept a Correcta duplicate whose stored fingerprint belongs to another record", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const raw = await suite.db.execute<Record<string, unknown>>(sql`
      select * from registros_facturacion where id = ${seeded.registroIds[0]}
    `);
    const ours = fromRegistroRow(decodeRegistroRow<RegistroRow>(raw.rows[0]!)) as RegistroAlta;
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    await aeat
      .client()
      .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
        { RegistroAlta: { ...ours, Huella: "D".repeat(64) } },
      ]);

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsHalted).toBe(1);
    const stored = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id = ${seeded.registroIds[0]}
    `);
    expect(stored.rows[0]?.estado).toBe("detenido");
    expect(aeat.stored()[0]?.huella).toBe("D".repeat(64));
  });

  it("does not claim a matching fingerprint filed under another installation", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const raw = await suite.db.execute<Record<string, unknown>>(sql`
      select * from registros_facturacion where id = ${seeded.registroIds[0]}
    `);
    const ours = fromRegistroRow(decodeRegistroRow<RegistroRow>(raw.rows[0]!)) as RegistroAlta;
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    await aeat
      .client()
      .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
        {
          RegistroAlta: {
            ...ours,
            SistemaInformatico: { ...ours.SistemaInformatico, NumeroInstalacion: "99999" },
          },
        },
      ]);

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsHalted).toBe(1);
    const stored = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id = ${seeded.registroIds[0]}
    `);
    expect(stored.rows[0]?.estado).toBe("detenido");
  });

  it("keeps a duplicate unresolved when lookup returns no matching invoice", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const first = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );
    expect(first.recordsAccepted).toBe(1);
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${NOW.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const real = aeat.client();
    const noLookupRow: VerifactuClient = {
      submit: (...args) => real.submit(...args),
      consultar: async (...args) => ({ ...(await real.consultar(...args)), registros: [] }),
    };

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(noLookupRow),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      new Date("2026-07-21T00:02:00Z"),
    );

    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsHalted).toBe(0);
    const stored = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id = ${seeded.registroIds[0]}
    `);
    expect(stored.rows[0]?.estado).toBe("pendiente");
  });

  it("follows a paged lookup before deciding whether the stored fingerprint matches", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const real = aeat.client();
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(real),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production" as const,
    };
    await drain(deps, NOW);
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${NOW.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const [nif, number, date] = seeded.facturaKeys[0]!.split("|");
    const pageKey = {
      IDEmisorFactura: nif!,
      NumSerieFactura: number!,
      FechaExpedicionFactura: date!,
    };
    let lookups = 0;
    let secondPage: Awaited<ReturnType<VerifactuClient["consultar"]>> | undefined;
    const paged: VerifactuClient = {
      submit: (...args) => real.submit(...args),
      consultar: async (cabecera, filtro) => {
        lookups += 1;
        if (lookups === 1) {
          expect(filtro.ClavePaginacion).toBeUndefined();
          secondPage = await real.consultar(cabecera, filtro);
          return {
            ...secondPage,
            registros: [],
            IndicadorPaginacion: "S",
            ClavePaginacion: pageKey,
          };
        }
        expect(filtro.ClavePaginacion).toEqual(pageKey);
        return secondPage!;
      },
    };

    const result = await drain(
      { ...deps, resolveClient: staticResolver(paged) },
      new Date("2026-07-21T00:02:00Z"),
    );

    expect(lookups).toBe(2);
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);
  });

  it("keeps a duplicate pending when the lookup row has no fingerprint", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const real = aeat.client();
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(real),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production" as const,
    };
    await drain(deps, NOW);
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${NOW.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const withoutFingerprint: VerifactuClient = {
      submit: (...args) => real.submit(...args),
      consultar: async (...args) => {
        const response = await real.consultar(...args);
        return {
          ...response,
          registros: response.registros.map((record) => ({
            ...record,
            DatosRegistroFacturacion: {
              ...record.DatosRegistroFacturacion,
              Huella: undefined,
            },
          })),
        };
      },
    };

    const retry = await drain(
      { ...deps, resolveClient: staticResolver(withoutFingerprint) },
      new Date("2026-07-21T00:02:00Z"),
    );

    expect(retry.recordsAccepted).toBe(0);
    expect(retry.recordsHalted).toBe(0);
    expect(retry.recordsSubmitted).toBe(1);
    const state = await suite.db.execute<{ estado: string; incidencia: number }>(sql`
      select estado, incidencia from envios where registro_id = ${seeded.registroIds[0]}
    `);
    expect(state.rows[0]).toEqual({ estado: "pendiente", incidencia: 1 });
  });

  it("retries a duplicate when a later lookup page fails", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const real = aeat.client();
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(real),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production" as const,
    };
    await drain(deps, NOW);
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${NOW.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    let lookups = 0;
    const pageFails: VerifactuClient = {
      submit: (...args) => real.submit(...args),
      consultar: async (...args) => {
        lookups += 1;
        if (lookups === 2) throw new Error("second lookup page unavailable");
        const response = await real.consultar(...args);
        return {
          ...response,
          registros: [],
          IndicadorPaginacion: "S",
          ClavePaginacion: {
            IDEmisorFactura: seeded.nif,
            NumSerieFactura: seeded.facturaKeys[0]!.split("|")[1]!,
            FechaExpedicionFactura: "20-07-2026",
          },
        };
      },
    };

    const retry = await drain(
      { ...deps, resolveClient: staticResolver(pageFails) },
      new Date("2026-07-21T00:02:00Z"),
    );

    expect(lookups).toBe(2);
    expect(retry.recordsAccepted).toBe(0);
    expect(retry.recordsHalted).toBe(0);
    expect(retry.recordsSubmitted).toBe(1);
    const state = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id = ${seeded.registroIds[0]}
    `);
    expect(state.rows[0]?.estado).toBe("pendiente");
  });

  it("does not submit a due successor before its earlier retry, and wakes when the retry is due", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set proximo_intento_en = ${RETRY_AT.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(aeat.client()),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production" as const,
    };

    const first = await drain(deps, NOW);

    expect(first.batchesSent).toBe(0);
    expect(first.recordsSubmitted).toBe(0);
    expect(first.nextDueAt).toEqual(RETRY_AT);
    expect(aeat.stored()).toHaveLength(0);
    const before = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id in ${seeded.registroIds}
      order by registro_id
    `);
    expect(before.rows.map((row) => row.estado)).toEqual(["pendiente", "pendiente"]);

    const second = await drain(deps, RETRY_AT);
    expect(second.batchesSent).toBe(1);
    expect(second.recordsSubmitted).toBe(2);
    expect(aeat.stored().map((row) => row.refExterna)).toEqual(seeded.registroIds);
  });

  it("sends a due independent chain while an earlier record on another chain waits", async () => {
    const blocked = await seedPendingEnvios(suite.db, { count: 2 });
    const independent = await seedSecondChain(suite.db, blocked, 3);
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set proximo_intento_en = ${RETRY_AT.toISOString()}
        where registro_id = ${blocked.registroIds[0]}
      `),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.recordsSubmitted).toBe(1);
    expect(aeat.stored().map((row) => row.refExterna)).toEqual([independent.registroId]);
    expect(result.nextDueAt).toEqual(new Date("2026-07-21T00:02:00Z"));
  });

  it("wakes after an in-flight predecessor can be recovered", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${NOW.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + RECUPERACION_ENVIANDO_MS + 1));
    expect(aeat.stored()).toHaveLength(0);
  });

  it("does not borrow another chain's accepted original to release a cancellation", async () => {
    const first = await seedPendingEnvios(suite.db, { count: 1 });
    const other = await seedSecondChain(suite.db, first, 3);
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(aeat.client()),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production" as const,
    };
    const initial = await drain(deps, NOW);
    expect(initial.recordsAccepted).toBe(2);
    const records = await suite.db.select().from(registrosFacturacion);
    const original = records.find((row) => row.id === first.registroIds[0])!;
    const foreign = records.find((row) => row.id === other.registroId)!;
    const cancellationId = newId();
    await suite.db.insert(registrosFacturacion).values({
      ...foreign,
      id: cancellationId,
      secuencia: foreign.secuencia + 1,
      tipoRegistro: "anulacion",
      idEmisorFactura: original.idEmisorFactura,
      numSerieFactura: original.numSerieFactura,
      fechaExpedicionFactura: original.fechaExpedicionFactura,
      tipoFactura: null,
      descripcionOperacion: null,
      desglose: null,
      cuotaTotal: null,
      importeTotal: null,
      primerRegistro: false,
      anteriorIdEmisorFactura: foreign.idEmisorFactura,
      anteriorNumSerieFactura: foreign.numSerieFactura,
      anteriorFechaExpedicionFactura: foreign.fechaExpedicionFactura,
      anteriorHuella: foreign.huella,
      huella: "C".repeat(64),
    });
    await suite.db.insert(envios).values({ registroId: cancellationId, proximoIntentoEn: NOW });

    const retry = await drain(deps, new Date("2026-07-21T00:02:00Z"));

    expect(retry.recordsSubmitted).toBe(0);
    const state = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id = ${cancellationId}
    `);
    expect(state.rows[0]?.estado).toBe("pendiente");
    expect(aeat.stored().find((row) => row.key === first.facturaKeys[0])?.estado).toBe("Correcto");
  });
});
