import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import { readBillEditState } from "./bill-editing.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { createDiskFullState, type DiskFullState } from "./disk-full-state.js";
import { createStation } from "./kitchen.js";
import { mountThemesApi } from "./themes-api.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, (tx) =>
      createStation(tx, venue.cfg, { name: "Kitchen", isDefault: true }),
    );
  },
});

const quiet = () => {};

/** Written out here, never imported, so a route opened by mistake in `till-api.ts` fails the sweep. */
const EXPECTED_OPEN = new Set([
  "POST /api/session",
  "DELETE /api/session",
  "PUT /api/session/locale",
  "POST /api/sales",
  "POST /api/pay",
  "POST /api/working-orders/:id/collect",
  "POST /api/working-orders/:id/payments",
  "POST /api/dead-ends/sale",
  "POST /api/dead-ends/draft",
  "POST /api/dead-ends/order",
  "POST /api/working-orders/:id/payments/preview",
  "POST /api/working-orders/:id/adjustments/preview",
  "POST /api/parties/:id/allergy/send-preview",
  "POST /api/bills/:id/move/allergy-preview",
]);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REFUSED = { status: 507, json: { code: "storage.disk_full", params: {} } };

function diskState(free: { bytes: number }): DiskFullState {
  return createDiskFullState({
    dir: "/unused",
    now: () => new Date(),
    log: quiet,
    statfs: () => Promise.resolve({ bavail: free.bytes, frsize: 1 }),
  });
}

function notedState(free = { bytes: 0 }): DiskFullState {
  const disk = diskState(free);
  disk.noteRefused();
  return disk;
}

function writeRoutes(app: Hono): { method: string; path: string }[] {
  const seen = new Map<string, { method: string; path: string }>();
  for (const { method, path } of app.routes) {
    if (!WRITE_METHODS.has(method) || !path.startsWith("/api/")) continue;
    seen.set(`${method} ${path}`, { method, path });
  }
  return [...seen.values()];
}

/** Each write route sent with no cookie and `{}`; the keys of those answering 507. */
async function sweep(disk: DiskFullState): Promise<{ all: string[]; refused: string[] }> {
  const app = venue.appWith({ disk, workforceEnabled: true });
  const fixed = randomUUID();
  const all: string[] = [];
  const refused: string[] = [];
  for (const { method, path } of writeRoutes(app)) {
    const key = `${method} ${path}`;
    all.push(key);
    const answer = await send(app, "", method, path.replace(/:[^/]+/g, fixed), {});
    if (answer.status === 507) refused.push(key);
  }
  return { all, refused };
}

function park(app: Hono, id = randomUUID()) {
  return send(app, venue.cookie, "POST", "/api/working-orders", {
    id,
    zoneId: venue.zoneId,
    lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
  });
}

function orderRows(id: string): number {
  return venue.db.all(sql`select id from working_orders where id = ${id}`).length;
}

