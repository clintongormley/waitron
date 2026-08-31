import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-dietary-origin-picker` so `mountWidget` can create it.
import { DietaryOriginPicker } from "./dietary-origin-picker.js";
import type { DietaryOrigin } from "../api/client.js";

afterEach(cleanupWidgets);

/** The eight taxonomy tokens in the widget's display order (mirrors `DIETARY_ORIGINS`). */
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

/** Pick a value on the native `<select>` and fire its `change`. `""` is the not-categorised option. */
async function select(el: DietaryOriginPicker, value: string): Promise<void> {
  const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

describe("dietary-origin-picker", () => {
  // The empty "not categorised" option plus one per origin — nine options, the first mapping to null.
  it("offers a not-categorised option plus one per dietary origin", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=origin] option"),
    ];
    expect(options.map((o) => o.value)).toEqual(["", ...ORIGINS]);
  });

  // Uncategorised (null) is the default: the empty option is selected and no origin is claimed.
  it("defaults to the not-categorised (empty) option", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("");
  });

  // Choosing an origin announces it through `origin-changed` as the taxonomy token.
  it("emits origin-changed with the selected origin", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {});
    const seen = new Promise<CustomEvent<{ origin: DietaryOrigin | null }>>((resolve) =>
      el.addEventListener("origin-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await select(el, "meat");
    expect((await seen).detail.origin).toBe("meat");
  });

  // Choosing the empty option announces null (uncategorise), distinct from any origin token.
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

  // origin-changed must cross this widget's shadow boundary to reach the ingredient form, so it is
  // dispatched bubbles+composed — asserted so a future edit does not quietly drop either.
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

  // Edit-mode seeding: a passed `value` pre-selects that origin in the `<select>`.
  it("seeds the select from a passed value", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: "dairy",
    });
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("dairy");
  });

  // A null value seeds the not-categorised (empty) option — the uncategorised edit state.
  it("seeds the not-categorised option from a null value", async () => {
    const { el } = await mountWidget<DietaryOriginPicker>("dashboard-dietary-origin-picker", {
      value: null,
    });
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("");
  });

  // Each option carries its localised LABEL while keeping the raw taxonomy token as its wire value.
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
