import {
  chooseMaker,
  folderAncestors,
  type MakerChoice,
  type RoutingModel,
  type RoutingRules,
} from "@waitron/venue-service/routing";
import type { CategorySummary, Product } from "../api/client.js";

export type FolderMaker =
  | { kind: "station"; stationName: string }
  | { kind: "no_preparation" }
  | { kind: "no_replacement"; stationName: string | null }
  | { kind: "nowhere" };

export type FolderMakerSource =
  | { kind: "own" }
  | { kind: "inherited"; name: string | null }
  | { kind: "default" }
  | { kind: "exception" };

export interface FolderMadeAt {
  maker: FolderMaker;
  source: FolderMakerSource | null;
  /** The baseline is not a promise for everything inside. */
  someElsewhere: boolean;
}

/** Whether the maker Made at shows is a switched-on station or No preparation, whatever decided it.
 * The category tree's asterisk marks a category where this is false. */
export function isRouted({ maker }: FolderMadeAt): boolean {
  return maker.kind === "station" || maker.kind === "no_preparation";
}

/** One comparable string per outcome, so two choices are the same when they make the dish in the
 * same place or fail the same way. */
function outcomeOf(choice: MakerChoice): string {
  if (choice.route?.kind === "station") return `station:${choice.route.stationId}`;
  if (choice.route?.kind === "no_preparation") return "no_preparation";
  if (choice.noReplacement) return `no_replacement:${choice.fallbacks[0]!.stationId}`;
  return "nowhere";
}

/** Each category's baseline route, worked out with the shared routing rules the way the server
 * works out a product row's (`describeMakers`): no service zone, and the time of day not applied,
 * though a switched-off station's fallback is followed. Only rules that apply to every dish in every
 * zone decide the baseline. */
export function folderMadeAt(
  routing: RoutingModel,
  categories: readonly CategorySummary[],
  products: readonly Product[],
): Map<string, FolderMadeAt> {
  const stationNames = new Map(routing.stations.map(({ id, name }) => [id, name]));
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const rules: RoutingRules = {
    exceptions: routing.exceptions,
    claims: new Map(routing.claims.map(({ categoryId, target }) => [categoryId, target])),
    parentOf: new Map(categories.map(({ id, parentId }) => [id, parentId])),
    activeStationIds: new Set(routing.stations.filter(({ active }) => active).map(({ id }) => id)),
    defaultStationId: routing.defaultStationId,
    timing: new Map(
      routing.stationTimes.map(({ stationId, fallbackStationId, hours, today }) => [
        stationId,
        { fallbackId: fallbackStationId, hours, today },
      ]),
    ),
  };
  const baselineRules: RoutingRules = {
    ...rules,
    exceptions: routing.exceptions.filter(
      ({ zoneId, productId }) => zoneId === null && productId === null,
    ),
  };
  const zones = [
    null,
    ...new Set(routing.exceptions.flatMap(({ zoneId }) => (zoneId === null ? [] : [zoneId]))),
  ];
  const asFolder = (categoryId: string) => ({ productId: "", routedProductId: "", categoryId });

  const baselines = new Map(
    categories.map(({ id }) => [id, chooseMaker(baselineRules, asFolder(id), null, null)]),
  );
  const elsewhere = new Set<string>();
  /** Marks every known category at or above `categoryId` whose baseline `outcome` differs from. */
  const compare = (categoryId: string | null, outcome: string): void => {
    for (const id of folderAncestors(rules.parentOf, categoryId)) {
      const baseline = baselines.get(id);
      if (baseline !== undefined && outcomeOf(baseline) !== outcome) elsewhere.add(id);
    }
  };
  // A variant routes by its product's id and category, so its product's answer is its own.
  for (const product of products) {
    if (!product.active) continue;
    const facts = {
      productId: product.id,
      routedProductId: product.id,
      categoryId: product.primaryCategoryId,
    };
    for (const zone of zones)
      compare(facts.categoryId, outcomeOf(chooseMaker(rules, facts, zone, null)));
  }
  for (const { id } of categories)
    for (const zone of zones) compare(id, outcomeOf(chooseMaker(rules, asFolder(id), zone, null)));

  const timed = (stationId: string) => {
    if (stationId === routing.defaultStationId) return false;
    const timing = rules.timing.get(stationId);
    return timing !== undefined && (timing.hours.length > 0 || timing.today === "closed");
  };

  const result = new Map<string, FolderMadeAt>();
  for (const [id, choice] of baselines) {
    const { route, decidedBy } = choice;
    const maker: FolderMaker =
      route?.kind === "station"
        ? // A route reaches only an active station, and every active one is in routing.stations.
          { kind: "station", stationName: stationNames.get(route.stationId)! }
        : route?.kind === "no_preparation"
          ? { kind: "no_preparation" }
          : choice.noReplacement
            ? {
                kind: "no_replacement",
                stationName: stationNames.get(choice.fallbacks[0]!.stationId) ?? null,
              }
            : { kind: "nowhere" };
    const source: FolderMakerSource | null =
      decidedBy === null
        ? null
        : decidedBy.kind === "claim"
          ? decidedBy.categoryId === id
            ? { kind: "own" }
            : { kind: "inherited", name: categoryNames.get(decidedBy.categoryId) ?? null }
          : decidedBy.kind === "default"
            ? { kind: "default" }
            : { kind: "exception" };
    result.set(id, {
      maker,
      source,
      someElsewhere: elsewhere.has(id) || (route?.kind === "station" && timed(route.stationId)),
    });
  }
  return result;
}
