import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-device-enrol-screen.js";
import type { DeviceEnrolKind, TillDeviceEnrolScreen } from "./till-device-enrol-screen.js";
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
async function flush(el: TillDeviceEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

// The three kinds render byte-identical structure apart from their copy, so one kind per theme covers the
// a11y surface; `kds` is used as the representative kind (any would do — the swept structure is shared).
const kind: DeviceEnrolKind = "kds";

describe.each(["light", "dark"] as const)("till-device-enrol-screen a11y (%s theme)", (theme) => {
  it("has no violations on the enrol view (labelled code field + submit)", async () => {
    const { el, host } = await mountWidget<TillDeviceEnrolScreen>(
      "till-device-enrol-screen",
      { api: stubApi(), kind },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the enrol ERROR banner (danger-on-surface, its own colour combo)", async () => {
    const { el, host } = await mountWidget<TillDeviceEnrolScreen>(
      "till-device-enrol-screen",
      {
        api: stubApi({
          enrolDevice: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }),
        }),
        kind,
      },
      theme,
    );
    await flush(el);
    // Drive an enrol failure so the role="alert" banner renders for the sweep. `#enrol` reads the code
    // LIVE off the field, so the field's own `.value` must be set (not just a synthetic wt-change, which
    // only updates tracked state) — otherwise the submit early-returns and the banner never appears.
    // Clicking the `wt-button` HOST bypasses its inner shadow `<button>`'s disabled paint (the host has
    // no click guard of its own — see till-device-enrol-screen.test.ts's direct disabled-property
    // assertion), but that's harmless here: a real code is set below, so `#enrol`'s `code === ""` guard
    // is a no-op and the call goes through on its own merits regardless of the button's disabled attribute.
    el.shadowRoot!.querySelector<HTMLInputElement>("[data-code]")!.value = "STALE";
    el.shadowRoot!.querySelector<HTMLElement>("[data-enrol]")!.click();
    await flush(el);
    // Guard against a vacuous sweep: the banner must actually be present, so a regression that stops it
    // rendering fails HERE rather than silently re-checking the plain enrol view.
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
