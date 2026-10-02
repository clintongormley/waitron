import { commands, page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-option-list-form`.
import { OptionListForm } from "./option-list-form.js";
import type { OptionLabelForm } from "./option-label-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RARE = "11111111-1111-4111-8111-111111111111";
const MEDIUM = "22222222-2222-4222-8222-222222222222";
const WELL = "55555555-5555-4555-8555-555555555555";

/**
 * The three names read DIFFERENTLY everywhere in this fixture (CLAUDE.md §3): a surface that shows
 * the staff name where the customer name belongs fails instead of passing by coincidence.
 */
const cooked: OptionList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cooked",
  customerName: { en: "How would you like it?", es: "¿En qué punto?" },
  kitchenName: "COOK",
  defaultLabelId: MEDIUM,
  active: true,
  labels: [
    {
      id: RARE,
      name: "Rare",
      customerName: { en: "Barely cooked", es: "Poco hecho" },
      kitchenName: "R",
      available: true,
    },
    {
      id: MEDIUM,
      name: "Medium",
      customerName: { en: "Pink in the middle", es: "Al punto" },
      kitchenName: "M",
      available: true,
    },
  ],
};

const wellDone = {
  id: WELL,
  name: "Well done",
  customerName: {},
  kitchenName: "W",
  available: true,
};

const languages = { defaultLanguage: "en", languages: ["en", "es"] };

async function mount(props: Partial<OptionListForm> = {}) {
  return mountWidget<OptionListForm>("dashboard-option-list-form", {
    open: true,
    languages,
    ...props,
  });
}

function field<T extends Element = HTMLElementTagNameMap["wt-input"]>(
  el: OptionListForm | OptionLabelForm,
  name: string,
): T {
  return el.shadowRoot!.querySelector<T>(`[name="${name}"]`)!;
}

/** Type into a `wt-input` the way the primitive announces a change. */
async function type(el: OptionListForm | OptionLabelForm, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Flip a `wt-switch` the way the primitive announces a change. */
async function toggle(el: OptionListForm | OptionLabelForm, name: string, checked: boolean) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: OptionListForm | OptionLabelForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

async function bottomOf(el: OptionListForm): Promise<string> {
  const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
    "wt-modal wt-form-actions",
  )!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const saveOf = (el: OptionListForm): HTMLElementTagNameMap["wt-button"] =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('wt-modal [data-test="save"]')!;

function editor(el: OptionListForm): OptionLabelForm {
  return el.shadowRoot!.querySelector<OptionLabelForm>("dashboard-option-label-form")!;
}

/** Opens the option editor from a row's Edit action, or empty from Add option. */
async function openEditor(el: OptionListForm, index: number | "new"): Promise<OptionLabelForm> {
  await click(el, index === "new" ? "add-option" : `edit-label-${index}`);
  await editor(el).updateComplete;
  return editor(el);
}

async function saveEditor(el: OptionListForm): Promise<void> {
  await click(editor(el), "save");
  await el.updateComplete;
}

/** Adds an option through the editor, as the operator does. */
async function addOption(
  el: OptionListForm,
  name: string,
  fill?: (form: OptionLabelForm) => Promise<void>,
) {
  const form = await openEditor(el, "new");
  await type(form, "label-name", name);
  if (fill) await fill(form);
  await saveEditor(el);
}

/** Edits one option through its row's editor. */
async function editOption(
  el: OptionListForm,
  index: number,
  fill: (form: OptionLabelForm) => Promise<void>,
) {
  const form = await openEditor(el, index);
  await fill(form);
  await saveEditor(el);
}

function text(el: OptionListForm, testId: string): string {
  return el.shadowRoot!.querySelector(`[data-test="${testId}"]`)!.textContent!.trim();
}

function rowErrors(el: OptionListForm, index: number): string[] {
  return [...el.shadowRoot!.querySelectorAll(`[data-test="label-${index}-error"]`)].map((node) =>
    node.textContent!.trim(),
  );
}

function radio(el: OptionListForm, index: number): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test="label-${index}-default"]`)!;
}

function checkedDefault(el: OptionListForm): number[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    .map((input, index) => (input.checked ? index : -1))
    .filter((index) => index >= 0);
}

/** Counts submissions as well as capturing the last one: a composed event re-emitted without
 * stopping the original arrives twice, and a single-shot listener cannot see that. */
function record(host: HTMLElement) {
  const seen: OptionListInput[] = [];
  host.addEventListener("wt-submit", (event) => {
    seen.push((event as CustomEvent<{ value: OptionListInput }>).detail.value);
  });
  return seen;
}

