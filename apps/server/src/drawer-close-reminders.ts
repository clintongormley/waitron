import { and, asc, desc, eq, exists, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  deviceNotDeleted,
  deviceProfiles,
  devices,
  drawerEntries,
  isReceiptPrinter,
  printers,
  type Transaction,
} from "@waitron/db";
import { profileAllows, resolveDevicePrinterIds } from "@waitron/layouts";
import { businessDayAt, type BusinessDayClock } from "@waitron/shared";
import {
  addDays,
  clockChangesBetween,
  localTimeOccurrences,
  readPlannedServiceGuides,
  serviceDayContext,
} from "@waitron/venue-service";

const HOUR = 60 * 60_000;

async function latestReminderAt(tx: Transaction, clock: BusinessDayClock, now: Date) {
  const today = businessDayAt(clock, now);
  // The previous day's closing plus its grace hour can fall in the current business day.
  const dates = [today, addDays(today, -1), addDays(today, -2)];
  const { departmentRanges } = await readPlannedServiceGuides(tx, [], {
    kind: "dates",
    dates,
    clock,
  });
  let latest = "";
  const at = now.toISOString();
  for (const date of dates) {
    const { startAt, endAt, dayCutover } = serviceDayContext(clock, date);
    const dayEnd = Date.parse(endAt);
    const ranges = [...departmentRanges.values()].flatMap((days) => days.get(date) ?? []);
    let closing = Number.NEGATIVE_INFINITY;
    for (const { endsAt } of ranges) {
      const end = endsAt.slice(0, 5);
      const endDate = end <= dayCutover ? addDays(date, 1) : date;
      const lastOccurrence = localTimeOccurrences(endDate, end, clock.timeZone).at(-1);
      // When the clock skips a scheduled end, service ends at the jump over it.
      const instant =
        lastOccurrence ??
        clockChangesBetween(new Date(startAt), new Date(endAt), clock.timeZone)[0];
      closing = Math.max(closing, Math.min(instant?.getTime() ?? dayEnd, dayEnd));
    }
    const due = ranges.length === 0 ? endAt : new Date(closing + HOUR).toISOString();
    if (due <= at && due > latest) latest = due;
  }
  return latest;
}

async function assignedDrawers(tx: Transaction) {
  const tills = await tx
    .select({
      id: devices.id,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(devices.deviceProfileId, deviceProfiles.id))
    .where(and(eq(devices.active, true), deviceNotDeleted()));
  const assignments = await resolveDevicePrinterIds(
    tx,
    tills
      .filter((till) =>
        profileAllows({ ...till, capabilities: till.capabilities as string[] }, "open-cash-drawer"),
      )
      .map(({ id }) => id),
    "cash_drawer",
  );
  return new Set(assignments.values());
}

const finish = alias(drawerEntries, "last_finish");

export async function readDrawerCloseReminders(
  tx: Transaction,
  clock: BusinessDayClock,
  now: Date,
) {
  const due = await latestReminderAt(tx, clock, now);
  const lastFinish = tx
    .select({ sequence: finish.sequence })
    .from(finish)
    .where(and(eq(finish.printerId, printers.id), eq(finish.kind, "finish")))
    .orderBy(desc(finish.sequence))
    .limit(1);
  const outstanding = tx
    .select({ id: drawerEntries.id })
    .from(drawerEntries)
    .where(
      and(
        eq(drawerEntries.printerId, printers.id),
        gt(drawerEntries.sequence, sql<number>`coalesce((${lastFinish}), 0)`),
        lte(drawerEntries.recordedAt, due),
        inArray(drawerEntries.kind, [
          "cash_payment",
          "cash_refund",
          "cash_in",
          "cash_out",
          "count",
        ]),
      ),
    );
  const drawers = await tx
    .select({ id: printers.id, name: printers.name })
    .from(printers)
    .where(
      and(
        isReceiptPrinter(),
        isNull(printers.deletedAt),
        eq(printers.hasCashDrawer, true),
        exists(outstanding),
      ),
    )
    .orderBy(asc(printers.name), asc(printers.id));
  if (drawers.length === 0) return [];
  const assigned = await assignedDrawers(tx);
  return drawers.map(({ id, name }) => ({ id, name, since: due, needsTill: !assigned.has(id) }));
}
