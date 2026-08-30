import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-handheld-enrol-screen.js";
import type { TillHandheldEnrolScreen } from "./till-handheld-enrol-screen.js";
import type { TillApi } from "../api/client.js";

function stubApi(overrides: Partial<Record<"enrolDevice", unknown>> = {}): TillApi {
  return {
    enrolDevice: vi
      .fn()
      .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: "", label: "Phone" }),
    ...overrides,
  } as unknown as TillApi;
}

/** Settles the in-flight `enrolDevice` promise and the follow-up render. */
async function flush(el: TillHandheldEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-handheld-enrol-screen a11y (%s theme)", (theme) => {
  it("has no violations on the enrol view (labelled code field + submit)", async () => {
    const { el, host } = await mountWidget<TillHandheldEnrolScreen>(
      "till-handheld-enrol-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the enrol ERROR banner (danger-on-surface, its own colour combo)", async () => {
    const { el, host } = await mountWidget<TillHandheldEnrolScreen>(
      "till-handheld-enrol-screen",
      {
        api: stubApi({
          enrolDevice: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }),
        }),
      },
      theme,
    );
    await flush(el);
    // Drive an enrol failure so the role="alert" banner renders for the sweep.
    el.shadowRoot!.querySelector<HTMLElement>("[data-code]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "STALE" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-enrol]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
