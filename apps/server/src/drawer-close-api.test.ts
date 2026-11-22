import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { devices, drawerEntries, personRoles, printers, printJobs } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { deletePrinter, readPrinterDeleteImpact } from "./printer-delete.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import {
  cashPayment,
  inTx,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const path = "/api/drawer/close";
let venue: BillVenue;
let printerId: string;

beforeEach(async () => {
  venue = await provisionBillVenue(store.db);
  const [device] = await store.db.select().from(devices).where(eq(devices.id, venue.deviceId));
  printerId = device!.cashDrawerPrinterId!;
});

function postCount(body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `${path}/count`, {
    printerId,
    startSequence: 0,
    counted: "10.00",
    ...body,
  });
}

it("shows expected cash only after saving a count and lets another assigned till resume it", async () => {
  const order = await tabWith(venue, "Croquettes");
  expect((await cashPayment(venue, venue.cookie, order, "10.00")).status).toBe(200);
  expect(await send(venue.app, venue.cookie, "GET", path)).toEqual({
    status: 200,
    json: { printerId, state: "new", openingCash: "0.00", startSequence: 1 },
  });

  const saved = await postCount({ counted: "8.00", startSequence: 1 });
  expect(saved).toMatchObject({
    status: 200,
    json: { printerId, first: { counted: "8.00", expected: "10.00", difference: "-2.00" } },
  });
  await inTx(venue, (tx) =>
    tx
      .update(devices)
      .set({ cashDrawerPrinterId: printerId })
      .where(eq(devices.id, venue.device2Id)),
  );
  expect(await send(venue.app, venue.cookie2, "GET", path)).toEqual(saved);
});

it.each([
  [{ counted: "1.001" }, "counted"],
  [{ counted: "-0.01" }, "counted"],
  [{ counted: null }, "counted"],
  [{ counted: "1000000000000.00" }, "counted"],
  [{ startSequence: -1 }, "startSequence"],
])("reports an invalid count field for %j", async (body, field) => {
  expect(await postCount(body)).toEqual({
    status: 400,
    json: { code: "drawer.close_invalid_field", params: { field } },
  });
  expect(await store.db.select().from(drawerEntries)).toEqual([]);
});

it("refuses another drawer's count the same way as an unknown one", async () => {
  const saved = await postCount({});
  expect(saved.status).toBe(200);
  const firstId = (saved.json.first as { id: string }).id;
  await inTx(venue, async (tx) => {
    const other = await createPrinter(tx, {
      name: "Other drawer",
      transport: "network_tcp",
      host: "other.test",
      hasCashDrawer: true,
    });
    await tx
      .update(devices)
      .set({ cashDrawerPrinterId: other.id })
      .where(eq(devices.id, venue.deviceId));
  });
  for (const id of [firstId, randomUUID()]) {
    expect(
      await send(venue.app, venue.cookie, "POST", `${path}/${id}/finish`, {
        confirmSequence: 1,
        amountLeft: "0.00",
      }),
    ).toEqual({ status: 404, json: { code: "drawer.close_not_found", params: {} } });
    expect(
      await send(venue.app, venue.cookie, "POST", `${path}/${id}/recount`, {
        startSequence: 1,
        counted: "9.00",
      }),
    ).toEqual({ status: 404, json: { code: "drawer.close_not_found", params: {} } });
  }
  expect(await postCount({})).toMatchObject({
    status: 409,
    json: { code: "drawer.close_changed" },
  });
  expect(await store.db.select({ kind: drawerEntries.kind }).from(drawerEntries)).toEqual([
    { kind: "count" },
  ]);
});

it("allows a manually counted close during a clock stop", async () => {
  const holds = () => true;
  const app = venue.appWith({
    backend: gateSeatOnStartClock(venue.backend, holds),
    clockUnconfirmed: holds,
  });
  const order = await tabWith(venue, "Croquettes");
  expect(await cashPayment({ db: venue.db, app }, venue.cookie, order, "10.00")).toMatchObject({
    status: 409,
    json: { code: "clock.unconfirmed" },
  });
  const saved = await send(app, venue.cookie, "POST", `${path}/count`, {
    printerId,
    startSequence: 0,
    counted: "10.00",
  });
  expect(saved.status).toBe(200);
  const firstId = (saved.json.first as { id: string }).id;
  const done = await send(app, venue.cookie, "POST", `${path}/${firstId}/finish`, {
    confirmSequence: 1,
    amountLeft: "2.00",
  });
  expect(done).toMatchObject({
    status: 200,
    json: { state: "finished", bankWithdrawal: "8.00", amountLeft: "2.00" },
  });
});

