import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import * as closes from "./index.js";
import { appendDrawerEntry } from "./drawer-entries.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { drawerEntries } from "./schema/drawer-entries.js";
import { printers } from "./schema/printers.js";
import { seedDevice, seedNode, seedPerson, seedVenueSettings } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const recordedAt = "2026-11-21T12:00:00.000Z";

let first: {
  printerId: string;
  nodeId: string;
  personId: string;
  deviceId: string;
  recordedAt: string;
};
let second: typeof first;
let otherPrinterId: string;

beforeEach(async () => {
  await seedVenueSettings(fx.db);
  const nodeId = await seedNode(fx.db);
  const [bar, terrace] = await fx.db
    .insert(printers)
    .values([
      { name: "Bar drawer", transport: "network_tcp", host: "bar.test", hasCashDrawer: true },
      { name: "Other drawer", transport: "network_tcp", host: "other.test", hasCashDrawer: true },
    ])
    .returning();
  first = {
    printerId: bar!.id,
    nodeId,
    personId: await seedPerson(fx.db),
    deviceId: (await seedDevice(fx.db)).deviceId,
    recordedAt,
  };
  second = {
    ...first,
    personId: await seedPerson(fx.db, { displayName: "Second operator" }),
    deviceId: (await seedDevice(fx.db)).deviceId,
  };
  otherPrinterId = terrace!.id;
});

function current(printerId = first.printerId) {
  return withTransaction(fx.db, (tx) => closes.readDrawerClose(tx, printerId));
}

function count(counted: string, startSequence = 0, actor = first) {
  return withTransaction(fx.db, (tx) =>
    closes.saveDrawerCount(tx, actor, { counted: decimal(counted), startSequence }),
  );
}

function recount(firstCountId: string, counted: string, startSequence: number) {
  return withTransaction(fx.db, (tx) =>
    closes.recountDrawer(tx, second, { firstCountId, counted: decimal(counted), startSequence }),
  );
}

function finish(firstCountId: string, amountLeft: string, confirmSequence: number) {
  return withTransaction(fx.db, (tx) =>
    closes.finishDrawerClose(tx, second, {
      firstCountId,
      amountLeft: decimal(amountLeft),
      confirmSequence,
    }),
  );
}

function move(amount: number) {
  return withTransaction(fx.db, (tx) =>
    appendDrawerEntry(tx, {
      ...second,
      kind: amount > 0 ? "cash_in" : "cash_out",
      amount,
      recordedAt: "2026-11-21T11:00:00.000Z",
    }),
  );
}

it("saves the count before disclosing the difference and lets another till resume after a lost response", async () => {
  await move(9000);
  expect(await current()).toEqual({ state: "new", openingCash: "0.00", startSequence: 1 });
  const saved = await count("100.00", 1);
  expect(saved).toMatchObject({
    state: "counted",
    first: {
      personId: first.personId,
      counted: "100.00",
      expected: "90.00",
      difference: "10.00",
      cashMovedWhileCounting: false,
      throughSequence: 1,
    },
    recount: null,
    available: "100.00",
    confirmSequence: 2,
  });
  expect(await count("100.00", 1)).toEqual(saved);
  expect(await count("99.00", 1, second)).toEqual(saved);
  expect(await current()).toEqual(saved);
  expect(
    await fx.db.select().from(drawerEntries).where(eq(drawerEntries.kind, "count")),
  ).toHaveLength(1);
});

it("includes a cash write that commits before a waiting count and records that it moved during counting", async () => {
  let release!: () => void;
  let held!: () => void;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = withTransaction(fx.db, async (tx) => {
    await appendDrawerEntry(tx, { ...second, kind: "cash_in", amount: 9000 });
    held();
    await released;
  });
  await holding;
  const saving = count("100.00");
  release();
  await write;
  expect(await saving).toMatchObject({
    first: {
      expected: "90.00",
      difference: "10.00",
      cashMovedWhileCounting: true,
      throughSequence: 1,
    },
  });
});

