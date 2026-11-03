import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { archiveTo, openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { summariseChains, VERIFACTU_HANDOVER, type ChainSummary } from "./handover-summary.js";
import { registerSif } from "./registro-sif.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function append(node: SeededNode, invoiceNumber: number) {
  const sale = await seedSale(suite.db, node, invoiceNumber);
  return suite.db.transaction((tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, sale, invoiceNumber, invoiceNumber)),
  );
}

async function copy(): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), "waitron-handover-summary-"));
  const target = join(directory, `copy-${Date.now()}-${Math.random()}.db`);
  await archiveTo(suite.db, target);
  return target;
}

async function summarise(path?: string): Promise<ChainSummary[]> {
  const opened = await openBackupQuery(path ?? (await copy()));
  try {
    return await summariseChains(opened.query);
  } finally {
    await opened.close();
  }
}

function records(nodeId: string) {
  return suite.db.all<{ id: string; huella: string; secuencia: number; sif_id: string }>(
    sql`select id, huella, secuencia, sif_id from registros_facturacion where node_id = ${nodeId} order by secuencia`,
  );
}

const TIME = "2026-07-20T17:20:00.000Z";

async function envio(registroId: string, estado: string) {
  await suite.db.execute(
    sql`insert into envios (registro_id, estado, proximo_intento_en) values (${registroId}, ${estado}, ${TIME})`,
  );
}

async function ack(registroId: string, csv: string | null, state: string) {
  await suite.db.execute(
    sql`insert into acks (registro_id, submitted_at, csv, state) values (${registroId}, ${TIME}, ${csv}, ${state})`,
  );
  return [registroId, TIME, csv, state, null];
}

