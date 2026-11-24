import "./errors.js";
import {
  type Transaction,
  orderGroups,
  workingOrderLines,
  workingOrders,
  ticketItems,
  kitchenCourses,
  parties,
  lineServiceCancellations,
  unpaidDepartures,
  persons,
  devices,
} from "@waitron/db";
import {
  staffPresentationName,
  thousandthsToDecimal,
  AppError,
  centsToDecimal,
  toScale,
  sumDecimals,
  MONEY_SCALE,
} from "@waitron/shared";
import { inArray, and, eq, ne, asc, isNull, sql, or, type SQL, notInArray } from "drizzle-orm";
import { initiatedItem, type KitchenPhase, initiatedAt, kitchenPhase } from "./kitchen-phase.js";
import { leftToServe, type TicketState } from "./kitchen-print.js";
import { readCourseFireNowZones } from "./kitchen.js";
import { type LineNutrition, readDisplayLineNutrition } from "./line-nutrition.js";
import {
  readLineCancellations,
  serviceQuantities,
  serviceCompletedAt,
} from "./line-service-state.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  currentRevision,
  readGroupNumberLabels,
  groupNumberIdentity,
  nextGroupNumber,
} from "./order-group-records.js";
import { partyFirstZones, partyFamily } from "./parties.js";
import { trimQuantityForDisplay } from "./receipt-lines.js";
import { notSetMenuLine } from "./set-menu-bill.js";
import { stillMovable } from "./station-move.js";
import { earliestTime, latestTime } from "./time-order.js";
import { dishesWithHeldExtra, isReleased, dishReleased } from "./working-order-serving.js";

