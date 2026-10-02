import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPin, deactivatePerson, persons } from "@waitron/identity";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { send } from "./testing/bill-venue.js";
import {
  billlessSale,
  collect,
  credit,
  departed,
  parked,
  parkedBy,
  placedInvoiceFirst,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

const get = (cookie: string, path: string) =>
  send(venue.orders, cookie, "GET", `/management-api/orders${path}`);

describe("Orders routes", () => {
  it("requires a dashboard session and accepts staff and supervisor sessions", async () => {
    expect(await get("", "?anyDate=true")).toMatchObject({
      status: 401,
      json: { code: "management_session.required" },
    });
    expect((await get(venue.staffDashboard, "?anyDate=true")).status).toBe(200);
    expect((await get(venue.supervisorDashboard, "?anyDate=true")).status).toBe(200);
  });

  it("shows a staff login only unfinished bills, including direct detail reads", async () => {
    const open = await parked(venue, "Caña");
    const waiting = await placedInvoiceFirst(venue, "Caña");
    const left = (await departed(venue, "Caña")).tabId;
    const paid = await placedInvoiceFirst(venue, "Caña");
    expect((await collect(venue, paid, "3.00")).status).toBe(200);
    const cancelled = await placedInvoiceFirst(venue, "Caña");
    expect(
      (
        await send(venue.app, venue.cookie, "POST", `/api/working-orders/${cancelled}/cancel`, {
          reason: "Error",
        })
      ).status,
    ).toBe(200);
    const sale = await billlessSale(venue);

    const staff = await get(venue.staffDashboard, "?anyDate=true&limit=200");
    const manager = await get(venue.supervisorDashboard, "?anyDate=true&limit=200");
    expect(staff.status).toBe(200);
    expect(manager.status).toBe(200);
    const staffIds = (staff.json as { rows: { id: string }[] }).rows.map((row) => row.id);
    const managerIds = (manager.json as { rows: { id: string }[] }).rows.map((row) => row.id);
    expect(staffIds).toEqual(expect.arrayContaining([open, waiting, left]));
    expect(staffIds).not.toEqual(expect.arrayContaining([paid, cancelled, sale]));
    expect(managerIds).toEqual(
      expect.arrayContaining([open, waiting, left, paid, cancelled, sale]),
    );
    expect(await get(venue.staffDashboard, `/${paid}`)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect((await get(venue.supervisorDashboard, `/${paid}`)).status).toBe(200);
    for (const status of ["paid", "cancelled", "voided"]) {
      expect(await get(venue.staffDashboard, `?status=${status}&anyDate=true`)).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "status" } },
      });
    }
    expect((await get(venue.staffDashboard, "?status=unpaid&anyDate=true")).status).toBe(200);
    expect((await get(venue.staffDashboard, "/staff")).status).toBe(200);
  });

  it.each([
    ["status=bogus", "status"],
    ["from=2026-02-30&to=2026-03-01", "from"],
    ["from=2026-03-02&to=2026-03-01", "range"],
    ["from=2026-03-01", "to"],
    ["anyDate=true&from=2026-03-01&to=2026-03-01", "anyDate"],
    ["anyDate=yes", "anyDate"],
    ["credited=1", "credited"],
    ["staff=nobody", "staff"],
    [`table=${"x".repeat(101)}`, "table"],
    [`q=${"x".repeat(101)}`, "q"],
    ["limit=0", "limit"],
    ["limit=201", "limit"],
    ["after=2026-03-01_x", "after"],
  ])("refuses %s beside %s", async (query, field) => {
    expect(await get(venue.supervisorDashboard, `?${query}`)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
  });

  it("answers not found for malformed and unknown ids", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      expect(await get(venue.supervisorDashboard, `/${id}`)).toMatchObject({
        status: 404,
        json: { code: "working_order.not_found" },
      });
    }
  });

  it("keeps a deactivated colleague in the Staff filter", async () => {
    const [person] = await withTransaction(venue.db, (tx) =>
      tx
        .insert(persons)
        .values({ displayName: "Pablo", pinHash: hashPin("8888"), role: "staff" })
        .returning({ id: persons.id }),
    );
    await parkedBy(venue, person!.id, "Caña");
    await withTransaction(venue.db, (tx) =>
      deactivatePerson(tx, {
        managementSessionId: venue.adminDashboard.split("=")[1]!,
        personId: person!.id,
      }),
    );
    const answer = await get(venue.staffDashboard, "/staff");
    expect(answer).toMatchObject({
      status: 200,
      json: { staff: expect.arrayContaining([{ id: person!.id, name: "Pablo" }]) },
    });
  });

  it("reads a departed, part credited, collected bill's parts", async () => {
    const party = await departed(venue, "Botella tinto");
    await credit(venue, party.tabId, "2.00", "-2.42");
    const before = await get(venue.supervisorDashboard, `/${party.tabId}`);
    expect(before.status).toBe(200);
    const due = (before.json as { row: { stillOwed: string } }).row.stillOwed;
    expect((await collect(venue, party.tabId, due)).status).toBe(200);
    const answer = await get(venue.supervisorDashboard, `/${party.tabId}`);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      row: { status: "paid" },
      lines: [{ creditedTo: venue.operatorId }],
      invoices: [{ kind: "invoice" }, { kind: "credit_note" }],
      tenders: [{ method: "cash", amount: due }],
      party: { tables: [expect.stringMatching(/^Mesa /)] },
      departure: { reason: "Se marcharon sin pagar", recordedBy: "Sofía", authorizedBy: "Sofía" },
    });
  });
});
