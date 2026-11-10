import type { Query } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { newId, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { saleId as brandSaleId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { readDeviceReceiptEvidence } from "./device-receipt-evidence.js";
import { openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { applyAbsentOriginalCancellation } from "./record-remedy-absent.js";
import { envios } from "./schema/envios.js";
import { altaFor, seedNode, seedSale } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

// Every statement, raw or built, reaches SQLite through the session's `prepareQuery`.
type Session = {
  prepareQuery(query: Query, ...rest: unknown[]): { all(): unknown };
};

function sessionOf(tx: Transaction): Session {
  return (tx as unknown as { session: Session }).session;
}

const BY_SALE = /sale_id"? (= \?|in \()/;

/** The plan of the one statement `read` sends that filters by sale id. */
async function planOf(read: (tx: Transaction) => Promise<unknown>): Promise<string[]> {
  return withTransaction(suite.db, async (tx) => {
    const session = sessionOf(tx);
    const prepare = vi.spyOn(session, "prepareQuery");
    let sent: Query[];
    try {
      await read(tx);
      sent = prepare.mock.calls.map(([query]) => query).filter((query) => BY_SALE.test(query.sql));
    } finally {
      prepare.mockRestore();
    }
    expect(sent).toHaveLength(1);
    const [query] = sent;
    const rows = session
      .prepareQuery(
        { sql: `explain query plan ${query!.sql}`, params: query!.params },
        undefined,
        "all",
        false,
      )
      .all() as { detail: string }[];
    return rows.map((row) => row.detail);
  });
}

function backend(): VerifactuBackend {
  return new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
}

describe("reads of a sale's filed alta", () => {
  it("finds the receipt's alta through the sale index", async () => {
    const plan = await planOf((tx) => backend().filedReceiptFor(tx, brandSaleId(newId())));
    expect(plan).toEqual([
      "SEARCH registros_facturacion USING INDEX registros_sale_idx (sale_id=?)",
    ]);
  });

  it("finds the device receipt's evidence through the sale index", async () => {
    const plan = await planOf((tx) => readDeviceReceiptEvidence(tx, brandSaleId(newId())));
    expect(plan).toEqual([
      "SEARCH registros_facturacion USING INDEX registros_sale_idx (sale_id=?)",
    ]);
  });

  it("finds each sale's filed figures through the sale index", async () => {
    const plan = await planOf((tx) => backend().filedFiguresFor(tx, [brandSaleId(newId())]));
    expect(plan).toEqual([
      "SEARCH r USING INDEX registros_sale_idx (sale_id=?)",
      "SEARCH e USING INDEX sqlite_autoindex_envios_1 (registro_id=?) LEFT-JOIN",
    ]);
  });

  it("finds the alta a void cancels through the sale index", async () => {
    const node = await seedNode(suite.db);
    const plan = await planOf((tx) =>
      expect(
        backend().recordVoid(tx, brandSaleId(newId()), "staff error", node.nodeId),
      ).rejects.toMatchObject({ code: "fiscal.sale_not_recorded" }),
    );
    expect(plan).toEqual([
      "SEARCH registros_facturacion USING INDEX registros_sale_idx (sale_id=?)",
    ]);
  });

  it("finds the alta an absent-original cancellation takes its origin from through the sale index", async () => {
    registerModulePermissions(FISCAL_PERMISSIONS);
    const node = await seedNode(suite.db);
    const now = new Date("2026-07-20T17:20:35Z");
    const saleId = await seedSale(suite.db, node, 1);
    const { token, request } = await withTransaction(suite.db, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Administrator", role: "admin", pinHash: hashPin("2468") })
        .returning();
      const original = await appendToChain(
        tx,
        node.nodeId,
        altaFor(node, saleId, 1, 1, "preproduction"),
      );
      await tx
        .insert(envios)
        .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
      const filingCase = await openFilingCase(tx, {
        registroId: original.id,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now,
      });
      return {
        token: (await startManagementSession(tx, { personId: person!.id })).token,
        request: {
          kind: "absent-original-cancellation",
          caseId: filingCase.id,
          registroId: original.id,
          actionKey: "absent-1",
          reason: "Explicit synthetic absent-original decision",
        },
      };
    });
    const generation = {
      nodeId: node.nodeId,
      environment: "preproduction" as const,
      clock: {
        ...steadyClock,
        now: () => ({ ...steadyClock.now(), instant: now, offsetMinutes: -300 }),
      },
      requireWritable: () => {},
    };
    const plan = await planOf((tx) =>
      applyAbsentOriginalCancellation(
        tx,
        generation,
        token,
        new Set(["absent-original-cancellation"]),
        request,
      ),
    );
    expect(plan).toEqual([
      "SEARCH registros_facturacion USING INDEX registros_sale_idx (sale_id=?)",
    ]);
  });
});
