import type { LockedLine } from "@waitron/catalogue";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import type { OrderLineIdentity, StoredOrderLine } from "./working-order.js";

/** Which portion a working dish line holds, as `working_line_portions` and `order_portions` say. */
export interface PortionBinding {
  lineId: string;
  portionId: string;
  cohortId: string;
  ordinal: number;
}

/** A stored line after grouping: every working line it stands for, and their portions. */
export interface ProjectedLine {
  identity: OrderLineIdentity & { lineIds: string[]; portionIds: string[] };
  locked: LockedLine;
}

/** Object keys sorted, so two descriptions written in a different key order still compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Every field of the stored line and its identity except its id, how many, and which dish it is under. */
function rowKey(line: StoredOrderLine): string {
  const rest = line.locked;
  const listed = line.identity.listUnitGross;
  return canonical({
    ...rest,
    quantity: null,
    parentLineNo: null,
    priceQuantity: rest.priceQuantity ?? null,
    unitName: rest.unitName ?? null,
    unitPrecision: rest.unitPrecision ?? null,
    optionSnapshots: rest.optionSnapshots ?? [],
    variantName: rest.variantName ?? null,
    variantDescriptions: rest.variantDescriptions ?? null,
    variantKitchenName: rest.variantKitchenName ?? null,
    kitchenName: rest.kitchenName ?? null,
    identity: {
      ...line.identity,
      id: null,
      // A list price equal to the price is filed as none (`withReceiptListPrices`), so it groups as none.
      listUnitGross:
        listed !== null && compareDecimal(listed, decimal(rest.grossUnitPrice)) !== 0
          ? listed
          : null,
    },
  });
}

/** An extra is compared on the same fields as its dish, and on how many it takes per dish. */
function extraKey(line: StoredOrderLine): string {
  return `${rowKey(line)}|${decimal(line.locked.quantity)}`;
}

interface Dish {
  line: StoredOrderLine;
  extras: StoredOrderLine[];
  binding: PortionBinding | undefined;
}

/**
 * Groups bound dish lines back into the row their cohort was priced as (decision D7): same cohort,
 * same filed fields, and the same extras taken per dish. Quantities add; a group sits at its first
 * member's position. A line with no binding is its own row, as before portions existed.
 */
export function projectPortionSale(
  stored: readonly StoredOrderLine[],
  bindings: ReadonlyMap<string, PortionBinding>,
): ProjectedLine[] {
  const dishes: Dish[] = [];
  const dishOfPosition = new Map<number, Dish>();
  stored.forEach((line, i) => {
    if (line.locked.parentLineNo == null) {
      const dish = { line, extras: [], binding: bindings.get(line.identity.id) };
      dishes.push(dish);
      dishOfPosition.set(i + 1, dish);
    }
  });
  for (const line of stored) {
    if (line.locked.parentLineNo == null) continue;
    const dish = dishOfPosition.get(line.locked.parentLineNo);
    if (dish === undefined) {
      throw new Error(`projectPortionSale: extra line ${line.identity.id} names no dish line`);
    }
    dish.extras.push(line);
  }

  const groups = new Map<string, Dish[]>();
  const ordered: Dish[][] = [];
  for (const dish of dishes) {
    if (dish.binding === undefined) {
      ordered.push([dish]);
      continue;
    }
    const key = canonical([
      dish.binding.cohortId,
      rowKey(dish.line),
      dish.extras.map(extraKey).sort(),
    ]);
    const group = groups.get(key);
    if (group === undefined) {
      const created = [dish];
      groups.set(key, created);
      ordered.push(created);
    } else {
      group.push(dish);
    }
  }

  const out: ProjectedLine[] = [];
  for (const members of ordered) {
    const [first] = members as [Dish, ...Dish[]];
    const portionIds = members.flatMap((dish) => (dish.binding ? [dish.binding.portionId] : []));
    const dishNo = out.length + 1;
    out.push({
      identity: {
        ...first.line.identity,
        lineIds: members.map((dish) => dish.line.identity.id),
        portionIds,
      },
      locked: { ...first.line.locked, quantity: sum(members.map((dish) => dish.line)) },
    });
    const unclaimed = members.slice(1).map((dish) => [...dish.extras]);
    for (const extra of first.extras) {
      const key = extraKey(extra);
      const matches = [
        extra,
        ...unclaimed.map(
          (extras) =>
            extras.splice(
              extras.findIndex((e) => extraKey(e) === key),
              1,
            )[0]!,
        ),
      ];
      out.push({
        identity: {
          ...extra.identity,
          lineIds: matches.map((line) => line.identity.id),
          portionIds,
        },
        locked: { ...extra.locked, quantity: sum(matches), parentLineNo: dishNo },
      });
    }
  }
  return out;
}

function sum(lines: readonly StoredOrderLine[]): string {
  return lines.map((line) => decimal(line.locked.quantity)).reduce((a, b) => addDecimal(a, b));
}
