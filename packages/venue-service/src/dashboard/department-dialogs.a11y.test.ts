import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import type { DepartmentDialog } from "./department-dialogs.js";
import "./department-dialogs.js";
function testApi(request: unknown) {
  return new VenueServiceApi(request as DashboardRequest);
}
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", active: true },
  ],
  zones: [
    {
      id: "z1",
      name: "Patio",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
    },
  ],
  floorZones: [{ id: "z1", name: "Patio" }],
  salePolicies: { departments: [], zones: [] },
  readiness: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};
const dialogs: DepartmentDialog[] = [
  { kind: "add-department" },
  { kind: "rename-department", row: model.departments[0]! },
  { kind: "add-zone", departmentId: "d1" },
  { kind: "rename-zone", row: model.floorZones[0]! },
  { kind: "move-zone", row: model.floorZones[0]! },
  { kind: "add-to-department", row: { id: "z2", name: "Garden" } },
  { kind: "disable-department", row: model.departments[0]! },
  { kind: "disable-zone", row: model.floorZones[0]! },
];
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("department dialogs (%s)", (theme) => {
  it.each(dialogs)("$kind", async (dialog) => {
    const el = (await mountThemed(
      "<department-dialogs></department-dialogs>",
      theme,
    )) as HTMLElementTagNameMap["department-dialogs"];
    el.model = model;
    el.api = testApi(
      vi.fn(async () => ({ zones: [{ id: "z1", name: "Patio", activeTableCount: 2 }] })),
    );
    el.dialog = dialog;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
  it.each(["invalid", "refused", "clash", "busy"])("name field %s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<department-dialogs></department-dialogs>",
      theme,
    )) as HTMLElementTagNameMap["department-dialogs"];
    el.model = model;
    el.api = testApi(
      vi.fn(async () => {
        if (state === "busy") return new Promise(() => {});
        throw state === "clash"
          ? { code: "department.name_disabled", params: { name: "Brunch", departmentId: "d2" } }
          : { code: "management.request_invalid", params: { field: "name" } };
      }),
    );
    el.dialog = { kind: "rename-department", row: model.departments[0]! };
    await el.updateComplete;
    const box = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    box.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: state === "invalid" ? " " : "Brunch" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    if (state === "invalid") {
      expect(box.error).toBe("This field is required.");
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
        "Correct the highlighted fields to continue.",
      );
      await box.updateComplete;
      expect(box.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
    }
    await expectNoA11yViolations(host);
  });
});
it("captures every dialog in EN/ES, light/dark at 1280/390", async () => {
  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [1280, 390])
        for (const dialog of dialogs) {
          setLocale(locale);
          await page.viewport(width, 800);
          const el = (await mountThemed(
            "<department-dialogs></department-dialogs>",
            theme,
          )) as HTMLElementTagNameMap["department-dialogs"];
          el.model = model;
          el.api = testApi(
            vi.fn(async () => ({ zones: [{ id: "z1", name: "Patio", activeTableCount: 2 }] })),
          );
          el.dialog = dialog;
          await el.updateComplete;
          await new Promise((r) => setTimeout(r, 0));
          await el.updateComplete;
          const modal = el.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const rect = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `../__screenshots__/task-a7-visual/${dialog.kind}-${locale}-${theme}-${width}.png`,
          });
          cleanup();
        }
  await page.viewport(1280, 800);
}, 60000);
