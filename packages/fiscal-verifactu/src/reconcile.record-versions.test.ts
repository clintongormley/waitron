import { inArray, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleId } from "@waitron/shared";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { writeAck } from "./acks.js";
import { readActiveConflicts } from "./conflict-evidence.js";
import { appendToChain } from "./chain.js";
import { reconcile, type ReconcileDeps } from "./reconcile.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, seedNode, seedSale, TEST_NIF, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const PERIOD = { year: "2026", month: "07" };
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
      csv: estado === "aceptado" ? `CSV-${position}` : null,
      proximoIntentoEn: NOW,
    });
    await writeAck(tx, record.id, NOW);
    return record.id;
  });
}

async function authorityHolding(ids: string[]) {
  const aeat = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
  const client = aeat.client();
  for (const id of ids) {
    const raw = await suite.db.execute(sql`select * from registros_facturacion where id = ${id}`);
    const record = fromRegistroRow(decodeRegistroRow(raw.rows[0]!)) as RegistroAlta;
    const response = await client.submit(
      { ObligadoEmision: { NIF: TEST_NIF, NombreRazon: "Waitron SL" } },
      [{ RegistroAlta: { ...record, RefExterna: id } }],
    );
    expect(response.RespuestaLinea.map((line) => line.EstadoRegistro)).toEqual(["Correcto"]);
  }
  return { aeat, client };
}

function deps(client: VerifactuClient): ReconcileDeps {
  return {
    db: suite.db,
    resolveClient: staticResolver(client),
    clock: {
      ...steadyClock,
      now: () => ({ ...steadyClock.now(), instant: NOW, offsetMinutes: 120 }),
    },
  };
}

async function delivery(ids: string[]) {
  return suite.db
    .select()
    .from(envios)
    .where(inArray(envios.registroId, ids))
    .orderBy(envios.registroId);
}

async function acknowledgements() {
  return (await suite.db.execute(sql`select * from acks order by registro_id`)).rows;
}

async function immutableRows() {
  return suite.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
}

it("does not resubmit earlier versions when consulta holds only the second correction's reference", async () => {
  const original = await version(1, "aceptado");
  const first = await version(2, "aceptado", original);
  const latest = await version(3, "aceptado", first);
  const { client } = await authorityHolding([original, first, latest]);
  const before = await delivery([original, first, latest]);
  const acksBefore = await acknowledgements();
  const recordsBefore = await immutableRows();

  const result = await reconcile(deps(client), PERIOD);

  expect(await delivery([original, first, latest])).toEqual(before);
  expect(await acknowledgements()).toEqual(acksBefore);
  expect(result).toEqual({
    ...PERIOD,
    checked: 1,
    lostAck: [],
    noTrace: [],
    drift: [],
    incidentsRaised: 0,
  });
  expect(await immutableRows()).toEqual(recordsBefore);
});

it("recovers only the latest correction's lost acknowledgement and leaves older delivery facts intact", async () => {
  const original = await version(1, "aceptado");
  const first = await version(2, "aceptado", original);
  const latest = await version(3, "pendiente", first);
  const { client } = await authorityHolding([original, first, latest]);
  const older = await delivery([original, first]);
  const oldAcks = await acknowledgements();
  const recordsBefore = await immutableRows();

  const result = await reconcile(deps(client), PERIOD);

  expect(await delivery([original, first])).toEqual(older);
  expect(await acknowledgements()).toEqual(expect.arrayContaining(oldAcks));
  expect((await delivery([latest]))[0]).toMatchObject({ estado: "aceptado", csv: null });
  expect(result).toEqual({
    ...PERIOD,
    checked: 1,
    lostAck: [{ recordId: latest, localState: "pendiente", reportedState: "Correcto" }],
    noTrace: [],
    drift: [],
    incidentsRaised: 0,
  });
  expect(await immutableRows()).toEqual(recordsBefore);
});

it("still requeues the current correction when consulta has no trace of that version", async () => {
  const original = await version(1, "aceptado");
  const first = await version(2, "aceptado", original);
  const latest = await version(3, "aceptado", first);
  const { aeat, client } = await authorityHolding([original, first, latest]);
  aeat.forget(aeat.stored()[0]!.key);
  const older = await delivery([original, first]);
  const oldAcks = await acknowledgements();
  const recordsBefore = await immutableRows();

  const result = await reconcile(deps(client), PERIOD);

  expect(await delivery([original, first])).toEqual(older);
  expect((await delivery([latest]))[0]).toMatchObject({
    estado: "pendiente",
    csv: null,
    reconciledResubmitAt: NOW,
  });
  expect(await acknowledgements()).toEqual(oldAcks.filter((ack) => ack.registro_id !== latest));
  expect(result).toEqual({
    ...PERIOD,
    checked: 1,
    lostAck: [],
    noTrace: [{ recordId: latest, localState: "aceptado", reportedState: null }],
    drift: [],
    incidentsRaised: 0,
  });
  expect(await immutableRows()).toEqual(recordsBefore);
});

it("does not requeue a version superseded while the consulta request is in flight", async () => {
  const original = await version(1, "aceptado");
  const first = await version(2, "aceptado", original);
  const { client } = await authorityHolding([original, first]);
  const older = await delivery([original, first]);
  const acksBefore = await acknowledgements();
  let latest = "";
  const delayed: VerifactuClient = {
    submit: (...args) => client.submit(...args),
    consultar: async (...args) => {
      latest = await version(3, "pendiente", first);
      const raw = await suite.db.execute(
        sql`select * from registros_facturacion where id = ${latest}`,
      );
      const record = fromRegistroRow(decodeRegistroRow(raw.rows[0]!)) as RegistroAlta;
      const response = await client.submit(
        { ObligadoEmision: { NIF: TEST_NIF, NombreRazon: "Waitron SL" } },
        [{ RegistroAlta: { ...record, RefExterna: latest } }],
      );
      expect(response.RespuestaLinea.map((line) => line.EstadoRegistro)).toEqual(["Correcto"]);
      return client.consultar(...args);
    },
  };

  const result = await reconcile(deps(delayed), PERIOD);

  expect(latest).not.toBe("");
  expect(await delivery([original, first])).toEqual(older);
  expect(await acknowledgements()).toEqual(acksBefore);
  expect((await delivery([latest]))[0]).toMatchObject({ estado: "pendiente", intentos: 0 });
  expect(result.noTrace).toEqual([]);
  expect(result.lostAck).toEqual([]);
  expect(result.drift).toEqual([]);
  expect(result.incidentsRaised).toBe(0);
});

it("keeps a pending correction waiting when the lookup still holds its own earlier version", async () => {
  const original = await version(1, "aceptado");
  const latest = await version(2, "pendiente", original);
  const { client } = await authorityHolding([original]);
  const before = await delivery([original, latest]);
  const recordsBefore = await immutableRows();
  const result = await reconcile(
    {
      ...deps(client),
      scope: { nodeId: node.nodeId, taxpayerId: TEST_NIF, environment: "preproduction" },
    },
    PERIOD,
  );
  expect(result.conflicts ?? []).toEqual([]);
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, node.nodeId))).toEqual([]);
  expect(await delivery([original, latest])).toEqual(before);
  expect(await immutableRows()).toEqual(recordsBefore);
  expect((await suite.db.execute(sql`select * from fiscal_lookup_conflicts`)).rows).toEqual([]);
});
