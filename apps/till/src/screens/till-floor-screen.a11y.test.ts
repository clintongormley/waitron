import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";

const zones: FloorZone[] = [
  { id: "z1", name: "Comedor", displayOrder: 0, active: true },
  { id: "z2", name: "Terraza", displayOrder: 1, active: true },
];

// A spread of occupancy states + badges + a zoneless table, so axe sees every card variant, both
// badges and the manual-status swatch in the one mount.
const tables: TableState[] = [
  {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    hasOpenTab: true,
    tabId: "wo-1",
    tabLineCount: 3,
    tabTotal: "47.50",
    pendingDeliveries: 0,
    pendingToServe: 2,
    status: { id: "s1", label: "Reservada", color: "#8b5cf6" },
  },
  {
    id: "t2",
    label: "2",
    zoneId: "z1",
    capacity: 2,
    state: "delivery-pending",
    hasOpenTab: false,
    pendingDeliveries: 1,
    pendingToServe: 0,
    status: null,
  },
  {
    id: "t3",
    label: "3",
    zoneId: "z1",
    capacity: 6,
    state: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    status: null,
  },
  {
    id: "t9",
    label: "9",
    zoneId: null,
    capacity: null,
    state: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    status: null,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-floor-screen a11y (%s theme)", (theme) => {
  it("has no violations rendering occupancy cards grouped by zone", async () => {
    const { host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
