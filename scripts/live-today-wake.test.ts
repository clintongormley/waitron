import { expect, it } from "vitest";
import { QUERY_DEPENDENCIES as dashboard } from "../apps/dashboard/src/api/live-queries.js";
import { QUERY_DEPENDENCIES as service } from "../packages/venue-service/src/dashboard/live-queries.js";
import { QUERY_DEPENDENCIES as bookings } from "../packages/bookings/src/dashboard/live-queries.js";
import { TILL_LIVE_TYPES as till } from "../apps/till/src/api/live-connection.js";

const alreadyWoken = [
  "dashboard:getZoneDeleteImpact",
  "dashboard:getDepartmentDeleteImpact",
  "dashboard:getSalesOverview",
  "dashboard:getOverdueOrders",
  "dashboard:getStationDeleteImpact",
  "venue-service:zone-delete-impact",
  "venue-service:department-delete-impact",
  "venue-service:station-delete-impact",
  "bookings:tables",
  "till:station",
  "till:pass",
  "till:floor",
];
// These readers also need saved table or zone state, so today's parent updates now wake them.
const newlyWoken = [
  "dashboard:listOrderPages", // Order rows show saved table and zone names.
  "dashboard:getOrder", // Order detail resolves table names.
  "dashboard:listMadeAt", // Product makers follow zone routes.
  "dashboard:getFolderRouting", // Folder routes include zones.
  "dashboard:getProfileScopeChoices", // Profiles offer department zones.
  "dashboard:listProfileKitchenScreens", // Kitchen screen scopes name zones.
  "dashboard:listDevices", // Device access follows its zone scope.
  "dashboard:listZones", // The room list reads zone settings.
  "dashboard:getFloorPlan", // Saved plans name their live tables.
  "venue-service:floor-plan-sets", // Sets list their zone layouts.
  "venue-service:period-floor-plans", // Period choices include zone layouts.
  "venue-service:pass-coverage", // Pass coverage follows zones.
  "venue-service:routing", // Routing shows zones and station assignments.
  "venue-service:opening-hours-month", // The month includes zone opening times.
  "venue-service:opening-hours", // The editor includes zone settings.
  "venue-service:operations", // Operations shows each department and zone.
  "till:billDraft", // Bills resolve table names and room state.
  "till:menu", // Available offers depend on the zone.
  "till:transfers", // Transfers show destination table names.
  "till:allergy", // Allergy context includes party tables.
];
it("inventories every reader woken by a today's table or zone update", () => {
  const actual = Object.entries({ dashboard, "venue-service": service, bookings, till }).flatMap(
    ([group, queries]) =>
      Object.entries(queries)
        .filter(([, types]) =>
          types.some((type) => type === "dining_tables" || type === "floor_zones"),
        )
        .map(([name]) => `${group}:${name}`),
  );
  expect(actual.sort()).toEqual([...alreadyWoken, ...newlyWoken].sort());
});
