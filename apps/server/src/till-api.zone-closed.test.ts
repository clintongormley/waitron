import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locations, parties, workingOrders, workingOrderLines, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  menuPeriods,
  replaceMenuWeek,
  zoneServicePolicies,
  zoneClosedTimes,
} from "@waitron/venue-service";
import { createTable } from "./tables.js";
import { provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const at = (time: string) => vi.setSystemTime(new Date(`2026-10-05T${time}:00+02:00`));
afterEach(() => vi.useRealTimers());

async function venue() {
  at("23:00");
  const v = await provisionBillVenue(suite.db);
  await withTransaction(suite.db, async (tx) => {
    await tx
      .update(locations)
      .set({ dayCutover: "06:00" })
      .where(eq(locations.id, v.cfg.locationId));
    const [policy] = await tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.zoneId));
    const [period] = await tx
      .select()
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, policy!.departmentId));
    await replaceMenuWeek(
      tx,
      v.cfg,
      policy!.departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: period!.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
    );
    await tx.insert(zoneClosedTimes).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        zoneId: v.zoneId,
        weekday,
        startsAt: "23:30:00",
        endsAt: "06:00:00",
      })),
    );
  });
  return v;
}
const request = (v: BillVenue, method: string, path: string, body?: unknown) =>
  send(v.appTipsOff, v.cookie, method, path, body);
const line = (v: BillVenue) => ({ menuItemId: v.offerFor("Caña"), quantity: "1" });
const refused = (v: BillVenue) => ({
  status: 409,
  json: { code: "service_zone.closed", params: { zoneId: v.zoneId } },
});
async function table(v: BillVenue) {
  return withTransaction(suite.db, (tx) =>
    createTable(tx, v.cfg, { label: randomUUID(), zoneId: v.zoneId }),
  );
}
async function seat(v: BillVenue) {
  const t = await table(v);
  const answer = await request(v, "POST", `/api/tables/${t.id}/seat`, {});
  expect(answer.status).toBe(200);
  return answer.json as { partyId: string; tabId: string; revision: number };
}
async function park(v: BillVenue) {
  const id = randomUUID();
  expect(
    (await request(v, "POST", "/api/working-orders", { id, zoneId: v.zoneId, lines: [line(v)] }))
      .status,
  ).toBe(200);
  return id;
}
async function orderRows() {
  return suite.db.select().from(workingOrders);
}

describe("closed zones take no new service", () => {
  it("seats immediately before closure and refuses at the exact start without writing a party", async () => {
    const v = await venue();
    at("23:29");
    await seat(v);
    const t = await table(v);
    const before = await orderRows();
    const beforeParties = await suite.db.select().from(parties);
    at("23:30");
    expect(await request(v, "POST", `/api/tables/${t.id}/seat`, {})).toEqual(refused(v));
    expect(await orderRows()).toEqual(before);
    expect(await suite.db.select().from(parties)).toEqual(beforeParties);
  });

  it.each(["/api/sales", "/api/working-orders", "/api/pay"])(
    "refuses a new %s order without writing it",
    async (path) => {
      const v = await venue();
      const before = await orderRows();
      at("23:45");
      expect(
        await request(v, "POST", path, {
          id: randomUUID(),
          zoneId: v.zoneId,
          lines: [line(v)],
          tender: { method: "cash", amount: "3.00" },
        }),
      ).toEqual(refused(v));
      expect(await orderRows()).toEqual(before);
    },
  );

  it("uses the delivery table's closed zone for a walk-up sale", async () => {
    const v = await venue();
    const t = await table(v);
    const before = await orderRows();
    at("23:45");
    expect(
      await request(v, "POST", "/api/sales", {
        id: randomUUID(),
        deliveryTableId: t.id,
        lines: [line(v)],
        tender: { method: "cash", amount: "3.00" },
      }),
    ).toEqual(refused(v));
    expect(await orderRows()).toEqual(before);
  });

  it("reports the half-open closure on the zones read", async () => {
    const v = await venue();
    for (const [time, closed] of [
      ["23:29", false],
      ["23:30", true],
      ["23:45", true],
      ["06:00", false],
    ] as const) {
      at(time);
      const answer = await request(v, "GET", "/api/zones");
      expect(answer.status).toBe(200);
      expect(answer.json).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: v.zoneId, closed })]),
      );
    }
  });
});

