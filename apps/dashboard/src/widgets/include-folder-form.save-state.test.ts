import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
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

it.each([
  [
    "a palette colour",
    (el: Form) => el.shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click(),
  ],
  [
    "a custom colour",
    (el: Form) => {
      const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="include-color"]')!;
      input.value = "#123456";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    },
  ],
  [
    "the photo",
    (el: Form) =>
      emit(el.shadowRoot!.querySelector("dashboard-image-upload")!, "image-changed", {
        image: null,
      }),
  ],
])("one edit to %s makes Save ready", async (_label, edit) => {
  const el = await mount();
  edit(el);
  await expectReady(el);
});

it("keeps a changed busy form primary and disables it, then allows retry", async () => {
  const el = await mount();
  type(el, "names-es", "Bar de copas");
  await expectReady(el);
  el.busy = true;
  await el.updateComplete;
  const button = save(el);
  await button.updateComplete;
  expect([button.getAttribute("variant"), button.disabled]).toEqual(["primary", true]);
  el.busy = false;
  await expectReady(el);
});

const nameInput = async (el: Form, name: string) => {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
  await field.updateComplete;
  return field.shadowRoot!.querySelector("input")!;
};

it("on an untouched form neither a press nor Enter in a name field sends anything", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  save(el).click();
  (await nameInput(el, "names-es")).focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(submitted).not.toHaveBeenCalled();
  await expectQuiet(el);
});

it("Enter in a name field sends a changed form", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  type(el, "names-es", "Bar de copas");
  await expectReady(el);
  (await nameInput(el, "names-es")).focus();
  await userEvent.keyboard("{Enter}");
  expect(submitted).toHaveBeenCalledOnce();
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
