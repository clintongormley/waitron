import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { categories, floorZones, kitchenStations, products, type Transaction } from "@waitron/db";
import {
  categoryDetails,
  effectiveProductColumns,
  parentJoin,
  parentProducts,
  productWithId,
} from "@waitron/catalogue";
import { AppError, normaliseUuid } from "@waitron/shared";
import { resolveZoneContext, type VenueScope } from "./operations.js";
import {
  chooseMaker,
  folderAncestors,
  unreachableExceptions,
  type RouteTarget,
  type RoutingRules,
} from "./routing.js";
import type {
  ExceptionInput,
  RouteExplanation,
  RoutingChange,
  RoutingModel,
  RoutingMove,
} from "./routing-types.js";
import { routeExceptions, stationClaims } from "./schema/routing.js";
import "./errors.js";
export type { ExceptionInput, RoutingChange, RoutingModel, RoutingMove } from "./routing-types.js";

/** Shared write validation also serves callers that need to check a proposed exception. */
export async function validateRoutingInput(
  tx: Transaction,
  cfg: VenueScope,
  input: ExceptionInput,
): Promise<void> {
  if (input.categoryId !== null && input.productId !== null)
    throw new AppError("management.request_invalid", { field: "subject" });
  if (input.zoneId === null && input.categoryId === null && input.productId === null)
    throw new AppError("management.request_invalid", { field: "condition" });
  if (input.zoneId !== null) await resolveZoneContext(tx, cfg, input.zoneId);
  if (input.categoryId !== null) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId));
    if (category === undefined)
      throw new AppError("route.subject_not_found", { subject: "category", id: input.categoryId });
  }
  if (input.productId !== null) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(productWithId(input.productId, "top-level"));
    if (product === undefined)
      throw new AppError("route.subject_not_found", { subject: "product", id: input.productId });
  }
  if (input.target.kind === "station") {
    const [station] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(
        and(
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.id, input.target.stationId),
          eq(kitchenStations.active, true),
        ),
      );
    if (station === undefined)
      throw new AppError("route.station_inactive", { stationId: input.target.stationId });
  }
}

const storedTarget = (target: RouteTarget) => ({
  stationId: target.kind === "station" ? target.stationId : null,
  noPreparation: target.kind === "no_preparation",
});
const readTarget = (row: { stationId: string | null }): RouteTarget =>
  row.stationId === null
    ? { kind: "no_preparation" }
    : { kind: "station", stationId: row.stationId };

export async function setClaim(
  tx: Transaction,
  cfg: VenueScope,
  categoryId: string,
  target: RouteTarget,
): Promise<void> {
  await validateRoutingInput(tx, cfg, { zoneId: null, categoryId, productId: null, target });
  await tx
    .insert(stationClaims)
    .values({ locationId: cfg.locationId, categoryId, ...storedTarget(target) })
    .onConflictDoUpdate({
      target: [stationClaims.locationId, stationClaims.categoryId],
      set: storedTarget(target),
    });
}

export async function removeClaim(
  tx: Transaction,
  cfg: VenueScope,
  categoryId: string,
): Promise<void> {
  await tx
    .delete(stationClaims)
    .where(
      and(eq(stationClaims.locationId, cfg.locationId), eq(stationClaims.categoryId, categoryId)),
    );
}

export async function createException(
  tx: Transaction,
  cfg: VenueScope,
  input: ExceptionInput,
): Promise<string> {
  await validateRoutingInput(tx, cfg, input);
  const [last] = await tx
    .select({ position: sql<number>`coalesce(max(${routeExceptions.position}), -1)` })
    .from(routeExceptions)
    .where(eq(routeExceptions.locationId, cfg.locationId));
  const [row] = await tx
    .insert(routeExceptions)
    .values({
      locationId: cfg.locationId,
      position: last!.position + 1,
      zoneId: input.zoneId,
      categoryId: input.categoryId,
      productId: input.productId,
      ...storedTarget(input.target),
    })
    .returning({ id: routeExceptions.id });
  return row!.id;
}

