import { LiveData } from "@waitron/dashboard-kit";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { LocationSettingsScreen } from "./location-settings-screen.js";
import { t } from "../i18n/t.js";

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
  it("keeps an edited description when the setting refreshes elsewhere", async () => {
    const liveData = new LiveData();
    const client = Object.assign(api(), { liveData });
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "Borrador local");
    await el.updateComplete;
    vi.mocked(client.getLocationSettings).mockResolvedValue({
      name: "Calle Nueva",
      operationDescription: "Cambiado en otro sitio",
    });
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(q(el, "p").textContent).toBe("Calle Nueva"));
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe(
      "Borrador local",
    );
  });
  it("reports a failed save beside the form without a field error", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(q(el, "[role=alert]").textContent).toBe(t("location_settings.save_error"));
    expect(q(el, "[name=operationDescription]").getAttribute("error")).toBe("");
    expect(el.shadowRoot!.querySelector("[role=status]")).toBeNull();
  });
  it("retries a failed read and then shows the form", async () => {
    const client = api({
      getLocationSettings: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta" }),
    });
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=retry]").click();
    await flush(el);
    expect(client.getLocationSettings).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe(
      "Venta",
    );
  });
  it("saves the description when Enter is pressed in it", async () => {
    const client = api();
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: client,
    });
    await flush(el);
    const field = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
      "[name=operationDescription]",
    )!;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "Venta de comidas";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(client.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Venta de comidas");
  });
  it("sends one save while a save is still in flight", async () => {
    let resolve!: () => void;
    const putLocationSettings = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { el } = await mountWidget<LocationSettingsScreen>("dashboard-location-settings-screen", {
      api: api({ putLocationSettings }),
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await el.updateComplete;
    q(el, "[data-test=save]").click();
    try {
      expect(putLocationSettings).toHaveBeenCalledTimes(1);
    } finally {
      resolve();
      await flush(el);
    }
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
