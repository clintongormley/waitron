export const KITCHEN_SCREEN_KINDS = ["station", "pass", "pass_monitor"] as const;
type KitchenScreenKind = (typeof KITCHEN_SCREEN_KINDS)[number];

export type StoredKitchenView = {
  readonly stationIds: readonly string[] | null;
  readonly zoneIds: readonly string[] | null;
  readonly showNonPassStations?: boolean | null;
};

export type StoredKitchenViews = Partial<Record<KitchenScreenKind, StoredKitchenView>>;
