import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { computeHuella } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { registerSif } from "./registro-sif.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";
import { verifyBackupFiscalChains } from "./backup-verification-chain.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let directory: string | undefined;
let other: SeededTill;

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function append(till: SeededTill, number: number, kind = "alta") {
  const sale = await seedSale(suite.db, till, number);
  const [sif] = suite.db.all<{
    nif: string;
    numero_instalacion: string;
  }>(
    sql`select nif, numero_instalacion from registro_sif where node_id = ${till.nodeId} and revocado_en is null`,
  );
  const pending =
    kind === "void"
      ? anulacionFor(till, sale, number - 1, number)
      : altaFor(till, sale, number, number);
  pending.input.SistemaInformatico = {
    ...pending.input.SistemaInformatico,
    IDOtro: undefined,
    NIF: sif!.nif,
    NumeroInstalacion: sif!.numero_instalacion,
  };
  if (pending.tipo === "alta") {
    pending.input.NumSerieFactura = `${till.nodeId}/${number}`;
    pending.input.DescripcionOperacion = "Fixture meal";
    if (kind === "correction") {
      pending.input.TipoFactura = "R5";
      pending.input.TipoRectificativa = "I";
      pending.input.FacturasRectificadas = [
        {
          IDEmisorFactura: pending.input.IDEmisorFactura,
          NumSerieFactura: `${till.nodeId}/1`,
          FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
        },
      ];
    }
    if (kind === "substitution") {
      pending.input.TipoFactura = "F3";
      pending.input.FacturasSustituidas = [
        {
          IDEmisorFactura: pending.input.IDEmisorFactura,
          NumSerieFactura: `${till.nodeId}/1`,
          FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
        },
      ];
      pending.input.Destinatarios = {
        IDDestinatario: [{ NombreRazon: "Fixture customer", NIF: "89890001K" }],
      };
    }
  } else {
    pending.input.NumSerieFacturaAnulada = `${till.nodeId}/${number - 1}`;
  }
  return suite.db.transaction((tx) => appendToChain(tx, till.nodeId, pending));
}

async function reregister(till: SeededTill, installation: string) {
  const [sif] = suite.db.all<{ nif: string }>(
    sql`select nif from registro_sif where node_id = ${till.nodeId} and revocado_en is null`,
  );
  await suite.db.transaction((tx) =>
    registerSif(tx, {
      nodeId: till.nodeId,
      nif: sif!.nif,
      idSistemaInformatico: "WT",
      numeroInstalacion: installation,
    }),
  );
}

async function capture(populate = true, resetOther = false) {
  if (populate) {
    const first = await seedTill(suite.db, "Source");
    other = await seedTill(suite.db, "Inactive");
    for (const till of [first, other]) {
      await append(till, 1);
      await append(till, 2, "void");
      await append(till, 3, "correction");
      await append(till, 4, "substitution");
    }
    await reregister(other, "second");
    await append(other, 5);
    await append(other, 6);
    await reregister(first, "empty-current");
    if (resetOther) await reregister(other, "empty-next");
    await seedTill(suite.db, "Never traded");
  }
  directory = await mkdtemp(join(tmpdir(), "waitron-fiscal-backup-"));
  const [{ file }] = suite.db.all<{ file: string }>(sql`pragma database_list`);
  const source = new DatabaseSync(file!, { readOnly: true });
  try {
    await backup(source, join(directory, "before.db"));
    await backup(source, join(directory, "after.db"));
  } finally {
    source.close();
  }
}

function damage(side: "before" | "after", statement: string) {
  const db = new DatabaseSync(join(directory!, `${side}.db`));
  try {
    db.exec("pragma foreign_keys = off; pragma ignore_check_constraints = on");
    const triggers = db
      .prepare("select name, sql, tbl_name from sqlite_schema where type = 'trigger'")
      .all() as { name: string; sql: string; tbl_name: string }[];
    for (const trigger of triggers) db.exec(`drop trigger "${trigger.name.replaceAll('"', '""')}"`);
    db.exec(statement);
    for (const trigger of triggers)
      if (
        db
          .prepare("select name from sqlite_schema where type = 'table' and name = ?")
          .get(trigger.tbl_name)
      )
        db.exec(trigger.sql);
  } finally {
    db.close();
  }
}

