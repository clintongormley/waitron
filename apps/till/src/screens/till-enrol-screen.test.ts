import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillEnrolScreen } from "./till-enrol-screen.js";
import type { EnrolCatalogue, TillApi } from "../api/client.js";

/**
 * A fake `TillApi` exposing only the two verbs the two-step enrol screen calls (`enrolVerify`, `enrol`)
 * plus `getLocales` (the language chooser's lazy source). Each defaults to a benign value a test
 * overrides. Cast through `unknown` because the screen touches only these verbs, never the rest of the
 * class surface (the screen-test pattern).
 */
type EnrolVerbs = "enrolVerify" | "enrol" | "getLocales";
function stubApi(overrides: Partial<Record<EnrolVerbs, unknown>> = {}): TillApi {
  return {
    enrolVerify: vi.fn().mockResolvedValue(catalogue()),
    enrol: vi.fn().mockResolvedValue({ deviceId: "new-dev", name: "New", formFactor: "till" }),
    getLocales: vi.fn().mockResolvedValue({ locales: [] }),
    ...overrides,
  } as unknown as TillApi;
}

/** A catalogue with one profile of each form-factor family, two stations, one register. */
function catalogue(): EnrolCatalogue {
  return {
    profiles: [
      { id: "pr-till", name: "Front counter", formFactor: "till" },
      { id: "pr-kds", name: "Kitchen pass", formFactor: "kds" },
      { id: "pr-phone", name: "Waiter phone", formFactor: "phone-portrait" },
    ],
    stations: [
      { id: "st1", name: "Pass" },
      { id: "st2", name: "Grill" },
    ],
    registers: [{ id: "rg1", name: "Caja 1" }],
  };
}

async function flush(el: TillEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** Sets a `wt-input`'s live `.value` AND fires the `wt-change` the render binds — the submit path reads
 * the value live off the field, while `wt-change` updates the tracked state that gates the button. */
function typeInput(el: TillEnrolScreen, selector: string, value: string): void {
  const input = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(selector)!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Sets a native `<select>`'s value and fires the `change` the render binds. */
function pickSelect(el: TillEnrolScreen, selector: string, value: string): void {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(selector)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Drives step 1: types a key and advances to step 2, settling the verify. */
async function toDescribe(el: TillEnrolScreen, key = "ABCD1234"): Promise<void> {
  typeInput(el, "[data-key]", key);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
  await flush(el);
}

afterEach(cleanupWidgets);

it("registers as a custom element", () => {
  expect(customElements.get("till-enrol-screen")).toBe(TillEnrolScreen);
});

describe("step 1 — the key", () => {
  it("posts the typed key to enrolVerify and advances to step 2 with the catalogue", async () => {
    const enrolVerify = vi.fn().mockResolvedValue(catalogue());
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolVerify }),
    });
    // Step 1 shows the key field, not the describe form.
    expect(el.shadowRoot!.querySelector("[data-key]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-name]")).toBeNull();
    await toDescribe(el, "PAIR-9999");
    expect(enrolVerify).toHaveBeenCalledWith("PAIR-9999");
    // Now on step 2: the name + profile fields are present, the key field gone.
    expect(el.shadowRoot!.querySelector("[data-name]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-profile]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-key]")).toBeNull();
  });

  it("keeps step 1 and shows the generic banner on a refused key", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolVerify: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }) }),
    });
    await toDescribe(el, "STALE");
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      t("device.enrol_failed"),
    );
    // Did not advance — still the key field, no describe form.
    expect(el.shadowRoot!.querySelector("[data-name]")).toBeNull();
  });

  it("enables Continue only once a key is typed", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
    const button = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-continue]",
    )!;
    expect(button.disabled).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-key]")!.dispatchEvent(
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

