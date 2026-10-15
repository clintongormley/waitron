import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { billPayments, invoiceSeries, nodes, printJobs, sales, withTransaction } from "@waitron/db";
import { payments } from "@waitron/payments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { FiscalBackend } from "@waitron/fiscal";
import { drain, DEFAULT_SKIP_RETRY_MS } from "@waitron/fiscal-verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { payWorkingOrder } from "./till-sale.js";
import { parkOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const emergency = "A-E00000000000000000000000001";
const short = "A-P000042";

async function venueWithOtherNode() {
  const v = await provisionBillVenue(suite.db);
  await withTransaction(v.db, async (tx) => {
    const [other] = await tx
      .insert(nodes)
      .values({
        locationId: v.cfg.locationId,
        name: "Other box",
      })
      .returning();
    await tx.insert(invoiceSeries).values({
      nodeId: other!.id,
      code: "OTHER-P999999",
      purpose: "standard",
      nextNumber: 99,
    });
  });
  return v;
}

async function activate(v: BillVenue, code: string) {
  return withTransaction(v.db, async (tx) => {
    await tx
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(
        and(
          eq(invoiceSeries.nodeId, v.cfg.nodeId),
          eq(invoiceSeries.purpose, "standard"),
          isNull(invoiceSeries.retiredAt),
        ),
      );
    const [row] = await tx
      .insert(invoiceSeries)
      .values({ nodeId: v.cfg.nodeId, code, purpose: "standard" })
      .returning();
    return row!;
  });
}

function deps(v: BillVenue, backend = v.backend) {
  return { db: v.db, clock: v.clock, backend };
}

async function issue(v: BillVenue, path: string, id: string, backend = v.backend) {
  const lines = [{ menuItemId: v.offerFor("Caña"), quantity: "1" }];
  if (path === "walk-up") {
    return payWorkingOrder(deps(v, backend), v.cfg, {
      id,
      zoneId: v.zoneId,
      lines,
      tender: { method: "cash", amount: "3.00" },
    });
  }
  if (path === "bill payment") {
    const result = await send(
      v.appTipsOff,
      v.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "3.00",
        method: "cash",
        tendered: "3.00",
        applied: "3.00",
        tip: "0.00",
      },
    );
    expect(result.status).toBe(200);
    return result.json;
  }
  if (path === "unpaid invoice") {
    await issueOrderInvoice(deps(v, backend), v.cfg, id, v.operatorId);
    return;
  }
  return payWorkingOrder(deps(v, backend), v.cfg, {
    id,
    lines: [],
    tender: { method: "cash", amount: "3.00" },
  });
}

async function prepare(v: BillVenue, path: string) {
  if (path === "bill payment") return tabWith(v, "Caña");
  const id = randomUUID();
  if (path !== "walk-up")
    await parkOrder(deps(v), v.cfg, {
      id,
      zoneId: v.zoneId,
      lines: [{ menuItemId: v.offerFor("Caña"), quantity: "1" }],
      operatorId: v.operatorId,
    });
  return id;
}

function records(v: BillVenue) {
  return v.db.all<{ id: string }>(sql`select * from registros_facturacion order by id`);
}

async function snapshot(v: BillVenue) {
  return {
    series: await v.db.select().from(invoiceSeries),
    sales: await v.db.select().from(sales),
    payments: await v.db.select().from(payments),
    billPayments: await v.db.select().from(billPayments),
    jobs: await v.db.select().from(printJobs),
    records: records(v),
    outbox: v.db.all(sql`select * from envios order by registro_id`),
    sif: v.db.all(sql`select * from registro_sif order by id`),
  };
}