/** A product-wide assignment must precede broader exceptions to become the effective route. */
export async function assignUnfiledProduct(
  tx: Transaction,
  cfg: VenueScope,
  productId: string,
  target: RouteTarget,
): Promise<void> {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        productWithId(productId, "top-level"),
        eq(products.active, true),
        isNull(products.categoryId),
      ),
    );
  if (product === undefined)
    throw new AppError("route.subject_not_found", { subject: "product", id: productId });
  await validateRoutingInput(tx, cfg, {
    zoneId: null,
    categoryId: null,
    productId,
    target,
  });
  const existing = await tx
    .select({ id: routeExceptions.id })
    .from(routeExceptions)
    .where(
      and(
        eq(routeExceptions.locationId, cfg.locationId),
        isNull(routeExceptions.zoneId),
        isNull(routeExceptions.categoryId),
        eq(routeExceptions.productId, productId),
      ),
    )
    .orderBy(asc(routeExceptions.position), asc(routeExceptions.id));
  const [first] = await tx
    .select({ position: sql<number>`coalesce(min(${routeExceptions.position}), 0)` })
    .from(routeExceptions)
    .where(eq(routeExceptions.locationId, cfg.locationId));
  const position = first!.position - 1;
  if (existing[0] === undefined) {
    await tx.insert(routeExceptions).values({
      locationId: cfg.locationId,
      position,
      zoneId: null,
      categoryId: null,
      productId,
      ...storedTarget(target),
    });
    return;
  }
  await tx
    .update(routeExceptions)
    .set({ position, ...storedTarget(target) })
    .where(eq(routeExceptions.id, existing[0].id));
  if (existing.length > 1)
    await tx.delete(routeExceptions).where(
      inArray(
        routeExceptions.id,
        existing.slice(1).map((row) => row.id),
      ),
    );
}

export async function updateException(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  input: ExceptionInput,
): Promise<void> {
  await validateRoutingInput(tx, cfg, input);
  const [row] = await tx
    .update(routeExceptions)
    .set({
      zoneId: input.zoneId,
      categoryId: input.categoryId,
      productId: input.productId,
      ...storedTarget(input.target),
    })
    .where(and(eq(routeExceptions.locationId, cfg.locationId), eq(routeExceptions.id, id)))
    .returning({ id: routeExceptions.id });
  if (row === undefined) throw new AppError("route.not_found", { routeId: id });
}

export async function deleteException(tx: Transaction, cfg: VenueScope, id: string): Promise<void> {
  const [row] = await tx
    .delete(routeExceptions)
    .where(and(eq(routeExceptions.locationId, cfg.locationId), eq(routeExceptions.id, id)))
    .returning({ id: routeExceptions.id });
  if (row === undefined) throw new AppError("route.not_found", { routeId: id });
}

export async function reorderExceptions(
  tx: Transaction,
  cfg: VenueScope,
  ids: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({ id: routeExceptions.id })
    .from(routeExceptions)
    .where(eq(routeExceptions.locationId, cfg.locationId));
  const existing = new Set(rows.map((row) => row.id));
  if (
    ids.length !== rows.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !existing.has(id))
  )
    throw new AppError("management.request_invalid", { field: "ids" });
  for (const [position, id] of ids.entries())
    await tx
      .update(routeExceptions)
      .set({ position })
      .where(and(eq(routeExceptions.locationId, cfg.locationId), eq(routeExceptions.id, id)));
}

async function snapshot(tx: Transaction, cfg: VenueScope) {
  const claims = await tx
    .select()
    .from(stationClaims)
    .where(eq(stationClaims.locationId, cfg.locationId))
    .orderBy(asc(stationClaims.categoryId));
  const exceptions = await tx
    .select()
    .from(routeExceptions)
    .where(eq(routeExceptions.locationId, cfg.locationId))
    .orderBy(asc(routeExceptions.position), asc(routeExceptions.id));
  const folders = await tx
    .select({ id: categories.id, name: categories.name, parentId: categoryDetails.parentId })
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
    .orderBy(asc(categories.name), asc(categories.id));
  const stations = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      active: kitchenStations.active,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .where(eq(kitchenStations.locationId, cfg.locationId))
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  const rules: RoutingRules = {
    claims: new Map(claims.map((row) => [row.categoryId, readTarget(row)])),
    exceptions: exceptions.map(({ id, position, zoneId, categoryId, productId, ...row }) => ({
      id,
      position,
      zoneId,
      categoryId,
      productId,
      target: readTarget(row),
    })),
    parentOf: new Map(folders.map((row) => [row.id, row.parentId])),
    activeStationIds: new Set(stations.filter((row) => row.active).map((row) => row.id)),
    defaultStationId: stations.find((row) => row.active && row.isDefault)?.id ?? null,
    timing: new Map(),
  };
  return { rules, folders, stations };
}

export async function loadRoutingRules(tx: Transaction, cfg: VenueScope): Promise<RoutingRules> {
  return (await snapshot(tx, cfg)).rules;
}

