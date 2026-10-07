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
  chooseExtraMaker,
  closedSendsTo,
  folderAncestors,
  stationDayHours,
  stationStatus,
  unreachableExceptions,
  type RouteTarget,
  type RoutingRules,
  type RoutingMoment,
  type StationTransition,
} from "./routing.js";
import { readLocationClock } from "@waitron/reporting";
import {
  clockChangesBetween,
  isReadableClock,
  venueLocalMoment,
  type VenueLocalMoment,
} from "./hours-clock.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { readStationSchedules, stationsRestrictedFrom } from "./hours.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { stationDayStates, stationFallbacks } from "./schema/station-times.js";
import type {
  CellAddress,
  ExceptionInput,
  RouteExplanation,
  RoutingChange,
  RoutingModel,
  RoutingMove,
} from "./routing-types.js";
import { routeExceptions, routingCells, stationClaims } from "./schema/routing.js";
import "./errors.js";
import type { ExtraMakerOutcome, MakerOutcome, MakerResolver } from "@waitron/module";
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

/** Refuses an address or target no ordinary write may store; returns the canonical spelling. */
export async function validateRoutingCell(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
  target: RouteTarget | null,
): Promise<{ address: CellAddress; target: RouteTarget | null }> {
  const { row } = address;
  if (row.kind === "all" && address.zoneId === null)
    throw new AppError("management.request_invalid", { field: "address" });
  const zoneId = address.zoneId === null ? null : normaliseUuid(address.zoneId, "ZoneId");
  if (zoneId !== null) {
    await resolveZoneContext(tx, cfg, zoneId);
    // resolveZoneContext still answers for a zone deactivateServiceZone switched off.
    const [zone] = await tx
      .select({ id: floorZones.id })
      .from(floorZones)
      .where(and(eq(floorZones.id, zoneId), eq(floorZones.active, true)));
    if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
  }
  let canonicalRow = row;
  if (row.kind === "category") {
    const categoryId = normaliseUuid(row.categoryId, "CategoryId");
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId));
    if (category === undefined)
      throw new AppError("route.subject_not_found", { subject: "category", id: categoryId });
    canonicalRow = { kind: "category", categoryId };
  } else if (row.kind === "product") {
    const productId = normaliseUuid(row.productId, "ProductId");
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(productWithId(productId, "top-level"));
    if (product === undefined)
      throw new AppError("route.subject_not_found", { subject: "product", id: productId });
    canonicalRow = { kind: "product", productId };
  }
  let canonicalTarget = target;
  if (target?.kind === "station") {
    const stationId = normaliseUuid(target.stationId, "StationId");
    const [station] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(
        and(
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.id, stationId),
          eq(kitchenStations.active, true),
        ),
      );
    if (station === undefined) throw new AppError("route.station_inactive", { stationId });
    canonicalTarget = { kind: "station", stationId };
  }
  return { address: { row: canonicalRow, zoneId }, target: canonicalTarget };
}

function cellAt(cfg: VenueScope, { row, zoneId }: CellAddress) {
  return and(
    eq(routingCells.locationId, cfg.locationId),
    row.kind === "category"
      ? eq(routingCells.categoryId, row.categoryId)
      : isNull(routingCells.categoryId),
    row.kind === "product"
      ? eq(routingCells.productId, row.productId)
      : isNull(routingCells.productId),
    zoneId === null ? isNull(routingCells.zoneId) : eq(routingCells.zoneId, zoneId),
  );
}

export async function setRoutingCell(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
  target: RouteTarget,
): Promise<void> {
  const valid = await validateRoutingCell(tx, cfg, address, target);
  const stored = storedTarget(valid.target!);
  const updated = await tx
    .update(routingCells)
    .set(stored)
    .where(cellAt(cfg, valid.address))
    .returning({ id: routingCells.id });
  if (updated.length > 0) return;
  const { row, zoneId } = valid.address;
  await tx.insert(routingCells).values({
    locationId: cfg.locationId,
    categoryId: row.kind === "category" ? row.categoryId : null,
    productId: row.kind === "product" ? row.productId : null,
    zoneId,
    ...stored,
  });
}

