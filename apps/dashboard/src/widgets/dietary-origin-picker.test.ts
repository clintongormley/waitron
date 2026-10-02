import { afterEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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
  await chooseOption(el.shadowRoot!.querySelector("[data-test=origin]")!, value);
  await el.updateComplete;
}

type OriginBox = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  search: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

const originBox = (el: DietaryOriginPicker): OriginBox =>
  el.shadowRoot!.querySelector<OriginBox>('wt-combobox[name="origin"]')!;

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownOrigin(el: DietaryOriginPicker): Promise<string | undefined> {
  const box = originBox(el);
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

describe("dietary-origin-picker", () => {
  it("picks the origin from the shared dropdown, with not categorised as its prompt and a row", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: "dairy",
    });
    const box = originBox(el);
    expect(box).not.toBeNull();
    expect(box.label).toBe(t("origin.label", "es-ES"));
    expect(box.search).toBe("auto");
    expect(box.placeholder).toBe(t("origin.uncategorised", "es-ES"));
    expect(box.options).toEqual([
      { value: "", label: t("origin.uncategorised", "es-ES") },
      ...ORIGINS.map((origin) => ({ value: origin, label: t(`origin.${origin}`, "es-ES") })),
    ]);
    expect(box.value).toBe("dairy");
    expect(await shownOrigin(el)).toBe(t("origin.dairy", "es-ES"));
    const seen = new Promise<CustomEvent<{ origin: DietaryOrigin | null }>>((resolve) =>
      el.addEventListener("origin-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await chooseOption(box, "fish");
    expect((await seen).detail.origin).toBe("fish");
  });

  it("offers a not-categorised option plus one per dietary origin", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const options = originBox(el).options;
    expect(options.map((o) => o.value)).toEqual(["", ...ORIGINS]);
  });

  it("defaults to the not-categorised (empty) option", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const sel = originBox(el);
    expect(sel.value).toBe("");
    expect(await shownOrigin(el)).toBe(t("origin.uncategorised", "es-ES"));
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

  it("seeds the dropdown from a passed value", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: "dairy",
    });
    const sel = originBox(el);
    expect(sel.value).toBe("dairy");
    expect(await shownOrigin(el)).toBe(t("origin.dairy", "es-ES"));
  });

  it("seeds the not-categorised option from a null value", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: null,
    });
    const sel = originBox(el);
    expect(sel.value).toBe("");
    expect(await shownOrigin(el)).toBe(t("origin.uncategorised", "es-ES"));
  });

  it("labels the options with localised text, keeping the wire values", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const options = originBox(el).options;
    const byValue = (v: string) => options.find((o) => o.value === v)!;
    expect(byValue("").label).toBe(t("origin.uncategorised", "es-ES"));
    expect(byValue("meat").label).toBe(t("origin.meat", "es-ES"));
    expect(byValue("meat").label).not.toBe("meat");
    expect(byValue("plant").label).toBe(t("origin.plant", "es-ES"));
  });
});
