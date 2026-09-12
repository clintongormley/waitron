import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { LocationSettingsScreen } from "./location-settings-screen.js";

const q = (el: LocationSettingsScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
const flush = async (el: LocationSettingsScreen) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};
function api(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
function edit(el: LocationSettingsScreen, value: string) {
  q(el, "[name=operationDescription]").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
afterEach(cleanupWidgets);
describe("location invoice description", () => {
  it("reads the current setting and saves the entered description", async () => {
    const client = api();
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe(
      "Venta en establecimiento",
    );
    edit(el, "Venta de comidas");
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(client.putLocationSettings).toHaveBeenCalledWith("Venta de comidas");
    expect(q(el, "[role=status]")).not.toBeNull();
  });
  it("explains an empty field without saving", async () => {
    const client = api();
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "  ");
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(client.putLocationSettings).not.toHaveBeenCalled();
    expect(q(el, "[name=operationDescription]").getAttribute("error")).not.toBe("");
  });
  it("retains a rejected description with a field error", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "operationDescription" },
      }),
    });
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "x".repeat(501));
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(
      (q(el, "[name=operationDescription]") as unknown as { value: string }).value,
    ).toHaveLength(501);
    expect(q(el, "[name=operationDescription]").getAttribute("error")).not.toBe("");
  });
  it("reports a failed read and offers retry", async () => {
    const client = api({ getLocationSettings: vi.fn().mockRejectedValue(new Error("offline")) });
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    expect(q(el, "[data-test=retry]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull();
  });
  it.each(["light", "dark"] as const)("has no accessibility violations in %s", async (theme) => {
    const { el, host } = await mountWidget<LocationSettingsScreen>(
      "dashboard-location-settings-screen",
      { api: api() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
