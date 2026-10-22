import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incidents, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { offerProducts } from "./testing/zone-offers.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  return {
    ...real,
    buildAltaRecord: (...args: Parameters<typeof real.buildAltaRecord>) => {
      const record = real.buildAltaRecord(...args);
      if (fault.enabled)
        record.Huella = (record.Huella[0] === "A" ? "B" : "A") + record.Huella.slice(1);
      return record;
    },
  };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let venue: BillVenue;
const logs: unknown[][] = [];
beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
  logs.length = 0;
  venue.app = venue.appWith({
    log: (...args) => {
      logs.push(args);
    },
  });
});
afterEach(() => {
  fault.enabled = false;
  vi.restoreAllMocks();
});

function snapshot(includePayments = true) {
  const result: Record<string, unknown> = {};
  const names = [
    "invoice_series",
    "sales",
    "sale_lines",
    "tenders",
    "sale_settlements",
    "registros_facturacion",
    "cadenas",
    "envios",
    "working_orders",
    "working_order_lines",
    "print_jobs",
    "drawer_opens",
  ];
  if (includePayments) names.push("bill_payments", "payments");
  for (const name of names) {
    if (!/^[a-z_]+$/.test(name)) throw new Error("invalid snapshot identifier");
    result[name] = suite.db.all(sql.raw(`select * from "${name}" order by rowid`));
  }
  return result;
}

describe("issuance owners retain a fingerprint refusal incident", () => {
  it.each([
    "counter cash",
    "counter manual card",
    "collection",
    "whole table",
    "bill cash",
    "bill manual card",
    "reader",
  ])("%s rolls back issuance and permits a repaired retry", async (kind) => {
    const [product] = await suite.db.select().from(products);
    if (product?.unitPrice == null) throw new Error("fixture needs a priced product");
    const counter = kind.startsWith("counter");
    const reader = kind === "reader";
    let id: string = randomUUID();
    let path: string;
    let body: Record<string, unknown>;
    if (counter) {
      const offers = await withTransaction(suite.db, (tx) =>
        offerProducts(tx, venue.cfg, {
          zone: "counter",
          orderStart: "counter",
          paidWhen: "prepay",
        }),
      );
      path = "/api/sales";
      body = {
        workingOrderId: id,
        zoneId: offers.zoneId,
        lines: [{ menuItemId: offers.offerFor(product!.id), quantity: "1" }],
        tender: { method: kind.includes("card") ? "card" : "cash", amount: "100.00" },
      };
    } else if (kind === "collection") {
      const offers = await withTransaction(suite.db, (tx) =>
        offerProducts(tx, venue.cfg, {
          zone: "counter",
          orderStart: "counter",
          paidWhen: "ticket_then_pay",
        }),
      );
      const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
        id,
        zoneId: offers.zoneId,
        lines: [{ menuItemId: offers.offerFor(product!.id), quantity: "1" }],
      });
      expect(parked.status).toBe(200);
      const placed = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`);
      expect(placed.status).toBe(200);
      path = `/api/working-orders/${id}/collect`;
      body = { tender: { method: "cash", amount: "100.00" } };
    } else {
      id = await tabWith(venue, product!.name);
      if (kind.startsWith("bill")) {
        path = `/api/working-orders/${id}/payments`;
        body = {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: (product.unitPrice / 100).toFixed(2),
          applied: (product.unitPrice / 100).toFixed(2),
          tip: "0.00",
          method: kind.includes("card") ? "card" : "cash",
          ...(kind.includes("card") ? { entry: "manual" } : { tendered: "100.00" }),
        };
      } else {
        path = reader ? "/api/pay" : "/api/sales";
        body = reader
          ? { id, lines: [] }
          : { workingOrderId: id, lines: [], tender: { method: "cash", amount: "100.00" } };
      }
    }
    let before = snapshot();
    if (reader) {
      const collect = venue.card.collect.bind(venue.card);
      vi.spyOn(venue.card, "collect").mockImplementation(async (params) => {
        const result = await collect(params);
        before = snapshot();
        return result;
      });
    }
    fault.enabled = true;
    const refused = await send(venue.app, venue.cookie, "POST", path, body);
    expect(refused.json, JSON.stringify(logs)).toEqual({
      code: "fiscal.fingerprint_mismatch",
      params: {},
    });
    expect(snapshot()).toEqual(before);
    const alerts = await suite.db.select().from(incidents);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      code: "fiscal.fingerprint_mismatch",
      saleId: null,
      deviceId: venue.deviceId,
      severity: "error",
    });
    const captures = venue.card.collectCalls.length;
    if (reader) {
      expect(captures).toBe(1);
      expect(suite.db.all(sql`select state from payments`)).toEqual([{ state: "captured" }]);
    } else expect(captures).toBe(0);
    fault.enabled = false;
    const repaired = await send(venue.app, venue.cookie, "POST", path, body);
    expect(repaired.status).toBe(200);
    expect(suite.db.all(sql`select count(*) as count from registros_facturacion`)).toEqual([
      { count: 1 },
    ]);
    expect(
      suite.db.all(
        sql`select next_number as number from invoice_series where id = ${venue.seriesId}`,
      ),
    ).toEqual([{ number: 2 }]);
    expect(venue.card.collectCalls).toHaveLength(captures);
    const replay = await send(venue.app, venue.cookie, "POST", path, body);
    expect(replay.status).toBe(200);
    expect(suite.db.all(sql`select count(*) as count from registros_facturacion`)).toEqual([
      { count: 1 },
    ]);
    expect(venue.card.collectCalls).toHaveLength(captures);
    expect(await suite.db.select().from(incidents)).toEqual(alerts);
  });
});
