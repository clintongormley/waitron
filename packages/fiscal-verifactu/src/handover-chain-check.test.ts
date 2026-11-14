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
import { validate, verifyHuella } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { checkFiscalChains } from "./handover-chain-check.js";
import { VERIFACTU_HANDOVER } from "./handover-summary.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function append(node: SeededNode, number: number) {
  const sale = await seedSale(suite.db, node, number);
  const [sif] = suite.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from registro_sif where node_id = ${node.nodeId} and revocado_en is null`,
  );
  const pending = altaFor(node, sale, number, number);
  pending.input.SistemaInformatico = {
    ...pending.input.SistemaInformatico,
    IDOtro: undefined,
    NIF: sif!.nif,
    NumeroInstalacion: sif!.numero_instalacion,
  };
  if (pending.tipo === "alta") {
    pending.input.IDEmisorFactura = sif!.nif;
    pending.input.NumSerieFactura = `${node.nodeId}/${number}`;
    pending.input.DescripcionOperacion = "Fixture meal";
  }
  return suite.db.transaction((tx) => appendToChain(tx, node.nodeId, pending));
}

async function twoChains() {
  for (const name of ["First", "Second"]) {
    const node = await seedNode(suite.db, name);
    for (const number of [1, 2, 3]) await append(node, number);
  }
}

async function copy(): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), "waitron-handover-chain-check-"));
  const target = join(directory, `copy-${Date.now()}-${Math.random()}.db`);
  await archiveTo(suite.db, target);
  return target;
}

function damage(path: string, statement: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec("pragma foreign_keys = off");
    const triggers = db.prepare("select name from sqlite_schema where type = 'trigger'").all() as {
      name: string;
    }[];
    for (const trigger of triggers) db.exec(`drop trigger "${trigger.name.replaceAll('"', '""')}"`);
    db.exec(statement);
  } finally {
    db.close();
  }
}

async function check(path: string) {
  const opened = await openBackupQuery(path);
  try {
    return await checkFiscalChains(opened.query);
  } finally {
    await opened.close();
  }
}

function digest(path: string) {
  const hash = createHash("sha256");
  for (const file of [path, `${path}-wal`, `${path}-shm`])
    hash.update(existsSync(file) ? readFileSync(file) : "absent");
  return hash.digest("hex");
}

describe("checkFiscalChains", () => {
  it("an intact copy of two chains is ok", async () => {
    await twoChains();
    expect(await check(await copy())).toBe("ok");
  });

  it("one record's importe_total changed in the copy is broken", async () => {
    await twoChains();
    const unchanged = await copy();
    const changed = await copy();
    damage(
      changed,
      "update registros_facturacion set importe_total = printf('%.2f', importe_total + 1) where secuencia = 2 and node_id = (select min(node_id) from registros_facturacion)",
    );
    expect(await check(unchanged)).toBe("ok");
    expect(await check(changed)).toBe("broken");
    const db = new DatabaseSync(changed, { readOnly: true });
    try {
      const raw = db
        .prepare(
          "select * from registros_facturacion where secuencia = 2 and node_id = (select min(node_id) from registros_facturacion)",
        )
        .get();
      const row = decodeRegistroRow(raw!);
      const rebuilt = fromRegistroRow(row);
      expect(
        validate(rebuilt, { now: row.fecha_hora_huso_gen_registro }).filter(
          (issue) => issue.severity === "error",
        ),
      ).toEqual([]);
      expect(verifyHuella(rebuilt)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("one record removed from the middle of a chain is broken", async () => {
    await twoChains();
    const unchanged = await copy();
    const shortened = await copy();
    damage(
      shortened,
      "delete from registros_facturacion where secuencia = 2 and node_id = (select min(node_id) from registros_facturacion)",
    );
    expect(await check(unchanged)).toBe("ok");
    expect(await check(shortened)).toBe("broken");
  });

  it("a copy without the fiscal tables is broken, and one with empty tables is ok", async () => {
    const empty = await copy();
    const dropped = await copy();
    damage(
      dropped,
      "drop table registros_facturacion; drop table registro_sif; drop table cadenas;",
    );
    expect(await check(empty)).toBe("ok");
    expect(await check(dropped)).toBe("broken");
  });

  it.each(["registros_facturacion", "registro_sif", "cadenas", "nodes"])(
    "a populated copy missing %s is broken",
    async (table) => {
      await twoChains();
      const path = await copy();
      damage(path, `drop table "${table}"`);
      expect(await check(path)).toBe("broken");
    },
  );

  it("an empty copy missing nodes is broken", async () => {
    const path = await copy();
    damage(path, "drop table nodes");
    expect(await check(path)).toBe("broken");
  });

  it("reads only", async () => {
    await twoChains();
    const path = await copy();
    const before = digest(path);
    expect(await check(path)).toBe("ok");
    expect(digest(path)).toBe(before);
  });

  it("is the Veri*Factu module's copy check", () => {
    expect(VERIFACTU_HANDOVER.checkCopy).toBe(checkFiscalChains);
  });
});
