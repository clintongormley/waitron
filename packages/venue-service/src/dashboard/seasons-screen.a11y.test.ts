import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { painterModel } from "../testing/season-painter-fixture.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./seasons-screen.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Seasons page (%s)", (theme) => {
  test.each(["list", "viewer", "edit", "new", "refused", "delete"])("%s", async (state) => {
    setLocale("en");
    history.replaceState(
      {},
      "",
      state === "new"
        ? "/seasons/view/new"
        : ["edit", "refused"].includes(state)
          ? "/seasons/season/winter"
          : "/seasons",
    );
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-seasons-screen");
    screen.readOnly = state === "viewer";
    screen.api = new OpeningHoursApi((async (path, method) => {
      if (path.endsWith("/delete-impact"))
        return { departments: [{ id: "d1", name: "Restaurant" }] };
      if (method !== "GET")
        throw { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } };
      return painterModel();
    }) as DashboardRequest);
    wrapper.append(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("wt-data-table, seasons-window"))
      .not.toBeNull();
    if (state === "refused") {
      const editor = screen.shadowRoot!.querySelector("seasons-window")!;
      await editor.updateComplete;
      const name = editor.shadowRoot!.querySelector("wt-input")!;
      name.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Deep winter" },
          bubbles: true,
          composed: true,
        }),
      );
      await editor.updateComplete;
      editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-seasons]")!.click();
      await expect.poll(() => name.error).toBe("Another season has this name.");
    }
    if (state === "delete") {
      const table = screen.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-season]")!.click();
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=delete-impact]")?.textContent)
        .toContain("Restaurant");
    }
    await expectNoA11yViolations(host);
  });
});
