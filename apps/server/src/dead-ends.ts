import { and, eq, inArray } from "drizzle-orm";
import { kitchenStations, products } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";

export interface DeadEnd {
  readonly key: string;
  readonly name: string;
  readonly quantity: string;
  readonly stationId: string;
  readonly stationName: string;
  readonly why: "closed" | "switched_off";
}

export interface DeadEndAnswer {
  readonly sends: boolean;
  readonly deadEnds: readonly DeadEnd[];
  readonly stations: readonly { id: string; name: string; open: boolean }[];
  readonly revision?: number;
}

export async function requireMakeAtStation(tx: Transaction, stationId: string): Promise<void> {
  const [station] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.active, true)));
  if (station === undefined) throw new AppError("route.station_inactive", { stationId });
}

export async function availableStations(
  tx: Transaction,
  at: Date,
): Promise<DeadEndAnswer["stations"]> {
  const states = await VENUE_SERVICE.stationStates(tx, at);
  return [...states].flatMap(([id, state]) =>
    state.active ? [{ id, name: state.name, open: state.open }] : [],
  );
}

export async function findDeadEnds(
  tx: Transaction,
  zoneId: string | null,
  lines: readonly { key: string; productId: string; quantity: string; makeAt: string | null }[],
  at: Date,
): Promise<readonly DeadEnd[]> {
  if (lines.length === 0) return [];
  const states = await (await VENUE_SERVICE.routingAt(tx, at)).stations();
  const routed = lines.filter((line) => !states.get(line.makeAt ?? "")?.active);
  if (routed.length === 0) return [];
  const productsById = new Map(
    (
      await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(inArray(products.id, [...new Set(routed.map((line) => line.productId))]))
    ).map((row) => [row.id, row]),
  );
  const outcomes = await VENUE_SERVICE.resolveMakers(
    tx,
    zoneId,
    routed.map((line) => line.productId),
    at,
  );
  return routed.flatMap((line) => {
    const outcome = outcomes.get(line.productId);
    if (outcome?.kind !== "no_replacement") return [];
    const station = states.get(outcome.stationId);
    if (station === undefined) return [];
    const product = productsById.get(line.productId);
    return [
      {
        key: line.key,
        name: product?.name ?? "",
        quantity: line.quantity,
        stationId: outcome.stationId,
        stationName: station.name,
        why: station.active ? ("closed" as const) : ("switched_off" as const),
      },
    ];
  });
}
