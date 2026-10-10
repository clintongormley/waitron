import type { RoutingView } from "../src/routing-types.js";
import type { PrepStationsView } from "../src/dashboard/routing-client.js";

export type RetiredFallbackRoutingView = Omit<RoutingView, "stationTimes"> & {
  stationTimes: (RoutingView["stationTimes"][number] & {
    fallbackStationId?: string | null;
  })[];
};

export type RetiredFallbackPrepStationsView = Omit<PrepStationsView, "routing"> & {
  routing: RetiredFallbackRoutingView;
};
