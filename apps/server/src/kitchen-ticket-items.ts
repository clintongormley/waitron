import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  kitchenStations,
  kitchenCourses,
  orderGroups,
  readPlacedOrders,
} from "@waitron/db";
import { kitchenPresentationName, optionSnapshotLabels } from "@waitron/menu";
import type { LateSendMark } from "@waitron/module";
import {
  thousandthsToDecimal,
  contentLanguageCode,
  type Decimal,
  perDishOptionQuantity,
  partyTablesName,
  type TicketGrouping,
} from "@waitron/shared";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { kitchenAllergenLabel, extraWithAllergens } from "./i18n/kitchen-allergy.js";
import { kitchenLanguageFor } from "./i18n/kitchen-ticket.js";
import { type KitchenTicketItem, kitchenQuantityText, crossRefText } from "./kitchen-ticket.js";
import { readLineNutrition } from "./line-nutrition.js";
import { VENUE_SERVICE } from "./modules.js";
import { readGroupNumberLabels } from "./order-group-records.js";
import type { TradingContext } from "./trading-context.js";

/**
 * A selected line and station: resolving its copy must not sweep earlier rounds into this output.
 */
export interface FiredItem {
  workingOrderLineId: string;
  stationId: string;
  /**
   * The ticket item's fired quantity, as thousandths, printed in place of the line's current
   * quantity. Absent or null prints the line's.
   */
  quantity?: number | null;
  /**
   * When its ticket was fired (fired work), or when its group's HOLD ticket was queued (held work);
   * set by {@link readReprintParts} only.
   */
  sentAt?: string;
}
/**
 * Group-less items first, then group by group, each in line order: a paper heads each group's run.
 */
export function byGroupThenLine(
  a: { lineNo: number; position: number | null },
  b: { lineNo: number; position: number | null },
): number {
  return (a.position ?? 0) - (b.position ?? 0) || a.lineNo - b.lineNo;
}
/** `entry`'s printed item at the quantity `item` was fired at, where it records one. */
export function atFiredQuantity(entry: KitchenTicketItem, item: FiredItem): KitchenTicketItem {
  return item.quantity == null ? entry : { ...entry, qty: thousandthsToDecimal(item.quantity) };
}
// Change paper omits late-send marks, so those marks cannot split otherwise identical portions.
export function changeItem(entry: KitchenTicketItem, item: FiredItem): KitchenTicketItem {
  return { ...atFiredQuantity(entry, item), afterPeriod: undefined, afterPeriodUnasked: undefined };
}
function afterPeriodOf(
  mark: LateSendMark | undefined,
): Pick<KitchenTicketItem, "afterPeriod" | "afterPeriodUnasked"> {
  if (mark === undefined) return {};
  return mark.agreed
    ? { afterPeriod: mark.periodName }
    : { afterPeriod: mark.periodName, afterPeriodUnasked: true };
}
export function ticketName(text: Record<string, string>, locale: string): string {
  const localised = text[contentLanguageCode(locale)];
  if (localised !== undefined) return localised;
  // Never empty: `unit_name` is written through `prepareUnitSnapshot`, which keys the default language.
  return Object.values(text)[0]!;
}
/** Display the physical amount for measured extras and the per-dish count for Each extras. */
export function extraLabel(
  name: string,
  quantity: Decimal,
  dishQuantity: Decimal,
  locale: string,
  unitName?: string,
): string {
  if (unitName !== undefined) return `${name} ${kitchenQuantityText(quantity, locale)} ${unitName}`;
  const perDish = perDishOptionQuantity(quantity, dishQuantity);
  return perDish > 1 ? `${name} x${perDish}` : name;
}
/**
 * Display numbers identify paper across reorders; positions order its group sections.
 */
export async function buildTicketItems(
  tx: Transaction,
  cfg: TradingContext,
  lineIds: string[],
  language: string,
): Promise<
  Map<
    string,
    {
      lineNo: number;
      group: number | null;
      position: number | null;
      item: KitchenTicketItem;
      passControlled: boolean;
      madeHere: boolean;
    }
  >