it("submits a new list once, minting an id for every option so a brand-new one can be the default", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Cooked");
  await type(el, "customer-name-en", "How would you like it?");
  await type(el, "customer-name-es", "¿En qué punto?");
  await type(el, "kitchen-name", "COOK");
  await addOption(el, "Rare", async (form) => {
    await type(form, "label-customer-name-en", "Barely cooked");
    await type(form, "label-kitchen-name", "R");
  });
  await addOption(el, "Medium", async (form) => {
    await type(form, "label-customer-name-es", "Al punto");
    await type(form, "label-kitchen-name", "M");
  });
  await click(el, "label-1-default");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  const value = submitted[0]!;
  expect(value.labels.map((label) => label.id)).toEqual([
    expect.stringMatching(UUID),
    expect.stringMatching(UUID),
  ]);
  expect(value.defaultLabelId).toBe(value.labels[1]!.id);
  expect(value).toEqual({
    name: "Cooked",
    customerName: { en: "How would you like it?", es: "¿En qué punto?" },
    kitchenName: "COOK",
    active: true,
    defaultLabelId: value.labels[1]!.id,
    labels: [
      {
        id: value.labels[0]!.id,
        name: "Rare",
        customerName: { en: "Barely cooked" },
        kitchenName: "R",
        available: true,
      },
      {
        id: value.labels[1]!.id,
        name: "Medium",
        customerName: { es: "Al punto" },
        kitchenName: "M",
        available: true,
      },
    ],
  });
});

it("submits an edit under the ids it was given, keeping the names it did not touch", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => type(form, "label-kitchen-name", "RR"));
  await toggle(el, "active", false);
  await click(el, "save");

  expect(submitted).toEqual([
    {
      name: "Cooked",
      customerName: cooked.customerName,
      kitchenName: "COOK",
      active: false,
      defaultLabelId: MEDIUM,
      labels: [{ ...cooked.labels[0]!, kitchenName: "RR" }, { ...cooked.labels[1]! }],
    },
  ]);
});

it("refuses an active list with no available option itself, beside the options and in the bottom message", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await editOption(el, 1, (form) => toggle(form, "label-available", false));
  await click(el, "save");

  expect(submitted).toEqual([]);
  const message = t("options.labels_required");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')!.textContent).toContain(
    message,
  );
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  await toggle(el, "active", false);
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.active).toBe(false);
});

it("refuses a list with no staff name, beside the name field and in the bottom message", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await addOption(el, "Rare");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field(el, "name").error).toBe(t("options.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
});

