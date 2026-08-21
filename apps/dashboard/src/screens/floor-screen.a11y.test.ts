import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./floor-screen.js";
import type { FloorScreen } from "./floor-screen.js";
import type { DashboardApi, DashboardTable, FloorZone } from "../api/client.js";

/**
 * The floor-plan config screen scanned by axe in both themes, in three shapes: populated (a zone + a table,
 * so both panels' rows and the zone <select> render), empty (just the two new-item forms and the empty
 * states), and the error state (a rejected zone create shows the `role="alert"` banner). Mounted by
 * ASSIGNING the `api` stub as a property; the screen loads on connect, so the stub must resolve or a
 * stray rejection pollutes the run (a rejection is a finding). Every colour is a `--wt-*` token; the
 * native `type="number"` inputs and the token-styled `<select>` carry HA-styled labels for axe.
 */
const ZONES: FloorZone[] = [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }];

const TABLES: DashboardTable[] = [
  {
    id: "t1",
    label: "4",
    zoneId: "z1",
    capacity: 2,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

function stubApi(zones: FloorZone[], tables: DashboardTable[]): DashboardApi {
  return {
    listZones: vi.fn().mockResolvedValue(zones.map((z) => ({ ...z }))),
    listTables: vi.fn().mockResolvedValue(tables.map((t) => ({ ...t }))),
    createZone: vi.fn().mockResolvedValue({ id: "z9" }),
    updateZone: vi.fn().mockResolvedValue(undefined),
    deactivateZone: vi.fn().mockResolvedValue(undefined),
    createTable: vi.fn().mockResolvedValue({ id: "t9" }),
    updateTable: vi.fn().mockResolvedValue(undefined),
    deactivateTable: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: FloorScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("floor-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated list", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      { api: stubApi(ZONES, TABLES) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with empty lists", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      { api: stubApi([], []) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const api = {
      ...stubApi(ZONES, TABLES),
      createZone: vi.fn().mockRejectedValue({ code: "zone.name_taken" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-new-zone]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Comedor" }, bubbles: true, composed: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-add-zone]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
