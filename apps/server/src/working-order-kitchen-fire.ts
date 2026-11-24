import "./errors.js";
import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  statementChunks,
  isUniqueViolation,
  kitchenStations,
  kitchenCourses,
  workingOrders,
  products,
} from "@waitron/db";
import { parentProducts, parentJoin } from "@waitron/menu";
import type { MakerResolver, MakerOutcome, TicketAllergyCopy } from "@waitron/module";
import { AppError, staffPresentationName } from "@waitron/shared";
import {
  inArray,
  type GetColumnData,
  eq,
  and,
  isNull,
  sql,
  or,
  exists,
  ne,
  type SQL,
  isNotNull,
} from "drizzle-orm";
import {
  attachKitchenAllergyCopies,
  freezeKitchenAllergies,
  freezeKitchenAllergyItems,
} from "./kitchen-allergy.js";
import { initiatedItem } from "./kitchen-phase.js";
import { enqueueKitchenTickets } from "./kitchen-print.js";
import { requestStamps, passWaitingStations, requestHeldItems } from "./kitchen-release.js";
import { captureSentLineNutrition } from "./line-nutrition.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import { readMadeHereStations } from "./made-here.js";
import { VENUE_SERVICE } from "./modules.js";
import { partyOfOrder } from "./parties.js";
import { assertPartyAllergyAnswered } from "./party-allergy.js";
import { productActive } from "./stored-order-lines.js";
import type { TradingContext } from "./trading-context.js";

async function noDefaultStation(
  tx: Transaction,
  lines: readonly FireableLine[],
): Promise<AppError<"station.no_default">> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
    })
    .from(workingOrderLines)
    .where(
      inArray(
        workingOrderLines.id,
        lines.map((line) => line.id),
      ),
    );
  const nameOf = new Map(rows.map((row) => [row.id, staffPresentationName(row)]));
  const dishes = [...new Set(lines.map((line) => nameOf.get(line.id)!))].join(", ");
  return new AppError("station.no_default", { dishes });
}
/** The columns of a stored line {@link fireLines} reads. */
export const fireableLineColumns = {
  id: workingOrderLines.id,
  productId: workingOrderLines.productId,
  courseId: workingOrderLines.courseId,
  parentLineId: workingOrderLines.parentLineId,
  note: workingOrderLines.note,
  quantity: workingOrderLines.quantity,
};
export type FireableLine = {
  [K in keyof typeof fireableLineColumns]: GetColumnData<(typeof fireableLineColumns)[K]>;
};

export type RoutingOnce = (() => Promise<MakerResolver>) & {
  readonly at: Date;
  readonly opened: () => Promise<MakerResolver> | undefined;
};

export function routingOnce(tx: Transaction, at: Date): RoutingOnce {
  let opened: Promise<MakerResolver> | undefined;
  return Object.assign(() => (opened ??= VENUE_SERVICE.routingAt(tx, at)), {
    at,
    opened: () => opened,
  });
}

export async function makersByLine(
  resolver: MakerResolver,
  zoneId: string | null,
  lines: readonly { id: string; productId: string | null; latePeriodId: string | null }[],
): Promise<ReadonlyMap<string, MakerOutcome>> {
  const byPeriod = new Map<string | null, { id: string; productId: string }[]>();
  for (const { id, productId, latePeriodId } of lines) {
    if (productId === null) continue;
    const group = byPeriod.get(latePeriodId) ?? [];
    group.push({ id, productId });
    byPeriod.set(latePeriodId, group);
  }
  const outcomes = new Map<string, MakerOutcome>();
  for (const [periodId, group] of byPeriod) {
    const productIds = [...new Set(group.map(({ productId }) => productId))];
    const routes = await resolver.makers(zoneId, productIds, periodId);
    for (const { id, productId } of group) {
      const route = routes.get(productId);
      if (route !== undefined) outcomes.set(id, route);
    }
  }
  return outcomes;
}
interface DishKitchenPlace {
  dishLineId: string;
  stationId: string | null;
  courseId: string | null;
  /** Whether the dish's extras leave hold: the dish is initiated, or it is made here, even in a
   *  held group. */
  initiated: boolean;
}
/** What an edit's re-send keeps of each deleted record's phase (D22): a released record stays
 *  released, and a Requested one keeps its first request time while it comes back Requested. */