it("shows each option as text with a Default radio, an Unavailable lozenge only when it is off, and a menu of actions", async () => {
  const { el } = await mount({
    value: { ...cooked, labels: [...cooked.labels, { ...wellDone, available: false }] },
  });

  expect(el.shadowRoot!.querySelector(".table-wrap")!.getAttribute("aria-label")).toBe(
    t("options.list_options"),
  );
  const rows = [...el.shadowRoot!.querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(row.querySelector("wt-input")).toBeNull();
  expect([0, 1, 2].map((index) => text(el, `label-${index}-name`))).toEqual([
    "Rare",
    "Medium",
    "Well done",
  ]);
  expect(
    [0, 1, 2].map(
      (index) =>
        el.shadowRoot!.querySelector(`[data-test="label-${index}-unavailable"]`)?.tagName ?? null,
    ),
  ).toEqual([null, null, "WT-LOZENGE"]);
  expect(text(el, "label-2-unavailable")).toBe(t("options.unavailable"));
  expect(checkedDefault(el)).toEqual([1]);
  expect(radio(el, 2).disabled).toBe(true);
  expect(radio(el, 0).getAttribute("aria-label")).toBe(`${t("options.default")}: Rare`);

  const actions = rows[0]!.querySelector("wt-row-actions")!;
  expect(actions.label).toBe(`${t("options.option_actions")}: Rare`);
  expect(
    [...actions.querySelectorAll("wt-button")].map((button) => [
      button.dataset.test,
      button.textContent!.trim(),
    ]),
  ).toEqual([
    ["edit-label-0", t("action.edit")],
    ["remove-label-0", t("action.delete")],
  ]);
});

it("folds the list's customer-facing names into a closed section that lists them", async () => {
  const { el } = await mount({ value: { ...cooked, customerName: { es: "¿En qué punto?" } } });
  const section = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;

  expect(section.tagName).toBe("WT-DISCLOSURE");
  expect(section.open).toBe(false);
  expect(section.heading).toBe(t("options.customer_names"));
  for (const name of ["customer-name-en", "customer-name-es"])
    expect(field(el, name).closest("wt-disclosure"), name).toBe(section);
  expect(field(el, "name").closest("wt-disclosure")).toBeNull();
  expect(section.summary).toBe("ES ¿En qué punto?");
  await type(el, "customer-name-en", "How would you like it?");
  expect(section.summary).toBe("EN How would you like it? · ES ¿En qué punto?");
});

it.each([
  ["customerName", true],
  ["kitchenName", false],
  ["name", false],
])("opens the list's names section when the server refuses %s: %s", async (path, opened) => {
  const { el } = await mount({ value: cooked, fieldErrors: { [path]: "Refused." } });
  const section = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;
  await section.updateComplete;
  expect({ hasError: section.hasError, open: section.open }).toEqual({
    hasError: opened,
    open: opened,
  });
});

const namesSection = (el: OptionListForm) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;

it("draws the kitchen name as its own field directly under Name, shown while the names section is closed", async () => {
  const { el } = await mount({ value: cooked });
  const kitchen = field(el, "kitchen-name");

  expect(namesSection(el).open).toBe(false);
  expect(kitchen.closest("wt-disclosure")).toBeNull();
  expect(field(el, "name").nextElementSibling).toBe(kitchen);
  expect(kitchen.checkVisibility()).toBe(true);
  expect(kitchen.value).toBe("COOK");
});

it.each([
  ["en", "Customer-facing names"],
  ["es", "Nombres para el cliente"],
])("heads the folded section with the customer-facing names alone (%s)", async (locale, words) => {
  setLocale(locale);
  try {
    const { el } = await mount({ value: cooked });
    expect(namesSection(el).heading).toBe(words);
  } finally {
    setLocale("en");
  }
});

it("hints each blank name with what it falls back to, following the fields it copies as they are typed", async () => {
  const { el } = await mount({ value: { ...cooked, customerName: {}, kitchenName: null } });
  const hints = () =>
    ["kitchen-name", "customer-name-en", "customer-name-es"].map(
      (name) => field(el, name).placeholder,
    );

  expect(hints()).toEqual(["Cooked", "Cooked", "Cooked"]);
  await type(el, "customer-name-en", "How would you like it?");
  expect(hints()).toEqual(["Cooked", "Cooked", "How would you like it?"]);
  await type(el, "name", "Doneness");
  expect(hints()).toEqual(["Doneness", "Doneness", "How would you like it?"]);
  await type(el, "customer-name-en", "");
  expect(hints()).toEqual(["Doneness", "Doneness", "Doneness"]);
});

it("never hints a customer-facing name with the kitchen name, which keeps its own text", async () => {
  const { el } = await mount({ value: { ...cooked, customerName: {} } });
  const hints = () =>
    ["customer-name-en", "customer-name-es"].map((name) => field(el, name).placeholder);

  expect(field(el, "kitchen-name").value).toBe("COOK");
  expect(hints()).toEqual(["Cooked", "Cooked"]);
  await type(el, "customer-name-en", "How would you like it?");
  expect(hints()).toEqual(["Cooked", "How would you like it?"]);
  await type(el, "kitchen-name", "STEAK");
  expect(field(el, "kitchen-name").value).toBe("STEAK");
  expect(hints()).toEqual(["Cooked", "How would you like it?"]);
});

it("lists the customer-facing names in the closed section's line, but not the kitchen name", async () => {
  const { el } = await mount({ value: cooked });

  expect(namesSection(el).summary).toBe("EN How would you like it? · ES ¿En qué punto?");
});

it("shows a kitchen-name refusal under the kitchen field without marking the names section", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { kitchenName: "Too long." } });
  await namesSection(el).updateComplete;

  expect(field(el, "kitchen-name").error).toBe("Too long.");
  expect({ hasError: namesSection(el).hasError, open: namesSection(el).open }).toEqual({
    hasError: false,
    open: false,
  });
});

it("focuses the kitchen field when a refusal naming it arrives, leaving the names section closed", async () => {
  const { el } = await mount({ value: cooked });
  el.fieldErrors = { kitchenName: "Too long." };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  expect(namesSection(el).open).toBe(false);
  expect(field(el, "kitchen-name").shadowRoot!.activeElement).toBe(
    field(el, "kitchen-name").shadowRoot!.querySelector("input"),
  );
});

it("opens the option editor empty from Add option, and its Save appends the option", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  const add = el.shadowRoot!.querySelector('[data-test="add-option"]')!;
  expect(add.textContent!.trim()).toBe(t("options.add_option"));
  expect(editor(el).open).toBe(false);
  const form = await openEditor(el, "new");
  expect(form.open).toBe(true);
  expect(form.value).toBeNull();
  expect(form.languages).toEqual(languages);
  await type(form, "label-name", "Well done");
  await saveEditor(el);

  expect(form.open).toBe(false);
  expect(submitted).toEqual([]);
  expect(text(el, "label-2-name")).toBe("Well done");
  await click(el, "save");
  expect(submitted[0]!.labels.map((label) => label.name)).toEqual(["Rare", "Medium", "Well done"]);
});

