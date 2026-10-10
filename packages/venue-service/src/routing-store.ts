import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { categories, floorZones, kitchenStations, products, type Transaction } from "@waitron/db";
import {
  categoryDetails,
  documentOffers,
  effectiveProductColumns,
  parentJoin,
  parentProducts,
  productWithId,
  readOfferedExtraItemIds,
  staffPresentationName,
} from "@waitron/catalogue";
import { AppError, normaliseUuid } from "@waitron/shared";
import { liveDocumentsByZone, resolveZoneContext, type VenueScope } from "./operations.js";
import {
  cellKey,
  changeReach,
  chooseMaker,
  chooseExtraMaker,
  chooseExtraMakerBeside,
  closedSendsTo,
  selectRoutingCell,
  stationStatus,
  targetKey,
  type ChangeReach,
  type MakerChoice,
  type ProductFacts,
  type RouteTarget,
  type RoutingRules,
  type RoutingMoment,
} from "./routing.js";
import { readLocationClock } from "@waitron/reporting";
import { venueLocalMoment, type VenueLocalMoment } from "./hours-clock.js";
import { stationDayStates } from "./schema/station-times.js";
import type {
  CellAddress,
  PeriodLine,
  RoutingCell,
  RoutingChange,
  RoutingModel,
  RoutingMove,
} from "./routing-types.js";
import {
  inPeriodOrder,
  periodProductIds,
  readPeriods,
  readRoutingPeriods,
} from "./routing-periods.js";
import { resolveDepartmentService } from "./menu-timetable.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import "./errors.js";
import type {
  ExtraMakerOutcome,
  MakerOutcome,
  MakerResolver,
  StationTodayState,
} from "@waitron/module";
export type { RoutingChange, RoutingModel, RoutingMove } from "./routing-types.js";

const storedTarget = (target: RouteTarget) => ({
  stationId: target.kind === "station" ? target.stationId : null,
  noPreparation: target.kind === "no_preparation",
});
const readTarget = (row: { stationId: string | null }): RouteTarget =>
  row.stationId === null
    ? { kind: "no_preparation" }
    : { kind: "station", stationId: row.stationId };
const readCell = (row: typeof routingCells.$inferSelect): RoutingCell => ({
  row:
    row.productId !== null
      ? { kind: "product", productId: row.productId }
      : row.categoryId !== null
        ? { kind: "category", categoryId: row.categoryId }
        : row.noCategory
          ? { kind: "no_category" }
          : { kind: "all" },
  zoneId: row.zoneId,
  target: readTarget(row),
});

/** Active zones in the grid's column order. */
function activeZones(tx: Transaction, cfg: VenueScope) {
  return tx
    .select({ id: floorZones.id, name: floorZones.name })
    .from(floorZones)
    .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
}

