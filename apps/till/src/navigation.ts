import type { UrlPathConfig } from "@waitron/ui";

export const tillPath: UrlPathConfig = {
  basePath: "/tabs",
  primary: "till-tab",
  children: { "*": { "till-zone": "zone", "till-view": "view", "till-station": "station" } },
};

export type TillDestination = "schedule" | "station" | "expo" | "allergens";

export function isTillDestination(value: string | null | undefined): value is TillDestination {
  return value === "schedule" || value === "station" || value === "expo" || value === "allergens";
}
