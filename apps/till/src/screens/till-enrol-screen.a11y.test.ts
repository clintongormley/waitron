import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-enrol-screen.js";
import type { TillEnrolScreen } from "./till-enrol-screen.js";
import type { TillApi } from "../api/client.js";

function stubApi(overrides: Partial<Record<"enrolDevice", unknown>> = {}): TillApi {
  return {
    enrolDevice: vi
      .fn()
      .mockResolvedValue({ deviceId: "d1", kind: "till", stationId: null, label: "Caja 1" }),
    ...overrides,
  } as unknown as TillApi;
}

/** Settles the in-flight `enrolDevice` promise and the follow-up render. */
async function flush(el: TillEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-enrol-screen a11y (%s theme)", (theme) => {
  it("has no violations on the enrol view (labelled code field + submit)", async () => {
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the enrol ERROR banner (danger-on-surface, its own colour combo)", async () => {
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      {
        api: stubApi({
          enrolDevice: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }),
        }),
      },
      theme,
    );
    await flush(el);
    // Drive an enrol failure so the role="alert" banner renders for the sweep. `#enrol` reads the code
    // LIVE off the field, so the field's own `.value` must be set (not just a synthetic wt-change, which
    // only updates tracked state) — otherwise the submit early-returns and the banner never appears.
    el.shadowRoot!.querySelector<HTMLInputElement>("[data-code]")!.value = "STALE";
    el.shadowRoot!.querySelector<HTMLElement>("[data-enrol]")!.click();
    await flush(el);
    // Guard against a vacuous sweep: the banner must actually be present, so a regression that stops it
    // rendering fails HERE rather than silently re-checking the plain enrol view.
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
