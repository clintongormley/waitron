import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-dietary-origin-picker` so `mountWidget` can create it.
import { DietaryOriginPicker } from "./dietary-origin-picker.js";
import type { DietaryOrigin } from "../api/client.js";

afterEach(cleanupWidgets);

const ORIGINS: DietaryOrigin[] = [
  "plant",
  "meat",
  "fish",
  "shellfish",
  "dairy",
  "egg",
  "honey",
  "other_animal",
];

async function select(el: DietaryOriginPicker, value: string): Promise<void> {
  const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

describe("dietary-origin-picker", () => {
  it("offers a not-categorised option plus one per dietary origin", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=origin] option"),
    ];
    expect(options.map((o) => o.value)).toEqual(["", ...ORIGINS]);
  });

  it("defaults to the not-categorised (empty) option", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("");
  });

  it("emits origin-changed with the selected origin", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const seen = new Promise<CustomEvent<{ origin: DietaryOrigin | null }>>((resolve) =>
      el.addEventListener("origin-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await select(el, "meat");
    expect((await seen).detail.origin).toBe("meat");
  });

  it("emits origin-changed with null for the not-categorised option", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: "meat",
    });
    const seen = new Promise<CustomEvent<{ origin: DietaryOrigin | null }>>((resolve) =>
      el.addEventListener("origin-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await select(el, "");
    expect((await seen).detail.origin).toBeNull();
  });

  it("emits origin-changed as a bubbling, composed event", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const seen = new Promise<Event>((resolve) =>
      el.addEventListener("origin-changed", resolve, { once: true }),
    );
    await select(el, "fish");
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("seeds the select from a passed value", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: "dairy",
    });
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("dairy");
  });

  it("seeds the not-categorised option from a null value", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: null,
    });
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("");
  });

  it("labels the options with localised text, keeping the wire values", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=origin] option"),
    ];
    const byValue = (v: string) => options.find((o) => o.value === v)!;
    expect(byValue("").textContent!.trim()).toBe(t("origin.uncategorised", "es-ES"));
    expect(byValue("meat").textContent!.trim()).toBe(t("origin.meat", "es-ES"));
    expect(byValue("meat").textContent!.trim()).not.toBe("meat");
    expect(byValue("plant").textContent!.trim()).toBe(t("origin.plant", "es-ES"));
  });
});