export interface OrderGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  firedAt: string | null;
  remindAt: string | null;
  /** Present when the group is fired, dishes are left to serve and every kitchen item left to serve
   *  is ready (recorded ready, or made here); or when at least one kitchen item the waiter asked for
   *  is left to serve and every such item is ready. */
  ready?: true;
  lineIds: string[];
  courseIds: string[];
  /** The dishes by staff name, e.g. "2 × Steak, 1 × Fish". */
  summary: string;
}
/** The party's groups in sequence, removed ones left out, with the party's revision. */
export async function listOrderGroups(
  tx: Transaction,
  partyId: string,
): Promise<{ revision: number; groups: OrderGroup[] }> {
  return { revision: await currentRevision(tx, partyId), groups: await readGroups(tx, partyId) };
}
/** The party's groups in sequence, removed ones left out; only those named, when `only` is given. */
export async function readGroups(
  tx: Transaction,
  partyId: string,
  only?: readonly string[],
): Promise<OrderGroup[]> {
  const numberLabels = await readGroupNumberLabels(tx, [partyId]);
  const scope = only === undefined ? [] : [inArray(orderGroups.id, [...only])];
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      displayNumber: orderGroups.displayNumber,
      numberPartyId: orderGroups.numberPartyId,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
    })
    .from(orderGroups)
    .where(and(eq(orderGroups.partyId, partyId), ne(orderGroups.state, "removed"), ...scope))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      groupId: workingOrderLines.groupId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      courseId: workingOrderLines.courseId,
    })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        eq(orderGroups.partyId, partyId),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        onShownBill(),
        ...scope,
      ),
    )
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
  const remaining = leftToServe();
  const ready = or(eq(ticketItems.madeHere, true), eq(ticketItems.state, "ready"));
  const kitchen = await tx
    .select({
      groupId: workingOrderLines.groupId,
      remaining: sql<number>`count(*) filter (where ${initiatedItem()} and ${remaining})`,
      ready: sql<number>`count(*) filter (where ${initiatedItem()} and ${remaining} and ${ready})`,
      notReady: sql<number>`count(*) filter (where ${remaining} and not ${ready})`,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(eq(orderGroups.partyId, partyId), onShownBill(), ...scope))
    .groupBy(workingOrderLines.groupId);
  const readyGroups = new Set(
    kitchen
      .filter((row) => row.remaining > 0 && row.ready === row.remaining)
      .map((row) => row.groupId!),
  );
  const kitchenWaiting = new Set(
    kitchen.filter((row) => row.notReady > 0).map((row) => row.groupId!),
  );
  const linesByGroup = new Map<string, typeof lines>();
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  for (const line of lines) {
    const own = linesByGroup.get(line.groupId!) ?? [];
    own.push(line);
    linesByGroup.set(line.groupId!, own);
  }
  return groups.map((group) => {
    const own = linesByGroup.get(group.id) ?? [];
    const quantities = own.map((line) => ({
      line,
      ...serviceQuantities(line.quantity, line.servedQuantity, cancellations.get(line.id) ?? 0),
    }));
    const active = quantities
      .filter(({ active }) => active > 0)
      .map(({ line, active }) => ({ ...line, quantity: active }));
    const isReady =
      readyGroups.has(group.id) ||
      (group.state === "fired" &&
        !kitchenWaiting.has(group.id) &&
        quantities.some(({ remaining }) => remaining > 0));
    const counts = new Map<string, number>();
    for (const line of active) {
      const label = staffPresentationName(line);
      counts.set(label, (counts.get(label) ?? 0) + line.quantity);
    }
    return {
      ...group,
      ...groupNumberIdentity(group),
      ...(numberLabels.has(group.id) ? { numberPartyLabel: numberLabels.get(group.id)! } : {}),
      state: group.state as "held" | "fired",
      ...(isReady ? { ready: true as const } : {}),
      lineIds: active.map((line) => line.id),
      courseIds: [
        ...new Set(own.flatMap((line) => (line.courseId === null ? [] : [line.courseId]))),
      ],
      summary: [...counts]
        .map(
          ([label, quantity]) =>
            `${trimQuantityForDisplay(thousandthsToDecimal(quantity))} × ${label}`,
        )
        .join(", "),
    };
  });
}
/** The group waiting to be released, and when staff are reminded to release it (D11). */
export interface ReleaseReminder {
  groupId: string;
  /** Null while earlier active dishes remain unserved, or when no completion dates it. */
  dueAt: string | null;
}
/** `servedAt` carries the effective completion time, including charged cancellation. */
export function releaseReminder(
  groups: readonly Pick<OrderGroup, "id" | "state" | "remindAt">[],
  lines: readonly { groupId: string | null; servedAt: string | null; fullyCancelled?: true }[],
  minutesFor: (groupId: string) => number | null,
): ReleaseReminder | null {
  const waiting = groups.findIndex((group) => {
    if (group.state !== "held" || minutesFor(group.id) === null) return false;
    const own = lines.filter((line) => line.groupId === group.id);
    return own.length === 0 || own.some((line) => line.fullyCancelled !== true);
  });
  if (waiting === -1) return null;
  const { id: groupId, remindAt } = groups[waiting]!;
  const minutes = minutesFor(groupId)!;
  const ahead = new Set(groups.slice(0, waiting).map((group) => group.id));
  let latest: number | null = null;
  for (const line of lines) {
    if (line.groupId === null || !ahead.has(line.groupId)) continue;
    if (line.servedAt === null) return { groupId, dueAt: null };
    latest = Math.max(latest ?? Number.NEGATIVE_INFINITY, Date.parse(line.servedAt));
  }
  if (remindAt !== null) return { groupId, dueAt: remindAt };
  return {
    groupId,
    dueAt: latest === null ? null : new Date(latest + minutes * 60_000).toISOString(),
  };
}

async function partyCourseSettings(
  tx: Transaction,
  partyIds: readonly string[],
  firstZones?: ReadonlyMap<string, string>,
) {
  const zones = firstZones ?? (await partyFirstZones(tx, partyIds));
  const byZone = await VENUE_SERVICE.readCourseSettingsByZone(tx, [...new Set(zones.values())]);
  return new Map(partyIds.map((id) => [id, byZone.get(zones.get(id) ?? "") ?? []]));
}
function groupReminderMinutes(
  lines: readonly { groupId: string | null; courseId: string | null }[],
  courses: readonly { id: string; displayOrder: number }[],
  settings: readonly { courseId: string; reminderMinutes: number | null }[],
): (groupId: string) => number | null {
  const ordered = [...courses].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
  );
  return (groupId) => {
    const ids = new Set(
      lines.filter((line) => line.groupId === groupId).map((line) => line.courseId),
    );
    const course = ordered.find((course) => ids.has(course.id));
    const setting = settings.find((setting) => setting.courseId === course?.id);
    return setting === undefined ? 10 : setting.reminderMinutes;
  };
}
/**
 * Each of these parties' release reminders ({@link releaseReminder}), keyed by party, measured
 * from the department of each party's first table's zone (`firstZones` when given, else
 * {@link partyFirstZones}). A party that is not open has none: it can no longer fire or snooze a
 * group. A line on an abandoned bill is left out, as {@link readCurrentOrders} leaves it out.
 */
