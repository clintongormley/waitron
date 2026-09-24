import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./location-picker.js";
import type { LocationPicker } from "./location-picker.js";
import type { LocationSummary } from "../api/client.js";

/**
 * Only the SHOWN surface (more than one location) has anything to scan — the widget renders NOTHING
 * for a single location.
 */
const locations: LocationSummary[] = [
  { id: "loc-1", name: "Main" },
  { id: "loc-2", name: "Annex" },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dashboard-location-picker a11y (%s theme)", (theme) => {
  it("has no violations with the select shown (more than one location)", async () => {
    const { host } = await mountWidget<LocationPicker>(
      "dashboard-location-picker",
      { locations, selected: "loc-1", label: "Location" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
