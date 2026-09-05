import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillDeviceEnrolScreen, type DeviceEnrolKind } from "./till-device-enrol-screen.js";
import type { StringKey } from "../i18n/strings.js";
import type { TillApi } from "../api/client.js";

/**
 * A fake `TillApi` exposing only the one method the enrol screen calls. `enrolDevice` defaults to a
 * success resolving the four non-secret `DeviceEnrolment` fields (the real cookie rides Set-Cookie,
 * never the body); a test overrides it with its own `vi.fn()`. Cast through `unknown` because the
 * screen touches only this one verb, never the rest of the class surface. (The enrol-screen test pattern,
 * now the one parameterised suite covering all three device kinds — it replaced the two per-kind clone
 * suites, `till` and `handheld`.)
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
function submitCode(el: TillDeviceEnrolScreen, code: string): void {
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-code]")!.value = code;
  el.shadowRoot!.querySelector<HTMLElement>("[data-enrol]")!.click();
}

/** Lets the pending `enrolDevice` promise settle and the element re-render. */
async function flush(el: TillDeviceEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

it("registers as a custom element", () => {
  expect(customElements.get("till-device-enrol-screen")).toBe(TillDeviceEnrolScreen);
});

it("falls back to the default copy (no crash) on an out-of-contract kind", async () => {
  // `kind` is typed `DeviceEnrolKind` and every in-tree caller sets it through a `.kind` property
  // binding, but a raw `kind="…"` attribute or a direct assignment could smuggle an unexpected string
  // in at runtime. render() must degrade to the default (`till`) copy rather than throw on
  // `ENROL_COPY[undefined].title`. Force the out-of-contract value with a cast.
  const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
    api: stubApi(),
    kind: "bogus" as DeviceEnrolKind,
  });
  expect(el.shadowRoot!.querySelector(".title")?.textContent).toContain(
    t("device.till_enrol_title"),
  );
  expect(el.shadowRoot!.querySelector("[data-enrol]")?.textContent).toContain(
    t("device.till_enrol_submit"),
  );
});

/**
 * Every enrol kind derives its own title/hint/submit copy from the same `kind` prop, but shares the
 * code field, error banner, submit gating, live-read, disconnect guard and the single `enrolled` event.
 * The suite runs the whole behavioural contract for each kind — the union of what the two prior screen
 * suites (till + handheld) asserted, now run for all three kinds including the new `kds` overlay.
 */
const kinds: Array<{
  kind: DeviceEnrolKind;
  title: StringKey;
  hint: StringKey;
  submit: StringKey;
}> = [
  {
    kind: "till",
    title: "device.till_enrol_title",
    hint: "device.till_enrol_hint",
    submit: "device.till_enrol_submit",
  },
  {
    kind: "handheld",
    title: "device.handheld_enrol_title",
    hint: "device.handheld_enrol_hint",
    submit: "device.handheld_enrol_submit",
  },
  {
    kind: "kds",
    title: "device.kds_enrol_title",
    hint: "device.kds_enrol_hint",
    submit: "device.kds_enrol_submit",
  },
];

describe.each(kinds)("till-device-enrol-screen (kind=$kind)", ({ kind, title, hint, submit }) => {
  it("derives its title, hint and submit copy from the kind", async () => {
    const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
      api: stubApi(),
      kind,
    });
    expect(el.shadowRoot!.querySelector(".title")?.textContent).toContain(t(title));
    expect(el.shadowRoot!.querySelector(".hint")?.textContent).toContain(t(hint));
    // The code field label is the SHARED, kind-agnostic `device.enrol_code`.
    const field = el.shadowRoot!.querySelector<HTMLElement & { label: string }>("[data-code]")!;
    expect(field.label).toBe(t("device.enrol_code"));
    expect(el.shadowRoot!.querySelector("[data-enrol]")?.textContent).toContain(t(submit));
  });

  it("enrols on a submitted code and signals success (single `enrolled` carrying the kind)", async () => {
    const enrolDevice = vi
      .fn()
      .mockResolvedValue({ deviceId: "d1", kind: "till", stationId: null, label: "Caja 1" });
    const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
      api: stubApi({ enrolDevice }),
      kind,
    });
    const done = new Promise<DeviceEnrolKind>((resolve) =>
      el.addEventListener("enrolled", (e) =>
        resolve((e as CustomEvent<{ kind: DeviceEnrolKind }>).detail.kind),
      ),
    );
    submitCode(el, "ABCD1234");
    expect(await done).toBe(kind); // resolves iff the ONE `enrolled` event fired, carrying this kind
    expect(enrolDevice).toHaveBeenCalledWith("ABCD1234");
  });

  it("shows the enrol error and emits nothing on a rejected code", async () => {
    const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
      api: stubApi({ enrolDevice: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }) }),
      kind,
    });
    const spy = vi.fn();
    el.addEventListener("enrolled", spy);
    submitCode(el, "STALE");
    await flush(el);
    const error = el.shadowRoot!.querySelector('[role="alert"]');
    expect(error?.textContent).toContain(t("device.enrol_failed"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing on an empty submit (no code entered)", async () => {
    const enrolDevice = vi.fn().mockResolvedValue({});
    const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
      api: stubApi({ enrolDevice }),
      kind,
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
    const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
      api: stubApi({ enrolDevice }),
      kind,
    });
    const spy = vi.fn();
    el.addEventListener("enrolled", spy);
    submitCode(el, "ABCD1234");
    el.remove(); // disconnect while enrolDevice is still pending
    resolveEnrol({ deviceId: "d1", kind: "till", stationId: null, label: "Caja 1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
  });

  it("enables the Set up button only once a code is typed", async () => {
    const { el } = await mountWidget<TillDeviceEnrolScreen>("till-device-enrol-screen", {
      api: stubApi(),
      kind,
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
