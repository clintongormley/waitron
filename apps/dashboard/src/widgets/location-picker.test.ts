import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { LocationSummary } from "../api/client.js";
import { LocationPicker, resolveLocationSelection } from "./location-picker.js";

afterEach(cleanupWidgets);

const two: LocationSummary[] = [
  { id: "loc-1", name: "Main" },
  { id: "loc-2", name: "Annex" },
];

/** The select inside the widget's shadow root, or null when the widget renders nothing (<=1 location). */
function select(el: LocationPicker): HTMLSelectElement | null {
  return el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]");
}

describe("resolveLocationSelection", () => {
  it("returns '' when there are no locations", () => {
    expect(resolveLocationSelection([], "loc-1")).toBe("");
  });

  it("keeps the current id when it still exists", () => {
    expect(resolveLocationSelection(two, "loc-2")).toBe("loc-2");
  });

  it("falls back to the first location when the current id is absent", () => {
    expect(resolveLocationSelection(two, "gone")).toBe("loc-1");
    // The empty current (first load, before any pick) also lands on the first location.
    expect(resolveLocationSelection(two, "")).toBe("loc-1");
  });
});

describe("dashboard-location-picker", () => {
  it("renders nothing for an empty location list", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: [],
      selected: "",
      label: "Location",
    });
    expect(select(el)).toBeNull();
  });

  it("renders nothing for a single location (nothing to pick)", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: [two[0]!],
      selected: "loc-1",
      label: "Location",
    });
    expect(select(el)).toBeNull();
  });

  it("renders one option per location and marks the selected one for more than one location", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: two,
      selected: "loc-2",
      label: "Location",
    });
    const node = select(el)!;
    expect(node).not.toBeNull();
    const options = node.querySelectorAll("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.value).toBe("loc-1");
    expect(options[1]!.value).toBe("loc-2");
    // The current selection drives the native select's value via per-option `.selected`.
    expect(node.value).toBe("loc-2");
  });

  it("renders the label passed by the parent (i18n stays at the screen edge)", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: two,
      selected: "loc-1",
      label: "Ubicación",
    });
    expect(el.shadowRoot!.querySelector("label")!.textContent).toContain("Ubicación");
  });

  it("emits a composed, bubbling location-changed carrying the picked id on change", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: two,
      selected: "loc-1",
      label: "Location",
    });
    // Listen on the HOST (not the inner select): the event must be composed+bubbling to reach the
    // parent screen across this widget's shadow boundary.
    const changed = new Promise<CustomEvent<{ locationId: string }>>((resolve) =>
      el.addEventListener("location-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );

    const node = select(el)!;
    node.value = "loc-2";
    node.dispatchEvent(new Event("change"));

    const event = await changed;
    expect(event.detail.locationId).toBe("loc-2");
    expect(event.composed).toBe(true);
    expect(event.bubbles).toBe(true);
  });
});