export async function clearRoutingCell(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
): Promise<void> {
  const valid = await validateRoutingCell(tx, cfg, address, null);
  await tx.delete(routingCells).where(cellAt(cfg, valid.address));
}

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

type VenueClock = { timeZone: string; dayCutover: string };

/** The venue's clock, read once, and its wall-clock moment at `at`, or null when unreadable. */
async function clockAt(tx: Transaction, cfg: VenueScope, at: Date) {
  const clock: VenueClock = await readLocationClock(tx, cfg.locationId);
  return { clock, moment: venueLocalMoment(at, clock) };
}

/**
 * What a snapshot reads beyond the rules themselves: the business day whose by-hand changes apply,
 * and the dates whose special hours apply.
 */
interface SnapshotScope {
  businessDay: string | null;
  dates: { from: LocalDate; to: LocalDate } | null;
}

const UNTIMED: SnapshotScope = { businessDay: null, dates: null };

/**
 * The scope for a status at `moment`, which reads its own date and the day before, whose hours can
 * run past midnight; `daysAhead` reads further dates for the next change.
 */
function scopeAt(moment: VenueLocalMoment | null, daysAhead = 0): SnapshotScope {
  if (moment === null) return UNTIMED;
  return {
    businessDay: moment.businessDay,
    dates: { from: addDays(moment.civilDate, -1), to: addDays(moment.civilDate, daysAhead) },
  };
}

async function snapshot(tx: Transaction, cfg: VenueScope, scope: SnapshotScope = UNTIMED) {
  const businessDay = scope.businessDay;
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
  const stationIds = stations.map((row) => row.id);
  const schedules = await readStationSchedules(tx, cfg, stationIds, scope.dates);
  const fallbacks =
    stationIds.length === 0
      ? []
      : await tx
          .select()
          .from(stationFallbacks)
          .where(inArray(stationFallbacks.stationId, stationIds));
  const dayStates =
    stationIds.length === 0 || businessDay === null
      ? []
      : await tx
          .select()
          .from(stationDayStates)
          .where(
            and(
              inArray(stationDayStates.stationId, stationIds),
              eq(stationDayStates.businessDay, businessDay),
            ),
          );
  const fallbackByStation = new Map(fallbacks.map((row) => [row.stationId, row.fallbackStationId]));
  const todayByStation = new Map(
    dayStates.map((row) => [row.stationId, row.open ? ("open" as const) : ("closed" as const)]),
  );
  const timing = new Map(
    stations.map((station) => [
      station.id,
      {
        ...schedules.get(station.id)!,
        fallbackId: fallbackByStation.get(station.id) ?? null,
        today: todayByStation.get(station.id) ?? null,
      },
    ]),
  );
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
    timing,
  };
  return { rules, folders, stations };
}

export async function loadRoutingRules(
  tx: Transaction,
  cfg: VenueScope,
  businessDay: string | null,
): Promise<RoutingRules> {
  return (await snapshot(tx, cfg, { businessDay, dates: null })).rules;
}

export type ExplainWhen = { kind: "now"; at: Date } | { kind: "at"; moment: RoutingMoment };