describe("transactional active series qualification", () => {
  it.each(["walk-up", "held order", "unpaid invoice", "bill payment"])(
    "%s uses the explicit short allocation without changing the SIF or old invoice",
    async (path) => {
      const v = await venueWithOtherNode();
      const emergencySeries = await activate(v, emergency);
      const oldId = await prepare(v, "walk-up");
      const original = await issue(v, "walk-up", oldId);
      const [oldSale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, oldId));
      expect(oldSale!.seriesId).toBe(emergencySeries.id);
      const oldRecords = records(v);
      const sif = v.db.all(sql`select * from registro_sif order by id`);
      const id = await prepare(v, path);
      const shortSeries = await activate(v, short);
      await issue(v, path, id);
      const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
      expect(sale!.seriesId).toBe(shortSeries.id);
      expect(sale!.invoiceNumber).toBe(1);
      const issued = v.db.all<{ sif_id: string; anterior_huella: string | null }>(
        sql`select sif_id, anterior_huella from registros_facturacion where sale_id = ${sale!.id}`,
      );
      const prior = v.db.all<{ id: string; sif_id: string; huella: string }>(
        sql`select id, sif_id, huella from registros_facturacion where sale_id = ${oldSale!.id}`,
      );
      expect(issued).toEqual([{ sif_id: prior[0]!.sif_id, anterior_huella: prior[0]!.huella }]);
      expect(v.db.all(sql`select * from registro_sif order by id`)).toEqual(sif);
      expect(records(v).filter((r) => oldRecords.some((old) => old.id === r.id))).toEqual(
        oldRecords,
      );
      const replay = await issue(v, "walk-up", oldId);
      expect(replay).toEqual(original);
      expect((await v.db.select().from(sales).where(eq(sales.workingOrderId, oldId)))[0]).toEqual(
        oldSale,
      );
    },
  );

  it.each(["walk-up", "held order", "unpaid invoice"])(
    "%s rolls back allocation, invoice, record and outbox when filing throws after writing",
    async (path) => {
      const v = await venueWithOtherNode();
      await activate(v, emergency);
      const id = await prepare(v, path);
      const before = await snapshot(v);
      const failure = new Error("synthetic failure after fiscal record");
      const backend: FiscalBackend = Object.create(v.backend);
      backend.recordSale = async (tx, sale) => {
        await v.backend.recordSale(tx, sale);
        throw failure;
      };
      await expect(issue(v, path, id, backend)).rejects.toBe(failure);
      expect(await snapshot(v)).toEqual(before);
      await issue(v, path, id);
      const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
      expect(sale!.invoiceNumber).toBe(1);
    },
  );

  it("bill payment rolls back a written fiscal record and replays its eventual committed invoice", async () => {
    const v = await venueWithOtherNode();
    await activate(v, emergency);
    const id = await prepare(v, "bill payment");
    const before = await snapshot(v);
    const realWrite = v.backend.recordSale.bind(v.backend);
    const failedWrite = vi.spyOn(v.backend, "recordSale").mockImplementation(async (tx, sale) => {
      await realWrite(tx, sale);
      throw new Error("synthetic failure after fiscal record");
    });
    const body = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    };
    const request = () =>
      send(v.appTipsOff, v.cookie, "POST", `/api/working-orders/${id}/payments`, body);
    try {
      const failed = await request();
      expect(failed.status).toBe(500);
      expect(failed.json.code).toBe("server.internal");
      expect(failedWrite).toHaveBeenCalledTimes(1);
      expect(await snapshot(v)).toEqual(before);
    } finally {
      failedWrite.mockRestore();
    }
    const result = await request();
    expect(result.status).toBe(200);
    const committed = await snapshot(v);
    const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(sale!.invoiceNumber).toBe(1);
    const replay = await request();
    expect(replay).toEqual(result);
    expect(await snapshot(v)).toEqual(committed);
  });

  it.each([
    ["UTC", "2026-10-14T12:00:00.000Z"],
    ["UTC", "2026-10-14T23:30:00.000Z"],
    ["Europe/Madrid", "2026-10-14T12:00:00.000Z"],
    ["Europe/Madrid", "2026-10-14T23:30:00.000Z"],
    ["Asia/Tokyo", "2026-10-14T12:00:00.000Z"],
    ["Asia/Tokyo", "2026-10-14T23:30:00.000Z"],
    ["America/New_York", "2026-10-14T12:00:00.000Z"],
    ["America/New_York", "2026-10-14T23:30:00.000Z"],
  ])(
    "keeps the emergency series through offline drain and successful reconnection (%s, %s)",
    async (zone, at) => {
      vi.stubEnv("TZ", zone);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      try {
        const v = await venueWithOtherNode();
        const active = await activate(v, emergency);
        await issue(v, "walk-up", await prepare(v, "walk-up"));
        const before = await v.db.select().from(invoiceSeries);
        const aeat = createFakeAeat({ serverNow: new Date() });
        let connected = false;
        const drainDeps = {
          db: v.db,
          environment: "preproduction" as const,
          skipRetryMs: DEFAULT_SKIP_RETRY_MS,
          resolveClient: async () => {
            if (!connected) throw new Error("synthetic offline connection");
            return aeat.client();
          },
        };
        const offline = await drain(drainDeps, new Date());
        expect(offline.recordsAccepted).toBe(0);
        connected = true;
        // The fake compares invoice dates at UTC midnight, so reconnect after that boundary too.
        const reconnectedAt = new Date("2026-10-15T12:00:00.000Z");
        aeat.setServerNow(reconnectedAt);
        const online = await drain(drainDeps, reconnectedAt);
        expect(online.recordsAccepted).toBe(1);
        expect(await v.db.select().from(invoiceSeries)).toEqual(before);
        await issue(v, "walk-up", await prepare(v, "walk-up"));
        const rows = await v.db.select().from(sales);
        expect(rows.map((sale) => sale.seriesId)).toEqual([active.id, active.id]);
      } finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    },
  );
});
