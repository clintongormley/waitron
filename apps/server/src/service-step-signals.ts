import { and, eq, inArray, isNull, not, or, sql } from "drizzle-orm";
import {
  lineServiceCancellations,
  orderDrafts,
  orderGroupEvents,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { TableSignal } from "@waitron/shared";
import { readStepCompletions, readTableStepRules } from "@waitron/venue-service";
import { isRecalledDish } from "./draft-source.js";
import { onShownBill } from "./order-groups.js";
import { partyFamilies } from "./parties.js";
import {
  liveSteps,
  servedTimes,
  type DishServing,
  type LiveStep,
  type StepFacts,
  type StepRule,
} from "./service-step-reckoning.js";

export interface StepParty {
  partyId: string;
  openedAt: string;
  tableIds: readonly string[];
}

export interface TableSteps {
  departmentId: string;
  live: LiveStep[];
}

export interface TableStepFacts {
  departmentId: string;
  rules: readonly StepRule[];
  facts: StepFacts;
}

interface OrderTimes {
  first: number;
  last: number;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Each seated table's department steps and those live for the party sitting there, keyed by table;
 * a table in no department is absent.
 */
export async function readTableSteps(
  tx: Transaction,
  parties: readonly StepParty[],
  nowMs: number,
): Promise<Map<string, TableSteps>> {
  const found = new Map<string, TableSteps>();
  for (const [tableId, { departmentId, rules, facts }] of await readStepFacts(tx, parties)) {
    found.set(tableId, { departmentId, live: liveSteps(rules, facts, nowMs) });
  }
  return found;
}

/**
 * Each seated table's department steps and the facts of the party sitting there they are reckoned
 * from, keyed by table; a table in no department is absent. Dishes and orders are the party's
 * family's, Done and drafts the party's own; a family with no order of its own has its dishes'
 * arrival from another table or the counter as its orders, while the family has any dish on a
 * shown bill. Six statements for all the parties, none for none.
 */
export async function readStepFacts(
  tx: Transaction,
  parties: readonly StepParty[],
): Promise<Map<string, TableStepFacts>> {
  const found = new Map<string, TableStepFacts>();
  if (parties.length === 0) return found;
  const partyIds = parties.map((party) => party.partyId);
  const families = await partyFamilies(tx, partyIds);
  const rootsOf = new Map<string, string[]>();
  for (const [root, members] of families) for (const id of members) pushTo(rootsOf, id, root);
  const members = [...rootsOf.keys()];

  const rules = await readTableStepRules(tx, [
    ...new Set(parties.flatMap((party) => party.tableIds)),
  ]);

  const doneAt = new Map<string, Map<string, number>>();
  for (const row of await readStepCompletions(tx, partyIds)) {
    const own = doneAt.get(row.partyId) ?? new Map<string, number>();
    const at = Date.parse(row.doneAt);
    own.set(row.stepId, Math.max(own.get(row.stepId) ?? at, at));
    doneAt.set(row.partyId, own);
  }

  const dishRows = await tx
    .select({
      partyId: workingOrders.partyId,
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
        inArray(workingOrders.partyId, members),
        isNull(workingOrderLines.parentLineId),
        onShownBill(),
        not(isRecalledDish(tx)),
      ),
    );
  const dishes = new Map<string, DishServing[]>();
  for (const { partyId, ...dish } of dishRows)
    for (const root of rootsOf.get(partyId!)!) pushTo(dishes, root, dish);

  // A party with orders of its own keeps their times: a bill arriving is not this table ordering.
  const orders = new Map<string, OrderTimes>();
  const arrivals = new Map<string, OrderTimes>();
  const isArrival = sql<number>`${orderGroupEvents.kind} = 'lines_moved'`;
  const orderRows = await tx
    .select({
      partyId: orderGroupEvents.partyId,
      isArrival,
      // Every event is stamped by the column's `nowIso`, so text order is time order.
      first: sql<string>`min(${orderGroupEvents.createdAt})`,
      last: sql<string>`max(${orderGroupEvents.createdAt})`,
    })
    .from(orderGroupEvents)
    .where(
      and(
        inArray(orderGroupEvents.partyId, members),
        or(
          inArray(orderGroupEvents.kind, ["submitted", "joined"]),
          and(
            eq(orderGroupEvents.kind, "lines_moved"),
            sql`json_extract(${orderGroupEvents.detail}, '$.arrived') = 1`,
          ),
        ),
      ),
    )
    .groupBy(orderGroupEvents.partyId, isArrival);
  for (const row of orderRows) {
    const first = Date.parse(row.first);
    const last = Date.parse(row.last);
    const times = row.isArrival === 1 ? arrivals : orders;
    for (const root of rootsOf.get(row.partyId)!) {
      const seen = times.get(root);
      times.set(
        root,
        seen === undefined
          ? { first, last }
          : { first: Math.min(seen.first, first), last: Math.max(seen.last, last) },
      );
    }
  }

  const drafting = new Set(
    (
      await tx
        .selectDistinct({ partyId: orderDrafts.partyId })
        .from(orderDrafts)
        .where(and(inArray(orderDrafts.partyId, partyIds), eq(orderDrafts.state, "open")))
    ).map((row) => row.partyId),
  );

  for (const party of parties) {
    const served = servedTimes(dishes.get(party.partyId) ?? []);
    const own = orders.get(party.partyId);
    // An arrival counts only while a dish is still here: the event outlives the bill moving on.
    const arrived =
      own === undefined && dishes.has(party.partyId) ? arrivals.get(party.partyId) : undefined;
    const ordered = own ?? arrived;
    const facts = {
      openedAt: Date.parse(party.openedAt),
      firstOrderAt: ordered?.first ?? null,
      lastOrderAt: ordered?.last ?? null,
      ordersArrived: arrived !== undefined,
      drafting: drafting.has(party.partyId),
      courseServedAt: served.courseServedAt,
      allServedAt: served.allServedAt,
      doneAt: doneAt.get(party.partyId) ?? new Map<string, number>(),
    };
    for (const tableId of party.tableIds) {
      const table = rules.get(tableId);
      if (table === undefined) continue;
      found.set(tableId, { departmentId: table.departmentId, rules: table.rules, facts });
    }
  }
  return found;
}

/** The table's `service_step` signal, or nothing when no step is live there. */
export function stepSignal(
  steps: TableSteps | undefined,
): Extract<TableSignal, { kind: "service_step" }> | undefined {
  if (steps === undefined || steps.live.length === 0) return undefined;
  return {
    kind: "service_step",
    steps: steps.live.map((step) => ({
      stepId: step.stepId,
      name: step.name,
      dueAt: new Date(step.dueAt).toISOString(),
    })),
  };
}