/** Refuses an address or target no ordinary write may store; returns the canonical spelling. */
async function validateRoutingCell(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
  target: RouteTarget | null,
): Promise<{ address: CellAddress; target: RouteTarget | null; departmentId: string | null }> {
  const { row } = address;
  if (row.kind === "all" && address.zoneId === null)
    throw new AppError("management.request_invalid", { field: "address" });
  const zoneId = address.zoneId === null ? null : normaliseUuid(address.zoneId, "ZoneId");
  let departmentId: string | null = null;
  if (zoneId !== null) {
    // resolveZoneContext's check, and the zone switched on, which it does not ask.
    const [zone] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
      .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
      .where(
        and(
          eq(zoneServicePolicies.locationId, cfg.locationId),
          eq(zoneServicePolicies.zoneId, zoneId),
          eq(departments.active, true),
          eq(floorZones.active, true),
        ),
      );
    if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
    departmentId = zone.departmentId;
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
  return {
    address: { row: canonicalRow, zoneId },
    target: target === null ? null : await activeTarget(tx, cfg, target),
    departmentId,
  };
}

async function activeTarget(
  tx: Transaction,
  cfg: VenueScope,
  target: RouteTarget,
): Promise<RouteTarget> {
  if (target.kind !== "station") return target;
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
  return { kind: "station", stationId };
}

type StoredLine = PeriodLine & { departmentId: string };

/** The cell's stored period lines, by period id. */
async function storedLines(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
): Promise<Map<string, RouteTarget>> {
  const rows = await tx
    .select({ periodId: routingCellPeriods.periodId, stationId: routingCellPeriods.stationId })
    .from(routingCellPeriods)
    .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
    .where(cellAt(cfg, address));
  return new Map(rows.map((row) => [row.periodId, readTarget(row)]));
}

/**
 * Refuses a line no cell at this address may store. The menu check passes over a line the cell
 * already stores with the same target: a later menu change does not invalidate a saved line.
 */
async function validatePeriodLines(
  tx: Transaction,
  cfg: VenueScope,
  cell: { address: CellAddress; departmentId: string | null },
  lines: readonly PeriodLine[],
): Promise<StoredLine[]> {
  const invalid = (periodId: string, reason: "other_department" | "repeated" | "not_offered") =>
    new AppError("route.period_invalid", { periodId, reason });
  const seen = new Set<string>();
  const canonical = lines.map((line) => {
    const periodId = normaliseUuid(line.periodId, "PeriodId");
    if (seen.has(periodId)) throw invalid(periodId, "repeated");
    seen.add(periodId);
    return { periodId, target: line.target };
  });
  const periods = new Map((await readPeriods(tx, cfg, [...seen])).map((row) => [row.id, row]));
  const valid: StoredLine[] = [];
  for (const line of canonical) {
    const period = periods.get(line.periodId);
    if (period === undefined)
      throw new AppError("route.subject_not_found", { subject: "period", id: line.periodId });
    if (cell.departmentId !== null && period.departmentId !== cell.departmentId)
      throw invalid(line.periodId, "other_department");
    valid.push({
      periodId: line.periodId,
      departmentId: period.departmentId,
      target:
        line.target.kind === "station"
          ? { kind: "station", stationId: normaliseUuid(line.target.stationId, "StationId") }
          : line.target,
    });
  }
  const stationIds = valid.flatMap(({ target }) =>
    target.kind === "station" ? [target.stationId] : [],
  );
  if (stationIds.length > 0) {
    const active = new Set(
      (
        await tx
          .select({ id: kitchenStations.id })
          .from(kitchenStations)
          .where(
            and(
              eq(kitchenStations.locationId, cfg.locationId),
              inArray(kitchenStations.id, stationIds),
              eq(kitchenStations.active, true),
            ),
          )
      ).map((row) => row.id),
    );
    const inactive = stationIds.find((stationId) => !active.has(stationId));
    if (inactive !== undefined)
      throw new AppError("route.station_inactive", { stationId: inactive });
  }
  const stored = await storedLines(tx, cfg, cell.address);
  const unchecked = valid.filter(
    (line) => targetKey(stored.get(line.periodId) ?? null) !== targetKey(line.target),
  );
  if (unchecked.length === 0) return valid;
  const rowProducts = await readRowProductIds(tx, cell.address);
  const offered = await periodProductIds(
    tx,
    unchecked.map((line) => periods.get(line.periodId)!),
  );
  for (const line of unchecked)
    if (!offered.get(line.periodId)!.some((productId) => rowProducts.has(productId)))
      throw invalid(line.periodId, "not_offered");
  return valid;
}

async function readRowProductIds(tx: Transaction, address: CellAddress): Promise<Set<string>> {
  const { row } = address;
  const folders =
    row.kind === "category"
      ? await tx
          .select({ id: categories.id, parentId: categoryDetails.parentId })
          .from(categories)
          .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
      : [];
  return rowProductIds(
    new Map(folders.map((folder) => [folder.id, folder.parentId])),
    address,
    await activeProducts(tx, row.kind === "product" ? row.productId : undefined),
  );
}

/** Of `active`, the products a row covers, variants by their parent's id. */
function rowProductIds(
  parentOf: ReadonlyMap<string, string | null>,
  address: CellAddress,
  active: readonly { id: string; routedId: string; categoryId: string | null }[],
): Set<string> {
  const reach = changeReach(parentOf, address);
  const covered = new Set<string>();
  for (const product of active) {
    const facts = rowFacts(product);
    if (reach.covers(facts)) covered.add(facts.routedProductId);
  }
  return covered;
}

/** Every active product, or only `routedId`'s own row and its variants'. */
function activeProducts(tx: Transaction, routedId?: string) {
  return tx
    .select({
      id: products.id,
      name: products.name,
      parentName: parentProducts.name,
      routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
      categoryId: effectiveProductColumns.categoryId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(
      and(
        eq(products.active, true),
        routedId === undefined
          ? undefined
          : or(eq(products.id, routedId), eq(products.parentId, routedId)),
      ),
    );
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
    eq(routingCells.noCategory, row.kind === "no_category"),
    zoneId === null ? isNull(routingCells.zoneId) : eq(routingCells.zoneId, zoneId),
  );
}

/** `periods` replaces the cell's period lines; omitted, the stored lines stay. */
export async function setRoutingCell(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
  target: RouteTarget,
  periods?: readonly PeriodLine[],
): Promise<void> {
  const valid = await validateRoutingCell(tx, cfg, address, target);
  const lines =
    periods === undefined ? undefined : await validatePeriodLines(tx, cfg, valid, periods);
  const stored = storedTarget(valid.target!);
  const [updated] = await tx
    .update(routingCells)
    .set(stored)
    .where(cellAt(cfg, valid.address))
    .returning({ id: routingCells.id });
  const { row, zoneId } = valid.address;
  const cellId =
    updated?.id ??
    (
      await tx
        .insert(routingCells)
        .values({
          locationId: cfg.locationId,
          categoryId: row.kind === "category" ? row.categoryId : null,
          productId: row.kind === "product" ? row.productId : null,
          noCategory: row.kind === "no_category",
          zoneId,
          ...stored,
        })
        .returning({ id: routingCells.id })
    )[0]!.id;
  if (lines === undefined) return;
  // Nothing outside the table points at a line, so the set is replaced whole.
  await tx.delete(routingCellPeriods).where(eq(routingCellPeriods.cellId, cellId));
  if (lines.length > 0)
    await tx.insert(routingCellPeriods).values(
      lines.map((line) => ({
        cellId,
        periodId: line.periodId,
        departmentId: line.departmentId,
        ...storedTarget(line.target),
      })),
    );
}

export async function clearRoutingCell(
  tx: Transaction,
  cfg: VenueScope,
  address: CellAddress,
): Promise<void> {
  const valid = await validateRoutingCell(tx, cfg, address, null);
  await tx.delete(routingCells).where(cellAt(cfg, valid.address));
}

type VenueClock = { timeZone: string; dayCutover: string };

/** The venue's clock, read once, and its wall-clock moment at `at`, or null when unreadable. */
async function clockAt(tx: Transaction, cfg: VenueScope, at: Date) {
  const clock: VenueClock = await readLocationClock(tx, cfg.locationId);
  return { clock, moment: venueLocalMoment(at, clock) };
}

interface SnapshotScope {
  businessDay: string | null;
}

const UNTIMED: SnapshotScope = { businessDay: null };

function scopeAt(moment: VenueLocalMoment | null): SnapshotScope {
  return { businessDay: moment?.businessDay ?? null };
}

async function snapshot(tx: Transaction, cfg: VenueScope, scope: SnapshotScope = UNTIMED) {
  const businessDay = scope.businessDay;
  const cellRows = await tx
    .select()
    .from(routingCells)
    .where(eq(routingCells.locationId, cfg.locationId))
    .orderBy(asc(routingCells.id));
  const periodRows = await tx
    .select({
      cellId: routingCellPeriods.cellId,
      periodId: routingCellPeriods.periodId,
      stationId: routingCellPeriods.stationId,
    })
    .from(routingCellPeriods)
    .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
    .where(eq(routingCells.locationId, cfg.locationId));
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
              eq(stationDayStates.open, false),
            ),
          );
  const todayByStation = new Map(dayStates.map((row) => [row.stationId, "closed" as const]));
  const destinationByStation = new Map(
    dayStates.map((row) => [row.stationId, row.sendsToStationId]),
  );
  const timing = new Map(
    stations.map((station) => [
      station.id,
      {
        today: todayByStation.get(station.id) ?? null,
        todaySendsTo: destinationByStation.get(station.id) ?? null,
      },
    ]),
  );
  const cells = cellRows.map(readCell);
  const keyOfCell = new Map(cellRows.map((row, index) => [row.id, cellKey(cells[index]!)]));
  const cellPeriods = new Map<string, Map<string, RouteTarget>>();
  for (const row of periodRows) {
    const key = keyOfCell.get(row.cellId)!;
    const lines = cellPeriods.get(key) ?? new Map<string, RouteTarget>();
    lines.set(row.periodId, readTarget(row));
    cellPeriods.set(key, lines);
  }
  const rules: RoutingRules = {
    cells: Object.freeze(cells),
    parentOf: new Map(folders.map((row) => [row.id, row.parentId])),
    activeStationIds: new Set(stations.filter((row) => row.active).map((row) => row.id)),
    defaultStationId: stations.find((row) => row.active && row.isDefault)?.id ?? null,
    timing,
    cellPeriods,
  };
  return { rules, folders, stations };
}