it("opens the option editor on a row's option, and its Save replaces that row without sending the list", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  const form = await openEditor(el, 1);
  expect(form.open).toBe(true);
  expect(form.value).toEqual({ ...cooked.labels[1]!, kitchenName: "M" });
  expect(form.errors).toEqual({});
  await type(form, "label-name", "Medium rare");
  await saveEditor(el);

  expect(submitted).toEqual([]);
  expect(form.open).toBe(false);
  expect(text(el, "label-1-name")).toBe("Medium rare");
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(2);
  await click(el, "save");
  expect(submitted[0]!.labels.map((label) => [label.id, label.name])).toEqual([
    [RARE, "Rare"],
    [MEDIUM, "Medium rare"],
  ]);
});

/** The control an option's name is drawn in, which opens that option's editor. */
function nameButton(el: OptionListForm, index: number): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-test="open-label-${index}"]`)!;
}

it("opens the option editor on an option when its name is clicked", async () => {
  const { el } = await mount({ value: cooked });

  await userEvent.click(el.shadowRoot!.querySelector('[data-test="label-1-name"]')!);
  await el.updateComplete;
  await editor(el).updateComplete;

  expect(editor(el).open).toBe(true);
  expect(editor(el).value).toEqual({ ...cooked.labels[1]!, kitchenName: "M" });
  expect(field(editor(el), "label-name").value).toBe("Medium");
});

it("draws an option's name as a button that says it edits that option", async () => {
  const { el } = await mount({ value: cooked });
  const button = nameButton(el, 0);

  expect(button.tagName).toBe("BUTTON");
  expect(button.type).toBe("button");
  expect(button.getAttribute("aria-label")).toBe(`${t("options.edit_option")}: Rare`);
  expect(button.contains(el.shadowRoot!.querySelector('[data-test="label-0-name"]'))).toBe(true);
});

it("draws the name button as the name's text, a full tap target even for a one-letter name, dimming on hover, with the keyboard focus ring from tokens", async () => {
  const { el, host } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, name: "S" }, cooked.labels[1]!] },
  });
  host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-font-size-md", "17px");
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(4, 5, 6)");
  host.style.setProperty("--wt-focus-offset", "5px");
  const button = nameButton(el, 0);

  const style = getComputedStyle(button);
  expect(style.color).toBe("rgb(1, 2, 3)");
  expect(style.fontSize).toBe("17px");
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(style.borderTopWidth).toBe("0px");
  expect(style.cursor).toBe("pointer");
  host.style.setProperty("--wt-tap-min", "52px");
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(52);

  host.style.setProperty("--wt-opacity-hover", "0.6");
  expect(getComputedStyle(button).opacity).toBe("1");
  await userEvent.hover(button);
  expect(getComputedStyle(button).opacity).toBe("0.6");
  await commands.parkPointer();
  expect(getComputedStyle(button).opacity).toBe("1");

  await userEvent.keyboard("{Tab}");
  button.focus();
  expect(button.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(button).outlineColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(button).outlineWidth).toBe("3px");
  expect(getComputedStyle(button).outlineOffset).toBe("5px");
});

it.each(["{Enter}", " "])(
  "opens the option editor from the keyboard on the name: %s",
  async (key) => {
    const { el } = await mount({ value: cooked });

    nameButton(el, 0).focus();
    await userEvent.keyboard(key);
    await el.updateComplete;
    await editor(el).updateComplete;

    expect(editor(el).open).toBe(true);
    expect(editor(el).value).toEqual({ ...cooked.labels[0]!, kitchenName: "R" });
  },
);

it("keeps the Default radio's click to itself: it chooses the default and opens no editor", async () => {
  const { el } = await mount({ value: cooked });

  await userEvent.click(radio(el, 0));
  await el.updateComplete;

  expect(checkedDefault(el)).toEqual([0]);
  expect(editor(el).open).toBe(false);
});

it("changes nothing when the option editor is cancelled", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  const form = await openEditor(el, 0);
  await type(form, "label-name", "Changed");
  await click(form, "cancel");
  await el.updateComplete;

  expect(form.open).toBe(false);
  // The editor's own cancel is the list's business, not the screen's: the list stays open.
  expect(cancels).toBe(0);
  expect(text(el, "label-0-name")).toBe("Rare");
  await click(el, "save");
  expect(submitted[0]!.labels[0]!.name).toBe("Rare");
});

it("offers no Clear default: an available option is always the default", async () => {
  const { el } = await mount({ value: cooked });
  expect(el.shadowRoot!.querySelector('[data-test="clear-default"]')).toBeNull();
  expect(checkedDefault(el)).toEqual([1]);
});

it("makes a new list's first option its default", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Cooked");
  await addOption(el, "Rare");
  await addOption(el, "Medium");
  expect(checkedDefault(el)).toEqual([0]);
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(submitted[0]!.labels[0]!.id);
});

it("makes a newly added option the default when no option was available", async () => {
  const { el, host } = await mount({
    value: {
      ...cooked,
      active: false,
      defaultLabelId: null,
      labels: [{ ...cooked.labels[0]!, available: false }],
    },
  });
  const submitted = record(host);
  expect(checkedDefault(el)).toEqual([]);

  await addOption(el, "Medium");
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(submitted[0]!.labels[1]!.id);
});

it("moves the default to the first available option when the default option is removed", async () => {
  const { el, host } = await mount({
    value: {
      ...cooked,
      defaultLabelId: WELL,
      labels: [{ ...cooked.labels[0]!, available: false }, cooked.labels[1]!, wellDone],
    },
  });
  const submitted = record(host);

  await click(el, "remove-label-2");
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE, MEDIUM]);
  expect(submitted[0]!.defaultLabelId).toBe(MEDIUM);
});

it("moves the default to the first available option when the option editor switches it off", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 1, (form) => toggle(form, "label-available", false));
  expect(checkedDefault(el)).toEqual([0]);
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(RARE);
  expect(await bottomOf(el)).toBe("");
});

it("keeps the chosen default when another option is switched off", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(MEDIUM);
});

it("leaves no default once the last available option is removed", async () => {
  const { el, host } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, available: false }, cooked.labels[1]!] },
  });
  const submitted = record(host);

  await click(el, "remove-label-1");
  await toggle(el, "active", false);
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE]);
  expect(submitted[0]!.defaultLabelId).toBeNull();
});

it("opens a list whose stored default is empty with the default the server would store", async () => {
  const { el, host } = await mount({ value: { ...cooked, defaultLabelId: null } });
  const submitted = record(host);

  expect(checkedDefault(el)).toEqual([0]);
  await click(el, "save");
  expect(submitted[0]!.defaultLabelId).toBe(RARE);
});

it("opens a list whose default is unavailable on the first available option, not as an error", async () => {
  const withdrawn: OptionList = {
    ...cooked,
    labels: [cooked.labels[0]!, { ...cooked.labels[1]!, available: false }],
  };
  const { el, host } = await mount({ value: withdrawn });
  const submitted = record(host);

  expect(radio(el, 1).checked).toBe(false);
  expect(radio(el, 1).disabled).toBe(true);
  expect(radio(el, 0).checked).toBe(true);
  expect(await bottomOf(el)).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();

  await click(el, "save");
  expect(submitted[0]!.defaultLabelId).toBe(RARE);
});

it("shows a refusal naming an option's field under its row, and beside the field in its editor", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: { kitchenName: "Too long for the kitchen.", "labels.1.name": "Already used." },
  });

  expect(field(el, "kitchen-name").error).toBe("Too long for the kitchen.");
  expect(rowErrors(el, 1)).toEqual(["Already used."]);
  expect(rowErrors(el, 0)).toEqual([]);
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).disabled).toBe(false);

  const form = await openEditor(el, 1);
  expect(form.errors).toEqual({ "label-name": "Already used." });
  expect(field(form, "label-name").error).toBe("Already used.");
  await click(form, "cancel");
  const other = await openEditor(el, 0);
  expect(other.errors).toEqual({});
});

it("keeps a rejected option's message on that option after it is moved", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });
  // A refusal takes focus when it arrives; let it land before the handle is focused.
  await new Promise((resolve) => setTimeout(resolve));

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${MEDIUM}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;

  expect(rowErrors(el, 0)).toEqual(["Already used."]);
  expect(rowErrors(el, 1)).toEqual([]);
  expect((await openEditor(el, 0)).errors).toEqual({ "label-name": "Already used." });
});

it("submits the options in the order the operator moved them into", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${RARE}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([MEDIUM, RARE]);
  expect(submitted[0]!.labels.map((label) => label.name)).toEqual(["Medium", "Rare"]);
});

it("removes an option, and the list it submits no longer carries it", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await click(el, "remove-label-1");
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE]);
  expect(submitted[0]!.defaultLabelId).toBe(RARE);
});

it("emits one wt-cancel, and neither event while it is saving", async () => {
  const { el, host } = await mount({ value: cooked, busy: true });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);
  const submitted = record(host);

  await click(el, "cancel");
  await click(el, "save");
  expect(cancels).toBe(0);
  expect(submitted).toEqual([]);

  el.busy = false;
  await el.updateComplete;
  await click(el, "cancel");
  expect(cancels).toBe(1);
});

it("sends one wt-cancel when the dialog reports its close after the form has been closed", async () => {
  const { el, host } = await mount({ value: cooked });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  await click(el, "cancel");
  el.open = false;
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await closeReportsDelivered();

  expect(cancels).toBe(1);
});

it("sends one wt-cancel when its dialog is dismissed with Escape while the form is open", async () => {
  const { el, host } = await mount({ value: cooked });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(cancels).toBe(1));
  await closeReportsDelivered();

  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  expect(cancels).toBe(1);
});

it("paints its own error text with the danger token and keeps the row controls tappable", async () => {
  const { el, host } = await mount({ value: cooked });
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-tap-min", "44px");

  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await editOption(el, 1, (form) => toggle(form, "label-available", false));
  await click(el, "save");
  // After the option saves above, which clear a refusal held for the option they save.
  el.fieldErrors = { "labels.0.name": "Already used." };
  await el.updateComplete;

  for (const testId of ["labels-error", "label-0-error"]) {
    const error = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!;
    expect({ testId, color: getComputedStyle(error).color }).toEqual({
      testId,
      color: "rgb(13, 14, 15)",
    });
  }

  const actions = el
    .shadowRoot!.querySelector("wt-row-actions")!
    .shadowRoot!.querySelector("button")!;
  for (const [testId, box] of [
    [`drag-${RARE}`, el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${RARE}"]`)!],
    ["label-0-pick", el.shadowRoot!.querySelector<HTMLElement>('[data-test="label-0-pick"]')!],
    ["actions", actions],
  ] as const) {
    const { width, height } = box.getBoundingClientRect();
    expect({ testId, width: width >= 44, height: height >= 44 }).toEqual({
      testId,
      width: true,
      height: true,
    });
  }
});

