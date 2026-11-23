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
import { fiscalHoldings } from "./handover-holdings.js";
import { VERIFACTU_HANDOVER } from "./handover-summary.js";
import { fiscalUnreturned } from "./handover-unreturned.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function append(node: SeededNode, invoiceNumber: number) {
  const sale = await seedSale(suite.db, node, invoiceNumber);
  const written = await suite.db.transaction((tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, sale, invoiceNumber, invoiceNumber % 60)),
  );
  return { sale, ...written };
}

async function copy(): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), "waitron-handover-unreturned-"));
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

function created(registroId: string): string {
  const [row] = suite.db.all<{ creado_en: string }>(
    sql`select creado_en from verifactu_records where id = ${registroId}`,
  );
  return row!.creado_en;
}

function chainIds(node: SeededNode) {
  const [row] = suite.db.all<{ id_sistema_informatico: string; numero_instalacion: string }>(
    sql`select id_sistema_informatico, numero_instalacion from verifactu_identities
        where id = ${node.sifId}`,
  );
  return {
    nodeId: node.nodeId,
    sifId: node.sifId,
    idSistemaInformatico: row!.id_sistema_informatico,
    numeroInstalacion: row!.numero_instalacion,
  };
}

describe("fiscalUnreturned", () => {
  it("lists records after the main box's last matching one, or the whole chain when the summaries disagree", async () => {
    const own = await seedNode(suite.db, "Own");
    const rehashed = await seedNode(suite.db, "Rehashed");
    const gapped = await seedNode(suite.db, "Gapped");
    const same = await seedNode(suite.db, "Same");
    const ownRecords: Awaited<ReturnType<typeof append>>[] = [];
    for (let n = 1; n <= 6; n++) ownRecords.push(await append(own, n));
    const rehashedRecord = await append(rehashed, 101);
    const gappedRecords = [await append(gapped, 201), await append(gapped, 202)];
    await append(same, 301);
    const mainHoldings = (await reading(await copy(), fiscalHoldings)).map((holding) => {
      if (holding.nodeId === rehashed.nodeId) return { ...holding, huella: "F".repeat(64) };
      if (holding.nodeId === gapped.nodeId) return { ...holding, count: holding.count - 1 };
      return holding;
    });

    for (let n = 7; n <= 9; n++) ownRecords.push(await append(own, n));
    const cancelled = await suite.db.transaction((tx) =>
      appendToChain(tx, own.nodeId, anulacionFor(own, ownRecords[8]!.sale, 9, 59)),
    );
    await suite.db
      .insert(verifactuSubmissions)
      .values({ registroId: ownRecords[6]!.id, estado: "aceptado" });
    const lacked = await seedNode(suite.db, "Lacked");
    const lackedRecord = await append(lacked, 401);

    const unreturned = await reading(await copy(), (query) =>
      fiscalUnreturned(query, mainHoldings as unknown as CanonicalValue),
    );

    const listed = (
      record: { sale: string; id: string; secuencia: number },
      filingState: string | null = null,
    ) => ({
      saleId: record.sale,
      number: record.secuencia,
      type: "issue",
      createdAt: created(record.id),
      filingState,
    });
    const byNode = new Map(unreturned.map((chain) => [chain.ids.nodeId, chain]));
    expect(byNode.get(own.nodeId)).toEqual({
      ids: chainIds(own),
      whole: false,
      records: [
        listed(ownRecords[6]!, "aceptado"),
        listed(ownRecords[7]!),
        listed(ownRecords[8]!),
        {
          saleId: ownRecords[8]!.sale,
          number: 10,
          type: "cancellation",
          createdAt: created(cancelled.id),
          filingState: null,
        },
      ],
    });
    expect(byNode.get(lacked.nodeId)).toEqual({
      ids: chainIds(lacked),
      whole: true,
      records: [listed(lackedRecord)],
    });
    expect(byNode.get(rehashed.nodeId)).toEqual({
      ids: chainIds(rehashed),
      whole: true,
      records: [listed(rehashedRecord)],
    });
    expect(byNode.get(gapped.nodeId)).toEqual({
      ids: chainIds(gapped),
      whole: true,
      records: gappedRecords.map((record) => listed(record)),
    });
    expect(byNode.has(same.nodeId)).toBe(false);
    expect(unreturned).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(unreturned))).toEqual(unreturned);
  });

  it("lists nothing when the main box holds every chain whole", async () => {
    const node = await seedNode(suite.db, "Held");
    await append(node, 1);
    await append(node, 2);
    const path = await copy();
    const holdings = await reading(path, fiscalHoldings);

    expect(
      await reading(path, (query) =>
        fiscalUnreturned(query, holdings as unknown as CanonicalValue),
      ),
    ).toEqual([]);
  });

  it("lists a chain whole when the main box is ahead of this box on it, which this box cannot check", async () => {
    const node = await seedNode(suite.db, "Ahead");
    const first = await append(node, 1);
    const path = await copy();
    const [holding] = await reading(path, fiscalHoldings);
    const ahead = { ...holding!, secuencia: holding!.secuencia + 1, count: holding!.count + 1 };

    const unreturned = await reading(path, (query) =>
      fiscalUnreturned(query, [ahead] as unknown as CanonicalValue),
    );

    expect(unreturned.map((chain) => [chain.whole, chain.records.map((r) => r.saleId)])).toEqual([
      [true, [first.sale]],
    ]);
  });

  it("refuses main-box holdings that are not a list of chains", async () => {
    const path = await copy();
    for (const holdings of [{ holdings: [] }, ["not a chain"]] as CanonicalValue[]) {
      const refusal = reading(path, (query) => fiscalUnreturned(query, holdings));
      await expect(refusal).rejects.toBeInstanceOf(MalformedHoldingsError);
    }
  });

  it("fills the contract's unreturned seat", async () => {
    const node = await seedNode(suite.db, "Seat");
    await append(node, 1);
    const path = await copy();
    expect(await reading(path, (query) => VERIFACTU_HANDOVER.unreturned!(query, []))).toEqual(
      await reading(path, (query) => fiscalUnreturned(query, [])),
    );
  });
});
