import { afterEach, describe, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { VenueServiceApi } from "./client.js";
import { VenueOperationsLoader } from "./venue-operations-loader.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
customElements.define("a10-load-a11y", class extends VenueOperationsLoader {});
const original = location.href;
afterEach(() => {
  cleanup();
  history.replaceState(null, "", original);
  setLocale("en");
});
describe.each(["light", "dark"] as const)("load wrapper accessibility (%s)", (theme) => {
  it.each(["list", "settings", "missing", "failure"])("%s", async (state) => {
    setLocale("en");
    history.replaceState(
      null,
      "",
      state === "settings"
        ? "/manage/venue-operations/department/d1"
        : state === "missing"
          ? "/manage/venue-operations/department/gone"
          : "/manage/venue-operations",
    );
    await mountThemed("<div></div>", theme);
    const loader = document.createElement("a10-load-a11y") as VenueOperationsLoader;
    const model = structuredClone(zonesModel);
    model.floorZones = model.zones.map(({ id, name, active }) => ({ id, name, active }));
    loader.api = new VenueServiceApi((async (path) => {
      if (state === "failure") throw new Error("offline");
      if (path.endsWith("includeInactive=true")) return model.floorZones;
      if (path === "/management-api/venue-service") return model;
      if (path.endsWith("/transfers"))
        return { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] };
      return [];
    }) as DashboardRequest);
    host.append(loader);
    if (state === "failure")
      await expect.poll(() => loader.shadowRoot?.querySelector("[role=alert]")).not.toBeNull();
    else
      await expect
        .poll(() => loader.shadowRoot?.querySelector("venue-departments-shell")?.model)
        .toBeDefined();
    await expectNoA11yViolations(host);
  });
});