/**
 * The preselect control is a native radio, so the user agent draws its CHECKED dot and only
 * `accent-color` hands that drawing the brand colour. The UNCHECKED fill is a separate matter settled
 * by `color-scheme`, which this says nothing about.
 */
it("hands the preselect radio the brand colour to draw its checked dot with", async () => {
  const { el, host } = await mount({ value: cooked });
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");

  expect(getComputedStyle(radio(el, 0)).accentColor).toBe("rgb(1, 2, 3)");
});

it("puts a customer-name refusal beside the first language, and an active one in the bottom message", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: {
      customerName: "Needs a customer-facing name.",
      active: "Cannot be switched off.",
      "labels.0.customerName": "The option needs one too.",
    },
  });

  expect(field(el, "customer-name-en").error).toBe("Needs a customer-facing name.");
  expect(field(el, "customer-name-es").error).toBe("");
  expect(rowErrors(el, 0)).toEqual(["The option needs one too."]);
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe(`Cannot be switched off. ${t("form.fix_fields")}`);

  const form = await openEditor(el, 0);
  expect(form.errors).toEqual({ "label-customer-name-en": "The option needs one too." });
  expect(field(form, "label-customer-name-en").error).toBe("The option needs one too.");
});

it.each([
  ["an option as a whole", "labels.0"],
  ["an option field with no input", "labels.0.available"],
  ["an option the form does not hold", "labels.9.name"],
])("shows a refusal naming %s under the options table", async (_what, path) => {
  const { el } = await mount({ value: cooked, fieldErrors: { [path]: "Something is wrong." } });

  expect(text(el, "labels-error")).toBe("Something is wrong.");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).disabled).toBe(false);
});

