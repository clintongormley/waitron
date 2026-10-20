import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, codeMessage, createRequest } from "@waitron/dashboard-kit";
import { ADJUSTMENTS_DASHBOARD } from "./index.js";
import { ADJUSTMENTS_STRINGS } from "./strings.js";
import type { AdjustmentReasonsScreen } from "./reasons-screen.js";
import type { AdjustmentReportScreen } from "./adjustment-report-screen.js";
import { emptyReport } from "../../test/report-fixtures.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("ADJUSTMENTS_DASHBOARD", () => {
  it("puts Voids and comps under Service for managers of adjustments, beside the report", () => {
    expect(ADJUSTMENTS_DASHBOARD.module).toBe("adjustments");
    expect(ADJUSTMENTS_DASHBOARD.screen).toEqual({
      id: "adjustment-report",
      navLabelKey: "nav.adjustment_report",
      group: "reports",
      requiresPermission: "report.view",
    });
    expect(ADJUSTMENTS_DASHBOARD.settingsPanels).toBeUndefined();
    expect(ADJUSTMENTS_DASHBOARD.moreScreens!.map(({ screen }) => screen)).toEqual([
      {
        id: "adjustment-reasons",
        navLabelKey: "nav.adjustment_reasons",
        group: "service",
        requiresPermission: "adjustment.manage",
      },
    ]);
    const { en, es } = ADJUSTMENTS_STRINGS;
    expect([en["nav.adjustment_reasons"], en["adjustments.title"]]).toEqual([
      "Voids and comps",
      "Voids and comps",
    ]);
    expect(en["adjustments.intro"]).toBe(
      "The reasons staff choose when they void or comp an item.",
    );
    expect(es["nav.adjustment_reasons"]).toBe(es["adjustments.title"]);
    expect(es["nav.adjustment_reasons"]).not.toBe(en["nav.adjustment_reasons"]);
  });

  it("gives the module's own refusals a sentence of their own in English and Spanish", () => {
    const generic = codeMessage("adjustment_reason.unregistered", "es");
    expect(codeMessage("adjustment_reason.name_taken", "en")).toBe(
      "Another reason already has this name",
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

  it("the Voids and comps page renders on the context's request and live data", async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            url.endsWith("/settings")
              ? { maxBillComp: null, billApproverRoles: ["manager", "admin"] }
              : {
                  reasons: [
                    {
                      id: "r1",
                      name: "Complaint",
                      names: { en: "Complaint" },
                      kind: "void",
                      actions: ["cancel"],
                      maxPercentBp: null,
                      maxAmount: null,
                      applyRoles: [],
                      approverRoles: [],
                      noteRequired: false,
                      active: true,
                      position: 0,
                    },
                  ],
                },
          ),
      } as Response),
    );
    const liveData = new LiveData();
    const handle = ADJUSTMENTS_DASHBOARD.moreScreens![0]!.create({
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
        "/management-api/adjustments/reasons",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector('[data-test="reasons"]')).not.toBeNull(),
    );
  });

  it("mounts the adjustment report on the context's request and live data", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(emptyReport()),
      } as Response),
    );
    const liveData = new LiveData();
    const report = ADJUSTMENTS_DASHBOARD;
    expect(report.screen.navLabelKey).toBe("nav.adjustment_report");
    expect(ADJUSTMENTS_DASHBOARD.strings.en["nav.adjustment_report"]).toBe("Adjustment report");
    expect(ADJUSTMENTS_DASHBOARD.strings.es["nav.adjustment_report"]).toBe(
      ADJUSTMENTS_STRINGS.es["nav.adjustment_report"],
    );
    expect(ADJUSTMENTS_DASHBOARD.strings.es["nav.adjustment_report"]).not.toBe("Adjustment report");
    const handle = report.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const screen = container.querySelector<AdjustmentReportScreen>(
      "dashboard-adjustment-report-screen",
    )!;
    await screen.updateComplete;
    expect(screen.api.liveData).toBe(liveData);
    await vi.waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        "/management-api/adjustments/report",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    liveData.clear();
  });
});
