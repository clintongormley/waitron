import {
  cellKey,
  chooseMaker,
  folderAncestors,
  followFallbacks,
  selectionRulesFromModel,
  selectRoutingCell,
  targetKey,
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
  { kind: "own" } | { kind: "inherited"; name: string | null } | { kind: "default" };

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

/** A category row's route in one zone (`null`: Every zone), its station's fallbacks followed the
 * way `chooseMaker` follows a product's. */
function categoryChoice(
  rules: RoutingRules,
  categoryId: string,
  zoneId: string | null,
): MakerChoice {
  const { target, decidedBy } = selectRoutingCell(rules, { kind: "category", categoryId }, zoneId);
  if (target?.kind !== "station" || decidedBy?.kind !== "cell")
    return { route: target, decidedBy, fallbacks: [], noReplacement: false };
  const { stationId, steps } = followFallbacks(rules, target.stationId, null);
  return {
    route: stationId === null ? null : { kind: "station", stationId },
    decidedBy,
    fallbacks: steps,
    noReplacement: stationId === null,
  };
}

/** Each category's baseline route, worked out with the shared routing rules the way the server
 * works out a product row's (`describeMakers`): Every zone, and the time of day not applied, though
 * a switched-off station's fallback is followed. The baseline varies when an active zone's outcome,
 * or an active product's inside, differs from it, and when its deciding cell has period lines. */
export function folderMadeAt(
  routing: RoutingModel,
  categories: readonly CategorySummary[],
  products: readonly Product[],
): Map<string, FolderMadeAt> {
  const stationNames = new Map(routing.stations.map(({ id, name }) => [id, name]));
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  // The tree is the catalogue's live category list, which the routing read can lag behind.
  const rules: RoutingRules = {
    ...selectionRulesFromModel(routing),
    parentOf: new Map(categories.map(({ id, parentId }) => [id, parentId])),
    timing: new Map(
      routing.stationTimes.map(({ stationId, fallbackStationId, hours, weekSet, today }) => [
        stationId,
        { fallbackId: fallbackStationId, hours, weekSet, today },
      ]),
    ),
  };
  // A zone no cell names routes everything as Every zone does.
  const zoned = new Set(routing.cells.map(({ zoneId }) => zoneId));
  const zones = [null, ...routing.zones.map(({ id }) => id).filter((id) => zoned.has(id))];

  const baselines = new Map(categories.map(({ id }) => [id, categoryChoice(rules, id, null)]));
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
    for (const zone of zones) compare(id, outcomeOf(categoryChoice(rules, id, zone)));
  const restrictedByDate = new Set(
    routing.stationTimes
      .filter(({ specialDateRestricts }) => specialDateRestricts === true)
      .map(({ stationId }) => stationId),
  );
  const timed = (stationId: string) => {
    if (stationId === routing.defaultStationId) return false;
    const timing = rules.timing.get(stationId);
    return (
      timing !== undefined &&
      ((timing.weekSet ?? timing.hours.length > 0) ||
        timing.today === "closed" ||
        restrictedByDate.has(stationId))
    );
  };

  const linesAt = new Set(
    routing.cells
      .filter(({ target, periods }) =>
        (periods ?? []).some((line) => targetKey(line.target) !== targetKey(target)),
      )
      .map(cellKey),
  );

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
    const row = decidedBy?.kind === "cell" ? decidedBy.address.row : null;
    const source: FolderMakerSource | null =
      decidedBy === null
        ? null
        : decidedBy.kind === "default"
          ? { kind: "default" }
          : row?.kind === "category" && row.categoryId === id
            ? { kind: "own" }
            : {
                kind: "inherited",
                name: row?.kind === "category" ? (categoryNames.get(row.categoryId) ?? null) : null,
              };
    result.set(id, {
      maker,
      source,
      someElsewhere:
        elsewhere.has(id) ||
        (route?.kind === "station" && timed(route.stationId)) ||
        (decidedBy?.kind === "cell" && linesAt.has(cellKey(decidedBy.address))),
    });
  }
  return result;
}