it("moves a rejected option's message under the options table once that option is removed", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();

  await click(el, "remove-label-1");

  expect(text(el, "labels-error")).toBe("Already used.");
  // Removing the option was the change to the field the refusal named, so nothing is left to fix.
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("reads an option with no kitchen name as blank and submits blank kitchen names as null", async () => {
  const { el, host } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, kitchenName: null }, cooked.labels[1]!] },
  });
  const submitted = record(host);
  const form = await openEditor(el, 0);
  expect(field(form, "label-kitchen-name").value).toBe("");
  await click(form, "cancel");

  await type(el, "kitchen-name", "  ");
  await editOption(el, 1, (other) => type(other, "label-kitchen-name", " "));
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.kitchenName).toBeNull();
  expect(submitted[0]!.labels.map((label) => label.kitchenName)).toEqual([null, null]);
});

it("trims an option's name when the list is saved", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => type(form, "label-name", "  Blue  "));
  await click(el, "save");

  expect(submitted[0]!.labels[0]!.name).toBe("Blue");
});

it("holds the dialog open against Escape only while it is saving", async () => {
  const { el } = await mount({ value: cooked });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    modal.dispatchEvent(event);
    return event.defaultPrevented;
  };

  expect(press("Escape")).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(press("Escape")).toBe(true);
  expect(press("Enter")).toBe(false);
});

