import {
  followFallbacks,
  selectionRulesFromModel,
  selectRoutingCell,
  type MakerChoice,
  type RouteTarget,
  type RoutingModel,
  type RoutingRules,
} from "@waitron/venue-service/routing";
import type { CategorySummary } from "../api/client.js";

export type FolderMaker =
  | { kind: "station"; stationName: string }
  | { kind: "no_preparation" }
  | { kind: "no_replacement"; stationName: string | null }
  | { kind: "nowhere" };

export interface FolderMadeAt {
  maker: FolderMaker;
}

/** Whether a category's Every zone route reaches a switched-on station or No preparation, whatever
 * decided it. The category tree's asterisk marks a category where this is false. */
export function isRouted({ maker }: FolderMadeAt): boolean {
  return maker.kind === "station" || maker.kind === "no_preparation";
}

/** A category row's Every zone route, its station's fallbacks followed the way `chooseMaker`
 * follows a product's. */
function categoryChoice(rules: RoutingRules, categoryId: string): MakerChoice {
  const { target, decidedBy } = selectRoutingCell(rules, { kind: "category", categoryId }, null);
  if (target?.kind !== "station" || decidedBy?.kind !== "cell")
    return { route: target, decidedBy, fallbacks: [], noReplacement: false };
  return { ...targetChoice(rules, target), decidedBy };
}

/** Where a cell's target sends work, its station's fallbacks followed. */
function targetChoice(rules: RoutingRules, target: RouteTarget): MakerChoice {
  if (target.kind !== "station")
    return { route: target, decidedBy: null, fallbacks: [], noReplacement: false };
  const { stationId, steps } = followFallbacks(rules, target.stationId, null);
  return {
    route: stationId === null ? null : { kind: "station", stationId },
    decidedBy: null,
    fallbacks: steps,
    noReplacement: stationId === null,
  };
}

/** Today's closure does not change the untimed category baseline. */
export function folderMadeAt(
  routing: RoutingModel,
  categories: readonly CategorySummary[],
): Map<string, FolderMadeAt> {
  const stationNames = new Map(routing.stations.map(({ id, name }) => [id, name]));
  // The tree is the catalogue's live category list, which the routing read can lag behind.
  const rules: RoutingRules = {
    ...selectionRulesFromModel(routing),
    parentOf: new Map(categories.map(({ id, parentId }) => [id, parentId])),
    timing: new Map(),
  };

  const result = new Map<string, FolderMadeAt>();
  for (const { id } of categories) {
    const choice = categoryChoice(rules, id);
    const { route } = choice;
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
    result.set(id, { maker });
  }
  return result;
}
