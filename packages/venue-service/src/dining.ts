import { and, eq, inArray } from "drizzle-orm";
import { chargesTakeawayVat } from "@waitron/country-packs";
import {
  departments,
  floorZones,
  orderDiningLocked,
  orderServiceContexts,
  readTaxpayer,
  readVenueSettings,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { ServiceMode } from "@waitron/module";
import { AppError, type Dining, type DiningPolicy } from "@waitron/shared";
import { readLunchLineIds } from "./operations.js";
import "./errors.js";

/** Whether the venue's region charges a different VAT class on food taken away. */
export async function venueChargesTakeawayVat(tx: Transaction): Promise<boolean> {
  const taxpayer = await readTaxpayer(tx);
  if (taxpayer === null) return false;
  return chargesTakeawayVat(taxpayer.country, (await readVenueSettings(tx)).doc.fiscalTerritory);
}

/** How a department sells, and which way a till-choice order starts. */
export async function departmentDining(
  tx: Transaction,
  departmentId: string,
): Promise<{ dining: DiningPolicy; startsAs: Dining }> {
  const [row] = await tx
    .select({
      dining: departments.dining,
      startsAs: departments.diningStartsAs,
    })
    .from(departments)
    .where(eq(departments.id, departmentId));
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
  return row;
}

/**
 * Of the named orders, those staff may switch between eaten here and takeaway while nothing is sent
 * or paid: their department leaves the way to the till, in a region that charges takeaway VAT.
 */
export async function findOrdersWithDiningChoice(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (workingOrderIds.length === 0 || !(await venueChargesTakeawayVat(tx))) return new Set();
  const rows = await tx
    .select({ id: orderServiceContexts.workingOrderId })
    .from(orderServiceContexts)
    .innerJoin(
      departmentSalePolicies,
      eq(departmentSalePolicies.departmentId, orderServiceContexts.departmentId),
    )
    .where(
      and(
        inArray(orderServiceContexts.workingOrderId, [...workingOrderIds]),
        eq(departmentSalePolicies.dining, "till_choice"),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * The way a new order in `zoneId` sells. A department fixed one way, or a region without takeaway
 * VAT (always eaten here), refuses a request for the other way; a till-choice department takes the
 * request, else starts a table order eaten here and a counter order as the department says.
 */
export async function resolveOrderDining(
  tx: Transaction,
  zoneId: string,
  requested: Dining | undefined,
): Promise<Dining> {
  const [zone] = await tx
    .select({
      zoneOrderStart: floorZones.orderStart,
      departmentOrderStart: departments.orderStart,
      dining: departments.dining,
      startsAs: departments.diningStartsAs,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(eq(floorZones.id, zoneId));
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
  const policy = zone.dining ?? "eat_in";
  let fixed: Dining | null = policy === "till_choice" ? null : policy;
  if (fixed !== "eat_in" && !(await venueChargesTakeawayVat(tx))) fixed = "eat_in";
  if (fixed !== null) {
    if (requested !== undefined && requested !== fixed) {
      throw new AppError("order.dining_fixed", { dining: fixed });
    }
    return fixed;
  }
  const atTable = (zone.zoneOrderStart ?? zone.departmentOrderStart) === "table";
  return requested ?? (atTable ? "eat_in" : (zone.startsAs ?? "eat_in"));
}

/**
 * The way an existing order sells once its department becomes `to.departmentId` (A1522, Decision 6).
 * An order whose way is fixed (sent or paid) keeps it, and a takeaway order moved to a table stays
 * takeaway. Otherwise a department fixed one way gives the order that way, and a till-choice
 * department leaves it for staff to switch; becoming takeaway with a set lunch is refused. A region
 * without takeaway VAT changes nothing. The caller calls this only when the department changes.
 */
export async function applyDepartmentDining(
  tx: Transaction,
  workingOrderId: string,
  to: { departmentId: string; serviceMode: ServiceMode },
): Promise<void> {
  if (!(await venueChargesTakeawayVat(tx))) return;
  if ((await orderDiningLocked(tx, workingOrderId)) !== null) return;
  const [order] = await tx
    .select({ dining: workingOrders.dining })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) throw new AppError("working_order.not_found", { workingOrderId });
  if (order.dining === "takeaway" && to.serviceMode === "table_tab") return;
  // No row (seedZone's test departments): eaten here, as `resolveOrderDining` reads it.
  const [policy] = await tx
    .select({ dining: departmentSalePolicies.dining })
    .from(departmentSalePolicies)
    .where(eq(departmentSalePolicies.departmentId, to.departmentId));
  const dining = policy?.dining ?? "eat_in";
  if (dining === "till_choice" || dining === order.dining) return;
  if (dining === "takeaway") {
    const lines = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, workingOrderId));
    const lunches = await readLunchLineIds(
      tx,
      lines.map((line) => line.id),
    );
    if (lunches.size > 0) throw new AppError("order.set_lunch_takeaway", { canSwitch: false });
  }
  await tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, workingOrderId));
}
