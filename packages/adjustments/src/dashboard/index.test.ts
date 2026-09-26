import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, codeMessage, createRequest } from "@waitron/dashboard-kit";
import { ADJUSTMENTS_DASHBOARD } from "./index.js";
import type { AdjustmentReasonsScreen } from "./reasons-screen.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("ADJUSTMENTS_DASHBOARD", () => {
  it("mounts the reasons screen in the service group for managers of adjustments", () => {
    expect(ADJUSTMENTS_DASHBOARD.module).toBe("adjustments");
    expect(ADJUSTMENTS_DASHBOARD.screen).toEqual({
      id: "adjustment-reasons",
      navLabelKey: "nav.adjustment_reasons",
      group: "service",
      requiresPermission: "adjustment.manage",
    });
    expect(ADJUSTMENTS_DASHBOARD.strings.en["nav.adjustment_reasons"]).toBe("Adjustment reasons");
    expect(ADJUSTMENTS_DASHBOARD.strings.es["nav.adjustment_reasons"]).toBe("Motivos de ajuste");
  });

  it("gives the module's own refusals a sentence of their own in English and Spanish", () => {
    const generic = codeMessage("adjustment_reason.unregistered", "es");
    expect(codeMessage("adjustment_reason.name_taken", "en")).toBe(
      "Another active reason already has this name",
    );
    expect(codeMessage("adjustment_reason.not_found", "en")).toBe(
      "That reason could not be found. It may have been removed",
    );
    for (const code of ["adjustment_reason.name_taken", "adjustment_reason.not_found"]) {
      const spanish = codeMessage(code, "es");
      expect(spanish).not.toBe(generic);
      expect(spanish).not.toBe(codeMessage(code, "en"));
    }
  });

  it("create() renders the screen on the context's request and live data", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ reasons: [] }),
      } as Response),
    );
    const liveData = new LiveData();
    const handle = ADJUSTMENTS_DASHBOARD.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const screen = container.querySelector<AdjustmentReasonsScreen>(
      "dashboard-adjustment-reasons-screen",
    )!;
    await screen.updateComplete;
    expect(screen.api.liveData).toBe(liveData);
    await vi.waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        "/management-api/adjustments/reasons?includeInactive=true",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector('[data-test="reasons"]')).not.toBeNull(),
    );
  });
});