export async function explainRoute(
  tx: Transaction,
  cfg: VenueScope,
  productId: string,
  zoneId: string | null,
): Promise<RouteExplanation> {
  const uuid = storedUuid(productId);
  if (zoneId !== null) await resolveZoneContext(tx, cfg, zoneId);
  const { rules, stations } = await snapshot(tx, cfg);
  const [product] = await tx
    .select({
      id: products.id,
      routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
      categoryId: effectiveProductColumns.categoryId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.id, uuid));
  if (product === undefined)
    throw new AppError("route.subject_not_found", { subject: "product", id: productId });
  const choice = chooseMaker(
    rules,
    {
      productId: uuid,
      routedProductId: storedUuid(product.routedId),
      categoryId: product.categoryId,
    },
    zoneId,
    null,
  );
  return {
    ...choice,
    fallbacks: [...choice.fallbacks],
    stations: stations.map(({ id, name, active }) => ({ id, name, active })),
  };
}

export async function previewRoutingChange(
  tx: Transaction,
  cfg: VenueScope,
  change: RoutingChange,
): Promise<RoutingMove[]> {
  const { rules } = await snapshot(tx, cfg);
  const claims = new Map(rules.claims);
  const exceptions = [...rules.exceptions];
  const notFound = (id: string) => new AppError("route.not_found", { routeId: id });
  if (change.kind === "claim") {
    if (change.target !== null) {
      await validateRoutingInput(tx, cfg, {
        zoneId: null,
        categoryId: change.categoryId,
        productId: null,
        target: change.target,
      });
      claims.set(change.categoryId, change.target);
    } else claims.delete(change.categoryId);
  } else if (change.kind === "exception") {
    await validateRoutingInput(tx, cfg, change.input);
    const index = change.id === null ? -1 : exceptions.findIndex((row) => row.id === change.id);
    if (change.id !== null && index < 0) throw notFound(change.id);
    const next = {
      id: change.id ?? "preview",
      position:
        index < 0
          ? Math.max(-1, ...exceptions.map((row) => row.position)) + 1
          : exceptions[index]!.position,
      ...change.input,
    };
    if (index < 0) exceptions.push(next);
    else exceptions[index] = next;
  } else if (change.kind === "exception_delete") {
    const index = exceptions.findIndex((row) => row.id === change.id);
    if (index < 0) throw notFound(change.id);
    exceptions.splice(index, 1);
  } else if (change.kind === "exception_order") {
    const known = new Set(exceptions.map((row) => row.id));
    if (
      change.ids.length !== exceptions.length ||
      new Set(change.ids).size !== change.ids.length ||
      change.ids.some((id) => !known.has(id))
    )
      throw new AppError("management.request_invalid", { field: "ids" });
    for (const [position, id] of change.ids.entries()) {
      const index = exceptions.findIndex((row) => row.id === id);
      exceptions[index] = { ...exceptions[index]!, position };
    }
  } else {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          productWithId(change.productId, "top-level"),
          eq(products.active, true),
          isNull(products.categoryId),
        ),
      );
    if (product === undefined)
      throw new AppError("route.subject_not_found", { subject: "product", id: change.productId });
    await validateRoutingInput(tx, cfg, {
      zoneId: null,
      categoryId: null,
      productId: change.productId,
      target: change.target,
    });
    const existing = exceptions
      .filter(
        (row) =>
          row.zoneId === null && row.categoryId === null && row.productId === change.productId,
      )
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    for (const row of existing) exceptions.splice(exceptions.indexOf(row), 1);
    exceptions.push({
      id: existing[0]?.id ?? "preview",
      position: Math.min(0, ...exceptions.map((row) => row.position)) - 1,
      zoneId: null,
      categoryId: null,
      productId: change.productId,
      target: change.target,
    });
  }
  const after: RoutingRules = { ...rules, claims, exceptions };
  const zones = await tx
    .select({ id: floorZones.id, name: floorZones.name })
    .from(floorZones)
    .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)));
  const productsToCheck = await tx
    .select({
      id: products.id,
      name: products.name,
      routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
      categoryId: effectiveProductColumns.categoryId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.active, true));
  const moves: RoutingMove[] = [];
  for (const product of productsToCheck)
    for (const zone of zones.length ? zones : [{ id: null, name: null }]) {
      const facts = {
        productId: product.id,
        routedProductId: product.routedId,
        categoryId: product.categoryId,
      };
      const from = chooseMaker(rules, facts, zone.id, null).route;
      const to = chooseMaker(after, facts, zone.id, null).route;
      if (JSON.stringify(from) !== JSON.stringify(to))
        moves.push({
          productId: product.id,
          productName: product.name,
          zoneId: zone.id,
          zoneName: zone.name,
          from,
          to,
        });
    }
  return moves.sort(
    (a, b) =>
      a.productName.localeCompare(b.productName) ||
      (a.zoneName ?? "").localeCompare(b.zoneName ?? "") ||
      a.productId.localeCompare(b.productId),
  );
}

/** Canonical database spelling, also used to group caller spellings of one product. */
function storedUuid(id: string): string {
  return normaliseUuid(id, "ProductId");
}

