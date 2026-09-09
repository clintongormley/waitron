import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-device-chooser.js";
import type { TillDeviceChooser } from "./till-device-chooser.js";
import type { TillApi } from "../api/client.js";

function stubApi(): TillApi {
  return {
    getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
    join: vi.fn().mockResolvedValue({ joinId: "jr-1", verificationNumber: "47" }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    getLocales: vi.fn().mockResolvedValue({ locales: [] }),
  } as unknown as TillApi;
}

async function flush(el: TillDeviceChooser): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-device-chooser a11y (%s theme)", (theme) => {
  it("has no violations with the new-device modal open", async () => {
    const { el, host } = await mountWidget<TillDeviceChooser>(
      "till-device-chooser",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-setup-new]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