interface KeptPhase {
  keepReleased?: ReadonlySet<string>;
  keepRequestedAt?: ReadonlyMap<string, string>;
}
function keptStamps(
  keep: KeptPhase,
  lineId: string,
  input: Parameters<typeof requestStamps>[0],
): ReturnType<typeof requestStamps> {
  const stamps = requestStamps(
    keep.keepReleased?.has(lineId) === true ? { ...input, waits: false } : input,
  );
  const first = keep.keepRequestedAt?.get(lineId);
  return first !== undefined && stamps.firedAt === null && stamps.requestedAt !== null
    ? { ...stamps, requestedAt: first }
    : stamps;
}
/** Insert records only for extra lines whose own station differs from their dish's destination. */
export async function insertSplitExtras(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  zoneId: string | null,
  dishes: readonly DishKitchenPlace[],
  routing: RoutingOnce,
  keepAllergies?: ReadonlyMap<string, TicketAllergyCopy>,
  keepPhase: KeptPhase = {},
): Promise<
  {
    workingOrderLineId: string;
    stationId: string;
    requestedAt: string | null;
    firedAt: string | null;
    quantity: number;
  }[]
> {
  if (dishes.length === 0) return [];
  const byDish = new Map(dishes.map((dish) => [dish.dishLineId, dish]));
  const extras = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      latePeriodId: workingOrderLines.latePeriodId,
      ticketId: ticketItems.id,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      inArray(
        workingOrderLines.parentLineId,
        dishes.map((dish) => dish.dishLineId),
      ),
    );
  const cancellations = await readLineCancellations(
    tx,
    extras.map((extra) => extra.id),
  );
  const fresh = extras
    .map((extra) => ({
      ...extra,
      quantity: serviceQuantities(extra.quantity, 0, cancellations.get(extra.id) ?? 0).active,
    }))
    .filter((extra) => extra.quantity > 0 && extra.ticketId === null && extra.productId !== null);
  if (fresh.length === 0) return [];
  const decisions = await (
    await routing()
  ).extraMakers(
    zoneId,
    fresh.map((extra) => ({
      key: extra.id,
      productId: extra.productId!,
      dishStationId: byDish.get(extra.parentLineId!)!.stationId,
      periodId: extra.latePeriodId,
    })),
  );
  const madeHere = await readMadeHereStations(tx, cfg.sendingDeviceId);
  const waiting = await passWaitingStations(
    tx,
    [...decisions.values()].flatMap((decision) =>
      decision.kind === "made" ? [decision.stationId] : [],
    ),
  );
  const values = fresh.flatMap((extra) => {
    const decision = decisions.get(extra.id);
    if (decision?.kind !== "made") return [];
    const dish = byDish.get(extra.parentLineId!)!;
    const here = madeHere.has(decision.stationId);
    const stamps = keptStamps(keepPhase, extra.id, {
      at: routing.at.toISOString(),
      initiated: dish.initiated,
      madeHere: here,
      waits: waiting.has(decision.stationId),
    });
    return [
      {
        workingOrderLineId: extra.id,
        stationId: decision.stationId,
        courseId: dish.courseId,
        note: null,
        quantity: extra.quantity,
        ...stamps,
        queuedAt: routing.at.toISOString(),
        madeHere: here,
        state: here ? ("ready" as const) : ("queued" as const),
        readyAt: here ? stamps.firedAt : null,
      },
    ];
  });
  if (values.length === 0) return [];
  try {
    const inserted = [];
    for (const chunk of statementChunks(ticketItems, values))
      inserted.push(
        ...(await tx.insert(ticketItems).values(chunk).returning({
          id: ticketItems.id,
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          requestedAt: ticketItems.requestedAt,
          firedAt: ticketItems.firedAt,
          quantity: ticketItems.quantity,
          madeHere: ticketItems.madeHere,
        })),
      );
    for (const row of inserted) if (row.madeHere) cfg.madeHereSink?.add(row.workingOrderLineId);
    await attachKitchenAllergyCopies(tx, inserted, keepAllergies);
    await freezeKitchenAllergies(
      tx,
      inserted
        .filter((row) => !row.madeHere && (row.firedAt ?? row.requestedAt) !== null)
        .map((row) => row.id),
    );
    return inserted
      .filter((row) => !row.madeHere)
      .map((row) => ({
        workingOrderLineId: row.workingOrderLineId,
        stationId: row.stationId,
        requestedAt: row.requestedAt,
        firedAt: row.firedAt,
        quantity: row.quantity!,
      }));
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    throw error;
  }
}
/**
 * The order's dish lines the kitchen has not been given, in line order: never stamped sent and
 * holding no ticket item. A held dish that goes to a station holds one; a
 * no-preparation dish is stamped sent when it fires, so one still held is returned.
 */