describe("existing service in a closed zone", () => {
  it.each(["new line", "quantity"])(
    "refuses a %s on a stored bill without changing its rows",
    async (change) => {
      const v = await venue();
      const id = await park(v);
      const before = await request(v, "GET", `/api/working-orders/${id}`);
      at("23:45");
      const answer =
        change === "quantity"
          ? await request(v, "PUT", `/api/working-orders/${id}/lines/1`, {
              revision: before.json.revision,
              quantity: "2",
            })
          : await request(v, "PUT", `/api/working-orders/${id}`, {
              revision: before.json.revision,
              zoneId: v.zoneId,
              lines: [
                ...(
                  before.json.lines as {
                    workingOrderLineId: string;
                    menuItemId: string;
                    quantity: string;
                  }[]
                ).map((l) => ({
                  workingOrderLineId: l.workingOrderLineId,
                  menuItemId: l.menuItemId,
                  quantity: l.quantity,
                })),
                line(v),
              ],
            });
      expect(answer).toEqual(refused(v));
      expect(await request(v, "GET", `/api/working-orders/${id}`)).toEqual(before);
    },
  );

  it("keeps a stored note editable", async () => {
    const v = await venue();
    const id = await park(v);
    const before = await request(v, "GET", `/api/working-orders/${id}`);
    at("23:45");
    expect(
      (
        await request(v, "PUT", `/api/working-orders/${id}/lines/1`, {
          revision: before.json.revision,
          note: "No ice",
        })
      ).status,
    ).toBe(200);
    expect(
      await suite.db
        .select({ note: workingOrderLines.note, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([{ note: "No ice", quantity: 1000 }]);
  });

  it("takes payment for a stored order", async () => {
    const v = await venue();
    const id = await park(v);
    at("23:45");
    expect(
      (
        await request(v, "POST", "/api/sales", {
          workingOrderId: id,
          lines: [],
          tender: { method: "cash", amount: "3.00" },
        })
      ).status,
    ).toBe(200);
    expect(
      await suite.db
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    ).toEqual([{ status: "settled" }]);
  });

  it("splits a stored party bill", async () => {
    const v = await venue();
    const seated = await seat(v);
    const added = await request(v, "POST", `/api/parties/${seated.partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: seated.revision,
      groups: [
        { lines: [line(v), { menuItemId: v.offerFor("Tarta"), quantity: "1" }], release: "fire" },
      ],
    });
    expect(added.status).toBe(200);
    const [party] = await suite.db.select().from(parties).where(eq(parties.id, seated.partyId));
    at("23:45");
    const answer = await request(v, "POST", `/api/bills/${seated.tabId}/split`, {
      partyId: seated.partyId,
      expectedPartyRevision: party!.revision,
      transfers: [{ lineNo: 2 }],
    });
    expect(answer.status).toBe(200);
    expect(
      await suite.db
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, answer.json.billId as string)),
    ).toEqual([{ status: "open" }]);
  });

  it("splits joined tables without admitting a new service", async () => {
    const v = await venue();
    const seated = await seat(v);
    const second = await table(v);
    expect(
      (
        await request(v, "POST", `/api/parties/${seated.partyId}/join`, {
          tableId: second.id,
          expectedPartyRevision: seated.revision,
        })
      ).status,
    ).toBe(200);
    const [party] = await suite.db.select().from(parties).where(eq(parties.id, seated.partyId));
    at("23:45");
    const answer = await request(v, "POST", `/api/parties/${seated.partyId}/split-table`, {
      tableId: second.id,
      billId: null,
      expectedPartyRevision: party!.revision,
    });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      partyId: expect.any(String),
      mainBillId: expect.any(String),
    });
    expect(
      await suite.db
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, answer.json.mainBillId as string)),
    ).toEqual([{ status: "open" }]);
  });

  it.each(["first order", "handheld draft"])(
    "refuses a %s for an already seated party without leaving a bill",
    async (kind) => {
      const v = await venue();
      const seated = await seat(v);
      await withTransaction(suite.db, async (tx) => {
        await tx.update(parties).set({ mainBillId: null }).where(eq(parties.id, seated.partyId));
        await tx.delete(workingOrders).where(eq(workingOrders.id, seated.tabId));
      });
      const before = await orderRows();
      let draft: { id: string; revision: number; lines: { id: string }[] } | undefined;
      if (kind === "handheld draft") {
        const saved = await request(v, "PUT", `/api/parties/${seated.partyId}/drafts`, {
          draftId: null,
          revision: 0,
          lines: [line(v)],
        });
        expect(saved.status).toBe(200);
        draft = saved.json as typeof draft;
      }
      const [party] = await suite.db.select().from(parties).where(eq(parties.id, seated.partyId));
      at("23:45");
      const answer =
        draft === undefined
          ? await request(v, "POST", `/api/parties/${seated.partyId}/groups`, {
              submissionId: randomUUID(),
              expectedPartyRevision: party!.revision,
              groups: [{ lines: [line(v)], release: "fire" }],
            })
          : await request(v, "POST", `/api/parties/${seated.partyId}/drafts/${draft.id}/submit`, {
              submissionId: randomUUID(),
              expectedPartyRevision: party!.revision,
              draftRevision: draft.revision,
              groups: [{ lineIds: draft.lines.map((l) => l.id), release: "fire" }],
            });
      expect(answer).toEqual(refused(v));
      expect(await orderRows()).toEqual(before);
      const [after] = await suite.db
        .select({ mainBillId: parties.mainBillId })
        .from(parties)
        .where(eq(parties.id, seated.partyId));
      expect(after).toEqual({ mainBillId: null });
      if (draft !== undefined)
        expect((await request(v, "GET", `/api/parties/${seated.partyId}/drafts`)).json).toEqual({
          drafts: [draft],
        });
    },
  );
});
