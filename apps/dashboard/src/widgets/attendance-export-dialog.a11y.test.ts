import { afterEach, describe, expect, it } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { AttendanceExportDialog } from "./attendance-export-dialog.js";
const modules = import.meta.glob<typeof import("./attendance-export-dialog.js")>(
  "./attendance-export-dialog.ts",
);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
describe.each(["light", "dark"] as const)("export accessibility %s", (theme) => {
  it.each(["own", "manager"] as const)(
    "checks %s loading, ready, invalid and refused states",
    async (mode) => {
      setLocale("en-GB");
      const load = modules["./attendance-export-dialog.ts"];
      expect(load).toBeTypeOf("function");
      await load!();
      let ready!: (value: unknown) => void;
      const pending = new Promise((r) => {
        ready = r;
      });
      const request = (async (path: string) =>
        path.includes("export-options")
          ? pending
          : Promise.reject({ code: "authorization.not_permitted" })) as DashboardRequest;
      const { el, host } = await mountWidget<AttendanceExportDialog>(
        "dashboard-attendance-export-dialog",
        {
          request,
          open: true,
          scopeKey: "viewer:1",
          mode,
          locationId: "place",
          period: { start: "2026-01-01", end: "2026-02-01" },
          people: [{ personId: "one", displayName: "María Muñoz" }],
        },
        theme,
      );
      await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      await expectNoA11yViolations(host);
      ready({ available: true, canExportAll: true });
      await expect
        .poll(() =>
          el.shadowRoot!.querySelector("[data-test=export-download]")!.getAttribute("disabled"),
        )
        .toBeNull();
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=export-download]")!.click();
      await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector("[name=exportFrom]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});