export async function unsentDishLines(tx: Transaction, orderId: string): Promise<FireableLine[]> {
  const lines = await tx
    .select(fireableLineColumns)
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        isNull(workingOrderLines.sentAt),
        isNull(ticketItems.id),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  return lines.filter(
    (line) => line.parentLineId === null && line.quantity > (cancellations.get(line.id) ?? 0),
  );
}
/**
 * Every order routes by its routing cells, then the active default station. Station and
 * course are chosen at fire time. A made-here item is recorded and never printed. Extras are
 * decided after their dish against the same routing snapshot. An extra made elsewhere copies the
 * dish's course and hold, unless made here: then it is ready and fired at the send, even when its
 * dish is held.
 * An unroutable outcome refuses the send, unless payment uses `unroutable: "skip"` to leave
 * the dish unfired and unstamped and return it for the paid-order alert.
 */
export async function fireLines(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  // The dish decides first; an extra may get a separate record after its destination is known.
  // `quantity` is the line's stored thousandths, which the kitchen is asked to make.
  // For table work, `hold` defers cooking unless made here, and `release` overrides the course.
  // Counter work always releases. Neither flag is stored.
  lines: (FireableLine & { hold?: boolean; release?: boolean })[],
  options: {
    unroutable?: "skip";
    keepStations?: ReadonlyMap<string, string>;
    keepMadeHere?: ReadonlyMap<string, { madeHere: boolean; stationId: string }>;
    keepAllergies?: ReadonlyMap<string, TicketAllergyCopy>;
    routing?: RoutingOnce;
  } & KeptPhase = {},
): Promise<FireableLine[]> {
  const routing = options.routing ?? routingOnce(tx, new Date());
  const now = routing.at;
  const firedAt = now.toISOString();
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  const parentLines = lines
    .filter((line) => line.parentLineId === null)
    .map((line) => ({
      ...line,
      quantity: serviceQuantities(line.quantity, 0, cancellations.get(line.id) ?? 0).active,
    }))
    .filter((line) => line.quantity > 0);
  if (parentLines.length === 0) {
    return [];
  }
  const chosenRows = await tx
    .select({
      id: workingOrderLines.id,
      setMenuRole: workingOrderLines.setMenuRole,
      makeAtStationId: workingOrderLines.makeAtStationId,
      latePeriodId: workingOrderLines.latePeriodId,
      stationActive: kitchenStations.active,
    })
    .from(workingOrderLines)
    .leftJoin(kitchenStations, eq(kitchenStations.id, workingOrderLines.makeAtStationId))
    .where(
      inArray(
        workingOrderLines.id,
        parentLines.map((line) => line.id),
      ),
    );
  const menuLineIds = new Set(
    chosenRows.filter((row) => row.setMenuRole === "set_menu").map((row) => row.id),
  );
  lines =
    menuLineIds.size === 0 ? parentLines : parentLines.filter((line) => !menuLineIds.has(line.id));
  if (lines.length === 0) return [];
  const partyId = await partyOfOrder(tx, orderId);
  if (partyId !== null) await assertPartyAllergyAnswered(tx, partyId);
  const chosenStations = new Map(
    chosenRows.flatMap((row) =>
      row.makeAtStationId !== null && row.stationActive
        ? [[row.id, row.makeAtStationId] as const]
        : [],
    ),
  );
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, orderId);
  // A parked line can acquire its agreement after the caller has read the dishes to fire.
  const agreedPeriodOf = new Map(chosenRows.map((row) => [row.id, row.latePeriodId]));
  const makers = await makersByLine(
    await routing(),
    serviceContext?.zoneId ?? null,
    lines
      .filter((line) => !chosenStations.has(line.id))
      .map(({ id, productId }) => ({
        id,
        productId,
        latePeriodId: agreedPeriodOf.get(id) ?? null,
      })),
  );
  const keepStates = options.keepStations?.size ? await VENUE_SERVICE.stationStates(tx, now) : null;
  const stationFor = (line: FireableLine): string | null => {
    const chosen = chosenStations.get(line.id);
    if (chosen !== undefined) return chosen;
    const outcome = makers.get(line.id);
    if (outcome?.kind === "made" && outcome.route.kind === "no_preparation") return null;
    const kept = options.keepStations?.get(line.id);
    const state = kept === undefined ? undefined : keepStates?.get(kept);
    if (kept !== undefined && state?.active && (!state.open || outcome?.kind === "no_replacement"))
      return kept;
    return null;
  };
  let fallbackStationId: string | null = null;
  if (lines.some((line) => line.productId === null && !chosenStations.has(line.id))) {
    const [fallback] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(and(eq(kitchenStations.isDefault, true), eq(kitchenStations.active, true)));
    fallbackStationId = fallback?.id ?? null;
    if (fallbackStationId === null)
      throw await noDefaultStation(
        tx,
        lines.filter((line) => {
          if (line.productId === null) return !chosenStations.has(line.id);
          const kind = makers.get(line.id)?.kind;
          return stationFor(line) === null && kind !== "made" && kind !== "no_replacement";
        }),
      );
  }
  const unrouted: FireableLine[] = [];
  const nowhere: FireableLine[] = [];
  const noReplacement: { stationId: string; productId: string }[] = [];
  lines = lines.filter((line) => {
    const outcome = makers.get(line.id);
    const hasMaker =
      stationFor(line) !== null ||
      (line.productId === null ? fallbackStationId !== null : outcome?.kind === "made");
    if (hasMaker) return true;
    if (outcome?.kind === "no_replacement")
      noReplacement.push({ stationId: outcome.stationId, productId: line.productId! });
    if (options.unroutable !== "skip" && outcome?.kind !== "no_replacement") {
      nowhere.push(line);
      return false;
    }
    unrouted.push(line);
    return false;
  });
  if (nowhere.length > 0) throw await noDefaultStation(tx, nowhere);
  if (noReplacement.length > 0 && options.unroutable !== "skip")
    throw new AppError("station.no_replacement", {
      stationId: noReplacement[0]!.stationId,
      productIds: noReplacement.map((line) => line.productId),
    });
  if (lines.length === 0) return unrouted;

  const madeHere = await readMadeHereStations(tx, cfg.sendingDeviceId);

  const courseByLine = new Map(lines.map((line) => [line.id, line.courseId ?? null]));

  // `anyInitiated` lets a later round join a course the waiter already initiated; `itemCount` includes prior rounds
  // when choosing the earliest course.
  const courseRows = await tx
    .select({
      id: kitchenCourses.id,
      displayOrder: kitchenCourses.displayOrder,
      // Arrives as the number 1 or 0, never a boolean: test its truthiness, never with `===`.
      anyInitiated: sql<boolean>`max(${initiatedItem()} and not ${ticketItems.madeHere})`,
      itemCount: sql<number>`cast(count(${ticketItems.id}) as int)`,
    })
    .from(kitchenCourses)
    .leftJoin(
      ticketItems,
      and(
        eq(ticketItems.courseId, kitchenCourses.id),
        inArray(
          ticketItems.workingOrderLineId,
          tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, orderId)),
        ),
      ),
    )
    .groupBy(kitchenCourses.id, kitchenCourses.displayOrder);

  const initiatedCourseIds = new Set(
    courseRows.filter((row) => row.anyInitiated).map((row) => row.id),
  );

  // The order's earliest course, over prior rounds and this batch. A line with no course never
  // enters the set.
  const orderCourseIds = new Set<string>([
    ...courseRows.filter((row) => row.itemCount > 0).map((row) => row.id),
    ...[...courseByLine.values()].filter((id): id is string => id !== null),
  ]);
  const displayOrderByCourse = new Map(courseRows.map((row) => [row.id, row.displayOrder]));
  const orderDisplayOrders = courseRows
    .filter((row) => orderCourseIds.has(row.id))
    .map((row) => row.displayOrder);
  const earliestDisplayOrder =
    orderDisplayOrders.length === 0 ? null : Math.min(...orderDisplayOrders);

  const sentLineIds: string[] = [];
  const dishPlaces: DishKitchenPlace[] = [];
  // A line with nowhere to go refuses the whole fire.
  const placed = lines
    .map((line) => {
      const outcome = makers.get(line.id);
      const maker = outcome?.kind === "made" ? outcome.route : null;
      const courseId = courseByLine.get(line.id) ?? null;
      const courseFired =
        partyId === null ||
        line.release === true ||
        (line.hold !== true &&
          (courseId === null ||
            initiatedCourseIds.has(courseId) ||
            displayOrderByCourse.get(courseId) === earliestDisplayOrder));
      // A no-preparation line has no kitchen station or ticket item.
      if (maker?.kind === "no_preparation" && stationFor(line) === null) {
        if (courseFired) sentLineIds.push(line.id);
        dishPlaces.push({
          dishLineId: line.id,
          stationId: null,
          courseId,
          initiated: courseFired,
        });
        return null;
      }
      const stationId =
        stationFor(line) ?? (maker?.kind === "station" ? maker.stationId : fallbackStationId!);
      const kept = options.keepMadeHere?.get(line.id);
      const made =
        kept === undefined
          ? madeHere.has(stationId)
          : kept.madeHere && kept.stationId === stationId;
      const fired = made || courseFired;
      if (fired) sentLineIds.push(line.id);
      dishPlaces.push({
        dishLineId: line.id,
        stationId,
        courseId,
        initiated: fired,
      });
      return {
        initiated: courseFired,
        value: {
          workingOrderLineId: line.id,
          stationId,
          courseId,
          note: line.note,
          madeHere: made,
          state: made ? ("ready" as const) : ("queued" as const),
          readyAt: made ? firedAt : null,
          quantity: line.quantity,
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const waiting = await passWaitingStations(
    tx,
    placed.map((entry) => entry.value.stationId),
  );
  const values = placed.map(({ initiated, value }) => ({
    ...value,
    ...keptStamps(options, value.workingOrderLineId, {
      at: firedAt,
      initiated,
      madeHere: value.madeHere,
      waits: waiting.has(value.stationId),
    }),
    queuedAt: firedAt,
  }));
  if (values.length > 0) {
    const [alreadyFired] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(
        inArray(
          ticketItems.workingOrderLineId,
          values.map((value) => value.workingOrderLineId),
        ),
      )
      .limit(1);
    if (alreadyFired !== undefined) {
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
  }
  await stampSent(tx, orderId, sentLineIds, firedAt);
  // Printing from `.returning()`, not a re-query: a re-query would sweep up earlier rounds'
  // already-fired items and reprint them.
  const inserted = [];
  for (const chunk of statementChunks(ticketItems, values))
    inserted.push(
      ...(await tx.insert(ticketItems).values(chunk).returning({
        id: ticketItems.id,
        workingOrderLineId: ticketItems.workingOrderLineId,
        stationId: ticketItems.stationId,
        requestedAt: ticketItems.requestedAt,
        firedAt: ticketItems.firedAt,
        madeHere: ticketItems.madeHere,
      })),
    );

  for (const row of inserted) {
    if (row.madeHere) cfg.madeHereSink?.add(row.workingOrderLineId);
  }
  await attachKitchenAllergyCopies(tx, inserted, options.keepAllergies);

  const firingDishes = dishPlaces.filter((dish) => dish.initiated);
  const heldExtras =
    firingDishes.length === 0
      ? { released: [], requested: [] }
      : await requestHeldItems(
          tx,
          orderId,
          inArray(
            ticketItems.workingOrderLineId,
            tx
              .select({ id: workingOrderLines.id })
              .from(workingOrderLines)
              .where(
                inArray(
                  workingOrderLines.parentLineId,
                  firingDishes.map((dish) => dish.dishLineId),
                ),
              ),
          ),
          firedAt,
        );
  const placeOf = (row: { workingOrderLineId: string; stationId: string }) => ({
    workingOrderLineId: row.workingOrderLineId,
    stationId: row.stationId,
  });
  const extraInserted = await insertSplitExtras(
    tx,
    cfg,
    orderId,
    serviceContext?.zoneId ?? null,
    dishPlaces,
    routing,
    options.keepAllergies,
    options,
  );

  // Only newly fired items not made here print. Outbox inserts on this transaction: no hardware I/O
  // blocks the fire.
  const firedItems = inserted
    .filter((row) => row.firedAt !== null && !row.madeHere)
    .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId }))
    .concat(
      heldExtras.released.map(placeOf),
      extraInserted
        .filter((row) => row.firedAt !== null)
        .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId })),
    );
  const requestedItems = inserted
    .filter((row) => row.firedAt === null && row.requestedAt !== null)
    .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId }))
    .concat(heldExtras.requested.map(placeOf));
  await freezeKitchenAllergyItems(tx, orderId, [...firedItems, ...requestedItems]);
  await enqueueKitchenTickets(tx, cfg, orderId, firedItems);
  return unrouted;
}
/**
 * Stamp `sent_at` on dish lines not stamped yet, and on their extras children, which follow their
 * dish. A line already stamped keeps its first stamp.
 *
 * An abandoned order's lines are left alone: `working_order_lines_require_open_parent_update`
 * refuses a stamp there.
 */
