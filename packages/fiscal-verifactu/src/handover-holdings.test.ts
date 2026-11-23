import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { CanonicalValue } from "@waitron/membership";
import { MalformedHoldingsError } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { archiveTo, openBackupQuery, type BackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { fiscalHoldings, fiscalLacking, type ChainHolding } from "./handover-holdings.js";
import { VERIFACTU_HANDOVER } from "./handover-summary.js";
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

/** Each copy is a database as it stood when copied, so two copies stand for two boxes. */
async function copy(): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), "waitron-handover-holdings-"));
  const target = join(directory, `copy-${Date.now()}-${Math.random()}.db`);
  await archiveTo(suite.db, target);
  return target;
}

async function reading<T>(path: string, read: (query: BackupQuery) => Promise<T>): Promise<T> {
  const opened = await openBackupQuery(path);
  try {
    return await read(opened.query);
  } finally {
    await opened.close();
  }
}

function last(nodeId: string, sifId: string) {
  const rows = suite.db.all<{ huella: string; secuencia: number }>(
    sql`select huella, secuencia from verifactu_records
        where node_id = ${nodeId} and sif_id = ${sifId} order by secuencia desc limit 1`,
  );
  return rows[0]!;
}

function sifFields(sifId: string) {
  const [row] = suite.db.all<{ id_sistema_informatico: string; numero_instalacion: string }>(
    sql`select id_sistema_informatico, numero_instalacion from verifactu_identities where id = ${sifId}`,
  );
  return {
    idSistemaInformatico: row!.id_sistema_informatico,
    numeroInstalacion: row!.numero_instalacion,
  };
}

function byChain<T extends { nodeId: string; sifId: string }>(list: T[]): T[] {
  return [...list].sort((x, y) =>
    x.nodeId === y.nodeId ? (x.sifId < y.sifId ? -1 : 1) : x.nodeId < y.nodeId ? -1 : 1,
  );
}

describe("fiscalHoldings", () => {
  it("lists every chain on a database holding two boxes' records, a replaced SIF apart", async () => {
    const first = await seedNode(suite.db, "First");
    const second = await seedNode(suite.db, "Second");
    await seedNode(suite.db, "Never traded");
    await append(first, 9);
    await append(first, 3);
    await append(second, 20);
    const replacement = await suite.db.transaction((tx) =>
      registerSif(tx, {
        nodeId: second.nodeId,
        nif: "89890001K",
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
      }),
    );
    await append(second, 21);
    await append(second, 22);

    const holdings = await reading(await copy(), fiscalHoldings);

    const entry = (node: SeededNode, sifId: string, count: number) => {
      const head = last(node.nodeId, sifId);
      return {
        nodeId: node.nodeId,
        sifId,
        ...sifFields(sifId),
        count,
        secuencia: head.secuencia,
        huella: head.huella,
      };
    };
    expect(holdings).toEqual(
      byChain([
        entry(first, first.sifId, 2),
        entry(second, second.sifId, 1),
        entry(second, replacement.id, 2),
      ]),
    );
    expect(holdings.find((h) => h.sifId === replacement.id)!.secuencia).toBe(3);
    expect(JSON.parse(JSON.stringify(holdings))).toEqual(holdings);
    expect(typeof holdings[0]!.count).toBe("number");
    expect(typeof holdings[0]!.secuencia).toBe("number");
  });

  it("lists nothing on a database with no records", async () => {
    await seedNode(suite.db, "Idle");
    expect(await reading(await copy(), fiscalHoldings)).toEqual([]);
  });
});