it("ignores a drag whose row was removed mid-gesture, leaving the save's messages in place", async () => {
  const { el, host } = await mount({ value: { ...cooked, labels: [...cooked.labels, wellDone] } });
  const submitted = record(host);
  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${RARE}"]`)!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

  await click(el, "remove-label-0");
  await type(el, "name", "");
  await click(el, "save");
  expect(field(el, "name").error).toBe(t("options.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));

  const firstRow = el.shadowRoot!.querySelector("tbody tr")!.getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientY: firstRow.top + firstRow.height / 2,
    }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await el.updateComplete;

  expect(field(el, "name").error).toBe(t("options.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  await type(el, "name", "Cooked");
  await click(el, "save");
  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([MEDIUM, WELL]);
});

// ---------------------------------------------------------------------------
// The option editor stacked over the list

function dialogOf(form: OptionListForm | OptionLabelForm): HTMLDialogElement {
  return form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!;
}

/** Opens a row's editor the way a person does — real clicks on the kebab and then on Edit — so the
 * browser treats the second dialog as opened by the user. */
async function openByHand(
  el: OptionListForm,
  index: number,
): Promise<HTMLElementTagNameMap["wt-row-actions"]> {
  const actions = el.shadowRoot!.querySelectorAll("wt-row-actions")[index]!;
  await userEvent.click(actions.shadowRoot!.querySelector("button")!);
  await userEvent.click(el.shadowRoot!.querySelector(`[data-test="edit-label-${index}"]`)!);
  await el.updateComplete;
  await editor(el).updateComplete;
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(true));
  return actions;
}

it("closes only the option editor on Escape, and puts focus back on that row's actions", async () => {
  const { el, host } = await mount({ value: cooked });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);
  const actions = await openByHand(el, 1);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(editor(el).open).toBe(false));
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  expect(dialogOf(el).open).toBe(true);
  expect(el.open).toBe(true);
  expect(cancels).toBe(0);
  await vi.waitFor(() => {
    expect(el.shadowRoot!.activeElement).toBe(actions);
    expect(actions.shadowRoot!.activeElement).toBe(actions.shadowRoot!.querySelector("button"));
  });
});

it("puts focus back on that row's actions after the option editor saves", async () => {
  const { el } = await mount({ value: cooked });
  const actions = await openByHand(el, 0);

  await type(editor(el), "label-name", "Blue");
  await userEvent.click(editor(el).shadowRoot!.querySelector('[data-test="save"]')!);
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  expect(text(el, "label-0-name")).toBe("Blue");
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(actions));
});

it("puts focus back on the option's name when the editor its name opened closes", async () => {
  const { el } = await mount({ value: cooked });
  await userEvent.click(nameButton(el, 1));
  await el.updateComplete;
  await editor(el).updateComplete;
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(true));

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(nameButton(el, 1)));
});

it("puts focus back on Add option after a new option is saved", async () => {
  const { el } = await mount({ value: cooked });
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option"]')!;
  await userEvent.click(add);
  await editor(el).updateComplete;
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(true));

  await type(editor(el), "label-name", "Well done");
  await userEvent.click(editor(el).shadowRoot!.querySelector('[data-test="save"]')!);
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(add));
});

it("focuses the next option's actions after deleting a middle option", async () => {
  const { el } = await mount({ value: { ...cooked, labels: [...cooked.labels, wellDone] } });
  const actions = el.shadowRoot!.querySelectorAll("wt-row-actions")[1]!;
  await userEvent.click(actions.shadowRoot!.querySelector("button")!);
  await userEvent.click(el.shadowRoot!.querySelector('[data-test="remove-label-1"]')!);
  await el.updateComplete;
  const next = el.shadowRoot!.querySelector<HTMLElement>(
    `tr[data-label="${WELL}"] wt-row-actions`,
  )!;
  expect(next).not.toBeNull();
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(next));
});

it("focuses Add option after deleting the only option", async () => {
  const { el } = await mount({ value: { ...cooked, labels: [cooked.labels[0]!] } });
  const actions = el.shadowRoot!.querySelector("wt-row-actions")!;
  await userEvent.click(actions.shadowRoot!.querySelector("button")!);
  await userEvent.click(el.shadowRoot!.querySelector('[data-test="remove-label-0"]')!);
  await el.updateComplete;
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option"]')!;
  expect(add).not.toBeNull();
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(add));
});

it("renders the option editor outside the list's saving wrapper, and passes it the saving state", async () => {
  const { el } = await mount({ value: cooked });
  const form = editor(el);

  expect(form.closest(".fields")).toBeNull();
  expect(form.closest("[inert]")).toBeNull();
  expect(form.busy).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(form.busy).toBe(true);
  expect(form.closest("[inert]")).toBeNull();
  expect(el.shadowRoot!.querySelector(".fields")!.hasAttribute("inert")).toBe(true);
});

it("keeps the option editor's own save and cancel from reaching the screen", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  await editOption(el, 0, (form) => type(form, "label-name", "Blue"));
  const form = await openEditor(el, 1);
  await click(form, "cancel");

  expect(submitted).toEqual([]);
  expect(cancels).toBe(0);
});

it("closes the option editor when the list is closed or reopened", async () => {
  const { el } = await mount({ value: cooked });
  await openEditor(el, 0);
  expect(editor(el).open).toBe(true);

  el.open = false;
  await el.updateComplete;
  expect(editor(el).open).toBe(false);

  await openEditor(el, 0);
  el.open = true;
  await el.updateComplete;
  expect(editor(el).open).toBe(false);
});

