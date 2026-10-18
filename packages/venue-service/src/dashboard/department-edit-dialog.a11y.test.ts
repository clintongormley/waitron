import { afterEach, describe, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  editDepartmentField,
  departmentSave,
  selectDepartmentTab,
} from "../testing/department-edit-fixture.js";
afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("department editor accessibility in %s", (theme) => {
  it.each(["clean", "invalid", "refused", "pending"] as const)("%s", async (state) => {
    setLocale("en");
    let finish: (() => void) | undefined;
    const { form, modal, app } = await mountDepartmentEditor(
      (async (path, method = "GET") => {
        if (method === "GET")
          return path.endsWith("/profiles")
            ? []
            : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
        if (state === "pending")
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        if (state === "refused") throw { code: "department.name_taken" };
      }) as DashboardRequest,
      theme,
    );
    try {
      if (state !== "clean") {
        await editDepartmentField(form, "name", state === "invalid" ? "" : "Draft");
        departmentSave(form).click();
        await form.updateComplete;
        if (state === "refused")
          await expect
            .poll(
              () =>
                form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!
                  .error,
            )
            .toBe("A department with this name already exists.");
        if (state === "pending") await expect.poll(() => !!finish).toBe(true);
      }
      expect(modal.open).toBe(true);
      await expectNoA11yViolations(app);
    } finally {
      finish?.();
    }
  });
  it.each(["details", "service", "transfers"] as const)("the %s tab", async (tab) => {
    setLocale("en");
    const { form, modal, app } = await mountDepartmentEditor(undefined, theme);
    await selectDepartmentTab(form, tab);
    const panel = form.shadowRoot!.querySelector(`[slot=${tab}]`)!;
    expect(panel.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(modal.open).toBe(true);
    await expectNoA11yViolations(app);
  });
});
