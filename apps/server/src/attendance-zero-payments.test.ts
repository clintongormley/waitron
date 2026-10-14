import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { newId, saleSettlements, tenders, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { updateProduct } from "@waitron/catalogue";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { payments } from "@waitron/payments";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { republishMenus } from "./testing/publish-menu.js";
import { collectOrder, collectOrderOrchestration, payWorkingOrderIntegrated } from "./till-sale.js";
import {
  setupPartyVenue,
  seat,
  order,
  placeByHand,
  OPERATOR,
  type PartyVenue,
} from "./testing/party-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { openTillSession } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, collector: { personId: string; sessionId: string };
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Invoice author", pinHash: "scrypt$00$00" });
  const [worker] = await suite.db
    .insert(persons)
    .values({ displayName: "Actual collector", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
  collector = {
    personId: worker!.id,
    sessionId: await openTillSession(suite.db, {
      deviceId: v.cfg.origin.deviceId,
      personId: worker!.id,
    }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const deps = (attendance: AttendanceRecorder | undefined = recordAttendanceFact) => ({
  db: suite.db,
  backend: v.backend,
  clock: v.clock,
  attendance,
});
function at(instant = "2026-01-05T11:00:00.987Z") {
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({ ...reading, instant: new Date(instant) });
}
const operations = () => suite.db.select().from(attendanceOperationFacts);
const tender = (method: "cash" | "card") => ({
  method,
  amount: "20.00",
  ...(method === "card" ? { externalRef: "hand keyed" } : {}),
});
const request = (id: string = newId()) => ({
  workingOrderId: id,
  zoneId: v.counter.zoneId,
  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
  tender: tender("cash"),
});
function evidence(key: string) {
  return {
    sequence: 1,
    source: "whole-payment",
    key,
    personId: collector.personId,
    locationId: v.cfg.locationId,
    kind: "payment",
    at: "2026-01-05T11:00:00.000Z",
    offsetMinutes: 60,
    businessDay: "2026-01-05",
    outcome: "qualifying",
  };
}
async function bill(issued = false) {
  const { tabId } = await seat(v, await v.table("Attendance collection"));
  await order(v, tabId, "Burger");
  await placeByHand(v, tabId);
  if (issued) await issueOrderInvoice(deps(), v.cfg, tabId, OPERATOR);
  return tabId;
}

describe("a human zero-owing command remains attendance evidence", () => {
  async function freeProduct() {
    await withTransaction(suite.db, async (tx) => {
      await updateProduct(tx, v.productId("Burger"), { unitPrice: "0.00" });
      await republishMenus(tx);
    });
  }
  async function zeroBill(issued = false) {
    await freeProduct();
    return bill(issued);
  }
  async function noMoney() {
    expect(await suite.db.select().from(tenders)).toEqual([]);
    expect(await suite.db.select().from(payments)).toEqual([]);
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from drawer_opens`,
    );
    expect(rows).toEqual([{ n: 0 }]);
  }
  it.each(["cash", "card"] as const)(
    "records a %s collection of an issued zero bill",
    async (method) => {
      const id = await zeroBill(true);
      at();
      const ticket = await collectOrder(
        deps(),
        v.cfg,
        { id, lines: [], tender: tender(method) },
        collector,
      );
      expect(ticket.total).toBe("0.00");
      expect(ticket.tender).toEqual({ method: "unpaid" });
      expect(await operations()).toEqual([evidence(id)]);
      await noMoney();
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("New clock unavailable");
      });
      expect(
        await collectOrder(deps(), v.cfg, { id, lines: [], tender: tender(method) }, v.operator),
      ).toEqual(ticket);
      expect(await operations()).toEqual([evidence(id)]);
    },
  );
  it.each(["issued", "placed", "retrieved", "counter"] as const)(
    "records an integrated %s zero-owing action without a charge",
    async (path) => {
      let id: string;
      if (path === "counter") {
        await freeProduct();
        id = newId();
      } else if (path === "retrieved") {
        await freeProduct();
        const seated = await seat(v, await v.table("Zero retrieved"));
        await order(v, seated.tabId, "Burger");
        id = seated.tabId;
      } else id = await zeroBill(path === "issued");
      const provider = new FakePaymentProvider(suite.db);
      const integrated = { ...deps(), provider };
      const req =
        path === "counter"
          ? { id, lines: request(id).lines, zoneId: v.counter.zoneId }
          : { id, lines: [] };
      at();
      const result = await payWorkingOrderIntegrated(integrated, v.cfg, req, collector);
      expect(result.outcome).toBe("captured");
      if (result.outcome !== "captured") throw new Error("Expected local settlement");
      expect(result.ticket.total).toBe("0.00");
      expect(result.ticket.tender).toEqual({ method: "unpaid" });
      expect(provider.collectCalls).toEqual([]);
      expect(await operations()).toEqual([evidence(id)]);
      await noMoney();
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("New clock unavailable");
      });
      expect(await payWorkingOrderIntegrated(integrated, v.cfg, req, v.operator)).toEqual(result);
      expect(await operations()).toEqual([evidence(id)]);
    },
  );
  it("a zero collection's evidence refusal rolls back settlement", async () => {
    const id = await zeroBill(true);
    const refusal: AttendanceRecorder = async () => {
      throw new AppError("attendance.invalid", { reason: "probe" });
    };
    at();
    await expect(
      collectOrder(deps(refusal), v.cfg, { id, lines: [], tender: tender("cash") }, collector),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(
      (await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id)))[0]!.status,
    ).toBe("placed");
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(saleSettlements)).toEqual([]);
    await noMoney();
  });
  it("an unattributed zero collection invents no worker", async () => {
    const id = await zeroBill(true);
    at();
    expect(
      (await collectOrderOrchestration(deps(), v.cfg, { id, lines: [], tender: tender("cash") }))
        .total,
    ).toBe("0.00");
    expect(await operations()).toEqual([]);
    await noMoney();
  });
});
