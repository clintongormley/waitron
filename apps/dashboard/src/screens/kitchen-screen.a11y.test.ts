import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./kitchen-screen.js";
import type { KitchenScreen } from "./kitchen-screen.js";
import type { DashboardApi, Station } from "../api/client.js";

/**
 * The Cocina (kitchen) config screen scanned by axe in both themes, in three shapes: populated (a
 * default + a non-default station, so both the default badge and the make-default button render, plus
 * the bump-mode segmented control), empty (just the new-station form, the empty state and the bump
 * control), and the error state (a rejected station create shows the `role="alert"` banner). Mounted by
 * ASSIGNING the `api` stub as a property; the screen loads on connect, so the stub must resolve or a
 * stray rejection pollutes the run (a rejection is a finding). Every colour is a `--wt-*` token; the
 * native `type="number"` order inputs carry HA-styled labels for axe.
 */
const STATIONS: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "s2", name: "Plancha", displayOrder: 1, isDefault: false, active: true },
];

function stubApi(stations: Station[]): DashboardApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations.map((s) => ({ ...s }))),
    createStation: vi.fn().mockResolvedValue({ id: "s9" }),
    updateStation: vi.fn().mockResolvedValue(undefined),
    deactivateStation: vi.fn().mockResolvedValue(undefined),
    setDefaultStation: vi.fn().mockResolvedValue(undefined),
    setBumpMode: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: KitchenScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("kitchen-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated list", async () => {
    const { el, host } = await mountWidget<KitchenScreen>(
      "dashboard-kitchen-screen",
      { api: stubApi(STATIONS) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with an empty list", async () => {
    const { el, host } = await mountWidget<KitchenScreen>(
      "dashboard-kitchen-screen",
      { api: stubApi([]) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const api = {
      ...stubApi(STATIONS),
      createStation: vi.fn().mockRejectedValue({ code: "station.name_taken" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<KitchenScreen>(
      "dashboard-kitchen-screen",
      { api },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-new-station]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Cocina" }, bubbles: true, composed: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-add-station]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