export async function resolveMakers(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string | null,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, RouteTarget | null>> {
  const spellingByUuid = new Map<string, string>();
  for (const id of productIds) {
    const uuid = storedUuid(id);
    if (!spellingByUuid.has(uuid)) spellingByUuid.set(uuid, id);
  }
  const ids = [...spellingByUuid.keys()];
  const outcomes = new Map<string, RouteTarget | null>();
  if (ids.length === 0) return outcomes;
  if (zoneId !== null) await resolveZoneContext(tx, cfg, zoneId);
  const rules = await loadRoutingRules(tx, cfg);
  const productRows = await tx
    .select({
      id: products.id,
      routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
      categoryId: effectiveProductColumns.categoryId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.id, ids));
  const byId = new Map(productRows.map((row) => [storedUuid(row.id), row]));
  for (const [uuid, id] of spellingByUuid) {
    const product = byId.get(uuid);
    if (product === undefined)
      throw new AppError("route.subject_not_found", { subject: "product", id });
    outcomes.set(
      id,
      chooseMaker(
        rules,
        {
          productId: uuid,
          routedProductId: storedUuid(product.routedId),
          categoryId: product.categoryId,
        },
        zoneId,
        null,
      ).route,
    );
  }
  return outcomes;
}

export async function describeMakers(
  tx: Transaction,
  cfg: VenueScope,
): Promise<ReadonlyMap<string, { route: RouteTarget | null; variesByZone: boolean }>> {
  const rules = await loadRoutingRules(tx, cfg);
  const rows = await tx
    .select({
      id: products.id,
      routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
      categoryId: effectiveProductColumns.categoryId,
      parentActive: parentProducts.active,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.active, true));
  const result = new Map<string, { route: RouteTarget | null; variesByZone: boolean }>();
  for (const row of rows) {
    if (row.parentActive === false) continue;
    const ancestors = folderAncestors(rules.parentOf, row.categoryId);
    result.set(row.id, {
      route: chooseMaker(
        rules,
        { productId: row.id, routedProductId: row.routedId, categoryId: row.categoryId },
        null,
        null,
      ).route,
      variesByZone: rules.exceptions.some(
        (exception) =>
          exception.zoneId !== null &&
          (exception.productId === null || exception.productId === row.routedId) &&
          (exception.categoryId === null || ancestors.includes(exception.categoryId)),
      ),
    });
  }
  return result;
}

export async function routingModel(tx: Transaction, cfg: VenueScope): Promise<RoutingModel> {
  const { rules, folders, stations } = await snapshot(tx, cfg);
  const neverMatches = unreachableExceptions(rules);
  const productFolders = await tx
    .select({
      id: products.id,
      parentId: products.parentId,
      categoryId: effectiveProductColumns.categoryId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin);
  const below = (folderId: string | null, earlierId: string) =>
    folderAncestors(rules.parentOf, folderId).includes(earlierId);
  for (const [i, candidate] of rules.exceptions.entries()) {
    if (candidate.productId === null) continue;
    const family = productFolders.filter(
      (row) => row.id === candidate.productId || row.parentId === candidate.productId,
    );
    if (
      family.length > 0 &&
      rules.exceptions
        .slice(0, i)
        .some(
          (earlier) =>
            earlier.categoryId !== null &&
            (earlier.target.kind === "no_preparation" ||
              rules.activeStationIds.has(earlier.target.stationId)) &&
            (earlier.zoneId === null || earlier.zoneId === candidate.zoneId) &&
            family.every((row) => below(row.categoryId, earlier.categoryId!)),
        )
    )
      neverMatches.add(candidate.id);
  }
  const stationOff = (target: RouteTarget) =>
    target.kind === "station" && !rules.activeStationIds.has(target.stationId);
  const namedStations = new Set<string>();
  for (const target of [...rules.claims.values(), ...rules.exceptions.map((e) => e.target)])
    if (target.kind === "station") namedStations.add(target.stationId);
  const unfiled = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.active, true), isNull(products.parentId), isNull(products.categoryId)))
    .orderBy(asc(products.name), asc(products.id));
  return {
    claims: [...rules.claims].map(([categoryId, target]) => ({
      categoryId,
      target,
      stationOff: stationOff(target),
    })),
    exceptions: rules.exceptions.map((e) => ({
      ...e,
      neverMatches: neverMatches.has(e.id),
      stationOff: stationOff(e.target),
    })),
    unassigned: {
      folders: folders
        .filter((row) => row.parentId === null && !rules.claims.has(row.id))
        .map(({ id, name }) => ({ id, name })),
      products: unfiled,
    },
    defaultStationId: rules.defaultStationId,
    stations: stations
      .filter((row) => row.isDefault || namedStations.has(row.id))
      .map(({ id, name, active }) => ({ id, name, active })),
  };
}