describe("fiscalLacking", () => {
  it("names a chain the other database lacks, a shorter one, one with another hash, and not an identical or longer one", async () => {
    const kept = await seedNode(suite.db, "Kept");
    const grown = await seedNode(suite.db, "Grown");
    const shorter = await seedNode(suite.db, "Shorter");
    const counted = await seedNode(suite.db, "Counted");
    const rehashed = await seedNode(suite.db, "Rehashed");
    await append(kept, 1);
    await append(grown, 2);
    await append(shorter, 3);
    await append(counted, 4);
    await append(counted, 5);
    await append(rehashed, 6);
    const earliestHoldings = await reading(await copy(), fiscalHoldings);
    await append(grown, 7);
    const early = await copy();
    const earlyHoldings = await reading(early, fiscalHoldings);

    await append(shorter, 8);
    const absent = await seedNode(suite.db, "Absent");
    await append(absent, 9);
    const late = await copy();
    const lateHoldings = await reading(late, fiscalHoldings);

    // The old box holds `late`, except that its Grown chain stopped before the main box's did.
    // Hand-edited holdings stand for an old box whose chain has the main box's last record but
    // more before it, and one whose record at that sequence was written differently.
    const edited = lateHoldings.map((holding) => {
      if (holding.nodeId === grown.nodeId)
        return earliestHoldings.find((h) => h.nodeId === grown.nodeId)!;
      if (holding.nodeId === counted.nodeId) return { ...holding, count: holding.count + 1 };
      if (holding.nodeId === rehashed.nodeId) return { ...holding, huella: "F".repeat(64) };
      return holding;
    });

    expect(edited.find((h) => h.nodeId === grown.nodeId)!.count).toBe(1);
    expect(earlyHoldings.find((h) => h.nodeId === grown.nodeId)!.count).toBe(2);
    const lacking = await reading(early, (query) => fiscalLacking(query, edited));

    const named = (node: SeededNode, reason: string) => ({
      nodeId: node.nodeId,
      sifId: node.sifId,
      ...sifFields(node.sifId),
      reason,
    });
    expect(byChain(lacking)).toEqual(
      byChain([
        named(shorter, "record_missing"),
        named(absent, "record_missing"),
        named(counted, "fewer_records"),
        named(rehashed, "hash_differs"),
      ]),
    );
    expect(lacking.map((l) => l.nodeId)).not.toContain(kept.nodeId);
    expect(lacking.map((l) => l.nodeId)).not.toContain(grown.nodeId);
    expect(JSON.parse(JSON.stringify(lacking))).toEqual(lacking);

    expect(await reading(late, (query) => fiscalLacking(query, earlyHoldings))).toEqual([]);
    expect(await reading(late, (query) => fiscalLacking(query, lateHoldings))).toEqual([]);
  });

  it("counts only the chain's own registration's records up to its last", async () => {
    const node = await seedNode(suite.db, "Reinstalled");
    await append(node, 1);
    await append(node, 2);
    const second = await suite.db.transaction((tx) =>
      registerSif(tx, {
        nodeId: node.nodeId,
        nif: "89890001K",
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
      }),
    );
    await append(node, 3);
    const path = await copy();
    const holdings = await reading(path, fiscalHoldings);
    const later = holdings.find((h) => h.sifId === second.id)!;
    expect(later).toMatchObject({ count: 1, secuencia: 3 });
    // An old box holding one more of the second registration's records before the last than this
    // database does; this database's two records under the first registration must not make up for it.
    const edited = holdings.map((h) => (h.sifId === second.id ? { ...h, count: 2 } : h));

    const lacking = await reading(path, (query) => fiscalLacking(query, edited));

    expect(lacking).toEqual([
      {
        nodeId: node.nodeId,
        sifId: second.id,
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
        reason: "fewer_records",
      },
    ]);
  });

  it("a record at that sequence of another SIF of the same box is not the chain's record", async () => {
    const node = await seedNode(suite.db, "Moved");
    await append(node, 1);
    const [holding] = await reading(await copy(), fiscalHoldings);
    const elsewhere = { ...holding!, sifId: "another-sif" };

    const lacking = await reading(await copy(), (query) => fiscalLacking(query, [elsewhere]));

    expect(lacking).toEqual([
      {
        nodeId: node.nodeId,
        sifId: "another-sif",
        ...sifFields(node.sifId),
        reason: "record_missing",
      },
    ]);
  });

  it("refuses holdings that are not a list of chains", async () => {
    const path = await copy();
    const good: ChainHolding = {
      nodeId: "n",
      sifId: "s",
      idSistemaInformatico: "WT",
      numeroInstalacion: "1",
      count: 1,
      secuencia: 1,
      huella: "A",
    };
    const bad: CanonicalValue[] = [
      { holdings: [] },
      ["not a chain"],
      [{ ...good, nodeId: 7 }],
      [{ ...good, count: 0 }],
      [{ ...good, secuencia: 1.5 }],
      [{ ...good, huella: null }],
    ];
    for (const holdings of bad) {
      const refusal = reading(path, (query) => fiscalLacking(query, holdings));
      await expect(refusal).rejects.toThrow("malformed fiscal holdings");
      await expect(refusal).rejects.toBeInstanceOf(MalformedHoldingsError);
    }
  });

  it("fills the contract's two seats", async () => {
    const node = await seedNode(suite.db, "Seats");
    await append(node, 1);
    const path = await copy();
    const holdings = await reading(path, (query) => VERIFACTU_HANDOVER.holdings!(query));
    expect(holdings).toEqual(await reading(path, fiscalHoldings));
    expect(await reading(path, (query) => VERIFACTU_HANDOVER.lacking!(query, holdings))).toEqual(
      [],
    );
  });
});