export async function readReleaseReminders(
  tx: Transaction,
  partyIds: readonly string[],
  firstZones?: ReadonlyMap<string, string>,
): Promise<Map<string, ReleaseReminder | null>> {
  const reminders = new Map<string, ReleaseReminder | null>(partyIds.map((id) => [id, null]));
  if (partyIds.length === 0) return reminders;
  const settings = await partyCourseSettings(tx, partyIds, firstZones);
  const courses = await tx
    .select({ id: kitchenCourses.id, displayOrder: kitchenCourses.displayOrder })
    .from(kitchenCourses);
  const groups = await tx
    .select({
      id: orderGroups.id,
      partyId: orderGroups.partyId,
      state: orderGroups.state,
      remindAt: orderGroups.remindAt,
    })
    .from(orderGroups)
    .innerJoin(parties, eq(parties.id, orderGroups.partyId))
    .where(
      and(
        inArray(orderGroups.partyId, [...partyIds]),
        ne(orderGroups.state, "removed"),
        eq(parties.state, "open"),
      ),
    )
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  if (groups.length === 0) return reminders;
  const lines = await tx
    .select({
      groupId: workingOrderLines.groupId,
      courseId: workingOrderLines.courseId,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      cancelledQuantity: sql<number>`coalesce(${lineServiceCancellations.quantity}, 0)`,
      cancelledAt: lineServiceCancellations.cancelledAt,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(
      and(
        inArray(
          workingOrderLines.groupId,
          groups.map((group) => group.id),
        ),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        onShownBill(),
      ),
    );
  for (const partyId of new Set(groups.map((group) => group.partyId))) {
    const active = new Set(lines.map((line) => line.groupId));
    const own = groups.filter((group) => group.partyId === partyId && active.has(group.id));
    const ids = new Set(own.map((group) => group.id));
    reminders.set(
      partyId,
      releaseReminder(
        own.map((group) => ({ ...group, state: group.state as "held" | "fired" })),
        lines
          .filter((line) => ids.has(line.groupId!))
          .map((line) => ({
            groupId: line.groupId,
            servedAt: serviceCompletedAt(line),
            ...(line.cancelledQuantity >= line.quantity ? { fullyCancelled: true as const } : {}),
          })),
        groupReminderMinutes(lines, courses, settings.get(partyId) ?? []),
      ),
    );
  }
  return reminders;
}
/**
 * How many dishes each of these open parties holds in its own held groups, as the `held` signal
 * counts them, keyed by party; a party holding none is absent. The lines are filtered as
 * {@link readReleaseReminders} filters them, so a party with a reminder always has a count.
 */
export async function readHeldCounts(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (partyIds.length === 0) return counts;
  const lines = await tx
    .select({
      partyId: orderGroups.partyId,
      quantity: workingOrderLines.quantity,
      countAsPortions: workingOrderLines.countAsPortions,
      cancelledQuantity: sql<number>`coalesce(${lineServiceCancellations.quantity}, 0)`,
    })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(parties, eq(parties.id, orderGroups.partyId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(
      and(
        inArray(orderGroups.partyId, [...partyIds]),
        eq(orderGroups.state, "held"),
        eq(parties.state, "open"),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        onShownBill(),
      ),
    );
  for (const line of lines) {
    const { active } = serviceQuantities(line.quantity, 0, line.cancelledQuantity);
    if (active <= 0) continue;
    const items = !line.countAsPortions || active % 1000 !== 0 ? 1 : active / 1000;
    counts.set(line.partyId, (counts.get(line.partyId) ?? 0) + items);
  }
  return counts;
}
/** What the kitchen has recorded for a dish row: nothing is inferred, so a station that never
 * records progress leaves `queued` with its fired time. */
export interface CurrentOrderKitchen {
  state: TicketState;
  stationId: string;
  movable: boolean;
  phase: KitchenPhase;
  requestedAt: string | null;
  firedAt: string | null;
}
/** An extra picked with a dish; it is served with its dish, never on its own. */
export interface CurrentOrderExtra {
  lineId: string;
  /** The staff name. */
  name: string;
  quantity: string;
  netAmount: string;
  unitPriceGross: string;
  priceQuantity: string;
  /** Present only for food cancelled while its charge remains on the bill. */
  cancelledQuantity?: string;
}
/** A dish line of the party, on whichever of its bills, a paid one included. */
export interface CurrentOrderRow {
  billStatus: (typeof workingOrders.$inferSelect)["status"];
  /** Stored dish and extras total, after adjustments. */
  netAmount: string;
  /** All kitchen components must be ready; no kitchen work leaves this null. */
  readyAt: string | null;
  /** The earliest initiation of its kitchen components once every one is initiated, else null;
   *  `firedAt` for a dish with no kitchen work. */
  requestedAt: string | null;
  firedAt: string | null;
  /** First-send time, independent of whether Serve is currently available. */
  sentAt?: string;
  nutrition?: LineNutrition;
  lineId: string;
  workingOrderId: string;
  lineNo: number;
  courseId: string | null;
  /** The staff name, the variant's on a variant line. */
  name: string;
  quantity: string;
  /** Part of the billed quantity cancelled without removing its charge. */
  cancelledQuantity?: string;
  /** Decimal places the line's unit takes, so a part can be served. */
  unitPrecision: number | null;
  countsWholePortions?: boolean;
  servedQuantity: string;
  servedAt: string | null;
  /** Whether Serve is offered: the waiter has asked for the dish ({@link serviceRequested}) and
   *  none of its extras is held. */
  released: boolean;
  /** Null for a dish with no kitchen item, such as one needing no preparation. */
  kitchen: CurrentOrderKitchen | null;
  note: string | null;
  extras: CurrentOrderExtra[];
}

export interface CurrentOrderGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  firedAt: string | null;
  /** A snooze's time, until it is cleared or the group fires, empties or moves in a reorder. */
  remindAt: string | null;
  /** A fired group's firing; a held group's holding. */
  sentAt: string;
  /** The name of the person or device recorded as the sender, if one was recorded. */
  sentBy: string | null;
  rows: CurrentOrderRow[];
}
/** What the party has ordered and what is known of it (spec §4 Current orders). */
export interface CurrentOrders {
  revision: number;
  hasGroups: boolean;
  nextDisplayNumber: number;
  retainedCourses: { id: string; name: string; displayOrder: number; fireNowZoneIds: string[] }[];
  reminder: ReleaseReminder | null;
  /** In sequence, removed ones left out. */
  groups: CurrentOrderGroup[];
  /** Dish lines in no group, such as a round sent straight to a bill. */
  ungrouped: CurrentOrderRow[];
}
/** Recorded debts retain their financial history but no longer take part in table service. */
export function onShownBill(): SQL {
  return and(
    ne(workingOrders.status, "abandoned"),
    notInArray(
      workingOrders.id,
      sql`(select ${unpaidDepartures.workingOrderId} from ${unpaidDepartures})`,
    ),
  )!;
}
/**
 * The party's Current orders: its groups in sequence with their dish rows, and the rows in no
 * group, across every bill of the party and of every party merged into it, paid ones included; rows
 * bill by bill in the order the bills were opened. Recorded debts and abandoned bills are left out. A row whose group belongs to another party's sequence (on a party
 * merged away, whose groups moved on) is shown there, not here. Refused `party.not_open` for an
 * unknown party.
 */
export async function readCurrentOrders(tx: Transaction, partyId: string): Promise<CurrentOrders> {
  const [party] = await tx
    .select({ revision: parties.revision, state: parties.state })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  const family = await partyFamily(tx, partyId);
  const nextDisplayNumber = await nextGroupNumber(tx, partyId);
  const numberLabels = await readGroupNumberLabels(tx, [partyId]);
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      displayNumber: orderGroups.displayNumber,
      numberPartyId: orderGroups.numberPartyId,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
      createdAt: orderGroups.createdAt,
      sentBy: sql<string | null>`coalesce(${persons.displayName}, ${devices.label})`,
    })
    .from(orderGroups)
    .leftJoin(
      persons,
      eq(
        persons.id,
        sql`case when ${orderGroups.state} = 'fired' then ${orderGroups.firedBy} else ${orderGroups.submittedBy} end`,
      ),
    )
    .leftJoin(
      devices,
      and(eq(orderGroups.state, "fired"), eq(devices.id, orderGroups.firedByDeviceId)),
    )
    .where(eq(orderGroups.partyId, partyId))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      billStatus: workingOrders.status,
      lineTotal: workingOrderLines.lineTotal,
      unitPriceGross: workingOrderLines.unitPriceGross,
      priceQuantity: workingOrderLines.priceQuantity,
      lineNo: workingOrderLines.lineNo,
      courseId: workingOrderLines.courseId,
      course: {
        id: kitchenCourses.id,
        name: kitchenCourses.name,
        displayOrder: kitchenCourses.displayOrder,
      },
      parentLineId: workingOrderLines.parentLineId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      unitPrecision: workingOrderLines.unitPrecision,
      servedQuantity: workingOrderLines.servedQuantity,
      countAsPortions: workingOrderLines.countAsPortions,
      servedAt: workingOrderLines.servedAt,
      cancelledQuantity: sql<number>`coalesce(${lineServiceCancellations.quantity}, 0)`,
      cancelledAt: lineServiceCancellations.cancelledAt,
      sentAt: workingOrderLines.sentAt,
      note: workingOrderLines.note,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketState: ticketItems.state,
      ticketFiredAt: ticketItems.firedAt,
      ticketRequestedAt: ticketItems.requestedAt,
      ticketReadyAt: ticketItems.readyAt,
      ticketMadeHere: ticketItems.madeHere,
      stationId: ticketItems.stationId,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, workingOrderLines.courseId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(and(inArray(workingOrders.partyId, family), onShownBill(), notSetMenuLine()))
    .orderBy(
      asc(workingOrders.openedAt),
      asc(workingOrders.orderNumber),
      asc(workingOrders.id),
      asc(workingOrderLines.lineNo),
    );
  const nutrition = await readDisplayLineNutrition(tx, lines);
  const extras = new Map<string, CurrentOrderExtra[]>();
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  const heldExtras = dishesWithHeldExtra(lines);
  for (const line of lines) {
    if (line.parentLineId === null) continue;
    extras.set(line.parentLineId, [
      ...(extras.get(line.parentLineId) ?? []),
      {
        lineId: line.id,
        name: staffPresentationName({ name: line.name, variantName: line.variantName }),
        quantity: thousandthsToDecimal(line.quantity),
        netAmount: centsToDecimal(line.lineTotal),
        unitPriceGross: centsToDecimal(line.unitPriceGross),
        priceQuantity: thousandthsToDecimal(line.priceQuantity),
        ...((cancellations.get(line.id) ?? 0) > 0
          ? { cancelledQuantity: thousandthsToDecimal(cancellations.get(line.id)!) }
          : {}),
      },
    ]);
  }
  const families = new Map<string, (typeof lines)[number][]>();
  for (const line of lines) {
    const parentId = line.parentLineId ?? line.id;
    const familyLines = families.get(parentId) ?? [];
    familyLines.push(line);
    families.set(parentId, familyLines);
  }
  const shown: CurrentOrderGroup[] = groups
    .filter((group) => group.state !== "removed")
    .map(({ createdAt, ...group }) => ({
      ...group,
      ...groupNumberIdentity(group),
      ...(numberLabels.has(group.id) ? { numberPartyLabel: numberLabels.get(group.id)! } : {}),
      state: group.state as "held" | "fired",
      // `order_groups_fired_at_ck` requires `fired_at` exactly when the group is fired.
      sentAt: group.state === "fired" ? group.firedAt! : createdAt,
      rows: [],
    }));
  const byId = new Map(shown.map((group) => [group.id, group]));
  const ungrouped: CurrentOrderRow[] = [];
  const dishes: {
    groupId: string | null;
    courseId: string | null;
    servedAt: string | null;
    fullyCancelled?: true;
  }[] = [];
  const defaults = await readCourseFireNowZones(tx);
  const retainedCourses = new Map<string, CurrentOrders["retainedCourses"][number]>();
  for (const line of lines) {
    if (line.parentLineId !== null) continue;
    if (line.course !== null)
      retainedCourses.set(line.course.id, {
        ...line.course,
        fireNowZoneIds: defaults.get(line.course.id) ?? [],
      });
    const group = line.groupId === null ? undefined : byId.get(line.groupId);
    if (line.groupId !== null && group === undefined) continue;
    dishes.push({
      groupId: line.groupId,
      courseId: line.courseId,
      servedAt: serviceCompletedAt(line),
      ...(line.cancelledQuantity >= line.quantity ? { fullyCancelled: true as const } : {}),
    });
    const familyLines = families.get(line.id)!;
    const kitchenItems = familyLines.filter((component) => component.ticketItemId !== null);
    const allFired = kitchenItems.every((component) => component.ticketFiredAt !== null);
    const firedTimes = kitchenItems.flatMap((component) =>
      component.ticketFiredAt === null ? [] : [component.ticketFiredAt],
    );
    const firedAt = allFired && isReleased(line) ? (earliestTime(firedTimes) ?? line.sentAt) : null;
    const initiatedTimes = kitchenItems.map((component) =>
      initiatedAt({ requestedAt: component.ticketRequestedAt, firedAt: component.ticketFiredAt }),
    );
    const requestedAt =
      kitchenItems.length === 0
        ? firedAt
        : initiatedTimes.every((time): time is string => time !== null)
          ? earliestTime(initiatedTimes)!
          : null;
    const readyTimes = kitchenItems.flatMap((component) =>
      component.ticketState === "ready" && component.ticketReadyAt !== null
        ? [component.ticketReadyAt]
        : [],
    );
    const row: CurrentOrderRow = {
      billStatus: line.billStatus,
      netAmount: toScale(
        sumDecimals(familyLines.map((component) => centsToDecimal(component.lineTotal))),
        MONEY_SCALE,
      ),
      firedAt,
      requestedAt,
      readyAt:
        kitchenItems.length > 0 && allFired && readyTimes.length === kitchenItems.length
          ? latestTime(readyTimes)!
          : null,
      lineId: line.id,
      ...(line.sentAt === null ? {} : { sentAt: line.sentAt }),
      ...(nutrition.has(line.id) ? { nutrition: nutrition.get(line.id)! } : {}),
      workingOrderId: line.workingOrderId,
      lineNo: line.lineNo,
      courseId: line.courseId,
      name: staffPresentationName({ name: line.name, variantName: line.variantName }),
      quantity: thousandthsToDecimal(line.quantity),
      ...(line.cancelledQuantity > 0
        ? { cancelledQuantity: thousandthsToDecimal(line.cancelledQuantity) }
        : {}),
      unitPrecision: line.unitPrecision,
      countsWholePortions: line.countAsPortions,
      servedQuantity: thousandthsToDecimal(line.servedQuantity),
      servedAt: line.servedAt,
      released: dishReleased(line, heldExtras.has(line.id)),
      kitchen:
        line.ticketState === null
          ? null
          : {
              state: line.ticketState,
              phase: kitchenPhase({
                requestedAt: line.ticketRequestedAt,
                firedAt: line.ticketFiredAt,
                state: line.ticketState,
              }),
              requestedAt: line.ticketRequestedAt,
              firedAt: line.ticketFiredAt,
              stationId: line.stationId!,
              movable: stillMovable(
                { state: line.ticketState, madeHere: line.ticketMadeHere! },
                line,
              ),
            },
      note: line.note,
      extras: extras.get(line.id) ?? [],
    };
    (group?.rows ?? ungrouped).push(row);
  }
  const settings = (await partyCourseSettings(tx, [partyId])).get(partyId) ?? [];
  const minutesFor = groupReminderMinutes(dishes, [...retainedCourses.values()], settings);
  return {
    revision: party.revision,
    hasGroups: nextDisplayNumber > 1,
    nextDisplayNumber,
    retainedCourses: [...retainedCourses.values()].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
    ),
    reminder: releaseReminder(
      shown.filter((group) => group.rows.length > 0),
      dishes,
      party.state === "open" ? minutesFor : () => null,
    ),
    groups: shown,
    ungrouped,
  };
}