describe("step 2 — describe this device", () => {
  it("shows a STATION picker (not a register) for a kds profile", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
    await toDescribe(el);
    pickSelect(el, "[data-profile]", "pr-kds");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-station]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-register]")).toBeNull();
  });

  it("shows a REGISTER picker (not a station) for a phone/tablet profile", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
    await toDescribe(el);
    pickSelect(el, "[data-profile]", "pr-phone");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-register]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-station]")).toBeNull();
  });

  it("shows NEITHER picker for a counter till profile", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
    await toDescribe(el);
    pickSelect(el, "[data-profile]", "pr-till");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-station]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-register]")).toBeNull();
  });

  it("renders profiles by human name (never a raw form-factor token)", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
    await toDescribe(el);
    const options = [...el.shadowRoot!.querySelectorAll("[data-profile] option")].map((o) =>
      o.textContent!.trim(),
    );
    expect(options).toEqual(
      expect.arrayContaining(["Front counter", "Kitchen pass", "Waiter phone"]),
    );
    // The raw form-factor tokens never render.
    const text = el.shadowRoot!.textContent!;
    expect(text).not.toContain("phone-portrait");
    expect(text).not.toContain("kds_station");
  });

  it("Set up device POSTs a KDS enrol with the chosen stationId", async () => {
    const enrol = vi.fn().mockResolvedValue({ deviceId: "kds-7", name: "Pass", formFactor: "kds" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrol }),
    });
    await toDescribe(el, "KEY1");
    typeInput(el, "[data-name]", "Pass");
    pickSelect(el, "[data-profile]", "pr-kds");
    await el.updateComplete;
    pickSelect(el, "[data-station]", "st2");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await flush(el);
    expect(enrol).toHaveBeenCalledWith({
      code: "KEY1",
      name: "Pass",
      profileId: "pr-kds",
      stationId: "st2",
    });
  });

  it("Set up device POSTs a TILL enrol with NEITHER binding", async () => {
    const enrol = vi
      .fn()
      .mockResolvedValue({ deviceId: "till-3", name: "Front", formFactor: "till" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrol }),
    });
    await toDescribe(el);
    typeInput(el, "[data-name]", "Front");
    pickSelect(el, "[data-profile]", "pr-till");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await flush(el);
    expect(enrol).toHaveBeenCalledWith({ code: "ABCD1234", name: "Front", profileId: "pr-till" });
  });

  it("defaults a phone enrol to the sole register (the picker may be left untouched)", async () => {
    const enrol = vi
      .fn()
      .mockResolvedValue({ deviceId: "phone-2", name: "Waiter", formFactor: "phone-portrait" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrol }),
    });
    await toDescribe(el);
    typeInput(el, "[data-name]", "Waiter");
    pickSelect(el, "[data-profile]", "pr-phone");
    await el.updateComplete;
    // The register picker was NOT touched — the sole register defaulted, so submit is enabled.
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await flush(el);
    expect(enrol).toHaveBeenCalledWith({
      code: "ABCD1234",
      name: "Waiter",
      profileId: "pr-phone",
      registerId: "rg1",
    });
  });

  it("emits a composed `enrolled` carrying the new deviceId on success", async () => {
    const enrol = vi
      .fn()
      .mockResolvedValue({ deviceId: "made-42", name: "Front", formFactor: "till" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrol }),
    });
    const done = new Promise<string>((resolve) =>
      el.addEventListener("enrolled", (e) =>
        resolve((e as CustomEvent<{ deviceId: string }>).detail.deviceId),
      ),
    );
    await toDescribe(el);
    typeInput(el, "[data-name]", "Front");
    pickSelect(el, "[data-profile]", "pr-till");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    expect(await done).toBe("made-42");
  });

  it("shows the generic banner and emits nothing on a refused enrol", async () => {
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrol: vi.fn().mockRejectedValue({ code: "device.pairing_invalid" }) }),
    });
    const spy = vi.fn();
    el.addEventListener("enrolled", spy);
    await toDescribe(el);
    typeInput(el, "[data-name]", "Front");
    pickSelect(el, "[data-profile]", "pr-till");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      t("device.enrol_failed"),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not announce enrolment if the view disconnects mid-enrol", async () => {
    let resolveEnrol!: (value: unknown) => void;
    const enrol = vi.fn().mockImplementation(() => new Promise((r) => (resolveEnrol = r)));
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrol }),
    });
    const spy = vi.fn();
    el.addEventListener("enrolled", spy);
    await toDescribe(el);
    typeInput(el, "[data-name]", "Front");
    pickSelect(el, "[data-profile]", "pr-till");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    el.remove(); // disconnect while enrol is still pending
    resolveEnrol({ deviceId: "d1", name: "Front", formFactor: "till" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("preset code (the dev DEMO path)", () => {
  it("auto-verifies a preset code on connect and starts on step 2 (key step skipped)", async () => {
    const enrolVerify = vi.fn().mockResolvedValue(catalogue());
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ enrolVerify }),
      code: "DEMO",
    });
    await flush(el);
    expect(enrolVerify).toHaveBeenCalledWith("DEMO");
    // Landed on the describe step — the key field never showed.
    expect(el.shadowRoot!.querySelector("[data-name]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-key]")).toBeNull();
  });
});

it("offers the language chooser", async () => {
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
  expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
});
