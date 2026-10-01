import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./section-details-form.js";
afterEach(cleanupWidgets);
it("marks the required internal name and refuses a blank submission", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    { open: true },
  );
  const save = vi.fn();
  el.addEventListener("wt-submit", save);
  const field = el.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="internalName"]',
  );
  expect(field?.required).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(field!.error).not.toBe("");
  expect(save).not.toHaveBeenCalled();
});
it("puts a Spanish translation refusal under the Spanish field and other refusals below the fields", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    {
      open: true,
      languages: { defaultLanguage: "en", languages: ["en", "es"] },
      refusal: {
        code: "menu_section.translation_required",
        params: { field: "names", language: "es" },
      },
    },
  );
  const spanish =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="names-es"]')!;
  expect(spanish.error).not.toBe("");
  el.refusal = { code: "management.request_invalid" };
  await el.updateComplete;
  const bottom = el.shadowRoot!.querySelector('[data-test="form-error"]')!;
  expect(bottom.textContent?.trim()).not.toBe("");
  expect(bottom.closest('[slot="footer"]')).toBeNull();
});
it("preserves the draft across refusals and submits all details on Enter", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    {
      open: true,
      heading: "Edit Starters",
      languages: { defaultLanguage: "en", languages: ["en", "es"] },
      value: {
        id: "s",
        internalName: "Starters",
        names: { en: "To begin", es: "Para empezar" },
        image: "photo",
        color: "#aa3300",
        members: [],
      },
    },
  );
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  const internal =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="internalName"]')!;
  internal.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: " First courses " },
      bubbles: true,
      composed: true,
    }),
  );
  el.fieldErrors = { image: "Choose another image." };
  await el.updateComplete;
  expect(internal.value).toBe(" First courses ");
  await internal.updateComplete;
  internal
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(() => expect(submitted).toHaveBeenCalledOnce());
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    internalName: "First courses",
    names: { en: "To begin", es: "Para empezar" },
    image: "photo",
    color: "#aa3300",
  });
});
