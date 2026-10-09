import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIcons, DROPDOWN_ICONS } from "@waitron/ui";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { realWeekModel, namedWeekModel } from "../testing/real-week-model.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
registerIcons(DROPDOWN_ICONS);
const original = location.href;
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", original);
  await page.viewport(1280, 768);
});
describe.each(["en", "es"] as const)("Real weeks %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("department, zone and All at %i CSS pixels", async (width) => {
      await page.viewport(width, 1000);
      expect(window.innerWidth).toBe(width);
      vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
      setLocale(locale);
      history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12");
      const wrapper = await mountThemed("<div></div>", theme);
      const model = realWeekModel();
      const screen = document.createElement("dashboard-opening-hours-screen");
      screen.api = new OpeningHoursApi((async (path) =>
        path.includes("named-days?")
          ? namedWeekModel()
          : structuredClone(model)) as DashboardRequest);
      wrapper.appendChild(screen);
      await expect
        .poll(() => screen.shadowRoot?.querySelector("opening-hours-week"))
        .not.toBeNull();
      const department = screen.shadowRoot!.querySelector("opening-hours-week")!;
      await department.updateComplete;
      await expect
        .poll(
          () =>
            department.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              "[data-test=own-date]",
            )!.disabled,
        )
        .toBe(false);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `../__screenshots__/task22-${locale}-${theme}-${width}-department.png`,
      });
      screen.shadowRoot!.querySelector("[name=departmentId]")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "zone:z1" },
          bubbles: true,
          composed: true,
        }),
      );
      await expect
        .poll(() => screen.shadowRoot!.querySelector("opening-hours-zone-week"))
        .not.toBeNull();
      const zone = screen.shadowRoot!.querySelector("opening-hours-zone-week")!;
      await zone.updateComplete;
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `../__screenshots__/task22-${locale}-${theme}-${width}-zone.png`,
      });
      screen
        .shadowRoot!.querySelector("[name=departmentId]")!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
        );
      await expect.poll(() => screen.shadowRoot!.querySelector("opening-hours-all")).not.toBeNull();
      const all = screen.shadowRoot!.querySelector("opening-hours-all")!;
      await all.updateComplete;
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `../__screenshots__/task22-${locale}-${theme}-${width}-all.png`,
      });
    });
  });
});

it.each([390, 1280])("shows effective dated blocks at %i CSS pixels", async (width) => {
  await page.viewport(width, 1000);
  expect(window.innerWidth).toBe(width);
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12");
  const wrapper = await mountThemed("<div></div>", "dark");
  setLocale("en");
  const screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi((async (path) =>
    path.includes("named-days?") ? namedWeekModel() : realWeekModel()) as DashboardRequest);
  wrapper.appendChild(screen);
  for (const surface of ["department", "zone"] as const) {
    if (surface === "zone") {
      screen.shadowRoot!.querySelector("[name=departmentId]")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "zone:z1" },
          bubbles: true,
          composed: true,
        }),
      );
    }
    const tag = surface === "department" ? "opening-hours-week" : "opening-hours-zone-week";
    await expect.poll(() => screen.shadowRoot?.querySelector(tag)).not.toBeNull();
    const editor = screen.shadowRoot!.querySelector(tag)!;
    await editor.updateComplete;
    const grid = editor.shadowRoot!.querySelector("service-grid")!;
    await grid.updateComplete;
    const block = grid.shadowRoot!.querySelector<HTMLElement>(
      surface === "department" ? ".block" : ".closed",
    )!;
    expect(block).not.toBeNull();
    block.scrollIntoView({ block: "center", inline: "center" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await page.screenshot({
      path: `../__screenshots__/task22-en-dark-${width}-${surface}-scrolled.png`,
    });
  }
});
