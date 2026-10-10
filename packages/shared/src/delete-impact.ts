/**
 * What deleting one record would do, read before the delete and recomputed inside it: what refuses
 * it, what live work it ends and which settings links it removes. Each item names its targets.
 */
export type DeleteTarget = { id: string; name: string };
export type DeleteImpactItem = { key: string; count: number; targets: DeleteTarget[] };
export type DeleteImpactRefusal = {
  code: string;
  params: Record<string, string | number>;
  targets: DeleteTarget[];
};
export type DeleteImpact = {
  target: DeleteTarget;
  refusals: DeleteImpactRefusal[];
  ends: DeleteImpactItem[];
  removes: DeleteImpactItem[];
};