function rehash(side: "before" | "after", keepPredecessorAt?: number) {
  const db = new DatabaseSync(join(directory!, `${side}.db`));
  try {
    const triggers = db
      .prepare("select name, sql from sqlite_schema where type = 'trigger'")
      .all() as { name: string; sql: string }[];
    for (const trigger of triggers) db.exec(`drop trigger "${trigger.name.replaceAll('"', '""')}"`);
    const rows = db
      .prepare("select * from registros_facturacion order by node_id, secuencia")
      .all();
    let previous: ReturnType<typeof decodeRegistroRow> | undefined;
    for (const raw of rows) {
      const row = decodeRegistroRow(raw);
      if (
        !row.primer_registro &&
        row.secuencia !== keepPredecessorAt &&
        previous?.node_id === row.node_id &&
        previous.sif_id === row.sif_id
      ) {
        row.anterior_id_emisor_factura = previous.id_emisor_factura;
        row.anterior_num_serie_factura = previous.num_serie_factura;
        row.anterior_fecha_expedicion_factura = previous.fecha_expedicion_factura;
        row.anterior_huella = previous.huella;
      }
      row.huella = computeHuella(fromRegistroRow(row));
      db.prepare(
        `update registros_facturacion set huella = ?, anterior_id_emisor_factura = ?,
        anterior_num_serie_factura = ?, anterior_fecha_expedicion_factura = ?, anterior_huella = ? where id = ?`,
      ).run(
        row.huella,
        row.anterior_id_emisor_factura,
        row.anterior_num_serie_factura,
        row.anterior_fecha_expedicion_factura,
        row.anterior_huella,
        row.id,
      );
      db.prepare("update cadenas set ultima_huella = ? where ultimo_registro_id = ?").run(
        row.huella,
        row.id,
      );
      previous = row;
    }
    for (const trigger of triggers) db.exec(trigger.sql);
  } finally {
    db.close();
  }
}