export async function explainRoute(
  tx: Transaction,
  cfg: VenueScope,
  productId: string,
  zoneId: string | null,
  when: ExplainWhen,
  extraProductIds: readonly string[] = [],
): Promise<RouteExplanation> {
  const uuid = storedUuid(productId);
  if (zoneId !== null) await resolveZoneContext(tx, cfg, zoneId);
  let moment: RoutingMoment | null;
  let scope = UNTIMED;
  if (when.kind === "now") {
    const now = (await clockAt(tx, cfg, when.at)).moment;
    moment = now;
    scope = scopeAt(now);
  } else if (when.moment.civilDate !== undefined) {
    const { civilDate, timeOfDay } = when.moment;
    const clock = await readLocationClock(tx, cfg.locationId);
    // A minute the clock skips on that date never happens, so there is nothing to preview.
    if (
      isReadableClock(clock) &&
      localTimeOccurrences(civilDate, timeOfDay, clock.timeZone).length === 0
    )
      throw new AppError("management.request_invalid", { field: "time" });
    moment = { civilDate, weekday: weekdayOf(civilDate), timeOfDay };
    scope = { businessDay: null, dates: { from: addDays(civilDate, -1), to: civilDate } };
  } else moment = when.moment;
  const { rules, stations } = await snapshot(tx, cfg, scope);
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
    moment,
  );
  const extrasWaitOnDish = choice.route === null;
  const extras: RouteExplanation["extras"] = [];
  for (const id of extraProductIds) {
    const extraId = storedUuid(id);
    const [extra] = await tx
      .select({
        id: products.id,
        routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
        categoryId: effectiveProductColumns.categoryId,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(eq(products.id, extraId));
    if (extra === undefined)
      throw new AppError("route.subject_not_found", { subject: "product", id });
    if (extrasWaitOnDish) continue;
    const result = chooseExtraMaker(
      rules,
      {
        productId: extraId,
        routedProductId: storedUuid(extra.routedId),
        categoryId: extra.categoryId,
      },
      zoneId,
      moment,
      choice.route.kind === "station" ? choice.route.stationId : null,
    );
    extras.push({
      productId: id,
      outcome: result.outcome,
      decidedBy: result.decidedBy,
      fallbacks: [...result.fallbacks],
    });
  }
  return {
    ...choice,
    clockReadable: moment !== null,
    fallbacks: [...choice.fallbacks],
    stations: stations.map(({ id, name, active }) => ({ id, name, active })),
    extras,
    extrasWaitOnDish,
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
      const previous = chooseMaker(rules, facts, zone.id, null);
      const from = previous.route;
      const next = chooseMaker(after, facts, zone.id, null);
      const to = next.route;
      if (
        JSON.stringify(from) !== JSON.stringify(to) ||
        previous.noReplacement !== next.noReplacement
      )
        moves.push({
          productId: product.id,
          productName: product.name,
          zoneId: zone.id,
          zoneName: zone.name,
          from,
          to,
          toNoReplacement: next.noReplacement,
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

export async function routingAt(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<MakerResolver> {
  const { moment } = await clockAt(tx, cfg, at);
  const { rules, stations } = await snapshot(tx, cfg, scopeAt(moment));
  let stationNames:
    | ReadonlyMap<string, { open: boolean; isDefault: boolean; active: boolean; name: string }>
    | undefined;
  const productFacts = async (productIds: readonly string[]) => {
    const spellingByUuid = new Map<string, string>();
    for (const id of productIds) {
      const uuid = storedUuid(id);
      if (!spellingByUuid.has(uuid)) spellingByUuid.set(uuid, id);
    }
    const rows = await tx
      .select({
        id: products.id,
        routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
        categoryId: effectiveProductColumns.categoryId,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(inArray(products.id, [...spellingByUuid.keys()]));
    const byId = new Map(rows.map((row) => [storedUuid(row.id), row]));
    const facts = new Map<
      string,
      { productId: string; routedProductId: string; categoryId: string | null }
    >();
    for (const [uuid, id] of spellingByUuid) {
      const product = byId.get(uuid);
      if (product === undefined)
        throw new AppError("route.subject_not_found", { subject: "product", id });
      facts.set(uuid, {
        productId: uuid,
        routedProductId: storedUuid(product.routedId),
        categoryId: product.categoryId,
      });
    }
    return { spellingByUuid, facts };
  };
  return {
    at,
    async stations() {
      return (stationNames ??= new Map(
        stations.map((station) => [
          station.id,
          {
            name: station.name,
            isDefault: station.isDefault,
            active: station.active,
            open: stationStatus(rules, station.id, moment).open,
          },
        ]),
      ));
    },
    async makers(zoneId, productIds) {
      const outcomes = new Map<string, MakerOutcome>();
      if (productIds.length === 0) return outcomes;
      if (zoneId !== null) await resolveZoneContext(tx, cfg, zoneId);
      const { spellingByUuid, facts } = await productFacts(productIds);
      for (const [uuid, id] of spellingByUuid) {
        const choice = chooseMaker(rules, facts.get(uuid)!, zoneId, moment);
        outcomes.set(
          id,
          choice.route !== null
            ? { kind: "made", route: choice.route }
            : choice.noReplacement
              ? { kind: "no_replacement", stationId: choice.fallbacks[0]!.stationId }
              : { kind: "no_station" },
        );
      }
      return outcomes;
    },
    async extraMakers(zoneId, extras) {
      const outcomes = new Map<string, ExtraMakerOutcome>();
      if (extras.length === 0) return outcomes;
      if (zoneId !== null) await resolveZoneContext(tx, cfg, zoneId);
      const { facts } = await productFacts(extras.map((extra) => extra.productId));
      for (const extra of extras) {
        const choice = chooseExtraMaker(
          rules,
          facts.get(storedUuid(extra.productId))!,
          zoneId,
          moment,
          extra.dishStationId,
        );
        outcomes.set(extra.key, choice.outcome);
      }
      return outcomes;
    },
  };
}

export async function resolveMakers(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string | null,
  productIds: readonly string[],
  at: Date,
): Promise<ReadonlyMap<string, MakerOutcome>> {
  if (productIds.length === 0) return new Map();
  return (await routingAt(tx, cfg, at)).makers(zoneId, productIds);
}

export async function resolveExtraMakers(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string | null,
  extras: readonly { key: string; productId: string; dishStationId: string | null }[],
  at: Date,
): Promise<ReadonlyMap<string, ExtraMakerOutcome>> {
  if (extras.length === 0) return new Map();
  return (await routingAt(tx, cfg, at)).extraMakers(zoneId, extras);
}

export async function stationStates(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<
  ReadonlyMap<string, { open: boolean; isDefault: boolean; active: boolean; name: string }>
> {
  const { moment } = await clockAt(tx, cfg, at);
  const { rules, stations } = await snapshot(tx, cfg, scopeAt(moment));
  return new Map(
    stations.map((station) => [
      station.id,
      {
        open: stationStatus(rules, station.id, moment).open,
        isDefault: station.isDefault,
        active: station.active,
        name: station.name,
      },
    ]),
  );
}

export async function describeMakers(
  tx: Transaction,
  cfg: VenueScope,
): Promise<
  ReadonlyMap<
    string,
    {
      route: RouteTarget | null;
      variesByZone: boolean;
      noReplacement: boolean;
      unavailableStationId: string | null;
    }
  >
> {
  const rules = await loadRoutingRules(tx, cfg, null);
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
  const result = new Map<
    string,
    {
      route: RouteTarget | null;
      variesByZone: boolean;
      noReplacement: boolean;
      unavailableStationId: string | null;
    }
  >();
  for (const row of rows) {
    if (row.parentActive === false) continue;
    const ancestors = folderAncestors(rules.parentOf, row.categoryId);
    const choice = chooseMaker(
      rules,
      { productId: row.id, routedProductId: row.routedId, categoryId: row.categoryId },
      null,
      null,
    );
    result.set(row.id, {
      route: choice.route,
      noReplacement: choice.noReplacement,
      unavailableStationId: choice.noReplacement ? choice.fallbacks[0]!.stationId : null,
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

export async function routingModel(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<RoutingModel> {
  const { clock, moment } = await clockAt(tx, cfg, at);
  const { rules, folders, stations } = await snapshot(tx, cfg, scopeAt(moment, NEXT_CHANGE_DAYS));
  const cutover = clock.dayCutover.slice(0, 5);
  const nextChange = nextChangeFinder(rules, at, clock, moment);
  const neverMatches = unreachableExceptions(rules);
  const restricted = await stationsRestrictedFrom(tx, cfg, moment?.civilDate ?? null);
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
            (earlier.zoneId === null || earlier.zoneId === candidate.zoneId) &&
            family.every((row) => below(row.categoryId, earlier.categoryId!)),
        )
    )
      neverMatches.add(candidate.id);
  }
  const stationOff = (target: RouteTarget) =>
    target.kind === "station" && !rules.activeStationIds.has(target.stationId);
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
    stations: stations.map(({ id, name, active }) => ({ id, name, active })),
    stationTimes: stations.map(({ id }) => ({
      stationId: id,
      status: stationStatus(rules, id, moment),
      nextTransition: nextChange(id),
      hours: [...(rules.timing.get(id)?.hours ?? [])],
      weekSet: rules.timing.get(id)?.weekSet ?? false,
      specialDateRestricts: restricted.wholeVenue || restricted.stationIds.has(id),
      fallbackStationId: rules.timing.get(id)?.fallbackId ?? null,
      today: rules.timing.get(id)?.today ?? null,
      closedSendsTo: closedSendsTo(rules, id, moment),
    })),
    todayEnds:
      moment === null ? null : { timeOfDay: cutover, tomorrow: moment.timeOfDay >= cutover },
    clockReadable: moment !== null,
  };
}

/** How far ahead the next scheduled change is looked for, in calendar dates. */
const NEXT_CHANGE_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Finds each station's next scheduled change after `at` within {@link NEXT_CHANGE_DAYS}: the first
 * real instant, at an opening, a closing or a clock change, where its scheduled state differs from
 * now's. A closing the clock skips takes effect at the first minute that exists. A station
 * switched off, the default, or changed by hand today has none.
 */
function nextChangeFinder(
  rules: RoutingRules,
  at: Date,
  clock: VenueClock,
  now: VenueLocalMoment | null,
): (stationId: string) => StationTransition | null {
  if (now === null) return () => null;
  const last = addDays(now.civilDate, NEXT_CHANGE_DAYS);
  const clockChanges = clockChangesBetween(
    at,
    new Date(at.getTime() + (NEXT_CHANGE_DAYS + 2) * DAY_MS),
    clock.timeZone,
  ).map((instant) => instant.getTime());
  const occurrences = new Map<string, number[]>();
  const instantsOf = (date: LocalDate, time: string) => {
    const key = `${date} ${time}`;
    if (!occurrences.has(key))
      occurrences.set(
        key,
        localTimeOccurrences(date, time, clock.timeZone).map((instant) => instant.getTime()),
      );
    return occurrences.get(key)!;
  };
  const moments = new Map<number, VenueLocalMoment>();
  const momentAt = (instant: number) => {
    let moment = moments.get(instant);
    if (moment === undefined) {
      moment = venueLocalMoment(new Date(instant), clock)!;
      moments.set(instant, moment);
    }
    return moment;
  };
  return (stationId) => {
    const current = stationStatus(rules, stationId, now);
    if (current.why !== "in_hours" && current.why !== "out_of_hours" && current.why !== "no_hours")
      return null;
    const timing = rules.timing.get(stationId)!;
    const candidates = new Set(clockChanges);
    for (let date = addDays(now.civilDate, -1); date <= last; date = addDays(date, 1)) {
      // A date with hours can follow one with none, or the reverse, with no period edge between.
      const midnight = instantsOf(date, "00:00")[0];
      if (midnight !== undefined) candidates.add(midnight);
      for (const { opensAt, closesAt } of stationDayHours(timing, date, weekdayOf(date)) ?? []) {
        const opening = opensAt.slice(0, 5);
        const closing = closesAt.slice(0, 5);
        for (const instant of instantsOf(date, opening)) candidates.add(instant);
        const closingDate = opening >= closing ? addDays(date, 1) : date;
        for (const instant of instantsOf(closingDate, closing)) candidates.add(instant);
      }
    }
    for (const instant of [...candidates].filter((i) => i > at.getTime()).sort((a, b) => a - b)) {
      const moment = momentAt(instant);
      if (moment.civilDate > last) break;
      if (stationStatus(rules, stationId, moment).open !== current.open)
        return {
          weekday: moment.weekday,
          timeOfDay: moment.timeOfDay,
          daysAhead: (Date.parse(moment.civilDate) - Date.parse(now.civilDate)) / DAY_MS,
        };
    }
    return null;
  };
}