it.each([true, false])(
  "finishes with the drawer printer switched on=%s and queues at most one slip",
  async (active) => {
    if (!active) {
      await inTx(venue, (tx) =>
        tx.update(printers).set({ active }).where(eq(printers.id, printerId)),
      );
    }
    const saved = await postCount({});
    expect(saved.status).toBe(200);
    const firstId = (saved.json.first as { id: string }).id;
    const finish = () =>
      send(venue.app, venue.cookie, "POST", `${path}/${firstId}/finish`, {
        confirmSequence: 1,
        amountLeft: "2.00",
      });

    const done = await finish();
    expect(done).toMatchObject({
      status: 200,
      json: { state: "finished", bankWithdrawal: "8.00", slip: active ? "queued" : "unavailable" },
    });
    expect(await finish()).toMatchObject({
      status: 200,
      json: { id: done.json.id, bankWithdrawal: "8.00", slip: "already_closed" },
    });
    const jobs = await store.db.select().from(printJobs);
    expect(jobs).toHaveLength(active ? 1 : 0);
    if (active) {
      expect(jobs[0]).toMatchObject({ printerId, kind: "document" });
      expect(jobs[0]!.payload).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(jobs[0]!.payload!).includes(Buffer.from([27, 112]))).toBe(false);
    }
  },
);

it("offers a close for cash on an assigned till and keeps the balance when the same printer returns", async () => {
  const order = await tabWith(venue, "Croquettes");
  expect((await cashPayment(venue, venue.cookie, order, "10.00")).status).toBe(200);

  const read = (id: string) => inTx(venue, (tx) => readPrinterDeleteImpact(tx, id));
  expect(await read(printerId)).toMatchObject({
    drawerClose: { devices: expect.arrayContaining([{ id: venue.deviceId, name: "Barra" }]) },
  });

  const [printer] = await store.db.select().from(printers).where(eq(printers.id, printerId));
  await inTx(venue, (tx) => deletePrinter(tx, printerId));
  const restored = await inTx(venue, (tx) =>
    createPrinter(tx, {
      name: "Replacement at the same address",
      transport: "cloud_poll",
      pollId: printer!.pollId!,
    }),
  );
  expect(restored.id).toBe(printerId);
  expect(await read(printerId)).toMatchObject({ drawerClose: { devices: [] } });

  const different = await inTx(venue, (tx) =>
    createPrinter(tx, {
      name: "Another drawer",
      transport: "cloud_poll",
      pollId: "different-address",
      hasCashDrawer: true,
    }),
  );
  expect((await read(different.id)).drawerClose).toBeUndefined();
});

it("offers a close for a pending count even when expected cash is zero", async () => {
  expect((await postCount({ counted: "0.00" })).status).toBe(200);
  expect(await inTx(venue, (tx) => readPrinterDeleteImpact(tx, printerId))).toMatchObject({
    drawerClose: { devices: expect.arrayContaining([{ id: venue.deviceId, name: "Barra" }]) },
  });
});

it("requires the person's drawer permission even when their till can open the drawer", async () => {
  await inTx(venue, (tx) =>
    tx.delete(personRoles).where(eq(personRoles.personId, venue.operatorId)),
  );
  expect(await send(venue.app, venue.cookie, "GET", path)).toEqual({
    status: 403,
    json: { code: "authorization.not_permitted", params: { permission: "cash.drawer" } },
  });
  expect(await postCount({})).toEqual({
    status: 403,
    json: { code: "authorization.not_permitted", params: { permission: "cash.drawer" } },
  });
});

it("requires a drawer assignment even on a till whose profile can open drawers", async () => {
  await inTx(venue, (tx) =>
    tx.update(devices).set({ cashDrawerPrinterId: null }).where(eq(devices.id, venue.deviceId)),
  );
  expect(await send(venue.app, venue.cookie, "GET", path)).toEqual({
    status: 400,
    json: { code: "drawer.no_printer", params: { deviceId: venue.deviceId } },
  });
});

it("leaves the sale path free while it waits for the count request body", async () => {
  const order = await tabWith(venue, "Croquettes");
  let reached!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Request(`http://localhost${path}/count`, {
    method: "POST",
    headers: { cookie: venue.cookie, "content-type": "application/json" },
  });
  request.text = async () => {
    reached();
    await hold;
    return JSON.stringify({ printerId, startSequence: 0, counted: "10.00" });
  };
  const submitted = Promise.resolve(venue.app.request(request));
  const started = await Promise.race([reading.then(() => true), submitted.then(() => false)]);
  expect(started).toBe(true);

  const sale = cashPayment(venue, venue.cookie2, order, "10.00");
  const deadline = new AbortController();
  const result = await Promise.race([
    sale,
    setTimeout(1000, null, { signal: deadline.signal }),
  ]).finally(() => {
    deadline.abort();
    release();
  });
  await sale;
  const saved = await submitted;
  expect(result?.status).toBe(200);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    first: { expected: "10.00", cashMovedWhileCounting: true },
  });
});
