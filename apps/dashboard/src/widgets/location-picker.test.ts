import { afterEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { LocationSummary } from "../api/client.js";
import { LocationPicker, resolveLocationSelection } from "./location-picker.js";

afterEach(cleanupWidgets);

const two: LocationSummary[] = [
  { id: "loc-1", name: "Main" },
  { id: "loc-2", name: "Annex" },
];

type LocationBox = HTMLElement & {
  value: string;
  label: string;
  search: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

const locationBox = (el: LocationPicker): LocationBox | null =>
  el.shadowRoot!.querySelector<LocationBox>('wt-combobox[name="location"]');

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownLocation(el: LocationPicker): Promise<string | undefined> {
  const box = locationBox(el)!;
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

function select(el: LocationPicker): LocationBox | null {
  return el.shadowRoot!.querySelector<LocationBox>("[data-test=location-select]");
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
  it("picks the location from the shared dropdown, labelled by the parent", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: two,
      selected: "loc-2",
      label: "Ubicación",
    });
    const box = locationBox(el)!;
    expect(box).not.toBeNull();
    expect(box.label).toBe("Ubicación");
    expect(box.search).toBe("auto");
    expect(box.options).toEqual([
      { value: "loc-1", label: "Main" },
      { value: "loc-2", label: "Annex" },
    ]);
    expect(box.value).toBe("loc-2");
    expect(await shownLocation(el)).toBe("Annex");
    const changed = new Promise<CustomEvent<{ locationId: string }>>((resolve) =>
      el.addEventListener("location-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await chooseOption(box, "loc-1");
    expect((await changed).detail.locationId).toBe("loc-1");
  });

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
    const options = node.options;
    expect(options).toHaveLength(2);
    expect(options[0]!.value).toBe("loc-1");
    expect(options[1]!.value).toBe("loc-2");
    expect(node.value).toBe("loc-2");
    expect(await shownLocation(el)).toBe("Annex");
  });

  it("renders the label passed by the parent (i18n stays at the screen edge)", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: two,
      selected: "loc-1",
      label: "Ubicación",
    });
    const box = select(el)!;
    await box.updateComplete;
    expect(box.shadowRoot!.querySelector("label")!.textContent).toContain("Ubicación");
  });

  it("emits a composed, bubbling location-changed carrying the picked id on change", async () => {
    const { el } = await mountWidget<LocationPicker>("dashboard-location-picker", {
      locations: two,
      selected: "loc-1",
      label: "Location",
    });
    // Listen on the HOST (not the inner dropdown): the event must be composed+bubbling to reach the
    // parent screen across this widget's shadow boundary.
    const changed = new Promise<CustomEvent<{ locationId: string }>>((resolve) =>
      el.addEventListener("location-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );

    await chooseOption(select(el)!, "loc-2");

    const event = await changed;
    expect(event.detail.locationId).toBe("loc-2");
    expect(event.composed).toBe(true);
    expect(event.bubbles).toBe(true);
  });
});