function count(table: string, where = sql`1 = 1`): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)} where ${where}`,
  );
  return row!.n;
}

describe("the full-disk gate on the till's routes", () => {
  it("refuses every till write while a refused write is noted, except the open ones", async () => {
    const { all, refused } = await sweep(notedState());
    const mismatched = all.filter((key) => EXPECTED_OPEN.has(key) === refused.includes(key));
    expect(mismatched).toEqual([]);
    expect([...EXPECTED_OPEN].filter((key) => !all.includes(key))).toEqual([]);
  });

  it("refuses none of them while nothing is noted", async () => {
    const { refused } = await sweep(diskState({ bytes: 0 }));
    expect(refused).toEqual([]);
  });

  it("parks and places no order while the stop holds", async () => {
    const id = randomUUID();
    const refused = await park(venue.appWith({ disk: notedState() }), id);
    expect({ status: refused.status, json: refused.json }).toEqual(REFUSED);
    expect(orderRows(id)).toBe(0);

    const parked = await park(venue.appWith({ disk: diskState({ bytes: 0 }) }), id);
    expect(parked.status).toBe(200);
    expect(orderRows(id)).toBe(1);

    const before = await statusOf(venue, id);
    const notPlaced = await send(
      venue.appWith({ disk: notedState() }),
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/place`,
      {},
    );
    expect({ status: notPlaced.status, json: notPlaced.json }).toEqual(REFUSED);
    expect(await statusOf(venue, id)).toBe(before);

    const placed = await send(
      venue.appWith({ disk: diskState({ bytes: 0 }) }),
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/place`,
      {},
    );
    expect(placed.status).toBe(200);
    expect(await statusOf(venue, id)).toBe("placed");

    // The gate refuses a resend of a placement already made, before the route could answer it.
    const resent = await send(
      venue.appWith({ disk: notedState() }),
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/place`,
      {},
    );
    expect({ status: resent.status, json: resent.json }).toEqual(REFUSED);
    expect(await statusOf(venue, id)).toBe("placed");
  });

  it("sends no round to the kitchen while the stop holds", async () => {
    const party = await seatedWith(venue);
    const round = async (disk: DiskFullState) =>
      send(venue.appWith({ disk }), venue.cookie, "POST", `/api/parties/${party.partyId}/groups`, {
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }], release: "fire" },
        ],
      });
    const counts = () => ({
      lines: count("working_order_lines", sql`working_order_id = ${party.tabId}`),
      tickets: count(
        "ticket_items",
        sql`working_order_line_id in (select id from working_order_lines where working_order_id = ${party.tabId})`,
      ),
      prints: count("print_jobs"),
    });

    const before = counts();
    const refused = await round(notedState());
    expect({ status: refused.status, json: refused.json }).toEqual(REFUSED);
    expect(counts()).toEqual(before);

    const sent = await round(diskState({ bytes: 0 }));
    expect(sent.status).toBe(200);
    expect(counts().tickets).toBe(before.tickets + 1);
  });

  it("advances no ticket item while the stop holds", async () => {
    const party = await seatedWith(venue, "Ensalada");
    const [line] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, party.tabId));
    const ticketOf = async () => {
      const [ticket] = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, line!.id));
      return ticket!;
    };
    const ticket = await ticketOf();
    const advance = (disk: DiskFullState) =>
      send(
        venue.appWith({ disk }),
        venue.cookie,
        "POST",
        `/api/ticket-items/${ticket.id}/advance`,
        {
          stationId: ticket.stationId,
          to: "preparing",
        },
      );

    const refused = await advance(notedState());
    expect({ status: refused.status, json: refused.json }).toEqual(REFUSED);
    expect((await ticketOf()).state).toBe(ticket.state);

    const advanced = await advance(diskState({ bytes: 0 }));
    expect(advanced.status).toBe(200);
    expect((await ticketOf()).state).toBe("preparing");
  });

  it("logs each refusal it gives, naming the route", async () => {
    const lines: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
    const app = venue.appWith({
      disk: notedState(),
      log: (level, event, fields) => lines.push({ level, event, fields }),
    });
    expect((await park(app)).status).toBe(507);
    expect(lines.filter((line) => line.event === "storage.disk_full_stop_refused")).toEqual([
      {
        level: "warn",
        event: "storage.disk_full_stop_refused",
        fields: expect.objectContaining({ route: "POST /api/working-orders" }),
      },
    ]);
  });

  it("still answers a read", async () => {
    const id = randomUUID();
    expect((await park(venue.app, id)).status).toBe(200);
    const read = await send(
      venue.appWith({ disk: notedState() }),
      venue.cookie,
      "GET",
      `/api/working-orders/${id}`,
    );
    expect(read.status).toBe(200);
  });

  it("still signs a person in and out", async () => {
    const app = venue.appWith({ disk: notedState() });
    const deviceCookie = venue.cookie
      .split("; ")
      .find((part) => part.startsWith(`${DEVICE_COOKIE}=`));
    const signIn = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie! },
      body: JSON.stringify({ personId: venue.operatorId, pin: "5555" }),
    });
    expect(signIn.status).toBe(200);
    const session = signIn.headers.get("set-cookie")!.split(";")[0]!;
    const signOut = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${session}; ${deviceCookie!}` },
    });
    expect(signOut.status).toBe(200);
  });

  it("refuses no route mounted after the till's", async () => {
    const app = venue.appWith({ disk: notedState() });
    mountThemesApi(app, { db: venue.db }, quiet);
    app.post("/api/backup/apply", (c) => c.json({}));
    const themes = await send(app, "", "POST", "/management-api/themes", {});
    expect(themes.status).not.toBe(507);
    expect(themes.json.code).toBe("management_session.required");
    expect((await send(app, "", "POST", "/api/backup/apply", {})).status).toBe(200);
  });

  it("lets a write through once the folder has 16 MiB free, and forgets the refusal", async () => {
    const free = { bytes: FULL_DISK_BYTES - 1 };
    const disk = notedState(free);
    const app = venue.appWith({ disk });
    const refused = await park(app);
    expect({ status: refused.status, json: refused.json }).toEqual(REFUSED);
    free.bytes = FULL_DISK_BYTES;
    expect((await park(app)).status).toBe(200);
    expect(disk.noted()).toBe(false);
  });
});
