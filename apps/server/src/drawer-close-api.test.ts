import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { devices, drawerEntries } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
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
  await setBuiltInRoleForTest(store.db, venue.operatorId, "supervisor");
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

it("requires the person's drawer permission even when their till can open the drawer", async () => {
  await setBuiltInRoleForTest(store.db, venue.operatorId, "staff");
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
