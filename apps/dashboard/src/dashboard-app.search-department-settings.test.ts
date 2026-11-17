import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { leaveCoordinatorFor, navigationGuardFor, type WtInput } from "@waitron/ui";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import {
  mountReceiptApp,
  venueServiceModel,
  departmentForm,
  departmentDialog,
} from "./testing/department-receipt-app-fixture.js";
import {
  searchBox,
  searchResult,
  settingChooser,
  searchSettings,
  chooseSettingRow,
} from "./testing/setting-search-fixture.js";
const originalViewport: [number, number] = [window.innerWidth, window.innerHeight];
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  vi.restoreAllMocks();
  await page.viewport(...originalViewport);
});
const reminder = "venue-service:department:courseSettings";
it.each(["en-GB", "es-ES"])(
  "finds the real reminder in %s and opens Tables; Back restores the page",
  async (locale) => {
    const { app } = await mountReceiptApp({
      locale,
      path: "/venue-operations",
      respond: (path) =>
        path === "/management-api/venue-service"
          ? Promise.resolve(
              Response.json({
                ...venueServiceModel(),
                courses: [{ id: "mains", name: "Mains" }],
                courseSettingsByDepartment: {},
              }),
            )
          : undefined,
    });
    await searchSettings(app, locale === "es-ES" ? "avisar" : "remind");
    const pushed = vi.spyOn(history, "pushState");
    await userEvent.click(searchResult(app, reminder)!);
    await expect.poll(() => departmentDialog(app)?.tab).toBe("tables");
    await expect
      .poll(() => departmentForm(app)?.shadowRoot?.querySelector("[name=course-mains-reminder]"))
      .toBeTruthy();
    expect(location.pathname).toBe("/venue-operations/department/bar/view/tables");
    expect(searchBox(app).value).toBe("");
    expect(
      pushed.mock.calls.some((call) => String(call[2]).includes("/department/bar/view/tables")),
    ).toBe(true);
    history.back();
    await expect.poll(() => location.pathname).toBe("/venue-operations");
    await expect.poll(() => departmentDialog(app)).toBeNull();
  },
);
it("retains the real same-department draft and protects a different department with Keep/Discard", async () => {
  await page.viewport(390, 800);
  const { app } = await mountReceiptApp({
    path: "/venue-operations/department/bar",
    departments: [
      { id: "bar", name: "Bar" },
      { id: "restaurant", name: "Restaurant" },
    ],
  });
  await expect
    .poll(() => departmentForm(app)?.shadowRoot?.querySelector("wt-input[name=name]"))
    .toBeTruthy();
  const name = () =>
    departmentForm(app)!.shadowRoot!.querySelector<WtInput>("wt-input[name=name]")!;
  name().dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Edited bar" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => leaveCoordinatorFor(app)!.isDirty()).toBe(true);
  // Activate the shell's search handler while its existing department modal holds pointer focus.
  await searchSettings(app, "remind");
  searchResult(app, reminder)!.click();
  await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
  await chooseSettingRow(app, "bar");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect.poll(() => departmentDialog(app)?.tab).toBe("tables");
  expect(name().value).toBe("Edited bar");
  expect(leaveCoordinatorFor(app)!.isDirty()).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  expect(question.open).toBe(false);
  for (const choice of ["keep", "discard"]) {
    await searchSettings(app, "remind");
    searchResult(app, reminder)!.click();
    await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
    await chooseSettingRow(app, "restaurant");
    await userEvent.click(
      settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
    );
    await expect.poll(() => question.open).toBe(true);
    await userEvent.click(
      question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!,
    );
    await expect.poll(() => question.open).toBe(false);
    if (choice === "keep") {
      expect(location.pathname).toBe("/venue-operations/department/bar/view/tables");
      expect(name().value).toBe("Edited bar");
      expect(searchBox(app).value).toBe("remind");
      expect(app.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(
        true,
      );
    }
  }
  await expect
    .poll(() => location.pathname)
    .toBe("/venue-operations/department/restaurant/view/tables");
  expect(leaveCoordinatorFor(app)!.isDirty()).toBe(false);
  expect(searchBox(app).value).toBe("");
  expect(app.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(false);
});

it("Back closes the real chooser when leaving its containing page", async () => {
  const { app } = await mountReceiptApp({
    path: "/overview",
    departments: [
      { id: "bar", name: "Bar" },
      { id: "restaurant", name: "Restaurant" },
    ],
  });
  await navigationGuardFor(window)!.write("/venue-operations");
  await expect.poll(() => location.pathname).toBe("/venue-operations");
  await searchSettings(app, "remind");
  await userEvent.click(searchResult(app, reminder)!);
  await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
  history.back();
  await expect.poll(() => location.pathname).toBe("/overview");
  await expect.poll(() => settingChooser(app)).toBeNull();
});
