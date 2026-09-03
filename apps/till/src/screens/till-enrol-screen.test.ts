import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillEnrolScreen } from "./till-enrol-screen.js";
import type { TillApi } from "../api/client.js";

/**
 * A fake `TillApi` exposing only the one method the enrol screen calls. `enrolDevice` defaults to a
 * success resolving the four non-secret `DeviceEnrolment` fields (the real cookie rides Set-Cookie,
 * never the body); a test overrides it with its own `vi.fn()`. Cast through `unknown` because the
 * screen touches only this one verb, never the rest of the class surface.
 */
function stubApi(overrides: Partial<Record<"enrolDevice", unknown>> = {}): TillApi {
  return {
    enrolDevice: vi
      .fn()
      .mockResolvedValue({ deviceId: "d1", kind: "till", stationId: null, label: "Caja 1" }),
    ...overrides,
  } as unknown as TillApi;
}

/** Sets the code field's live value and clicks Set up — mirrors an operator typing a code then tapping. */
function submitCode(el: TillEnrolScreen, code: string): void {
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-code]")!.value = code;
  el.shadowRoot!.querySelector<HTMLElement>("[data-enrol]")!.click();
}

/** Lets the pending `enrolDevice` promise settle and the element re-render. */
async function flush(el: TillEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe("till-enrol-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-enrol-screen")).toBe(TillEnrolScreen);
  });

  it("enrols on a submitted code and signals success", async () => {
    const enrolDevice = vi
      .fn()
      .mockResolvedValue({ deviceId: "d1", kind: "till", stationId: null, label: "Caja 1" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolDevice }),
    });
    const done = new Promise<void>((resolve) =>
      el.addEventListener("till-enrolled", () => resolve()),
    );
    submitCode(el, "ABCD1234");
    await done; // resolves iff the event fired
    expect(enrolDevice).toHaveBeenCalledWith("ABCD1234");
  });

  it("shows the enrol error and emits nothing on a rejected code", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolDevice: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }) }),
    });
    const spy = vi.fn();
    el.addEventListener("till-enrolled", spy);
    submitCode(el, "STALE");
    await flush(el);
    const error = el.shadowRoot!.querySelector('[role="alert"]');
    expect(error?.textContent).toContain(t("device.enrol_failed"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing on an empty submit (no code entered)", async () => {
    const enrolDevice = vi.fn().mockResolvedValue({});
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolDevice }),
    });
    const button = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-enrol]",
    )!;
    expect(button.disabled).toBe(true); // Set up starts disabled — no code has been typed yet
    // `wt-button` has no host-level click guard of its own (only its INNER shadow `<button>` goes
    // `disabled`; see packages/ui/src/components/wt-button.ts), so `button.click()` on the host
    // bypasses that native semantics — same as till-lock-screen's Log in (see
    // till-lock-screen.test.ts's "force-clicked with an empty PIN" case). What actually stops the
    // call below is `#enrol`'s own `code === ""` guard, which this asserts directly is disabled too.
    button.click();
    await flush(el);
    expect(enrolDevice).not.toHaveBeenCalled();
  });

  it("does not announce enrolment if the view disconnects mid-enrol", async () => {
    // Hold enrolDevice open so the view can be torn down while the redemption is in flight — the
    // disconnect-safety guard must then skip the announce (a detached view never signals success).
    let resolveEnrol!: (value: unknown) => void;
    const enrolDevice = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => (resolveEnrol = resolve)));
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolDevice }),
    });
    const spy = vi.fn();
    el.addEventListener("till-enrolled", spy);
    submitCode(el, "ABCD1234");
    el.remove(); // disconnect while enrolDevice is still pending
    resolveEnrol({ deviceId: "d1", kind: "till", stationId: null, label: "Caja 1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
  });

  it("enables the Set up button only once a code is typed", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi(),
    });
    const button = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-enrol]",
    )!;
    expect(button.disabled).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-code]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "ABCD1234" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(button.disabled).toBe(false);
  });
});
