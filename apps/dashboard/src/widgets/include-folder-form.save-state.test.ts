import { afterEach, expect, it, vi } from "vitest";
import type {
  IncludeFolder,
  IncludeFolderInput,
  Presentation,
} from "@waitron/catalogue/src/section-types.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./include-folder-form.js";

type Form = HTMLElementTagNameMap["dashboard-include-folder-form"];
afterEach(cleanupWidgets);

const own: Presentation = {
  names: { en: "Drinks", es: "Bebidas" },
  image: "own-photo",
  color: "#112233",
};
const stored: IncludeFolder = {
  showAsFolder: true,
  overrides: { names: { en: "Bar", es: "Barra" }, image: "folder-photo", color: "#aa3300" },
};

async function mount(value: IncludeFolder | null = stored): Promise<Form> {
  const { el } = await mountWidget<Form>("dashboard-include-folder-form", {
    open: true,
    menuName: "Drinks list",
    own,
    value,
    languages: { defaultLanguage: "en", languages: ["en", "es"] },
  });
  await el.updateComplete;
  return el;
}
const save = (el: Form) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
async function expectQuiet(el: Form) {
  await el.updateComplete;
  const button = save(el);
  await button.updateComplete;
  expect(button.disabled).toBe(true);
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  expect(button.getAttribute("variant")).toBe("secondary");
}
async function expectReady(el: Form) {
  await el.updateComplete;
  const button = save(el);
  await button.updateComplete;
  expect(button.disabled).toBe(false);
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(false);
  expect(button.getAttribute("variant")).toBe("primary");
}
const emit = (target: Element, name: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
function type(el: Form, name: string, value: string) {
  emit(el.shadowRoot!.querySelector(`wt-input[name="${name}"]`)!, "wt-change", { value });
}
function toggle(el: Form, checked: boolean) {
  emit(el.shadowRoot!.querySelector('wt-switch[name="show-as-folder"]')!, "wt-change", {
    checked,
  });
}

it("opens a stored folder with names, image and colour with Save quiet", async () => {
  await expectQuiet(await mount());
});

it("opens an include with no stored folder with Save quiet", async () => {
  await expectQuiet(await mount(null));
});

it("turning the switch off makes Save ready, and back on makes it quiet", async () => {
  const el = await mount();
  toggle(el, false);
  await expectReady(el);
  toggle(el, true);
  await expectQuiet(el);
});

it("goes quiet again when a typed name is typed back", async () => {
  const el = await mount();
  type(el, "names-es", "Bar de copas");
  await expectReady(el);
  type(el, "names-es", "Barra");
  await expectQuiet(el);
});

it("an untouched press sends nothing", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  save(el).click();
  await el.updateComplete;
  expect(submitted).not.toHaveBeenCalled();
  await expectQuiet(el);
});

it("keeps Save ready after a refusal that follows a changed press", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  type(el, "names-es", "Bar de copas");
  await el.updateComplete;
  save(el).click();
  expect(submitted).toHaveBeenCalledOnce();
  el.fieldErrors = { "names-es": "Check the Spanish name." };
  await el.updateComplete;
  await expectReady(el);
});

it("goes quiet when a save is committed with the form still open", async () => {
  const el = await mount();
  const submitted: IncludeFolderInput[] = [];
  el.addEventListener("wt-submit", (event) =>
    submitted.push((event as CustomEvent<IncludeFolderInput>).detail),
  );
  type(el, "names-es", "Bar de copas");
  await el.updateComplete;
  save(el).click();
  el.commitSaved(submitted[0]!);
  await expectQuiet(el);
});
