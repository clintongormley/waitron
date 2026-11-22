import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { devices, drawerEntries, personRoles, printers, printJobs } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { setPersonLocale } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { listDrawerCloses, readDrawerCloseForPrint } from "./drawer-close-report.js";
import { formatDrawerCloseTicket } from "./drawer-close-ticket.js";
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

const entriesPath = "/api/drawer/entries";

function postEntry(fields: Record<string, unknown> = {}) {
  return send(venue.app, venue.cookie, "POST", entriesPath, {
    submissionId: randomUUID(),
    printerId,
    kind: "cash_in",
    amount: "10.20",
    reason: "  Change for the till  ",
    ...fields,
  });
}

it("records signed movement once per submission and leaves the drawer mechanism alone", async () => {
  const submissionId = randomUUID();
  const first = await postEntry({ submissionId });
  expect(first).toEqual({ status: 200, json: { id: submissionId, printerId } });
  expect(await postEntry({ submissionId, amount: "10.2" })).toEqual(first);
  for (const change of [{ reason: "A different movement" }, { amount: "10.21" }]) {
    expect(await postEntry({ submissionId, ...change })).toEqual({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId } },
    });
  }
  await inTx(venue, (tx) =>
    tx.update(printers).set({ active: false }).where(eq(printers.id, printerId)),
  );
  expect(
    await postEntry({ kind: "cash_out", amount: "2.03", reason: "Paid supplier" }),
  ).toMatchObject({
    status: 200,
  });
  const entries = await store.db.select().from(drawerEntries).orderBy(drawerEntries.sequence);
  expect(entries).toMatchObject([
    {
      id: submissionId,
      printerId,
      personId: venue.operatorId,
      deviceId: venue.deviceId,
      kind: "cash_in",
      amount: 1020,
      facts: { reason: "Change for the till" },
    },
    {
      printerId,
      personId: venue.operatorId,
      deviceId: venue.deviceId,
      kind: "cash_out",
      amount: -203,
      facts: { reason: "Paid supplier" },
    },
  ]);
  expect(entries[0]?.recordedAt).toBe(new Date(entries[0]!.recordedAt).toISOString());
  expect(await store.db.select().from(printJobs)).toEqual([]);
});

it.each([
  [{ amount: "0.00" }, "amount"],
  [{ amount: "-1.00" }, "amount"],
  [{ amount: "1.001" }, "amount"],
  [{ amount: 1.2 }, "amount"],
  [{ kind: ["cash_out"] }, "kind"],
  [{ reason: "   " }, "reason"],
  [{ reason: "x".repeat(501) }, "reason"],
  [{ submissionId: null }, "submissionId"],
])("refuses an invalid cash entry field %#", async (fields, field) => {
  expect(await postEntry(fields)).toEqual({
    status: 400,
    json: { code: "drawer.entry_invalid_field", params: { field } },
  });
  expect(await store.db.select().from(drawerEntries)).toEqual([]);
});

it("refuses cash entry for a different drawer and for staff without the drawer grant", async () => {
  expect(await postEntry({ printerId: randomUUID() })).toEqual({
    status: 409,
    json: { code: "drawer.assignment_changed", params: {} },
  });
  await inTx(venue, (tx) =>
    tx.delete(personRoles).where(eq(personRoles.personId, venue.operatorId)),
  );
  expect(await postEntry()).toEqual({
    status: 403,
    json: { code: "authorization.not_permitted", params: { permission: "cash.drawer" } },
  });
  expect(await store.db.select().from(drawerEntries)).toEqual([]);
});

it("keeps the audited Open drawer action bound to the drawer the cash-entry form names", async () => {
  const open = (expectedPrinterId: string) =>
    send(venue.app, venue.cookie, "POST", "/api/drawer/open", { expectedPrinterId });
  expect(await open(randomUUID())).toEqual({
    status: 409,
    json: { code: "drawer.assignment_changed", params: {} },
  });
  expect(await store.db.select().from(printJobs)).toEqual([]);
  expect((await open(printerId)).status).toBe(200);
  expect(
    await store.db.select({ printerId: printJobs.printerId, kind: printJobs.kind }).from(printJobs),
  ).toEqual([{ printerId, kind: "drawer" }]);
});

