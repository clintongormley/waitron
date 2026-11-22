import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import {
  appendDrawerEntry,
  CORE_MIGRATIONS,
  CORE_CHANGE_SOURCES,
  installChangeFeed,
  saveDrawerCount,
  recountDrawer,
  finishDrawerClose,
  subscribeToChanges,
  devices,
  handoverActivations,
  isReceiptPrinter,
  printers,
  printJobs,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { createPrinter } from "@waitron/printing";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { decimal, stringToCents } from "@waitron/shared";
import { mountReportApi } from "./report-api.js";
import { opensDrawer, printedLines } from "./testing/decode-ticket.js";

const store = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const path = "/management-api/reports/drawer-closes";
const onDay = "?from=2026-11-20&to=2026-11-20";
let app: Hono;
let nodeId: string;
let oldNode: string;
let otherNode: string;
let drawer: string;
let sparePrinter: string;
let supervisor: string;
let staff: string;
let alex: string;
let robin: string;

beforeEach(async () => {
  await seedVenue(store.db);
  nodeId = await seedNode(store.db);
  oldNode = await seedNode(store.db);
  otherNode = await seedNode(store.db);
  const { deviceId } = await seedDevice(store.db);
  await withTransaction(store.db, async (tx) => {
    const [first, second] = [
      await seedPersons(tx, { displayName: "Alex", role: "supervisor" }),
      await seedPersons(tx, { displayName: "Robin", role: "staff" }),
    ];
    alex = first[0]!.id;
    robin = second[0]!.id;
    const login = async (personId: string) => {
      const { token } = await startManagementSession(tx, { method: "password", personId });
      return `${MANAGEMENT_COOKIE}=${token}`;
    };
    supervisor = await login(alex);
    staff = await login(robin);
    drawer = (
      await createPrinter(tx, {
        name: "Bar drawer",
        transport: "network_tcp",
        host: "bar.test",
        hasCashDrawer: true,
      })
    ).id;
    sparePrinter = (
      await createPrinter(tx, {
        name: "Office receipt printer",
        transport: "network_tcp",
        host: "office.test",
      })
    ).id;
    await tx.update(devices).set({ cashDrawerPrinterId: drawer }).where(eq(devices.id, deviceId));
    await tx.insert(handoverActivations).values({
      operationId: randomUUID(),
      scenario: "controlled",
      sourceNodeId: oldNode,
      destinationNodeId: nodeId,
      evidence: {
        purpose: "waitron.handover.relinquishment.v1",
        signerNodeId: oldNode,
        body: {},
        signature: "fixture",
      },
      personId: alex,
      activatedAt: "2026-11-20T12:00:00.000Z",
    });
  });
  app = new Hono();
  mountReportApi(app, { db: store.db, cfg: { nodeId }, venueLocale: "en-GB" }, () => {});
});

async function saveCount(forNode: string, printerId: string, recordedAt: string) {
  return withTransaction(store.db, (tx) =>
    appendDrawerEntry(tx, {
      printerId,
      nodeId: forNode,
      personId: alex,
      recordedAt,
      kind: "count",
      amount: stringToCents("8.00"),
      facts: { expected: "10.00", cashMovedWhileCounting: true },
    }),
  );
}

async function finish(firstCountId: string, forNode = nodeId) {
  return withTransaction(store.db, async (tx) => {
    await appendDrawerEntry(tx, {
      printerId: drawer,
      nodeId: forNode,
      personId: robin,
      recordedAt: "2026-11-20T18:01:00.000Z",
      kind: "recount",
      firstCountId,
      amount: stringToCents("9.00"),
      facts: { expected: "10.00", cashMovedWhileCounting: false },
    });
    return appendDrawerEntry(tx, {
      printerId: drawer,
      nodeId: forNode,
      personId: robin,
      recordedAt: "2026-11-20T18:02:00.000Z",
      kind: "finish",
      firstCountId,
      amount: stringToCents("6.00"),
      facts: { amountLeft: "3.00", difference: "-1.00" },
    });
  });
}

const get = (query = onDay, cookie = supervisor) =>
  app.request(path + query, { headers: { cookie } });
const print = (id: string, printerId: string, cookie = supervisor) =>
  app.request(`${path}/${id}/print`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ printerId }),
  });

it("lists pending and finished drawer counts in the selected Sales dates, including inherited counts", async () => {
  const first = await saveCount(oldNode, drawer, "2026-11-19T18:00:00.000Z");
  const done = await finish(first.id);
  const pending = await saveCount(nodeId, drawer, "2026-11-20T19:00:00.000Z");
  await saveCount(otherNode, drawer, "2026-11-20T20:00:00.000Z");
  const overnight = await saveCount(nodeId, sparePrinter, "2026-11-19T22:00:00.000Z");
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    timeZone: "Europe/Madrid",
    closes: [
      {
        id: pending.id,
        drawerId: drawer,
        drawerName: "Bar drawer",
        assigned: true,
        finished: null,
        recount: null,
      },
      {
        id: first.id,
        first: { person: "Alex", counted: "8.00", difference: "-2.00", cashMoved: true },
        recount: { person: "Robin", counted: "9.00", difference: "-1.00", cashMoved: false },
        finished: { id: done.id, person: "Robin", bankWithdrawal: "6.00", amountLeft: "3.00" },
      },
      { id: overnight.id, finished: null },
    ],
  });
  expect(await (await get("?from=2026-11-21&to=2026-11-21")).json()).toMatchObject({
    closes: [{ id: pending.id }, { id: overnight.id }],
  });
});

