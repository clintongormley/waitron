import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import { ShiftEditDialog } from "./shift-edit-dialog.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("shift editor accessibility (%s)", (theme) => {
  test.each(["new", "edit", "invalid", "refused", "delete", "swap"])("%s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = new ShiftEditDialog();
    el.open = true;
    el.week = rotaWeek();
    el.businessDay = "2026-12-04";
    el.personId = "ana";
    el.shiftId = state === "new" || state === "invalid" ? undefined : "filled";
    if (state === "swap")
      el.week.openSwaps = [{ swapId: "swap", fromShiftId: "filled", toShiftId: null }];
    const client = rotaApi();
    el.api = client.api;
    host.append(el);
    await el.updateComplete;
    const click = (name: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!.click();
    if (["invalid", "refused", "swap"].includes(state)) {
      el.shadowRoot!.querySelector("[name=endsAt]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "18:00" } }),
      );
      await el.updateComplete;
      if (state === "refused") client.request.mockRejectedValueOnce({ code: "connection.failed" });
      click("save");
      await el.updateComplete;
      if (state === "refused")
        await vi.waitFor(() =>
          expect(
            (el.shadowRoot!.querySelector("wt-form-actions")! as HTMLElement & { error: string })
              .error,
          ).toBeTruthy(),
        );
    }
    if (state === "delete") {
      click("delete");
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