it.each([1280, 390])(
  "centres an option's name, radio and menu on one line at %ipx",
  async (frame) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const { el } = await mount({ value: cooked });
      const row = el.shadowRoot!.querySelector(`tr[data-label="${RARE}"]`)!;
      const middle = (node: Element) => {
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      const name = middle(row.querySelector('[data-test="label-0-name"]')!);
      const pick = middle(row.querySelector('[data-test="label-0-default"]')!);
      const menu = middle(
        row.querySelector("wt-row-actions")!.shadowRoot!.querySelector("button")!,
      );

      expect(window.innerWidth).toBe(frame);
      expect(Math.abs(pick - name), "radio").toBeLessThanOrEqual(1);
      expect(Math.abs(menu - name), "menu").toBeLessThanOrEqual(1);
    } finally {
      await page.viewport(width, height);
    }
  },
);

it("clears a refusal held for an option once that option is saved in its editor, and only that option's", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: { "labels.0.kitchenName": "Too long.", "labels.1.name": "Already used." },
  });

  await editOption(el, 1, (form) => type(form, "label-name", "Medium rare"));

  expect(rowErrors(el, 1)).toEqual([]);
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect((await openEditor(el, 1)).errors).toEqual({});
  await click(editor(el), "cancel");
  expect(rowErrors(el, 0)).toEqual(["Too long."]);
  expect((await openEditor(el, 0)).errors).toEqual({ "label-kitchen-name": "Too long." });
});

it("keeps a refusal held for an option when its editor is cancelled", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });

  const form = await openEditor(el, 1);
  await type(form, "label-name", "Medium rare");
  await click(form, "cancel");
  await el.updateComplete;

  expect(rowErrors(el, 1)).toEqual(["Already used."]);
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
});

// ---------------------------------------------------------------------------
// When it speaks about errors

it("says nothing about errors before the first submission, and Save works", async () => {
  const { el } = await mount({ value: cooked });
  await type(el, "name", "");
  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await editOption(el, 1, (form) => toggle(form, "label-available", false));

  expect(field(el, "name").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission focuses the name, keeps what was typed and disables Save", async () => {
  const { el } = await mount({ value: cooked });
  await type(el, "kitchen-name", "CK");
  await type(el, "name", " ");
  await click(el, "save");
  await new Promise((resolve) => setTimeout(resolve));

  expect(field(el, "name").shadowRoot!.activeElement).toBe(
    field(el, "name").shadowRoot!.querySelector("input"),
  );
  expect(field(el, "kitchen-name").value).toBe("CK");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("focuses the options table when the options are all that is wrong", async () => {
  const { el } = await mount();
  await type(el, "name", "Cooked");
  await click(el, "save");
  await new Promise((resolve) => setTimeout(resolve));

  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector(".table-wrap"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
  const { el } = await mount();
  await click(el, "save");
  expect(text(el, "labels-error")).toBe(t("options.labels_required"));

  await type(el, "name", "Cooked");
  expect(field(el, "name").error).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  await type(el, "name", " ");
  expect(field(el, "name").error).toBe(t("options.name_required"));

  await type(el, "name", "Cooked");
  await addOption(el, "Rare");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("keeps a field's refusal until that field changes, with Save working throughout", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { kitchenName: "Too long." } });
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "name", "Cooking");
  expect(field(el, "kitchen-name").error).toBe("Too long.");
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "kitchen-name", "CK");
  expect(field(el, "kitchen-name").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("clears a translated name's refusal only when that language's value changes", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: { customerName: "Rejected English." },
  });

  await type(el, "customer-name-es", "¿Cómo lo quiere?");
  expect(field(el, "customer-name-en").error).toBe("Rejected English.");
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "customer-name-en", "How do you like it?");
  expect(field(el, "customer-name-en").error).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("clears a refusal about the options as a whole once the options change", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { labels: "Something is wrong." } });
  expect(saveOf(el).disabled).toBe(false);

  await click(el, "label-0-default");

  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("focuses the field a refusal names when the refusal arrives, opening its folded section", async () => {
  const { el } = await mount({ value: cooked });
  el.fieldErrors = { customerName: "Too long." };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
      '[data-test="names-section"]',
    )!.open,
  ).toBe(true);
  expect(field(el, "customer-name-en").shadowRoot!.activeElement).toBe(
    field(el, "customer-name-en").shadowRoot!.querySelector("input"),
  );
});

it("keeps a refusal naming no field in the bottom message alone, leaving Save working until it is submitted again", async () => {
  const { el, host } = await mount({ value: cooked, fieldErrors: { _form: "Not found." } });
  const submitted = record(host);

  expect(await bottomOf(el)).toBe("Not found.");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(await bottomOf(el)).toBe("");
});

it("starts again when reopened: no messages and Save working", async () => {
  const { el } = await mount();
  await click(el, "save");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;

  expect(field(el, "name").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});