it("queues only a document on the selected active receipt printer for a deleted drawer", async () => {
  const done = await withTransaction(store.db, async (tx) => {
    const actor = (minute: string) => ({
      nodeId,
      printerId: drawer,
      personId: alex,
      deviceId: null,
      recordedAt: `2026-11-20T18:${minute}:00.000Z`,
    });
    const cashIn = (minute: string, amount: number) =>
      appendDrawerEntry(tx, { ...actor(minute), kind: "cash_in", amount });
    const firstDeposit = await cashIn("00", 700);
    const firstClose = await saveDrawerCount(tx, actor("01"), {
      counted: decimal("7.00"),
      startSequence: firstDeposit.sequence,
    });
    await finishDrawerClose(tx, actor("02"), {
      firstCountId: firstClose.first.id,
      confirmSequence: firstClose.confirmSequence,
      amountLeft: decimal("3.00"),
    });
    const nextDeposit = await cashIn("03", 1000);
    const counted = await saveDrawerCount(tx, actor("04"), {
      counted: decimal("12.00"),
      startSequence: nextDeposit.sequence - 1,
    });
    await recountDrawer(tx, actor("05"), {
      firstCountId: counted.first.id,
      counted: decimal("13.00"),
      startSequence: counted.confirmSequence,
    });
    const afterCount = await cashIn("06", 200);
    const close = await finishDrawerClose(tx, actor("07"), {
      firstCountId: counted.first.id,
      confirmSequence: afterCount.sequence,
      amountLeft: decimal("4.00"),
    });
    await cashIn("08", 2500);
    return close;
  });
  await store.db
    .update(printers)
    .set({ active: false, deletedAt: done.recordedAt })
    .where(and(isReceiptPrinter(), eq(printers.id, drawer)));
  await store.db
    .update(devices)
    .set({ cashDrawerPrinterId: null })
    .where(eq(devices.cashDrawerPrinterId, drawer));

  const response = await print(done.id, sparePrinter);
  expect(response.status).toBe(202);
  const { jobId } = await response.json();
  const [job] = await store.db.select().from(printJobs).where(eq(printJobs.id, jobId));
  expect(job).toMatchObject({ printerId: sparePrinter, kind: "document" });
  expect(opensDrawer(job!.payload!)).toBe(false);
  const lines = printedLines(job!.payload!).map((line) => line.trim().replace(/ +/g, " "));
  expect(lines).toEqual(
    expect.arrayContaining([
      "Bar drawer",
      "From 20/11/2026, 19:02",
      "Cash in €12.00",
      "Counted €13.00",
      "Cash moved after the count +€2.00",
      "For the bank €11.00",
      "Cash left €4.00",
    ]),
  );
  expect(lines).not.toContain("Cash moved while counting.");
  expect((await print(done.id, drawer)).status).toBe(404);
  expect(await (await get()).json()).toMatchObject({
    closes: [
      { assigned: false, deleted: true, finished: { cashAfterCount: "2.00" } },
      { assigned: false, deleted: true, finished: { cashAfterCount: "0.00" } },
    ],
  });
});

it("requires report.view and scopes reprints even when the requested ids exist", async () => {
  const first = await saveCount(otherNode, drawer, "2026-11-20T18:00:00.000Z");
  const done = await finish(first.id, otherNode);
  const localFirst = await saveCount(nodeId, drawer, "2026-11-20T18:00:00.000Z");
  const foreignFinish = await finish(localFirst.id, otherNode);
  const refused = await get(onDay, staff);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect((await print(done.id, sparePrinter, staff)).status).toBe(403);
  for (const id of [done.id, first.id, foreignFinish.id, randomUUID()]) {
    const response = await print(id, sparePrinter);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "drawer.close_not_found" } });
  }
  expect(await (await get()).json()).toMatchObject({
    closes: [{ id: localFirst.id, recount: null, finished: null }],
  });
  expect(await store.db.select().from(printJobs)).toEqual([]);
});

it("uses the existing change feed to notify Sales after a count is committed", async () => {
  await installChangeFeed(store.db, CORE_CHANGE_SOURCES);
  const events: unknown[] = [];
  const stop = subscribeToChanges((change) => events.push(change.resources));
  try {
    const pending = await saveCount(nodeId, drawer, "2026-11-20T18:00:00.000Z");
    expect(events).toContainEqual([{ type: "drawer_entries", id: pending.id }]);
  } finally {
    stop();
  }
});
