import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleId } from "@waitron/shared";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { appendToChain } from "./chain.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import {
  altaFor,
  anulacionFor,
  seedNode,
  seedSale,
  TEST_NIF,
  type SeededNode,
} from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const NEXT = new Date("2026-07-21T00:02:00Z");
let node: SeededNode;
let saleId: SaleId;

beforeEach(async () => {
  node = await seedNode(suite.db);
  saleId = await seedSale(suite.db, node, 1);
});

async function version(position: number, estado: string, correctsRegistroId?: string) {
  const pending = altaFor(node, saleId, 1, position, "preproduction");
  return withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(tx, node.nodeId, {
      ...pending,
      correctsRegistroId,
      input: {
        ...pending.input,
        ...(correctsRegistroId === undefined ? {} : { Subsanacion: "S" as const }),
        DescripcionOperacion: `Restaurant service version ${position}`,
      },
    });
    await tx.insert(envios).values({
      registroId: record.id,
      estado,
      intentos: estado === "pendiente" ? 0 : 1,
      proximoIntentoEn: NOW,
      enviadoEn: estado === "enviando" ? NOW : null,
    });
    return record.id;
  });
}

async function cancellation() {
  return withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(
      tx,
      node.nodeId,
      anulacionFor(node, saleId, 1, 4, "preproduction"),
    );
    await tx.insert(envios).values({ registroId: record.id, proximoIntentoEn: NOW });
    return record.id;
  });
}

async function laterSale() {
  const later = await seedSale(suite.db, node, 2);
  return withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, later, 2, 5, "preproduction"),
    );
    await tx.insert(envios).values({ registroId: record.id, proximoIntentoEn: NOW });
    return record.id;
  });
}

async function sending(versions: string[]) {
  const aeat = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
  const client = aeat.client();
  for (const id of versions) {
    const raw = await suite.db.execute(sql`select * from registros_facturacion where id = ${id}`);
    const record = fromRegistroRow(decodeRegistroRow(raw.rows[0]!)) as RegistroAlta;
    const response = await client.submit(
      { ObligadoEmision: { NIF: TEST_NIF, NombreRazon: "Waitron SL" } },
      [{ RegistroAlta: { ...record, RefExterna: id } }],
    );
    expect(response.RespuestaLinea.map((line) => line.EstadoRegistro)).toEqual(["Correcto"]);
  }
  const sent: string[][] = [];
  const recorded: VerifactuClient = {
    submit: (header, records) => {
      sent.push(
        records.map(
          (record) =>
            ("RegistroAlta" in record ? record.RegistroAlta : record.RegistroAnulacion).RefExterna!,
        ),
      );
      return client.submit(header, records);
    },
    consultar: (...args) => client.consultar(...args),
  };
  return {
    sent,
    deps: {
      db: suite.db,
      environment: "preproduction" as const,
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: staticResolver(recorded),
    },
  };
}

async function state(id: string) {
  const [row] = await suite.db.select().from(envios).where(eq(envios.registroId, id));
  return row!;
}

async function immutableRows() {
  return suite.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
}

it.each(["aceptado", "aceptado_con_errores"])(
  "sends a cancellation when the current version is %s despite two older rejections",
  async (latestState) => {
    const original = await version(1, "rechazado");
    const first = await version(2, "rechazado", original);
    const latest = await version(3, latestState, first);
    const cancel = await cancellation();
    const before = await immutableRows();
    const wire = await sending([original, first, latest]);

    const result = await drain(wire.deps, NOW);

    expect(wire.sent).toEqual([[cancel]]);
    expect((await state(cancel)).estado).toBe("aceptado");
    expect((await state(original)).estado).toBe("rechazado");
    expect((await state(first)).estado).toBe("rechazado");
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);
    expect((await suite.db.execute(sql`select * from filing_cases`)).rows).toEqual([]);
    expect(await immutableRows()).toEqual(before);
  },
);

it("sets aside a cancellation of the rejected current version despite two older acceptances", async () => {
  const original = await version(1, "aceptado");
  const first = await version(2, "aceptado", original);
  const latest = await version(3, "rechazado", first);
  const cancel = await cancellation();
  const later = await laterSale();
  const before = await immutableRows();
  const wire = await sending([original, first]);

  const result = await drain(wire.deps, NOW);

  expect(wire.sent).toEqual([[later]]);
  expect((await state(cancel)).estado).toBe("retenido");
  expect((await state(latest)).estado).toBe("rechazado");
  expect(result.recordsHalted).toBe(1);
  expect((await suite.db.execute(sql`select registro_id, cause from filing_cases`)).rows).toEqual([
    { registro_id: cancel, cause: "fiscal.anulacion_retenida" },
  ]);
  expect(await immutableRows()).toEqual(before);
});

it.each(["aceptado", "rechazado"])(
  "waits for the pending current version before cancellation and its successor (old state: %s)",
  async (oldState) => {
    const original = await version(1, oldState);
    const first = await version(2, oldState, original);
    const latest = await version(3, "pendiente", first);
    const cancel = await cancellation();
    const later = await laterSale();
    const before = await immutableRows();
    const wire = await sending([original, first]);

    await drain(wire.deps, NOW);

    expect(wire.sent).toEqual([[latest]]);
    expect((await state(latest)).estado).toBe("aceptado");
    expect((await state(cancel)).estado).toBe("pendiente");
    expect((await state(cancel)).intentos).toBe(0);
    expect((await state(later)).estado).toBe("pendiente");
    expect((await state(later)).intentos).toBe(0);
    expect((await suite.db.execute(sql`select * from filing_cases`)).rows).toEqual([]);

    await drain(wire.deps, NEXT);

    expect(wire.sent).toEqual([[latest], [cancel, later]]);
    expect((await state(cancel)).estado).toBe("aceptado");
    expect((await state(later)).estado).toBe("aceptado");
    expect(await immutableRows()).toEqual(before);
  },
);

it("keeps a brake-held cancellation held when the current version is unknown and an old version was refused", async () => {
  const original = await version(1, "rechazado");
  const first = await version(2, "aceptado", original);
  const latest = await version(3, "enviando", first);
  const cancel = await cancellation();
  const later = await laterSale();
  await suite.db.update(envios).set({ estado: "detenido" }).where(eq(envios.registroId, cancel));
  const before = await immutableRows();
  const wire = await sending([original, first]);

  await drain(wire.deps, NOW);

  expect(wire.sent).toEqual([]);
  expect((await state(latest)).estado).toBe("enviando");
  expect((await state(cancel)).estado).toBe("detenido");
  expect((await state(later)).estado).toBe("pendiente");
  expect((await state(later)).intentos).toBe(0);
  expect((await suite.db.execute(sql`select * from filing_cases`)).rows).toEqual([]);
  expect(await immutableRows()).toEqual(before);
});