function acksHash(acks: (string | null)[][]) {
  const sorted = [...acks].sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function sifFields(sifId: string) {
  const [row] = suite.db.all<{ id_sistema_informatico: string; numero_instalacion: string }>(
    sql`select id_sistema_informatico, numero_instalacion from registro_sif where id = ${sifId}`,
  );
  return {
    idSistemaInformatico: row!.id_sistema_informatico,
    numeroInstalacion: row!.numero_instalacion,
  };
}

const noEnvios = {
  pendiente: 0,
  enviando: 0,
  aceptado: 0,
  aceptado_con_errores: 0,
  rechazado: 0,
  detenido: 0,
  retenido: 0,
};

describe("summariseChains", () => {
  it("two chains on two nodes are summarised apart, head by secuencia not invoice number", async () => {
    const first = await seedNode(suite.db, "First");
    const second = await seedNode(suite.db, "Second");
    await append(first, 9);
    await append(first, 3);
    await append(second, 20);
    await append(second, 11);
    await seedNode(suite.db, "Never traded");
    const [a1, a2] = records(first.nodeId);
    const [b1, b2] = records(second.nodeId);
    await envio(a1!.id, "aceptado");
    await envio(a2!.id, "enviando");
    await envio(b1!.id, "rechazado");
    await envio(b2!.id, "enviando");
    const ackA = await ack(a1!.id, "csv-first", "accepted");
    const ackB = await ack(b2!.id, null, "rejected");

    const summaries = await summarise();

    const expected = [
      {
        ...sifFields(first.sifId),
        nodeId: first.nodeId,
        sifId: first.sifId,
        count: 2,
        headRegistroId: a2!.id,
        headHuella: a2!.huella,
        envios: { ...noEnvios, aceptado: 1, enviando: 1 },
        acksSha256: acksHash([ackA]),
        enviandoIds: [a2!.id],
      },
      {
        ...sifFields(second.sifId),
        nodeId: second.nodeId,
        sifId: second.sifId,
        count: 2,
        headRegistroId: b2!.id,
        headHuella: b2!.huella,
        envios: { ...noEnvios, rechazado: 1, enviando: 1 },
        acksSha256: acksHash([ackB]),
        enviandoIds: [b2!.id],
      },
    ].sort((x, y) => (x.nodeId < y.nodeId ? -1 : 1));
    expect(a2!.secuencia).toBe(b2!.secuencia);
    expect(summaries).toEqual(expected);
    expect(typeof summaries[0]!.count).toBe("number");
    expect(JSON.parse(JSON.stringify(summaries))).toEqual(summaries);
  });

  it("a chain whose SIF was revoked and replaced is two entries", async () => {
    const node = await seedNode(suite.db, "Replaced");
    await append(node, 1);
    await append(node, 2);
    const replacement = await suite.db.transaction((tx) =>
      registerSif(tx, {
        nodeId: node.nodeId,
        nif: "89890001K",
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
      }),
    );
    await append(node, 3);
    const rows = records(node.nodeId);
    await envio(rows[0]!.id, "aceptado");
    await envio(rows[2]!.id, "enviando");
    const oldAck = await ack(rows[1]!.id, "csv-old", "accepted");
    const newAck = await ack(rows[2]!.id, null, "halted");

    const summaries = await summarise();

    const expected = [
      {
        ...sifFields(node.sifId),
        nodeId: node.nodeId,
        sifId: node.sifId,
        count: 2,
        headRegistroId: rows[1]!.id,
        headHuella: rows[1]!.huella,
        envios: { ...noEnvios, aceptado: 1 },
        acksSha256: acksHash([oldAck]),
        enviandoIds: [],
      },
      {
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
        nodeId: node.nodeId,
        sifId: replacement.id,
        count: 1,
        headRegistroId: rows[2]!.id,
        headHuella: rows[2]!.huella,
        envios: { ...noEnvios, enviando: 1 },
        acksSha256: acksHash([newAck]),
        enviandoIds: [rows[2]!.id],
      },
    ].sort((x, y) => (x.sifId < y.sifId ? -1 : 1));
    expect(rows.map((row) => row.sif_id)).toEqual([node.sifId, node.sifId, replacement.id]);
    expect(summaries).toEqual(expected);
  });

  it("counts every envio state, lists the ones being sent and hashes the acks", async () => {
    const node = await seedNode(suite.db, "States");
    const states = Object.keys(noEnvios);
    for (let i = 0; i < states.length + 1; i++) await append(node, i + 1);
    const rows = records(node.nodeId);
    const time = "2026-07-20T17:20:00.000Z";
    const estados = [...states, "enviando"];
    for (const [i, row] of rows.entries())
      await suite.db.execute(
        sql`insert into envios (registro_id, estado, proximo_intento_en) values (${row.id}, ${estados[i]!}, ${time})`,
      );
    await suite.db.execute(
      sql`insert into acks (registro_id, submitted_at, csv, state) values (${rows[2]!.id}, ${time}, 'csv-a', 'accepted')`,
    );
    await suite.db.execute(
      sql`insert into acks (registro_id, submitted_at, csv, state, delivered_at) values (${rows[0]!.id}, ${time}, null, 'rejected', ${time})`,
    );

    const [summary] = await summarise();

    expect(summary!.envios).toEqual({
      pendiente: 1,
      enviando: 2,
      aceptado: 1,
      aceptado_con_errores: 1,
      rechazado: 1,
      detenido: 1,
      retenido: 1,
    });
    expect(summary!.enviandoIds).toEqual([rows[1]!.id, rows[7]!.id].sort());
    const acked = [
      [rows[0]!.id, time, null, "rejected", time],
      [rows[2]!.id, time, "csv-a", "accepted", null],
    ].sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
    expect(summary!.acksSha256).toBe(
      createHash("sha256").update(JSON.stringify(acked)).digest("hex"),
    );

    await suite.db.execute(
      sql`update acks set state = 'halted' where registro_id = ${rows[2]!.id}`,
    );
    const [changed] = await summarise();
    expect(changed!.acksSha256).not.toBe(summary!.acksSha256);
  });

  it("refuses a copy holding an envio state it does not know", async () => {
    const node = await seedNode(suite.db, "Odd");
    await append(node, 1);
    const [row] = records(node.nodeId);
    await suite.db.execute(
      sql`insert into envios (registro_id, estado, proximo_intento_en) values (${row!.id}, 'pendiente', '2026-07-20T17:20:00.000Z')`,
    );
    const path = await copy();
    const db = new DatabaseSync(path);
    try {
      db.exec("pragma ignore_check_constraints = on");
      db.exec("update envios set estado = 'perdido'");
    } finally {
      db.close();
    }
    await expect(summarise(path)).rejects.toThrow(/perdido/);
  });

  it("adding one record changes count, head and huella", async () => {
    const node = await seedNode(suite.db, "Grows");
    await append(node, 1);
    const [before] = await summarise();
    await append(node, 2);
    const [after] = await summarise();
    expect(after!.count).toBe(before!.count + 1);
    expect(after!.headRegistroId).not.toBe(before!.headRegistroId);
    expect(after!.headHuella).not.toBe(before!.headHuella);
  });

  it("writes nothing", async () => {
    const node = await seedNode(suite.db, "Quiet");
    await append(node, 1);
    const path = await copy();
    const digest = () =>
      [path, `${path}-wal`, `${path}-shm`].map((file) =>
        existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null,
      );
    const before = digest();
    const summaries = await summarise(path);
    expect(summaries).toHaveLength(1);
    expect(digest()).toEqual(before);
    expect(before[0]).not.toBeNull();
  });

  it("is the module's handover summary", () => {
    expect(VERIFACTU_HANDOVER.summarise).toBe(summariseChains);
  });
});
