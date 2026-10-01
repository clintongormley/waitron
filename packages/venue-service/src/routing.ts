import type { PreparationRoute } from "@waitron/module";

/** What a claim or an exception sends work to. */
export type RouteTarget = PreparationRoute; // { kind: "station"; stationId } | { kind: "no_preparation" }

export interface StationClaim {
  readonly categoryId: string;
  readonly target: RouteTarget;
}

export interface RouteException {
  readonly id: string;
  readonly position: number;
  readonly zoneId: string | null; // null: any service zone
  readonly categoryId: string | null; // a folder, including its subfolders
  readonly productId: string | null; // a top-level product, including its variants
  readonly target: RouteTarget;
}

export interface RoutingRules {
  readonly exceptions: readonly RouteException[]; // any order; sorted by (position, id) inside
  readonly claims: ReadonlyMap<string, RouteTarget>; // categoryId → target
  readonly parentOf: ReadonlyMap<string, string | null>; // categoryId → parent categoryId
  readonly activeStationIds: ReadonlySet<string>;
  readonly defaultStationId: string | null; // the active default, or null
}

export interface ProductFacts {
  readonly productId: string;
  readonly routedProductId: string; // the parent's id for a variant, else productId
  readonly categoryId: string | null; // the EFFECTIVE category (a variant's own, else its parent's)
}

export type RoutingDecision =
  | { readonly kind: "exception"; readonly exceptionId: string }
  | { readonly kind: "claim"; readonly categoryId: string }
  | { readonly kind: "default" };

export interface SkippedRule {
  readonly decision: RoutingDecision;
  readonly stationId: string; // the switched-off station it named
}

export interface MakerChoice {
  readonly route: RouteTarget | null; // null: nothing can take it (no active default)
  readonly decidedBy: RoutingDecision | null;
  readonly skipped: readonly SkippedRule[];
}

export function folderAncestors(
  parentOf: ReadonlyMap<string, string | null>,
  categoryId: string | null,
): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let current = categoryId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    ancestors.push(current);
    current = parentOf.get(current) ?? null;
  }
  return ancestors;
}

function orderedExceptions(rules: RoutingRules): RouteException[] {
  return [...rules.exceptions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function targetIsActive(rules: RoutingRules, target: RouteTarget): boolean {
  return target.kind === "no_preparation" || rules.activeStationIds.has(target.stationId);
}

export function chooseMaker(
  rules: RoutingRules,
  product: ProductFacts,
  zoneId: string | null,
): MakerChoice {
  const ancestors = folderAncestors(rules.parentOf, product.categoryId);
  const skipped: SkippedRule[] = [];
  const accept = (target: RouteTarget, decision: RoutingDecision): MakerChoice | null => {
    if (target.kind === "station" && !rules.activeStationIds.has(target.stationId)) {
      skipped.push({ decision, stationId: target.stationId });
      return null;
    }
    return { route: target, decidedBy: decision, skipped };
  };

  for (const exception of orderedExceptions(rules)) {
    if (
      (exception.zoneId !== null && exception.zoneId !== zoneId) ||
      (exception.productId !== null && exception.productId !== product.routedProductId) ||
      (exception.categoryId !== null && !ancestors.includes(exception.categoryId))
    ) {
      continue;
    }
    const choice = accept(exception.target, { kind: "exception", exceptionId: exception.id });
    if (choice !== null) return choice;
  }
  for (const categoryId of ancestors) {
    const target = rules.claims.get(categoryId);
    if (target === undefined) continue;
    const choice = accept(target, { kind: "claim", categoryId });
    if (choice !== null) return choice;
  }
  if (rules.defaultStationId !== null && rules.activeStationIds.has(rules.defaultStationId)) {
    return {
      route: { kind: "station", stationId: rules.defaultStationId },
      decidedBy: { kind: "default" },
      skipped,
    };
  }
  return { route: null, decidedBy: null, skipped };
}

export function unreachableExceptions(rules: RoutingRules): Set<string> {
  const exceptions = orderedExceptions(rules);
  const unreachable = new Set<string>();
  for (const [i, candidate] of exceptions.entries()) {
    const covered = exceptions.slice(0, i).some((earlier) => {
      if (!targetIsActive(rules, earlier.target)) return false;
      if (earlier.zoneId !== null && earlier.zoneId !== candidate.zoneId) return false;
      if (earlier.categoryId === null && earlier.productId === null) return true;
      if (earlier.productId !== null) return earlier.productId === candidate.productId;
      return (
        candidate.categoryId !== null &&
        folderAncestors(rules.parentOf, candidate.categoryId).includes(earlier.categoryId!)
      );
    });
    if (covered) unreachable.add(candidate.id);
  }
  return unreachable;
}
