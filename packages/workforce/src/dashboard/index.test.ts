import { describe, expect, it } from "vitest";
import { createRequest, LiveData } from "@waitron/dashboard-kit";
import { WORKFORCE_DASHBOARD } from "./index.js";
describe("workforce correction contribution", () => {
  it("adds manager Hours beside the unchanged correction entry and binds its hours mode", () => {
    const request = createRequest({ fetchImpl: async () => new Response("") });
    const liveData = new LiveData();
    const hours = WORKFORCE_DASHBOARD.moreScreens?.find((entry) => entry.screen.id === "hours");
    expect(hours?.screen).toEqual({
      id: "hours",
      navLabelKey: "nav.hours",
      group: "team",
      requiresPermission: "workforce.correct",
    });
    expect(WORKFORCE_DASHBOARD.strings.en["nav.hours"]).toBe("Hours");
    expect(WORKFORCE_DASHBOARD.strings.es["nav.hours"]).toBe("Horas");
    const rendered = hours!.create({ request, liveData }).render();
    expect(rendered.strings.join("")).toContain("<dashboard-attendance-corrections-screen");
    expect(rendered.values).toEqual(["hours", request, liveData]);
  });
  it("requires current correction authority in Team and supplies both navigation languages", () => {
    const value = WORKFORCE_DASHBOARD;
    expect(value.module).toBe("workforce");
    expect(value.screen).toEqual({
      id: "time-corrections",
      navLabelKey: "nav.time_corrections",
      group: "team",
      requiresPermission: "workforce.correct",
    });
    expect(value.strings.en["nav.time_corrections"]).toBe("Time corrections");
    expect(value.strings.es["nav.time_corrections"]).toBe("Correcciones de horas");
  });
  it("binds the injected request and shared live cache without making a request while constructing", () => {
    const value = WORKFORCE_DASHBOARD;
    const requests: RequestInit[] = [];
    const request = createRequest({
      fetchImpl: async (_path, init) => {
        requests.push(init);
        return new Response("");
      },
    });
    const liveData = new LiveData();
    const handle = value.create({ request, liveData });
    const rendered = handle.render();
    expect(rendered.strings.join("")).toContain("<dashboard-attendance-corrections-screen");
    expect(rendered.values).toEqual([request, liveData]);
    expect(requests).toEqual([]);
  });
  it("keeps the request binding when no shared cache was supplied", () => {
    const value = WORKFORCE_DASHBOARD;
    const request = createRequest({ fetchImpl: async () => new Response("") });
    expect(value.create({ request }).render().values).toEqual([request, undefined]);
  });
});