it.each([false, true])(
  "recounts and closes after a withdrawal leaves negative cash (already recounted: %s)",
  async (alreadyRecounted) => {
    const order = await tabWith(venue, "Croquettes");
    expect((await cashPayment(venue, venue.cookie, order, "10.00")).status).toBe(200);
    const first = await postCount({
      counted: alreadyRecounted ? "9.00" : "10.00",
      startSequence: 1,
    });
    const id = (first.json.first as { id: string }).id;
    const recount = (counted: string, startSequence: number) =>
      send(venue.app, venue.cookie, "POST", `${path}/${id}/recount`, { counted, startSequence });
    if (alreadyRecounted) expect((await recount("10.00", 2)).status).toBe(200);
    expect((await postEntry({ kind: "cash_out", amount: "50.00" })).status).toBe(200);
    const pending = await send(venue.app, venue.cookie, "GET", path);
    expect(pending.json.available).toBe("-40.00");
    const restart = pending.json.confirmSequence as number;
    const saved = await recount("3.00", restart);
    expect(saved).toMatchObject({
      status: 200,
      json: { available: "3.00", recount: { counted: "3.00" } },
    });
    expect(await recount("3.00", restart)).toEqual(saved);
    expect(await send(venue.app, venue.cookie, "GET", path)).toEqual(saved);
    const done = await send(venue.app, venue.cookie, "POST", `${path}/${id}/finish`, {
      confirmSequence: saved.json.confirmSequence,
      amountLeft: "0.00",
    });
    expect(done).toMatchObject({
      status: 200,
      json: { bankWithdrawal: "3.00", difference: "43.00", slip: "queued" },
    });
    const nodes = [venue.cfg.nodeId];
    const finishId = done.json.id as string;
    const report = await inTx(venue, (tx) => readDrawerCloseForPrint(tx, nodes, finishId));
    expect(report?.count.counted).toBe("3.00");
    const history = await inTx(venue, (tx) =>
      listDrawerCloses(tx, nodes, {
        startAt: "0000-01-01T00:00:00.000Z",
        endAt: "9999-01-01T00:00:00.000Z",
      }),
    );
    expect(history).toMatchObject([
      { id, recount: { counted: "3.00" }, finished: { cashAfterCount: "0.00" } },
    ]);
    const counts = await store.db
      .select({ amount: drawerEntries.amount })
      .from(drawerEntries)
      .where(eq(drawerEntries.kind, "recount"))
      .orderBy(drawerEntries.sequence);
    expect(counts.map(({ amount }) => amount)).toEqual(alreadyRecounted ? [1000, 300] : [300]);
  },
);

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

it("prints the close in the staff member's saved language on a till set to another language", async () => {
  await inTx(venue, (tx) => setPersonLocale(tx, { personId: venue.operatorId, locale: "es-ES" }));
  const saved = await postCount({});
  const firstId = (saved.json.first as { id: string }).id;
  const response = await venue.app.request(`${path}/${firstId}/finish`, {
    method: "POST",
    headers: {
      cookie: venue.cookie,
      "content-type": "application/json",
      "accept-language": "en-GB",
    },
    body: JSON.stringify({ confirmSequence: 1, amountLeft: "2.00" }),
  });
  expect(response.status).toBe(200);
  const { id } = (await response.json()) as { id: string };
  const close = (await inTx(venue, (tx) => readDrawerCloseForPrint(tx, [venue.cfg.nodeId], id)))!;
  const [job] = await store.db.select().from(printJobs);
  const paper = { paperWidth: "80mm", resolution: "180dpi" } as const;
  expect(job?.payload).toEqual(formatDrawerCloseTicket(close, paper, "es-ES", "Europe/Madrid"));
  expect(job?.payload).not.toEqual(formatDrawerCloseTicket(close, paper, "en-GB", "Europe/Madrid"));
});

it("offers a close for cash on an assigned till and keeps the balance when the same printer returns", async () => {
  const order = await tabWith(venue, "Croquettes");
  expect((await cashPayment(venue, venue.cookie, order, "10.00")).status).toBe(200);

  const read = (id: string) => inTx(venue, (tx) => readPrinterDeleteImpact(tx, id));
  expect(await read(printerId)).toMatchObject({
    drawerClose: { devices: expect.arrayContaining([{ id: venue.deviceId, name: "Barra" }]) },
  });

  const drawerSetting = (hasCashDrawer: boolean) =>
    inTx(venue, (tx) =>
      tx.update(printers).set({ hasCashDrawer }).where(eq(printers.id, printerId)),
    );
  await drawerSetting(false);
  expect(await read(printerId)).toMatchObject({
    drawerClose: { devices: [], needsDrawerSetting: true },
  });
  await drawerSetting(true);

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