it("keeps both counts and their authors and allows only one recount of the entire drawer", async () => {
  await move(9000);
  const saved = await count("100.00", 1);
  expect(saved).toMatchObject({ first: { difference: "10.00" } });
  await move(2000);
  const recounted = await recount(saved.first.id, "109.00", saved.confirmSequence);
  expect(recounted).toMatchObject({
    first: { personId: first.personId, counted: "100.00" },
    recount: {
      personId: second.personId,
      counted: "109.00",
      expected: "110.00",
      difference: "-1.00",
      cashMovedWhileCounting: true,
    },
    available: "109.00",
  });
  expect(await recount(saved.first.id, "109.00", saved.confirmSequence)).toEqual(recounted);
  await expect(recount(saved.first.id, "110.00", recounted.confirmSequence)).rejects.toMatchObject({
    code: "drawer.recount_unavailable",
  });
});

it("refuses to link a recount to a different drawer, a non-count entry or an unknown count", async () => {
  const movement = await move(9000);
  const foreign = await count("25.00", 0, { ...first, printerId: otherPrinterId });
  const own = await count("100.00", 1);
  expect(own).toMatchObject({ state: "counted" });
  for (const id of [foreign.first.id, movement.id, randomUUID()]) {
    await expect(recount(id, "95.00", own.confirmSequence)).rejects.toMatchObject({
      code: "drawer.close_not_found",
    });
  }
  expect(await current()).toEqual(own);
});

it("refuses a recount of a matching first count", async () => {
  const saved = await count("0.00");
  expect(saved).toMatchObject({ first: { difference: "0.00" } });
  await expect(recount(saved.first.id, "1.00", saved.confirmSequence)).rejects.toMatchObject({
    code: "drawer.recount_unavailable",
  });
});

it("refreshes a stale withdrawal, keeps the count difference, and starts the next balance from cash left", async () => {
  await move(9000);
  const saved = await count("100.00", 1);
  expect(saved).toMatchObject({ available: "100.00" });
  const id = saved.first.id;
  await move(3000);
  await move(-500);
  await expect(finish(id, "20.00", saved.confirmSequence)).rejects.toMatchObject({
    code: "drawer.close_changed",
  });
  const live = await current();
  expect(live).toMatchObject({
    available: "125.00",
    first: { difference: "10.00" },
    confirmSequence: 4,
  });
  const done = await finish(id, "20.00", 4);
  expect(done).toMatchObject({
    state: "finished",
    bankWithdrawal: "105.00",
    amountLeft: "20.00",
    difference: "10.00",
    throughSequence: 4,
    personId: second.personId,
  });
  expect(await current()).toEqual({ state: "new", openingCash: "20.00", startSequence: 5 });
  await expect(count("100.00", 1)).rejects.toMatchObject({ code: "drawer.close_changed" });
  await move(700);
  expect(await finish(id, "20.00", 4)).toEqual(done);
  await expect(finish(id, "30.00", 4)).rejects.toMatchObject({ code: "drawer.close_changed" });
  const next = await count("27.00", 6);
  expect(next).toMatchObject({ first: { expected: "27.00", difference: "0.00" } });
  const rows = await fx.db.select().from(drawerEntries).where(eq(drawerEntries.kind, "finish"));
  expect(rows).toEqual([expect.objectContaining({ firstCountId: id, amount: 10500, sequence: 5 })]);
  await expect(
    withTransaction(fx.db, (tx) =>
      tx.update(drawerEntries).set({ amount: 0 }).where(eq(drawerEntries.id, rows[0]!.id)),
    ),
  ).rejects.toThrow(/append.only/i);
});

it("refuses to leave more money than remains after cash goes out", async () => {
  const saved = await count("10.00");
  expect(saved).toMatchObject({ available: "10.00" });
  await move(-1200);
  expect(await current()).toMatchObject({ available: "-2.00" });
  await expect(finish(saved.first.id, "0.00", 2)).rejects.toMatchObject({
    code: "drawer.close_invalid_amount",
    params: { field: "amountLeft" },
  });
  expect(await current()).toMatchObject({ state: "counted" });
});
