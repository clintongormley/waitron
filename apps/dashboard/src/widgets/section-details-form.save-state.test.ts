import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { SectionDetails, SectionInput } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./section-details-form.js";

type Form = HTMLElementTagNameMap["dashboard-section-details-form"];
afterEach(cleanupWidgets);

const stored: SectionDetails = {
  id: "drinks",
  internalName: "Drinks",
  names: { en: "Something to drink", es: "Bebidas" },
  image: "photo",
  color: "#aa3300",
  members: [],
};

async function mount(value: SectionDetails | null = stored): Promise<Form> {
  const { el } = await mountWidget<Form>("dashboard-section-details-form", {
    open: true,
    heading: "Section details",
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
function change(el: Form, name: string, value: string) {
  el.shadowRoot!.querySelector(`[name="${name}"]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
const field = (el: Form, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
async function innerInput(el: Form, name: string) {
  await field(el, name).updateComplete;
  return field(el, name).shadowRoot!.querySelector("input")!;
}

it("opens a stored section with every detail filled with Save quiet", async () => {
  await expectQuiet(await mount());
});

it("opens a create with nothing typed with Save quiet, and spaces alone change nothing", async () => {
  const el = await mount(null);
  await expectQuiet(el);
  change(el, "internalName", " ");
  await expectQuiet(el);
  change(el, "internalName", "Specials");
  await expectReady(el);
});

it.each([
  ["the internal name", (el: Form) => change(el, "internalName", "Bar")],
  ["a customer name", (el: Form) => change(el, "names-es", "Bebidas frías")],
  [
    "the colour",
    (el: Form) => el.shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click(),
  ],
  [
    "the image",
    (el: Form) =>
      el.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
        new CustomEvent("image-changed", {
          detail: { image: null },
          bubbles: true,
          composed: true,
        }),
      ),
  ],
])("one edit to %s makes Save ready", async (_label, edit) => {
  const el = await mount();
  edit(el);
  await expectReady(el);
});

it("goes quiet again when the stored name is typed back, spaces around it included", async () => {
  const el = await mount();
  change(el, "internalName", "Bar");
  await expectReady(el);
  change(el, "internalName", "Drinks");
  await expectQuiet(el);
  change(el, "internalName", "Bar");
  await expectReady(el);
  change(el, "internalName", " Drinks ");
  await expectQuiet(el);
});

it.each([
  ["a stored section", stored],
  ["a create with nothing typed", null],
])(
  "on %s neither an untouched press nor Enter sends anything or shows an error",
  async (_label, value) => {
    const el = await mount(value);
    const submitted = vi.fn();
    el.addEventListener("wt-submit", submitted);
    save(el).click();
    (await innerInput(el, "internalName")).focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(submitted).not.toHaveBeenCalled();
    expect(field(el, "internalName").error).toBeFalsy();
    await expectQuiet(el);
  },
);

it("Enter in a text field sends a changed form", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  change(el, "internalName", "Bar");
  await expectReady(el);
  (await innerInput(el, "internalName")).focus();
  await userEvent.keyboard("{Enter}");
  expect(submitted).toHaveBeenCalledOnce();
});

it("keeps a changed busy form primary and disables it, then allows retry", async () => {
  const el = await mount();
  change(el, "internalName", "Bar");
  await expectReady(el);
  el.busy = true;
  await el.updateComplete;
  const button = save(el);
  await button.updateComplete;
  expect([button.getAttribute("variant"), button.disabled]).toEqual(["primary", true]);
  el.busy = false;
  await expectReady(el);
});

it("keeps a changed form with an empty internal name primary and disabled after a press", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  change(el, "internalName", "");
  await expectReady(el);
  save(el).click();
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe(t("sections.internal_name_required"));
  const button = save(el);
  await button.updateComplete;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("variant")).toBe("primary");
  expect(submitted).not.toHaveBeenCalled();
});

it("keeps Save ready after a refusal that follows a changed press", async () => {
  const el = await mount();
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  change(el, "internalName", "Bar");
  await el.updateComplete;
  save(el).click();
  expect(submitted).toHaveBeenCalledOnce();
  el.fieldErrors = { internalName: codeMessage("menu_section.invalid") };
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe(codeMessage("menu_section.invalid"));
  await expectReady(el);
});

it("goes quiet when a save is committed with the form still open", async () => {
  const el = await mount();
  const submitted: SectionInput[] = [];
  el.addEventListener("wt-submit", (event) =>
    submitted.push((event as CustomEvent<SectionInput>).detail),
  );
  change(el, "internalName", "Bar");
  await el.updateComplete;
  save(el).click();
  el.commitSaved(submitted[0]!);
  await expectQuiet(el);
});
