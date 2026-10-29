import { seedFixtureSif } from "../test/sif-fixture.js";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { NodeId } from "@waitron/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { registroSif } from "./schema/sif.js";
import { FISCAL_SLOT } from "./slot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;

beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTenants(db);
});

function installationStartedAt(nodeId: NodeId): Promise<Date | null> {
  return withTransaction(db, (tx) => FISCAL_SLOT.installationStartedAt!(tx, nodeId));
}

async function insertSif(row: {
  numeroInstalacion: string;
  registradoEn: Date;
  revocadoEn: Date | null;
}): Promise<void> {
  await db.insert(registroSif).values({ ...SIF, nodeId: TENANT_A.nodeId, ...row });
}

describe("FISCAL_SLOT.installationStartedAt", () => {
  it("answers when the node's live identity was registered", async () => {
    const sif = await withTransaction(db, (tx) =>
      seedFixtureSif(tx, { ...SIF, nodeId: TENANT_A.nodeId }),
    );

    expect(await installationStartedAt(TENANT_A.nodeId)).toEqual(sif.registradoEn);
  });

  it("after a restore, answers the live identity's time, never the revoked earlier one's", async () => {
    await insertSif({
      numeroInstalacion: "S000001",
      registradoEn: new Date("2026-09-01T08:00:00.000Z"),
      revocadoEn: new Date("2026-10-01T09:00:00.000Z"),
    });
    await insertSif({
      numeroInstalacion: "P000042",
      registradoEn: new Date("2026-10-01T09:00:00.000Z"),
      revocadoEn: null,
    });

    expect(await installationStartedAt(TENANT_A.nodeId)).toEqual(
      new Date("2026-10-01T09:00:00.000Z"),
    );
  });

  it("answers the live identity's time even when a revoked row was registered later", async () => {
    await insertSif({
      numeroInstalacion: "S000001",
      registradoEn: new Date("2026-09-01T08:00:00.000Z"),
      revocadoEn: null,
    });
    await insertSif({
      numeroInstalacion: "P000042",
      registradoEn: new Date("2026-10-01T09:00:00.000Z"),
      revocadoEn: new Date("2026-10-01T09:00:00.000Z"),
    });

    expect(await installationStartedAt(TENANT_A.nodeId)).toEqual(
      new Date("2026-09-01T08:00:00.000Z"),
    );
  });

  it("answers null when the node has no live identity", async () => {
    await insertSif({
      numeroInstalacion: "S000001",
      registradoEn: new Date("2026-09-01T08:00:00.000Z"),
      revocadoEn: new Date("2026-10-01T09:00:00.000Z"),
    });

    expect(await installationStartedAt(TENANT_A.nodeId)).toBeNull();
  });

  it("rethrows a failure that is not a missing identity", async () => {
    const failure = new Error("disk I/O error");
    const tx = {
      select: () => {
        throw failure;
      },
    } as unknown as Transaction;

    await expect(FISCAL_SLOT.installationStartedAt!(tx, TENANT_A.nodeId)).rejects.toBe(failure);
  });
});