export async function stampSent(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
  at: string,
): Promise<void> {
  if (lineIds.length === 0) return;
  const stamped = await tx
    .update(workingOrderLines)
    .set({ sentAt: at })
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        or(
          inArray(workingOrderLines.id, [...lineIds]),
          inArray(workingOrderLines.parentLineId, [...lineIds]),
        ),
        isNull(workingOrderLines.sentAt),
        exists(
          tx
            .select({ one: sql`1` })
            .from(workingOrders)
            .where(and(eq(workingOrders.id, orderId), ne(workingOrders.status, "abandoned"))),
        ),
      ),
    )
    .returning({ id: workingOrderLines.id });
  await captureSentLineNutrition(
    tx,
    stamped.map((row) => row.id),
  );
}
/**
 * The dish lines of an order that have no ticket item and are not yet stamped sent, whose route is
 * `no_preparation`, and that sit in one of `courseIds` (`null` standing for no course) or are named
 * in `lineIds` — or every such line, with `"all"`: the no-preparation lines a send releases.
 */
export async function heldNoRouteLines(
  tx: Transaction,
  orderId: string,
  scope: { courseIds: readonly (string | null)[]; lineIds: readonly string[] } | "all",
  routing: RoutingOnce,
): Promise<{ zoneId: string | null; lines: { id: string; courseId: string | null }[] }> {
  const empty = { zoneId: null, lines: [] };
  let inScope: SQL | undefined;
  if (scope !== "all") {
    const namedCourses = scope.courseIds.filter((id): id is string => id !== null);
    const any = [
      ...(namedCourses.length > 0 ? [inArray(workingOrderLines.courseId, namedCourses)] : []),
      ...(scope.courseIds.includes(null) ? [isNull(workingOrderLines.courseId)] : []),
      ...(scope.lineIds.length > 0 ? [inArray(workingOrderLines.id, [...scope.lineIds])] : []),
    ];
    if (any.length === 0) return empty;
    inScope = or(...any);
  }
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, orderId);
  const candidates = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      quantity: workingOrderLines.quantity,
      latePeriodId: workingOrderLines.latePeriodId,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        isNotNull(workingOrderLines.productId),
        isNull(workingOrderLines.sentAt),
        isNull(ticketItems.id),
        inScope,
      ),
    );
  const zoneId = serviceContext?.zoneId ?? null;
  if (candidates.length === 0) return { zoneId, lines: [] };
  const cancellations = await readLineCancellations(
    tx,
    candidates.map((line) => line.id),
  );
  const routes = await makersByLine(await routing(), zoneId, candidates);
  return {
    zoneId,
    lines: candidates
      .filter((line) => {
        if (line.quantity <= (cancellations.get(line.id) ?? 0)) return false;
        const outcome = routes.get(line.id);
        return outcome?.kind === "made" && outcome.route.kind === "no_preparation";
      })
      .map((line) => ({ id: line.id, courseId: line.courseId })),
  };
}

export async function assertSendable(tx: Transaction, lineIds: readonly string[]): Promise<void> {
  if (lineIds.length === 0) return;
  const [refused] = await tx
    .select({ productId: workingOrderLines.productId })
    .from(workingOrderLines)
    .innerJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(
      and(
        or(
          inArray(workingOrderLines.id, [...lineIds]),
          inArray(workingOrderLines.parentLineId, [...lineIds]),
        ),
        sql`not ${productActive}`,
      ),
    )
    .orderBy(workingOrderLines.lineNo)
    .limit(1);
  if (refused !== undefined) {
    throw new AppError("product.unavailable", { productId: refused.productId! });
  }
}