async function queries<T>(body: (a: BackupQuery, b: BackupQuery) => Promise<T>) {
  const a = await openBackupQuery(join(directory!, "before.db"));
  try {
    const b = await openBackupQuery(join(directory!, "after.db"));
    try {
      return await body(a.query, b.query);
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}
const verify = () => queries(verifyBackupFiscalChains);

describe("complete captured fiscal chains", () => {
  it("accepts genuine record kinds, retired segments and a reset empty current identity without writing", async () => {
    await capture();
    expect(await verify()).toBe(true);
    expect(await verify()).toBe(true);
  });

  it("accepts honestly empty fiscal history without creating identities or heads", async () => {
    await capture(false);
    expect(await verify()).toBe(true);
    await queries(async (a) => {
      const rows = [];
      for await (const row of a.rows("select * from cadenas")) rows.push(row);
      expect(rows).toEqual([]);
    });
  });

  it.each([
    [
      "old hashed content",
      "update registros_facturacion set importe_total = '999.99' where secuencia = 1",
    ],
    [
      "old hash",
      "update registros_facturacion set huella = '" + "F".repeat(64) + "' where secuencia = 1",
    ],
    [
      "predecessor issuer",
      "update registros_facturacion set anterior_id_emisor_factura = '00000000T' where secuencia = 3",
    ],
    [
      "predecessor number",
      "update registros_facturacion set anterior_num_serie_factura = 'other/1' where secuencia = 3",
    ],
    [
      "predecessor date",
      "update registros_facturacion set anterior_fecha_expedicion_factura = '2026-07-19' where secuencia = 3",
    ],
    [
      "predecessor hash",
      "update registros_facturacion set anterior_huella = '" +
        "E".repeat(64) +
        "' where secuencia = 3",
    ],
    ["sequence gap", "delete from registros_facturacion where secuencia = 2"],
    [
      "duplicate genesis",
      "update registros_facturacion set primer_registro = 1, anterior_id_emisor_factura = null, anterior_num_serie_factura = null, anterior_fecha_expedicion_factura = null, anterior_huella = null where secuencia = 3",
    ],
    ["missing head", "delete from cadenas"],
    ["lost tail", "delete from registros_facturacion where secuencia = 6"],
    ["head sequence", "update cadenas set secuencia = secuencia + 1"],
    [
      "head hash",
      "update cadenas set ultima_huella = 'wrong' where ultimo_registro_id is not null",
    ],
    ["half head", "update cadenas set ultima_huella = null where ultimo_registro_id is not null"],
    ["missing identity", "delete from registro_sif where revocado_en is not null"],
    [
      "wrong installation",
      "update registro_sif set numero_instalacion = 'other' where revocado_en is not null",
    ],
    [
      "wrong system identity",
      "update registro_sif set id_sistema_informatico = 'XX' where revocado_en is not null",
    ],
    [
      "wrong taxpayer identity",
      "update registro_sif set nif = '00000000T' where id = (select id from registro_sif where revocado_en is not null limit 1)",
    ],
    [
      "invalid record payload",
      "update registros_facturacion set desglose = '[]' where secuencia = 3",
    ],
    [
      "malformed JSON",
      "update registros_facturacion set sistema_informatico = '{' where secuencia = 1",
    ],
    [
      "invalid timestamp",
      "update registros_facturacion set fecha_hora_huso_gen_registro = 'invalid' where secuencia = 1",
    ],
    ["fractional sequence", "update registros_facturacion set secuencia = 1.5 where secuencia = 1"],
    ["invalid flag", "update registros_facturacion set primer_registro = 2 where secuencia = 1"],
    [
      "unknown record kind",
      "update registros_facturacion set tipo_registro = 'other' where secuencia = 1",
    ],
    ["missing current identity", "delete from registro_sif where revocado_en is null"],
    ["unsafe head", "update cadenas set secuencia = 9007199254740992"],
    ["negative head", "update cadenas set secuencia = -1"],
    [
      "wrong head pointer",
      "update cadenas set ultimo_registro_id = 'missing' where ultimo_registro_id is not null",
    ],
    [
      "offset out of range",
      "update registros_facturacion set offset_minutos = 841 where secuencia = 1",
    ],
    [
      "fractional offset",
      "update registros_facturacion set offset_minutos = 1.5 where secuencia = 1",
    ],
    ["malformed identity time", "update registro_sif set registrado_en = 'invalid'"],
    [
      "malformed retirement time",
      "update registro_sif set revocado_en = 'invalid' where revocado_en is not null",
    ],
    [
      "empty installation",
      "update registro_sif set numero_instalacion = '' where id = (select id from registro_sif limit 1)",
    ],
    ["orphan node", "delete from nodes"],
    [
      "orphan head",
      "insert into cadenas (node_id, secuencia, actualizado_en) values ('missing', 0, '2026-10-20T00:00:00Z')",
    ],
    [
      "duplicate sequence",
      "drop index registros_tenant_node_secuencia_uq; update registros_facturacion set secuencia = 2 where secuencia = 1",
    ],
    [
      "duplicate current identity",
      "drop index registro_sif_activo_uq; update registro_sif set revocado_en = null",
    ],
    [
      "non-text node",
      "update registro_sif set node_id = x'00ff' where id = (select id from registro_sif limit 1)",
    ],
    [
      "non-text identity",
      "update registro_sif set id = x'00ff' where id = (select id from registro_sif limit 1)",
    ],
    [
      "non-text identity field",
      "update registro_sif set nif = x'00ff' where id = (select id from registro_sif limit 1)",
    ],
    ["non-text registration time", "update registro_sif set registrado_en = x'00ff'"],
    [
      "non-text retirement time",
      "update registro_sif set revocado_en = x'00ff' where revocado_en is not null",
    ],
    [
      "non-text generation time",
      "update registros_facturacion set fecha_hora_huso_gen_registro = x'00ff' where secuencia = 1",
    ],
    [
      "unsafe captured integer",
      "update registros_facturacion set secuencia = 9007199254740992 where secuencia = 1",
    ],
    [
      "malformed system object",
      "update registros_facturacion set sistema_informatico = 'null' where secuencia = 1",
    ],
    ["all identities retired", "update registro_sif set revocado_en = '2026-10-20T00:00:00Z'"],
  ])("rejects %s even when both copies contain the same damage", async (_label, statement) => {
    await capture();
    expect(await verify()).toBe(true);
    for (const side of ["before", "after"] as const) damage(side, statement);
    expect(await verify()).toBe(false);
  });

  it.each(["before", "after"] as const)("walks %s independently", async (side) => {
    await capture();
    damage(side, "update registros_facturacion set importe_total = '999.99' where secuencia = 1");
    expect(await verify()).toBe(false);
  });

  it("preserves non-hashed record fields exactly", async () => {
    await capture();
    damage(
      "after",
      "update registros_facturacion set descripcion_operacion = 'Different valid meal' where secuencia = 3",
    );
    await queries(async (a, b) => {
      expect(await verifyBackupFiscalChains(b, b)).toBe(true);
      expect(await verifyBackupFiscalChains(a, b)).toBe(false);
    });
  });

  it("detects a shortened but independently valid target and head", async () => {
    await capture();
    const node = other.nodeId;
    damage(
      "after",
      `delete from registros_facturacion where node_id = '${node}' and secuencia = 6;
      update cadenas set secuencia = 5,
      ultimo_registro_id = (select id from registros_facturacion where node_id = '${node}' and secuencia = 5),
      ultima_huella = (select huella from registros_facturacion where node_id = '${node}' and secuencia = 5)
      where node_id = '${node}'`,
    );
    await queries(async (a, b) => {
      expect(await verifyBackupFiscalChains(b, b)).toBe(true);
      expect(await verifyBackupFiscalChains(a, b)).toBe(false);
    });
  });

  it("refuses a reset head when its current identity already traded", async () => {
    await capture();
    for (const side of ["before", "after"] as const)
      damage(side, "update cadenas set ultimo_registro_id = null, ultima_huella = null");
    expect(await verify()).toBe(false);
  });

  it("never invents a link across registrations", async () => {
    await capture();
    for (const side of ["before", "after"] as const)
      damage(
        side,
        "update registros_facturacion set primer_registro = 0, anterior_id_emisor_factura = '89890001K', anterior_num_serie_factura = 'invented', anterior_fecha_expedicion_factura = '2026-07-20', anterior_huella = '" +
          "F".repeat(64) +
          "' where secuencia = 5",
      );
    expect(await verify()).toBe(false);
  });

  it("rejects a second genesis even with all hashes rebuilt consistently", async () => {
    await capture();
    for (const side of ["before", "after"] as const) {
      damage(
        side,
        "update registros_facturacion set primer_registro = 1, anterior_id_emisor_factura = null, anterior_num_serie_factura = null, anterior_fecha_expedicion_factura = null, anterior_huella = null where secuencia = 3",
      );
      rehash(side);
    }
    expect(await verify()).toBe(false);
  });

  it("checks the predecessor hash even after recomputing subsequent record hashes", async () => {
    await capture();
    for (const side of ["before", "after"] as const) {
      damage(
        side,
        "update registros_facturacion set anterior_huella = '" +
          "E".repeat(64) +
          "' where secuencia = 3",
      );
      rehash(side, 3);
    }
    expect(await verify()).toBe(false);
  });

  it("rejects a cross-registration predecessor even with consistent hashes", async () => {
    await capture();
    for (const side of ["before", "after"] as const) {
      damage(
        side,
        `update registros_facturacion set primer_registro = 0,
        anterior_id_emisor_factura = (select id_emisor_factura from registros_facturacion where node_id = '${other.nodeId}' and secuencia = 4),
        anterior_num_serie_factura = (select num_serie_factura from registros_facturacion where node_id = '${other.nodeId}' and secuencia = 4),
        anterior_fecha_expedicion_factura = '2026-07-20',
        anterior_huella = (select huella from registros_facturacion where node_id = '${other.nodeId}' and secuencia = 4)
        where secuencia = 5`,
      );
      rehash(side);
    }
    expect(await verify()).toBe(false);
  });

  it("rejects a reset empty identity whose head points back to retired work", async () => {
    await capture();
    for (const side of ["before", "after"] as const)
      damage(
        side,
        `update cadenas set
        ultimo_registro_id = (select id from registros_facturacion where registros_facturacion.node_id = cadenas.node_id and secuencia = 4),
        ultima_huella = (select huella from registros_facturacion where registros_facturacion.node_id = cadenas.node_id and secuencia = 4)
        where ultimo_registro_id is null and secuencia = 4`,
      );
    expect(await verify()).toBe(false);
  });

  it("rejects reusing a retired segment after another retired segment", async () => {
    await capture(true, true);
    for (const side of ["before", "after"] as const) {
      damage(
        side,
        `update registros_facturacion set
        sif_id = (select sif_id from registros_facturacion where node_id = '${other.nodeId}' and secuencia = 1),
        sistema_informatico = (select sistema_informatico from registros_facturacion where node_id = '${other.nodeId}' and secuencia = 1),
        primer_registro = 1, anterior_id_emisor_factura = null, anterior_num_serie_factura = null,
        anterior_fecha_expedicion_factura = null, anterior_huella = null where secuencia = 6`,
      );
      rehash(side);
    }
    expect(await verify()).toBe(false);
  });

  it("rejects an invalid non-hashed payload even with valid hashes", async () => {
    await capture();
    for (const side of ["before", "after"] as const)
      damage(side, "update registros_facturacion set desglose = '[]' where secuencia = 3");
    expect(await verify()).toBe(false);
  });

  it("rejects an independently valid replacement history", async () => {
    await capture();
    damage(
      "after",
      "update registros_facturacion set importe_total = '123.46' where secuencia = 3",
    );
    rehash("after");
    await queries(async (a, b) => {
      expect(await verifyBackupFiscalChains(a, a)).toBe(true);
      expect(await verifyBackupFiscalChains(b, b)).toBe(true);
      expect(await verifyBackupFiscalChains(a, b)).toBe(false);
    });
  });

  it.each([
    ["identity", "update registro_sif set registrado_en = '2026-10-19T00:00:00Z'"],
    ["head", "update cadenas set actualizado_en = '2026-10-19T00:00:00Z'"],
  ])("preserves the complete captured %s rows", async (_name, statement) => {
    await capture();
    damage("after", statement);
    await queries(async (a, b) => {
      expect(await verifyBackupFiscalChains(b, b)).toBe(true);
      expect(await verifyBackupFiscalChains(a, b)).toBe(false);
    });
  });

  it("refuses invented valid target history for a source without fiscal tables", async () => {
    await capture();
    damage(
      "before",
      "drop table cadenas; drop table registros_facturacion; drop table registro_sif",
    );
    await queries(async (a, b) => {
      expect(await verifyBackupFiscalChains(b, b)).toBe(true);
      expect(await verifyBackupFiscalChains(a, b)).toBe(false);
    });
  });

  it.each(["registros_facturacion", "registro_sif", "cadenas"])(
    "refuses a partial schema missing %s",
    async (table) => {
      await capture(false);
      damage("before", `drop table "${table}"`);
      expect(await verify()).toBe(false);
    },
  );

  it("accepts a source without fiscal tables only when target tables remain empty", async () => {
    await capture(false);
    damage(
      "before",
      "drop table cadenas; drop table registros_facturacion; drop table registro_sif",
    );
    expect(await verify()).toBe(true);
    damage(
      "after",
      "insert into cadenas (node_id, secuencia, actualizado_en) values ('missing', 0, '2026-10-20T00:00:00Z')",
    );
    expect(await verify()).toBe(false);
  });

  it("refuses a target without captured fiscal tables", async () => {
    await capture(false);
    damage(
      "after",
      "drop table cadenas; drop table registros_facturacion; drop table registro_sif",
    );
    expect(await verify()).toBe(false);
  });

  it("keeps unexpected query failures distinct from invalid history", async () => {
    await capture(false);
    const unavailable: BackupQuery = {
      rows: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new Error("Fixture unavailable");
          },
        }),
      }),
    };
    await queries(async (a, b) => {
      await expect(verifyBackupFiscalChains(unavailable, b)).rejects.toThrow("Fixture unavailable");
      await expect(verifyBackupFiscalChains(a, unavailable)).rejects.toThrow("Fixture unavailable");
    });
  });
});
