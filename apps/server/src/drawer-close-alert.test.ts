import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  appendDrawerEntry,
  billPayments,
  CORE_MIGRATIONS,
  devices,
  finishDrawerClose,
  isReceiptPrinter,
  menus,
  printers,
  saveDrawerCount,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { createPrinter } from "@waitron/printing";
import { decimal } from "@waitron/shared";
import { createDepartment, replaceMenuWeek, saveMenuPeriod } from "@waitron/venue-service";
import { drawerCloseAlertSource } from "./alert-sources.js";
import { createAlertRegistry, readOpenAlerts } from "./alerts.js";

const store = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const friday = "2026-11-20T17:00:00.000Z";
const saturdayStart = "2026-11-21T05:00:00.000Z";
let actor: { nodeId: string; personId: string; deviceId: string; printerId: string };

const createDrawer = (tx: Transaction, name: string) =>
  createPrinter(tx, { name, transport: "network_tcp", host: `${name}.test`, hasCashDrawer: true });

beforeEach(async () => {
  await seedVenue(store.db, { timeZone: "Europe/Madrid", dayCutover: "06:00" });
  const nodeId = await seedNode(store.db);
  const { deviceId } = await seedDevice(store.db, { capabilities: ["open-cash-drawer"] });
  actor = await withTransaction(store.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: "Alex" });
    const drawer = await createDrawer(tx, "Bar");
    await tx
      .update(devices)
      .set({ cashDrawerPrinterId: drawer.id })
      .where(eq(devices.id, deviceId));
    return { nodeId, personId: person!.id, deviceId, printerId: drawer.id };
  });
});

function warnings(instant: string) {
  return withTransaction(store.db, (tx) =>
    readOpenAlerts(
      tx,
      {
        registry: createAlertRegistry({ claims: [], sources: [drawerCloseAlertSource()] }),
        now: new Date(instant),
        log: () => {},
      },
      new Set(["report.view"]),
    ),
  );
}

function cash(amount: number, recordedAt = friday) {
  return withTransaction(store.db, (tx) =>
    appendDrawerEntry(tx, {
      ...actor,
      kind: amount > 0 ? "cash_in" : "cash_out",
      amount,
      recordedAt,
    }),
  );
}

async function openingHours(openingWeekday: number, departments: [string, string][]) {
  await withTransaction(store.db, async (tx) => {
    const [menu] = await tx.insert(menus).values({ name: "Dinner menu" }).returning();
    for (const [name, endsAt] of departments) {
      const { id: department } = await createDepartment(tx, { name, orderStart: "table" });
      const { id: periodId } = await saveMenuPeriod(tx, department, {
        name: "Dinner",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        department,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: weekday === openingWeekday ? [{ periodId, startsAt: "18:00", endsAt }] : [],
        })),
        new Date(friday),
        1,
      );
    }
  });
}

it("waits one hour after the last department closes, including an overnight close", async () => {
  await openingHours(5, [
    ["Restaurant", "22:00"],
    ["Terrace", "01:30"],
  ]);
  await cash(1000);
  expect(await warnings("2026-11-21T01:29:59.999Z")).toEqual([]);
  expect(await warnings("2026-11-21T01:30:00.000Z")).toMatchObject([
    {
      code: "drawer.close_overdue",
      params: { drawer: "Bar" },
      since: "2026-11-21T01:30:00.000Z",
      screen: "sales",
    },
  ]);
});

it("keeps Friday's reminder visible when Saturday's grace hour crosses the day start", async () => {
  await openingHours(6, [["Restaurant", "05:30"]]);
  await cash(1000);
  const fridayReminder = await warnings(saturdayStart);
  expect(fridayReminder).toMatchObject([{ since: saturdayStart }]);
  expect(await warnings("2026-11-22T05:10:00.000Z")).toEqual(fridayReminder);
  expect(await warnings("2026-11-22T05:30:00.000Z")).toMatchObject([
    { since: "2026-11-22T05:30:00.000Z" },
  ]);
});

it("uses the next business day start with no hours and clears the reminder on Finish", async () => {
  const movement = await cash(1000);
  expect(await warnings("2026-11-21T04:59:59.999Z")).toEqual([]);
  const first = await warnings(saturdayStart);
  expect(first).toMatchObject([{ since: saturdayStart }]);
  const counted = await withTransaction(store.db, (tx) =>
    saveDrawerCount(
      tx,
      { ...actor, recordedAt: "2026-11-21T05:01:00.000Z" },
      {
        startSequence: movement.sequence,
        counted: decimal("10.00"),
      },
    ),
  );
  const next = await warnings("2026-11-22T05:00:00.000Z");
  expect(next).toMatchObject([{ since: "2026-11-22T05:00:00.000Z" }]);
  expect(next[0]?.key).not.toBe(first[0]?.key);
  expect(await warnings("2026-11-22T05:01:00.000Z")).toEqual(next);
  await withTransaction(store.db, (tx) =>
    finishDrawerClose(
      tx,
      { ...actor, recordedAt: "2026-11-22T05:01:00.000Z" },
      {
        firstCountId: counted.first.id,
        confirmSequence: counted.confirmSequence,
        amountLeft: decimal("5.00"),
      },
    ),
  );
  await cash(1000, "2026-11-22T05:02:00.000Z");
  expect(await warnings("2026-11-22T05:03:00.000Z")).toEqual([]);
});

it("warns on net-zero cash movements and excludes card-only activity", async () => {
  await cash(1000);
  await cash(-1000);
  await withTransaction(store.db, async (tx) => {
    const card = await createDrawer(tx, "Card");
    const order = await seedWorkingOrder(tx);
    const [payment] = await tx
      .insert(billPayments)
      .values({
        workingOrderId: order.id,
        submissionId: randomUUID(),
        fingerprint: "card",
        kind: "contribution",
        method: "card",
        applied: 1000,
        state: "received",
        requestedBy: actor.personId,
        source: "device",
        deviceId: actor.deviceId,
        receivedAt: friday,
      })
      .returning();
    await appendDrawerEntry(tx, {
      ...actor,
      printerId: card.id,
      kind: "card_payment",
      amount: 1000,
      billPaymentId: payment!.id,
      recordedAt: friday,
    });
  });
  expect(await warnings(saturdayStart)).toMatchObject([{ params: { drawer: "Bar" } }]);
});

it("warns about a count left unfinished with cash awaiting an eligible till", async () => {
  await withTransaction(store.db, (tx) =>
    saveDrawerCount(
      tx,
      { ...actor, recordedAt: friday },
      {
        startSequence: 0,
        counted: decimal("8.00"),
      },
    ),
  );
  expect(await warnings(saturdayStart)).toMatchObject([{ code: "drawer.close_overdue" }]);
  await withTransaction(store.db, (tx) =>
    tx.update(devices).set({ active: false }).where(eq(devices.id, actor.deviceId)),
  );
  expect(await warnings(saturdayStart)).toMatchObject([
    { code: "drawer.close_overdue_unassigned", screen: "devices" },
  ]);
});

it("does not ask staff to close a deleted drawer", async () => {
  await cash(1000);
  expect(await warnings(saturdayStart)).toMatchObject([{ params: { drawer: "Bar" } }]);
  await withTransaction(store.db, (tx) =>
    tx
      .update(printers)
      .set({ active: false, deletedAt: friday })
      .where(and(isReceiptPrinter(), eq(printers.id, actor.printerId))),
  );
  expect(await warnings(saturdayStart)).toEqual([]);
});
