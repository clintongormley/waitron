import type {
  LastOrderRun,
  LastOrderService,
  MakerOutcome,
  MakerResolver,
  PreparationRoute,
} from "@waitron/module";

export interface LastOrdersDecision {
  run: LastOrderRun;
  route: PreparationRoute;
  stopped: boolean;
}

function cutoff(run: LastOrderRun, maker: PreparationRoute): number {
  return (
    run.end +
    (run.offsets.find((offset) =>
      offset.kind === "no_preparation"
        ? maker.kind === "no_preparation"
        : maker.kind === "station" && maker.stationId === offset.stationId,
    )?.minutes ?? 0)
  );
}

export async function lastOrderDishes<Key>(
  service: LastOrderService | undefined,
  zoneId: string,
  dishes: readonly { key: Key; menuId: string; productId: string; stationId?: string | null }[],
  routing: () => Promise<Pick<MakerResolver, "makers" | "productsSoldIn">>,
): Promise<ReadonlyMap<Key, LastOrdersDecision>> {
  const decisions = new Map<Key, LastOrdersDecision>();
  if (service === undefined) return decisions;
  const { minute, runs } = service;
  const active = runs.find(({ start, end }) => start <= minute && minute < end);
  const candidates = [...runs]
    .reverse()
    .filter(
      (run) =>
        run.start <= minute &&
        run.offsets.some(({ minutes }) => run.end + minutes <= minute || run.end <= minute),
    );
  const relevant = dishes.filter(
    ({ menuId }) =>
      !(active?.menuIds.includes(menuId) === true && !candidates.includes(active)) &&
      candidates.some((run) => run.menuIds.includes(menuId)),
  );
  if (relevant.length === 0) return decisions;

  const resolver = await routing();
  const productIds = [...new Set(relevant.map(({ productId }) => productId))];
  const routes = new Map<string | false | null, Awaited<ReturnType<MakerResolver["makers"]>>>();
  const routeFor = async (periodId: string | false | null) => {
    if (!routes.has(periodId))
      routes.set(periodId, await resolver.makers(zoneId, productIds, periodId));
    return routes.get(periodId)!;
  };
  const sold = new Map<string, ReadonlySet<string>>();
  const soldIn = async (run: LastOrderRun) => {
    if (!sold.has(run.periodId)) sold.set(run.periodId, await resolver.productsSoldIn(run.menuIds));
    return sold.get(run.periodId)!;
  };
  for (const run of candidates) {
    const own = await routeFor(run.periodId);
    const next = minute < run.end ? runs.find(({ start }) => start === run.end) : undefined;
    const alternative = await routeFor(minute >= run.end ? null : (next?.periodId ?? false));
    const soldNext = next === undefined ? undefined : await soldIn(next);
    const soldEarlier =
      minute >= run.end &&
      relevant.some(
        ({ menuId, stationId }) => stationId === undefined && !run.menuIds.includes(menuId),
      )
        ? await soldIn(run)
        : undefined;
    for (const { key, menuId, productId, stationId } of relevant) {
      if (
        !run.menuIds.includes(menuId) &&
        (stationId !== undefined || soldEarlier?.has(productId) !== true)
      )
        continue;
      const known = decisions.get(key);
      if (known !== undefined && !known.stopped) continue;
      const original: MakerOutcome | undefined =
        stationId === undefined
          ? own.get(productId)
          : {
              kind: "made",
              route:
                stationId === null ? { kind: "no_preparation" } : { kind: "station", stationId },
            };
      const successor = stationId === undefined ? alternative.get(productId) : original;
      if (original?.kind !== "made") continue;
      const ownCutoff = cutoff(run, original.route);
      const otherCutoff = successor?.kind === "made" ? cutoff(run, successor.route) : -Infinity;
      if (minute < run.end && minute < ownCutoff) {
        decisions.set(key, { run, route: original.route, stopped: false });
      } else if (
        successor?.kind === "made" &&
        (minute < otherCutoff || (stationId === undefined && soldNext?.has(productId) === true))
      ) {
        decisions.set(key, { run, route: successor.route, stopped: false });
      } else {
        const route =
          successor?.kind === "made" && otherCutoff > ownCutoff ? successor.route : original.route;
        if (known === undefined || cutoff(run, route) > cutoff(known.run, known.route))
          decisions.set(key, { run, route, stopped: true });
      }
    }
  }
  return decisions;
}
