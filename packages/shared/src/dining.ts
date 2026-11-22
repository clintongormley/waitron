export const DININGS = ["eat_in", "takeaway"] as const;
export type Dining = (typeof DININGS)[number];

export const DINING_POLICIES = ["eat_in", "takeaway", "till_choice"] as const;
export type DiningPolicy = (typeof DINING_POLICIES)[number];

/** How a zone's department sells, and the way a new order there starts. */
export interface DiningStart {
  policy: DiningPolicy;
  startsAs: Dining;
}