> {
  // The customer-facing `descriptions` is deliberately not read: the cook's name falls back to the
  // staff name (`kitchenPresentationName`), as on the station screen.
  const parentLine = alias(workingOrderLines, "ticket_parent_line");
  const ownRecord = alias(ticketItems, "ticket_own_record");
  const parentRecord = alias(ticketItems, "ticket_parent_record");
  const parentStation = alias(kitchenStations, "ticket_parent_station");
  const ownCourse = alias(kitchenCourses, "ticket_own_course");
  const storedLineRows = await tx
    .select({
      id: workingOrderLines.id,
      ticketItemId: ownRecord.id,
      parentLineId: workingOrderLines.parentLineId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      name: workingOrderLines.name,
      optionSnapshots: workingOrderLines.optionSnapshots,
      unitName: workingOrderLines.unitName,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      note: workingOrderLines.note,
      group: orderGroups.displayNumber,
      groupId: orderGroups.id,
      groupPartyId: orderGroups.partyId,
      position: orderGroups.position,
      parentName: parentLine.name,
      parentKitchenName: parentLine.kitchenName,
      parentVariantName: parentLine.variantName,
      parentVariantKitchenName: parentLine.variantKitchenName,
      parentStationName: parentStation.name,
      courseName: ownCourse.name,
      courseOrder: ownCourse.displayOrder,
      passControlled: ownRecord.passControlled,
      madeHere: ownRecord.madeHere,
    })
    .from(workingOrderLines)
    .leftJoin(ownRecord, eq(ownRecord.workingOrderLineId, workingOrderLines.id))
    .leftJoin(ownCourse, eq(ownCourse.id, ownRecord.courseId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(parentLine, eq(parentLine.id, workingOrderLines.parentLineId))
    .leftJoin(parentRecord, eq(parentRecord.workingOrderLineId, parentLine.id))
    .leftJoin(parentStation, eq(parentStation.id, parentRecord.stationId))
    .where(inArray(workingOrderLines.id, lineIds));
  const allergies = await VENUE_SERVICE.readTicketAllergies(
    tx,
    storedLineRows.flatMap((row) => (row.ticketItemId === null ? [] : [row.ticketItemId])),
  );
  const numberLabels = await readGroupNumberLabels(
    tx,
    storedLineRows.flatMap((r) => (r.groupPartyId === null ? [] : [r.groupPartyId])),
  );
  const lineRows = storedLineRows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
  }));
  const lineById = new Map(lineRows.map((row) => [row.id, row]));

  // Ordered by `line_no` so the picks print in the order they were offered.
  const childRecord = alias(ticketItems, "ticket_child_record");
  const childStation = alias(kitchenStations, "ticket_child_station");
  const storedChildRows = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      unitName: workingOrderLines.unitName,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      recordId: childRecord.id,
      stationName: childStation.name,
    })
    .from(workingOrderLines)
    .leftJoin(childRecord, eq(childRecord.workingOrderLineId, workingOrderLines.id))
    .leftJoin(childStation, eq(childStation.id, childRecord.stationId))
    .where(inArray(workingOrderLines.parentLineId, lineIds))
    .orderBy(workingOrderLines.lineNo);
  const childRows = storedChildRows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
  }));
  const lateMarks = await VENUE_SERVICE.readLateSendMarks(tx, lineIds);
  const eachByIdentity = await VENUE_SERVICE.readLinesSoldInEach(tx, [
    ...lineIds,
    ...childRows.map((row) => row.id),
  ]);
  const nutrition = await readLineNutrition(tx, [...lineIds, ...childRows.map((row) => row.id)]);
  const allergenLabels = (id: string): string[] =>
    Object.entries(nutrition.get(id)?.allergens ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, entry]) => kitchenAllergenLabel(code, entry, kitchenLanguageFor(language)));
  // The per-dish pick count is recovered from the stored combined child quantity. Every child's
  // parent is in `lineById` because children are read by parent id.
  const modifiersByParent = new Map<string, string[]>();
  const crossRefsByParent = new Map<string, string[]>();
  for (const child of childRows) {
    const parent = lineById.get(child.parentLineId!)!;
    const extraUnit =
      child.unitName == null || eachByIdentity.has(child.id)
        ? undefined
        : ticketName(child.unitName, cfg.locale);
    if (child.recordId !== null) {
      const refs = crossRefsByParent.get(child.parentLineId!) ?? [];
      refs.push(
        crossRefText(
          {
            kind: "with",
            name: extraLabel(
              kitchenPresentationName(child),
              child.quantity,
              parent.quantity,
              language,
              extraUnit,
            ),
            stationName: child.stationName!,
          },
          language,
        ),
      );
      crossRefsByParent.set(child.parentLineId!, refs);
      continue;
    }
    const names = modifiersByParent.get(child.parentLineId!) ?? [];
    const label = extraLabel(
      kitchenPresentationName(child),
      child.quantity,
      parent.quantity,
      language,
      extraUnit,
    );
    const labels = allergenLabels(child.id);
    names.push(
      labels.length === 0 ? label : extraWithAllergens(label, labels, kitchenLanguageFor(language)),
    );
    modifiersByParent.set(child.parentLineId!, names);
  }

  const byLine = new Map<
    string,
    {
      lineNo: number;
      group: number | null;
      position: number | null;
      item: KitchenTicketItem;
      passControlled: boolean;
      madeHere: boolean;
    }
  >();
  for (const row of lineRows) {
    const unit =
      row.unitName == null || eachByIdentity.has(row.id)
        ? undefined
        : ticketName(row.unitName, cfg.locale);
    const contains = allergenLabels(row.id);
    byLine.set(row.id, {
      lineNo: row.lineNo,
      group: row.group,
      position: row.position,
      passControlled: row.passControlled === true,
      madeHere: row.madeHere === true,
      item: {
        allergy:
          row.ticketItemId === null
            ? null
            : (allergies.get(row.ticketItemId)?.originalBlock ?? null),
        ...(row.groupId === null ? {} : { groupId: row.groupId }),
        ...(row.groupId !== null && numberLabels.has(row.groupId)
          ? { groupLabel: numberLabels.get(row.groupId)! }
          : {}),
        ...(row.courseName === null
          ? {}
          : { course: { name: row.courseName, order: row.courseOrder! } }),
        qty: row.quantity,
        unit,
        name: kitchenPresentationName(row),
        note: row.note ?? undefined,
        ...(contains.length === 0 ? {} : { contains }),
        ...(unit === undefined ? {} : { printedAsSold: true }),
        ...afterPeriodOf(lateMarks.get(row.id)),
        modifiers: [
          ...optionSnapshotLabels(row.optionSnapshots),
          ...(modifiersByParent.get(row.id) ?? []),
        ],
        ...(row.parentLineId === null
          ? { crossRefs: crossRefsByParent.get(row.id) ?? [] }
          : {
              crossRefs: [
                crossRefText(
                  {
                    kind: "for",
                    name: kitchenPresentationName({
                      name: row.parentName!,
                      kitchenName: row.parentKitchenName,
                      variantName: row.parentVariantName,
                      variantKitchenName: row.parentVariantKitchenName,
                    }),
                    stationName: row.parentStationName,
                  },
                  language,
                ),
              ],
            }),
      },
    });
  }
  return byLine;
}
export async function readStations(
  tx: Transaction,
  stationIds: string[],
): Promise<
  Map<
    string,
    {
      name: string;
      showsRestOfOrder: boolean;
      ticketGrouping: TicketGrouping;
      printHeldWork: boolean;
      printMovedSlips: boolean;
    }
  >
