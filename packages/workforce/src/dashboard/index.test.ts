import { describe, expect, it } from "vitest";
import { createRequest, LiveData } from "@waitron/dashboard-kit";
import { WORKFORCE_DASHBOARD } from "./index.js";
describe("workforce correction contribution", () => {
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
