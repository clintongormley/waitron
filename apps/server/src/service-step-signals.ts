import { and, eq, inArray, isNull, not, sql } from "drizzle-orm";
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
} from "./service-step-reckoning.js";

export interface StepParty {
  partyId: string;
  openedAt: string;
  tableIds: readonly string[];
}

export interface TableSteps {
  departmentId: string;
  ruleIds: ReadonlySet<string>;
  live: LiveStep[];
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Each seated table's department steps and those live for the party sitting there, keyed by table;
 * a table in no department is absent. Dishes and orders are the party's family's, Done and drafts
 * the party's own. Six statements for all the parties, none for none.
 */
export async function readTableSteps(
  tx: Transaction,
  parties: readonly StepParty[],
  nowMs: number,
): Promise<Map<string, TableSteps>> {
  const found = new Map<string, TableSteps>();
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

  const orders = new Map<string, { first: number; last: number }>();
  const orderRows = await tx
    .select({ partyId: orderGroupEvents.partyId, createdAt: orderGroupEvents.createdAt })
    .from(orderGroupEvents)
    .where(
      and(
        inArray(orderGroupEvents.partyId, members),
        inArray(orderGroupEvents.kind, ["submitted", "joined"]),
      ),
    );
  for (const row of orderRows) {
    const at = Date.parse(row.createdAt);
    for (const root of rootsOf.get(row.partyId)!) {
      const seen = orders.get(root);
      orders.set(
        root,
        seen === undefined
          ? { first: at, last: at }
          : { first: Math.min(seen.first, at), last: Math.max(seen.last, at) },
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
    const ordered = orders.get(party.partyId);
    const facts = {
      openedAt: Date.parse(party.openedAt),
      firstOrderAt: ordered?.first ?? null,
      lastOrderAt: ordered?.last ?? null,
      drafting: drafting.has(party.partyId),
      courseServedAt: served.courseServedAt,
      allServedAt: served.allServedAt,
      doneAt: doneAt.get(party.partyId) ?? new Map<string, number>(),
    };
    for (const tableId of party.tableIds) {
      const table = rules.get(tableId);
      if (table === undefined) continue;
      found.set(tableId, {
        departmentId: table.departmentId,
        ruleIds: new Set(table.rules.map((rule) => rule.id)),
        live: liveSteps(table.rules, facts, nowMs),
      });
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
