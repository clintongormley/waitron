import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { VenueServiceApi } from "./client.js";
import type { FloorPlansScreen } from "./floor-plans-screen.js";
import { casaMarina } from "./floor-plans-fixture.js";
import "./floor-plans-screen.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

async function mount(state: string, theme: "light" | "dark") {
  const wrapper = await mountThemed("<div></div>", theme);
  const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
  screen.api = new VenueServiceApi((async () => {
    if (state === "load-failed") throw new Error("offline");
    return state === "empty" ? { departments: [] } : casaMarina();
  }) as DashboardRequest);
  screen.readOnly = state === "viewer";
  wrapper.append(screen);
  const done = {
    "load-failed": "[data-test=read-error]",
    empty: "[data-test=no-departments]",
  }[state];
  if (done) await expect.poll(() => screen.shadowRoot!.querySelector(done)).not.toBeNull();
  else {
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    await expect.poll(() => table.shadowRoot!.querySelector("[part~=zone-link]")).not.toBeNull();
  }
  await screen.updateComplete;
  return wrapper;
}

describe.each(["light", "dark"] as const)("Floor plans (%s)", (theme) => {
  test.each(["list", "viewer", "empty", "load-failed", "spanish"])("%s", async (state) => {
    if (state === "spanish") setLocale("es");
    const host = await mount(state, theme);
    await expectNoA11yViolations(host);
  });
});
