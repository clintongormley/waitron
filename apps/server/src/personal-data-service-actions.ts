import { setImmediate as turn } from "node:timers/promises";
import {
  lineServiceCancellations,
  orderAmendments,
  orderEvents,
  orderGroups,
  parties,
  ticketItemMoves,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { jsonFile, type PersonalDataPart } from "@waitron/module";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { alias, type SQLiteTable } from "drizzle-orm/sqlite-core";

const FILE = "service-actions.json";
const PAGE_SIZE = 100;

export async function readHistory<T>(
  db: Database,
  table: SQLiteTable,
  select: (range: SQL) => T[],
): Promise<T[]> {
  const end = db.get<{ last: number | null }>(sql`select max(rowid) as last from ${table}`)!.last;
  const result: T[] = [];
  let after = 0;
  // Pick the boundary before applying the person filter so a sparse history also yields.
  while (end !== null && after < end) {
    const boundary = db.get<{ last: number | null }>(sql`
      select max(rowid) as last from (
        select rowid from ${table} where rowid > ${after} and rowid <= ${end}
        order by rowid limit ${PAGE_SIZE}
      )`)!.last;
    if (boundary === null) break;
    for (const row of select(sql`${table}.rowid > ${after} and ${table}.rowid <= ${boundary}`)) {
      result.push(row);
    }
    after = boundary;
    if (after < end) await turn();
  }
  return result;
}

const fromOrder = alias(workingOrders, "from_order");
const toOrder = alias(workingOrders, "to_order");

export function byTime<T extends { id: string; at: string | null }>(a: T, b: T): number {
  return (a.at ?? "").localeCompare(b.at ?? "") || a.id.localeCompare(b.id);
}

function actionTimes(
  personId: string,
  actions: readonly (readonly [action: string, actor: string | null, at: string | null])[],
) {
  return actions.flatMap(([action, actor, at]) => (actor === personId ? [{ action, at }] : []));
}

async function serviceActions(db: Database, personId: string) {
  const events = await readHistory(db, orderEvents, (range) =>
    db
      .select({
        id: orderEvents.id,
        kind: orderEvents.kind,
        at: orderEvents.at,
        partyId: orderEvents.partyId,
        groupId: orderEvents.groupId,
        draftId: orderEvents.draftId,
        lineId: orderEvents.lineId,
        fromOrderId: orderEvents.fromOrderId,
        toOrderId: orderEvents.toOrderId,
        fromOrderNumber: fromOrder.orderNumber,
        toOrderNumber: toOrder.orderNumber,
        actor: orderEvents.actorId,
        from: orderEvents.fromPerson,
        to: orderEvents.toPerson,
      })
      .from(orderEvents)
      .leftJoin(fromOrder, eq(fromOrder.id, orderEvents.fromOrderId))
      .leftJoin(toOrder, eq(toOrder.id, orderEvents.toOrderId))
      .where(
        and(
          range,
          or(
            eq(orderEvents.actorId, personId),
            eq(orderEvents.fromPerson, personId),
            eq(orderEvents.toPerson, personId),
          ),
        ),
      )
      .all(),
  );
  const groups = await readHistory(db, orderGroups, (range) =>
    db
      .select({
        id: orderGroups.id,
        submittedBy: orderGroups.submittedBy,
        createdAt: orderGroups.createdAt,
        firedBy: orderGroups.firedBy,
        firedAt: orderGroups.firedAt,
      })
      .from(orderGroups)
      .where(
        and(range, or(eq(orderGroups.submittedBy, personId), eq(orderGroups.firedBy, personId))),
      )
      .all(),
  );
  const partyRows = await readHistory(db, parties, (range) =>
    db
      .select({
        id: parties.id,
        openedBy: parties.openedBy,
        openedAt: parties.openedAt,
        closedBy: parties.closedBy,
        closedAt: parties.closedAt,
        allergyAnsweredBy: parties.allergyAnsweredBy,
        allergyAnsweredAt: parties.allergyAnsweredAt,
      })
      .from(parties)
      .where(
        and(
          range,
          or(
            eq(parties.openedBy, personId),
            eq(parties.closedBy, personId),
            eq(parties.allergyAnsweredBy, personId),
          ),
        ),
      )
      .all(),
  );
  const dishMoves = await readHistory(db, ticketItemMoves, (range) =>
    db
      .select({
        id: ticketItemMoves.id,
        lineId: ticketItemMoves.workingOrderLineId,
        order: workingOrders.orderNumber,
        fromStationId: ticketItemMoves.fromStationId,
        toStationId: ticketItemMoves.toStationId,
        at: ticketItemMoves.movedAt,
      })
      .from(ticketItemMoves)
      .leftJoin(workingOrderLines, eq(workingOrderLines.id, ticketItemMoves.workingOrderLineId))
      .leftJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .where(and(range, eq(ticketItemMoves.movedByPersonId, personId)))
      .all(),
  );
  const amendments = await readHistory(db, orderAmendments, (range) =>
    db
      .select({
        id: orderAmendments.id,
        order: workingOrders.orderNumber,
        kind: orderAmendments.kind,
        at: orderAmendments.eventAt,
      })
      .from(orderAmendments)
      .innerJoin(workingOrders, eq(workingOrders.id, orderAmendments.workingOrderId))
      .where(and(range, eq(orderAmendments.actorId, personId)))
      .all(),
  );
  const cancellations = await readHistory(db, lineServiceCancellations, (range) =>
    db
      .select({
        id: lineServiceCancellations.lineId,
        order: workingOrders.orderNumber,
        at: lineServiceCancellations.cancelledAt,
      })
      .from(lineServiceCancellations)
      .leftJoin(workingOrderLines, eq(workingOrderLines.id, lineServiceCancellations.lineId))
      .leftJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .where(and(range, eq(lineServiceCancellations.actorId, personId)))
      .all(),
  );
  const lateConfirmations = await readHistory(db, workingOrderLines, (range) =>
    db
      .select({
        id: workingOrderLines.id,
        order: workingOrders.orderNumber,
        at: workingOrderLines.sentAt,
      })
      .from(workingOrderLines)
      .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .where(and(range, eq(workingOrderLines.lateConfirmedBy, personId)))
      .all(),
  );

  return {
    orderEvents: events.sort(byTime).map((event) => ({
      kind: event.kind,
      at: event.at,
      partyId: event.partyId,
      groupId: event.groupId,
      draftId: event.draftId,
      lineId: event.lineId,
      fromOrderId: event.fromOrderId,
      toOrderId: event.toOrderId,
      fromOrderNumber: event.fromOrderNumber,
      toOrderNumber: event.toOrderNumber,
      yourPart: actionTimes(personId, [
        ["actor", event.actor, event.at],
        ["from", event.from, event.at],
        ["to", event.to, event.at],
      ]).map(({ action }) => action),
    })),
    groups: groups
      .flatMap((row) =>
        actionTimes(personId, [
          ["submitted", row.submittedBy, row.createdAt],
          ["fired", row.firedBy, row.firedAt],
        ]).map((action) => ({ id: row.id, ...action })),
      )
      .sort(byTime)
      .map(({ id, ...action }) => ({ groupId: id, ...action })),
    parties: partyRows
      .flatMap((row) =>
        actionTimes(personId, [
          ["opened", row.openedBy, row.openedAt],
          ["closed", row.closedBy, row.closedAt],
          ["answeredAllergyQuestion", row.allergyAnsweredBy, row.allergyAnsweredAt],
        ]).map((action) => ({ id: row.id, ...action })),
      )
      .sort(byTime)
      .map(({ id, ...action }) => ({ partyId: id, ...action })),
    dishMoves: dishMoves.sort(byTime).map(({ lineId, order, fromStationId, toStationId, at }) => ({
      lineId,
      order,
      fromStationId,
      toStationId,
      at,
    })),
    amendments: amendments.sort(byTime).map(({ order, kind, at }) => ({ order, kind, at })),
    cancellations: cancellations.sort(byTime).map(({ id, ...row }) => ({ lineId: id, ...row })),
    lateConfirmations: lateConfirmations.sort(byTime).map(({ id, order, at }) => ({
      lineId: id,
      order,
      sentAt: at,
    })),
  };
}

export function serviceActionsPersonalData(db: Database): PersonalDataPart[] {
  return [
    {
      owner: "server",
      part: {
        files: [FILE],
        // Scan after the initial write turn so other requests can write between pages.
        prepare:
          async (_tx, { personId }) =>
          async () => {
            const data = await serviceActions(db, personId);
            return Object.values(data).some((entries) => entries.length > 0)
              ? [jsonFile(FILE, data)]
              : [];
          },
      },
    },
  ];
}
