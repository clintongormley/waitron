import { t } from "../i18n/t.js";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { IncludeFolder, Presentation } from "@waitron/catalogue/src/section-types.js";
import "./include-folder-form.js";
afterEach(cleanupWidgets);

type Form = HTMLElementTagNameMap["dashboard-include-folder-form"];
const own: Presentation = {
  names: { en: "Drinks", es: "Bebidas" },
  image: "own-photo",
  color: "#112233",
};
const stored: IncludeFolder = {
  showAsFolder: true,
  overrides: { names: { en: "Bar" }, image: "folder-photo" },
};
async function includeForm(props: Partial<Form> = {}) {
  const { el } = await mountWidget<Form>("dashboard-include-folder-form", {
    open: true,
    menuName: "Drinks list",
    own,
    value: stored,
    languages: { defaultLanguage: "en", languages: ["en", "es"] },
    ...props,
  });
  return el;
}
const field = (el: Form, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name="${name}"]`);
const switchOf = (el: Form) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    'wt-switch[name="show-as-folder"]',
  )!;
const colorInput = (el: Form) =>
  el.shadowRoot!.querySelector<HTMLInputElement>('input[name="include-color"]');
const uploadOf = (el: Form) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-image-upload"]>(
    "dashboard-image-upload",
  );
const bottomOf = (el: Form) =>
  el.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim();
const emit = (target: Element, name: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
async function type(el: Form, name: string, value: string) {
  emit(field(el, name)!, "wt-change", { value });
  await el.updateComplete;
}
async function toggle(el: Form, checked: boolean) {
  emit(switchOf(el), "wt-change", { checked });
  await el.updateComplete;
}
function submitted(el: Form) {
  const listener = vi.fn();
  el.addEventListener("wt-submit", listener);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  expect(listener).toHaveBeenCalledOnce();
  return (listener.mock.calls[0]![0] as CustomEvent).detail as unknown;
}

it("opens with the switch on and every field filled with the folder's current values", async () => {
  const el = await includeForm();
  expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe(
    t("menus.include_edit_heading").replace("{name}", "Drinks list"),
  );
  expect(switchOf(el).checked).toBe(true);
  expect(switchOf(el).label).toBe(t("menus.include_show_as_folder"));
  expect(switchOf(el).description).toBe(t("menus.include_direct_hint"));
  expect(field(el, "names-en")!.value).toBe("Bar");
  expect(field(el, "names-es")!.value).toBe("Bebidas");
  expect(colorInput(el)!.value).toBe("#112233");
  expect(uploadOf(el)!.image).toBe("folder-photo");
});
it("opens with the switch off for an include shown directly, and follows the included menu while it has no setting", async () => {
  const off = await includeForm({ value: { showAsFolder: false, overrides: {} } });
  expect(switchOf(off).checked).toBe(false);
  expect(field(off, "names-en")).toBeNull();
  cleanupWidgets();
  const following = await includeForm({ value: null });
  expect(switchOf(following).checked).toBe(true);
  expect(field(following, "names-en")!.value).toBe("Drinks");
  expect(uploadOf(following)!.image).toBe("own-photo");
});
it("switching off hides the names, colour and photo, and switching on shows the values again", async () => {
  const el = await includeForm();
  await type(el, "names-es", "Barra");
  await toggle(el, false);
  expect(field(el, "names-en")).toBeNull();
  expect(field(el, "names-es")).toBeNull();
  expect(colorInput(el)).toBeNull();
  expect(uploadOf(el)).toBeNull();
  await toggle(el, true);
  expect(field(el, "names-en")!.value).toBe("Bar");
  expect(field(el, "names-es")!.value).toBe("Barra");
  expect(colorInput(el)!.value).toBe("#112233");
  expect(uploadOf(el)!.image).toBe("folder-photo");
});
it("submits only the switch when it is off", async () => {
  const el = await includeForm();
  await type(el, "names-es", "Barra");
  await toggle(el, false);
  expect(submitted(el)).toEqual({ showAsFolder: false });
});
it("submits only the fields that differ from the included menu", async () => {
  const el = await includeForm({
    value: { showAsFolder: true, overrides: { names: { en: "Bar" } } },
  });
  await type(el, "names-es", "Barra");
  expect(submitted(el)).toEqual({
    showAsFolder: true,
    overrides: { names: { en: "Bar", es: "Barra" } },
  });
  await type(el, "names-en", "Drinks");
  expect(submitted(el)).toEqual({ showAsFolder: true, overrides: { names: { es: "Barra" } } });
  emit(uploadOf(el)!, "image-changed", { image: null });
  el.shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click();
  await el.updateComplete;
  expect(submitted(el)).toEqual({
    showAsFolder: true,
    overrides: { names: { es: "Barra" }, image: null, color: "#256bb1" },
  });
});
it("keeps a fixed name in a language the form does not show", async () => {
  const el = await includeForm({
    value: { showAsFolder: true, overrides: { names: { en: "Bar", fr: "Boissons" } } },
  });
  expect(submitted(el)).toEqual({
    showAsFolder: true,
    overrides: { names: { en: "Bar", fr: "Boissons" } },
  });
});
it("hints a blank name with the default language's name, then the included menu's name", async () => {
  const el = await includeForm({ value: null, own: { names: {}, image: null, color: null } });
  expect(field(el, "names-en")!.placeholder).toBe("Drinks list");
  expect(field(el, "names-es")!.placeholder).toBe("Drinks list");
  await type(el, "names-en", "Bar");
  expect(field(el, "names-es")!.placeholder).toBe("Bar");
});
it.each([
  [{ "names-en": "Check the English name." }, "names-en"],
  [{ color: "Choose another colour." }, "color"],
  [{ image: "Choose another photo." }, "image"],
])(
  "shows a refusal beside the field it names and in one message at the bottom (%o)",
  async (fieldErrors, key) => {
    const el = await includeForm();
    el.fieldErrors = fieldErrors;
    await el.updateComplete;
    const message = Object.values(fieldErrors)[0]!;
    if (key === "names-en") expect(field(el, "names-en")!.error).toBe(message);
    if (key === "color")
      expect(el.shadowRoot!.querySelector("#include-color-error")!.textContent!.trim()).toBe(
        message,
      );
    if (key === "image") {
      expect(el.shadowRoot!.querySelector("#include-image-error")!.textContent!.trim()).toBe(
        message,
      );
      expect(uploadOf(el)!.invalid).toBe(true);
    }
    expect(bottomOf(el)).toBe(t("form.fix_fields"));
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
    expect(save.disabled).toBe(false);
  },
);
it("clears a field's refusal when that field changes, and every refusal on the next submission", async () => {
  const el = await includeForm();
  el.fieldErrors = { "names-en": "Check the English name.", color: "Choose another colour." };
  await el.updateComplete;
  await type(el, "names-en", "Bar counter");
  expect(field(el, "names-en")!.error).toBe("");
  expect(el.shadowRoot!.querySelector("#include-color-error")!.textContent!.trim()).toBe(
    "Choose another colour.",
  );
  submitted(el);
  await el.updateComplete;
  expect(bottomOf(el)).toBe("");
});
it("puts a refusal for a field it does not show in the bottom message", async () => {
  const el = await includeForm({ value: { showAsFolder: false, overrides: {} } });
  el.fieldErrors = { "names-en": "Check the English name." };
  await el.updateComplete;
  expect(bottomOf(el)).toBe("Check the English name.");
});
it("every input has a semantic name", async () => {
  const el = await includeForm();
  expect(switchOf(el)).not.toBeNull();
  expect(field(el, "names-en")).not.toBeNull();
  expect(field(el, "names-es")).not.toBeNull();
  expect(colorInput(el)).not.toBeNull();
  expect(uploadOf(el)!.getAttribute("name")).toBe("include-image");
  const names = [...el.shadowRoot!.querySelectorAll("[name]")].map((node) =>
    node.getAttribute("name"),
  );
  expect(names.filter((name) => !name || /wt-/.test(name))).toEqual([]);
});
it("emits wt-cancel from Cancel when nothing changed, and blocks Save and closing while busy", async () => {
  const el = await includeForm();
  const cancelled = vi.fn();
  el.addEventListener("wt-cancel", () => {
    cancelled();
    el.open = false;
  });
  el.busy = true;
  await el.updateComplete;
  expect(switchOf(el).disabled).toBe(true);
  expect(field(el, "names-en")!.disabled).toBe(true);
  const listener = vi.fn();
  el.addEventListener("wt-submit", listener);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  emit(el.shadowRoot!.querySelector("wt-modal")!, "wt-close", {});
  expect(listener).not.toHaveBeenCalled();
  expect(cancelled).not.toHaveBeenCalled();
  el.busy = false;
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
});
it("keeps the dialog open while its photo picker is open", async () => {
  const el = await includeForm();
  const cancelled = vi.fn();
  el.addEventListener("wt-cancel", cancelled);
  emit(uploadOf(el)!, "image-picker-state", { open: true });
  await el.updateComplete;
  emit(el.shadowRoot!.querySelector("wt-modal")!, "wt-close", {});
  await el.updateComplete;
  expect(cancelled).not.toHaveBeenCalled();
  expect(el.open).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!
      .disabled,
  ).toBe(true);
});