export async function loadRoutingRules(
  tx: Transaction,
  cfg: VenueScope,
  businessDay: string | null,
): Promise<RoutingRules> {
  return (await snapshot(tx, cfg, { businessDay })).rules;
}

export async function previewRoutingChange(
  tx: Transaction,
  cfg: VenueScope,
  change: RoutingChange,
): Promise<RoutingMove[]> {
  const { rules } = await snapshot(tx, cfg);
  const valid = await validateRoutingCell(tx, cfg, change.address, change.target);
  const { address, target } = valid;
  const lines =
    change.periods === undefined
      ? undefined
      : await validatePeriodLines(tx, cfg, valid, change.periods);
  const key = cellKey(address);
  const cells = rules.cells.filter((cell) => cellKey(cell) !== key);
  if (target !== null) cells.push({ ...address, target });
  const cellPeriods = new Map(rules.cellPeriods);
  if (target === null || lines?.length === 0) cellPeriods.delete(key);
  else if (lines !== undefined)
    cellPeriods.set(key, new Map(lines.map((line) => [line.periodId, line.target])));
  const after: RoutingRules = { ...rules, cells: Object.freeze(cells), cellPeriods };
  const zones = await activeZones(tx, cfg);
  const productsToCheck = await activeProducts(tx);
  const reach = changeReach(rules.parentOf, address);
  const zoneList = (zones.length ? zones : [{ id: null, name: null }]).filter((zone) =>
    reach.reachesZone(zone.id),
  );
  const offers = await readExtraOffers(tx, cfg, productsToCheck, zoneList);
  const compare = (
    before: RoutingRules,
    after: RoutingRules,
    inZones: readonly { id: string | null; name: string | null }[],
  ): Omit<RoutingMove, "periodIds">[] => {
    const moves: Omit<RoutingMove, "periodIds">[] = [];
    const dishChoices = new Map<string, { before: MakerChoice; after: MakerChoice }>();
    for (const product of productsToCheck) {
      const facts = rowFacts(product);
      if (!reach.covers(facts)) continue;
      for (const zone of inZones) {
        const previous = chooseMaker(before, facts, zone.id, null);
        const from = previous.route;
        const next = chooseMaker(after, facts, zone.id, null);
        const to = next.route;
        dishChoices.set(choiceKey(product.id, zone.id), { before: previous, after: next });
        if (!sameRoute(from, to) || previous.noReplacement !== next.noReplacement)
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
    }
    moves.push(
      ...extraMoves({ before, after }, productsToCheck, offers, inZones, reach, dishChoices),
    );
    return moves;
  };
  const moves: RoutingMove[] = compare(rules, after, zoneList).map((move) => ({
    ...move,
    periodIds: null,
  }));
  const timedPeriods = await periodsDeciding(tx, cfg, [rules, after], {
    productsToCheck,
    offers,
    zoneList,
    reach,
  });
  const sameKey = (move: Omit<RoutingMove, "periodIds">) =>
    JSON.stringify([
      move.productId,
      move.dish?.productId ?? null,
      move.zoneId,
      targetKey(move.from),
      targetKey(move.to),
      move.toNoReplacement,
    ]);
  const allDay = new Set(moves.map(sameKey));
  const timed = new Map<string, RoutingMove>();
  for (const { id: periodId, inZones } of timedPeriods)
    for (const move of compare(during(rules, periodId), during(after, periodId), inZones)) {
      const same = sameKey(move);
      if (allDay.has(same)) continue;
      const merged = timed.get(same);
      if (merged === undefined) timed.set(same, { ...move, periodIds: [periodId] });
      else merged.periodIds!.push(periodId);
    }
  moves.push(...timed.values());
  return moves.sort(
    (a, b) =>
      a.productName.localeCompare(b.productName) ||
      (a.dish?.productName ?? "").localeCompare(b.dish?.productName ?? "") ||
      (a.zoneName ?? "").localeCompare(b.zoneName ?? "") ||
      a.productId.localeCompare(b.productId) ||
      (a.dish?.productId ?? "").localeCompare(b.dish?.productId ?? "") ||
      (a.periodIds?.join() ?? "").localeCompare(b.periodIds?.join() ?? ""),
  );
}

/**
 * The periods whose line, in either state, is on the cell that decides a product the preview
 * compares, in a zone of the period's department; each with those zones, in the routing model's
 * period order. A dish the change reaches brings its offered extras, and an extra it reaches its
 * dishes, as `extraMoves` compares them.
 */
async function periodsDeciding(
  tx: Transaction,
  cfg: VenueScope,
  states: readonly RoutingRules[],
  {
    productsToCheck,
    offers,
    zoneList,
    reach,
  }: {
    productsToCheck: readonly PreviewProduct[];
    offers: ExtraOffers;
    zoneList: readonly { id: string | null; name: string | null }[];
    reach: ChangeReach;
  },
): Promise<{ id: string; inZones: { id: string | null; name: string | null }[] }[]> {
  if (!states.some((state) => state.cellPeriods !== undefined && state.cellPeriods.size > 0))
    return [];
  const byId = new Map(productsToCheck.map((product) => [storedUuid(product.id), product]));
  const compared = new Map<string, ProductFacts>();
  for (const dish of productsToCheck) {
    const dishFacts = rowFacts(dish);
    const dishInReach = reach.covers(dishFacts);
    if (dishInReach) compared.set(dishFacts.productId, dishFacts);
    for (const extraId of offers.get(dishFacts.productId)?.keys() ?? []) {
      const extra = byId.get(extraId);
      if (extra === undefined) continue;
      const facts = rowFacts(extra);
      if (!dishInReach && !reach.covers(facts)) continue;
      compared.set(dishFacts.productId, dishFacts);
      compared.set(facts.productId, facts);
    }
  }
  const periods = await readPeriods(tx, cfg);
  const departmentOf = new Map(periods.map((period) => [period.id, period.departmentId]));
  const zoneDepartment = await zoneDepartments(tx, cfg);
  const named = new Set<string>();
  for (const zone of zoneList) {
    const departmentId = zone.id === null ? undefined : zoneDepartment.get(zone.id);
    if (departmentId === undefined) continue;
    for (const facts of compared.values())
      for (const state of states) {
        const { decidedBy } = selectRoutingCell(
          state,
          { kind: "product", productId: facts.routedProductId },
          zone.id,
          facts.categoryId,
        );
        if (decidedBy?.kind !== "cell") continue;
        for (const periodId of state.cellPeriods?.get(cellKey(decidedBy.address))?.keys() ?? [])
          if (departmentOf.get(periodId) === departmentId) named.add(periodId);
      }
  }
  if (named.size === 0) return [];
  const { dayCutover } = await readLocationClock(tx, cfg.locationId);
  const ordered = await inPeriodOrder(
    tx,
    cfg,
    periods.filter((period) => named.has(period.id)),
    dayCutover,
  );
  return ordered.map((period) => ({
    id: period.id,
    inZones: zoneList.filter(
      (zone) => zone.id !== null && zoneDepartment.get(zone.id) === period.departmentId,
    ),
  }));
}

/**
 * The rules as they stand while `periodId` runs, for zones of its department alone: each cell's
 * line for it replaces the cell's own target.
 */
function during(rules: RoutingRules, periodId: string): RoutingRules {
  const cells = rules.cells.map((cell) => {
    const line = rules.cellPeriods?.get(cellKey(cell))?.get(periodId);
    return line === undefined ? cell : { ...cell, target: line };
  });
  return { ...rules, cells: Object.freeze(cells), cellPeriods: undefined };
}

async function zoneDepartments(tx: Transaction, cfg: VenueScope): Promise<Map<string, string>> {
  const rows = await tx
    .select({ zoneId: zoneServicePolicies.zoneId, departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.locationId, cfg.locationId));
  return new Map(rows.map((row) => [row.zoneId, row.departmentId]));
}

const rowFacts = (product: { id: string; routedId: string; categoryId: string | null }) => ({
  productId: storedUuid(product.id),
  routedProductId: storedUuid(product.routedId),
  categoryId: product.categoryId,
});

const choiceKey = (productId: string, zoneId: string | null) =>
  `${storedUuid(productId)}\u0000${zoneId ?? ""}`;

type PreviewProduct = {
  id: string;
  name: string;
  parentName: string | null;
  routedId: string;
  categoryId: string | null;
};
/** By dish, then extra: the zones the extra is offered in with the dish. */
type ExtraOffers = Map<string, Map<string, Set<string | null>>>;

/**
 * A dish offers an extra when the live catalogue attaches it, in every zone, or when a published
 * menu a zone serves offers it with the dish, in that zone: an order sells from the published
 * menu, and a catalogue edit is asked about before it is published.
 */
async function readExtraOffers(
  tx: Transaction,
  cfg: VenueScope,
  dishes: readonly PreviewProduct[],
  zones: readonly { id: string | null }[],
): Promise<ExtraOffers> {
  const extrasByDish = new Map<string, Map<string, Set<string | null>>>();
  const offer = (dishId: string, extraId: string, zoneIds: readonly (string | null)[]) => {
    const dish = storedUuid(dishId);
    const extra = storedUuid(extraId);
    let extras = extrasByDish.get(dish);
    if (extras === undefined) extrasByDish.set(dish, (extras = new Map()));
    let inZones = extras.get(extra);
    if (inZones === undefined) extras.set(extra, (inZones = new Set()));
    for (const zoneId of zoneIds) inZones.add(zoneId);
  };
  const everyZone = zones.map((zone) => zone.id);
  // A variant's own attachments are never offered: a menu refuses a variant
  // (`menu_item.variant_not_allowed`) and `listAvailableProducts` lists top-level products alone.
  const live = await readOfferedExtraItemIds(
    tx,
    dishes.flatMap((dish) =>
      dish.parentName === null ? [{ productId: dish.id, menuItemId: null }] : [],
    ),
  );
  for (const [dishId, itemIds] of live)
    for (const itemId of itemIds) offer(dishId, itemId, everyZone);
  // A variant is never an offer of its own, and routes exactly as its parent, the offer's product.
  for (const [zoneId, menus] of await liveDocumentsByZone(tx, cfg))
    for (const served of menus.flatMap((menu) => documentOffers(menu.document)))
      for (const modifier of served.offeredModifiers)
        if (modifier.kind === "extras")
          for (const item of modifier.items) offer(served.productId, item.productId, [zoneId]);
  return extrasByDish;
}

/**
 * Where each offered extra is made before and after a change. An extra that follows its dish in
 * both states is left out, since the dish's own move already says where it goes.
 */
function extraMoves(
  rules: { before: RoutingRules; after: RoutingRules },
  dishes: readonly PreviewProduct[],
  extrasByDish: ExtraOffers,
  zones: readonly { id: string | null; name: string | null }[],
  reach: ChangeReach,
  dishChoices: Map<string, { before: MakerChoice; after: MakerChoice }>,
): Omit<RoutingMove, "periodIds">[] {
  // Every Active product is a dish here, so an Inactive extra, which cannot be picked whatever a
  // published menu still lists, is not found.
  const active = new Map(dishes.map((dish) => [storedUuid(dish.id), dish]));
  const placeIn = (
    rules: RoutingRules,
    dishChoice: MakerChoice,
    extra: ProductFacts,
    zoneId: string | null,
  ): { follows: boolean; target: RouteTarget | null; noReplacement: boolean } => {
    const made = chooseExtraMakerBeside(rules, dishChoice, extra, zoneId, null)?.outcome;
    return made?.kind === "made"
      ? {
          follows: false,
          target: { kind: "station", stationId: made.stationId },
          noReplacement: false,
        }
      : { follows: true, target: dishChoice.route, noReplacement: dishChoice.noReplacement };
  };
  const moves: Omit<RoutingMove, "periodIds">[] = [];
  // A dish the change cannot reach keeps its choice, so it is worked out once, for both states.
  const choiceBeside = (dish: ProductFacts, zoneId: string | null) => {
    const key = choiceKey(dish.productId, zoneId);
    let choice = dishChoices.get(key);
    if (choice === undefined) {
      const unchanged = chooseMaker(rules.before, dish, zoneId, null);
      dishChoices.set(key, (choice = { before: unchanged, after: unchanged }));
    }
    return choice;
  };
  for (const dish of dishes) {
    const dishFacts = rowFacts(dish);
    const dishInReach = reach.covers(dishFacts);
    for (const [extraId, inZones] of extrasByDish.get(dishFacts.productId) ?? []) {
      const extra = active.get(extraId);
      if (extra === undefined) continue;
      const facts = rowFacts(extra);
      if (!dishInReach && !reach.covers(facts)) continue;
      for (const zone of zones) {
        if (!inZones.has(zone.id)) continue;
        const dishChoice = choiceBeside(dishFacts, zone.id);
        const from = placeIn(rules.before, dishChoice.before, facts, zone.id);
        const to = placeIn(rules.after, dishChoice.after, facts, zone.id);
        if ((from.follows && to.follows) || sameRoute(from.target, to.target)) continue;
        moves.push({
          productId: extra.id,
          productName: staffName(extra),
          zoneId: zone.id,
          zoneName: zone.name,
          from: from.target,
          to: to.target,
          toNoReplacement: to.noReplacement,
          dish: { productId: dish.id, productName: staffName(dish) },
        });
      }
    }
  }
  return moves;
}

const staffName = (row: { name: string; parentName: string | null }) =>
  row.parentName === null
    ? row.name
    : staffPresentationName({ name: row.parentName, variantName: row.name });

const sameRoute = (a: RouteTarget | null, b: RouteTarget | null) => targetKey(a) === targetKey(b);

/** Canonical database spelling, also used to group caller spellings of one product. */
function storedUuid(id: string): string {
  return normaliseUuid(id, "ProductId");
}

/**
 * `runningPeriod` answers a department's running period at `at`; it is asked at most once per
 * department, the first time a dish in one of its zones is routed, and never when no cell has
 * period lines.
 */
export async function routingAt(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
  {
    runningPeriod = async (departmentId: string) =>
      (await resolveDepartmentService(tx, cfg, departmentId, at)).periodId,
  }: { runningPeriod?: (departmentId: string) => Promise<string | null> } = {},
): Promise<MakerResolver> {
  const { moment } = await clockAt(tx, cfg, at);
  const snapshotted = await snapshot(tx, cfg, scopeAt(moment));
  const { stations } = snapshotted;
  const zoneDepartment = new Map<string, string>();
  const periods = new Map<string, string | null>();
  const rules: RoutingRules = { ...snapshotted.rules, zoneDepartment };
  const routedMoment: RoutingMoment | null = moment === null ? null : { ...moment, periods };
  const anyPeriodLines = (rules.cellPeriods?.size ?? 0) > 0;
  const enterZone = async (zoneId: string | null) => {
    if (zoneId === null) return;
    const { departmentId } = await resolveZoneContext(tx, cfg, zoneId);
    zoneDepartment.set(zoneId, departmentId);
    if (moment !== null && anyPeriodLines && !periods.has(departmentId))
      periods.set(departmentId, await runningPeriod(departmentId));
  };
  let stationNames: ReadonlyMap<string, StationTodayState> | undefined;
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
            ...stationTodayState(rules, station.id, moment),
          },
        ]),
      ));
    },
    async makers(zoneId, productIds) {
      const outcomes = new Map<string, MakerOutcome>();
      if (productIds.length === 0) return outcomes;
      await enterZone(zoneId);
      const { spellingByUuid, facts } = await productFacts(productIds);
      for (const [uuid, id] of spellingByUuid) {
        const choice = chooseMaker(rules, facts.get(uuid)!, zoneId, routedMoment);
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
      await enterZone(zoneId);
      const { facts } = await productFacts(extras.map((extra) => extra.productId));
      for (const extra of extras) {
        const choice = chooseExtraMaker(
          rules,
          facts.get(storedUuid(extra.productId))!,
          zoneId,
          routedMoment,
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

function stationTodayState(
  rules: RoutingRules,
  stationId: string,
  moment: RoutingMoment | null,
): Pick<StationTodayState, "open" | "byHand" | "sendsTo" | "why"> {
  const status = stationStatus(rules, stationId, moment);
  return {
    open: status.open,
    byHand: rules.timing.get(stationId)?.today ?? null,
    sendsTo: status.open ? null : closedSendsTo(rules, stationId, moment),
    why: status.why,
  };
}

export async function stationStates(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<ReadonlyMap<string, StationTodayState>> {
  const { moment } = await clockAt(tx, cfg, at);
  const { rules, stations } = await snapshot(tx, cfg, scopeAt(moment));
  return new Map(
    stations.map((station) => [
      station.id,
      {
        ...stationTodayState(rules, station.id, moment),
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
  // A zone no cell names routes every product as Every zone does.
  const zoned = new Set(rules.cells.map((cell) => cell.zoneId));
  const zones = (await activeZones(tx, cfg)).filter(({ id }) => zoned.has(id));
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
    const facts = { productId: row.id, routedProductId: row.routedId, categoryId: row.categoryId };
    const choice = chooseMaker(rules, facts, null, null);
    result.set(row.id, {
      route: choice.route,
      noReplacement: choice.noReplacement,
      unavailableStationId: choice.noReplacement ? choice.fallbacks[0]!.stationId : null,
      variesByZone: zones.some(({ id }) => {
        const inZone = chooseMaker(rules, facts, id, null);
        return (
          inZone.noReplacement !== choice.noReplacement || !sameRoute(inZone.route, choice.route)
        );
      }),
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
  const { rules, folders, stations } = await snapshot(tx, cfg, scopeAt(moment));
  const cutover = clock.dayCutover.slice(0, 5);
  const zoneDepartment = await zoneDepartments(tx, cfg);
  const zones = (await activeZones(tx, cfg)).map((zone) => ({
    ...zone,
    departmentId: zoneDepartment.get(zone.id) ?? null,
  }));
  const gridProducts = await tx
    .select({ id: products.id, name: products.name, categoryId: products.categoryId })
    .from(products)
    .where(and(eq(products.active, true), isNull(products.parentId)))
    .orderBy(asc(products.name), asc(products.id));
  const shown = new Set(gridProducts.map((product) => product.id));
  const periods = await readRoutingPeriods(tx, cfg, clock.dayCutover);
  const periodOrder = new Map(periods.map((period, index) => [period.id, index]));
  const periodProducts = new Map(periods.map((period) => [period.id, period.productIds]));
  const active = (rules.cellPeriods?.size ?? 0) > 0 ? await activeProducts(tx) : [];
  const productsOfRow = new Map<string, Set<string>>();
  const rowProducts = (cell: CellAddress) => {
    const key = cellKey({ row: cell.row, zoneId: null });
    let found = productsOfRow.get(key);
    if (found === undefined)
      productsOfRow.set(key, (found = rowProductIds(rules.parentOf, cell, active)));
    return found;
  };
  return {
    zones,
    categories: folders,
    products: gridProducts,
    cells: rules.cells
      .filter((cell) => cell.row.kind !== "product" || shown.has(cell.row.productId))
      .map((cell) => {
        const lines = rules.cellPeriods?.get(cellKey(cell));
        if (lines === undefined) return cell;
        const covered = rowProducts(cell);
        return {
          ...cell,
          periods: [...lines]
            .map(([periodId, target]) =>
              (periodProducts.get(periodId) ?? []).some((productId) => covered.has(productId))
                ? { periodId, target }
                : { periodId, target, notOffered: true as const },
            )
            .sort(
              (a, b) =>
                (periodOrder.get(a.periodId) ?? periods.length) -
                (periodOrder.get(b.periodId) ?? periods.length),
            ),
        };
      }),
    periods,
    defaultStationId: rules.defaultStationId,
    stations: stations.map(({ id, name, active }) => ({ id, name, active })),
    stationTimes: stations.map(({ id }) => ({
      stationId: id,
      status: stationStatus(rules, id, moment),
      fallbackStationId: null,
      today: rules.timing.get(id)?.today ?? null,
      closedSendsTo: closedSendsTo(rules, id, moment),
    })),
    todayEnds:
      moment === null ? null : { timeOfDay: cutover, tomorrow: moment.timeOfDay >= cutover },
    clockReadable: moment !== null,
  };
}
