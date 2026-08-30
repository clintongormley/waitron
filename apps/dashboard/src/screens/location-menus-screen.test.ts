import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, LocationCatalogueSummary, LocationSummary } from "../api/client.js";
import { LocationMenusScreen } from "./location-menus-screen.js";

// One default (its checkbox is checked + disabled), one sellable non-default (can be toggled OFF), and
// one non-sellable (can be toggled ON) — the three row shapes the screen renders differently.
const catalogues: LocationCatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1, sellable: true, isDefault: true },
  { id: "cat-b", name: "Bebidas", active: true, version: 1, sellable: true, isDefault: false },
  { id: "cat-c", name: "Postres", active: true, version: 1, sellable: false, isDefault: false },
];
const locations: LocationSummary[] = [{ id: "loc-1", name: "Main" }];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listLocationCatalogues: vi.fn().mockResolvedValue(catalogues),
    addLocationCatalogue: vi.fn().mockResolvedValue(undefined),
    removeLocationCatalogue: vi.fn().mockResolvedValue(undefined),
    setLocationDefaultCatalogue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: LocationMenusScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

const sellable = (el: LocationMenusScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=location-menu-${id}-sellable]`)!;
const defaultRadio = (el: LocationMenusScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=location-menu-${id}-default]`)!;

afterEach(cleanupWidgets);

describe("location-menus-screen", () => {
  it("loads locations and the first location's catalogues on connect, a row per catalogue", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    expect(api.getLocations).toHaveBeenCalledTimes(1);
    expect(api.listLocationCatalogues).toHaveBeenCalledWith("loc-1");
    expect(el.shadowRoot!.querySelectorAll("[data-test^=location-menu-row-]")).toHaveLength(3);
  });

  it("does not render the location select for a single location", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=location-select]")).toBeNull();
  });

  it("renders the location select for more than one location and reloads on change", async () => {
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
    });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
    expect(select).not.toBeNull();
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.listLocationCatalogues).toHaveBeenLastCalledWith("loc-2");
  });

  it("the default catalogue's sellable checkbox is checked and disabled", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const box = sellable(el, "cat-a");
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    // The default is also reflected on the radio.
    expect(defaultRadio(el, "cat-a").checked).toBe(true);
  });

  it("toggling a non-selling catalogue ON adds it and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const box = sellable(el, "cat-c");
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.addLocationCatalogue).toHaveBeenCalledWith("loc-1", "cat-c");
    expect(api.listLocationCatalogues).toHaveBeenCalledTimes(2); // reloaded after the add
  });

  it("toggling a selling non-default catalogue OFF removes it and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const box = sellable(el, "cat-b");
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.removeLocationCatalogue).toHaveBeenCalledWith("loc-1", "cat-b");
    expect(api.listLocationCatalogues).toHaveBeenCalledTimes(2);
  });

  it("selecting a catalogue's default radio sets the default and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const radio = defaultRadio(el, "cat-b");
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.setLocationDefaultCatalogue).toHaveBeenCalledWith("loc-1", "cat-b");
    expect(api.listLocationCatalogues).toHaveBeenCalledTimes(2);
  });

  it("shows the no-locations prompt when the tenant has no locations", async () => {
    const api = stubApi({ getLocations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-locations]")).not.toBeNull();
    expect(api.listLocationCatalogues).not.toHaveBeenCalled();
  });

  it("shows the no-catalogues prompt when the location sells nothing yet", async () => {
    const api = stubApi({ listLocationCatalogues: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-catalogues]")).not.toBeNull();
  });

  it("shows the error banner and does not crash when a load rejects", async () => {
    const api = stubApi({
      listLocationCatalogues: vi.fn().mockRejectedValue({ code: "catalogue.not_found" }),
    });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("catalogue.not_found");
    expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
  });

  it("surfaces a mutation rejection as the error banner and releases the single-flight", async () => {
    const api = stubApi({
      addLocationCatalogue: vi.fn().mockRejectedValue({ code: "catalogue.not_found" }),
    });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const box = sellable(el, "cat-c");
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("catalogue.not_found");
    expect((el as unknown as { busy: boolean }).busy).toBe(false);
  });

  it("falls back to server.internal when a rejection carries no code", async () => {
    const api = stubApi({ listLocationCatalogues: vi.fn().mockRejectedValue(new Error("boom")) });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("surfaces a catalogue-reload rejection on a location change as the error banner", async () => {
    const listLocationCatalogues = vi
      .fn()
      .mockResolvedValueOnce(catalogues)
      .mockRejectedValueOnce({ code: "catalogue.not_found" });
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
      listLocationCatalogues,
    });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("catalogue.not_found");
  });

  it("surfaces a set-default rejection as the error banner and releases the single-flight", async () => {
    const api = stubApi({
      setLocationDefaultCatalogue: vi.fn().mockRejectedValue({ code: "catalogue.not_found" }),
    });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const radio = defaultRadio(el, "cat-b");
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("catalogue.not_found");
    expect((el as unknown as { busy: boolean }).busy).toBe(false);
  });

  it("files at most one mutation when a toggle fires twice (single-flight)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    const box = sellable(el, "cat-c");
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    box.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.addLocationCatalogue).toHaveBeenCalledTimes(1);
  });

  it("resets to the first location when the selected one vanishes from the list", async () => {
    // A reload whose location list no longer contains the current selection falls back to the first,
    // rather than querying a location that is gone.
    const getLocations = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ])
      .mockResolvedValueOnce([{ id: "loc-2", name: "Annex" }]);
    const api = stubApi({ getLocations });
    const { el } = await mountWidget<LocationMenusScreen>("dashboard-location-menus-screen", {
      api,
    });
    await flush(el);
    // Select loc-1, then force a full reload where loc-1 is gone.
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
    select.value = "loc-1";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    await (el as unknown as { load(): Promise<void> }).load();
    await flush(el);
    expect(api.listLocationCatalogues).toHaveBeenLastCalledWith("loc-2");
  });
});