> {
  const rows = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      showsRestOfOrder: kitchenStations.showsRestOfOrder,
      ticketGrouping: kitchenStations.ticketGrouping,
      printHeldWork: kitchenStations.printHeldWork,
      printMovedSlips: kitchenStations.printMovedSlips,
    })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, stationIds));
  return new Map(
    rows.map(({ id, printMovedSlips, ...station }) => [
      id,
      { ...station, printMovedSlips: printMovedSlips ?? true },
    ]),
  );
}
/** What a kitchen paper for an order is headed with. */
export interface OrderHeader {
  orderNumber: string;
  tableLabel: string | null;
  partyId: string | null;
  partyName: string | null;
  takeAway: boolean;
}
/** Each order's kitchen heading, keyed by order. */
export async function readOrderHeaders(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, OrderHeader>> {
  const orders = await readPlacedOrders(tx, orderIds);
  return new Map(
    [...orders].map(([id, order]) => {
      const { places, partyId, sittingWith, takeAway } = order;
      const billLabel = partyId === null ? places.billName : null;
      return [
        id,
        {
          orderNumber: String(places.orderNumber),
          tableLabel: places.names.length === 0 ? billLabel : partyTablesName(places.names),
          partyId,
          partyName: places.names.length === 0 ? sittingWith : (sittingWith ?? billLabel),
          takeAway,
        },
      ];
    }),
  );
}
export async function readOrderHeader(tx: Transaction, orderId: string): Promise<OrderHeader> {
  return (await readOrderHeaders(tx, [orderId])).get(orderId)!;
}
export type TicketItemsByLine = Awaited<ReturnType<typeof buildTicketItems>>;
